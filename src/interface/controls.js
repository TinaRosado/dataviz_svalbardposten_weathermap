// Layer switches — a small panel of toggles that show/hide each viewport
// layer by flipping its `.visible`. Call after all layers are rendered so they
// can be located by their `.label`. Some layers expose nested sub-switches
// (Clusters splits into independently toggleable Fills, Labels, and Fronts).
// The panel also holds the Visualization mode selector, Years time control,
// zoom, "Reset view", and A0 print-export controls.

import download from './download.js'

// Every layer below is available in both visualization modes — in Point
// Gradient, Contours/Clusters/Fronts/Gradient Fill render as a pressure/
// isoline/front/density reading alongside the circles (see the render order
// in index.js). None are currently flagged `isolinesOnly`, but the gating
// mechanism (see refreshGatedVisibility below) stays in place in case a
// layer needs to be restricted to Isolines again later.
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
        children: [
            { label: 'clusters-fills', name: 'Fills' },
            { label: 'clusters-labels', name: 'Labels' },
            // Front curves only — off by default; combine with Labels (and no
            // Fills) to read the fronts and their topic labels alone.
            { label: 'fronts', name: 'Fronts' },
        ],
    },
    {
        label: 'contours',
        name: 'Contours',
        // Visually nested under Contours for the panel's visual hierarchy only —
        // gradient-fill is its own top-level viewport child (see gradientFill.js),
        // not a Pixi child of the contours stage, so the two switches are wired
        // fully independently: findByLabel below searches the whole viewport
        // tree, it doesn't require literal scene-graph nesting.
        children: [{ label: 'gradient-fill', name: 'Gradient Fill' }],
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

    // ---- Years ------------------------------------------------------------------
    // Available in both modes. One authoritative range [startYear, endYear]
    // drives the presets, slider, histogram, range label, article filtering
    // (both the Point Gradient circles and, via `crossesLayer.redrawByRange`,
    // the Isolines crosses) and the export pipeline. State persists for the
    // app's lifetime: turning "Colour by year" off/on, moving between modes,
    // or touching any other control never resets it.
    const [earliestYear, latestYear] = pointGradient.yearExtent
    const yearsState = { colorByYear: false, startYear: earliestYear, endYear: latestYear }

    // PixiJS tint (0xRRGGBB) → CSS hex — small local copy, same as download.js's.
    const tintHex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6)

    // Per-year article count + color, from the same complete dataset the map
    // renders (pointGradient.points already carries one entry per article).
    // Color is confirmed 1:1 with year in this dataset, so any member's color
    // stands for the whole year.
    const yearCounts = new Map()
    const yearColors = new Map()
    for (const p of pointGradient.points) {
        yearCounts.set(p.year, (yearCounts.get(p.year) || 0) + 1)
        if (!yearColors.has(p.year)) yearColors.set(p.year, tintHex(p.color))
    }
    const totalSpan = latestYear - earliestYear + 1
    const maxYearCount = Math.max(...yearCounts.values())

    // Closest valid range of `width` years centered on the timeline. For an
    // odd total span and odd width this lands exactly centered; otherwise
    // it's the nearest integer-year approximation, applied consistently.
    const centeredRange = (width) => {
        const start = earliestYear + Math.floor((totalSpan - width) / 2)
        return [start, start + width - 1]
    }
    const oneYearRange = centeredRange(1)
    const fiveYearRange = centeredRange(5)

    // Derives which preset (if any) the current [startYear, endYear] matches.
    // Pure function of the range — never stored separately, so it can never
    // drift out of sync with a manually resized range.
    const activePreset = (startYear, endYear) => {
        if (startYear === earliestYear && endYear === latestYear) return 'all'
        if (startYear === oneYearRange[0] && endYear === oneYearRange[1]) return '1year'
        if (startYear === fiveYearRange[0] && endYear === fiveYearRange[1]) return '5years'
        return null
    }

    const yearsSection = document.createElement('div')
    yearsSection.id = 'years-panel'

    const yearsHeading = document.createElement('p')
    yearsHeading.className = 'eyebrow'
    yearsHeading.textContent = 'Years'
    yearsSection.appendChild(yearsHeading)

    const colorRow = document.createElement('label')
    colorRow.className = 'switch'
    const colorInput = document.createElement('input')
    colorInput.type = 'checkbox'
    colorInput.checked = yearsState.colorByYear
    const colorSlider = document.createElement('span')
    colorSlider.className = 'slider'
    const colorLabel = document.createElement('span')
    colorLabel.className = 'switch-label'
    colorLabel.textContent = 'Colour by year'
    colorRow.append(colorInput, colorSlider, colorLabel)
    yearsSection.appendChild(colorRow)
    colorInput.addEventListener('change', () => {
        yearsState.colorByYear = colorInput.checked
        applyYears()
    })

    // Presets — the exact same toggle-switch component as Year/Title/Keywords
    // under Articles (checkbox + pill + label, indented `.sub`), wired as the
    // same kind of exclusive group: checking one unchecks the other two, and
    // (since a manually resized range can match none of them) all three can
    // be unchecked at once.
    const presetStack = document.createElement('div')
    presetStack.setAttribute('role', 'group')
    presetStack.setAttribute('aria-label', 'Year range presets')
    yearsSection.appendChild(presetStack)

    const presetButtons = [
        { value: 'all', label: 'All', range: [earliestYear, latestYear] },
        { value: '1year', label: '1 year', range: oneYearRange },
        { value: '5years', label: '5 years', range: fiveYearRange },
    ].map(({ value, label, range }) => {
        const row = document.createElement('label')
        row.className = 'switch sub'
        const input = document.createElement('input')
        input.type = 'checkbox'
        const slider = document.createElement('span')
        slider.className = 'slider'
        const text = document.createElement('span')
        text.className = 'switch-label'
        text.textContent = label
        row.append(input, slider, text)
        presetStack.appendChild(row)

        input.addEventListener('change', () => {
            if (!input.checked) return // unchecking directly does nothing; pick another preset or resize the slider
            yearsState.startYear = range[0]
            yearsState.endYear = range[1]
            applyYears()
        })
        return { value, input }
    })

    // Range label above the slider — a single year for a one-year selection,
    // both endpoints otherwise.
    const rangeLabel = document.createElement('div')
    rangeLabel.className = 'range-value'
    yearsSection.appendChild(rangeLabel)

    // Histogram — one bar per year in the complete timeline, height by
    // article count, colored by that year's existing map color. Purely a
    // selection overview: the slider below is the actual control.
    const histogram = document.createElement('div')
    histogram.className = 'histogram'
    yearsSection.appendChild(histogram)

    const bars = []
    for (let year = earliestYear; year <= latestYear; year++) {
        const count = yearCounts.get(year) || 0
        const bar = document.createElement('div')
        bar.className = 'histogram-bar'
        const i = year - earliestYear
        bar.style.left = `${(i / totalSpan) * 100}%`
        bar.style.width = `calc(${(1 / totalSpan) * 100}% - 1px)`
        bar.style.height = `${maxYearCount ? Math.max(6, (count / maxYearCount) * 100) : 6}%`
        bar.style.background = yearColors.get(year) || 'var(--muted)'
        bar.title = `${year}: ${count} article${count === 1 ? '' : 's'}`
        bar.setAttribute('role', 'img')
        bar.setAttribute('aria-label', `${year}: ${count} article${count === 1 ? '' : 's'}`)
        histogram.appendChild(bar)
        bars.push({ el: bar, year })
    }

    // Two overlaid native range inputs sharing one track — gives keyboard
    // (arrow keys step by 1 year), touch, and screen-reader value exposure for
    // free, rather than hand-rolling a custom ARIA slider. A plain div behind
    // them draws the visible track + selected-range fill.
    const sliderBox = document.createElement('div')
    sliderBox.className = 'dual-slider'
    yearsSection.appendChild(sliderBox)

    const track = document.createElement('div')
    track.className = 'dual-slider-track'
    const fill = document.createElement('div') // the pill graphic, sized to the selected range
    fill.className = 'dual-slider-fill'
    sliderBox.append(track, fill)

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

    // The native inputs below are kept for keyboard (arrow keys, Tab focus)
    // and screen-reader value exposure only — see the drag layer beneath for
    // why mouse/touch never reaches them directly.
    const makeRangeInput = (ariaLabel) => {
        const input = document.createElement('input')
        input.type = 'range'
        input.className = 'dual-slider-input'
        input.min = String(earliestYear)
        input.max = String(latestYear)
        input.step = '1'
        input.setAttribute('aria-label', ariaLabel)
        sliderBox.appendChild(input)
        return input
    }
    const startInput = makeRangeInput('Start year')
    const endInput = makeRangeInput('End year')

    startInput.addEventListener('input', () => {
        const value = Math.min(parseInt(startInput.value, 10), yearsState.endYear)
        yearsState.startYear = value
        applyYears()
    })
    endInput.addEventListener('input', () => {
        const value = Math.max(parseInt(endInput.value, 10), yearsState.startYear)
        yearsState.endYear = value
        applyYears()
    })

    // Mouse/touch dragging is handled entirely here, on one overlay spanning
    // the whole track, rather than by the native inputs' own thumbs. Two
    // overlapping native thumbs can't be told apart by the browser once they
    // coincide (a one-year selection) — any click there always resolves to
    // whichever input's real thumb happens to be on top, which can only
    // resize that one endpoint, never slide the window. Deciding intent
    // ourselves from click position removes that ambiguity, and works the
    // same way regardless of how narrow the selection is.
    const dragLayer = document.createElement('div')
    dragLayer.className = 'dual-slider-drag-layer'
    sliderBox.appendChild(dragLayer)

    const HANDLE_GRAB_PX = 6 // proximity (either side) that counts as "grabbing" an endpoint
    const yearToClientX = (year) => {
        const rect = track.getBoundingClientRect()
        return rect.left + ((year - earliestYear) / totalSpan) * rect.width
    }

    let drag = null // { pointerX, startYear, endYear, mode: 'start' | 'end' | 'window' }

    dragLayer.addEventListener('pointerdown', (event) => {
        const distStart = Math.abs(event.clientX - yearToClientX(yearsState.startYear))
        const distEnd = Math.abs(event.clientX - yearToClientX(yearsState.endYear))
        // A fixed grab margin at both ends works fine for a wide window, but
        // for a narrow one (e.g. 2-3 years, maybe 10-25px apart on screen) it
        // can eat the whole window, leaving no room to ever land in "slide
        // the window". Capping it at a small fraction of the window's own
        // on-screen width keeps the middle (slide) zone dominant even at
        // narrow widths — sliding a short window is the far more common need
        // than resizing it by a pixel or two, which is still always exact via
        // the keyboard regardless of how little screen space it has.
        const windowPx = yearToClientX(yearsState.endYear) - yearToClientX(yearsState.startYear)
        const margin = Math.min(HANDLE_GRAB_PX, windowPx * 0.15)

        // Anything not claimed by an edge is a slide, full stop — no separate
        // "is this literally inside the window" check. (An earlier version
        // compared *years* here — `clickYear > startYear && clickYear <
        // endYear` — which can never be true for a 2-year window, since no
        // integer sits strictly between two consecutive years. That silently
        // dropped every non-edge click on exactly a 2-year selection.)
        let mode
        if (yearsState.startYear === yearsState.endYear) {
            // A coincident (one-year) point: sliding it is the useful gesture
            // by mouse; widening from an exact point stays keyboard-only
            // (Tab to Start or End year, then an arrow key).
            mode = 'window'
        } else if (distStart <= margin && distStart <= distEnd) {
            mode = 'start'
        } else if (distEnd <= margin) {
            mode = 'end'
        } else {
            mode = 'window'
        }

        dragLayer.setPointerCapture(event.pointerId)
        dragLayer.classList.add('dragging')
        drag = {
            x: event.clientX,
            startYear: yearsState.startYear,
            endYear: yearsState.endYear,
            mode,
        }
    })

    dragLayer.addEventListener('pointermove', (event) => {
        if (!drag) return
        const rect = track.getBoundingClientRect()
        const deltaYears = Math.round(((event.clientX - drag.x) / rect.width) * totalSpan)

        if (drag.mode === 'start') {
            const value = clamp(drag.startYear + deltaYears, earliestYear, drag.endYear)
            if (value === yearsState.startYear) return
            yearsState.startYear = value
        } else if (drag.mode === 'end') {
            const value = clamp(drag.endYear + deltaYears, drag.startYear, latestYear)
            if (value === yearsState.endYear) return
            yearsState.endYear = value
        } else {
            const width = drag.endYear - drag.startYear
            const newStart = clamp(drag.startYear + deltaYears, earliestYear, latestYear - width)
            if (newStart === yearsState.startYear) return
            yearsState.startYear = newStart
            yearsState.endYear = newStart + width
        }
        applyYears()
    })

    const endDrag = () => {
        drag = null
        dragLayer.classList.remove('dragging')
    }
    dragLayer.addEventListener('pointerup', endDrag)
    dragLayer.addEventListener('pointercancel', endDrag)

    const rangeCount = document.createElement('div')
    rangeCount.className = 'range-count'
    yearsSection.appendChild(rangeCount)

    // Single source of truth for the Years UI: recomputes every dependent
    // display (presets, slider positions, range label, histogram emphasis,
    // count), redraws both the Point Gradient circles and the Isolines
    // crosses for the current range, and mirrors state onto `s.visualization`
    // for the export pipeline to read.
    function applyYears() {
        const { startYear, endYear, colorByYear } = yearsState

        startInput.value = String(startYear)
        endInput.value = String(endYear)

        const preset = activePreset(startYear, endYear)
        presetButtons.forEach(({ value, input }) => (input.checked = value === preset))

        rangeLabel.textContent = startYear === endYear ? `${startYear}` : `${startYear}–${endYear}`

        const startPct = ((startYear - earliestYear) / totalSpan) * 100
        const endPct = ((endYear + 1 - earliestYear) / totalSpan) * 100
        fill.style.left = `${startPct}%`
        fill.style.width = `${Math.max(endPct - startPct, 0)}%`

        let count = 0
        bars.forEach(({ el, year }) => {
            const inRange = year >= startYear && year <= endYear
            el.classList.toggle('is-out', !inRange)
            if (inRange) count += yearCounts.get(year) || 0
        })
        rangeCount.textContent = `${count.toLocaleString()} article${count === 1 ? '' : 's'}`

        pointGradient.redraw(colorByYear ? 'on' : 'off', [startYear, endYear])
        crossesLayer?.redrawByRange?.(startYear, endYear)

        s.visualization.years = { ...yearsState }
        s.app.render()
    }

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
    // layers exactly as their checkboxes say, Years range defaulted to All).
    refreshGatedVisibility()
    refreshArticlesVisibility()
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
