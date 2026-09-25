/**
 * Modal reutilizable
 */

let _resolveConfirm = null
let _onClose = null
let _onRequestClose = null

function hideModal() {
  const overlay = document.getElementById('modal-overlay')
  overlay.style.display = 'none'
  const done = _onClose
  _onClose = null
  _onRequestClose = null
  if (done) done()
  if (_resolveConfirm) { _resolveConfirm(false); _resolveConfirm = null }
}

async function requestClose() {
  if (_onRequestClose) {
    const ok = await _onRequestClose()
    if (ok === false) return
  }
  hideModal()
}

export function openModal(title, bodyHTML, {
  size = '',
  footerHTML = '',
  onClose,
  onRequestClose,
  closeOnOverlay = true,
} = {}) {
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
  _onClose = onClose || null
  _onRequestClose = onRequestClose || null

  const closeBtn = document.getElementById('modal-close')
  closeBtn.onclick = () => { requestClose() }
  overlay.onclick  = (e) => { if (e.target === overlay && closeOnOverlay) requestClose() }

  return bodyEl
}

export function closeModal() {
  hideModal()
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
