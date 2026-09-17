/**
 * Modal reutilizable
 */

let _resolveConfirm = null

export function openModal(title, bodyHTML, { size = '', footerHTML = '', onClose } = {}) {
  const overlay = document.getElementById('modal-overlay')
  const box     = document.getElementById('modal-box')
  const titleEl = document.getElementById('modal-title')
  const bodyEl  = document.getElementById('modal-body')
  const footerEl = document.getElementById('modal-footer')

  titleEl.textContent = title
  bodyEl.innerHTML    = bodyHTML
  footerEl.innerHTML  = footerHTML || ''

  box.className = `modal-box${size ? ' modal-' + size : ''}`
  overlay.style.display = 'flex'

  const closeBtn = document.getElementById('modal-close')
  const close = () => {
    overlay.style.display = 'none'
    if (onClose) onClose()
    if (_resolveConfirm) { _resolveConfirm(false); _resolveConfirm = null }
  }

  closeBtn.onclick = close
  overlay.onclick  = (e) => { if (e.target === overlay) close() }

  // Retornar el body element para que el caller pueda agregar listeners
  return bodyEl
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay')
  overlay.style.display = 'none'
  if (_resolveConfirm) { _resolveConfirm(false); _resolveConfirm = null }
}

/**
 * Modal de confirmacion - retorna una Promise<boolean>
 */
export function confirm(message, title = 'Confirmar') {
  return new Promise((resolve) => {
    _resolveConfirm = resolve

    const footer = `
      <button class="btn btn-secondary" id="confirm-cancel">Cancelar</button>
      <button class="btn btn-danger"    id="confirm-ok">Confirmar</button>
    `
    openModal(title, `<p style="margin:0;font-size:14px;color:var(--text-secondary)">${message}</p>`, {
      size:       'sm',
      footerHTML: footer,
    })

    document.getElementById('confirm-cancel').onclick = () => { resolve(false); _resolveConfirm = null; closeModal() }
    document.getElementById('confirm-ok').onclick     = () => { resolve(true);  _resolveConfirm = null; closeModal() }
  })
}
