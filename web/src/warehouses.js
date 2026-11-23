/**
 * Bodegas. Principal (10502) y Laboratorio se enlazan con los saldos que ya
 * usa la app de escritorio, por eso su código no cambia y no se desactivan.
 */

import { HttpError, json, readJson } from './http.js'
import { can } from './roles.js'
import { requireUser } from './auth.js'
import { audit } from './audit.js'

const CODE_RE = /^[A-Za-z0-9-]{1,20}$/
const FIXED_KINDS = new Set(['principal', 'laboratorio'])

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'El nombre debe tener entre 2 y 60 caracteres')
  return name.toLocaleUpperCase('es-CO')
}

function cleanOrder(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < 0 || n > 999) throw new HttpError(400, 'El orden debe estar entre 0 y 999')
  return n
}

export async function listWarehouses(request, env) {
  const { user } = await requireUser(request, env, 'warehouses.view')
  const all = can(user.role, 'warehouses.manage')
  const { results } = await env.DB.prepare(
    `SELECT id, code, name, kind, is_active, sort_order FROM warehouses
     ${all ? '' : 'WHERE is_active = 1'}
     ORDER BY sort_order, name COLLATE NOCASE`,
  ).all()
  return json({
    items: (results || []).map((w) => ({ ...w, is_active: Number(w.is_active) === 1, fixed: FIXED_KINDS.has(w.kind) })),
  })
}

export async function createWarehouse(request, env) {
  const { user } = await requireUser(request, env, 'warehouses.manage')
  const body = await readJson(request)
  const code = String(body.code || '').trim().toUpperCase()
  if (!CODE_RE.test(code)) throw new HttpError(400, 'El código debe tener 1 a 20 letras, números o guiones')
  const name = cleanName(body.name)
  const order = cleanOrder(body.sort_order, 10)
  const exists = await env.DB.prepare('SELECT id FROM warehouses WHERE code = ?').bind(code).first()
  if (exists) throw new HttpError(409, 'Ya existe una bodega con ese código')
  const result = await env.DB.prepare(
    "INSERT INTO warehouses (code, name, kind, sort_order) VALUES (?, ?, 'otra', ?)",
  ).bind(code, name, order).run()
  await audit(env, request, user, 'warehouse_created', `${code} ${name}`)
  return json({ id: result.meta.last_row_id }, 201)
}

export async function updateWarehouse(request, env, rawId) {
  const { user } = await requireUser(request, env, 'warehouses.manage')
  const id = Number.parseInt(rawId, 10)
  const current = Number.isFinite(id)
    ? await env.DB.prepare('SELECT * FROM warehouses WHERE id = ?').bind(id).first()
    : null
  if (!current) throw new HttpError(404, 'Bodega no encontrada')
  const body = await readJson(request)
  const name = body.name !== undefined ? cleanName(body.name) : current.name
  const order = cleanOrder(body.sort_order, current.sort_order)
  const active = body.is_active !== undefined ? (body.is_active ? 1 : 0) : Number(current.is_active)
  if (FIXED_KINDS.has(current.kind) && active === 0) {
    throw new HttpError(400, 'Principal y Laboratorio no se pueden desactivar')
  }
  await env.DB.prepare(
    "UPDATE warehouses SET name = ?, sort_order = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(name, order, active, id).run()
  await audit(env, request, user, 'warehouse_updated', `${current.code}: ${name}${active ? '' : ' (inactiva)'}`)
  return json({ ok: true })
}
