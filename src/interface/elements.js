import { BitmapText, Container, Graphics, Rectangle } from 'pixi.js'

import { click, deselect } from './click'

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
    const topKeywords = (list, n) =>
        (list || '')
            .replace(/[[\]']/g, '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, n)
            .join(', ')

    const labelModes = [
        { key: 'elements-years', text: (e) => e.year },
        { key: 'elements-titles', text: (e) => e.title_en || e.title },
        {
            key: 'elements-keywords',
            text: (e) => topKeywords(e.top_keywords_en || e.top_keywords, 3),
        },
    ]

    // Which of an entity's coordinate sets to read — mirrors pointGradient.js's
    // own layoutMode (the global Grid Layout/Collision Free toggles) and
    // activeClusterIds (hover, via clusterHover.js — the directly-hovered
    // cluster plus its precomputed nearby clusters, only meaningful while
    // layoutMode is 'network') selection exactly. gridX/gridY/collisionX/
    // collisionY are copied onto each entity by pointGradient.js once
    // layouts.js has computed them.
    let layoutMode = 'network'
    let activeClusterIds = new Set()
    const targetFor = (e) => {
        if (layoutMode === 'grid') return [e.gridX, e.gridY]
        if (layoutMode === 'collision') return [e.collisionX, e.collisionY]
        return layoutMode === 'network' && activeClusterIds.has(e.cluster)
            ? [e.gridX, e.gridY]
            : [e.x, e.y]
    }

    const layers = labelModes.map((mode) => {
        const layer = new Container()
        layer.label = mode.key
        layer.visible = false
        let built = false
        // Built lazily (first activation) at whatever cluster is currently
        // active, so a label mode switched on while a cluster is already
        // expanded starts in the right place rather than always on the
        // network position. `items` keeps the entity each bitmap belongs to,
        // so setActiveCluster() below can move already-built labels without
        // rebuilding.
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
                    style: { fontFamily: 'Lato', fontSize: 0.7, align: 'left' },
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

    // Kept in sync by controls.js calling setYearRange() below, same pattern
    // as activeClusterIds above — defaults open so a layer built before
    // controls.js ever runs (shouldn't happen, but see applyYears() calling
    // it once during initial setup) doesn't hide everything by mistake.
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
    // change at once (unlike hover, which only ever touches two clusters).
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

    // Called by clusterHover.js on every activation change — `newActiveIds`
    // is the hovered cluster plus its precomputed nearby clusters (see
    // clusters.js's neighborsByClusterId), already expanded by
    // clusterHover.js. Moves only the previously-active and newly-active
    // clusters' already-built labels (Year/Title/Keywords) to match their
    // circle, exactly mirroring pointGradient.js's own scoping so unrelated
    // clusters' labels are never touched. Labels snap directly to their new
    // target rather than animating alongside the circle's tween — a
    // deliberate, smaller-scope choice; see the completion report.
    const setActiveCluster = (newActiveIds) => {
        const previousIds = activeClusterIds
        activeClusterIds = newActiveIds
        if (layoutMode !== 'network') return // no visual effect while a global mode is active — see clusterHover.js's setEnabled
        layers.forEach((items) => {
            items.forEach(({ bitmap, entity }) => {
                if (!previousIds.has(entity.cluster) && !newActiveIds.has(entity.cluster)) return
                const [x, y] = targetFor(entity)
                bitmap.position.set(x + 0.3, y + 0.1)
            })
        })
    }

    // Invisible per-article hit targets, centred on each cross. Kept in their
    // own container above the crosses/labels so selection works whether or not
    // any label mode is shown.
    const hits = new Container()
    hits.label = 'elements-hits'
    stage.addChild(hits)

    // One hit Container per article, built once (position/hitArea never
    // change — only its .visible, when the year range moves).
    const hitList = entities.map((e) => {
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
        return { hit, year: parseInt(e.year, 10) }
    })

    // Rebuilds the visible cross field for a year range [startYear, endYear]
    // (inclusive) — called by controls.js when the shared Years range control
    // moves. Crosses always keep their existing per-article colour (Isolines
    // has no "off" colour state); only which articles are drawn/clickable
    // changes. Stashed on `crosses` (the labelled object controls.js can find),
    // mirroring the `layer.build` convention above rather than changing this
    // module's return signature.
    crosses.redrawByRange = (startYear, endYear) => {
        crosses.clear()
        for (let i = 0; i < entities.length; i++) {
            const e = entities[i]
            const inRange = hitList[i].year >= startYear && hitList[i].year <= endYear
            hitList[i].hit.visible = inRange
            if (!inRange) continue
            const color = Number(e.color)
            crosses.moveTo(e.x, e.y - length).lineTo(e.x, e.y + length)
            crosses.moveTo(e.x - length, e.y).lineTo(e.x + length, e.y)
            crosses.stroke({ width: tickness, color })
        }
    }

    // Initial draw: every article, exactly matching the pre-existing
    // unconditional behavior (no range control has ever narrowed this yet).
    const initialYears = entities.map((e) => parseInt(e.year, 10))
    crosses.redrawByRange(Math.min(...initialYears), Math.max(...initialYears))

    // Clicking empty map (anywhere the tap didn't hit an article) closes the
    // station report. The viewport is hittable everywhere — that's how panning
    // works — so its pointertap fires for background clicks.
    s.viewport.eventMode = 'static'
    s.viewport.on('pointertap', () => deselect())

    return { setLayout, setActiveCluster, setYearRange }
}
