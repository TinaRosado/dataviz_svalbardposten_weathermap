import { select } from 'd3'
import { pickField, onLanguageChange } from './language.js'

// The station report: clicking an article opens a met-bulletin style readout,
// grouped by source — an "Article" block (what Svalbardposten published: date,
// headline, standfirst, excerpt, byline, tags, length) then an "Analysis"
// block (what the Weather Map pipeline derived: High/Low system, cluster
// topic, article keywords), with a link out to the source. Bilingual fields
// are read via pickField() (language.js) — English by default, Norwegian
// once the masthead toggle is switched — falling back to the other language
// when a translation is missing for this row.
const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
]

// The CSV keyword columns hold a JSON array string (e.g. '["fjord", "climate"]').
// Defensive against already-parsed arrays and missing/malformed values, which
// return an empty array rather than throwing or leaking raw JSON syntax.
export function parseKeywords(value) {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string' || !value) return []
    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

// "29 October 2018" - shared with tooltip.js so both read an article's date
// identically.
export function formatDate(e) {
    const day = parseInt(e.day)
    return day && e.month ? `${day} ${MONTHS[parseInt(e.month) - 1]} ${e.year}` : e.year
}

// index.js rewrites the CSV's "#rrggbb" into "0xrrggbb" (for PixiJS tint) -
// this reconstructs a CSS-valid hex color from that, so the same per-article
// year-color can tint DOM text (the station report's date, the hover
// tooltip's), not just canvas fills.
export function articleColor(e) {
    return '#' + e.color.slice(2)
}

// "Last, First" → "First Last" for a natural byline; pass through anything
// that isn't in that shape.
function formatByline(name) {
    if (!name) return ''
    const parts = name.split(',')
    return parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : name.trim()
}

// The currently open report's entity, if any — kept so a language change can
// re-render the same report in place rather than leaving it showing stale
// text in the previous language.
let lastEntity = null

export function click(e) {
    lastEntity = e
    renderReport(e)
}

function renderReport(e) {
    select('#focus').remove() // Replace any previous report

    const tags = pickField(e, 'tags')
    const title = pickField(e, 'title')
    const subtitle = pickField(e, 'subtitle')
    const excerpt = pickField(e, 'excerpt')
    const topic = pickField(e, 'cluster_subject') || 'Unlabeled topic'
    const articleKeywords = parseKeywords(pickField(e, 'article_keywords')).join(', ')
    const topicKeywords = parseKeywords(pickField(e, 'top_keywords')).join(', ')
    const byline = formatByline(e.created_by_name)
    const date = formatDate(e)
    // temperature keys the weather metaphor: warm (>0) = High/emerging, else Low.
    const system = parseFloat(e.temperature) > 0 ? 'High' : 'Low'
    const systemClass = parseFloat(e.temperature) > 0 ? 'hi' : 'lo'

    const focus = select('body').append('div').attr('id', 'focus')

    // Content is grouped by source: what the newspaper published (Article) and
    // what the Weather Map pipeline derived from it (Analysis).
    const section = (label) => focus.append('p').attr('class', 'section').text(label)

    // Labelled term lines — "Tags: a, b, c" / "Keywords: a, b, c".
    const termLine = (label, value) => {
        if (!value) return
        const p = focus.append('p').attr('class', 'readout-terms')
        p.append('span').attr('class', 'readout-terms-label').text(`${label}: `)
        p.append('span').text(value)
    }

    // Instrument readings — label/value pairs in a compact grid.
    const readings = (pairs) => {
        const meta = focus.append('dl').attr('class', 'readout-meta')
        pairs.forEach(([label, value, valueClass]) => {
            if (!value) return
            meta.append('dt').text(label)
            meta.append('dd')
                .attr('class', valueClass || null)
                .text(value)
        })
    }

    // From the article (Svalbardposten) — date + title lead. The date is
    // tinted with this article's own year-color, same mapping as the map.
    section('Article')
    focus.append('p').attr('class', 'readout-date').style('color', articleColor(e)).text(date)
    focus.append('h1').attr('class', 'readout-title').text(title)
    if (subtitle) focus.append('p').attr('class', 'readout-sub').text(subtitle)
    if (excerpt) focus.append('p').attr('class', 'readout-excerpt').text(excerpt)
    readings([
        ['Byline', byline],
        ['Length', e.word_count && `${e.word_count} words`],
    ])
    termLine('Tags', tags)

    // From the analysis (Weather Map pipeline) — derived placement/topic.
    section('Analysis')
    readings([
        ['System', system, systemClass],
        ['Topic', topic],
    ])
    termLine('Topic keywords', topicKeywords)
    termLine('Article keywords', articleKeywords)

    focus
        .append('a')
        .attr('class', 'readout-link')
        .attr('href', `https://www.svalbardposten.no${e.published_url}`)
        .attr('target', '_blank')
        .attr('rel', 'noopener')
        .text('Read on svalbardposten.no ↗')
}

// Close the station report — used when the user clicks empty map (deselect).
export function deselect() {
    lastEntity = null
    select('#focus').remove()
}

// Re-render the open report in place when the language toggle changes —
// no-ops if nothing is currently open.
onLanguageChange(() => {
    if (lastEntity) renderReport(lastEntity)
})
