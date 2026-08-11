// Layer switches — a small panel of toggles that show/hide each viewport
// layer by flipping its `.visible`. Call after all layers are rendered so they
// can be located by their `.label`. Some layers expose nested sub-switches
// (Clusters splits into independently toggleable Fills, Labels, and Fronts).
// The panel also holds the Visualization mode selector, Years time control,
// zoom, "Reset view", and A0 print-export controls.

import download from './download.js'

// Layers that exist only for the Isolines reading of the map (contour
// isolines, cluster pressure systems, fronts, and the density gradient
// background). Gated below so they force-hide in Point Gradient mode without
// losing their checkbox state — switching back to Isolines restores exactly
// what was checked.
const LAYERS = [
    {
        label: 'elements',
        name: 'Articles',
        // Per-cross labels are mutually exclusive — only one fits beside a
        // cross, so activating one deactivates the rest.
        exclusive: true,
        children: [
            { label: 'elements-years', name: 'Year' },
            { label: 'elements-titles', name: 'Title' },
            { label: 'elements-keywords', name: 'Keywords' },
        ],
    },
    {
        label: 'clusters',
        name: 'Clusters',
        isolinesOnly: true,
        children: [
            // Fills/Labels are nested Pixi children of 'clusters', so hiding the
            // parent already hides them — they're flagged too only so their own
            // switches dim in step with it instead of staying fully interactive
            // for a layer that's actually inert.
            { label: 'clusters-fills', name: 'Fills', isolinesOnly: true },
            { label: 'clusters-labels', name: 'Labels', isolinesOnly: true },
            // Front curves only — off by default; combine with Labels (and no
            // Fills) to read the fronts and their topic labels alone. A
            // separate top-level viewport child (not nested under Clusters),
            // so it needs its own gate, not just the parent's.
            { label: 'fronts', name: 'Fronts', isolinesOnly: true },
        ],
    },
    {
        label: 'contours',
        name: 'Contours',
        isolinesOnly: true,
        // Visually nested under Contours for the panel's visual hierarchy only —
        // gradient-fill is its own top-level viewport child (see gradientFill.js),
        // not a Pixi child of the contours stage, so the two switches are wired
        // fully independently: findByLabel below searches the whole viewport
        // tree, it doesn't require literal scene-graph nesting.
        children: [{ label: 'gradient-fill', name: 'Gradient Fill', isolinesOnly: true }],
    },
]

// Depth-first search for a labelled display object (sub-switches live nested
// inside their parent layer, not directly on the viewport).
const findByLabel = (node, label) => {
    if (node.label === label) return node
    for (const child of node.children ?? []) {
        const found = findByLabel(child, label)
        if (found) return found
    }
    return null
}

const makeSwitch = (layer, name, sub, isolinesOnly) => {
    const row = document.createElement('label')
    row.className = sub ? 'switch sub' : 'switch'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = layer.visible
    input.addEventListener('change', () => {
        // Materialise the layer's content on first activation (lazy label build).
        if (input.checked) layer.build?.()
        layer.visible = input.checked
    })

    const slider = document.createElement('span')
    slider.className = 'slider'

    const text = document.createElement('span')
    text.className = 'switch-label'
    text.textContent = name

    row.append(input, slider, text)
    return { row, input, layer, isolinesOnly }
}

export default (pointGradient) => {
    const panel = document.createElement('div')
    panel.id = 'controls'

    // ---- Visualization mode --------------------------------------------------
    // Isolines is the existing weather-chart reading; Point Gradient is the new
    // halftone reading. Switching modes never touches the viewport (zoom/pan),
    // selection, or search — only layer visibility.
    let mode = 'isolines'

    const visSection = document.createElement('p')
    visSection.className = 'eyebrow'
    visSection.textContent = 'Visualization'
    panel.appendChild(visSection)

    const modeGroup = document.createElement('div')
    modeGroup.className = 'segmented'
    modeGroup.setAttribute('role', 'group')
    modeGroup.setAttribute('aria-label', 'Visualization')
    panel.appendChild(modeGroup)

    const modeButtons = [
        { value: 'isolines', label: 'Isolines' },
        { value: 'point-gradient', label: 'Point Gradient' },
    ].map(({ value, label }) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'segmented-btn'
        b.textContent = label
        b.setAttribute('aria-pressed', String(value === mode))
        b.addEventListener('click', () => setMode(value))
        modeGroup.appendChild(b)
        return { value, button: b }
    })

    // ---- Layers ----------------------------------------------------------------

    const heading = document.createElement('p')
    heading.className = 'eyebrow'
    heading.textContent = 'Layers'
    panel.appendChild(heading)

    // Every switch created below (gated or not), so mode changes can recompute
    // gated layers' effective visibility in one pass.
    const allSwitches = []
    let articlesSwitch = null

    LAYERS.forEach(({ label, name, children, exclusive, isolinesOnly }) => {
        const layer = findByLabel(s.viewport, label)
        if (!layer) return
        const sw = makeSwitch(layer, name, false, isolinesOnly)
        allSwitches.push(sw)
        if (label === 'elements') articlesSwitch = sw
        panel.appendChild(sw.row)

        const subs = []
        children?.forEach((sub) => {
            const subLayer = findByLabel(s.viewport, sub.label)
            if (!subLayer) return
            const subSw = makeSwitch(subLayer, sub.name, true, sub.isolinesOnly)
            allSwitches.push(subSw)
            panel.appendChild(subSw.row)
            subs.push(subSw)
        })

        // Exclusive group: turning one sub-switch on turns the siblings off
        // (their layers hide directly, since setting .checked doesn't fire a
        // change event). Turning the active one off again is still allowed.
        if (exclusive) {
            subs.forEach((sw2) => {
                sw2.input.addEventListener('change', () => {
                    if (!sw2.input.checked) return
                    subs.forEach((other) => {
                        if (other === sw2) return
                        other.input.checked = false
                        other.layer.visible = false
                    })
                })
            })
        }
    })

    // Isolines-only layers force-hide in Point Gradient mode without losing
    // their checkbox state (restored exactly when back in Isolines). When
    // mode is Isolines, this is a no-op — identical to the pre-existing
    // `layer.visible = input.checked` behavior.
    const refreshGatedVisibility = () => {
        const isolines = mode === 'isolines'
        allSwitches.forEach((sw) => {
            if (!sw.isolinesOnly) return
            sw.layer.visible = sw.input.checked && isolines
            sw.input.disabled = !isolines
            sw.row.classList.toggle('disabled', !isolines)
        })
    }
    allSwitches.forEach((sw) => {
        if (sw.isolinesOnly) sw.input.addEventListener('change', refreshGatedVisibility)
    })

    // Articles governs both readings of the same data: crosses (+ their fixed
    // hit targets) in Isolines, word-count circles (+ their own, size-matched
    // hit targets) in Point Gradient. The shared hits/labels container
    // ('elements') stays visible in both modes — only the visual + its hits
    // switch. `crossesLayer`/`hitsLayer` are found once; elements.js exposes
    // them only via their existing/added `.label`, nothing else changed there.
    const crossesLayer = findByLabel(s.viewport, 'elements-crosses')
    const hitsLayer = findByLabel(s.viewport, 'elements-hits')
    const refreshArticlesVisibility = () => {
        const articlesOn = articlesSwitch.input.checked
        const isolines = mode === 'isolines'
        if (crossesLayer) crossesLayer.visible = articlesOn && isolines
        if (hitsLayer) hitsLayer.visible = articlesOn && isolines
        pointGradient.root.visible = articlesOn && !isolines
    }
    articlesSwitch.input.addEventListener('change', refreshArticlesVisibility)

    // ---- Years (Point Gradient only) --------------------------------------------
    // Hidden entirely in Isolines mode — it has no equivalent there. State
    // persists for the app's lifetime once set: turning Years off/on, moving
    // between modes, or touching any other control never resets it.
    const [earliestYear, latestYear] = pointGradient.yearExtent
    const yearsState = { enabled: false, windowMode: 'all', windowStart: earliestYear }

    const yearsSection = document.createElement('div')
    yearsSection.id = 'years-panel'

    const yearsHeading = document.createElement('p')
    yearsHeading.className = 'eyebrow'
    yearsHeading.textContent = 'Years'
    yearsSection.appendChild(yearsHeading)

    const yearsRow = document.createElement('label')
    yearsRow.className = 'switch'
    const yearsInput = document.createElement('input')
    yearsInput.type = 'checkbox'
    yearsInput.checked = yearsState.enabled
    const yearsSlider = document.createElement('span')
    yearsSlider.className = 'slider'
    const yearsLabel = document.createElement('span')
    yearsLabel.className = 'switch-label'
    yearsLabel.textContent = 'Colour by year'
    yearsRow.append(yearsInput, yearsSlider, yearsLabel)
    yearsSection.appendChild(yearsRow)

    const timeGroup = document.createElement('div')
    timeGroup.className = 'segmented'
    timeGroup.setAttribute('role', 'group')
    timeGroup.setAttribute('aria-label', 'Years time range')
    yearsSection.appendChild(timeGroup)

    const timeButtons = [
        { value: 'all', label: 'All' },
        { value: 'window', label: '3-year window' },
    ].map(({ value, label }) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'segmented-btn'
        b.textContent = label
        b.setAttribute('aria-pressed', String(value === yearsState.windowMode))
        b.addEventListener('click', () => {
            yearsState.windowMode = value
            applyYears()
        })
        timeGroup.appendChild(b)
        return { value, button: b }
    })

    const rangeRow = document.createElement('div')
    rangeRow.className = 'range-row'
    const rangeValue = document.createElement('div')
    rangeValue.className = 'range-value'
    const rangeInput = document.createElement('input')
    rangeInput.type = 'range'
    rangeInput.min = String(earliestYear)
    rangeInput.max = String(Math.max(earliestYear, latestYear - 2))
    rangeInput.step = '1'
    rangeInput.value = String(yearsState.windowStart)
    rangeInput.setAttribute('aria-label', 'Three-year window start')
    rangeRow.append(rangeValue, rangeInput)
    yearsSection.appendChild(rangeRow)

    rangeInput.addEventListener('input', () => {
        yearsState.windowStart = parseInt(rangeInput.value, 10)
        applyYears()
    })

    // Single source of truth for the Years UI: recomputes the range label,
    // shows/hides the slider, redraws the circle field, and mirrors state onto
    // `s.visualization` for the export pipeline to read.
    function applyYears() {
        yearsInput.checked = yearsState.enabled
        timeButtons.forEach(({ value, button }) =>
            button.setAttribute('aria-pressed', String(value === yearsState.windowMode)),
        )
        rangeInput.value = String(yearsState.windowStart)
        rangeRow.style.display =
            yearsState.enabled && yearsState.windowMode === 'window' ? '' : 'none'
        timeGroup.style.display = yearsState.enabled ? '' : 'none'
        rangeValue.textContent = `${yearsState.windowStart}–${yearsState.windowStart + 2}`

        const windowRange =
            yearsState.enabled && yearsState.windowMode === 'window'
                ? [yearsState.windowStart, yearsState.windowStart + 2]
                : null
        pointGradient.redraw(yearsState.enabled ? 'on' : 'off', windowRange)

        s.visualization.years = { ...yearsState }
    }

    yearsInput.addEventListener('change', () => {
        yearsState.enabled = yearsInput.checked
        applyYears()
    })

    panel.appendChild(yearsSection)

    // ---- Mode switching ----------------------------------------------------------

    const stationsIsolines = document.getElementById('stations-isolines')
    const stationsPointGradient = document.getElementById('stations-point-gradient')

    function setMode(newMode) {
        if (newMode === mode) return
        mode = newMode
        modeButtons.forEach(({ value, button }) =>
            button.setAttribute('aria-pressed', String(value === mode)),
        )
        refreshGatedVisibility()
        refreshArticlesVisibility()
        yearsSection.style.display = mode === 'point-gradient' ? '' : 'none'
        if (stationsIsolines) stationsIsolines.hidden = mode !== 'isolines'
        if (stationsPointGradient) stationsPointGradient.hidden = mode === 'isolines'
        s.visualization.mode = mode
        s.app.render()
    }

    // Shared state read by the export pipeline (download.js) — kept in sync by
    // setMode()/applyYears() above, never replaced wholesale so both always
    // see the live values.
    s.visualization = { mode, years: { ...yearsState } }

    // Establish the consistent initial state (Point Gradient hidden, Isolines
    // layers exactly as their checkboxes say, Years panel hidden).
    refreshGatedVisibility()
    refreshArticlesVisibility()
    yearsSection.style.display = 'none'
    applyYears()

    // View controls. Snapshot the initial camera now (before any user
    // interaction) so Reset can jump back to it. Reset directly (not via the
    // animate plugin) since this app renders on demand rather than per-frame.
    const home = { scale: s.viewport.scale.x, x: s.viewport.center.x, y: s.viewport.center.y }
    const zoomBy = (factor) => {
        s.viewport.setZoom(s.viewport.scale.x * factor, true) // clampZoom bounds it
        s.app.render()
    }

    const button = (text, className, aria, onClick) => {
        const b = document.createElement('button')
        b.textContent = text
        b.className = className
        if (aria) b.setAttribute('aria-label', aria)
        b.addEventListener('click', onClick)
        return b
    }

    const section = document.createElement('p')
    section.className = 'section'
    section.textContent = 'View'
    panel.appendChild(section)

    const row = document.createElement('div')
    row.className = 'view-controls'
    row.append(
        button('–', 'zoom-btn', 'Zoom out', () => zoomBy(1 / 1.4)),
        button('Reset', 'reset-btn', null, () => {
            s.viewport.setZoom(home.scale, true)
            s.viewport.moveCenter(home.x, home.y)
            s.app.render()
        }),
        button('+', 'zoom-btn', 'Zoom in', () => zoomBy(1.4)),
    )
    panel.appendChild(row)

    // Export — rasterises the current view into a high-resolution A0-landscape
    // PDF for printing. It runs on the GPU and can take a second, so the button
    // shows progress and re-enables itself when done (or on failure).
    const exportSection = document.createElement('p')
    exportSection.className = 'section'
    exportSection.textContent = 'Export'
    panel.appendChild(exportSection)

    const dl = button('Download A0 PDF', 'download-btn', null, async () => {
        const original = dl.textContent
        dl.disabled = true
        dl.textContent = 'Preparing…'
        try {
            await download()
            dl.textContent = original
        } catch (err) {
            console.error('A0 PDF export failed', err)
            dl.textContent = 'Export failed'
            setTimeout(() => (dl.textContent = original), 2500)
        } finally {
            dl.disabled = false
        }
    })
    panel.appendChild(dl)

    document.body.appendChild(panel)
}
