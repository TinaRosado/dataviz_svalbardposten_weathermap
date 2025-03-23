import { BitmapText, Graphics, Rectangle } from 'pixi.js'

import { click } from './click'

const splitInTwo = string => {
    const middle = Math.round(string.length / 2)
    for (let i = middle, j = middle; i < string.length || j >= 0; i++, j--) {
        if (string[i] === ' ') return string.substring(0, i) + '\n' + string.substring(i + 1)
        if (string[j] === ' ') return string.substring(0, j) + '\n' + string.substring(j + 1)
    }
    return string
}

export default (entities) => {

    const stage = new Graphics()
    stage.alpha = 0
    stage.name = 'elements'
    s.viewport.addChild(stage)

    entities.forEach(e => {

        // Cross

        const length = 1
        const tickness = .2

        const line_1 = new Graphics()
        line_1.lineStyle(tickness, e.color)
        line_1.moveTo(e.x, e.y - length)
        line_1.lineTo(e.x, e.y + length)
        stage.addChild(line_1)

        const line_2 = new Graphics()
        line_2.lineStyle(tickness, e.color)
        line_2.moveTo(e.x - length, e.y)
        line_2.lineTo(e.x + length, e.y)
        stage.addChild(line_2)

        // Label

        const bitmap = new BitmapText(
            e.year,
            {
                fontName: 'Lato',
                fontSize: 1,
                align: 'left',
                tint: e.color,
            })
        bitmap.position.set(e.x + .6, e.y + 0.2)
        stage.addChild(bitmap)


        // Interaction

        bitmap.hitArea = new Rectangle(0, 0, bitmap.textWidth, bitmap.textHeight)
        bitmap.interactive = true
        bitmap.buttonMode = true

        bitmap.click = event => { click(e) } // On click



    })

}