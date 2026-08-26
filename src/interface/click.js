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

    // Content is grouped by source into two tabs: what the newspaper
    // published (Article, shown by default) and what the Weather Map
    // pipeline derived from it (Cluster Topic). The tab label stands in for
    // the old .section heading text, so panels don't repeat it inside.
    const tabList = focus.append('div').attr('class', 'report-tabs').attr('role', 'tablist')
    const articlePanel = focus.append('div').attr('class', 'report-panel').attr('role', 'tabpanel')
    const topicPanel = focus
        .append('div')
        .attr('class', 'report-panel')
        .attr('role', 'tabpanel')
        .attr('hidden', true)

    const articleTab = tabList
        .append('button')
        .attr('type', 'button')
        .attr('class', 'report-tab active')
        .attr('role', 'tab')
        .attr('aria-selected', true)
        .text('Article')
    const topicTab = tabList
        .append('button')
        .attr('type', 'button')
        .attr('class', 'report-tab')
        .attr('role', 'tab')
        .attr('aria-selected', false)
        .text('Cluster Topic')

    const showArticleTab = (showArticle) => {
        articleTab.classed('active', showArticle).attr('aria-selected', showArticle)
        topicTab.classed('active', !showArticle).attr('aria-selected', !showArticle)
        articlePanel.attr('hidden', showArticle ? null : true)
        topicPanel.attr('hidden', showArticle ? true : null)
    }
    articleTab.on('click', () => showArticleTab(true))
    topicTab.on('click', () => showArticleTab(false))

    // A labelled term line — "Topic keywords: a, b, c" — used only in the
    // Cluster Topic tab now; the Article tab's own readings (including Tags)
    // are all in the unified grid below instead.
    const termLine = (container, label, value) => {
        if (!value) return
        const p = container.append('p').attr('class', 'readout-terms')
        p.append('span').attr('class', 'readout-terms-label').text(`${label}: `)
        p.append('span').text(value)
    }

    // Instrument readings — label/value pairs in a compact grid. `valueColor`
    // is for the one reading (Date) whose color is per-article, not a fixed
    // class like Title's or System's.
    const readings = (container, pairs) => {
        const meta = container.append('dl').attr('class', 'readout-meta')
        pairs.forEach(([label, value, valueClass, valueColor]) => {
            if (!value) return
            meta.append('dt').text(label)
            const dd = meta
                .append('dd')
                .attr('class', valueClass || null)
                .text(value)
            if (valueColor) dd.style('color', valueColor)
        })
    }

    // ---- Article tab — what Svalbardposten published, as one unified
    // label/value grid so every reading (including Tags now) lines up the
    // same way. Two exceptions to the panel's otherwise uniform gray: Title
    // and Keywords (see main.css's dd.readout-value-ink) in ink, and Date,
    // tinted with this article's own year-color, same mapping as the map.
    readings(articlePanel, [
        ['Date', date, null, articleColor(e)],
        ['Title', title, 'readout-value-ink'],
        ['Subtitle', subtitle],
        ['Keywords', articleKeywords, 'readout-value-ink'],
        ['Excerpt', excerpt && `"${excerpt}"`],
        ['Length', e.word_count && `${e.word_count} words`],
        ['Byline', byline],
        ['Tags', tags],
    ])
    articlePanel
        .append('a')
        .attr('class', 'readout-link')
        .attr('href', `https://www.svalbardposten.no${e.published_url}`)
        .attr('target', '_blank')
        .attr('rel', 'noopener')
        .text('Read on svalbardposten.no ↗')

    // ---- Cluster Topic tab — what the Weather Map pipeline derived. Article
    // keywords live in the Article tab instead, so they aren't repeated here.
    readings(topicPanel, [
        ['System', system, systemClass],
        ['Topic', topic],
    ])
    termLine(topicPanel, 'Topic keywords', topicKeywords)

    // Match both tabs to the taller one's natural content height so
    // switching tabs doesn't resize the panel — #focus is anchored by
    // `bottom` (see main.css), so a height change would visibly shift it up
    // or down instead of just swapping content in place.
    topicPanel.attr('hidden', null)
    const maxHeight = Math.max(articlePanel.node().offsetHeight, topicPanel.node().offsetHeight)
    topicPanel.attr('hidden', true)
    articlePanel.style('min-height', `${maxHeight}px`)
    topicPanel.style('min-height', `${maxHeight}px`)
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
