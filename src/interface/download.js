// Vector A0 print export. The on-screen map is a WebGL raster, which can't be
// scaled up for print without going soft — so instead of capturing pixels we
// re-emit the map as an SVG (every layer is just lines, polygons, and text),
// then convert that to a true-vector A0-landscape PDF with svg2pdf.js + jsPDF.
// The result is resolution-independent: razor-sharp at any print size.
//
// Only the currently visible layers are exported (WYSIWYG with the Layers
// panel). Label positions are read straight off the live PixiJS scene graph, so
// the deconflicted placement in the SVG matches the screen exactly; the shapes
// (contours, blobs, fronts) are re-run through the same d3 / fronts generators
// the renderer uses, so there's a single source of truth.

import { contourDensity, line, curveCatmullRomClosed } from 'd3'
import { clusterGeometry } from './geometry.js'
import { frontsGeometry, semicirclePoints, FRONT_COLOR_HEX, FRONT_LINE_WIDTH, PIP_R } from './fronts.js'
import { CIRCLE_FILL_OPACITY } from './pointGradient.js'

const SVGNS = 'http://www.w3.org/2000/svg'

// Used if exported before controls.js has ever run (shouldn't happen in
// practice — the download button only exists after it does) — an
// unrestricted range, matching "nothing filtered yet".
const yearsFallback = { colorByYear: false, startYear: -Infinity, endYear: Infinity }

// A0 landscape, in millimetres, and the white margin left around the map.
const A0 = { w: 1189, h: 841 }
const MARGIN = 20

// ---- helpers ---------------------------------------------------------------

// Locate a labelled display object anywhere under the viewport (labels can be
// nested inside their parent layer).
const findByLabel = (node, label) => {
    if (node.label === label) return node
    for (const child of node.children ?? []) {
        const found = findByLabel(child, label)
        if (found) return found
    }
    return null
}

// A layer counts as "on" only if it and every ancestor up to the viewport is
// visible. We read `.visible` (the checkbox state), deliberately ignoring the
// transient zoom-crossfade `.alpha`, so the export reflects the user's toggles.
const isVisible = (label) => {
    let node = findByLabel(s.viewport, label)
    if (!node) return false
    while (node && node !== s.viewport) {
        if (!node.visible) return false
        node = node.parent
    }
    return true
}

// PixiJS tint (0xRRGGBB number) → CSS hex.
const tintHex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6)

const el = (name, attrs, text) => {
    const node = document.createElementNS(SVGNS, name)
    for (const k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k])
    if (text != null) node.textContent = text
    return node
}

// Running bounding box over every coordinate emitted, so we can frame the page.
const makeBBox = () => {
    let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity
    return {
        add(x, y) {
            if (x < x0) x0 = x
            if (y < y0) y0 = y
            if (x > x1) x1 = x
            if (y > y1) y1 = y
        },
        get() {
            return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
        },
    }
}

const arrayBufferToBase64 = (buffer) => {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
}

// ---- SVG construction ------------------------------------------------------

const buildSvg = (entities) => {
    const svg = el('svg', { xmlns: SVGNS })
    const bbox = makeBBox()

    // Gradient fill — placed first so it prints behind every other layer, at
    // print resolution (see scripts/generate-gradient.js), positioned from the
    // same projection gradientFill.js already computed for the on-screen sprite.
    if (isVisible('gradient-fill') && s.gradientFill) {
        const { x, y, width, height } = s.gradientFill
        svg.appendChild(
            el('image', {
                href: import.meta.env.BASE_URL + 'gradient-fill-print.png',
                x,
                y,
                width,
                height,
                preserveAspectRatio: 'none',
            }),
        )
        bbox.add(x, y)
        bbox.add(x + width, y + height)
    }

    // Point Gradient circles — reuses the same points (position, radius,
    // colour) pointGradient.js computed and the live Years range state from
    // controls.js, so the export matches whatever is currently on screen,
    // including the active [startYear, endYear] selection.
    //
    // One <circle> per point, not batched into shared per-colour paths (as the
    // crosses below are): batching same-colour circles into one path's
    // subpaths would make their overlaps merge flat under SVG's fill-rule
    // instead of alpha-accumulating — individual elements stack with normal
    // compositing in document order, exactly like Pixi's sequential draws.
    if (isVisible('point-gradient') && s.pointGradient) {
        const { points } = s.pointGradient
        const years = s.visualization?.years ?? yearsFallback
        const g = el('g', { 'fill-opacity': CIRCLE_FILL_OPACITY })
        points.forEach((p) => {
            if (p.year < years.startYear || p.year > years.endYear) return
            const fill = years.colorByYear ? tintHex(p.color) : '#000000'
            g.appendChild(
                el('circle', { cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: p.r.toFixed(2), fill }),
            )
            bbox.add(p.x - p.r, p.y - p.r)
            bbox.add(p.x + p.r, p.y + p.r)
        })
        svg.appendChild(g)
    }

    // Contours — density isolines, recomputed exactly as contours.js draws them.
    if (isVisible('contours')) {
        const density = contourDensity()
            .x((e) => e.x)
            .y((e) => e.y)
            .weight(() => 10)
            .size([window.innerWidth, window.innerHeight])
            .cellSize(1)
            .bandwidth(24)
            .thresholds(20)(entities)

        let d = ''
        density.forEach((layer) =>
            layer.coordinates.forEach((polygon) =>
                polygon.forEach((ring) => {
                    ring.forEach(([x, y], i) => {
                        d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2)
                        bbox.add(x, y)
                    })
                }),
            ),
        )
        svg.appendChild(el('path', { d, fill: 'none', stroke: '#b7c2cc', 'stroke-width': 0.5 }))
    }

    const geoms = clusterGeometry(entities)

    // Cluster fill blobs — smooth closed curve through the expanded-hull edge
    // midpoints (mirrors geometry.js paintBlob), filled at 0.2 alpha.
    if (isVisible('clusters-fills')) {
        const blob = line()
            .x((d) => d[0])
            .y((d) => d[1])
            .curve(curveCatmullRomClosed)
        const g = el('g', {})
        geoms.forEach((c) => {
            const mid = c.expanded.map((p, i) => {
                const q = c.expanded[(i + 1) % c.expanded.length]
                return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
            })
            c.expanded.forEach(([x, y]) => bbox.add(x, y))
            g.appendChild(el('path', { d: blob(mid), fill: c.color, 'fill-opacity': 0.2 }))
        })
        svg.appendChild(g)
    }

    // Fronts — bowed Bézier + red pips, from the shared fronts geometry.
    if (isVisible('fronts')) {
        const g = el('g', {})
        frontsGeometry(entities).forEach((f) => {
            const curve = `M${f.P1[0]} ${f.P1[1]}Q${f.Q[0]} ${f.Q[1]} ${f.P2[0]} ${f.P2[1]}`
            g.appendChild(
                el('path', {
                    d: curve,
                    fill: 'none',
                    stroke: FRONT_COLOR_HEX,
                    'stroke-width': FRONT_LINE_WIDTH,
                    'stroke-opacity': 0.9,
                }),
            )
            bbox.add(f.P1[0], f.P1[1])
            bbox.add(f.P2[0], f.P2[1])
            f.pips.forEach((pip) => {
                const pts = semicirclePoints(pip.C, pip.t, pip.n, PIP_R)
                let d = ''
                pts.forEach(([x, y], i) => {
                    d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2)
                    bbox.add(x, y)
                })
                g.appendChild(el('path', { d: d + 'Z', fill: FRONT_COLOR_HEX }))
            })
        })
        svg.appendChild(g)
    }

    // Text labels — read straight off the live scene graph so their positions
    // (including cluster-label deconfliction) match the screen exactly. Pixi
    // BitmapText anchors at the top-left; SVG text sits on the baseline, so drop
    // it by roughly the ascent (0.8em).
    const addLabels = (label, anchor) => {
        const node = findByLabel(s.viewport, label)
        if (!node || !isVisible(label)) return
        const g = el('g', { 'text-anchor': anchor, 'font-family': 'Lato' })
        node.children.forEach((t) => {
            // Cluster labels wrap a blurred white glow copy + the real text in
            // a Container now (see geometry.js's makeLabel — screen-only
            // effect, no vector print equivalent); other label kinds
            // (elements-years/titles/keywords) are still plain BitmapText.
            // Either way `t` itself carries the position/bounds to export
            // from; the text/style/tint may live one level deeper, at
            // `mainText` specifically — a plain child search would also
            // match the glow copy (it's a BitmapText too, added first).
            const textNode = t.text != null ? t : t.mainText
            if (!textNode) return
            const size = textNode.style?.fontSize ?? 0.7
            const lh = textNode.style?.lineHeight || size
            const fill = tintHex(textNode.tint)
            // Centred multi-line cluster labels vs left-aligned single-line
            // element labels.
            const cx = anchor === 'middle' ? t.x + t.width / 2 : t.x
            const lines = String(textNode.text).split('\n')
            const text = el('text', { x: cx, 'font-size': size, fill })
            lines.forEach((ln, i) => {
                text.appendChild(el('tspan', { x: cx, y: (t.y + size * 0.8 + i * lh).toFixed(2) }, ln))
            })
            svgAddBBox(bbox, t)
            g.appendChild(text)
        })
        svg.appendChild(g)
    }

    addLabels('clusters-labels', 'middle')
    addLabels('elements-years', 'start')
    addLabels('elements-titles', 'start')
    addLabels('elements-keywords', 'start')

    return { svg, bbox: bbox.get() }
}

// Grow the bbox to cover a live text object's footprint.
const svgAddBBox = (bbox, t) => {
    bbox.add(t.x, t.y)
    bbox.add(t.x + (t.width || 0), t.y + (t.height || 0))
}

// ---- export ----------------------------------------------------------------

export default async function download() {
    const { svg, bbox } = buildSvg(s.entities)
    if (!(bbox.w > 0 && bbox.h > 0)) throw new Error('Nothing visible to export')

    // Pad the frame slightly and set the viewBox to the map's own coordinates.
    const pad = 0.02 * Math.max(bbox.w, bbox.h)
    const vx = bbox.x - pad,
        vy = bbox.y - pad,
        vw = bbox.w + 2 * pad,
        vh = bbox.h + 2 * pad
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`)
    svg.setAttribute('width', vw)
    svg.setAttribute('height', vh)

    // Lazy-load the PDF toolchain (heavy) only when someone actually exports.
    const [{ jsPDF }, { svg2pdf }, fontBuffer] = await Promise.all([
        import('jspdf'),
        import('svg2pdf.js'),
        fetch(import.meta.env.BASE_URL + 'Lato-Regular.ttf').then((r) => r.arrayBuffer()),
    ])

    // Register Lato as a browser font (so svg2pdf measures text correctly) and
    // embed it in the PDF (so labels stay real, selectable, subset-embedded text
    // — which also scales to the ~9k article labels if a label mode is on).
    const face = new FontFace('Lato', fontBuffer)
    await face.load()
    document.fonts.add(face)

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a0' })
    pdf.addFileToVFS('Lato-Regular.ttf', arrayBufferToBase64(fontBuffer))
    pdf.addFont('Lato-Regular.ttf', 'Lato', 'normal')

    // Fit the map's aspect into the printable area, centred, no distortion.
    const availW = A0.w - 2 * MARGIN,
        availH = A0.h - 2 * MARGIN
    const aspect = vw / vh
    let tw = availW,
        th = availW / aspect
    if (th > availH) {
        th = availH
        tw = availH * aspect
    }
    const tx = (A0.w - tw) / 2,
        ty = (A0.h - th) / 2

    // svg2pdf needs the node laid out in the DOM to measure text; keep it off
    // screen and remove it afterwards.
    svg.style.position = 'absolute'
    svg.style.left = '-99999px'
    svg.style.top = '0'
    document.body.appendChild(svg)
    try {
        await svg2pdf(svg, pdf, { x: tx, y: ty, width: tw, height: th })
    } finally {
        svg.remove()
    }

    // Overlay the HTML annotation panels on top of the vector map, as the screen
    // does. They're rich CSS (frosted panels, colour glyphs, the spectrum bar),
    // so rather than re-emit them as vector we snapshot the live DOM nodes at
    // high scale and place them at their screen corners, scaled to the page.
    await addPanels(pdf)

    pdf.save('svalbard-weather-map-a0.pdf')
}

// Rasterise the masthead (#title, top-left) and legend (#legenda, bottom-right)
// with html2canvas and drop them onto the PDF at the same corners, sized in
// proportion to their on-screen footprint so the poster mirrors the interface.
const addPanels = async (pdf) => {
    const { default: html2canvas } = await import('html2canvas')
    // Half the on-screen proportion — the panels read as compact corner
    // annotations on the poster rather than dominating it.
    const pageScale = 0.5 * (A0.w / window.innerWidth) // screen px → page mm
    const inset = 16 * pageScale // mirrors the panels' 16px screen inset

    const place = async (id, hAlign, vAlign) => {
        const node = document.getElementById(id)
        if (!node) return
        const canvas = await html2canvas(node, { backgroundColor: null, scale: 4, logging: false })
        const w = node.offsetWidth * pageScale
        const h = node.offsetHeight * pageScale
        const x = hAlign === 'left' ? inset : A0.w - inset - w
        const y = vAlign === 'top' ? inset : A0.h - inset - h
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, w, h)
    }

    await place('title', 'left', 'top') // masthead, top-left
    await place('legenda', 'right', 'bottom') // legend, bottom-right
}
