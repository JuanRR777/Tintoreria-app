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

export const APP_VIEWS = [
  { id: 'dashboard', label: 'Dashboard', section: 'General' },
  { id: 'stock', label: 'Inventario', section: 'Laboratorio' },
  { id: 'lab', label: 'Inventario lab', section: 'Laboratorio' },
  { id: 'requests', label: 'Solicitudes', section: 'Laboratorio' },
  { id: 'recipes', label: 'Recetas', section: 'Laboratorio' },
  { id: 'processes', label: 'Procesos', section: 'Producción' },
  { id: 'weighing', label: 'Pesaje', section: 'Producción' },
  { id: 'machines', label: 'Máquinas', section: 'Producción' },
  { id: 'reports', label: 'Reportes', section: 'Análisis' },
]

const VIEW_GRANTS = {
  dashboard: ['dashboard'],
  stock: ['stock', 'quimicos.all', 'quimicos.read'],
  lab: ['lab'],
  requests: ['requests', 'solicitudes'],
  recipes: ['recipes', 'recetas.all', 'recetas.read'],
  processes: ['processes', 'procesos.all'],
  weighing: ['weighing', 'procesos.all'],
  machines: ['machines', 'maquinas.read', 'maquinas.all'],
  reports: ['reports', 'reportes.all'],
}

export function permissionList(raw = currentUser?.permissions) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function viewsFromPermissions(raw) {
  const perms = permissionList(raw)
  if (perms.includes('*')) return APP_VIEWS.map((view) => view.id)
  return APP_VIEWS
    .filter((view) => (VIEW_GRANTS[view.id] || [view.id]).some((grant) => perms.includes(grant)))
    .map((view) => view.id)
}

export function roleGrantsAll(role) {
  return role?.name === 'admin' || permissionList(role?.permissions).includes('*')
}

export function canView(view) {
  if (view === 'settings') return true
  const perms = permissionList()
  if (perms.includes('*')) return true
  return (VIEW_GRANTS[view] || [view]).some((grant) => perms.includes(grant))
}

export function isAdmin() {
  if (permissionList().includes('*')) return true
  const key = sessionRoleKey()
  return key === 'admin' || key === 'administrador'
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
