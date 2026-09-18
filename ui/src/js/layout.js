import { renderUserChip } from './session.js'

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

export function paintUserChip() {
  const host = document.getElementById('user-chip-host')
  if (host) host.innerHTML = renderUserChip()
}
