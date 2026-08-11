import { Assets, Sprite } from 'pixi.js'

// Density-weighted gradient fill — the lowest visualization layer, a
// precomputed background texture (see scripts/generate-gradient.js) blended
// from nearby articles' colors, dense regions strong, empty regions white.
//
// The texture is generated offline in the CSV's raw x/y domain (a Node script
// has no window to rescale against), so gradient-fill.json ships the padded
// bounding box it covers in that same raw domain. Here we map that box
// through the exact scale_X/scale_Y/margins index.js already computed for the
// articles, so the sprite lands in the same coordinate system and stays in
// perfect alignment through pan, zoom, and resize (which never move it —
// same as every other layer).

const base = import.meta.env.BASE_URL

export default async (scaleX, scaleY, marginLeft, marginTop) => {
    let bbox, texture
    try {
        ;[bbox, texture] = await Promise.all([
            fetch(base + 'gradient-fill.json').then((r) => r.json()),
            Assets.load(base + 'gradient-fill.png'),
        ])
    } catch (err) {
        // Missing until `npm run generate:gradient` has run once — predev/prebuild
        // do this automatically, but fail soft so the rest of the map still loads.
        console.warn('Gradient fill texture unavailable:', err)
        return
    }

    const x0 = marginLeft + scaleX(bbox.x0)
    const y0 = marginTop + scaleY(bbox.y0)
    const x1 = marginLeft + scaleX(bbox.x1)
    const y1 = marginTop + scaleY(bbox.y1)

    const sprite = new Sprite(texture)
    sprite.label = 'gradient-fill'
    sprite.visible = false // off by default, toggled from the Layers panel
    sprite.position.set(x0, y0)
    sprite.width = x1 - x0
    sprite.height = y1 - y0

    // Cached so the A0 export (download.js) can place its own, print-resolution
    // copy at the exact same map location without recomputing the projection.
    s.gradientFill = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }

    // Index 0: lowest layer, beneath contours, cluster fills, fronts, and
    // articles — regardless of what else has already been added.
    s.viewport.addChildAt(sprite, 0)
}
