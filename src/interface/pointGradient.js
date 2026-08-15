import { Container, Graphics, Rectangle } from 'pixi.js'

import { click } from './click.js'
import { showTooltip, hideTooltip } from './tooltip.js'
import { assignGridLayout, assignCollisionFreeLayout } from './layouts.js'

// Point Gradient — a halftone-style alternative to the cross/Isolines reading
// of the same articles: one filled circle per article, at its existing x/y,
// sized by word count. Entirely additive: this module never touches
// contours/clusters/fronts, and only reads (never mutates) the shared
// `entities` array.

// ---- Circle-size tuning ------------------------------------------------------
// Area-based mapping from word count to circle radius. From public/entities.csv
// (the complete, already-filtered article set): word_count ranges 5–3183,
// median 341, p95 898 — most articles sit well below the cap, with a long tail
// of a few very long ones that would otherwise dwarf everything else.
//
// The encoding is area, not radius: normalised word count `t` (0–1, after the
// percentile cap) first passes through a bounded power curve to get an *area*
// fraction, then that area is converted back to a radius with a square root.
// A plain t^0.5 applied straight to radius (the first pass at this) grows too
// fast for short/medium articles — by the median (t≈0.38) it already reaches
// ~66% of the max radius, so most circles read as "medium-to-large" and the
// field looks uniform. Squaring `t` first (AREA_CURVE_EXPONENT = 2) pushes
// that same median down to ~40% of the max radius while still bounding the
// longest articles at MAX_RADIUS — short articles now read as small points,
// long articles stay prominent, and the middle of the distribution keeps
// visible steps between short/medium/long instead of bunching near the top.
const MIN_RADIUS = 0.22 // shortest articles — small but still a visible, clickable point
const MAX_RADIUS = 2.4 // longest (post-cap) articles — capped so they don't dominate the field
const CAP_PERCENTILE = 0.95 // upper-domain cap; word counts beyond this clamp to MAX_RADIUS (kept — still a standard robust-statistics choice, unrelated to the curve shape)
const AREA_CURVE_EXPONENT = 2 // applied to the normalised word-count fraction *before* converting to radius, so it shapes area, not radius directly; 1 = linear area (old sqrt-radius behavior), >1 compresses short/medium articles further toward MIN_RADIUS
const HIT_PADDING = 0.15 // extra click-target margin beyond each circle's own radius
const MIN_HIT_HALF = 0.7 // matches elements.js's existing cross hitRadius — the interaction floor for small circles
export const CIRCLE_FILL_OPACITY = 0.65 // circle fill alpha only — lets overlapping articles accumulate visually instead of instantly flattening into one opaque blob

// Highlight ring — a stroked ring (no fill, so the circle underneath stays
// visible) drawn around whichever single article is currently hovered or
// selected (clicked — see refreshHighlight below), in that article's own
// year-color at full opacity (unlike CIRCLE_FILL_OPACITY, deliberately — the
// highlight should read as a clear, solid indicator, not blend into the
// field of overlapping fills).
const HIGHLIGHT_RING_MARGIN = 0.35 // extra radius beyond the circle's own r
const HIGHLIGHT_RING_WIDTH = 0.3

// ---- Layout-transition tuning ------------------------------------------------
export const TRANSITION_MS = 800
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export default (entities) => {
    const wordCounts = entities
        .map((e) => parseInt(e.word_count, 10))
        .filter(Number.isFinite)
        .sort((a, b) => a - b)

    const domainMin = wordCounts[0]
    const domainMax =
        wordCounts[
            Math.min(wordCounts.length - 1, Math.floor(CAP_PERCENTILE * (wordCounts.length - 1)))
        ]

    const minArea = MIN_RADIUS * MIN_RADIUS
    const maxArea = MAX_RADIUS * MAX_RADIUS

    // Computed once from the complete dataset; never recalculated when the
    // year range (or anything else) filters which points are drawn.
    const radiusFor = (wordCount) => {
        const t =
            domainMax === domainMin
                ? 1
                : clamp((wordCount - domainMin) / (domainMax - domainMin), 0, 1)
        const area = minArea + (maxArea - minArea) * Math.pow(t, AREA_CURVE_EXPONENT)
        return Math.sqrt(area)
    }

    let minYear = Infinity
    let maxYear = -Infinity

    // Three coordinate sets per article, computed once from the current
    // dataset and never mutated afterwards: `network` (the original UMAP
    // position), `grid`, and `collision` (see layouts.js — all fully derived
    // from these same points/entities, nothing hard-coded or persisted). A
    // fourth, mutable pair (`renderX`/`renderY`) is what's actually drawn —
    // it starts on the network position and is the thing setLayout() below
    // animates, so drawing/hit-testing never touches the three source sets.
    const points = entities.map((e) => {
        const year = parseInt(e.year, 10)
        if (year < minYear) minYear = year
        if (year > maxYear) maxYear = year
        const networkX = e.x
        const networkY = e.y
        return {
            networkX,
            networkY,
            gridX: networkX,
            gridY: networkY,
            collisionX: networkX,
            collisionY: networkY,
            renderX: networkX,
            renderY: networkY,
            r: radiusFor(parseInt(e.word_count, 10)),
            color: Number(e.color),
            year,
            entity: e,
        }
    })

    // Precompute both alternative layouts synchronously so the result is
    // stable and immediately exportable — no continuous simulation, no
    // recomputation on every toggle (see layouts.js for how each is derived).
    assignGridLayout(points, entities)
    assignCollisionFreeLayout(points, entities)

    // Also copied onto each entity (not just its point) so other modules keyed
    // by entity — elements.js's per-article Year/Title/Keywords labels — can
    // read the same coordinate sets without needing their own reference into
    // `points`.
    points.forEach((p) => {
        p.entity.gridX = p.gridX
        p.entity.gridY = p.gridY
        p.entity.collisionX = p.collisionX
        p.entity.collisionY = p.collisionY
    })

    const root = new Container()
    root.label = 'point-gradient'
    root.visible = false // controls.js sets this from the Articles checkbox; safe default until it runs
    s.viewport.addChild(root)

    const circles = new Graphics()
    root.addChild(circles)

    // Single reusable highlight ring, drawn above every circle. Two
    // independent reasons it can be showing, hover taking precedence since
    // it's the more immediate/temporary intent: `hoveredPoint` (cleared the
    // instant the pointer leaves) and `selectedPoint` — set on click, and
    // deliberately persistent, exactly like click.js's #focus station report:
    // it stays up after the pointer leaves, until either a different article
    // is clicked (replaces it) or the background is (clears it, alongside
    // #focus itself — see the viewport listener near the end of this module).
    const highlight = new Graphics()
    highlight.visible = false
    root.addChild(highlight)

    let hoveredPoint = null
    let selectedPoint = null

    // Re-evaluates which point (if any) should be showing the ring and
    // redraws it there — called both from the discrete hover/select
    // interactions below and from draw() itself, so the ring tracks a
    // selected/hovered point's live renderX/renderY through any in-progress
    // layout animation instead of freezing at its position when it was
    // (un)selected. Does not call s.app.render() itself — callers that aren't
    // already about to render (draw() is, via ensureAnimating()/redraw()) do
    // that themselves.
    const refreshHighlight = () => {
        const active = hoveredPoint || selectedPoint
        const [startYear, endYear] = lastRange
        if (!active || active.year < startYear || active.year > endYear) {
            highlight.visible = false
            return
        }
        highlight.clear()
        highlight
            .circle(active.renderX, active.renderY, active.r + HIGHLIGHT_RING_MARGIN)
            .stroke({ width: HIGHLIGHT_RING_WIDTH, color: active.color, alpha: 1 })
        highlight.visible = true
    }

    // Per-article hit targets, sized to each circle (never smaller than the
    // existing fixed hit box used elsewhere) so larger circles stay fully
    // clickable. hitArea size is fixed per point (depends only on r, which
    // never changes); position tracks renderX/renderY every draw. Also the
    // wiring point for the hover ring + tooltip (mouseover/mouseout) and the
    // persistent-selection ring (pointertap) above.
    const hits = new Container()
    root.addChild(hits)

    const hitList = points.map((p) => {
        const half = Math.max(MIN_HIT_HALF, p.r + HIT_PADDING)
        const hit = new Container()
        hit.position.set(p.renderX, p.renderY)
        hit.hitArea = new Rectangle(-half, -half, half * 2, half * 2)
        hit.eventMode = 'static'
        hit.cursor = 'pointer'
        hit.on('pointertap', (event) => {
            event.stopPropagation()
            selectedPoint = p
            refreshHighlight()
            s.app.render()
            click(p.entity)
        })
        // Deliberately 'mouseover'/'mouseout', not 'pointerover'/'pointerout' —
        // PixiJS only dispatches the mouse-named events for pointerType
        // 'mouse'/'pen' (see node_modules/pixi.js/lib/events/EventBoundary.js),
        // so touch never triggers a hover highlight/tooltip it could never
        // dismiss with a second tap.
        hit.on('mouseover', (event) => {
            hoveredPoint = p
            refreshHighlight()
            s.app.render()
            showTooltip(p.entity, event.global.x, event.global.y)
        })
        hit.on('mouseout', () => {
            hoveredPoint = null
            refreshHighlight()
            s.app.render()
            hideTooltip()
        })
        hits.addChild(hit)
        return { hit, year: p.year }
    })

    // Last colour mode / year range applied — kept so redraws stay correct
    // without controls.js having to pass them again on every call.
    let lastColorMode = 'off'
    let lastRange = [minYear, maxYear]

    // The global Layers-panel selection (network/grid/collision, controls.js's
    // Grid Layout/Collision Free toggles). Affects every point uniformly.
    let layoutMode = 'network'

    // Repaints every circle/hit at its *current* renderX/renderY (whatever
    // that is right now — settled or mid-transition) under the given colour
    // mode and year range.
    const draw = () => {
        const [startYear, endYear] = lastRange
        for (let i = 0; i < points.length; i++) {
            const p = points[i]
            const inRange = p.year >= startYear && p.year <= endYear
            hitList[i].hit.position.set(p.renderX, p.renderY)
            hitList[i].hit.visible = inRange
        }

        circles.clear()
        for (const p of points) {
            if (p.year < startYear || p.year > endYear) continue
            const color = lastColorMode === 'on' ? p.color : 0x000000
            circles.circle(p.renderX, p.renderY, p.r).fill({ color, alpha: CIRCLE_FILL_OPACITY })
        }

        // Keeps the highlight ring tracking a hovered/selected point's live
        // position — draw() runs on every animation frame (ensureAnimating's
        // step()) as well as on discrete redraws, so this covers both.
        refreshHighlight()
    }

    // Called on discrete state changes only (Years toggle, preset, slider
    // drag) — never per frame — so a full redraw of a few thousand circles is
    // well within budget.
    const redraw = (colorMode, range) => {
        lastColorMode = colorMode
        lastRange = range
        draw()
    }

    redraw('off', [minYear, maxYear]) // initial state: Years off, black, every article

    // ---- Layout transitions -----------------------------------------------------
    // Each point tracks its own animation (p.animStart/p.animFromX/
    // p.animFromY/p.animTargetX/p.animTargetY).
    let rafHandle = null

    const targetFor = (p) => {
        if (layoutMode === 'grid') return [p.gridX, p.gridY]
        if (layoutMode === 'collision') return [p.collisionX, p.collisionY]
        return [p.networkX, p.networkY]
    }

    // Ensures exactly one animation loop is running whenever any point has a
    // pending tween — never more than one, regardless of how many times
    // setLayout() is called while it's already running.
    const ensureAnimating = () => {
        if (rafHandle != null) return
        const step = () => {
            const now = performance.now()
            let stillAnimating = false
            for (const p of points) {
                if (p.animStart == null) continue
                const t = clamp((now - p.animStart) / TRANSITION_MS, 0, 1)
                const eased = easeInOutCubic(t)
                p.renderX = p.animFromX + (p.animTargetX - p.animFromX) * eased
                p.renderY = p.animFromY + (p.animTargetY - p.animFromY) * eased
                if (t < 1) stillAnimating = true
                else p.animStart = null // settled — stop advancing this point
            }
            draw()
            s.app.render()
            rafHandle = stillAnimating ? requestAnimationFrame(step) : null
        }
        rafHandle = requestAnimationFrame(step)
    }

    // (re)targets every point toward its current targetFor() result,
    // continuing from each point's own current renderX/renderY.
    const retarget = (affected) => {
        const reduced = prefersReducedMotion()
        const now = performance.now()
        for (const p of affected) {
            const [tx, ty] = targetFor(p)
            if (reduced) {
                p.renderX = tx
                p.renderY = ty
                p.animStart = null
                continue
            }
            p.animFromX = p.renderX
            p.animFromY = p.renderY
            p.animTargetX = tx
            p.animTargetY = ty
            p.animStart = now
        }
        if (reduced) {
            draw()
            s.app.render()
        } else {
            ensureAnimating()
        }
    }

    // Global Layers-panel toggle (controls.js) — every point's target may
    // change, since layoutMode affects all of them uniformly.
    const setLayout = (mode) => {
        if (mode === layoutMode) return
        layoutMode = mode
        retarget(points)
    }

    // Background click clears the persistent selection — elements.js wires
    // this same viewport tap to click.js's deselect(), so the ring and the
    // station report always close together. Per-hit pointertap above already
    // calls event.stopPropagation(), so this only ever fires for a genuine
    // background click, never one that landed on an article.
    s.viewport.on('pointertap', () => {
        selectedPoint = null
        refreshHighlight()
        s.app.render()
    })

    return {
        root,
        redraw,
        setLayout,
        points,
        yearExtent: [minYear, maxYear],
    }
}
