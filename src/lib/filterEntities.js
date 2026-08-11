import { group } from 'd3'

// Drop detached clusters: any whose centroid is a far outlier (> 2σ from the
// overall centroid — e.g. "Holiday Giveaways Events", which sits alone far to
// one side) is cut from the visualization so it doesn't clutter the view or
// squeeze the main body. Detected by distance, not a hardcoded id, so a data
// regeneration is fine.
//
// Shared by the browser entry point (index.js) and the offline gradient
// texture generator (scripts/generate-gradient.js) — both must filter
// identically, or the texture's bounding box would drift from the articles
// actually drawn on screen. Pure — no DOM, safe to import from Node.
export const filterEntities = (allEntities) => {
    const clustered = allEntities.filter((e) => e.cluster !== '-1')
    const avg = (arr, key) => arr.reduce((a, e) => a + parseInt(e[key]), 0) / arr.length
    const cx = avg(clustered, 'x')
    const cy = avg(clustered, 'y')

    const distances = [...group(clustered, (e) => e.cluster)].map(([id, members]) => ({
        id,
        d: Math.hypot(avg(members, 'x') - cx, avg(members, 'y') - cy),
    }))
    const dMean = distances.reduce((a, c) => a + c.d, 0) / distances.length
    const dStd = Math.sqrt(distances.reduce((a, c) => a + (c.d - dMean) ** 2, 0) / distances.length)
    const detached = new Set(distances.filter((c) => c.d > dMean + 2 * dStd).map((c) => c.id))

    return allEntities.filter((e) => !detached.has(e.cluster))
}
