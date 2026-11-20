#!/usr/bin/env node
/**
 * Prueba de humo del portal contra `wrangler dev` (base D1 local).
 *
 *   SMOKE_ADMIN_USER=... SMOKE_ADMIN_PASSWORD=... npm run test:smoke
 *
 * Crea usuarios y una bodega de prueba, así que se niega a correr contra un
 * servidor que no sea local salvo con SMOKE_ALLOW_REMOTE=1.
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '')
const ADMIN_USER = process.env.SMOKE_ADMIN_USER
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD

const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) && process.env.SMOKE_ALLOW_REMOTE !== '1') {
  console.error('La prueba crea datos. Solo corre contra el servidor local (o define SMOKE_ALLOW_REMOTE=1).')
  process.exit(2)
}
if (!ADMIN_USER || !ADMIN_PASSWORD) {
  console.error('Define SMOKE_ADMIN_USER y SMOKE_ADMIN_PASSWORD')
  process.exit(2)
}

let passed = 0
let failed = 0
function check(label, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  OK    ${label}`) }
  else { failed += 1; console.log(`  FALLA ${label}${extra ? ` → ${extra}` : ''}`) }
}

function strongPassword() {
  const rand = Math.random().toString(36).slice(2, 10)
  return `Pr#${rand}9X`
}

class Client {
  constructor() { this.cookie = '' }
  async req(method, path, body, { origin = BASE } = {}) {
    const headers = { Accept: 'application/json' }
    if (origin) headers.Origin = origin
    if (this.cookie) headers.Cookie = this.cookie
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const pair = setCookie.split(';')[0]
      this.cookie = /=x$/.test(pair) || /Max-Age=0/i.test(setCookie) ? '' : pair
    }
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data, headers: res.headers, setCookie }
  }
  login(username, password, opts) { return this.req('POST', '/api/auth/login', { username, password }, opts) }
}

const stamp = Date.now().toString(36)
const admin = new Client()

console.log(`\nPortal: ${BASE}\n`)

let r = await admin.req('GET', '/api/health')
check('health responde', r.status === 200 && r.data.status === 'ok')

const page = await fetch(`${BASE}/`)
const csp = page.headers.get('content-security-policy') || ''
check('la página trae CSP estricta', page.status === 200 && csp.includes("default-src 'self'") && !csp.includes('unsafe-inline'))
check('la página no se puede incrustar', page.headers.get('x-frame-options') === 'DENY')

r = await new Client().req('GET', '/api/auth/me')
check('sin sesión → 401', r.status === 401)

r = await new Client().login(ADMIN_USER, 'ContraseñaMala#1')
check('contraseña incorrecta → 401 genérico', r.status === 401 && /incorrectos/.test(r.data.error || ''))

r = await new Client().login(`${ADMIN_USER}' OR 1=1 --`, ADMIN_PASSWORD)
check('inyección en usuario → 401', r.status === 401)

r = await new Client().login(ADMIN_USER, ADMIN_PASSWORD, { origin: 'https://otro-sitio.example' })
check('login desde otro origen → 403', r.status === 403)

r = await admin.login(ADMIN_USER, ADMIN_PASSWORD)
check('admin ingresa', r.status === 200 && r.data.user?.role === 'admin', JSON.stringify(r.data))
check('cookie HttpOnly y SameSite=Strict', /HttpOnly/i.test(r.setCookie || '') && /SameSite=Strict/i.test(r.setCookie || ''))
check('la respuesta no incluye el hash', !JSON.stringify(r.data).includes('pbkdf2'))
const adminId = r.data.user?.id

r = await admin.req('GET', '/api/auth/me')
check('admin /me', r.status === 200 && r.data.permissions.includes('users.manage'))

// --- Usuario de almacén ---
const almacenUser = `almacen.${stamp}`
const temp = strongPassword()
r = await admin.req('POST', '/api/users', { username: almacenUser, full_name: 'Prueba Almacén', role: 'almacen', password: temp })
check('admin crea usuario almacén', r.status === 201, JSON.stringify(r.data))
const almacenId = r.data.user?.id

r = await admin.req('POST', '/api/users', { username: almacenUser, full_name: 'Duplicado', role: 'consulta', password: temp })
check('usuario duplicado → 409', r.status === 409)

r = await admin.req('POST', '/api/users', { username: `debil.${stamp}`, full_name: 'Clave débil', role: 'consulta', password: 'abc123' })
check('contraseña débil → 400', r.status === 400)

const almacen = new Client()
r = await almacen.login(almacenUser, temp)
check('almacén ingresa con temporal y debe cambiarla', r.status === 200 && r.data.user?.must_change_password === true)

r = await almacen.req('GET', '/api/warehouses')
check('sin cambiar contraseña no ve datos', r.status === 403 && r.data.code === 'password_change_required')

const nextPassword = strongPassword()
r = await almacen.req('POST', '/api/auth/password', { current_password: temp, new_password: nextPassword })
check('almacén cambia su contraseña', r.status === 200, JSON.stringify(r.data))

r = await almacen.req('GET', '/api/warehouses')
const names = (r.data.items || []).map((w) => w.name)
check('almacén ve bodegas Principal y Laboratorio', r.status === 200 && names.includes('Principal') && names.includes('Laboratorio'))

r = await almacen.req('GET', '/api/users')
check('almacén no ve usuarios → 403', r.status === 403)
r = await almacen.req('POST', '/api/warehouses', { code: `X${stamp}`.slice(0, 20), name: 'No debe' })
check('almacén no crea bodegas → 403', r.status === 403)
r = await almacen.req('GET', '/api/audit')
check('almacén no ve actividad → 403', r.status === 403)

r = await almacen.req('GET', '/api/recipes')
check('no existe ruta de recetas → 404', r.status === 404)

// --- Cambio de rol cierra sesiones ---
r = await admin.req('PUT', `/api/users/${almacenId}`, { role: 'consulta' })
check('admin cambia rol a consulta', r.status === 200 && r.data.user?.role === 'consulta')
r = await almacen.req('GET', '/api/auth/me')
check('el cambio de rol cerró su sesión', r.status === 401)

// --- Protecciones del administrador ---
r = await admin.req('PUT', `/api/users/${adminId}`, { is_active: false })
check('admin no puede desactivarse', r.status === 400)
r = await admin.req('PUT', `/api/users/${adminId}`, { role: 'consulta' })
check('admin no puede quitarse el rol', r.status === 400)

// --- Bloqueo por intentos ---
const lockUser = `bloqueo.${stamp}`
const lockPassword = strongPassword()
r = await admin.req('POST', '/api/users', { username: lockUser, full_name: 'Prueba Bloqueo', role: 'consulta', password: lockPassword })
const lockId = r.data.user?.id
for (let i = 0; i < 5; i += 1) await new Client().login(lockUser, 'Equivocada#123')
r = await new Client().login(lockUser, lockPassword)
check('tras 5 fallos la cuenta se bloquea aun con la clave correcta', r.status === 401)
r = await admin.req('GET', '/api/users')
check('admin ve la cuenta como bloqueada', (r.data.items || []).some((u) => u.id === lockId && u.locked))
r = await admin.req('POST', `/api/users/${lockId}/unlock`, {})
check('admin desbloquea', r.status === 200 && r.data.user?.locked === false)
r = await new Client().login(lockUser, lockPassword)
check('después de desbloquear puede ingresar', r.status === 200)

// --- Bodegas ---
const code = `T${stamp}`.toUpperCase().slice(0, 20)
r = await admin.req('POST', '/api/warehouses', { code, name: 'Bodega de prueba' })
check('admin crea bodega', r.status === 201)
r = await admin.req('GET', '/api/warehouses')
const principal = (r.data.items || []).find((w) => w.kind === 'principal')
r = await admin.req('PUT', `/api/warehouses/${principal.id}`, { is_active: false })
check('Principal no se puede desactivar', r.status === 400)

// --- Auditoría y salida ---
r = await admin.req('GET', '/api/audit?limit=50')
const events = new Set((r.data.items || []).map((e) => e.event))
check('auditoría registra ingresos, fallos y bloqueos', ['login_ok', 'login_failed', 'account_locked', 'user_created'].every((e) => events.has(e)))

const oldCookie = admin.cookie
r = await admin.req('POST', '/api/auth/logout', {})
check('logout', r.status === 200)
const replay = new Client()
replay.cookie = oldCookie
r = await replay.req('GET', '/api/auth/me')
check('la cookie anterior quedó revocada en el servidor', r.status === 401)

console.log(`\n${passed} OK · ${failed} fallas\n`)
process.exit(failed ? 1 : 0)
