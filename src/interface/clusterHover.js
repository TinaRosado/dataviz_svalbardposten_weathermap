import { TRANSITION_MS } from './pointGradient.js'

// Owns the single authoritative "which cluster is directly hovered" transient
// state (activeAnchorId, null = normal network layout) — the only thing that
// ever decides it. pointGradient.js and elements.js are pure reactors: they
// receive setActiveCluster() calls (with the *expanded* active set — the
// anchor plus its precomputed nearby clusters, see neighborsByClusterId
// below) and animate/reposition accordingly, but never decide activation
// themselves. Pointer hover, keyboard focus, and any future programmatic
// trigger all funnel through the same activate() function below, so none of
// them can disagree with another.
//
// Hovering one cluster also activates any other cluster close enough to
// count as a neighbor (clusters.js's neighborsByClusterId, precomputed from
// centroid distance and each cluster's own outer radius) — so a group of
// nearby or overlapping clusters reposition together, rather than only
// whichever one happens to be topmost under the pointer. Moving the pointer
// onto one of those neighbors' own hit targets re-anchors to it directly
// (it has its own hoverTargets entries, wired exactly like every other
// cluster), which in turn activates *its* neighbors — so panning across a
// tight group smoothly carries the active set along rather than requiring
// continuous pointer-distance tracking.
//
// Deliberately listens for 'mouseover'/'mouseout', not 'pointerover'/
// 'pointerout': PixiJS's EventBoundary only dispatches the mouse-named
// events when pointerType is 'mouse' or 'pen' (see
// node_modules/pixi.js/lib/events/EventBoundary.js's mapPointerOver/Out), and
// its accessibility system (AccessibilitySystem.js's _onFocus/_onFocusOut)
// maps keyboard focus/blur on an `accessible` container to that exact same
// pair. So this one choice gives real mouse hover and keyboard focus the same
// activation path for free, while touch — which never fires 'mouseover' —
// is naturally excluded, matching the "leave it in network layout on touch"
// fallback (see the completion report for prompts/cluster-hover.md).

// Long enough to survive the time it takes the hovered cluster's circles to
// spread out to their grid positions (pointGradient.js's TRANSITION_MS) —
// an 80ms value tuned only for bridging an already-close hop between two
// adjacent hit targets turned out to be far too short in practice: the
// pointer is often still crossing the gap between the (comparatively small)
// hull region and a circle that's mid-flight toward a much more spread-out
// grid position, and the cluster was collapsing before the pointer could
// catch up. Still always cancelled immediately on re-entry (see enter()
// below), never left pending once the cluster is confirmed active again, so
// this is "forgiving", not "unresponsive on genuine exit". This is the floor
// on the exit delay — see MIN_ACTIVE_MS below for the other, usually larger,
// constraint on when an exit is actually allowed to fire.
const EXIT_DEFER_MS = 1000

// Once a cluster starts expanding, it must finish arriving at its grid
// position and hold there for this long before a return-to-network is
// allowed to actually begin — never mid-flight. Without this, a mouseout
// arriving shortly after activation (quite possible: the pointer is often
// still crossing toward a circle that's mid-transition) would reverse the
// animation before it ever finished, reading as the cluster glitching open
// and shut rather than committing to a clean expand-then-collapse. It's
// explicitly fine for the return to network to feel a little delayed after
// the pointer actually leaves — see scheduleExit below, which extends (never
// shortens) EXIT_DEFER_MS to satisfy this.
const MIN_ACTIVE_MS = TRANSITION_MS + 800

export default (pointGradient, elementsHandle, neighborsByClusterId) => {
    let activeAnchorId = null
    let activatedAt = 0
    let exitTimer = null
    // Hover only has meaning while the map is in its normal network layout —
    // controls.js calls setEnabled(false) whenever the global Grid Layout/
    // Collision Free toggle is switched on, and setEnabled(true) when it's
    // switched back off. While disabled, hover events are fully ignored (not
    // just visually masked), so re-enabling never "pops" a stale activation
    // back in from before it was disabled.
    let enabled = true

    const activeSetFor = (anchorId) => {
        const set = new Set()
        if (anchorId == null) return set
        set.add(anchorId)
        for (const n of neighborsByClusterId?.get(anchorId) ?? []) set.add(n)
        return set
    }

    const enter = (clusterId) => {
        if (!enabled) return
        if (exitTimer != null) {
            clearTimeout(exitTimer)
            exitTimer = null
        }
        if (clusterId === activeAnchorId) return
        activeAnchorId = clusterId
        if (clusterId != null) activatedAt = performance.now()
        const activeSet = activeSetFor(clusterId)
        pointGradient.setActiveCluster(activeSet)
        elementsHandle?.setActiveCluster(activeSet)
    }

    // Deactivating a given cluster is deferred, not immediate, and only takes
    // effect if that same cluster is still the anchor once the timer fires —
    // if enter() reassigned activeAnchorId to something else in the meantime
    // (moved to a different cluster, or re-entered this one), this is a no-op.
    // The delay is whichever is longer: the short EXIT_DEFER_MS bridge, or
    // whatever's left of this cluster's MIN_ACTIVE_MS commitment window —
    // switching directly to a *different* cluster (calling enter() with a
    // new id, not scheduleExit) is never subject to this and always
    // interrupts immediately, per prompts/cluster-hover.md §6.
    const scheduleExit = (clusterId) => {
        if (!enabled) return
        if (exitTimer != null) clearTimeout(exitTimer)
        const remaining = MIN_ACTIVE_MS - (performance.now() - activatedAt)
        const delay = Math.max(EXIT_DEFER_MS, remaining)
        exitTimer = setTimeout(() => {
            exitTimer = null
            if (activeAnchorId === clusterId) enter(null)
        }, delay)
    }

    // Called by controls.js. Disabling clears any currently active cluster
    // immediately (calling enter(null) while still enabled, so it isn't
    // gated away by the flag it's about to flip) rather than leaving it
    // dangling — otherwise re-enabling later could "pop" a stale cluster back
    // in that the pointer isn't even over anymore.
    const setEnabled = (value) => {
        if (value === enabled) return
        if (!value) {
            if (exitTimer != null) {
                clearTimeout(exitTimer)
                exitTimer = null
            }
            enter(null)
        }
        enabled = value
    }

    // Wires one hoverable display object (a cluster's hull hit-region from
    // clusters.js, or an article's existing hit container from
    // pointGradient.js) to this cluster id. Both kinds of target are created
    // and owned by their own modules — this only attaches listeners, it never
    // creates or duplicates a target.
    const wireHoverTarget = (target, clusterId) => {
        target.on('mouseover', () => enter(clusterId))
        target.on('mouseout', () => scheduleExit(clusterId))
    }

    return { activate: enter, wireHoverTarget, setEnabled }
}
