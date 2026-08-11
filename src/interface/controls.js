// Layer switches — a small panel of toggles that show/hide each viewport
// layer by flipping its `.visible`. Call after all layers are rendered so they
// can be located by their `.label`. Some layers expose nested sub-switches
// (Clusters splits into independently toggleable Fills, Labels, and Fronts).
// The panel also holds zoom, "Reset view", and A0 print-export controls.

import download from './download.js'

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

const makeSwitch = (layer, name, sub) => {
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
    return { row, input, layer }
}

export default () => {
    const panel = document.createElement('div')
    panel.id = 'controls'

    const heading = document.createElement('p')
    heading.className = 'eyebrow'
    heading.textContent = 'Layers'
    panel.appendChild(heading)

    LAYERS.forEach(({ label, name, children, exclusive }) => {
        const layer = findByLabel(s.viewport, label)
        if (!layer) return
        panel.appendChild(makeSwitch(layer, name, false).row)

        const subs = []
        children?.forEach((sub) => {
            const subLayer = findByLabel(s.viewport, sub.label)
            if (!subLayer) return
            const sw = makeSwitch(subLayer, sub.name, true)
            panel.appendChild(sw.row)
            subs.push(sw)
        })

        // Exclusive group: turning one sub-switch on turns the siblings off
        // (their layers hide directly, since setting .checked doesn't fire a
        // change event). Turning the active one off again is still allowed.
        if (exclusive) {
            subs.forEach((sw) => {
                sw.input.addEventListener('change', () => {
                    if (!sw.input.checked) return
                    subs.forEach((other) => {
                        if (other === sw) return
                        other.input.checked = false
                        other.layer.visible = false
                    })
                })
            })
        }
    })

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
