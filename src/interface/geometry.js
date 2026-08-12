import { BitmapText, BlurFilter, Container } from 'pixi.js'
import { group, mean, polygonHull, polygonCentroid, line, curveCatmullRomClosed } from 'd3'
import { average, rgb, formatHex } from 'culori'

// Cluster-label glow — a blurred white copy of the same text sitting behind
// the sharp red/blue one, so topic labels stay readable over the black
// Point Gradient circles and the coloured density gradient beneath them.
// Screen-only: the SVG/PDF export (download.js) reads past this copy to the
// real text, since a blurred raster glow has no vector print equivalent.
const GLOW_BLUR_STRENGTH = 2.2
const GLOW_ALPHA = 0.85

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
            subject: members[0].cluster_subject_x,
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
const titleCase = (string) => string.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase())

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

// The cluster's topic label, centred on its centroid — wrapped with a
// blurred white glow copy behind it (see GLOW_* above) so it reads clearly
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
export const makeLabel = (c) => {
    const text = splitInThree(titleCase(c.subject))
    const style = { fontFamily: 'Lato', fontSize: 3.4, lineHeight: 3.4, align: 'center' }

    const glow = new BitmapText({ text, style })
    glow.tint = 0xffffff
    glow.alpha = GLOW_ALPHA
    glow.filters = [new BlurFilter({ strength: GLOW_BLUR_STRENGTH })]

    const main = new BitmapText({ text, style })
    const temperatureTint = c.key === 'red' ? 0xff0000 : 0x0000ff
    main.tint = temperatureTint // sensible default; controls.js confirms/overrides via setLabelColorByYear on load

    const container = new Container()
    container.addChild(glow, main)
    container.position.set(c.center[0] - container.width / 2, c.center[1] - container.height / 2)
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
