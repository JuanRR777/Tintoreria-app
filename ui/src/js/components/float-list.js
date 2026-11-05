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
  panel.style.height = ''
  panel.style.maxHeight = 'none'

  let left = r.left
  if (left + width > window.innerWidth - pad) left = window.innerWidth - width - pad
  if (left < pad) left = pad
  panel.style.left = `${left}px`

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

function placeSide(anchor, panel) {
  const card = anchor.closest('.rc-card, .recipe-card') || anchor
  const r = card.getBoundingClientRect()
  const gap = 12
  const pad = 8
  const width = Math.max(160, r.width)
  const height = Math.max(120, r.height)
  panel.style.width = `${width}px`
  panel.style.height = `${height}px`
  panel.style.maxHeight = `${height}px`

  const spaceRight = window.innerWidth - r.right - gap - pad
  const spaceLeft = r.left - gap - pad
  const openRight = spaceRight >= width || spaceRight >= spaceLeft
  let left = openRight ? r.right + gap : r.left - width - gap
  if (left < pad) left = pad
  if (left + width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - width - pad)
  panel.style.left = `${left}px`
  panel.dataset.side = openRight ? 'right' : 'left'

  let top = r.top
  if (top + height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - height - pad)
  if (top < pad) top = pad
  panel.style.top = `${top}px`
}

function locate(anchor, panel, side) {
  if (side) placeSide(anchor, panel)
  else place(anchor, panel)
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

export function openFloatList(anchor, html, { onBind, side = false } = {}) {
  closeFloatList()

  const panel = document.createElement('div')
  panel.className = side ? 'float-list is-side' : 'float-list'
  panel.innerHTML = html
  document.body.appendChild(panel)
  locate(anchor, panel, side)
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

  _open = { panel, anchor, onDoc, onKey, onShift, side }
  onBind?.(panel)
  requestAnimationFrame(() => {
    if (_open?.panel === panel) locate(anchor, panel, side)
  })
  return panel
}

export function updateFloatList(html, { onBind } = {}) {
  if (!_open) return null
  _open.panel.innerHTML = html
  locate(_open.anchor, _open.panel, _open.side)
  onBind?.(_open.panel)
  requestAnimationFrame(() => {
    if (_open) locate(_open.anchor, _open.panel, _open.side)
  })
  return _open.panel
}
