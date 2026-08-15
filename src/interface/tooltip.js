import { select } from 'd3'
import { parseKeywords, formatDate, articleColor } from './click.js'
import { pickField, onLanguageChange } from './language.js'

// Hover tooltip — a glance-level readout (date, title, keywords, topic), in
// that order, for whichever single article pointGradient.js currently has
// hovered (see its refreshHighlight for the accompanying ring on the circle
// itself). Deliberately separate from click.js's #focus station report: this
// is a lightweight hint shown while hovering, not the full multi-section
// report opened on click — the two coexist rather than one replacing the
// other. Same date format as that report's "Article" block, so the two read
// consistently.

const CURSOR_OFFSET = 14 // px, both axes — keeps the tooltip clear of the pointer itself

let node = null
// The currently shown tooltip's entity + last cursor position, so a language
// change can redraw its text in place instead of leaving it stale.
let lastEntity = null
let lastPos = null

const ensureNode = () => {
    if (node) return node
    node = select('body').append('div').attr('id', 'tooltip')
    return node
}

// Clamped so the tooltip never overflows past the right/bottom edge of the
// viewport — flips to the other side of the cursor instead of clipping.
const position = (clientX, clientY) => {
    const el = node.node()
    const rect = el.getBoundingClientRect()
    let x = clientX + CURSOR_OFFSET
    let y = clientY + CURSOR_OFFSET
    if (x + rect.width > window.innerWidth) x = clientX - CURSOR_OFFSET - rect.width
    if (y + rect.height > window.innerHeight) y = clientY - CURSOR_OFFSET - rect.height
    node.style('left', `${Math.max(0, x)}px`).style('top', `${Math.max(0, y)}px`)
}

const render = (e) => {
    const title = pickField(e, 'title')
    const cluster = pickField(e, 'cluster_subject')
    const date = formatDate(e)
    const keywords = parseKeywords(pickField(e, 'article_keywords')).join(', ')

    node.html('')
    node.append('p').attr('class', 'tooltip-date').style('color', articleColor(e)).text(date)
    node.append('p').attr('class', 'readout-title').text(title)
    if (keywords) {
        const kw = node.append('p').attr('class', 'readout-terms')
        kw.append('span').attr('class', 'readout-terms-label').text('Keywords: ')
        kw.append('span').text(keywords)
    }
    if (cluster) {
        const tp = node.append('p').attr('class', 'readout-terms')
        tp.append('span').attr('class', 'readout-terms-label').text('Topic: ')
        tp.append('span').text(cluster)
    }
}

export function showTooltip(e, clientX, clientY) {
    const tooltip = ensureNode()
    lastEntity = e
    lastPos = [clientX, clientY]
    render(e)
    tooltip.style('display', 'block')
    position(clientX, clientY)
}

export function hideTooltip() {
    lastEntity = null
    node?.style('display', 'none')
}

// Redraw the tooltip's text in place when the language toggle changes, but
// only while it's actually being shown for some hovered article.
onLanguageChange(() => {
    if (!lastEntity || !node) return
    render(lastEntity)
    position(lastPos[0], lastPos[1])
})
