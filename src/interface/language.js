// Shared language state for the data-only NO/ENG toggle. Every bilingual CSV
// column (title_en/no, tags_en/no, cluster_subject_en/no, etc.) is read
// through pickField() so click.js/tooltip.js/elements.js/clusters.js switch
// together when the map's masthead toggle changes language. Fixed UI chrome
// (legend, section headings, panel labels like "Keywords:") stays
// English-only for now — only the article/topic data itself changes.
let language = 'en' // English is the default

const listeners = new Set()

export function getLanguage() {
    return language
}

// Returns an unsubscribe function, same shape as other listener APIs in this
// codebase (e.g. pixi-viewport's .on()/.off() pairing).
export function onLanguageChange(callback) {
    listeners.add(callback)
    return () => listeners.delete(callback)
}

export function setLanguage(lang) {
    if (lang === language) return
    language = lang
    listeners.forEach((callback) => callback(language))
}

// Reads a bilingual field pair (`${base}_en`/`${base}_no`), preferring the
// current language and falling back to the other when that translation is
// missing for this row.
export function pickField(e, base) {
    const primary = language === 'en' ? `${base}_en` : `${base}_no`
    const secondary = language === 'en' ? `${base}_no` : `${base}_en`
    return e[primary] || e[secondary]
}
