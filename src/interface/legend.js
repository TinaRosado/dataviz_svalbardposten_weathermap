// Legend collapse toggle — the static #legenda panel (index.html) can be
// collapsed to just its heading + caret, so it doesn't crowd the map once
// expanded. Pure DOM, no Pixi/entities dependency, so it's wired immediately
// rather than waiting on the map's data load.
export default () => {
    const toggle = document.getElementById('legenda-toggle')
    const body = document.getElementById('legenda-body')
    if (!toggle || !body) return

    toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true'
        toggle.setAttribute('aria-expanded', String(!expanded))
        body.hidden = expanded
    })
}
