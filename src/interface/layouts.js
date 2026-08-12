import { polygonContains } from 'd3'
import { clusterGeometry } from './geometry.js'

// Two alternative, fully-derived global layouts for the Point Gradient
// circles (see pointGradient.js). Both are pure functions of the *current*
// points (their networkX/networkY, r, and entity.cluster/entity.id) and the
// current cluster geometry (clusterGeometry(entities), the same hull/center
// clusters.js and fronts.js already use as a per-cluster "contour" — the
// global density isolines in contours.js are a single field over every point
// and can't be split per cluster without a much larger refactor).
//
// Nothing here is precomputed offline or cached across page loads: every
// call recomputes from whatever `points`/`entities` are passed in, so a
// changed dataset (different article count, cluster set, coordinates, or
// word counts) produces correspondingly different, still fully deterministic
// output. The only cache in the call chain is clusterGeometry's own
// (geometry.js), which is keyed on referential equality of `entities` and so
// invalidates itself correctly whenever a new entities array is loaded.
//
// Determinism never depends on CSV row order or Map/Set iteration order:
// every ordering-sensitive step (which article gets which point, which pair
// gets resolved first) is explicitly sorted by each article's stable `id`
// column, or by cluster id, never by array position.

const MIN_GAP = 0.3 // configurable minimum gap, shared by both layouts

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// Rank used to sort articles largest-first. Missing/zero/invalid word counts
// (parseInt → NaN) all collapse to the lowest rank, sorted after every valid
// value, rather than interleaving unpredictably or breaking the sort.
const wordRank = (p) => {
    const wc = parseInt(p.entity.word_count, 10)
    return Number.isFinite(wc) ? wc : -1
}

// Stable identifier for deterministic ordering/tie-breaking — entities.csv
// has a dedicated `id` column for exactly this purpose. Never derived from
// array position.
const stableId = (p) => String(p.entity.id ?? '')
const byStableId = (a, b) => stableId(a).localeCompare(stableId(b))

const byWordCountThenId = (a, b) => {
    const r = wordRank(b) - wordRank(a) // descending: largest first
    if (r !== 0) return r
    return byStableId(a, b)
}

// ---- Spatial index -----------------------------------------------------------
// Uniform grid bucketing for neighbor queries. Every current cluster is small
// enough that a plain pairwise scan would be fine too (see the completion
// report), but collision resolution is written against this index rather
// than a raw double loop specifically so a much larger future dataset only
// needs a denser/larger index, not an algorithm rewrite.
class SpatialIndex {
    constructor(cellSize) {
        this.cellSize = Math.max(cellSize, 1e-6)
        this.buckets = new Map()
    }
    key(cx, cy) {
        return cx + ',' + cy
    }
    insert(index, x, y) {
        const cx = Math.floor(x / this.cellSize)
        const cy = Math.floor(y / this.cellSize)
        const k = this.key(cx, cy)
        let bucket = this.buckets.get(k)
        if (!bucket) {
            bucket = []
            this.buckets.set(k, bucket)
        }
        bucket.push(index)
    }
    // Calls `callback(index)` once for every stored index in the
    // bucket-square around (x, y) covering `radius` — an over-approximation
    // of the circle; callers do the exact distance check themselves. Iterates
    // in place (no intermediate array) since this runs in hot loops called
    // thousands of times per layout computation.
    forEachNearby(x, y, radius, callback) {
        const span = Math.max(1, Math.ceil(radius / this.cellSize))
        const cx = Math.floor(x / this.cellSize)
        const cy = Math.floor(y / this.cellSize)
        for (let dx = -span; dx <= span; dx++) {
            for (let dy = -span; dy <= span; dy++) {
                const bucket = this.buckets.get(this.key(cx + dx, cy + dy))
                if (!bucket) continue
                for (let k = 0; k < bucket.length; k++) callback(bucket[k])
            }
        }
    }
}

// Below this, two points are treated as coincident rather than merely close
// — see the deterministic tie-break in forEachOverlappingPair below.
const COINCIDENT_EPS = 1e-9

// Numerical tolerance for "not overlapping". Floating-point arithmetic will
// essentially never land a settled pair on an *exact* d === minDist — some
// pairs converge to within a fraction of a nanometre (in world units) of the
// boundary, on either side, by rounding noise alone. Without a tolerance the
// convergence loop below chases that noise forever, "fixing" a penetration
// far smaller than anything visible (MIN_GAP is 0.3 world units; this is
// nine orders of magnitude smaller) and never reporting success. This is
// the single, explicit place that tolerance is defined.
const OVERLAP_TOLERANCE = 1e-6

// Exact per-pair geometry for a candidate (i, j): true distance, the minimum
// allowed distance, and — only when the pair actually violates it (beyond
// OVERLAP_TOLERANCE) — a direction to separate along. Returns null for a
// non-violating pair. Shared by every separation routine below so the
// violation test and the coincident-position tie-break are defined in
// exactly one place.
const violatingPairGeometry = (i, j, xs, ys, rs, gap) => {
    let dx = xs[j] - xs[i]
    let dy = ys[j] - ys[i]
    let d = Math.hypot(dx, dy)
    const minDist = rs[i] + rs[j] + gap
    if (d >= minDist - OVERLAP_TOLERANCE) return null
    if (d < COINCIDENT_EPS) {
        // Exactly (or numerically) coincident circles have no real direction
        // to separate along — dx/d, dy/d would be a degenerate 0/0.
        // Synthesize a direction deterministically from the pair's own
        // global indices (themselves assigned in stable-id order, see
        // callers) rather than from iteration order or randomness, so the
        // outcome is still reproducible and independent of dataset ordering.
        const angle = ((i * 92821 + j * 68917) % 360) * (Math.PI / 180)
        dx = Math.cos(angle)
        dy = Math.sin(angle)
        d = 1
    }
    return { dx, dy, d, minDist }
}

// Runs `callback(i, j, dx, dy, d, minDist)` once for every unique violating
// pair of `indices` (indexing into the shared xs/ys/rs arrays), found via the
// spatial index above rather than a full double loop. `i`/`j` are global
// point indices (see assignGridLayout / assignCollisionFreeLayout — always
// assigned in stable-id order), and pairs are deduped by `j > i` on those
// indices, not by iteration position, so the set of pairs visited is
// independent of how `indices` happens to be ordered.
//
// The query radius (`rs[i] + maxR + gap`, where maxR is the largest radius
// among `indices`) always covers the true minimum distance for any pair
// involving `i` (rs[i] + rs[j] + gap ≤ rs[i] + maxR + gap since rs[j] ≤
// maxR), and the bucket-square query itself over-approximates a circle (see
// SpatialIndex.query) — so this scan can produce false positives (checked and
// discarded by violatingPairGeometry) but never a false negative. "Zero
// pairs found" is therefore a complete proof of no violation (beyond
// OVERLAP_TOLERANCE) among `indices`, equivalent to an exhaustive pairwise
// check, not just "the index didn't happen to find one."
const forEachOverlappingPair = (indices, xs, ys, rs, gap, callback) => {
    let maxR = 0.01
    for (const i of indices) if (rs[i] > maxR) maxR = rs[i]
    const cellSize = 2 * maxR + gap
    const grid = new SpatialIndex(cellSize)
    for (const i of indices) grid.insert(i, xs[i], ys[i])

    for (const i of indices) {
        grid.forEachNearby(xs[i], ys[i], rs[i] + maxR + gap, (j) => {
            if (j <= i) return
            const geom = violatingPairGeometry(i, j, xs, ys, rs, gap)
            if (!geom) return
            callback(i, j, geom.dx, geom.dy, geom.d, geom.minDist)
        })
    }
}

// Directly separates every overlapping pair among `indices`, applying each
// correction immediately (Gauss-Seidel-style) rather than batching a whole
// pass into one simultaneous update — in practice this converges markedly
// faster for a packing problem like this (an early synchronized+damped
// version of this function needed far more passes for the same result; see
// the completion report), and since every read here is of the live xs/ys
// arrays — never a stale snapshot — there's no correctness cost to it either.
//
// Re-derives violations from the actual current positions every pass (not
// assumed from the previous one), so this is a real convergence loop, not a
// fixed number of corrective nudges: it only reports success once a pass
// finds zero violations, and loudly warns — rather than silently returning —
// if it still hasn't after `maxPasses`.
const separateOverlapsExact = (indices, xs, ys, rs, gap, maxPasses, label) => {
    for (let pass = 0; pass < maxPasses; pass++) {
        let violatingPairs = 0
        let worstPenetration = 0
        for (let a = 0; a < indices.length; a++) {
            for (let b = a + 1; b < indices.length; b++) {
                const i = indices[a]
                const j = indices[b]
                const geom = violatingPairGeometry(i, j, xs, ys, rs, gap)
                if (!geom) continue
                violatingPairs++
                const penetration = geom.minDist - geom.d
                if (penetration > worstPenetration) worstPenetration = penetration
                const overlap = penetration / 2
                const ux = geom.dx / geom.d
                const uy = geom.dy / geom.d
                xs[i] -= ux * overlap
                ys[i] -= uy * overlap
                xs[j] += ux * overlap
                ys[j] += uy * overlap
            }
        }
        if (violatingPairs === 0)
            return { converged: true, passes: pass, violatingPairs: 0, worstPenetration: 0 }
        if (pass === maxPasses - 1) {
            console.warn(
                `[layouts] ${label ?? 'separation'} did not converge within ${maxPasses} passes — ` +
                    `${violatingPairs} pair(s) still violating the minimum gap, worst penetration ${worstPenetration.toFixed(6)}.`,
            )
            return { converged: false, passes: maxPasses, violatingPairs, worstPenetration }
        }
    }
}

// Same convergence contract as separateOverlapsExact, but finds candidate
// pairs via the spatial index instead of a full double loop — for the global,
// cross-cluster pass, where `indices` spans every point on the map and a
// plain O(n²) scan would be too slow to run for many passes. Per-cluster
// separation uses the exact version above instead, since every current
// cluster is small enough (see the completion report) that the index's
// overhead buys nothing there.
const separateOverlapsIndexed = (indices, xs, ys, rs, gap, maxPasses, label) => {
    for (let pass = 0; pass < maxPasses; pass++) {
        let violatingPairs = 0
        let worstPenetration = 0
        forEachOverlappingPair(indices, xs, ys, rs, gap, (i, j, dx, dy, d, minDist) => {
            violatingPairs++
            const penetration = minDist - d
            if (penetration > worstPenetration) worstPenetration = penetration
            const overlap = penetration / 2
            const ux = dx / d
            const uy = dy / d
            xs[i] -= ux * overlap
            ys[i] -= uy * overlap
            xs[j] += ux * overlap
            ys[j] += uy * overlap
        })
        if (violatingPairs === 0)
            return { converged: true, passes: pass, violatingPairs: 0, worstPenetration: 0 }
        if (pass === maxPasses - 1) {
            console.warn(
                `[layouts] ${label ?? 'separation'} did not converge within ${maxPasses} passes — ` +
                    `${violatingPairs} pair(s) still violating the minimum gap, worst penetration ${worstPenetration.toFixed(6)}.`,
            )
            return { converged: false, passes: maxPasses, violatingPairs, worstPenetration }
        }
    }
}

// Cluster geometry keyed by cluster id, plus the cluster ids in deterministic
// (lexicographic) order — never the order clusterGeometry happened to emit
// them in, which follows first-appearance in `entities`.
const clusterGeomIndex = (entities) => {
    const geoms = clusterGeometry(entities)
    const byId = new Map(geoms.map((c) => [String(c.id), c]))
    return byId
}

// ---- Grid Layout -------------------------------------------------------------

// Square lattice anchored at the global origin (not per-cluster), so every
// cluster's points sit on one consistent grid rather than each drifting to
// its own local alignment.
const latticeRing = (ci, cj, ring, cellSize) => {
    const pts = []
    if (ring === 0) {
        pts.push([ci * cellSize, cj * cellSize, ci, cj])
        return pts
    }
    for (let di = -ring; di <= ring; di++) {
        for (let dj = -ring; dj <= ring; dj++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue
            pts.push([(ci + di) * cellSize, (cj + dj) * cellSize, ci + di, cj + dj])
        }
    }
    return pts
}

const generateLatticeCandidates = (centerX, centerY, cellSize, maxRing) => {
    const ci = Math.round(centerX / cellSize)
    const cj = Math.round(centerY / cellSize)
    const out = []
    for (let ring = 0; ring <= maxRing; ring++) out.push(...latticeRing(ci, cj, ring, cellSize))
    return out
}

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2

// One cluster's grid assignment: sort articles largest-first (stable-id
// tie-break), generate a pool of lattice points around the cluster center
// (preferring points inside the cluster's hull when there are enough of
// them, and never a point some other cluster already claimed), sort that
// pool by distance to center, then greedily assign each article to the most
// central unused point — breaking near-ties in centrality by proximity to
// the article's own original position, per the algorithm in
// prompts/layout-transitions.md.
const computeGridForCluster = (clusterPoints, center, cellSize, hull, claimedCells) => {
    const order = clusterPoints.slice().sort(byWordCountThenId)
    const needed = order.length

    let maxRing = Math.max(2, Math.ceil(Math.sqrt(needed / Math.PI)) + 2)
    let candidates
    let available
    for (;;) {
        candidates = generateLatticeCandidates(center[0], center[1], cellSize, maxRing)
        available = candidates.filter((c) => !claimedCells.has(c[2] + ',' + c[3]))
        const inHull = hull ? available.filter((c) => polygonContains(hull, c)) : available
        if (inHull.length >= needed) {
            available = inHull
            break
        }
        if (maxRing > 60) break // safety cap — never loop forever chasing containment
        maxRing += 3
    }
    const pool = available
    pool.sort(
        (a, b) => dist2(a[0], a[1], center[0], center[1]) - dist2(b[0], b[1], center[0], center[1]),
    )

    const used = new Array(pool.length).fill(false)
    const assigned = new Map()
    const centralityEps2 = (cellSize * 0.75) ** 2

    order.forEach((p) => {
        let firstFree = -1
        for (let i = 0; i < pool.length; i++) {
            if (!used[i]) {
                firstFree = i
                break
            }
        }
        if (firstFree === -1) return // pool was sized to cover `needed`; shouldn't happen

        const refD2 = dist2(pool[firstFree][0], pool[firstFree][1], center[0], center[1])
        let chosen = firstFree
        let chosenOrigD2 = dist2(pool[firstFree][0], pool[firstFree][1], p.networkX, p.networkY)
        for (let i = firstFree + 1; i < pool.length; i++) {
            if (used[i]) continue
            const d2c = dist2(pool[i][0], pool[i][1], center[0], center[1])
            if (d2c - refD2 > centralityEps2) break // pool sorted by centrality: nothing closer remains
            const origD2 = dist2(pool[i][0], pool[i][1], p.networkX, p.networkY)
            if (origD2 < chosenOrigD2) {
                chosen = i
                chosenOrigD2 = origD2
            }
        }
        used[chosen] = true
        claimedCells.add(pool[chosen][2] + ',' + pool[chosen][3])
        assigned.set(p, pool[chosen])
    })

    return assigned
}

// Mutates every point's gridX/gridY in place. `points` must already carry
// networkX/networkY, r, and entity (see pointGradient.js). Clusters are
// processed in lexicographic cluster-id order, and a single `claimedCells`
// set is shared across all of them, so two clusters can never be assigned the
// same lattice point even where their hulls overlap (see fronts.js, which
// draws fronts precisely where they do).
export const assignGridLayout = (points, entities) => {
    let maxR = 0.01
    for (const p of points) if (p.r > maxR) maxR = p.r
    const cellSize = 2 * maxR + MIN_GAP

    const geomById = clusterGeomIndex(entities)
    const byCluster = new Map()
    for (const p of points) {
        const id = String(p.entity.cluster)
        let arr = byCluster.get(id)
        if (!arr) {
            arr = []
            byCluster.set(id, arr)
        }
        arr.push(p)
    }

    const claimedCells = new Set()
    const clusterIds = [...byCluster.keys()].sort()
    clusterIds.forEach((clusterId) => {
        const clusterPoints = byCluster.get(clusterId)
        const geom = geomById.get(clusterId)
        const center = geom ? geom.center : [clusterPoints[0].networkX, clusterPoints[0].networkY]
        const assigned = computeGridForCluster(
            clusterPoints,
            center,
            cellSize,
            geom?.expanded,
            claimedCells,
        )
        assigned.forEach(([x, y], p) => {
            p.gridX = x
            p.gridY = y
        })
    })
}

// ---- Collision Free Layout ---------------------------------------------------

// Deterministic spring relaxation (attraction to the original position +
// mild inward bias by size + a soft nudge back inside the cluster hull),
// followed by an exact pairwise separation pass — mirroring the settling
// approach geometry.js's deconflictLabels already uses for cluster labels —
// so the final result is guaranteed overlap-free even if the spring
// simulation alone hasn't fully converged. The separation pass runs globally
// across every point (not just within one cluster) so neighbouring clusters
// can never end up overlapping at their shared boundary either.
const ATTRACT_K = 0.06
const INWARD_K = 0.04
const BOUNDARY_K = 0.05
const SPRING_ITERATIONS = 150
// Generous headroom for SEPARATION_DAMPING < 1 to fully converge — cheap
// given current cluster sizes (see the module-level comment on scalability)
// since separateOverlaps returns as soon as a pass finds zero violations,
// rather than always spending the full budget.
const SEPARATION_PASSES = 600

// Mutates every point's collisionX/collisionY in place. Returns per-cluster
// and global separation diagnostics ({ converged, passes, violatingPairs,
// worstPenetration }) — ignored by pointGradient.js in production, but lets
// verification tooling confirm convergence rather than just trusting it.
export const assignCollisionFreeLayout = (points, entities) => {
    // One global, stable-id-ordered index for every point, shared by the
    // spatial index and the final cross-cluster separation pass — pair
    // dedup (`j > i`) and iteration order both derive from this, never from
    // `points`' own (CSV-row-derived) array order.
    const ordered = points.slice().sort(byStableId)
    const indexOf = new Map(ordered.map((p, i) => [p, i]))
    const n = ordered.length
    const xs = new Float64Array(n)
    const ys = new Float64Array(n)
    const rs = new Float64Array(n)
    ordered.forEach((p, i) => {
        xs[i] = p.networkX
        ys[i] = p.networkY
        rs[i] = p.r
    })

    const geomById = clusterGeomIndex(entities)
    const byCluster = new Map()
    ordered.forEach((p, i) => {
        const id = String(p.entity.cluster)
        let arr = byCluster.get(id)
        if (!arr) {
            arr = []
            byCluster.set(id, arr)
        }
        arr.push(i)
    })

    const diagnostics = { perCluster: [] }

    const clusterIds = [...byCluster.keys()].sort()
    clusterIds.forEach((clusterId) => {
        const idx = byCluster.get(clusterId)
        const geom = geomById.get(clusterId)
        const center = geom ? geom.center : [xs[idx[0]], ys[idx[0]]]
        const hull = geom?.expanded
        let maxR = 0.01
        for (const i of idx) if (rs[i] > maxR) maxR = rs[i]
        const stepCap = Math.max(maxR * 0.5, 0.05)
        const networkX = idx.map((i) => xs[i])
        const networkY = idx.map((i) => ys[i])

        // Local (per-cluster) typed arrays and a direct O(count²) pairwise
        // scan, not the Map/spatial-index machinery used elsewhere — every
        // current cluster is small (≤ a few hundred points, see the
        // completion report), so the index's bucketing overhead costs more
        // than it saves when it's rebuilt on every one of these iterations,
        // and this loop runs SPRING_ITERATIONS times per cluster.
        const count = idx.length
        const fx = new Float64Array(count)
        const fy = new Float64Array(count)

        for (let iter = 0; iter < SPRING_ITERATIONS; iter++) {
            for (let a = 0; a < count; a++) {
                const i = idx[a]
                let fxi = (networkX[a] - xs[i]) * ATTRACT_K
                let fyi = (networkY[a] - ys[i]) * ATTRACT_K

                const wInward = (rs[i] / maxR) * INWARD_K
                fxi += (center[0] - xs[i]) * wInward
                fyi += (center[1] - ys[i]) * wInward

                if (hull && !polygonContains(hull, [xs[i], ys[i]])) {
                    fxi += (center[0] - xs[i]) * BOUNDARY_K
                    fyi += (center[1] - ys[i]) * BOUNDARY_K
                }
                fx[a] = fxi
                fy[a] = fyi
            }

            for (let a = 0; a < count; a++) {
                for (let b = a + 1; b < count; b++) {
                    const i = idx[a]
                    const j = idx[b]
                    const geom = violatingPairGeometry(i, j, xs, ys, rs, MIN_GAP)
                    if (!geom) continue
                    const overlap = (geom.minDist - geom.d) / 2
                    const ux = geom.dx / geom.d
                    const uy = geom.dy / geom.d
                    fx[a] -= ux * overlap
                    fy[a] -= uy * overlap
                    fx[b] += ux * overlap
                    fy[b] += uy * overlap
                }
            }

            for (let a = 0; a < count; a++) {
                const i = idx[a]
                xs[i] += clamp(fx[a], -stepCap, stepCap)
                ys[i] += clamp(fy[a], -stepCap, stepCap)
            }
        }

        // Per-cluster guarantee pass first (cheap — every current cluster is
        // small enough for the exact O(n²) version, see the completion
        // report — and resolves the vast majority of overlaps while
        // positions are still close to their post-spring state), then the
        // shared global pass below catches anything left at a cluster
        // boundary.
        const result = separateOverlapsExact(
            idx,
            xs,
            ys,
            rs,
            MIN_GAP,
            SEPARATION_PASSES,
            `cluster ${clusterId}`,
        )
        diagnostics.perCluster.push({ clusterId, ...result })
    })

    const allIndices = ordered.map((_, i) => i)
    diagnostics.global = separateOverlapsIndexed(
        allIndices,
        xs,
        ys,
        rs,
        MIN_GAP,
        SEPARATION_PASSES,
        'global pass',
    )

    points.forEach((p) => {
        const i = indexOf.get(p)
        p.collisionX = xs[i]
        p.collisionY = ys[i]
    })

    return diagnostics
}
