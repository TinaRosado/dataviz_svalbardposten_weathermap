import { BitmapText, Container, Graphics, Rectangle } from 'pixi.js'

import { click, deselect, parseKeywords } from './click'
import { pickField } from './language.js'

export default (entities) => {
    const stage = new Container()
    stage.label = 'elements'
    s.viewport.addChild(stage)

    const length = 0.4 // original lenght = 1
    const tickness = 0.1 // original thickness = 0.2

    // Half-side of the (invisible) square hit target around each cross. A touch
    // larger than the cross arm so the click zone is comfortable but doesn't
    // overlap neighbouring articles.
    const hitRadius = 0.7

    // All crosses are inert (interaction lives on the invisible hit targets
    // below), so batch them into one Graphics rather than ~2 per article. Each
    // stroke() commits the path built since the previous commit, keeping the
    // per-article color.
    const crosses = new Graphics()
    // Labelled (unlike other purely-internal children here) so Point Gradient
    // mode-switching and the export pipeline can address the cross visual
    // independently of the shared hits/labels this stage also carries — see
    // pointGradient.js and controls.js's mode-gating.
    crosses.label = 'elements-crosses'
    stage.addChild(crosses)

    // Per-cross text labels, one container per attribute. They're mutually
    // exclusive (only one fits beside a cross), enforced by the Articles switch
    // group in controls.js. Each is off by default and built lazily — with 9k
    // articles, eagerly creating a BitmapText for every mode would be wasteful,
    // so a mode's labels are only materialised the first time it's switched on.
    // Non-interactive: the click target is the cross area, not the label.
    // Cluster-level context (this label shows the shared cluster vocabulary
    // beside each of its member articles, not that article's own keywords).
    const topKeywords = (value, n) => parseKeywords(value).slice(0, n).join(', ')

    const labelModes = [
        { key: 'elements-years', text: (e) => e.year },
        { key: 'elements-titles', text: (e) => pickField(e, 'title') },
        {
            key: 'elements-keywords',
            text: (e) => topKeywords(pickField(e, 'top_keywords'), 3),
        },
    ]

    // Which of an entity's coordinate sets to read — mirrors pointGradient.js's
    // own layoutMode (the global Grid Layout/Collision Free toggles) selection
    // exactly. gridX/gridY/collisionX/collisionY are copied onto each entity by
    // pointGradient.js once layouts.js has computed them.
    let layoutMode = 'network'
    const targetFor = (e) => {
        if (layoutMode === 'grid') return [e.gridX, e.gridY]
        if (layoutMode === 'collision') return [e.collisionX, e.collisionY]
        return [e.x, e.y]
    }

    const layers = labelModes.map((mode) => {
        const layer = new Container()
        layer.label = mode.key
        layer.visible = false
        let built = false
        const items = []
        // Called by controls.js before the layer is first shown.
        layer.build = () => {
            if (built) return
            built = true
            entities.forEach((e) => {
                const text = mode.text(e)
                if (!text) return
                const bitmap = new BitmapText({
                    text,
                    style: { fontFamily: 'Lato', fontSize: 1, align: 'left' },
                })
                bitmap.tint = Number(e.color)
                const [x, y] = targetFor(e)
                bitmap.position.set(x + 0.3, y + 0.1)
                layer.addChild(bitmap)
                items.push({ bitmap, entity: e, year: parseInt(e.year, 10) })
            })
            applyYearRange() // in case this layer is built after the range was already narrowed
        }
        stage.addChild(layer)
        return items
    })

    // Kept in sync by controls.js calling setYearRange() below — defaults open
    // so a layer built before controls.js ever runs (shouldn't happen, but see
    // applyYears() calling it once during initial setup) doesn't hide
    // everything by mistake.
    let currentRange = [-Infinity, Infinity]
    const applyYearRange = () => {
        const [startYear, endYear] = currentRange
        layers.forEach((items) => {
            items.forEach(({ bitmap, year }) => {
                bitmap.visible = year >= startYear && year <= endYear
            })
        })
    }

    // Called by controls.js whenever the Years range changes — shows only the
    // labels (Year/Title/Keywords) whose article falls in [startYear, endYear],
    // matching the Point Gradient circles' own year filtering.
    const setYearRange = (startYear, endYear) => {
        currentRange = [startYear, endYear]
        applyYearRange()
    }

    // Repositions every already-built label to its current targetFor() —
    // used when the *global* layout changes, since every label's target may
    // change at once.
    const repositionAll = () => {
        layers.forEach((items) => {
            items.forEach(({ bitmap, entity }) => {
                const [x, y] = targetFor(entity)
                bitmap.position.set(x + 0.3, y + 0.1)
            })
        })
    }

    // Called by controls.js whenever the Grid Layout/Collision Free toggles
    // change.
    const setLayout = (mode) => {
        layoutMode = mode
        repositionAll()
    }

    // Invisible per-article hit targets, centred on each cross. Kept in their
    // own container above the crosses/labels so selection works whether or not
    // any label mode is shown.
    const hits = new Container()
    hits.label = 'elements-hits'
    stage.addChild(hits)

    entities.forEach((e) => {
        // Cross

        const color = Number(e.color)

        crosses.moveTo(e.x, e.y - length).lineTo(e.x, e.y + length)
        crosses.moveTo(e.x - length, e.y).lineTo(e.x + length, e.y)
        crosses.stroke({ width: tickness, color })

        // Interaction — an empty container carrying only a hitArea square
        // around the cross. hitArea is in local coords, so centre it on origin
        // and position the container at the cross.

        const hit = new Container()
        hit.position.set(e.x, e.y)
        hit.hitArea = new Rectangle(-hitRadius, -hitRadius, hitRadius * 2, hitRadius * 2)
        hit.eventMode = 'static'
        hit.cursor = 'pointer'
        hit.on('pointertap', (event) => {
            // Stop the tap bubbling to the viewport, whose handler would
            // otherwise immediately deselect the report we just opened.
            event.stopPropagation()
            click(e)
        }) // On click
        hits.addChild(hit)
    })

    // Clicking empty map (anywhere the tap didn't hit an article) closes the
    // station report. The viewport is hittable everywhere — that's how panning
    // works — so its pointertap fires for background clicks.
    s.viewport.eventMode = 'static'
    s.viewport.on('pointertap', () => deselect())

    return { setLayout, setYearRange }
}
