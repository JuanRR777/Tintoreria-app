/**
 * Lista flotante reutilizable (no altera el alto de la tarjeta).
 * Un solo panel abierto a la vez; se cierra al clic fuera, Escape o scroll externo.
 */

let _open = null

function place(anchor, panel) {
  const r = anchor.getBoundingClientRect()
  const gap = 6
  const pad = 8
  const maxW = Math.max(160, window.innerWidth - pad * 2)
  const width = Math.min(Math.max(r.width, 240), maxW)
  panel.style.width = `${width}px`

  let left = r.left
  if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad
  if (left < pad) left = pad
  panel.style.left = `${left}px`

  panel.style.maxHeight = 'none'
  const spaceBelow = window.innerHeight - r.bottom - gap - pad
  const spaceAbove = r.top - gap - pad
  const h = panel.offsetHeight
  const openAbove = h > spaceBelow && spaceAbove > spaceBelow

  if (openAbove) {
    const shown = Math.min(h, Math.max(0, spaceAbove))
    if (shown < h) panel.style.maxHeight = `${shown}px`
    panel.style.top = `${Math.max(pad, r.top - shown - gap)}px`
  } else {
    panel.style.top = `${r.bottom + gap}px`
  }
}

function bindAnchor(anchor, open) {
  if (!anchor) return
  anchor.classList.toggle('is-float-open', open)
  if (anchor.hasAttribute('aria-expanded')) {
    anchor.setAttribute('aria-expanded', open ? 'true' : 'false')
  }
}

export function closeFloatList() {
  if (!_open) return
  const { panel, anchor, onDoc, onKey, onShift } = _open
  panel.remove()
  bindAnchor(anchor, false)
  document.removeEventListener('pointerdown', onDoc, true)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('scroll', onShift, true)
  window.removeEventListener('resize', onShift)
  _open = null
}

export function isFloatListOpen(anchor) {
  return Boolean(_open && _open.anchor === anchor)
}

export function openFloatList(anchor, html, { onBind } = {}) {
  closeFloatList()

  const panel = document.createElement('div')
  panel.className = 'float-list'
  panel.innerHTML = html
  document.body.appendChild(panel)
  place(anchor, panel)
  bindAnchor(anchor, true)

  const onDoc = (e) => {
    if (panel.contains(e.target) || anchor.contains(e.target)) return
    closeFloatList()
  }
  const onKey = (e) => { if (e.key === 'Escape') closeFloatList() }
  const onShift = (e) => {
    if (e.type === 'scroll' && panel.contains(e.target)) return
    closeFloatList()
  }
  document.addEventListener('pointerdown', onDoc, true)
  document.addEventListener('keydown', onKey)
  window.addEventListener('scroll', onShift, true)
  window.addEventListener('resize', onShift)

  _open = { panel, anchor, onDoc, onKey, onShift }
  onBind?.(panel)
  requestAnimationFrame(() => {
    if (_open?.panel === panel) place(anchor, panel)
  })
  return panel
}

export function updateFloatList(html, { onBind } = {}) {
  if (!_open) return null
  _open.panel.innerHTML = html
  place(_open.anchor, _open.panel)
  onBind?.(_open.panel)
  requestAnimationFrame(() => {
    if (_open) place(_open.anchor, _open.panel)
  })
  return _open.panel
}
