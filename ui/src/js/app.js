/**
 * app.js - Punto de entrada de la aplicacion
 * Maneja login, autenticacion, navegacion sidebar y estado global
 */
import { auth, stock, setToken, clearToken, setApiBase, getToken } from './api.js'
import { initRouter, navigate }  from './router.js'
import { toast }                 from './components/toast.js'
import { refreshVersionLabels }  from './appVersion.js'
import { applyViewAccess, paintUserChip } from './layout.js'
import { canView } from './session.js'
import { setSession, clearSession, getSession } from './session.js'

const TOKEN_KEY = 'tintoreria_token'
const SIDEBAR_COLLAPSED_KEY = 'tintoreria_sidebar_collapsed'

// ---------------------------------------------------------------------------
// Inicializacion
// ---------------------------------------------------------------------------

async function init() {
  // Obtener URL de la API desde Electron si esta disponible
  if (window.electron?.getApiUrl) {
    const url = await window.electron.getApiUrl()
    if (url) setApiBase(url)
  }

  // Inicializar router
  initRouter(
    document.getElementById('view-container'),
    (viewName) => updateSidebarActive(viewName)
  )

  // Ligar items del sidebar
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.view))
  })

  // Toggle de sidebar colapsado
  setupSidebarCollapse()

  // Boton logout
  document.getElementById('btn-logout')?.addEventListener('click', logout)

  document.getElementById('btn-app-settings')?.addEventListener('click', () => navigate('settings'))
  document.getElementById('btn-app-notif')?.addEventListener('click', () => {
    toast.info('No hay notificaciones nuevas')
  })

  // Login form
  document.getElementById('login-form')?.addEventListener('submit', handleLogin)

  await refreshVersionLabels()
  startIdleWatch()

  // Verificar token existente
  const savedToken = localStorage.getItem(TOKEN_KEY)
  if (savedToken) {
    setToken(savedToken)
    try {
      const user = await auth.me()
      showApp(user)
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      clearToken()
      showLogin()
    }
  } else {
    showLogin()
  }
}

// ---------------------------------------------------------------------------
// Login / Logout
// ---------------------------------------------------------------------------

async function handleLogin(e) {
  e.preventDefault()
  const username = document.getElementById('username')?.value.trim()
  const password = document.getElementById('password')?.value
  const errEl    = document.getElementById('login-error')
  const btn      = document.querySelector('#login-form button[type="submit"]')

  if (!username || !password) {
    if (errEl) { errEl.textContent = 'Ingresa usuario y contrasena'; errEl.style.display = 'block' }
    return
  }

  if (errEl) errEl.style.display = 'none'
  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando...' }

  try {
    const result = await auth.login(username, password)
    const token  = result.access_token

    localStorage.setItem(TOKEN_KEY, token)
    setToken(token)

    const user = result.user
    showApp(user)
  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Credenciales incorrectas'; errEl.style.display = 'block' }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Ingresar' }
  }
}

async function logout() {
  clearTimeout(idleTimer)
  try { await auth.logout() } catch { /* ignorar */ }
  localStorage.removeItem(TOKEN_KEY)
  clearToken()
  clearSession()
  showLogin()
}

let idleTimer = null
let idleNotedAt = 0

function idleMinutes() {
  const minutes = Number(getSession()?.idle_minutes)
  if (!Number.isFinite(minutes)) return 30
  return minutes > 0 ? minutes : 0
}

function armIdle() {
  clearTimeout(idleTimer)
  const app = document.getElementById('app')
  const minutes = idleMinutes()
  if (!minutes || !app || app.style.display === 'none') return
  idleTimer = setTimeout(() => {
    toast.info('Sesión cerrada por inactividad')
    logout()
  }, minutes * 60 * 1000)
}

function noteActivity() {
  const now = Date.now()
  if (now - idleNotedAt < 1000) return
  idleNotedAt = now
  armIdle()
}

function startIdleWatch() {
  ;['pointerdown', 'keydown', 'mousemove', 'wheel'].forEach((eventName) => {
    window.addEventListener(eventName, noteActivity, { passive: true })
  })
  window.addEventListener('tintoreria-idle-change', armIdle)
}

// ---------------------------------------------------------------------------
// Mostrar login / app
// ---------------------------------------------------------------------------

function showLogin() {
  clearSession()
  document.getElementById('login-screen').style.display  = 'flex'
  document.getElementById('app').style.display           = 'none'
  document.getElementById('username')?.focus()
  refreshVersionLabels()
}

function showApp(user) {
  setSession(user)
  document.getElementById('login-screen').style.display = 'none'
  document.getElementById('app').style.display          = 'flex'
  refreshVersionLabels()

  paintUserChip()
  applyViewAccess()
  armIdle()

  const landing = ['dashboard', 'stock', 'lab', 'requests', 'recipes', 'processes', 'weighing', 'machines', 'reports', 'settings']
    .find((view) => canView(view))
  navigate(landing || 'settings')

  // Actualizar badge de stock bajo periodicamente
  refreshLowStockBadge()
  setInterval(refreshLowStockBadge, 5 * 60_000)
}

// ---------------------------------------------------------------------------
// Sidebar helpers
// ---------------------------------------------------------------------------

function updateSidebarActive(viewName) {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewName)
  })
}

function setupSidebarCollapse() {
  const appLayout = document.getElementById('app')
  const toggleBtn = document.getElementById('btn-sidebar-toggle')
  if (!appLayout || !toggleBtn) return

  const storedState = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  appLayout.classList.toggle('sidebar-collapsed', storedState)
  updateSidebarToggleLabel(toggleBtn, storedState)

  // Tooltip en modo icon-only
  document.querySelectorAll('.nav-item').forEach((item) => {
    const label = item.querySelector('span:not(.nav-badge)')
    if (label) {
      const text = label.textContent.trim()
      item.dataset.label = text
      item.setAttribute('aria-label', text)
    }
  })

  toggleBtn.addEventListener('click', () => {
    const collapsed = appLayout.classList.toggle('sidebar-collapsed')
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
    updateSidebarToggleLabel(toggleBtn, collapsed)
  })
}

function updateSidebarToggleLabel(button, collapsed) {
  const title = collapsed ? 'Expandir menu' : 'Contraer menu'
  button.title = title
  button.setAttribute('aria-label', title)
}

async function refreshLowStockBadge() {
  const badge = document.getElementById('badge-low-stock')
  if (!badge) return
  try {
    const summary = await stock.summary()
    if (summary.low_stock_count > 0) {
      badge.textContent   = summary.low_stock_count
      badge.style.display = 'inline-flex'
    } else {
      badge.style.display = 'none'
    }
  } catch { /* ignorar silenciosamente */ }
}

// ---------------------------------------------------------------------------
// Arrancar
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init)
