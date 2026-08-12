import { Container, Graphics, Rectangle } from 'pixi.js'
import { clusterGeometry, paintBlob, makeLabel, deconflictLabels } from './geometry.js'

// Fixed extra reach (world units), beyond each cluster's own outer radius,
// used to decide whether two clusters count as "nearby" for hover (see
// neighborsByClusterId below). Two clusters are neighbors if the distance
// between their centroids is within the sum of their own outer radii plus
// this buffer — so tight/overlapping clusters are reliably linked, and nudging
// this up or down directly controls how far hovering one cluster reaches to
// pull in others. A first-pass value — tune after visual testing.
const NEIGHBOR_BUFFER = 20

// Max distance from a cluster's centroid to any of its own (expanded) hull
// vertices — treated as that cluster's "reach" for the neighbor check above.
const outerRadius = (c) =>
    Math.max(...c.expanded.map(([x, y]) => Math.hypot(x - c.center[0], y - c.center[1])))

// Padding (world units) added around a cluster's topic-label bounding box
// when building its hover *entry* region — see the labels loop below.
const LABEL_HOVER_PADDING = 2

export default (entities) => {
    const stage = new Container()
    stage.interactiveChildren = false
    stage.label = 'clusters'
    s.viewport.addChild(stage)

    // Fills and labels are independent layers so they can be toggled separately
    // (e.g. labels alone, alongside the fronts). The fill Graphics holds every
    // blob — each paintBlob commits with its own red/blue tint.
    const fills = new Graphics()
    fills.label = 'clusters-fills'
    fills.visible = false // off by default; the fronts read on their own
    const labels = new Container()
    labels.label = 'clusters-labels'
    stage.addChild(fills, labels)

    // Invisible per-cluster hover *entry* regions, positioned on the
    // cluster's own topic label (always visible, fixed in place — unlike the
    // circles, labels never move; see prompts/cluster-hover.md §8) rather
    // than the hull: entering is a deliberate, precise gesture ("I'm pointing
    // at this cluster's name"), while *staying* active is handled separately
    // below by a region sized to the grid layout itself, not the network
    // hull — see gridExtentByClusterId in pointGradient.js and its wiring in
    // index.js. A sibling of `stage`, not a child of it, since
    // `stage.interactiveChildren` above is false (fills/labels were never
    // meant to be interactive). clusterHover.js wires these up later, once
    // pointGradient/elements both exist (see index.js); this module only
    // exposes what can be hovered and which cluster it belongs to.
    const hoverHits = new Container()
    hoverHits.label = 'clusters-hover-hits'
    s.viewport.addChild(hoverHits)

    const geoms = clusterGeometry(entities)

    const labelList = []
    geoms.forEach((c) => {
        paintBlob(fills, c.expanded, c.color)
        const label = makeLabel(c)
        labels.addChild(label)
        labelList.push(label)
    })

    // Which other clusters hovering this one should also activate — computed
    // once, up front (O(n²) over ~124 clusters is trivial), from centroid
    // distance and each cluster's own outerRadius (see NEIGHBOR_BUFFER above).
    // clusterHover.js expands every hover to {clusterId, ...its neighbors}
    // rather than just the one literally under the pointer, so a group of
    // nearby or overlapping clusters reposition together instead of only the
    // topmost one responding.
    const neighborsByClusterId = new Map(geoms.map((c) => [c.id, []]))
    const radiusById = new Map(geoms.map((c) => [c.id, outerRadius(c)]))
    for (let i = 0; i < geoms.length; i++) {
        for (let j = i + 1; j < geoms.length; j++) {
            const a = geoms[i]
            const b = geoms[j]
            const d = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1])
            if (d > radiusById.get(a.id) + radiusById.get(b.id) + NEIGHBOR_BUFFER) continue
            neighborsByClusterId.get(a.id).push(b.id)
            neighborsByClusterId.get(b.id).push(a.id)
        }
    }

    // Nudge labels apart before they're drawn. The generous padding keeps a gap
    // between neighbours so the fronts running between clusters have room; the
    // extra iterations let the (now larger) labels fully settle to no overlap.
    // Must run before the hover-entry regions below, which are sized from
    // each label's *final* (deconflicted) position.
    deconflictLabels(labelList, { padding: 4, iterations: 200 })

    // Built only now that labels have settled into their final positions —
    // one hover-entry region per cluster, matching that label's own bounding
    // box (+ a little padding), positioned exactly like BitmapText's
    // top-left-anchored x/y.
    const hoverTargets = geoms.map((c, i) => {
        const label = labelList[i]
        const hit = new Container()
        hit.position.set(label.x - LABEL_HOVER_PADDING, label.y - LABEL_HOVER_PADDING)
        hit.hitArea = new Rectangle(
            0,
            0,
            label.width + 2 * LABEL_HOVER_PADDING,
            label.height + 2 * LABEL_HOVER_PADDING,
        )
        hit.eventMode = 'static'
        hit.cursor = 'pointer'
        // Makes this region keyboard-focusable via PixiJS's built-in
        // accessibility system (Tab-activated) — see clusterHover.js for why
        // that alone is enough for keyboard equivalence, with no separate
        // focus-handling code needed here.
        hit.accessible = true
        hit.accessibleTitle = c.subject
        hoverHits.addChild(hit)
        return { clusterId: c.id, target: hit }
    })

    // Recolours every label's main text (not its white glow) to follow
    // "Colour by year", exactly like the circles/crosses do: black when off,
    // each label's own red/blue temperature tint when on. Called by
    // controls.js once on load and again whenever the toggle changes.
    const setLabelColorByYear = (colorByYear) => {
        labelList.forEach((container) => {
            container.mainText.tint = colorByYear ? container.temperatureTint : 0x000000
        })
    }

    // `labels` handed back so index.js can re-parent it to the very top of
    // the viewport (above the Point Gradient circles, elements, and fronts)
    // once every other layer is in place — topic labels (and their glow, see
    // geometry.js) need to stay readable over all of them, while the fill
    // blobs stay behind at this stage's original position. `hoverTargets`
    // (cluster id + its hit region) and `neighborsByClusterId` are consumed
    // by clusterHover.js via index.js.
    return { labels, setLabelColorByYear, hoverTargets, neighborsByClusterId }
}
