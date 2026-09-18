let currentUser = null

const ROLE_LABELS = {
  admin: 'Admin',
  laboratorio: 'Laboratorio',
  produccion: 'Produccion',
  consulta: 'Consulta',
}

export function setSession(user) {
  currentUser = user ? { ...user } : null
}

export function clearSession() {
  currentUser = null
}

export function getSession() {
  return currentUser
}

export function sessionDisplayName() {
  const name = String(currentUser?.full_name || currentUser?.username || 'Usuario').trim()
  if (/^administrador del sistema$/i.test(name)) return 'Administrador'
  return name || 'Usuario'
}

export function sessionRoleKey() {
  return String(currentUser?.role_name || '').trim().toLowerCase().replace(/\s+/g, '_')
}

export function sessionRoleLabel() {
  const key = sessionRoleKey()
  return ROLE_LABELS[key] || currentUser?.role_name || 'Usuario'
}

export function sessionInitials() {
  const name = sessionDisplayName().trim()
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function renderUserChip() {
  const name = sessionDisplayName()
  const role = sessionRoleKey()
  const label = sessionRoleLabel()
  const initials = sessionInitials()
  return `
    <div class="user-chip" title="${esc(name)} · ${esc(label)}">
      <div class="chip-av">${esc(initials)}</div>
      <span class="chip-name">${esc(name)}</span>
      <span class="role-badge ${esc(role)}">${esc(label)}</span>
    </div>`
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
