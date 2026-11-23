/** Administración de usuarios del portal (solo administrador). */

import { HttpError, json, readJson } from './http.js'
import { clampIterations, cleanPassword, hashPassword, passwordProblem } from './crypto.js'
import { isRole } from './roles.js'
import { publicUser, requireUser } from './auth.js'
import { audit } from './audit.js'

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const USER_COLUMNS = `id, username, full_name, email, role, is_active, must_change_password,
  locked_until, last_login_at, created_at,
  CASE WHEN locked_until > datetime('now') THEN 1 ELSE 0 END AS locked_active`

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ')
  if (name.length < 3 || name.length > 80) throw new HttpError(400, 'El nombre debe tener entre 3 y 80 caracteres')
  return name.toLocaleUpperCase('es-CO')
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!email) return null
  if (email.length > 120 || !EMAIL_RE.test(email)) throw new HttpError(400, 'El correo no es válido')
  return email
}

function cleanRole(value) {
  const role = String(value || '')
  if (!isRole(role)) throw new HttpError(400, 'Rol no válido')
  return role
}

function parseId(raw) {
  const id = Number.parseInt(raw, 10)
  if (!Number.isFinite(id) || id < 1) throw new HttpError(404, 'Usuario no encontrado')
  return id
}

async function findUser(env, id) {
  const row = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM web_users WHERE id = ?`).bind(id).first()
  if (!row) throw new HttpError(404, 'Usuario no encontrado')
  return row
}

async function activeAdmins(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM web_users WHERE role = 'admin' AND is_active = 1",
  ).first()
  return Number(row?.n || 0)
}

function revokeSessions(env, userId) {
  return env.DB.prepare(
    "UPDATE web_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL",
  ).bind(userId)
}

export async function listUsers(request, env) {
  await requireUser(request, env, 'users.manage')
  const { results } = await env.DB.prepare(
    `SELECT ${USER_COLUMNS} FROM web_users ORDER BY is_active DESC, full_name COLLATE NOCASE`,
  ).all()
  return json({ items: (results || []).map(publicUser) })
}

export async function createUser(request, env) {
  const { user: actor } = await requireUser(request, env, 'users.manage')
  const body = await readJson(request)
  const username = String(body.username || '').trim().toLowerCase()
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, 'El usuario debe tener 3 a 32 caracteres: letras minúsculas, números, punto, guion o guion bajo')
  }
  const fullName = cleanName(body.full_name)
  const email = cleanEmail(body.email)
  const role = cleanRole(body.role)
  const password = cleanPassword(body.password)
  const problem = passwordProblem(password, username)
  if (problem) throw new HttpError(400, problem)

  const exists = await env.DB.prepare('SELECT id FROM web_users WHERE username = ?').bind(username).first()
  if (exists) throw new HttpError(409, 'Ese usuario ya existe')

  const hash = await hashPassword(password, clampIterations(env.PBKDF2_ITERATIONS))
  const result = await env.DB.prepare(
    `INSERT INTO web_users (username, full_name, email, role, password_hash, must_change_password, created_by)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).bind(username, fullName, email, role, hash, actor.id).run()
  const id = result.meta.last_row_id
  await audit(env, request, actor, 'user_created', `${username} (${role})`)
  return json({ user: publicUser(await findUser(env, id)) }, 201)
}

export async function updateUser(request, env, rawId) {
  const { user: actor } = await requireUser(request, env, 'users.manage')
  const id = parseId(rawId)
  const target = await findUser(env, id)
  const body = await readJson(request)

  const next = {
    full_name: body.full_name !== undefined ? cleanName(body.full_name) : target.full_name,
    email: body.email !== undefined ? cleanEmail(body.email) : target.email,
    role: body.role !== undefined ? cleanRole(body.role) : target.role,
    is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : Number(target.is_active),
  }

  const isSelf = id === actor.id
  if (isSelf && next.is_active === 0) throw new HttpError(400, 'No puedes desactivar tu propia cuenta')
  if (isSelf && next.role !== 'admin') throw new HttpError(400, 'No puedes quitarte el rol de administrador')
  const losesAdmin = target.role === 'admin' && Number(target.is_active) === 1 && (next.role !== 'admin' || next.is_active === 0)
  if (losesAdmin && (await activeAdmins(env)) <= 1) {
    throw new HttpError(400, 'Debe quedar al menos un administrador activo')
  }

  const accessChanged = next.role !== target.role || next.is_active !== Number(target.is_active)
  const statements = [
    env.DB.prepare(
      `UPDATE web_users SET full_name = ?, email = ?, role = ?, is_active = ?,
         updated_at = datetime('now') WHERE id = ?`,
    ).bind(next.full_name, next.email, next.role, next.is_active, id),
  ]
  if (accessChanged) statements.push(revokeSessions(env, id))
  await env.DB.batch(statements)

  const changes = []
  if (next.role !== target.role) changes.push(`rol ${target.role} → ${next.role}`)
  if (next.is_active !== Number(target.is_active)) changes.push(next.is_active ? 'activado' : 'desactivado')
  if (next.full_name !== target.full_name) changes.push('nombre')
  if ((next.email || null) !== (target.email || null)) changes.push('correo')
  await audit(env, request, actor, 'user_updated', `${target.username}: ${changes.join(', ') || 'sin cambios'}`)
  return json({ user: publicUser(await findUser(env, id)) })
}

export async function resetPassword(request, env, rawId) {
  const { user: actor } = await requireUser(request, env, 'users.manage')
  const id = parseId(rawId)
  const target = await findUser(env, id)
  const body = await readJson(request)
  const password = cleanPassword(body.password)
  const problem = passwordProblem(password, target.username)
  if (problem) throw new HttpError(400, problem)

  const hash = await hashPassword(password, clampIterations(env.PBKDF2_ITERATIONS))
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE web_users SET password_hash = ?, must_change_password = 1, failed_attempts = 0,
         locked_until = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).bind(hash, id),
    revokeSessions(env, id),
  ])
  await audit(env, request, actor, 'password_reset', target.username)
  return json({ user: publicUser(await findUser(env, id)) })
}

export async function unlockUser(request, env, rawId) {
  const { user: actor } = await requireUser(request, env, 'users.manage')
  const id = parseId(rawId)
  const target = await findUser(env, id)
  await env.DB.prepare(
    "UPDATE web_users SET failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?",
  ).bind(id).run()
  await audit(env, request, actor, 'user_unlocked', target.username)
  return json({ user: publicUser(await findUser(env, id)) })
}
