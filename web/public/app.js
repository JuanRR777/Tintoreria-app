/**
 * Portal web · Tintorería de Hilos
 * SPA sin dependencias. Todo el texto variable pasa por esc() antes de pintarse.
 */

const app = document.getElementById('app')
const toasts = document.getElementById('toasts')

const state = {
  user: null,
  permissions: [],
  idleMinutes: 30,
  config: { turnstile_site_key: '' },
  lastActivity: Date.now(),
  idleTimer: null,
  navOpen: false,
}

const ROLE_OPTIONS = [
  ['admin', 'Administrador'],
  ['gerencia', 'Gerencia'],
  ['compras', 'Compras'],
  ['almacen', 'Almacén'],
  ['consulta', 'Consulta'],
]
const ROLE_TONE = { admin: 'primary', gerencia: 'info', compras: 'warning', almacen: 'success', consulta: '' }

const icons = {
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
  warehouse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8"/><path d="M7 17h10"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.7 2.5 3 5.2"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
  account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.5 12h12L22 7H6.2"/></svg>',
  factory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V11l5 3V11l5 3V7l8 4v10z"/><path d="M7 18h2M12 18h2M17 18h2"/></svg>',
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function fmtDate(value) {
  if (!value) return '—'
  const date = new Date(`${String(value).replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function can(permission) {
  return state.permissions.includes(permission)
}

function toast(message, kind = '') {
  const el = document.createElement('div')
  el.className = `toast${kind ? ` toast-${kind}` : ''}`
  el.textContent = message
  toasts.append(el)
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500)
}

function roleBadge(role, label) {
  const tone = ROLE_TONE[role]
  return `<span class="badge${tone ? ` badge-${tone}` : ''}">${esc(label || role)}</span>`
}

function generatePassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '#$%&*+-=?@']
  const all = sets.join('')
  const pick = (chars) => {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return chars[buf[0] % chars.length]
  }
  const out = sets.map(pick)
  while (out.length < 14) out.push(pick(all))
  for (let i = out.length - 1; i > 0; i -= 1) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    const j = buf[0] % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

function passwordChecks(password, username) {
  const value = String(password || '')
  const user = String(username || '').toLowerCase()
  return [
    ['Al menos 10 caracteres', value.length >= 10],
    ['Una mayúscula y una minúscula', /[A-Z]/.test(value) && /[a-z]/.test(value)],
    ['Un número', /\d/.test(value)],
    ['Un símbolo', /[^A-Za-z0-9]/.test(value)],
    ['No contiene el usuario', !(user.length >= 3 && value.toLowerCase().includes(user))],
  ]
}

function rulesHtml(password, username) {
  return passwordChecks(password, username)
    .map(([label, ok]) => `<li class="${ok ? 'ok' : ''}">${esc(label)}</li>`)
    .join('')
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
    this.handled = false
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  let response
  try {
    response = await fetch(path, options)
  } catch {
    throw new ApiError('Sin conexión. Revisa los datos móviles o el wifi.', 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new ApiError(data.error || `Error ${response.status}`, response.status, data.code)
    if (response.status === 401 && path !== '/api/auth/login' && state.user) {
      err.handled = true
      sessionEnded('Tu sesión terminó. Ingresa de nuevo.')
    } else if (data.code === 'password_change_required') {
      err.handled = true
      renderForcedPassword()
    }
    throw err
  }
  return data
}

function reportError(err) {
  if (err && err.handled) return
  toast(err && err.message ? err.message : 'Ocurrió un error', 'error')
}

// ---------------------------------------------------------------------------
// Sesión e inactividad
// ---------------------------------------------------------------------------

function setSession(data) {
  state.user = data.user
  state.permissions = data.permissions || []
  state.idleMinutes = Number(data.idle_minutes) || 30
  state.lastActivity = Date.now()
}

function clearSession() {
  state.user = null
  state.permissions = []
  if (state.idleTimer) clearInterval(state.idleTimer)
  state.idleTimer = null
}

function sessionEnded(message) {
  clearSession()
  renderLogin(message)
}

function startIdleWatch() {
  if (state.idleTimer) clearInterval(state.idleTimer)
  state.idleTimer = setInterval(async () => {
    if (!state.user) return
    if (Date.now() - state.lastActivity > state.idleMinutes * 60 * 1000) {
      try { await api('/api/auth/logout', { method: 'POST', body: {} }) } catch { /* igual se cierra */ }
      sessionEnded('Cerramos tu sesión por inactividad.')
    }
  }, 30 * 1000)
}

for (const evt of ['pointerdown', 'keydown', 'touchstart', 'scroll']) {
  window.addEventListener(evt, () => { state.lastActivity = Date.now() }, { passive: true })
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }) } catch { /* nada */ }
  clearSession()
  history.replaceState(null, '', '#/inicio')
  renderLogin('Cerraste sesión.')
}

// ---------------------------------------------------------------------------
// Login y cambio obligatorio de contraseña
// ---------------------------------------------------------------------------

let turnstileReady = null

function loadTurnstile() {
  if (!state.config.turnstile_site_key) return Promise.resolve(null)
  if (turnstileReady) return turnstileReady
  turnstileReady = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => resolve(window.turnstile)
    script.onerror = () => reject(new Error('No se pudo cargar la verificación de seguridad'))
    document.head.append(script)
  })
  return turnstileReady
}

function authFrame(inner) {
  return `
    <main class="auth">
      <section class="auth-card">
        <div class="auth-brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div><h1>Tintorería de Hilos</h1><p>Portal web</p></div>
        </div>
        ${inner}
      </section>
    </main>`
}

function pwField(id, label, autocomplete, extra = '') {
  return `
    <div class="field">
      <label for="${id}">${esc(label)}</label>
      <div class="pw-wrap">
        <input class="input" id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" required maxlength="128" ${extra}>
        <button type="button" class="pw-toggle" data-toggle="${id}">Mostrar</button>
      </div>
    </div>`
}

function bindPasswordToggles(root) {
  root.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = root.querySelector(`#${btn.dataset.toggle}`)
      const show = input.type === 'password'
      input.type = show ? 'text' : 'password'
      btn.textContent = show ? 'Ocultar' : 'Mostrar'
    })
  })
}

function renderLogin(message = '', tone = 'info') {
  document.title = 'Ingresar · Tintorería de Hilos'
  app.className = ''
  app.innerHTML = authFrame(`
    <h2 class="auth-title">Ingresar</h2>
    <p class="auth-sub">Usa el usuario que te asignó el administrador.</p>
    <form id="login-form" novalidate>
      ${message ? `<p class="${tone === 'error' ? 'form-error' : 'notice'}" id="login-notice">${esc(message)}</p>` : ''}
      <p class="form-error" id="login-error" hidden></p>
      <div class="field">
        <label for="username">Usuario</label>
        <input class="input" id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="64">
      </div>
      ${pwField('password', 'Contraseña', 'current-password')}
      <div id="turnstile-box"></div>
      <button class="btn btn-primary btn-block" type="submit" id="login-submit">Ingresar</button>
    </form>
    <p class="auth-foot">Acceso solo para personal autorizado. La actividad queda registrada.</p>`)

  const form = document.getElementById('login-form')
  const errorBox = document.getElementById('login-error')
  const hideNotice = () => document.getElementById('login-notice')?.remove()
  bindPasswordToggles(form)
  document.getElementById('username').focus()

  let widgetId = null
  loadTurnstile()
    .then((turnstile) => {
      if (!turnstile) return
      widgetId = turnstile.render('#turnstile-box', { sitekey: state.config.turnstile_site_key, language: 'es' })
    })
    .catch((err) => { errorBox.hidden = false; errorBox.textContent = err.message })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const submit = document.getElementById('login-submit')
    const username = form.username.value.trim()
    const password = form.password.value
    if (!username || !password) {
      errorBox.hidden = false
      errorBox.textContent = 'Escribe tu usuario y tu contraseña.'
      return
    }
    submit.disabled = true
    submit.textContent = 'Ingresando…'
    try {
      const body = { username, password }
      if (widgetId !== null && window.turnstile) body.turnstile_token = window.turnstile.getResponse(widgetId)
      const data = await api('/api/auth/login', { method: 'POST', body })
      setSession(data)
      if (state.user.must_change_password) renderForcedPassword()
      else renderShell()
    } catch (err) {
      hideNotice()
      errorBox.hidden = false
      errorBox.textContent = err.message
      form.password.value = ''
      form.password.focus()
      if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId)
    } finally {
      submit.disabled = false
      submit.textContent = 'Ingresar'
    }
  })
}

function renderForcedPassword() {
  document.title = 'Nueva contraseña · Tintorería de Hilos'
  app.className = ''
  const username = state.user ? state.user.username : ''
  app.innerHTML = authFrame(`
    <h2 class="auth-title">Crea tu contraseña</h2>
    <p class="auth-sub">Por seguridad debes cambiar la contraseña temporal antes de continuar.</p>
    <form id="pw-form" novalidate>
      <p class="form-error" id="pw-error" hidden></p>
      ${pwField('current_password', 'Contraseña temporal', 'current-password')}
      ${pwField('new_password', 'Nueva contraseña', 'new-password')}
      <ul class="rules rules-gap" id="pw-rules">${rulesHtml('', username)}</ul>
      ${pwField('confirm_password', 'Repite la nueva contraseña', 'new-password')}
      <button class="btn btn-primary btn-block" type="submit">Guardar y continuar</button>
      <button class="btn btn-ghost btn-block" type="button" id="pw-cancel">Salir</button>
    </form>`)
  const form = document.getElementById('pw-form')
  bindPasswordToggles(form)
  bindPasswordForm(form, async () => {
    const data = await api('/api/auth/me')
    setSession(data)
    toast('Contraseña actualizada', 'success')
    renderShell()
  })
  document.getElementById('pw-cancel').addEventListener('click', logout)
  form.current_password.focus()
}

function bindPasswordForm(form, onDone) {
  const rules = form.querySelector('.rules')
  const errorBox = form.querySelector('.form-error')
  const username = state.user ? state.user.username : ''
  form.new_password.addEventListener('input', () => {
    rules.innerHTML = rulesHtml(form.new_password.value, username)
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    errorBox.hidden = true
    const next = form.new_password.value
    if (passwordChecks(next, username).some(([, ok]) => !ok)) {
      errorBox.hidden = false
      errorBox.textContent = 'La nueva contraseña no cumple todas las reglas.'
      return
    }
    if (next !== form.confirm_password.value) {
      errorBox.hidden = false
      errorBox.textContent = 'Las contraseñas nuevas no coinciden.'
      return
    }
    const submit = form.querySelector('[type="submit"]')
    submit.disabled = true
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: { current_password: form.current_password.value, new_password: next },
      })
      form.reset()
      rules.innerHTML = rulesHtml('', username)
      await onDone()
    } catch (err) {
      if (err.handled) return
      errorBox.hidden = false
      errorBox.textContent = err.message
    } finally {
      submit.disabled = false
    }
  })
}

// ---------------------------------------------------------------------------
// Estructura con menú
// ---------------------------------------------------------------------------

const VIEWS = [
  { id: 'inicio', label: 'Inicio', icon: icons.home, render: viewHome },
  { id: 'conteo', label: 'Conteo físico', icon: icons.clipboard, perm: 'count.register', render: viewCounts },
  { id: 'bodegas', label: 'Bodegas', icon: icons.warehouse, perm: 'warehouses.view', render: viewWarehouses },
  { id: 'usuarios', label: 'Usuarios', icon: icons.users, perm: 'users.manage', section: 'Administración', render: viewUsers },
  { id: 'actividad', label: 'Actividad', icon: icons.activity, perm: 'audit.view', section: 'Administración', render: viewAudit },
  { id: 'cuenta', label: 'Mi cuenta', icon: icons.account, section: 'Cuenta', render: viewAccount },
]

function allowedViews() {
  return VIEWS.filter((v) => !v.perm || can(v.perm))
}

function hashParts() {
  return (location.hash.replace(/^#\/?/, '') || 'inicio').split('/').filter(Boolean)
}

function currentViewId() {
  const id = hashParts()[0] || 'inicio'
  return allowedViews().some((v) => v.id === id) ? id : 'inicio'
}

let viewCleanup = null

function navHtml() {
  let lastSection = null
  let html = '<ul class="nav-list">'
  for (const view of allowedViews()) {
    const section = view.section || null
    if (section !== lastSection) {
      html += `</ul><p class="nav-section">${esc(section)}</p><ul class="nav-list">`
      lastSection = section
    }
    html += `<li><a class="nav-link" href="#/${view.id}" data-view="${view.id}">${view.icon}<span>${esc(view.label)}</span></a></li>`
  }
  return `${html}</ul>`
}

function renderShell() {
  startIdleWatch()
  const user = state.user
  app.className = 'shell'
  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" type="button" id="nav-open" aria-label="Abrir menú" aria-controls="nav" aria-expanded="false">${icons.menu}</button>
      <div class="brand-mark" aria-hidden="true"></div>
      <span class="topbar-title" id="topbar-title">Inicio</span>
    </header>
    <div class="scrim" id="scrim" hidden></div>
    <nav class="nav" id="nav" aria-label="Menú principal">
      <div class="nav-brand">
        <div class="brand-mark" aria-hidden="true"></div>
        <div><strong>Tintorería de Hilos</strong><span>Portal web</span></div>
      </div>
      ${navHtml()}
      <div class="nav-foot">
        <div class="user-chip">
          <div class="avatar" aria-hidden="true">${esc(initials(user.full_name))}</div>
          <div class="user-chip-text"><strong>${esc(user.full_name)}</strong><span>${esc(user.role_label)}</span></div>
        </div>
        <button class="btn btn-sm" type="button" id="logout">Cerrar sesión</button>
      </div>
    </nav>
    <main class="main" id="main" tabindex="-1"></main>`

  document.getElementById('nav-open').addEventListener('click', () => setNav(true))
  document.getElementById('scrim').addEventListener('click', () => setNav(false))
  document.getElementById('logout').addEventListener('click', logout)
  document.getElementById('nav').addEventListener('click', (event) => {
    if (event.target.closest('.nav-link')) setNav(false)
  })
  if (!location.hash) history.replaceState(null, '', '#/inicio')
  route()
}

function setNav(open) {
  state.navOpen = open
  const nav = document.getElementById('nav')
  if (!nav) return
  nav.classList.toggle('open', open)
  document.getElementById('scrim').hidden = !open
  document.getElementById('nav-open').setAttribute('aria-expanded', String(open))
}

let routeSeq = 0

async function route() {
  if (!state.user || state.user.must_change_password) return
  const main = document.getElementById('main')
  if (!main) return
  // Si el usuario cambia de sección antes de que termine de cargar la anterior,
  // la respuesta vieja se descarta y no pinta encima de la nueva.
  const seq = ++routeSeq
  const isCurrent = () => seq === routeSeq
  if (viewCleanup) { try { viewCleanup() } catch { /* nada */ } viewCleanup = null }
  setNav(false)
  const id = currentViewId()
  const params = id === hashParts()[0] ? hashParts().slice(1) : []
  const view = VIEWS.find((v) => v.id === id)
  document.querySelectorAll('.nav-link').forEach((link) => {
    const active = link.dataset.view === id
    link.classList.toggle('active', active)
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
  document.getElementById('topbar-title').textContent = view.label
  document.title = `${view.label} · Tintorería de Hilos`
  main.innerHTML = '<p class="loading">Cargando…</p>'
  try {
    await view.render(main, isCurrent, params)
  } catch (err) {
    if (err.handled || !isCurrent()) return
    main.innerHTML = `<div class="card empty"><p>${esc(err.message)}</p></div>`
  }
}

window.addEventListener('hashchange', route)
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.navOpen) setNav(false)
})

function pageHead(title, subtitle, actions = '') {
  return `
    <div class="page-head">
      <div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
      ${actions ? `<div class="row-actions">${actions}</div>` : ''}
    </div>`
}

// ---------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------

function openDialog({ title, body, submitLabel = 'Guardar', onSubmit, onOpen }) {
  const dialog = document.createElement('dialog')
  dialog.innerHTML = `
    <form novalidate>
      <div class="dialog-head">
        <h3>${esc(title)}</h3>
        <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icons.x}</button>
      </div>
      <div class="dialog-body">
        <p class="form-error" hidden></p>
        ${body}
      </div>
      <div class="dialog-foot">
        <button type="button" class="btn btn-secondary" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
      </div>
    </form>`
  document.body.append(dialog)
  const form = dialog.querySelector('form')
  const errorBox = dialog.querySelector('.form-error')
  dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => dialog.close()))
  dialog.addEventListener('close', () => dialog.remove())
  bindPasswordToggles(dialog)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    errorBox.hidden = true
    const submit = form.querySelector('[type="submit"]')
    submit.disabled = true
    try {
      await onSubmit(form)
      dialog.close()
    } catch (err) {
      if (err.handled) { dialog.close(); return }
      errorBox.hidden = false
      errorBox.textContent = err.message
    } finally {
      submit.disabled = false
    }
  })
  dialog.showModal()
  if (onOpen) onOpen(form)
  return dialog
}

function tempPasswordField(username = '') {
  return `
    <div class="field">
      <label for="temp_password">Contraseña temporal</label>
      <div class="input-group">
        <input class="input mono" id="temp_password" name="temp_password" autocomplete="off" spellcheck="false" required maxlength="128">
        <button class="btn btn-secondary" type="button" data-generate>Generar</button>
        <button class="btn btn-secondary" type="button" data-copy aria-label="Copiar contraseña">Copiar</button>
      </div>
      <ul class="rules">${rulesHtml('', username)}</ul>
      <span class="hint">Entrégala en persona. Al primer ingreso el usuario deberá cambiarla.</span>
    </div>`
}

function bindTempPassword(form, getUsername) {
  const input = form.temp_password
  const rules = input.closest('.field').querySelector('.rules')
  const refresh = () => { rules.innerHTML = rulesHtml(input.value, getUsername()) }
  input.addEventListener('input', refresh)
  form.querySelector('[data-generate]').addEventListener('click', () => {
    input.value = generatePassword()
    refresh()
  })
  form.querySelector('[data-copy]').addEventListener('click', async () => {
    if (!input.value) return
    try {
      await navigator.clipboard.writeText(input.value)
      toast('Contraseña copiada')
    } catch {
      input.select()
      toast('Selecciona y copia la contraseña manualmente')
    }
  })
  input.value = generatePassword()
  refresh()
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

async function viewHome(main) {
  const user = state.user
  const modules = [
    { perm: 'warehouses.view', icon: icons.warehouse, title: 'Bodegas', text: 'Principal, Laboratorio y las que se agreguen.', href: '#/bodegas' },
    { perm: 'count.register', icon: icons.clipboard, title: 'Conteo físico', text: 'Registrar el inventario por bodega y lote desde el celular.', href: '#/conteo' },
    { perm: 'inventory.view', icon: icons.box, title: 'Inventario', text: 'Existencias por bodega y lote.', soon: 'Próximamente' },
    { perm: 'purchases.view', icon: icons.cart, title: 'Compras', text: 'Solicitudes, órdenes y precios.', soon: 'Próximamente' },
    { perm: 'production.view', icon: icons.factory, title: 'Producción', text: 'Procesos y máquinas: referencia, color y estado.', soon: 'Próximamente' },
    { perm: 'users.manage', icon: icons.users, title: 'Usuarios', text: 'Cuentas del portal, roles y accesos.', href: '#/usuarios' },
  ].filter((m) => can(m.perm))

  const card = (m) => {
    const inner = `
      <div class="module-icon">${m.icon}</div>
      <div>
        <h4>${esc(m.title)}</h4>
        <p>${esc(m.text)}</p>
        ${m.soon ? `<span class="badge">${esc(m.soon)}</span>` : ''}
      </div>`
    return m.href
      ? `<a class="card module" href="${m.href}">${inner}</a>`
      : `<div class="card module" aria-disabled="true">${inner}</div>`
  }

  main.innerHTML = `
    <section class="card hello">
      <div class="avatar" aria-hidden="true">${esc(initials(user.full_name))}</div>
      <div><h3>Hola, ${esc(user.full_name.split(' ')[0])}</h3><p>${esc(user.role_label)} · Portal web de la tintorería</p></div>
    </section>
    <p class="section-title">Tus módulos</p>
    <div class="grid grid-2 grid-3">${modules.map(card).join('')}</div>`
}

async function viewWarehouses(main, isCurrent) {
  const manage = can('warehouses.manage')
  const { items } = await api('/api/warehouses')
  if (!isCurrent()) return
  main.innerHTML = `
    ${pageHead('Bodegas', 'Cada conteo físico se hace por bodega.', manage ? '<button class="btn btn-primary" type="button" id="wh-new">Nueva bodega</button>' : '')}
    <div class="list">
      ${items.length ? items.map((w) => `
        <article class="card row">
          <div class="row-main">
            <div class="module-icon">${icons.warehouse}</div>
            <div class="row-text">
              <strong>${esc(w.name)}</strong>
              <span>Código <code>${esc(w.code)}</code></span>
              <div class="row-tags">
                ${w.fixed ? '<span class="badge badge-primary">Enlazada con la app</span>' : ''}
                ${w.is_active ? '<span class="badge badge-success badge-dot">Activa</span>' : '<span class="badge badge-dot">Inactiva</span>'}
              </div>
            </div>
          </div>
          ${manage ? `<div class="row-actions"><button class="btn btn-secondary btn-sm" type="button" data-edit="${w.id}">Editar</button></div>` : ''}
        </article>`).join('') : '<div class="card empty">No hay bodegas.</div>'}
    </div>`

  if (!manage) return
  document.getElementById('wh-new').addEventListener('click', () => {
    openDialog({
      title: 'Nueva bodega',
      submitLabel: 'Crear bodega',
      body: `
        <div class="field">
          <label for="code">Código</label>
          <input class="input mono" id="code" name="code" required maxlength="20" autocapitalize="characters" placeholder="Ej: 10503">
          <span class="hint">Usa el mismo código de SIESA si existe. No se puede cambiar después.</span>
        </div>
        <div class="field"><label for="name">Nombre</label><input class="input" id="name" name="name" required maxlength="60"></div>
        <div class="field"><label for="sort_order">Orden en las listas</label><input class="input" id="sort_order" name="sort_order" type="number" min="0" max="999" value="10" inputmode="numeric"></div>`,
      onSubmit: async (form) => {
        await api('/api/warehouses', {
          method: 'POST',
          body: { code: form.code.value, name: form.name.value, sort_order: form.sort_order.value },
        })
        toast('Bodega creada', 'success')
        route()
      },
      onOpen: (form) => form.code.focus(),
    })
  })
  main.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const w = items.find((x) => x.id === Number(btn.dataset.edit))
      openDialog({
        title: `Editar ${w.name}`,
        body: `
          <div class="field"><label>Código</label><input class="input mono" value="${esc(w.code)}" readonly></div>
          <div class="field"><label for="name">Nombre</label><input class="input" id="name" name="name" required maxlength="60" value="${esc(w.name)}"></div>
          <div class="field"><label for="sort_order">Orden en las listas</label><input class="input" id="sort_order" name="sort_order" type="number" min="0" max="999" value="${esc(w.sort_order)}" inputmode="numeric"></div>
          ${w.fixed
            ? '<p class="notice">Esta bodega está enlazada con los saldos de la app de escritorio y no se puede desactivar.</p>'
            : `<label class="check"><input type="checkbox" name="is_active" ${w.is_active ? 'checked' : ''}> Activa</label>`}`,
        onSubmit: async (form) => {
          const body = { name: form.name.value, sort_order: form.sort_order.value }
          if (!w.fixed) body.is_active = form.is_active.checked
          await api(`/api/warehouses/${w.id}`, { method: 'PUT', body })
          toast('Bodega actualizada', 'success')
          route()
        },
      })
    })
  })
}

function userStatusBadges(u) {
  const tags = []
  if (!u.is_active) tags.push('<span class="badge badge-dot">Inactivo</span>')
  else tags.push('<span class="badge badge-success badge-dot">Activo</span>')
  if (u.locked) tags.push('<span class="badge badge-danger">Bloqueado</span>')
  if (u.must_change_password) tags.push('<span class="badge badge-warning">Debe cambiar contraseña</span>')
  return tags.join('')
}

function roleSelect(selected) {
  return `<select class="select" id="role" name="role" required>
    ${ROLE_OPTIONS.map(([id, label]) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(label)}</option>`).join('')}
  </select>`
}

const ROLE_HELP = 'Administrador: todo. Gerencia: consulta y precios. Compras: compras y precios. Almacén: conteo físico. Consulta: solo ver, sin precios.'

async function viewUsers(main, isCurrent) {
  const { items } = await api('/api/users')
  if (!isCurrent()) return
  main.innerHTML = `
    ${pageHead('Usuarios', 'Cuentas del portal web. Son independientes de la app de escritorio.', '<button class="btn btn-primary" type="button" id="user-new">Nuevo usuario</button>')}
    <div class="list">
      ${items.map((u) => `
        <article class="card row">
          <div class="row-main">
            <div class="avatar" aria-hidden="true">${esc(initials(u.full_name))}</div>
            <div class="row-text">
              <strong>${esc(u.full_name)}</strong>
              <span><code>${esc(u.username)}</code>${u.email ? ` · ${esc(u.email)}` : ''}</span>
              <span>Último ingreso: ${esc(fmtDate(u.last_login_at))}</span>
              <div class="row-tags">${roleBadge(u.role, u.role_label)}${userStatusBadges(u)}</div>
            </div>
          </div>
          <div class="row-actions">
            ${u.locked ? `<button class="btn btn-secondary btn-sm" type="button" data-unlock="${u.id}">Desbloquear</button>` : ''}
            <button class="btn btn-secondary btn-sm" type="button" data-reset="${u.id}">Restablecer contraseña</button>
            <button class="btn btn-secondary btn-sm" type="button" data-edit="${u.id}">Editar</button>
          </div>
        </article>`).join('')}
    </div>`

  const byId = (id) => items.find((u) => u.id === Number(id))

  document.getElementById('user-new').addEventListener('click', () => {
    openDialog({
      title: 'Nuevo usuario',
      submitLabel: 'Crear usuario',
      body: `
        <div class="field"><label for="full_name">Nombre completo</label><input class="input" id="full_name" name="full_name" required maxlength="80" autocomplete="off"></div>
        <div class="field">
          <label for="username">Usuario</label>
          <input class="input mono" id="username" name="username" required maxlength="32" autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="ej: maria.lopez">
          <span class="hint">Minúsculas, números, punto, guion o guion bajo.</span>
        </div>
        <div class="field"><label for="email">Correo (opcional)</label><input class="input" id="email" name="email" type="email" maxlength="120" autocomplete="off"></div>
        <div class="field"><label for="role">Rol</label>${roleSelect('consulta')}<span class="hint">${esc(ROLE_HELP)}</span></div>
        ${tempPasswordField()}`,
      onOpen: (form) => {
        bindTempPassword(form, () => form.username.value)
        form.full_name.addEventListener('input', () => {
          if (form.username.dataset.touched) return
          const parts = form.full_name.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean)
          form.username.value = parts.length >= 2 ? `${parts[0]}.${parts[parts.length - 1]}`.replace(/[^a-z0-9._-]/g, '').slice(0, 32) : (parts[0] || '').replace(/[^a-z0-9._-]/g, '')
        })
        form.username.addEventListener('input', () => { form.username.dataset.touched = '1' })
        form.full_name.focus()
      },
      onSubmit: async (form) => {
        await api('/api/users', {
          method: 'POST',
          body: {
            full_name: form.full_name.value,
            username: form.username.value,
            email: form.email.value,
            role: form.role.value,
            password: form.temp_password.value,
          },
        })
        toast('Usuario creado. Entrégale la contraseña temporal.', 'success')
        route()
      },
    })
  })

  main.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    const u = byId(btn.dataset.edit)
    const self = u.id === state.user.id
    openDialog({
      title: `Editar ${u.full_name}`,
      body: `
        <div class="field"><label>Usuario</label><input class="input mono" value="${esc(u.username)}" readonly></div>
        <div class="field"><label for="full_name">Nombre completo</label><input class="input" id="full_name" name="full_name" required maxlength="80" value="${esc(u.full_name)}"></div>
        <div class="field"><label for="email">Correo (opcional)</label><input class="input" id="email" name="email" type="email" maxlength="120" value="${esc(u.email)}"></div>
        <div class="field"><label for="role">Rol</label>${roleSelect(u.role)}<span class="hint">${esc(ROLE_HELP)}</span></div>
        <label class="check"><input type="checkbox" name="is_active" ${u.is_active ? 'checked' : ''} ${self ? 'disabled' : ''}> Cuenta activa</label>
        ${self ? '<p class="notice">No puedes desactivar tu cuenta ni quitarte el rol de administrador.</p>' : '<p class="notice notice-warning">Si cambias el rol o desactivas la cuenta, sus sesiones abiertas se cierran.</p>'}`,
      onSubmit: async (form) => {
        await api(`/api/users/${u.id}`, {
          method: 'PUT',
          body: {
            full_name: form.full_name.value,
            email: form.email.value,
            role: form.role.value,
            is_active: self ? true : form.is_active.checked,
          },
        })
        toast('Usuario actualizado', 'success')
        route()
      },
    })
  }))

  main.querySelectorAll('[data-reset]').forEach((btn) => btn.addEventListener('click', () => {
    const u = byId(btn.dataset.reset)
    openDialog({
      title: 'Restablecer contraseña',
      submitLabel: 'Restablecer',
      body: `
        <p class="notice notice-warning">${esc(u.full_name)} deberá crear una contraseña nueva al ingresar. Sus sesiones abiertas se cierran.</p>
        ${tempPasswordField(u.username)}`,
      onOpen: (form) => bindTempPassword(form, () => u.username),
      onSubmit: async (form) => {
        await api(`/api/users/${u.id}/password`, { method: 'POST', body: { password: form.temp_password.value } })
        toast('Contraseña restablecida. Entrégala en persona.', 'success')
        if (u.id === state.user.id) { sessionEnded('Restableciste tu propia contraseña. Ingresa con la temporal.'); return }
        route()
      },
    })
  }))

  main.querySelectorAll('[data-unlock]').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true
    try {
      await api(`/api/users/${btn.dataset.unlock}/unlock`, { method: 'POST', body: {} })
      toast('Usuario desbloqueado', 'success')
      route()
    } catch (err) {
      btn.disabled = false
      reportError(err)
    }
  }))
}

const AUDIT_LABELS = {
  login_ok: ['Ingresó', 'success'],
  login_failed: ['Intento fallido', 'danger'],
  account_locked: ['Cuenta bloqueada', 'danger'],
  logout: ['Cerró sesión', ''],
  password_changed: ['Cambió su contraseña', 'info'],
  password_change_failed: ['Cambio de contraseña fallido', 'warning'],
  user_created: ['Creó usuario', 'primary'],
  user_updated: ['Editó usuario', 'primary'],
  password_reset: ['Restableció contraseña', 'warning'],
  user_unlocked: ['Desbloqueó usuario', 'primary'],
  warehouse_created: ['Creó bodega', 'primary'],
  warehouse_updated: ['Editó bodega', 'primary'],
  count_opened: ['Abrió conteo', 'primary'],
  count_closed: ['Cerró conteo', 'info'],
  count_reopened: ['Reabrió conteo', 'warning'],
  count_cancelled: ['Anuló conteo', 'danger'],
  count_applied: ['Aplicó conteo', 'success'],
  count_siesa_adjusted: ['Ajustado en SIESA', 'success'],
  count_zero_all: ['Confirmó ceros', 'warning'],
  count_recount: ['Pidió reconteo', 'warning'],
  count_finding_assigned: ['Asignó hallazgo', 'primary'],
  count_finding_discarded: ['Descartó hallazgo', 'warning'],
}

async function viewAudit(main, isCurrent) {
  const { items } = await api('/api/audit?limit=150')
  if (!isCurrent()) return
  main.innerHTML = `
    ${pageHead('Actividad', 'Últimos 150 eventos de seguridad del portal.', '<button class="btn btn-secondary" type="button" id="audit-refresh">Actualizar</button>')}
    <div class="card">
      ${items.length ? items.map((e) => {
        const [label, tone] = AUDIT_LABELS[e.event] || [e.event, '']
        return `
          <div class="audit-item">
            <span class="badge${tone ? ` badge-${tone}` : ''}">${esc(label)}</span>
            <span class="audit-text"><strong>${esc(e.username || 'desconocido')}</strong>${e.detail ? ` · ${esc(e.detail)}` : ''}</span>
            <time>${esc(fmtDate(e.created_at))} · IP ${esc(e.ip || '—')}</time>
          </div>`
      }).join('') : '<p class="empty">Sin eventos todavía.</p>'}
    </div>`
  document.getElementById('audit-refresh').addEventListener('click', route)
}

async function viewAccount(main) {
  const user = state.user
  main.innerHTML = `
    ${pageHead('Mi cuenta', 'Tus datos y tu contraseña.')}
    <div class="grid grid-2">
      <section class="card card-pad">
        <div class="row-main">
          <div class="avatar" aria-hidden="true">${esc(initials(user.full_name))}</div>
          <div class="row-text">
            <strong>${esc(user.full_name)}</strong>
            <span><code>${esc(user.username)}</code>${user.email ? ` · ${esc(user.email)}` : ''}</span>
            <div class="row-tags">${roleBadge(user.role, user.role_label)}</div>
          </div>
        </div>
        <p class="hint">La sesión se cierra tras ${esc(state.idleMinutes)} minutos sin actividad.</p>
      </section>
      <section class="card card-pad">
        <h3>Cambiar contraseña</h3>
        <form id="account-pw" novalidate>
          <p class="form-error" hidden></p>
          ${pwField('current_password', 'Contraseña actual', 'current-password')}
          ${pwField('new_password', 'Nueva contraseña', 'new-password')}
          <ul class="rules rules-gap">${rulesHtml('', user.username)}</ul>
          ${pwField('confirm_password', 'Repite la nueva contraseña', 'new-password')}
          <button class="btn btn-primary" type="submit">Cambiar contraseña</button>
        </form>
      </section>
    </div>`
  const form = document.getElementById('account-pw')
  bindPasswordToggles(form)
  bindPasswordForm(form, async () => {
    toast('Contraseña actualizada. Se cerraron tus otras sesiones.', 'success')
  })
}

// ---------------------------------------------------------------------------
// Conteo físico
// ---------------------------------------------------------------------------

const COUNT_STATUS = {
  abierto: ['Abierto', 'success'],
  revision: ['En revisión', 'warning'],
  aplicado: ['Aplicado', 'primary'],
  anulado: ['Anulado', ''],
}
const UNIT_CHOICES = { kg: ['kg', 'g'], g: ['g', 'kg'], L: ['L', 'mL'], mL: ['mL', 'L'] }
const QUEUE_KEY = 'tin-count-queue-v1'
const FAILED_KEY = 'tin-count-failed-v1'
let flushing = false

function statusBadge(status) {
  const [label, tone] = COUNT_STATUS[status] || [status, '']
  return `<span class="badge${tone ? ` badge-${tone}` : ''} badge-dot">${esc(label)}</span>`
}

function fmtQty(value, unit = '') {
  if (value === null || value === undefined || value === '') return '—'
  const text = Number(value).toLocaleString('es-CO', { maximumFractionDigits: 3 })
  return unit ? `${text} ${unit}` : text
}

function fmtSigned(value, unit = '') {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  const sign = n > 0.0000005 ? '+' : ''
  return `${sign}${fmtQty(n, unit)}`
}

function fmtMoney(value) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
}

function diffClass(value) {
  if (value === null || value === undefined) return ''
  if (value > 0.0000005) return 'num-up'
  if (value < -0.0000005) return 'num-down'
  return 'num-zero'
}

function storeGet(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}

function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* sin almacenamiento */ }
}

function newUuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function myQueue(countId) {
  return storeGet(QUEUE_KEY, []).filter((q) => q.user_id === state.user?.id && (!countId || q.count_id === countId))
}

function myFailed(countId) {
  return storeGet(FAILED_KEY, []).filter((q) => q.user_id === state.user?.id && (!countId || q.count_id === countId))
}

/** Envía lo que quedó guardado en el celular. Se detiene al primer corte de red. */
async function flushQueue() {
  if (flushing || !state.user) return
  flushing = true
  try {
    const all = storeGet(QUEUE_KEY, [])
    const keep = []
    const failed = storeGet(FAILED_KEY, [])
    let stop = false
    for (const item of all) {
      if (stop || item.user_id !== state.user.id) { keep.push(item); continue }
      try {
        await api(`/api/counts/${item.count_id}/lines`, { method: 'POST', body: item.body })
      } catch (err) {
        if (err.status === 0 || err.status === 401 || err.status >= 500) { stop = true; keep.push(item); continue }
        failed.push({ ...item, error: err.message })
      }
    }
    storeSet(QUEUE_KEY, keep)
    storeSet(FAILED_KEY, failed)
  } finally {
    flushing = false
    document.dispatchEvent(new CustomEvent('count-sync'))
  }
}

window.addEventListener('online', () => { flushQueue() })

async function viewCounts(main, isCurrent, params) {
  const id = Number.parseInt(params[0], 10)
  if (Number.isFinite(id)) {
    if (params[1] === 'revision' && can('count.approve')) return viewCountReview(main, isCurrent, id)
    return viewCountEntry(main, isCurrent, id)
  }
  return viewCountList(main, isCurrent)
}

async function viewCountList(main, isCurrent) {
  const admin = can('count.approve')
  flushQueue()
  const { items } = await api('/api/counts')
  if (!isCurrent()) return
  const pending = myQueue().length
  main.innerHTML = `
    ${pageHead('Conteo físico', admin ? 'Abre un conteo por bodega, revisa las diferencias y aplícalo al inventario.' : 'Elige el conteo en el que vas a trabajar.', admin ? '<button class="btn btn-primary" type="button" id="count-new">Abrir conteo</button>' : '')}
    ${pending ? `<p class="notice notice-warning">Tienes ${pending} registro(s) guardados en este celular sin enviar. Se envían solos cuando haya señal.</p>` : ''}
    <div class="list">
      ${items.length ? items.map((c) => `
        <article class="card row">
          <div class="row-main">
            <div class="module-icon">${icons.clipboard}</div>
            <div class="row-text">
              <strong>Conteo #${esc(c.id)} · ${esc(c.warehouse_name)}</strong>
              <span>Abierto ${esc(fmtDate(c.opened_at))}${c.opened_by_name ? ` por ${esc(c.opened_by_name)}` : ''}</span>
              <span>${esc(c.items_counted)} de ${esc(c.items_total)} productos contados · ${esc(c.lines)} registros</span>
              <div class="row-tags">
                ${statusBadge(c.status)}
                ${c.status === 'aplicado' ? (c.siesa_adjusted_at ? '<span class="badge badge-success">Ajustado en SIESA</span>' : '<span class="badge badge-warning">Falta ajustar en SIESA</span>') : ''}
              </div>
            </div>
          </div>
          <div class="row-actions">
            ${c.status === 'abierto' ? `<a class="btn btn-primary btn-sm" href="#/conteo/${c.id}">Contar</a>` : ''}
            ${admin && c.status !== 'anulado' ? `<a class="btn btn-secondary btn-sm" href="#/conteo/${c.id}/revision">Revisar</a>` : ''}
          </div>
        </article>`).join('') : `<div class="card empty">${admin ? 'Todavía no hay conteos. Abre el primero.' : 'No hay conteos abiertos en este momento.'}</div>`}
    </div>`

  if (!admin) return
  document.getElementById('count-new').addEventListener('click', async () => {
    let warehouses = []
    try { warehouses = (await api('/api/warehouses')).items } catch (err) { reportError(err); return }
    const busy = new Set(items.filter((c) => ['abierto', 'revision'].includes(c.status)).map((c) => c.warehouse_id))
    const options = warehouses.filter((w) => w.is_active && w.fixed && !busy.has(w.id))
    if (!options.length) { toast('Principal y Laboratorio ya tienen un conteo activo', 'error'); return }
    openDialog({
      title: 'Abrir conteo',
      submitLabel: 'Abrir conteo',
      body: `
        <div class="field">
          <label for="warehouse_id">Bodega</label>
          <select class="select" id="warehouse_id" name="warehouse_id">
            ${options.map((w) => `<option value="${w.id}">${esc(w.name)} (${esc(w.code)})</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="notes">Nota (opcional)</label><input class="input" id="notes" name="notes" maxlength="200" placeholder="Ej: Inventario de cierre de noviembre"></div>
        <p class="notice">Se guarda una foto del saldo actual. Mientras dure el conteo, evita mover mercancía de esta bodega; lo que se mueva quedará marcado en la revisión.</p>`,
      onSubmit: async (form) => {
        const { count } = await api('/api/counts', { method: 'POST', body: { warehouse_id: Number(form.warehouse_id.value), notes: form.notes.value } })
        toast(`Conteo #${count.id} abierto en ${count.warehouse_name}`, 'success')
        location.hash = `#/conteo/${count.id}/revision`
      },
    })
  })
}

// --- Captura (almacén) ------------------------------------------------------

async function viewCountEntry(main, isCurrent, countId) {
  const cacheKey = `tin-count-catalog-${countId}`
  let detail
  try {
    detail = await api(`/api/counts/${countId}`)
    storeSet(cacheKey, { items: detail.items, lots: detail.lots, count: detail.count })
  } catch (err) {
    const cached = storeGet(cacheKey, null)
    if (err.status !== 0 || !cached) throw err
    detail = cached
    toast('Sin señal: usando la lista guardada en el celular')
  }
  if (!isCurrent()) return
  const count = detail.count
  if (count.status !== 'abierto') {
    main.innerHTML = `${pageHead(`Conteo #${count.id} · ${count.warehouse_name}`, '')}<div class="card empty">Este conteo ya no está abierto para registrar.</div>`
    return
  }

  const items = detail.items
  const lotsByItem = new Map()
  for (const lot of detail.lots) {
    if (!lotsByItem.has(lot.chemical_id)) lotsByItem.set(lot.chemical_id, [])
    lotsByItem.get(lot.chemical_id).push(lot)
  }
  const itemById = new Map(items.map((i) => [i.chemical_id, i]))
  let lines = []
  let filter = 'todos'
  let query = ''

  main.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Conteo #${esc(count.id)} · ${esc(count.warehouse_name)}</h2>
        <p>Registra lo que encuentres. Si un producto está en dos sitios, regístralo dos veces.</p>
      </div>
      <span class="sync-chip" id="sync-chip"></span>
    </div>
    <div id="recount-box"></div>
    <div id="failed-box"></div>
    <div class="search-bar card">
      <input class="input input-search" id="count-search" type="search" placeholder="Buscar por código o nombre" autocomplete="off" spellcheck="false" enterkeyhint="search">
      <div class="chips" role="group" aria-label="Filtrar productos">
        <button type="button" class="chip active" data-filter="todos">Todos</button>
        <button type="button" class="chip" data-filter="pendientes">Sin contar</button>
        <button type="button" class="chip" data-filter="contados">Contados</button>
      </div>
    </div>
    <div class="list item-list" id="count-items"></div>
    <button class="btn btn-secondary btn-block finding-btn" type="button" id="finding-new">¿No está en la lista? Registrar hallazgo</button>
    <p class="section-title">Mis registros</p>
    <div class="card" id="my-lines"></div>`

  const linesFor = (chemicalId) => lines.filter((l) => l.chemical_id === chemicalId)
  const pendingFor = (chemicalId) => myQueue(countId).filter((q) => q.body.chemical_id === chemicalId)

  function paintSync() {
    const chip = document.getElementById('sync-chip')
    if (!chip) return
    const pending = myQueue(countId).length
    chip.className = `sync-chip${pending ? ' is-pending' : ''}`
    chip.textContent = pending ? `${pending} sin enviar` : navigator.onLine ? 'Todo enviado' : 'Sin señal'
  }

  function paintFailed() {
    const failed = myFailed(countId)
    const box = document.getElementById('failed-box')
    if (!box) return
    box.innerHTML = failed.length ? `
      <div class="notice notice-danger">
        <div>
          <strong>${failed.length} registro(s) no se pudieron guardar.</strong>
          ${failed.map((f) => `<div>${esc(f.label)}: ${esc(f.error)}</div>`).join('')}
          <button class="btn btn-secondary btn-sm" type="button" id="failed-clear">Entendido, quitar aviso</button>
        </div>
      </div>` : ''
    document.getElementById('failed-clear')?.addEventListener('click', () => {
      storeSet(FAILED_KEY, storeGet(FAILED_KEY, []).filter((f) => !(f.user_id === state.user.id && f.count_id === countId)))
      paintFailed()
    })
  }

  function paintRecount() {
    const box = document.getElementById('recount-box')
    const flagged = items.filter((i) => i.recount)
    box.innerHTML = flagged.length ? `
      <div class="notice notice-warning"><div><strong>Reconteo pedido:</strong> ${flagged.map((i) => esc(i.name)).join(', ')}. Vuelve a contarlos completos.</div></div>` : ''
  }

  function itemMatches(item) {
    const counted = item.lines > 0 || linesFor(item.chemical_id).length > 0 || pendingFor(item.chemical_id).length > 0
    if (filter === 'pendientes' && counted) return false
    if (filter === 'contados' && !counted) return false
    if (!query) return true
    const hay = `${item.code} ${item.name}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return query.split(/\s+/).every((word) => hay.includes(word))
  }

  function paintItems() {
    const host = document.getElementById('count-items')
    if (!host) return
    const shown = items.filter(itemMatches).slice(0, 80)
    host.innerHTML = shown.length ? shown.map((item) => {
      const n = Math.max(item.lines, linesFor(item.chemical_id).length) + pendingFor(item.chemical_id).length
      return `
        <button type="button" class="card item-pick" data-item="${item.chemical_id}">
          <span class="item-pick-text">
            <strong>${esc(item.name)}</strong>
            <span><code>${esc(item.code)}</code> · ${esc(item.unit)}</span>
          </span>
          <span class="row-tags">
            ${item.recount ? '<span class="badge badge-warning">Reconteo</span>' : ''}
            ${n ? `<span class="badge badge-success">${n} registro${n === 1 ? '' : 's'}</span>` : '<span class="badge">Sin contar</span>'}
          </span>
        </button>`
    }).join('') : '<div class="card empty">No hay productos con ese filtro. Si no está en la lista, regístralo como hallazgo.</div>'
  }

  function paintMine() {
    const host = document.getElementById('my-lines')
    if (!host) return
    const queued = myQueue(countId).map((q) => ({ ...q.preview, pending: true }))
    const mine = lines.filter((l) => l.mine)
    const all = [...queued, ...mine]
    host.innerHTML = all.length ? all.slice(0, 60).map((l) => `
      <div class="line-item">
        <div class="line-text">
          <strong>${esc(l.name || l.finding_name || '')}${l.finding_name && !l.name ? ' <span class="badge badge-info">Hallazgo</span>' : ''}</strong>
          <span>${esc(fmtQty(l.qty_entered, l.unit_entered))} · lote ${esc(l.lot_number || 'S/N')}${l.location ? ` · ${esc(l.location)}` : ''}</span>
          <span>${l.pending ? '<span class="badge badge-warning">Sin enviar</span>' : esc(fmtDate(l.counted_at))}</span>
        </div>
        ${l.pending ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-edit-line="${l.id}">Editar</button>`}
      </div>`).join('') : '<p class="empty">Aún no has registrado nada.</p>'
    host.querySelectorAll('[data-edit-line]').forEach((btn) => {
      btn.addEventListener('click', () => openLineEditor(lines.find((l) => l.id === Number(btn.dataset.editLine))))
    })
  }

  async function refreshLines() {
    try {
      const data = await api(`/api/counts/${countId}/lines`)
      lines = data.items
    } catch (err) {
      if (err.status !== 0) reportError(err)
    }
    if (!isCurrent()) return
    paintItems()
    paintMine()
    paintSync()
    paintFailed()
  }

  function unitOptions(unit, selected) {
    const choices = UNIT_CHOICES[unit] || [unit]
    return choices.map((u, idx) => `
      <label class="seg"><input type="radio" name="unit_entered" value="${u}" ${(selected ? selected === u : idx === 0) ? 'checked' : ''}><span>${esc(u)}</span></label>`).join('')
  }

  function lotOptions(itemLots, current) {
    const numbers = [...new Set(itemLots.map((l) => l.lot_number))]
    if (!numbers.includes('S/N')) numbers.push('S/N')
    const pick = current && numbers.includes(current) ? current : null
    return `${numbers.map((n, idx) => `<option value="${esc(n)}" ${(pick ? pick === n : idx === 0) ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      <option value="__otro" ${current && !numbers.includes(current) ? 'selected' : ''}>Otro lote…</option>`
  }

  function lineFields({ item, line }) {
    const itemLots = lotsByItem.get(item.chemical_id) || []
    const otherLot = line && !itemLots.some((l) => l.lot_number === line.lot_number) && line.lot_number !== 'S/N' ? line.lot_number : ''
    return `
      <p class="dialog-sub"><code>${esc(item.code)}</code> · se guarda en ${esc(item.unit)}</p>
      <div class="field">
        <label for="lot">Lote</label>
        <select class="select" id="lot" name="lot">${lotOptions(itemLots, line?.lot_number)}</select>
        <input class="input lot-other" id="lot_other" name="lot_other" maxlength="40" placeholder="Escribe el lote tal como aparece" value="${esc(otherLot)}" ${otherLot ? '' : 'hidden'} autocapitalize="characters">
      </div>
      <div class="field">
        <label for="qty">Cantidad encontrada</label>
        <div class="qty-row">
          <input class="input input-qty" id="qty" name="qty" inputmode="decimal" autocomplete="off" required value="${line ? esc(String(line.qty_entered).replace('.', ',')) : ''}" placeholder="0">
          <div class="segmented">${unitOptions(item.unit, line?.unit_entered)}</div>
        </div>
      </div>
      <div class="field"><label for="location">Ubicación (opcional)</label><input class="input" id="location" name="location" maxlength="40" value="${esc(line ? line.location || '' : storeGet('tin-count-location', ''))}" placeholder="Ej: Estante 3"></div>
      <div class="field"><label for="notes">Nota (opcional)</label><input class="input" id="notes" name="notes" maxlength="200" value="${esc(line?.notes || '')}"></div>`
  }

  function bindLotSelect(form) {
    const other = form.lot_other
    const sync = () => {
      other.hidden = form.lot.value !== '__otro'
      if (!other.hidden) other.focus()
    }
    form.lot.addEventListener('change', sync)
  }

  function readLineForm(form) {
    const qtyText = form.qty.value.trim().replace(',', '.')
    if (!/^\d+(\.\d+)?$/.test(qtyText)) throw new Error('Escribe la cantidad con números (ej: 12,5)')
    const lot = form.lot.value === '__otro' ? form.lot_other.value.trim() : form.lot.value
    if (form.lot.value === '__otro' && !lot) throw new Error('Escribe el lote o elige S/N')
    const unit = form.querySelector('input[name="unit_entered"]:checked')?.value
    return { qty_entered: qtyText, unit_entered: unit, lot_number: lot, location: form.location.value.trim(), notes: form.notes.value.trim() }
  }

  function openItemEntry(item) {
    const existing = [...linesFor(item.chemical_id), ...pendingFor(item.chemical_id).map((q) => ({ ...q.preview, pending: true }))]
    openDialog({
      title: item.name,
      submitLabel: 'Guardar',
      body: `
        ${item.recount ? '<p class="notice notice-warning">Reconteo pedido: cuenta de nuevo todo este producto.</p>' : ''}
        ${lineFields({ item })}
        ${existing.length ? `<div class="already"><strong>Ya registrado en este conteo:</strong>${existing.map((l) => `<div>${esc(fmtQty(l.qty_entered, l.unit_entered))} · lote ${esc(l.lot_number)}${l.location ? ` · ${esc(l.location)}` : ''} · ${esc(l.counted_by_name || 'tú')}${l.pending ? ' (sin enviar)' : ''}</div>`).join('')}</div>` : ''}`,
      onOpen: (form) => { bindLotSelect(form); form.qty.focus() },
      onSubmit: async (form) => {
        const data = readLineForm(form)
        storeSet('tin-count-location', data.location)
        const body = { client_uuid: newUuid(), chemical_id: item.chemical_id, ...data }
        enqueue(body, { name: item.name, chemical_id: item.chemical_id, ...data, lot_number: data.lot_number || 'S/N' })
        const pendingBefore = myQueue(countId).length
        await flushQueue()
        const stillPending = myQueue(countId).length >= pendingBefore
        toast(stillPending ? 'Guardado en el celular. Se enviará cuando haya señal.' : `Registrado: ${item.name}`, stillPending ? '' : 'success')
        const search = document.getElementById('count-search')
        if (search) { search.value = ''; query = '' }
        await refreshLines()
        search?.focus()
      },
    })
  }

  function enqueue(body, preview) {
    const queue = storeGet(QUEUE_KEY, [])
    queue.push({
      count_id: countId,
      user_id: state.user.id,
      body,
      label: `${preview.name || preview.finding_name} ${preview.qty_entered} ${preview.unit_entered}`,
      preview: { ...preview, counted_at: null },
      created_at: Date.now(),
    })
    storeSet(QUEUE_KEY, queue)
  }

  function openLineEditor(line) {
    if (!line) return
    const item = itemById.get(line.chemical_id) || { chemical_id: line.chemical_id, code: line.code || '—', name: line.name || line.finding_name, unit: line.unit || line.unit_entered }
    const dialog = openDialog({
      title: `Editar · ${item.name}`,
      submitLabel: 'Guardar cambios',
      body: `${lineFields({ item, line })}
        <button class="btn btn-danger btn-block" type="button" id="line-delete">Borrar este registro</button>`,
      onOpen: (form) => bindLotSelect(form),
      onSubmit: async (form) => {
        const data = readLineForm(form)
        await api(`/api/counts/${countId}/lines/${line.id}`, { method: 'PUT', body: data })
        toast('Registro actualizado', 'success')
        await refreshLines()
      },
    })
    dialog.querySelector('#line-delete').addEventListener('click', async () => {
      try {
        await api(`/api/counts/${countId}/lines/${line.id}`, { method: 'DELETE' })
        dialog.close()
        toast('Registro borrado')
        await refreshLines()
      } catch (err) { reportError(err) }
    })
  }

  document.getElementById('count-search').addEventListener('input', (event) => {
    query = event.target.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    paintItems()
  })
  main.querySelectorAll('[data-filter]').forEach((chip) => chip.addEventListener('click', () => {
    filter = chip.dataset.filter
    main.querySelectorAll('[data-filter]').forEach((c) => c.classList.toggle('active', c === chip))
    paintItems()
  }))
  document.getElementById('count-items').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-item]')
    if (btn) openItemEntry(itemById.get(Number(btn.dataset.item)))
  })
  document.getElementById('finding-new').addEventListener('click', () => {
    openDialog({
      title: 'Registrar hallazgo',
      submitLabel: 'Guardar hallazgo',
      body: `
        <p class="notice">Para productos que encontraste y no aparecen en la lista. El administrador los asignará al producto correcto.</p>
        <div class="field"><label for="finding_name">Nombre en la etiqueta</label><input class="input" id="finding_name" name="finding_name" required maxlength="80" autocapitalize="characters"></div>
        <div class="field"><label for="lot_free">Lote (opcional)</label><input class="input" id="lot_free" name="lot_free" maxlength="40" placeholder="S/N si no tiene" autocapitalize="characters"></div>
        <div class="field">
          <label for="qty">Cantidad encontrada</label>
          <div class="qty-row">
            <input class="input input-qty" id="qty" name="qty" inputmode="decimal" autocomplete="off" required placeholder="0">
            <select class="select unit-select" name="unit">${['kg', 'g', 'L', 'mL', 'und'].map((u) => `<option value="${u}">${u}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field"><label for="location">Ubicación (opcional)</label><input class="input" id="location" name="location" maxlength="40" value="${esc(storeGet('tin-count-location', ''))}"></div>
        <div class="field"><label for="notes">Nota (opcional)</label><input class="input" id="notes" name="notes" maxlength="200" placeholder="Ej: envase sin etiqueta completa"></div>`,
      onOpen: (form) => form.finding_name.focus(),
      onSubmit: async (form) => {
        const name = form.finding_name.value.trim()
        if (name.length < 3) throw new Error('Escribe el nombre (mínimo 3 letras)')
        const qtyText = form.qty.value.trim().replace(',', '.')
        if (!/^\d+(\.\d+)?$/.test(qtyText)) throw new Error('Escribe la cantidad con números')
        const data = { finding_name: name, lot_number: form.lot_free.value.trim(), qty_entered: qtyText, unit_entered: form.unit.value, location: form.location.value.trim(), notes: form.notes.value.trim() }
        enqueue({ client_uuid: newUuid(), ...data }, { ...data, lot_number: data.lot_number || 'S/N' })
        await flushQueue()
        toast('Hallazgo registrado', 'success')
        await refreshLines()
      },
    })
  })

  const onSync = () => { paintSync(); paintMine(); paintFailed() }
  document.addEventListener('count-sync', onSync)
  const timer = setInterval(() => { if (myQueue(countId).length) flushQueue() }, 20000)
  const onOnline = () => paintSync()
  window.addEventListener('offline', onOnline)
  viewCleanup = () => {
    clearInterval(timer)
    document.removeEventListener('count-sync', onSync)
    window.removeEventListener('offline', onOnline)
  }

  paintRecount()
  paintItems()
  paintSync()
  await flushQueue()
  await refreshLines()
}

// --- Revisión (administrador) ------------------------------------------------

async function viewCountReview(main, isCurrent, countId) {
  const data = await api(`/api/counts/${countId}/review`)
  if (!isCurrent()) return
  const { count, summary, items, findings } = data
  let filter = summary.differences ? 'diferencias' : 'todos'
  const editable = ['abierto', 'revision'].includes(count.status)

  const actions = []
  if (count.status === 'abierto') {
    actions.push(`<a class="btn btn-secondary" href="#/conteo/${count.id}">Ir a contar</a>`)
    actions.push('<button class="btn btn-primary" type="button" data-act="close">Cerrar conteo</button>')
  }
  if (count.status === 'revision') {
    actions.push('<button class="btn btn-primary" type="button" data-act="apply">Aplicar al inventario</button>')
    actions.push('<button class="btn btn-secondary" type="button" data-act="reopen">Reabrir</button>')
  }
  if (count.status !== 'anulado') {
    actions.push(`<a class="btn btn-secondary" href="/api/counts/${count.id}/export.csv" download>Descargar diferencias</a>`)
  }
  if (count.status === 'aplicado' && !count.siesa_adjusted_at) {
    actions.push('<button class="btn btn-secondary" type="button" data-act="siesa">Marcar ajustado en SIESA</button>')
  }
  if (editable) actions.push('<button class="btn btn-danger" type="button" data-act="cancel">Anular</button>')

  const unresolved = items.filter((i) => i.needs_resolution)
  const pendingFindings = findings.filter((f) => f.finding_status === 'pendiente')

  main.innerHTML = `<div class="view-root" id="review-root">
    <div class="page-head">
      <div>
        <h2>Revisión · Conteo #${esc(count.id)} ${esc(count.warehouse_name)}</h2>
        <p>Abierto ${esc(fmtDate(count.opened_at))}${count.notes ? ` · ${esc(count.notes)}` : ''}</p>
        <div class="row-tags">${statusBadge(count.status)}
          ${count.status === 'aplicado' ? (count.siesa_adjusted_at ? `<span class="badge badge-success">Ajustado en SIESA ${esc(fmtDate(count.siesa_adjusted_at))}</span>` : '<span class="badge badge-warning">Falta ajustar en SIESA</span>') : ''}
        </div>
      </div>
      <div class="row-actions">${actions.join('')}</div>
    </div>

    <div class="stats">
      <div class="card stat"><span>Productos contados</span><strong>${esc(summary.items_counted)} <small>de ${esc(summary.items_total)}</small></strong></div>
      <div class="card stat"><span>Registros</span><strong>${esc(summary.lines_total)}</strong></div>
      <div class="card stat"><span>Con diferencia</span><strong>${esc(summary.differences)}</strong></div>
      <div class="card stat"><span>Valor de diferencias</span><strong class="${diffClass(summary.value_total)}">${esc(fmtMoney(summary.value_total))}</strong></div>
    </div>

    ${count.status === 'aplicado' ? `<p class="notice">Aplicado ${esc(fmtDate(count.applied_at))}. El inventario de la app ya muestra lo contado. Descarga las diferencias para hacer el ajuste manual en SIESA.</p>` : ''}
    ${summary.moved ? `<p class="notice notice-warning">${esc(summary.moved)} producto(s) tuvieron movimientos durante el conteo (entradas, consumos o traslados). Revísalos antes de aplicar: al aplicar, el saldo queda igual a lo contado.</p>` : ''}

    ${editable && unresolved.length ? `
      <section class="card card-pad attention">
        <h3>Con existencias y sin contar (${unresolved.length})</h3>
        <p class="hint">Para aplicar, cuéntalos o confirma que no hay nada.</p>
        <div class="mini-list">${unresolved.map((i) => `
          <div class="mini-row"><span><strong>${esc(i.name)}</strong> <code>${esc(i.code)}</code> · sistema ${esc(fmtQty(i.system_qty, i.unit))}</span>
          <button class="btn btn-secondary btn-sm" type="button" data-zero="${i.chemical_id}">Confirmar en cero</button></div>`).join('')}
        </div>
        ${count.status === 'revision' ? '<button class="btn btn-secondary" type="button" data-act="zero-all">Confirmar en cero todo lo no contado</button>' : ''}
      </section>` : ''}

    ${findings.length ? `
      <section class="card card-pad attention">
        <h3>Hallazgos (${pendingFindings.length} pendientes)</h3>
        <div class="mini-list">${findings.map((f) => `
          <div class="mini-row">
            <span><strong>${esc(f.finding_name)}</strong> · ${esc(fmtQty(f.qty_entered, f.unit_entered))} · lote ${esc(f.lot_number)}${f.location ? ` · ${esc(f.location)}` : ''} · ${esc(f.counted_by_name || '')}${f.notes ? `<br><span class="hint">${esc(f.notes)}</span>` : ''}</span>
            ${f.finding_status === 'pendiente' && editable
              ? `<span class="row-actions"><button class="btn btn-secondary btn-sm" type="button" data-assign="${f.id}">Asignar</button><button class="btn btn-ghost btn-sm" type="button" data-discard="${f.id}">Descartar</button></span>`
              : `<span class="badge ${f.finding_status === 'asignado' ? 'badge-success' : ''}">${f.finding_status === 'asignado' ? `Asignado a ${esc((items.find((i) => i.chemical_id === f.chemical_id) || {}).code || '')}` : esc(f.finding_status)}</span>`}
          </div>`).join('')}
        </div>
      </section>` : ''}

    <div class="chips review-chips" role="group" aria-label="Filtrar productos">
      <button type="button" class="chip" data-filter="diferencias">Con diferencia (${esc(summary.differences)})</button>
      <button type="button" class="chip" data-filter="todos">Todos (${esc(summary.items_total)})</button>
      <button type="button" class="chip" data-filter="sin-contar">Sin contar</button>
      <button type="button" class="chip" data-filter="movidos">Con movimientos (${esc(summary.moved)})</button>
    </div>
    <div class="review-head" aria-hidden="true"><span>Producto</span><span>Sistema</span><span>Contado</span><span>Diferencia</span><span>Valor</span></div>
    <div class="list" id="review-items"></div>
  </div>`
  const root = document.getElementById('review-root')

  function itemVisible(i) {
    if (filter === 'diferencias') return i.diff !== null && Math.abs(i.diff) > 0.0000005
    if (filter === 'sin-contar') return !i.resolved
    if (filter === 'movidos') return i.moved_during_count > 0
    return true
  }

  function paintReview() {
    root.querySelectorAll('[data-filter]').forEach((c) => c.classList.toggle('active', c.dataset.filter === filter))
    const shown = items.filter(itemVisible)
    document.getElementById('review-items').innerHTML = shown.length ? shown.map((i) => `
      <details class="card review-item">
        <summary>
          <span class="ri-name"><strong>${esc(i.name)}</strong><code>${esc(i.code)}</code>
            <span class="row-tags">
              ${!i.resolved ? '<span class="badge">Sin contar</span>' : ''}
              ${i.confirmed_zero && !i.has_lines ? '<span class="badge badge-info">Confirmado en cero</span>' : ''}
              ${i.recount_requested ? '<span class="badge badge-warning">Reconteo pedido</span>' : ''}
              ${i.moved_during_count ? `<span class="badge badge-warning">${esc(i.moved_during_count)} mov. durante el conteo</span>` : ''}
            </span>
          </span>
          <span class="ri-num" data-label="Sistema">${esc(fmtQty(i.system_qty, i.unit))}</span>
          <span class="ri-num" data-label="Contado">${esc(i.resolved ? fmtQty(i.counted_qty, i.unit) : '—')}</span>
          <span class="ri-num ${diffClass(i.diff)}" data-label="Diferencia">${esc(fmtSigned(i.diff, i.unit))}</span>
          <span class="ri-num ${diffClass(i.value)}" data-label="Valor">${esc(i.value === null ? '—' : fmtMoney(i.value))}</span>
        </summary>
        <div class="ri-detail">
          ${i.lots.length ? `
            <table class="lots">
              <thead><tr><th>Lote</th><th>Sistema</th><th>Contado</th><th>Diferencia</th>${count.status === 'aplicado' ? '' : '<th>Saldo hoy</th>'}</tr></thead>
              <tbody>${i.lots.map((l) => `
                <tr><td>${esc(l.lot_number)}${l.is_new ? ' <span class="badge badge-info">Nuevo</span>' : ''}</td>
                <td>${esc(fmtQty(l.system_qty))}</td><td>${esc(fmtQty(l.counted_qty))}</td>
                <td class="${diffClass(l.diff)}">${esc(fmtSigned(l.diff))}</td>${count.status === 'aplicado' ? '' : `<td>${esc(fmtQty(l.current_qty))}</td>`}</tr>`).join('')}
              </tbody>
            </table>` : '<p class="hint">Sin lotes.</p>'}
          ${i.lines.length ? `<div class="ri-lines"><strong>Registros</strong>${i.lines.map((l) => `
            <div>${esc(fmtQty(l.qty_entered, l.unit_entered))} · lote ${esc(l.lot_number)}${l.location ? ` · ${esc(l.location)}` : ''} · ${esc(l.counted_by_name || '')} · ${esc(fmtDate(l.counted_at))}${l.finding_name ? ` · hallazgo "${esc(l.finding_name)}"` : ''}</div>`).join('')}</div>` : ''}
          <p class="hint">Precio de referencia ${esc(fmtMoney(i.unit_price))} por ${esc(i.unit)}${i.moved_during_count ? ' · Saldo hoy: ' + esc(fmtQty(i.current_qty, i.unit)) : ''}</p>
          ${editable ? `<div class="row-actions">
            ${count.status === 'abierto' ? `<button class="btn btn-secondary btn-sm" type="button" data-recount="${i.chemical_id}">Pedir reconteo</button>` : ''}
            ${!i.has_lines ? `<button class="btn btn-secondary btn-sm" type="button" data-zero="${i.chemical_id}" data-on="${i.confirmed_zero ? '0' : '1'}">${i.confirmed_zero ? 'Quitar confirmación en cero' : 'Confirmar en cero'}</button>` : ''}
          </div>` : ''}
        </div>
      </details>`).join('') : '<div class="card empty">Nada con este filtro.</div>'
  }

  const reload = () => route()

  async function act(path, body, message) {
    await api(`/api/counts/${count.id}/${path}`, { method: 'POST', body: body || {} })
    if (message) toast(message, 'success')
    reload()
  }

  root.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-filter]')
    if (chip) { filter = chip.dataset.filter; paintReview(); return }
    const zero = event.target.closest('[data-zero]')
    if (zero) {
      zero.disabled = true
      try { await act(`items/${zero.dataset.zero}/confirm-zero`, { confirm: zero.dataset.on !== '0' }, 'Actualizado') } catch (err) { zero.disabled = false; reportError(err) }
      return
    }
    const recount = event.target.closest('[data-recount]')
    if (recount) {
      const item = items.find((i) => i.chemical_id === Number(recount.dataset.recount))
      openDialog({
        title: 'Pedir reconteo',
        submitLabel: 'Pedir reconteo',
        body: `<p>Se descartan los ${esc(item.lines.length)} registro(s) de <strong>${esc(item.name)}</strong> y almacén verá el producto marcado para contarlo de nuevo completo.</p>`,
        onSubmit: () => act(`items/${item.chemical_id}/recount`, {}, 'Reconteo pedido'),
      })
      return
    }
    const assign = event.target.closest('[data-assign]')
    if (assign) { openAssign(findings.find((f) => f.id === Number(assign.dataset.assign))); return }
    const discard = event.target.closest('[data-discard]')
    if (discard) {
      try { await act(`findings/${discard.dataset.discard}`, { action: 'discard' }, 'Hallazgo descartado') } catch (err) { reportError(err) }
      return
    }
    const btn = event.target.closest('[data-act]')
    if (!btn) return
    const kind = btn.dataset.act
    if (kind === 'close') {
      openDialog({
        title: 'Cerrar conteo',
        submitLabel: 'Cerrar y pasar a revisión',
        body: `<p>Almacén ya no podrá registrar en este conteo. Si falta algo, puedes reabrirlo.</p>${summary.items_counted < summary.items_total ? `<p class="notice notice-warning">Hay ${esc(summary.items_total - summary.items_counted)} productos sin registros.</p>` : ''}`,
        onSubmit: () => act('close', {}, 'Conteo cerrado: ahora en revisión'),
      })
    } else if (kind === 'reopen') {
      try { await act('reopen', {}, 'Conteo reabierto') } catch (err) { reportError(err) }
    } else if (kind === 'zero-all') {
      openDialog({
        title: 'Confirmar en cero lo no contado',
        submitLabel: 'Confirmar en cero',
        body: `<p class="notice notice-warning">Todos los productos sin registros quedarán en <strong>0</strong> en ${esc(count.warehouse_name)} al aplicar. Úsalo solo si recorriste toda la bodega.</p>`,
        onSubmit: () => act('confirm-zero', {}, 'Productos sin contar confirmados en cero'),
      })
    } else if (kind === 'apply') {
      const resolved = items.filter((i) => i.resolved && Math.abs(i.diff) > 0.0000005).length
      openDialog({
        title: 'Aplicar al inventario',
        submitLabel: 'Aplicar',
        body: `
          <p>El inventario de <strong>${esc(count.warehouse_name)}</strong> en la app quedará igual a lo contado.</p>
          <ul class="apply-list">
            <li>${esc(resolved)} producto(s) con diferencia</li>
            <li>Valor neto de diferencias: <strong class="${diffClass(summary.value_total)}">${esc(fmtMoney(summary.value_total))}</strong></li>
            <li>Cada cambio queda como movimiento de ajuste con referencia a este conteo</li>
          </ul>
          ${summary.moved ? '<p class="notice notice-warning">Hay productos con movimientos durante el conteo.</p>' : ''}
          <p class="notice notice-warning">No se puede deshacer desde el portal. Después haz el ajuste manual en SIESA.</p>`,
        onSubmit: async () => {
          const res = await api(`/api/counts/${count.id}/apply`, { method: 'POST', body: {} })
          toast(`Inventario actualizado: ${res.movements} ajuste(s)`, 'success')
          reload()
        },
      })
    } else if (kind === 'siesa') {
      openDialog({
        title: 'Marcar ajustado en SIESA',
        submitLabel: 'Ya lo ajusté en SIESA',
        body: '<p>Confirma que ya registraste en SIESA las diferencias de este conteo. Mientras no lo marques, la app no deja importar el informe de inventario de SIESA, para que no reemplace lo contado.</p>',
        onSubmit: () => act('siesa', {}, 'Marcado como ajustado en SIESA'),
      })
    } else if (kind === 'cancel') {
      openDialog({
        title: 'Anular conteo',
        submitLabel: 'Anular',
        body: '<p class="notice notice-warning">El conteo queda anulado y no cambia el inventario. Los registros se conservan para consulta.</p>',
        onSubmit: () => act('cancel', {}, 'Conteo anulado'),
      })
    }
  })

  function openAssign(finding) {
    openDialog({
      title: 'Asignar hallazgo',
      submitLabel: 'Asignar',
      body: `
        <p><strong>${esc(finding.finding_name)}</strong> · ${esc(fmtQty(finding.qty_entered, finding.unit_entered))} · lote ${esc(finding.lot_number)}</p>
        <div class="field">
          <label for="assign_q">Buscar producto</label>
          <input class="input" id="assign_q" autocomplete="off" placeholder="Código o nombre">
          <select class="select" id="chemical_id" name="chemical_id" size="6" required></select>
          <span class="hint">Si el producto no existe todavía, créalo en la app de escritorio y vuelve a asignarlo.</span>
        </div>`,
      onOpen: (form) => {
        const input = form.querySelector('#assign_q')
        const fill = () => {
          const q = input.value.trim().toLowerCase()
          form.chemical_id.innerHTML = items
            .filter((i) => !q || `${i.code} ${i.name}`.toLowerCase().includes(q))
            .slice(0, 50)
            .map((i) => `<option value="${i.chemical_id}">${esc(i.code)} · ${esc(i.name)}</option>`).join('')
        }
        input.addEventListener('input', fill)
        fill()
        input.focus()
      },
      onSubmit: async (form) => {
        if (!form.chemical_id.value) throw new Error('Elige un producto')
        await act(`findings/${finding.id}`, { action: 'assign', chemical_id: Number(form.chemical_id.value) }, 'Hallazgo asignado')
      },
    })
  }

  paintReview()
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function boot() {
  try {
    state.config = await api('/api/config')
  } catch {
    state.config = { turnstile_site_key: '' }
  }
  try {
    const data = await api('/api/auth/me')
    setSession(data)
    if (state.user.must_change_password) renderForcedPassword()
    else renderShell()
  } catch (err) {
    renderLogin(err.status === 0 ? err.message : '', 'error')
  }
}

boot()
