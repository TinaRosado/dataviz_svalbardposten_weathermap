import { Container, Graphics } from 'pixi.js'
import { clusterGeometry, paintBlob, makeLabel, deconflictLabels } from './geometry.js'
import { getLanguage, onLanguageChange } from './language.js'

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

    const geoms = clusterGeometry(entities)

    // Both an English and a Norwegian label are built for every cluster up
    // front (not rebuilt on toggle) and deconflicted independently — their
    // line wraps and widths differ, so each language needs its own layout
    // pass. setLanguage below just switches which set is visible.
    const labelListEn = []
    const labelListNo = []
    geoms.forEach((c) => {
        paintBlob(fills, c.expanded, c.color)
        const labelEn = makeLabel(c, c.subjectEn)
        const labelNo = makeLabel(c, c.subjectNo)
        labels.addChild(labelEn, labelNo)
        labelListEn.push(labelEn)
        labelListNo.push(labelNo)
    })

    // Nudge labels apart before they're drawn. The generous padding keeps a gap
    // between neighbours so the fronts running between clusters have room; the
    // extra iterations let the (now larger) labels fully settle to no overlap.
    deconflictLabels(labelListEn, { padding: 4, iterations: 200 })
    deconflictLabels(labelListNo, { padding: 4, iterations: 200 })

    const allLabels = [...labelListEn, ...labelListNo]

    // Recolours every label's main text (not its white halo plate, which is
    // always plain white regardless of this toggle) to follow "Colour by
    // year", exactly like the circles/crosses do: black when off, each
    // label's own red/blue temperature tint when on. Called by controls.js
    // once on load and again whenever the toggle changes. Applies to both
    // language sets so whichever one is shown is already correctly tinted.
    const setLabelColorByYear = (colorByYear) => {
        allLabels.forEach((container) => {
            container.mainText.tint = colorByYear ? container.temperatureTint : 0x000000
        })
    }

    // Only one language's labels are visible at a time — the masthead NO |
    // ENG toggle (see languageToggle.js) drives this via language.js's shared
    // state, English visible by default.
    const setLanguage = (lang) => {
        labelListEn.forEach((container) => (container.visible = lang === 'en'))
        labelListNo.forEach((container) => (container.visible = lang === 'no'))
    }
    setLanguage(getLanguage())
    onLanguageChange(setLanguage)

    // `labels` handed back so index.js can re-parent it to the very top of
    // the viewport (above the Point Gradient circles, elements, and fronts)
    // once every other layer is in place — topic labels (and their halo, see
    // geometry.js) need to stay readable over all of them, while the fill
    // blobs stay behind at this stage's original position.
    return { labels, setLabelColorByYear }
}
