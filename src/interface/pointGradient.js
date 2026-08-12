import { Container, Graphics, Rectangle } from 'pixi.js'

import { click } from './click.js'
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
export const CIRCLE_FILL_OPACITY = 0.6 // circle fill alpha only — lets overlapping articles accumulate visually instead of instantly flattening into one opaque blob

// ---- Layout-transition tuning ------------------------------------------------
// Exported so clusterHover.js can size its "must finish expanding and hold
// before it's allowed to collapse" commitment window against the real
// animation duration, instead of a second, potentially-drifting copy of it.
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
    // it starts on the network position and is the thing setLayout()/
    // setActiveCluster() below animate, so drawing/hit-testing never touches
    // the three source sets.
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
    // recomputation on every toggle/hover (see layouts.js for how each is
    // derived).
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

    // Per-article hit targets, sized to each circle (never smaller than the
    // existing fixed hit box used elsewhere) so larger circles stay fully
    // clickable. hitArea size is fixed per point (depends only on r, which
    // never changes); position tracks renderX/renderY every draw.
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
            click(p.entity)
        })
        hits.addChild(hit)
        return { hit, year: p.year }
    })

    // Exposed so clusterHover.js can wire mouseover/mouseout (hover — and,
    // via PixiJS's accessibility system, keyboard focus, though only clusters
    // themselves are made keyboard-focusable, not individual articles; see
    // the completion report) onto the *same* hit containers already used for
    // pointertap above, rather than creating a second set of targets.
    const hoverTargets = hitList.map(({ hit }, i) => ({
        clusterId: points[i].entity.cluster,
        target: hit,
    }))

    // Per-cluster bounding box of *grid* positions (padded by that cluster's
    // own largest radius, so a circle sitting right at the edge isn't half
    // outside it), keyed by cluster id — used by index.js to build a "stay
    // active" hover region sized to where the circles actually spread to
    // once expanded, rather than the (often much tighter) network hull. See
    // clusters.js's hover-entry regions for the *entry* trigger, which is
    // deliberately separate and label-based.
    const gridExtentByClusterId = new Map()
    for (const p of points) {
        const id = p.entity.cluster
        const extent = gridExtentByClusterId.get(id)
        if (!extent) {
            gridExtentByClusterId.set(id, {
                x0: p.gridX,
                y0: p.gridY,
                x1: p.gridX,
                y1: p.gridY,
                maxR: p.r,
            })
            continue
        }
        if (p.gridX < extent.x0) extent.x0 = p.gridX
        if (p.gridY < extent.y0) extent.y0 = p.gridY
        if (p.gridX > extent.x1) extent.x1 = p.gridX
        if (p.gridY > extent.y1) extent.y1 = p.gridY
        if (p.r > extent.maxR) extent.maxR = p.r
    }

    // Last colour mode / year range applied — kept so the hover-transition
    // animation below can keep redrawing under the current filter without
    // controls.js having to pass them again on every animation frame.
    let lastColorMode = 'off'
    let lastRange = [minYear, maxYear]

    // Two independent, coexisting sources of layout intent:
    // - `layoutMode` ('network'/'grid'/'collision') — the deliberate, global
    //   Layers-panel selection (controls.js's Grid Layout/Collision Free
    //   toggles). Affects every point uniformly.
    // - `activeClusterIds` — the transient hover state (clusterHover.js): the
    //   directly-hovered cluster *and* its precomputed nearby clusters (see
    //   clusters.js's neighborsByClusterId), so a tight/overlapping group
    //   reposition together. Only meaningful while layoutMode is 'network';
    //   controls.js disables hovering (via clusterHover.js's setEnabled)
    //   whenever a global mode is active, so this is guaranteed empty
    //   whenever layoutMode isn't 'network' — the explicit
    //   `layoutMode === 'network'` check in targetFor below is just defence
    //   in depth, not the only thing preventing the two from fighting.
    let layoutMode = 'network'
    let activeClusterIds = new Set()

    // Repaints every circle/hit at its *current* renderX/renderY (whatever
    // that is right now — settled or mid-transition) under the given colour
    // mode and year range. Iterates `points` in its fixed original order for
    // hit positions/visibility (so overlap order there never changes), but
    // draws the hovered cluster(s)' circles in a second, later pass so they
    // stay legible over a neighbouring cluster's network-position circles at
    // a shared boundary (see prompts/cluster-hover.md §9) — with no active
    // cluster (always true unless layoutMode is 'network') this collapses to
    // one pass in the original order, so deactivation restores the default
    // z-order for free, not as a separate step.
    const draw = () => {
        const [startYear, endYear] = lastRange
        for (let i = 0; i < points.length; i++) {
            const p = points[i]
            const inRange = p.year >= startYear && p.year <= endYear
            hitList[i].hit.position.set(p.renderX, p.renderY)
            hitList[i].hit.visible = inRange
        }

        circles.clear()
        const drawCircle = (p) => {
            if (p.year < startYear || p.year > endYear) return
            const color = lastColorMode === 'on' ? p.color : 0x000000
            circles.circle(p.renderX, p.renderY, p.r).fill({ color, alpha: CIRCLE_FILL_OPACITY })
        }
        const isActive = (p) => activeClusterIds.has(p.entity.cluster)
        for (const p of points) if (!isActive(p)) drawCircle(p)
        if (activeClusterIds.size > 0) for (const p of points) if (isActive(p)) drawCircle(p)
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

    // ---- Layout/hover transitions ----------------------------------------------
    // Both setLayout() (global toggle) and setActiveCluster() (hover) funnel
    // through the same per-point animation mechanism below, so switching one
    // mid-transition of the other always continues smoothly from wherever a
    // point currently is rather than conflicting or snapping.
    //
    // Each point tracks its *own* animation (p.animStart/p.animFromX/
    // p.animFromY/p.animTargetX/p.animTargetY) rather than one shared fixed
    // batch, specifically so rapid hovering across several clusters can't
    // strand one mid-transition: if cluster A is still animating back to
    // network when B is hovered, and then C is hovered before B finishes,
    // A's points are untouched by the B→C call but keep advancing toward
    // their already-assigned network target in the same shared loop below —
    // nothing is ever abandoned partway.
    let rafHandle = null

    const targetFor = (p) => {
        if (layoutMode === 'grid') return [p.gridX, p.gridY]
        if (layoutMode === 'collision') return [p.collisionX, p.collisionY]
        return layoutMode === 'network' && activeClusterIds.has(p.entity.cluster)
            ? [p.gridX, p.gridY]
            : [p.networkX, p.networkY]
    }

    // Ensures exactly one animation loop is running whenever any point has a
    // pending tween — never more than one, regardless of how many times
    // setLayout()/setActiveCluster() are called while it's already running.
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

    // (re)targets exactly `affected` — never more — toward each of their
    // current targetFor() result, continuing from each point's own current
    // renderX/renderY (mid-flight or settled, doesn't matter).
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

    // Hover (clusterHover.js) — `newActiveIds` is the hovered cluster plus its
    // precomputed nearby clusters (see clusters.js's neighborsByClusterId),
    // already expanded by clusterHover.js. Only points belonging to a cluster
    // in the previous or the new set are ever given a new target here; every
    // other point's renderX/renderY is left alone, so unrelated clusters
    // never move (prompts/cluster-hover.md §2/§6).
    const setActiveCluster = (newActiveIds) => {
        const previousIds = activeClusterIds
        activeClusterIds = newActiveIds
        if (layoutMode !== 'network') return // no visual effect while a global mode is active — see clusterHover.js's setEnabled, which keeps this from ever actually being called in that case
        const affected = points.filter(
            (p) => previousIds.has(p.entity.cluster) || newActiveIds.has(p.entity.cluster),
        )
        if (affected.length) retarget(affected)
    }

    return {
        root,
        redraw,
        setLayout,
        setActiveCluster,
        points,
        yearExtent: [minYear, maxYear],
        hoverTargets,
        gridExtentByClusterId,
    }
}
