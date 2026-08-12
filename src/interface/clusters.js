import { Container, Graphics } from 'pixi.js'
import { clusterGeometry, paintBlob, makeLabel, deconflictLabels } from './geometry.js'

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

    const labelList = []
    clusterGeometry(entities).forEach((c) => {
        paintBlob(fills, c.expanded, c.color)
        const label = makeLabel(c)
        labels.addChild(label)
        labelList.push(label)
    })

    // Nudge labels apart before they're drawn. The generous padding keeps a gap
    // between neighbours so the fronts running between clusters have room; the
    // extra iterations let the (now larger) labels fully settle to no overlap.
    deconflictLabels(labelList, { padding: 4, iterations: 200 })

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
    // blobs stay behind at this stage's original position.
    return { labels, setLabelColorByYear }
}
