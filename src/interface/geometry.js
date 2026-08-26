import { BitmapText, Container, Graphics } from 'pixi.js'
import { group, mean, polygonHull, polygonCentroid, line, curveCatmullRomClosed } from 'd3'
import { average, rgb, formatHex } from 'culori'

// Cluster-label halo — a plain white rounded-rect plate sized to the text's
// own bounding box, sitting behind it so topic labels stay readable over the
// Point Gradient circles and the coloured density gradient beneath them.
// Always plain white at a fixed opacity, independent of "Colour by year" or
// any other palette — see setLabelColorByYear in clusters.js, which only
// ever recolours the text, never this plate.
// Shared with the SVG/PDF export (download.js draws the same rect from the
// live label bounds), so tuning these three keeps both in sync.
const LABEL_HALO_PADDING = 0.8
export const LABEL_HALO_RADIUS = 1
export const LABEL_HALO_ALPHA = 0.7

// public/Lato.fnt's own <info size='59'.../> and <common lineHeight='72'
// base='60'/>: this font's natural line-height-to-font-size ratio, and where
// its baseline sits within a line. BitmapText's reported bounding box (used
// for lineHeight below) is computed from whatever lineHeight we hand it, but
// its glyphs are still drawn using the font file's own baseline metrics — so
// a lineHeight that doesn't match this ratio produces a box that doesn't
// agree with where the ink actually sits vertically.
//
// Separately, even with that ratio matched, PixiJS starts drawing each
// line's glyphs (FONT_NATURAL_LINE_HEIGHT - FONT_BASELINE) units below the
// box's own top — the font reserves that much room for ascenders above the
// cap line, which most of these Title Case labels never use. That gap isn't
// mirrored at the bottom, so a box centred on the *reported* height ends up
// visibly off-centre around the actual ink. haloRect() below corrects for
// it. Recompute all three numbers here if the font asset is ever swapped.
const FONT_BASE_SIZE = 59
const FONT_NATURAL_LINE_HEIGHT = 72
const FONT_BASELINE = 60

// The halo's geometry, in the same local coordinate space as `main` (i.e.
// relative to its own top-left corner at (0,0)) — a pure function of the
// text's own reported box and font size, so download.js's SVG/PDF export can
// call this with the same inputs and always draw exactly the same box the
// screen does, instead of duplicating (and risking drifting from) this math.
export const haloRect = (main, fontSize) => {
    const inkTop = (fontSize * (FONT_NATURAL_LINE_HEIGHT - FONT_BASELINE)) / FONT_BASE_SIZE
    return {
        x: -LABEL_HALO_PADDING,
        y: inkTop - LABEL_HALO_PADDING,
        width: main.width + 2 * LABEL_HALO_PADDING,
        height: main.height - inkTop + 2 * LABEL_HALO_PADDING,
    }
}

// Proportional padding around each cluster's points (uniform scale about the
// centroid). Lives here so the cluster blobs and the fronts overlap logic can
// never drift apart.
const EXPANSION = 0.15

const expand = (polygon, centroid) => {
    const scale = 1 + EXPANSION
    return polygon.map(([x, y]) => [
        centroid[0] + (x - centroid[0]) * scale,
        centroid[1] + (y - centroid[1]) * scale,
    ])
}

// Per-cluster geometry shared by the clusters and fronts layers: convex hull,
// its expanded (drawn) form, centroid, mean colour, red/blue key by mean
// temperature, and the topic label. Memoised on the entities array so the two
// layers don't each recompute it.
let cache = null
let cacheKey = null
export const clusterGeometry = (entities) => {
    if (cache && cacheKey === entities) return cache

    const out = []
    group(entities, (e) => e.cluster).forEach((members, id) => {
        if (id == -1) return
        const hull = polygonHull(members.map((e) => [e.x, e.y]))
        if (!hull) return
        const center = polygonCentroid(hull)
        const temperature = mean(members.map((e) => e.temperature))
        const colors = members.map((e) => rgb(e.color.substring(2)))
        out.push({
            id,
            hull,
            expanded: expand(hull, center),
            center,
            color: formatHex(average(colors, 'rgb')),
            key: temperature > 0 ? 'red' : 'blue', // emerging vs receding
            // Both languages exposed (not one resolved field) so clusters.js
            // can build an English and a Norwegian label for every cluster up
            // front — see its setLanguage, which just toggles which set is
            // visible rather than rebuilding on toggle.
            subjectEn: members[0].cluster_subject_en || 'Unlabeled topic',
            subjectNo: members[0].cluster_subject_no || 'Unlabeled topic',
        })
    })

    cache = out
    cacheKey = entities
    return out
}

// Smooth closed blob through the edge midpoints of the expanded hull (rounds
// corners inward, keeping the footprint faithful), filled + stroked onto `g`.
const blob = line()
    .x((d) => d[0])
    .y((d) => d[1])
    .curve(curveCatmullRomClosed)

export const paintBlob = (g, expanded, color) => {
    const midpoints = expanded.map((p, i) => {
        const q = expanded[(i + 1) % expanded.length]
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    })
    blob.context(g)
    blob(midpoints)
    g.fill({ color, alpha: 0.2 })
}

// Normalise a label to Title Case (the CSV mixes "Climate Analysis" with
// "Education system"); no cluster title contains an acronym to preserve.
// \p{L} (not \w, which is ASCII-only) so Norwegian letters like æ/ø/å count
// as word characters too — \b\w missed these, treating them as boundaries
// and capitalising the letter right after them (e.g. "Vær" → "VæR").
const titleCase = (string) =>
    string.toLowerCase().replace(/(^|\s)\p{L}/gu, (match) => match.toUpperCase())

// Break a topic label across up to three balanced lines (one word per line for
// the common three-word titles) for a centred, stacked label.
const splitInThree = (string) => {
    const words = string.split(' ').filter(Boolean)
    const lines = Math.min(3, words.length)
    if (lines <= 1) return string

    const base = Math.floor(words.length / lines)
    let extra = words.length % lines // spread the remainder over the first lines
    const out = []
    let i = 0
    while (i < words.length) {
        const take = base + (extra > 0 ? 1 : 0)
        if (extra > 0) extra--
        out.push(words.slice(i, i + take).join(' '))
        i += take
    }
    return out.join('\n')
}

// The cluster's topic label, centred on its centroid — wrapped with a plain
// white halo plate behind it (see LABEL_HALO_* above) so it reads clearly
// over any background. Returns a Container standing in for the old bare
// BitmapText: deconflictLabels only reads its x/y/width/height, which
// Container already exposes the same way.
//
// The main text's colour follows "Colour by year" like the circles/crosses
// do (black off, coloured on) — but its "on" colour is temperatureTint
// (red/blue by mean temperature, this cluster's own High/Low reading), not a
// year colour, since a cluster spans many years and has no single one. Both
// are stashed on the container so clusters.js's setLabelColorByYear can
// recolour it later without rebuilding.
export const makeLabel = (c, subject) => {
    const text = splitInThree(titleCase(subject))
    const fontSize = 4
    const lineHeight = fontSize * (FONT_NATURAL_LINE_HEIGHT / FONT_BASE_SIZE)
    const style = { fontFamily: 'Lato', fontSize, lineHeight, align: 'center' }

    const main = new BitmapText({ text, style })
    const temperatureTint = c.key === 'red' ? 0xff0000 : 0x0000ff
    main.tint = temperatureTint // sensible default; controls.js confirms/overrides via setLabelColorByYear on load

    // Sized around the text's actual ink (see haloRect above), not its full
    // logical box — so, unlike a second oversized text copy, there's no
    // separate element that can drift out of sync on multi-line labels, and
    // unlike padding the logical box directly, the result stays visually
    // centred on the letters regardless of whether this label's lines have
    // descenders or not.
    const rect = haloRect(main, fontSize)
    const halo = new Graphics()
        .roundRect(rect.x, rect.y, rect.width, rect.height, LABEL_HALO_RADIUS)
        .fill({ color: 0xffffff, alpha: LABEL_HALO_ALPHA })

    const container = new Container()
    container.addChild(halo, main)
    // Centred on the halo rect's own centre — equivalently, the text's real
    // ink centre, since the padding haloRect adds is symmetric and so never
    // moves the centre, only the size. (Centring on main.width/height
    // instead would centre on the logical box, reintroducing the same
    // off-centre look haloRect exists to avoid.)
    container.position.set(
        c.center[0] - (rect.x + rect.width / 2),
        c.center[1] - (rect.y + rect.height / 2),
    )
    container.mainText = main
    container.temperatureTint = temperatureTint
    return container
}

// Nudge overlapping labels apart so their topic titles stay legible. Each label
// starts on its cluster centroid (makeLabel); this pushes any colliding pair
// along the axis of least overlap, so every label ends up as close to its
// centroid as it can be without overlapping a neighbour. Positions are the
// labels' top-left corners (x/y), so bounds are simple axis-aligned boxes.
export const deconflictLabels = (labels, { padding = 0.5, iterations = 80 } = {}) => {
    for (let iter = 0; iter < iterations; iter++) {
        let moved = false
        for (let i = 0; i < labels.length; i++) {
            for (let j = i + 1; j < labels.length; j++) {
                const a = labels[i]
                const b = labels[j]
                const dx = b.x + b.width / 2 - (a.x + a.width / 2)
                const dy = b.y + b.height / 2 - (a.y + a.height / 2)
                const overlapX = (a.width + b.width) / 2 + padding - Math.abs(dx)
                const overlapY = (a.height + b.height) / 2 + padding - Math.abs(dy)
                if (overlapX <= 0 || overlapY <= 0) continue // not colliding

                if (overlapX < overlapY) {
                    const shift = (overlapX / 2) * (dx < 0 ? -1 : 1)
                    a.x -= shift
                    b.x += shift
                } else {
                    const shift = (overlapY / 2) * (dy < 0 ? -1 : 1)
                    a.y -= shift
                    b.y += shift
                }
                moved = true
            }
        }
        if (!moved) break
    }
}
