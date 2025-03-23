import { Graphics } from 'pixi.js'
import { contourDensity, extent } from 'd3'

const width = .5
const cellSize = 1
const bandwidth = 30 // Extension
const thresholds = 15

export default entities => {

    const stage = new Graphics()
    stage.interactiveChildren = false
    stage.name = 'contours'
    stage.alpha = 1
    s.viewport.addChild(stage)

    const density = contourDensity()
        .x(e => e.x)
        .y(e => e.y)
        // .weight(e => e['frequency'])
        // .weight(e => Math.abs(e['slope']))
        // .weight(e => Math.log(Math.abs(e['slope'])) + 3) // 2 is the normalization of the values
        .weight(e => 10) // 2 is the normalization of the values
        .size([window.innerWidth, window.innerHeight])
        // .size([wind10)
        .cellSize(cellSize)
        .bandwidth(bandwidth)
        .thresholds(thresholds)
        (entities)

    stage.lineStyle(width, s.contours)

    density.forEach(layer => {
        layer.coordinates.forEach(array => {
            array[0].forEach(([x, y], i) => {
                if (i == 0) stage.moveTo(x, y)
                stage.lineTo(x, y)
            })
        })
    })

    stage.closePath()

}