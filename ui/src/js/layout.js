import { canView, renderUserChip } from './session.js'

export function setPageHeader({ title = '', subtitle = '', actionsHtml = '' } = {}) {
  const titleEl = document.getElementById('app-page-title')
  const subEl = document.getElementById('app-page-subtitle')
  const actionsEl = document.getElementById('app-page-actions')
  if (titleEl) titleEl.textContent = title
  if (subEl) {
    subEl.textContent = subtitle
    subEl.hidden = !subtitle
  }
  if (actionsEl) {
    actionsEl.innerHTML = actionsHtml
    actionsEl.hidden = !actionsHtml
  }
}

export function applyViewAccess() {
  document.querySelectorAll('.sidebar-nav .nav-item').forEach((item) => {
    item.hidden = !canView(item.dataset.view)
  })
  document.querySelectorAll('.sidebar-nav .nav-section').forEach((section) => {
    let next = section.nextElementSibling
    let visible = false
    while (next && !next.classList.contains('nav-section')) {
      if (next.classList.contains('nav-item') && !next.hidden) visible = true
      next = next.nextElementSibling
    }
    section.hidden = !visible
  })
}

export function paintUserChip() {
  const host = document.getElementById('user-chip-host')
  if (host) host.innerHTML = renderUserChip()
}
