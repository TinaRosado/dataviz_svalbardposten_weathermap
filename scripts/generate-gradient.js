// Density-weighted gradient fill — offline texture generator.
//
// Reads the committed public/entities.csv, blends nearby articles' existing
// colors in OKLab weighted by local density, and rasterises the result to two
// PNGs (screen + print resolution) plus a small JSON bounding-box sidecar.
// Run via `npm run generate:gradient`, or automatically before dev/build (see
// package.json's predev/prestart/prebuild hooks).
//
// Coordinate system: the interface's world-coordinate scale (src/index.js's
// scale_X/scale_Y) is only known in the browser, computed once at page load
// from window.innerWidth/innerHeight — a Node script can't anticipate a
// visitor's window size. So this script works entirely in the CSV's raw x/y
// domain (the same domain src/index.js rescales from) and ships the padded
// bounding box it covers in gradient-fill.json. At runtime,
// src/interface/gradientFill.js maps that box through the exact same
// scale_X/scale_Y/margins used for articles, so positions land in perfect
// alignment. The one thing that can't be reproduced exactly is bandwidth as a
// literal count of "screen units" (contours.js's bandwidth=24 only means
// something relative to that same window-size-dependent scale) — this script
// treats BANDWIDTH as raw x/y units instead, which is a practical stand-in
// since the CSV's x/y already sit in a comparable numeric range to the
// rescaled map (see CLAUDE.md), not a guaranteed exact match at every window
// size. contours.js has the same load-time-only limitation (it doesn't
// recompute on resize either).

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { csvParse } from 'd3'
import { converter } from 'culori'
import { PNG } from 'pngjs'

import { filterEntities } from '../src/lib/filterEntities.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CSV_PATH = join(ROOT, 'public', 'entities.csv')
const OUT_DIR = join(ROOT, 'public')

// ---- Tuning -----------------------------------------------------------------
// Centralized knobs. Edit these, then re-run `npm run generate:gradient` (or
// restart dev/build) to see the effect — nothing else in the app needs to
// change.
const TUNING = {
    // Longest edge of the generated bitmap, in pixels. The screen texture is
    // shown live in the interface; the print texture is embedded in the A0
    // PDF export, where it needs more pixels to stay smooth at that size.
    screenMaxDim: 1400,
    printMaxDim: 2600,
    // Kernel bandwidth (blur radius), in the CSV's raw x/y units — see the
    // header comment above for why this can't be a literal screen-pixel value.
    bandwidth: 24,
    // The padded canvas extends this many bandwidths beyond the article
    // extent on every side, so the Gaussian-ish falloff reaches ~0 well inside
    // the texture edge instead of being cut off into a visible rectangle.
    paddingBandwidths: 3,
    // Local density (blurred point weight) below which a texel is fully
    // transparent, so empty regions are exactly white, not faintly tinted.
    // Expressed as a fraction of this render's own peak density (rather than
    // an absolute count) so the same tuning holds regardless of point count,
    // canvas resolution, or a future data regeneration.
    minDensityFrac: 0.04,
    // Density (as a fraction of the peak) at which opacity saturates to
    // maxOpacity.
    refDensityFrac: 0.45,
    maxOpacity: 0.85,
    // Opacity-vs-density curve exponent. <1 pushes sparse regions toward
    // maxOpacity sooner (softer overall look); >1 keeps only the densest
    // cores opaque.
    opacityCurve: 0.6,
    // Multiplies the blended color's OKLCH chroma. Averaging many hues in
    // OKLab pulls mixed-year regions toward gray; this compensates.
    chromaBoost: 1.35,
    // Extra fade applied within this fraction of the texture's shorter side,
    // measured from each edge — insurance against a hard boundary on top of
    // the natural Gaussian falloff.
    edgeFeatherFrac: 0.03,
}

// ---- CSV → validated points --------------------------------------------------

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const validateEntities = (entities) => {
    const valid = []
    const invalid = []
    for (const e of entities) {
        const x = parseInt(e.x, 10)
        const y = parseInt(e.y, 10)
        if (!Number.isFinite(x) || !Number.isFinite(y) || !HEX_RE.test(e.color || '')) {
            invalid.push(e)
            continue
        }
        valid.push({ x, y, color: e.color })
    }
    return { valid, invalid }
}

const computeBBox = (points, pad) => {
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    return {
        x0: Math.min(...xs) - pad,
        x1: Math.max(...xs) + pad,
        y0: Math.min(...ys) - pad,
        y1: Math.max(...ys) + pad,
    }
}

// ---- Separable box blur (three passes ≈ Gaussian), edge-clamped -------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

const blurHorizontal = (src, w, h, r) => {
    const dst = new Float64Array(w * h)
    const windowSize = 2 * r + 1
    for (let y = 0; y < h; y++) {
        const row = y * w
        let sum = 0
        for (let k = -r; k <= r; k++) sum += src[row + clamp(k, 0, w - 1)]
        for (let x = 0; x < w; x++) {
            dst[row + x] = sum / windowSize
            sum += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)]
        }
    }
    return dst
}

const blurVertical = (src, w, h, r) => {
    const dst = new Float64Array(w * h)
    const windowSize = 2 * r + 1
    for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -r; k <= r; k++) sum += src[clamp(k, 0, h - 1) * w + x]
        for (let y = 0; y < h; y++) {
            dst[y * w + x] = sum / windowSize
            sum += src[clamp(y + r + 1, 0, h - 1) * w + x] - src[clamp(y - r, 0, h - 1) * w + x]
        }
    }
    return dst
}

const boxBlurPasses = (buf, w, h, radius, passes) => {
    let out = buf
    for (let i = 0; i < passes; i++)
        out = blurVertical(blurHorizontal(out, w, h, radius), w, h, radius)
    return out
}

// ---- Splat + blur + compose one resolution -----------------------------------

const smoothstep = (t) => t * t * (3 - 2 * t)

const renderLayer = (points, bbox, maxDim, tuning) => {
    const domainW = bbox.x1 - bbox.x0
    const domainH = bbox.y1 - bbox.y0
    const pxPerUnit = maxDim / Math.max(domainW, domainH)
    const texWidth = Math.max(1, Math.round(domainW * pxPerUnit))
    const texHeight = Math.max(1, Math.round(domainH * pxPerUnit))

    const weight = new Float64Array(texWidth * texHeight)
    const sumL = new Float64Array(texWidth * texHeight)
    const sumA = new Float64Array(texWidth * texHeight)
    const sumB = new Float64Array(texWidth * texHeight)

    const toOklab = converter('oklab')
    for (const p of points) {
        const tx = Math.floor((p.x - bbox.x0) * pxPerUnit)
        const ty = Math.floor((p.y - bbox.y0) * pxPerUnit)
        if (tx < 0 || tx >= texWidth || ty < 0 || ty >= texHeight) continue
        const idx = ty * texWidth + tx
        const { l, a, b } = toOklab(p.color)
        weight[idx] += 1
        sumL[idx] += l
        sumA[idx] += a
        sumB[idx] += b
    }

    const radius = Math.max(1, Math.round(tuning.bandwidth * pxPerUnit))
    const blurredWeight = boxBlurPasses(weight, texWidth, texHeight, radius, 3)
    const blurredL = boxBlurPasses(sumL, texWidth, texHeight, radius, 3)
    const blurredA = boxBlurPasses(sumA, texWidth, texHeight, radius, 3)
    const blurredB = boxBlurPasses(sumB, texWidth, texHeight, radius, 3)

    // The box blur is a *mean* filter, so its raw output scales with 1/pxPerUnit²
    // (more, smaller cells average the same neighbourhood down further) — not
    // resolution-invariant on its own. Calibrating minDensity/refDensity as
    // fractions of this render's own peak cancels that scaling automatically,
    // so screen and print output the same relative coverage.
    let peakDensity = 0
    for (let i = 0; i < blurredWeight.length; i++)
        if (blurredWeight[i] > peakDensity) peakDensity = blurredWeight[i]
    const minDensity = tuning.minDensityFrac * peakDensity
    const refDensity = tuning.refDensityFrac * peakDensity

    const toRgb = converter('rgb')
    const png = new PNG({ width: texWidth, height: texHeight })
    const featherPx = tuning.edgeFeatherFrac * Math.min(texWidth, texHeight)

    for (let y = 0; y < texHeight; y++) {
        for (let x = 0; x < texWidth; x++) {
            const idx = y * texWidth + x
            const outIdx = idx << 2
            const density = blurredWeight[idx]

            if (density < minDensity) {
                png.data[outIdx] = 255
                png.data[outIdx + 1] = 255
                png.data[outIdx + 2] = 255
                png.data[outIdx + 3] = 0
                continue
            }

            const l = blurredL[idx] / density
            const a0 = blurredA[idx] / density
            const b0 = blurredB[idx] / density
            const chroma = Math.hypot(a0, b0) * tuning.chromaBoost
            const hue = Math.atan2(b0, a0)
            const rgb = toRgb({
                mode: 'oklab',
                l,
                a: chroma * Math.cos(hue),
                b: chroma * Math.sin(hue),
            })

            let t = clamp((density - minDensity) / (refDensity - minDensity), 0, 1)
            t = Math.pow(t, tuning.opacityCurve)
            let alpha = tuning.maxOpacity * t

            const edgeDist = Math.min(x, texWidth - 1 - x, y, texHeight - 1 - y)
            if (edgeDist < featherPx) alpha *= smoothstep(clamp(edgeDist / featherPx, 0, 1))

            png.data[outIdx] = Math.round(clamp(rgb.r, 0, 1) * 255)
            png.data[outIdx + 1] = Math.round(clamp(rgb.g, 0, 1) * 255)
            png.data[outIdx + 2] = Math.round(clamp(rgb.b, 0, 1) * 255)
            png.data[outIdx + 3] = Math.round(clamp(alpha, 0, 1) * 255)
        }
    }

    return { png, texWidth, texHeight }
}

// ---- Main ---------------------------------------------------------------------

const main = () => {
    const started = Date.now()
    const rows = csvParse(readFileSync(CSV_PATH, 'utf8'))
    const filtered = filterEntities(rows)
    const { valid, invalid } = validateEntities(filtered)

    if (invalid.length > 0) {
        console.warn(
            `[generate-gradient] skipped ${invalid.length} invalid record(s) (bad x/y or color); ` +
                `example id(s): ${invalid
                    .slice(0, 5)
                    .map((e) => e.id ?? '?')
                    .join(', ')}`,
        )
    }
    if (valid.length === 0)
        throw new Error('generate-gradient: no valid entities to build a gradient from')

    const bbox = computeBBox(valid, TUNING.bandwidth * TUNING.paddingBandwidths)

    const screen = renderLayer(valid, bbox, TUNING.screenMaxDim, TUNING)
    writeFileSync(join(OUT_DIR, 'gradient-fill.png'), PNG.sync.write(screen.png))

    const print = renderLayer(valid, bbox, TUNING.printMaxDim, TUNING)
    writeFileSync(join(OUT_DIR, 'gradient-fill-print.png'), PNG.sync.write(print.png))

    writeFileSync(join(OUT_DIR, 'gradient-fill.json'), JSON.stringify(bbox))

    console.log(
        `[generate-gradient] wrote screen ${screen.texWidth}x${screen.texHeight} and ` +
            `print ${print.texWidth}x${print.texHeight} from ${valid.length} articles in ${Date.now() - started}ms`,
    )
}

main()
