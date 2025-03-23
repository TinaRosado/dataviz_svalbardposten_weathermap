// CSS

import '../node_modules/css-reset-and-normalize/css/reset-and-normalize.min.css'
import './assets/main.css'

// Libraries

import { csv, xml, image, extent, min, scaleLinear } from 'd3'
import { Application, BitmapFont, Texture } from 'pixi.js'
import { Viewport } from 'pixi-viewport'

// Assets

import background from './interface/background.js'
import clusters from './interface/clusters.js'
import click from './interface/click.js'
import contours from './interface/contours.js'
import elements from './interface/elements.js'
import fronts from './interface/fronts.js'
import keywords from './interface/keywords.js'
import search from './interface/search.js'

import fontXML from './assets/Lato.fnt'
import fontPNG from './assets/Lato.png'

import backgroundImage from './assets/background.png'

import entities from './data/entities.csv'

// Load

Promise.all([
    csv(entities),
    xml(fontXML),
    image(fontPNG),
    image(backgroundImage),

]).then(([entities, fontXML, fontPNG, backgroundImage]) => {


    // Set dimensions

    const ext_X = extent(entities, e => parseInt(e.x))
    const ext_Y = extent(entities, e => parseInt(e.y))
    const margin = 150
    const smallerDimension = min([window.innerWidth, window.innerHeight])

    const scale_X = scaleLinear().domain(ext_X).range([margin, smallerDimension - margin])
    const scale_Y = scaleLinear().domain(ext_Y).range([margin, smallerDimension - margin])

    const marginTop = window.innerWidth > window.innerHeight ? 0 : (window.innerHeight - window.innerWidth) / 2
    const marginLeft = window.innerWidth < window.innerHeight ? 0 : (window.innerWidth - window.innerHeight) / 2


    // Parsing

    entities.map(e => {
        e.x = marginLeft + parseInt(scale_X(e.x))
        e.y = marginTop + parseInt(scale_Y(e.y))
        e.color = '0x' + e.color.substring(1)

        // console.log(e)
        // e.temperature = parseFloat(e.temperature)
        // e.frequency_norm = parseFloat(e.frequency_norm)
        // e.slope = parseFloat(e.slope)
        // e.urls = e.urls.substring(2).substring(0, e.urls.length - 2).split("', '")
        // e.years_JSON = JSON.parse(e.years_JSON)
        return e
    })


    // Set variables

    window.s = {
        'entities': entities,
        'bitmaps': [], // Collector of bitmaps for overlapping
        'blue': 0x385DA6,
        'red': 0xA6242F,
        'gray': 0x666666,
        'contours': 0xCCCCCC,
    }

    BitmapFont.install(fontXML, Texture.from(fontPNG)) // Font loader


    // Test random element
    // const randomElement = entities[Math.floor(Math.random() * entities.length)]
    // console.log(randomElement)
    // click(randomElement)





    // Set app

    s.app = new Application({
        antialias: true,
        resolution: 2, // Interface
        // resolution: 8, // Canvas export
        autoDensity: true,
        autoResize: true,
        resizeTo: window,
        preserveDrawingBuffer: true,
    })

    document.body.prepend(s.app.view)


    // Set viewport

    s.viewport = new Viewport({
        worldWidth: window.innerWidth,
        worldHeight: window.innerHeight,
        interaction: s.app.renderer.plugins.interaction
    }).drag().pinch().wheel().decelerate()
        .clampZoom({
            minWidth: 50, minHeight: 50,
            maxWidth: window.innerWidth,
            maxHeight: window.innerHeight
        })
        .clamp({ direction: 'all' })

    s.app.stage.addChild(s.viewport)


    // Transparency on zoom

    let scale
    const zoomOut = scaleLinear().domain([6, 1]).range([0, 1]) // Visible when zooming out
    const zoomIn = scaleLinear().domain([6, 1]).range([1, 0]) // Visible when zooming in

    s.viewport.on('zoomed', e => {

        try { scale = e.viewport.lastViewport.scaleX } catch { scale = 1 }

        e.viewport.children.find(child => child.name == 'fronts').alpha = zoomOut(scale)
        e.viewport.children.find(child => child.name == 'clusters').alpha = zoomOut(scale)
        e.viewport.children.find(child => child.name == 'contours').alpha = zoomOut(scale)
        e.viewport.children.find(child => child.name == 'keywords').alpha = zoomOut(scale)

        e.viewport.children.find(child => child.name == 'elements').alpha = zoomIn(scale)
    })


    // Rendering

    background(backgroundImage)
    contours(entities)
    keywords(entities)
    clusters(entities)
    elements(entities)
    fronts(entities)
    // search(data)


    // Viewport exceptions

    window.onresize = () => {
        s.viewport.resize()
    } // Prevent pinch gesture in Chrome

    window.addEventListener('wheel', e => {
        e.preventDefault()
    }, { passive: false }) // Prevent wheel interference

})

// Canvas Export
/*


a = document.createElement("a");
canvas = document.getElementsByTagName("canvas")[0]

function saveCanvas() {
  a.href = canvas.toDataURL();
  a.download = "image.png";
  a.click();
  a.remove();
  
}

setTimeout(saveCanvas, 100)


*/