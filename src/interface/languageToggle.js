import { setLanguage, getLanguage } from './language.js'
import { articleColor } from './click.js'

// Wires the NO | ENG control in the masthead (#title, index.html) to the
// shared language state (language.js) — data only: article/topic text
// switches, fixed chrome (legend, section labels, etc.) stays English. The
// active option is tinted with the map's own 2024 year-color (the most
// recent, reddest year in the archive), matching the map's own palette
// rather than a generic theme accent; the inactive option is plain light
// gray (see main.css's .lang-option).
export default (entities) => {
    const container = document.getElementById('lang-toggle')
    if (!container) return

    const year2024 = entities.find((e) => parseInt(e.year, 10) === 2024)
    const activeColor = year2024 ? articleColor(year2024) : 'var(--high)'

    const buttons = Array.from(container.querySelectorAll('.lang-option'))

    const refresh = () => {
        const lang = getLanguage()
        buttons.forEach((btn) => {
            const isActive = btn.dataset.lang === lang
            btn.classList.toggle('active', isActive)
            btn.style.color = isActive ? activeColor : ''
        })
    }

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            setLanguage(btn.dataset.lang)
            refresh()
        })
    })

    refresh()
}
