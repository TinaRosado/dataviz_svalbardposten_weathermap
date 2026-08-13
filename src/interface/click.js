import { select } from 'd3'

// The station report: clicking an article opens a met-bulletin style readout,
// grouped by source — an "Article" block (what Svalbardposten published: date,
// headline, standfirst, excerpt, byline, tags, length) then an "Analysis"
// block (what the Weather Map pipeline derived: High/Low system, cluster
// topic, article keywords), with a link out to the source. The original text
// is Norwegian (*_no columns); prefer the English translations (*_en columns)
// when present.
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
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

// "Last, First" → "First Last" for a natural byline; pass through anything
// that isn't in that shape.
function formatByline(name) {
    if (!name) return ''
    const parts = name.split(',')
    return parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : name.trim()
}

export function click(e) {
    select('#focus').remove() // Replace any previous report

    const tags = e.tags_en || e.tags_no
    const title = e.title_en || e.title_no
    const subtitle = e.subtitle_en || e.subtitle_no
    const excerpt = e.excerpt_en || e.excerpt_no
    const topic = e.cluster_subject_en || e.cluster_subject_no || 'Unlabeled topic'
    const keywords = parseKeywords(e.article_keywords_en || e.article_keywords_no).join(', ')
    const byline = formatByline(e.created_by_name)
    const day = parseInt(e.day)
    const date = day && e.month ? `${day} ${MONTHS[parseInt(e.month) - 1]} ${e.year}` : e.year
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
            meta.append('dd').attr('class', valueClass || null).text(value)
        })
    }

    // From the article (Svalbardposten) — date + title lead.
    section('Article')
    focus.append('p').attr('class', 'readout-date').text(date)
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
    termLine('Keywords', keywords)

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
    select('#focus').remove()
}
