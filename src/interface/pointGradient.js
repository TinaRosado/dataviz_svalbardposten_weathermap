import { Container, Graphics, Rectangle } from 'pixi.js'

import { click } from './click.js'

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

    const points = entities.map((e) => {
        const year = parseInt(e.year, 10)
        if (year < minYear) minYear = year
        if (year > maxYear) maxYear = year
        return {
            x: e.x,
            y: e.y,
            r: radiusFor(parseInt(e.word_count, 10)),
            color: Number(e.color),
            year,
            entity: e,
        }
    })

    const root = new Container()
    root.label = 'point-gradient'
    root.visible = false // mode-gated by controls.js; safe default until it runs
    s.viewport.addChild(root)

    const circles = new Graphics()
    root.addChild(circles)

    // Per-article hit targets, sized to each circle (never smaller than the
    // existing fixed hit box used elsewhere) so larger circles stay fully
    // clickable. Positions/coordinates are untouched — only the hitArea size
    // varies per point.
    const hits = new Container()
    root.addChild(hits)

    const hitList = points.map((p) => {
        const half = Math.max(MIN_HIT_HALF, p.r + HIT_PADDING)
        const hit = new Container()
        hit.position.set(p.x, p.y)
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

    // Rebuilds the visible circle field for the given color mode and year
    // range [startYear, endYear] (inclusive). Called on discrete state changes
    // only (Years toggle, preset, slider drag) — never per frame — so a full
    // redraw of a few thousand circles is well within budget. Iterates
    // `points` in its fixed original order every time, so overlap order never
    // changes between redraws.
    const redraw = (colorMode, [startYear, endYear]) => {
        circles.clear()
        for (let i = 0; i < points.length; i++) {
            const p = points[i]
            const inRange = p.year >= startYear && p.year <= endYear
            hitList[i].hit.visible = inRange
            if (!inRange) continue
            const color = colorMode === 'on' ? p.color : 0x000000
            circles.circle(p.x, p.y, p.r).fill({ color, alpha: CIRCLE_FILL_OPACITY })
        }
    }

    redraw('off', [minYear, maxYear]) // initial state: Years off, black, every article

    return { root, redraw, points, yearExtent: [minYear, maxYear] }
}
