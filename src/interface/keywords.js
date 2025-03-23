import { BitmapText, Graphics } from 'pixi.js'
import { group, mean, polygonCentroid, polygonHull } from 'd3'

export default entities => {

    const stage = new Graphics()
    stage.name = 'keywords'
    stage.alpha = 1
    stage.interactiveChildren = false
    s.viewport.addChild(stage)

    // const mean = mean.entities(e => e.frequency_norm)

    entities
        .filter(e => e.type === 'tag') // Keep keywords
        .sort((a, b) => b.slope - a.slope) // Order by linear regression
        .forEach(e => {

            const bitmap = new BitmapText(
                e.name, {
                fontName: 'Lato',
                fontSize: (e.frequency_norm + .5) * 20, // Normalization ([0:1] + x) + scale
                align: 'center',
                tint: s.gray,
            })

            bitmap.position.set(e.x - bitmap.textWidth / 2, e.y - bitmap.textHeight / 2)


            let overlapping = false // Check overlapping

            for (var i = 0; i < s.bitmaps.length; i++) {

                const l1 = s.bitmaps[i]
                const l2 = bitmap
                const margin = 10 // Avoid close keywords

                if (!(l2.x > l1.x + l1.width + margin
                    || l2.x + l2.width + margin < l1.x
                    || l2.y > l1.y + l1.height + margin
                    || l2.y + l2.height + margin < l1.y)) {
                    overlapping = true // This is black magic
                    break
                }

            }

            if (!overlapping) {

                const background = new Graphics();
                // background.lineStyle(.5, 0x00FF00, .6) // Draw contour to verify
                background.beginFill(0xFFFFFF, 1)
                background.drawRoundedRect(bitmap.x, bitmap.y + 1.5, bitmap.textWidth, bitmap.textHeight, 1)

                stage.addChild(background)
                stage.addChild(bitmap)

                s.bitmaps.push(bitmap)

            }

        })

}
