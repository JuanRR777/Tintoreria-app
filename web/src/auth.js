/** Login, sesiones por cookie y control de acceso por rol. */

import { HttpError, clientIp, json, readJson } from './http.js'
import { clampIterations, hashPassword, passwordProblem, randomToken, sha256Hex, verifyPassword } from './crypto.js'
import { ROLES, can, permissionsFor } from './roles.js'
import { audit } from './audit.js'

const MAX_FAILED = 5
const LOCK_MINUTES = 15
const IP_WINDOW_MINUTES = 15
const IP_MAX_FAILED = 20
const TOUCH_SECONDS = 60
const GENERIC_LOGIN_ERROR = 'Usuario o contraseña incorrectos. Tras 5 intentos fallidos la cuenta se bloquea 15 minutos.'

function idleMinutes(env) {
  const n = Number.parseInt(env.SESSION_IDLE_MINUTES, 10)
  return Number.isFinite(n) && n >= 5 && n <= 240 ? n : 30
}

function maxHours(env) {
  const n = Number.parseInt(env.SESSION_MAX_HOURS, 10)
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : 12
}

function cookieName(url) {
  return url.protocol === 'https:' ? '__Host-tsid' : 'tsid'
}

function sessionCookie(url, token, maxAgeSeconds) {
  const secure = url.protocol === 'https:' ? '; Secure' : ''
  return `${cookieName(url)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`
}

function readSessionToken(request) {
  const url = new URL(request.url)
  const wanted = cookieName(url)
  const header = request.headers.get('Cookie') || ''
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === wanted) {
      const value = rest.join('=')
      return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : ''
    }
  }
  return ''
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    email: row.email || '',
    role: row.role,
    role_label: ROLES[row.role] || row.role,
    is_active: Number(row.is_active) === 1,
    must_change_password: Number(row.must_change_password) === 1,
    locked: Boolean(row.locked_until) && row.locked_active === 1,
    last_login_at: row.last_login_at || null,
    created_at: row.created_at || null,
  }
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return
  if (!token || typeof token !== 'string' || token.length > 2048) {
    throw new HttpError(400, 'Completa la verificación de seguridad')
  }
  const body = new FormData()
  body.append('secret', env.TURNSTILE_SECRET)
  body.append('response', token)
  if (ip && ip !== 'local') body.append('remoteip', ip)
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
  const data = await res.json().catch(() => ({}))
  if (!data.success) throw new HttpError(400, 'La verificación de seguridad falló. Intenta de nuevo.')
}

async function createSession(env, request, userId) {
  const token = randomToken(32)
  const hours = maxHours(env)
  await env.DB.prepare(
    `INSERT INTO web_sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES (?, ?, datetime('now', ?), ?, ?)`,
  ).bind(
    await sha256Hex(token),
    userId,
    `+${hours} hours`,
    clientIp(request),
    (request.headers.get('User-Agent') || '').slice(0, 200),
  ).run()
  return { token, maxAge: hours * 3600 }
}

export async function login(request, env) {
  const url = new URL(request.url)
  const ip = clientIp(request)
  const body = await readJson(request)
  const username = String(body.username || '').trim().toLowerCase()
  const password = String(body.password || '')

  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM web_audit
     WHERE ip = ? AND event = 'login_failed' AND created_at > datetime('now', ?)`,
  ).bind(ip, `-${IP_WINDOW_MINUTES} minutes`).first()
  if (Number(recent?.n || 0) >= IP_MAX_FAILED) {
    throw new HttpError(429, 'Demasiados intentos desde esta conexión. Espera 15 minutos.')
  }

  await verifyTurnstile(env, body.turnstile_token, ip)

  if (!username || username.length > 64 || !password || password.length > 128) {
    throw new HttpError(401, GENERIC_LOGIN_ERROR)
  }

  const user = await env.DB.prepare(
    `SELECT *, CASE WHEN locked_until > datetime('now') THEN 1 ELSE 0 END AS locked_active
     FROM web_users WHERE username = ?`,
  ).bind(username).first()

  const configured = clampIterations(env.PBKDF2_ITERATIONS)
  const check = await verifyPassword(password, user ? user.password_hash : null, configured)
  const locked = Boolean(user) && Number(user.locked_active) === 1
  const active = Boolean(user) && Number(user.is_active) === 1

  if (!check.ok || locked || !active) {
    if (user && !locked && active && !check.ok) {
      const failed = Number(user.failed_attempts || 0) + 1
      if (failed >= MAX_FAILED) {
        await env.DB.prepare(
          `UPDATE web_users SET failed_attempts = 0, locked_until = datetime('now', ?),
             updated_at = datetime('now') WHERE id = ?`,
        ).bind(`+${LOCK_MINUTES} minutes`, user.id).run()
        await audit(env, request, { id: user.id, username: user.username }, 'account_locked', `${MAX_FAILED} intentos fallidos`)
      } else {
        await env.DB.prepare(
          'UPDATE web_users SET failed_attempts = ?, updated_at = datetime(\'now\') WHERE id = ?',
        ).bind(failed, user.id).run()
      }
    }
    const reason = !user ? 'usuario inexistente' : locked ? 'cuenta bloqueada' : !active ? 'cuenta inactiva' : 'contraseña incorrecta'
    await audit(env, request, user ? { id: user.id, username: user.username } : { username }, 'login_failed', reason)
    throw new HttpError(401, GENERIC_LOGIN_ERROR)
  }

  const statements = [
    env.DB.prepare(
      `UPDATE web_users SET failed_attempts = 0, locked_until = NULL,
         last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    ).bind(user.id),
  ]
  if (check.iterations < configured) {
    statements.push(
      env.DB.prepare('UPDATE web_users SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(password, configured), user.id),
    )
  }
  await env.DB.batch(statements)

  const session = await createSession(env, request, user.id)
  await audit(env, request, user, 'login_ok', null)
  const fresh = { ...user, locked_active: 0 }
  return json(
    { user: publicUser(fresh), permissions: permissionsFor(user.role), idle_minutes: idleMinutes(env) },
    200,
    { 'Set-Cookie': sessionCookie(url, session.token, session.maxAge) },
  )
}

/** Devuelve { user, sessionId } o null. Aplica cierre por inactividad. */
export async function currentSession(request, env) {
  const token = readSessionToken(request)
  if (!token) return null
  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id,
            CASE WHEN s.last_seen_at > datetime('now', ?) THEN 1 ELSE 0 END AS fresh,
            CASE WHEN s.last_seen_at < datetime('now', ?) THEN 1 ELSE 0 END AS stale_touch,
            u.*, 0 AS locked_active
     FROM web_sessions s
     JOIN web_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')`,
  ).bind(`-${idleMinutes(env)} minutes`, `-${TOUCH_SECONDS} seconds`, tokenHash).first()
  if (!row) return null
  if (Number(row.fresh) !== 1 || Number(row.is_active) !== 1) {
    await env.DB.prepare("UPDATE web_sessions SET revoked_at = datetime('now') WHERE id = ?").bind(row.session_id).run()
    return null
  }
  if (Number(row.stale_touch) === 1) {
    await env.DB.prepare("UPDATE web_sessions SET last_seen_at = datetime('now') WHERE id = ?").bind(row.session_id).run()
  }
  return { user: row, sessionId: row.session_id }
}

/**
 * Exige sesión y, si se indica, un permiso. Mientras el usuario deba cambiar
 * la contraseña solo puede ver su perfil, cerrar sesión o cambiarla.
 */
export async function requireUser(request, env, permission = null, { allowPendingPassword = false } = {}) {
  const session = await currentSession(request, env)
  if (!session) throw new HttpError(401, 'Tu sesión terminó. Ingresa de nuevo.', 'session_required')
  const { user } = session
  if (!allowPendingPassword && Number(user.must_change_password) === 1) {
    throw new HttpError(403, 'Debes cambiar tu contraseña antes de continuar.', 'password_change_required')
  }
  if (permission && !can(user.role, permission)) {
    throw new HttpError(403, 'Tu rol no tiene acceso a esta sección.', 'forbidden')
  }
  return session
}

export async function me(request, env) {
  const { user } = await requireUser(request, env, null, { allowPendingPassword: true })
  return json({ user: publicUser(user), permissions: permissionsFor(user.role), idle_minutes: idleMinutes(env) })
}

export async function logout(request, env) {
  const url = new URL(request.url)
  const session = await currentSession(request, env)
  if (session) {
    await env.DB.prepare("UPDATE web_sessions SET revoked_at = datetime('now') WHERE id = ?").bind(session.sessionId).run()
    await audit(env, request, session.user, 'logout', null)
  }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(url, 'x', 0) })
}

export async function changeOwnPassword(request, env) {
  const { user, sessionId } = await requireUser(request, env, null, { allowPendingPassword: true })
  const body = await readJson(request)
  const current = String(body.current_password || '')
  const next = String(body.new_password || '')
  const configured = clampIterations(env.PBKDF2_ITERATIONS)
  const check = await verifyPassword(current, user.password_hash, configured)
  if (!check.ok) {
    await audit(env, request, user, 'password_change_failed', 'contraseña actual incorrecta')
    throw new HttpError(400, 'La contraseña actual no es correcta')
  }
  const problem = passwordProblem(next, user.username)
  if (problem) throw new HttpError(400, problem)
  if (next === current) throw new HttpError(400, 'La nueva contraseña debe ser distinta de la actual')

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE web_users SET password_hash = ?, must_change_password = 0,
         password_changed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    ).bind(await hashPassword(next, configured), user.id),
    env.DB.prepare(
      "UPDATE web_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL",
    ).bind(user.id, sessionId),
  ])
  await audit(env, request, user, 'password_changed', null)
  return json({ ok: true })
}

export function publicConfig(env) {
  return json({ turnstile_site_key: env.TURNSTILE_SITE_KEY || '' })
}
