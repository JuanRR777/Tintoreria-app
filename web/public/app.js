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
  { id: 'bodegas', label: 'Bodegas', icon: icons.warehouse, perm: 'warehouses.view', render: viewWarehouses },
  { id: 'usuarios', label: 'Usuarios', icon: icons.users, perm: 'users.manage', section: 'Administración', render: viewUsers },
  { id: 'actividad', label: 'Actividad', icon: icons.activity, perm: 'audit.view', section: 'Administración', render: viewAudit },
  { id: 'cuenta', label: 'Mi cuenta', icon: icons.account, section: 'Cuenta', render: viewAccount },
]

function allowedViews() {
  return VIEWS.filter((v) => !v.perm || can(v.perm))
}

function currentViewId() {
  const id = (location.hash.replace(/^#\/?/, '') || 'inicio').split('/')[0]
  return allowedViews().some((v) => v.id === id) ? id : 'inicio'
}

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
  setNav(false)
  const id = currentViewId()
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
    await view.render(main, isCurrent)
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
    { perm: 'count.register', icon: icons.clipboard, title: 'Conteo físico', text: 'Registrar el inventario por bodega y lote desde el celular.', soon: 'Próxima fase' },
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
