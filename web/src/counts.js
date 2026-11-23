/**
 * Conteo físico por bodega.
 *
 * abierto  → almacén registra lo que encuentra (a ciegas: no ve el saldo del sistema)
 * revision → el administrador revisa diferencias, hallazgos y lo que nadie contó
 * aplicado → el inventario de la app queda igual a lo contado, con movimientos de ajuste
 *
 * Principal ajusta chemical_lots.quantity_remaining / chemicals.stock_quantity.
 * Laboratorio ajusta chemical_lots.lab_quantity / chemicals.lab_quantity.
 * Nunca toca recetas, pesajes ni procesos.
 */

import { HttpError, json, readJson } from './http.js'
import { requireUser } from './auth.js'
import { audit } from './audit.js'
import { can } from './roles.js'

const BALANCE = {
  principal: { lot: 'quantity_remaining', chem: 'stock_quantity', ref: 'conteo' },
  laboratorio: { lot: 'lab_quantity', chem: 'lab_quantity', ref: 'conteo_lab' },
}

const STATUS_LABEL = { abierto: 'abierto', revision: 'en revisión', aplicado: 'aplicado', anulado: 'anulado' }
const EPS = 0.0000005

// Factor a la base de cada familia: masa en kg, volumen en L.
const UNITS = {
  kg: ['masa', 1],
  g: ['masa', 0.001],
  L: ['volumen', 1],
  mL: ['volumen', 0.001],
  gal: ['volumen', 3.785411784],
}
const FINDING_UNITS = new Set([...Object.keys(UNITS), 'und'])
const PACKAGE_RE = /^[\p{L} ]{2,20}$/u

function activeLine(alias = '') {
  const a = alias ? `${alias}.` : ''
  return `${a}deleted_at IS NULL AND ${a}superseded_at IS NULL AND ${a}chemical_id IS NOT NULL
    AND (${a}finding_status IS NULL OR ${a}finding_status = 'asignado')`
}

const GUARD_REVIEW = "EXISTS (SELECT 1 FROM inventory_counts WHERE id = ? AND status = 'revision')"

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6
}

function parseId(raw, what = 'Conteo') {
  const id = Number.parseInt(raw, 10)
  if (!Number.isFinite(id) || id < 1) throw new HttpError(404, `${what} no encontrado`)
  return id
}

function parseQty(value) {
  const text = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(text)) throw new HttpError(400, 'La cantidad debe ser un número mayor o igual a cero')
  const n = Number(text)
  if (!Number.isFinite(n) || n < 0 || n > 1000000) throw new HttpError(400, 'La cantidad no es válida')
  return n
}

/**
 * Convierte entre unidades. Masa ↔ volumen solo con la densidad del producto
 * (g/mL, que equivale a kg/L); sin densidad no se adivina.
 */
function convert(qty, from, to, density = null) {
  if (from === to) return qty
  const source = UNITS[from]
  const target = UNITS[to]
  if (!source || !target) throw new HttpError(400, `Unidad no válida: ${from}`)
  let base = qty * source[1]
  if (source[0] !== target[0]) {
    const d = Number(density)
    if (!(d > 0)) {
      const allowed = target[0] === 'masa' ? 'kg o g' : 'L, mL o galones'
      throw new HttpError(400, `Este producto no tiene densidad registrada. Regístralo en ${allowed}, o pide que agreguen la densidad en la app.`)
    }
    base = source[0] === 'volumen' ? base * d : base / d
  }
  return base / target[1]
}

/** Modo envases: "3 bultos de 25 kg + 12,5 kg sueltos". Devuelve null si es por peso. */
function readPackage(body) {
  if (body.package_type === undefined || body.package_type === null || body.package_type === '') return null
  const type = cleanText(body.package_type, 20, 'El tipo de envase')?.toLowerCase()
  if (!type || !PACKAGE_RE.test(type)) throw new HttpError(400, 'Tipo de envase no válido (solo letras, 2 a 20)')
  const count = parseQty(body.package_count)
  const content = parseQty(body.package_content)
  if (!(content > 0)) throw new HttpError(400, 'Indica cuánto trae cada envase')
  const unit = String(body.package_unit || '')
  if (!UNITS[unit]) throw new HttpError(400, 'Unidad del envase no válida')
  let looseQty = null
  let looseUnit = null
  if (body.loose_qty !== undefined && body.loose_qty !== null && String(body.loose_qty).trim() !== '') {
    looseQty = parseQty(body.loose_qty)
    looseUnit = String(body.loose_unit || unit)
    if (!UNITS[looseUnit]) throw new HttpError(400, 'Unidad del sobrante no válida')
  }
  return { type, count, content, unit, looseQty, looseUnit }
}

function packageTotal(pkg, toUnit, density) {
  let total = convert(pkg.count * pkg.content, pkg.unit, toUnit, density)
  if (pkg.looseQty) total += convert(pkg.looseQty, pkg.looseUnit, toUnit, density)
  return total
}

function packageFromLine(line) {
  if (!line.package_type) return null
  return {
    type: line.package_type,
    count: line.package_count,
    content: line.package_content,
    unit: line.package_unit,
    looseQty: line.loose_qty,
    looseUnit: line.loose_unit,
  }
}

function packageColumns(pkg) {
  return {
    package_type: pkg ? pkg.type : null,
    package_count: pkg ? pkg.count : null,
    package_content: pkg ? pkg.content : null,
    package_unit: pkg ? pkg.unit : null,
    loose_qty: pkg ? pkg.looseQty : null,
    loose_unit: pkg ? pkg.looseUnit : null,
  }
}

/** Igual que la app: S/N, SN, SIN LOTE, N/A… quedan como S/N. */
export function normalizeLot(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  if (!text || ['S/N', 'S.N', 'S.N.', 'SN', 'SIN LOTE', 'N/A', 'NA'].includes(text)) return 'S/N'
  if (text.length > 40) throw new HttpError(400, 'El lote no puede pasar de 40 caracteres')
  return text
}

function cleanText(value, max, label) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (text.length > max) throw new HttpError(400, `${label} no puede pasar de ${max} caracteres`)
  return text || null
}

/** Texto libre siempre en mayúsculas (ubicación, notas…). */
function upper(text) {
  return text ? text.toLocaleUpperCase('es-CO') : text
}

async function loadCount(env, id) {
  const row = await env.DB.prepare(
    `SELECT c.*, w.name AS warehouse_name, w.code AS warehouse_code, w.kind AS warehouse_kind
     FROM inventory_counts c JOIN warehouses w ON w.id = c.warehouse_id
     WHERE c.id = ?`,
  ).bind(id).first()
  if (!row) throw new HttpError(404, 'Conteo no encontrado')
  return row
}

function balanceFor(count) {
  const balance = BALANCE[count.warehouse_kind]
  if (!balance) throw new HttpError(400, 'Esta bodega todavía no maneja saldo propio')
  return balance
}

function assertStatus(count, allowed, action) {
  if (!allowed.includes(count.status)) {
    throw new HttpError(409, `No se puede ${action}: el conteo está ${STATUS_LABEL[count.status] || count.status}`)
  }
}

function publicCount(row) {
  return {
    id: row.id,
    status: row.status,
    notes: row.notes || '',
    warehouse_id: row.warehouse_id,
    warehouse_name: row.warehouse_name,
    warehouse_code: row.warehouse_code,
    warehouse_kind: row.warehouse_kind,
    opened_at: row.opened_at,
    opened_by_name: row.opened_by_name || null,
    closed_at: row.closed_at || null,
    applied_at: row.applied_at || null,
    siesa_adjusted_at: row.siesa_adjusted_at || null,
    cancelled_at: row.cancelled_at || null,
    items_total: row.items_total ?? undefined,
    items_counted: row.items_counted ?? undefined,
    lines: row.lines ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Lista y apertura
// ---------------------------------------------------------------------------

export async function listCounts(request, env) {
  const { user } = await requireUser(request, env, 'count.register')
  const admin = can(user.role, 'count.approve')
  const { results } = await env.DB.prepare(
    `SELECT c.*, w.name AS warehouse_name, w.code AS warehouse_code, w.kind AS warehouse_kind,
            u.full_name AS opened_by_name,
            (SELECT COUNT(*) FROM inventory_count_items i WHERE i.count_id = c.id) AS items_total,
            (SELECT COUNT(DISTINCT l.chemical_id) FROM inventory_count_lines l
              WHERE l.count_id = c.id AND ${activeLine('l')}) AS items_counted,
            (SELECT COUNT(*) FROM inventory_count_lines l
              WHERE l.count_id = c.id AND l.deleted_at IS NULL AND l.superseded_at IS NULL) AS lines
     FROM inventory_counts c
     JOIN warehouses w ON w.id = c.warehouse_id
     LEFT JOIN web_users u ON u.id = c.opened_by
     ${admin ? '' : "WHERE c.status = 'abierto'"}
     ORDER BY c.id DESC LIMIT 30`,
  ).all()
  return json({ items: (results || []).map(publicCount) })
}

export async function openCount(request, env) {
  const { user } = await requireUser(request, env, 'count.approve')
  const body = await readJson(request)
  const warehouseId = parseId(body.warehouse_id, 'Bodega')
  const notes = upper(cleanText(body.notes, 200, 'La nota'))
  const warehouse = await env.DB.prepare('SELECT * FROM warehouses WHERE id = ? AND is_active = 1').bind(warehouseId).first()
  if (!warehouse) throw new HttpError(404, 'Bodega no encontrada o inactiva')
  const balance = BALANCE[warehouse.kind]
  if (!balance) throw new HttpError(400, 'Por ahora solo se puede contar Principal o Laboratorio')

  const active = await env.DB.prepare(
    "SELECT id FROM inventory_counts WHERE warehouse_id = ? AND status IN ('abierto','revision')",
  ).bind(warehouseId).first()
  if (active) throw new HttpError(409, `Ya hay un conteo activo en ${warehouse.name} (#${active.id})`)

  let countId
  try {
    const result = await env.DB.prepare(
      'INSERT INTO inventory_counts (warehouse_id, notes, opened_by) VALUES (?, ?, ?)',
    ).bind(warehouseId, notes, user.id).run()
    countId = result.meta.last_row_id
  } catch (err) {
    if (String(err.message || err).includes('UNIQUE')) {
      throw new HttpError(409, `Ya hay un conteo activo en ${warehouse.name}`)
    }
    throw err
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO inventory_count_items (count_id, chemical_id, code, name, unit, system_qty, unit_price, currency)
         SELECT ?, id, code, name, unit, ROUND(COALESCE(${balance.chem}, 0), 6),
                COALESCE(last_unit_price, 0), COALESCE(last_unit_currency, 'COP')
         FROM chemicals
         WHERE deleted_at IS NULL AND code NOT LIKE 'TMP%'
           AND (is_active = 1 OR COALESCE(${balance.chem}, 0) > 0)`,
      ).bind(countId),
      env.DB.prepare(
        `INSERT INTO inventory_count_lots (count_id, chemical_id, lot_id, lot_number, system_qty)
         SELECT ?, l.chemical_id, l.id, l.lot_number, ROUND(COALESCE(l.${balance.lot}, 0), 6)
         FROM chemical_lots l
         JOIN inventory_count_items i ON i.chemical_id = l.chemical_id AND i.count_id = ?`,
      ).bind(countId, countId),
    ])
  } catch (err) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM inventory_count_lots WHERE count_id = ?').bind(countId),
      env.DB.prepare('DELETE FROM inventory_count_items WHERE count_id = ?').bind(countId),
      env.DB.prepare('DELETE FROM inventory_counts WHERE id = ?').bind(countId),
    ])
    throw err
  }

  await audit(env, request, user, 'count_opened', `#${countId} ${warehouse.name}`)
  return json({ count: publicCount(await loadCount(env, countId)) }, 201)
}

// ---------------------------------------------------------------------------
// Lo que ve quien cuenta (sin saldos del sistema)
// ---------------------------------------------------------------------------

export async function getCount(request, env, rawId) {
  const { user } = await requireUser(request, env, 'count.register')
  const count = await loadCount(env, parseId(rawId))
  const admin = can(user.role, 'count.approve')
  if (!admin && count.status !== 'abierto') throw new HttpError(404, 'Conteo no disponible')

  const [items, lots, packages] = await env.DB.batch([
    env.DB.prepare(
      `SELECT i.chemical_id, i.code, i.name, i.unit, c.density_g_ml AS density,
              CASE WHEN i.recount_requested_at IS NOT NULL THEN 1 ELSE 0 END AS recount,
              (SELECT COUNT(*) FROM inventory_count_lines l
                WHERE l.count_id = i.count_id AND l.chemical_id = i.chemical_id AND ${activeLine('l')}) AS lines
       FROM inventory_count_items i
       JOIN chemicals c ON c.id = i.chemical_id
       WHERE i.count_id = ?
       ORDER BY i.name COLLATE NOCASE`,
    ).bind(count.id),
    env.DB.prepare(
      `SELECT l.chemical_id, l.id AS lot_id, l.lot_number
       FROM chemical_lots l
       JOIN inventory_count_items i ON i.chemical_id = l.chemical_id AND i.count_id = ?
       ORDER BY l.id DESC`,
    ).bind(count.id),
    // Último envase usado por producto (en cualquier conteo) para proponerlo de una vez.
    env.DB.prepare(
      `SELECT chemical_id, package_type, package_content, package_unit FROM inventory_count_lines
       WHERE package_type IS NOT NULL AND chemical_id IS NOT NULL AND deleted_at IS NULL
       ORDER BY id DESC LIMIT 2000`,
    ),
  ])
  const lastPackage = new Map()
  for (const p of packages.results || []) {
    if (!lastPackage.has(p.chemical_id)) {
      lastPackage.set(p.chemical_id, { type: p.package_type, content: p.package_content, unit: p.package_unit })
    }
  }
  return json({
    count: publicCount(count),
    items: (items.results || []).map((i) => ({
      ...i,
      density: Number(i.density) > 0 ? Number(i.density) : null,
      recount: Number(i.recount) === 1,
      last_package: lastPackage.get(i.chemical_id) || null,
    })),
    lots: lots.results || [],
  })
}

export async function listLines(request, env, rawId, url) {
  const { user } = await requireUser(request, env, 'count.register')
  const count = await loadCount(env, parseId(rawId))
  if (!can(user.role, 'count.approve') && count.status !== 'abierto') throw new HttpError(404, 'Conteo no disponible')
  const chemicalId = url.searchParams.get('chemical_id')
  const filter = chemicalId ? 'AND l.chemical_id = ?' : ''
  const stmt = env.DB.prepare(
    `SELECT l.id, l.chemical_id, l.finding_name, l.finding_status, l.lot_id, l.lot_number,
            l.qty, l.qty_entered, l.unit_entered, l.location, l.notes, l.client_uuid,
            l.package_type, l.package_count, l.package_content, l.package_unit, l.loose_qty, l.loose_unit,
            l.counted_by, l.counted_at, l.updated_at,
            i.code, i.name, i.unit, u.full_name AS counted_by_name
     FROM inventory_count_lines l
     LEFT JOIN inventory_count_items i ON i.count_id = l.count_id AND i.chemical_id = l.chemical_id
     LEFT JOIN web_users u ON u.id = l.counted_by
     WHERE l.count_id = ? AND l.deleted_at IS NULL AND l.superseded_at IS NULL
       AND (l.finding_status IS NULL OR l.finding_status != 'descartado') ${filter}
     ORDER BY l.id DESC LIMIT 500`,
  )
  const { results } = await (chemicalId ? stmt.bind(count.id, parseId(chemicalId, 'Producto')) : stmt.bind(count.id)).all()
  return json({
    items: (results || []).map((l) => ({ ...l, mine: l.counted_by === user.id })),
  })
}

async function resolveLineInput(env, count, body) {
  const pkg = readPackage(body)
  const unitEntered = pkg ? pkg.type : String(body.unit_entered || '').trim()
  const qtyEntered = pkg ? pkg.count : parseQty(body.qty_entered)
  const location = upper(cleanText(body.location, 40, 'La ubicación'))
  const notes = upper(cleanText(body.notes, 200, 'La nota'))

  if (body.chemical_id === undefined || body.chemical_id === null || body.chemical_id === '') {
    const name = cleanText(body.finding_name, 80, 'El nombre')
    if (!name || name.length < 3) throw new HttpError(400, 'Escribe el nombre del producto encontrado (mínimo 3 letras)')
    if (!pkg && !FINDING_UNITS.has(unitEntered)) throw new HttpError(400, 'Unidad no válida')
    return {
      chemical_id: null,
      finding_name: name.toUpperCase(),
      finding_status: 'pendiente',
      lot_id: null,
      lot_number: normalizeLot(body.lot_number),
      // Hallazgo por envases: total en la unidad del envase hasta que se asigne a un producto.
      qty: round6(pkg ? packageTotal(pkg, pkg.unit, null) : qtyEntered),
      qty_entered: qtyEntered,
      unit_entered: unitEntered,
      ...packageColumns(pkg),
      location,
      notes,
    }
  }

  const chemicalId = parseId(body.chemical_id, 'Producto')
  const item = await env.DB.prepare(
    `SELECT i.chemical_id, i.unit, c.density_g_ml AS density
     FROM inventory_count_items i JOIN chemicals c ON c.id = i.chemical_id
     WHERE i.count_id = ? AND i.chemical_id = ?`,
  ).bind(count.id, chemicalId).first()
  if (!item) throw new HttpError(400, 'Ese producto no está en este conteo')
  if (!pkg && !UNITS[unitEntered]) throw new HttpError(400, 'Unidad no válida')

  let lotId = null
  let lotNumber
  if (body.lot_id !== undefined && body.lot_id !== null && body.lot_id !== '') {
    const lot = await env.DB.prepare('SELECT id, lot_number FROM chemical_lots WHERE id = ? AND chemical_id = ?')
      .bind(parseId(body.lot_id, 'Lote'), chemicalId).first()
    if (!lot) throw new HttpError(400, 'Ese lote no pertenece al producto')
    lotId = lot.id
    lotNumber = normalizeLot(lot.lot_number)
  } else {
    lotNumber = normalizeLot(body.lot_number)
    const lot = await env.DB.prepare(
      'SELECT id FROM chemical_lots WHERE chemical_id = ? AND UPPER(lot_number) = ? ORDER BY id LIMIT 1',
    ).bind(chemicalId, lotNumber).first()
    lotId = lot ? lot.id : null
  }

  return {
    chemical_id: chemicalId,
    finding_name: null,
    finding_status: null,
    lot_id: lotId,
    lot_number: lotNumber,
    qty: round6(pkg ? packageTotal(pkg, item.unit, item.density) : convert(qtyEntered, unitEntered, item.unit, item.density)),
    qty_entered: qtyEntered,
    unit_entered: unitEntered,
    ...packageColumns(pkg),
    location,
    notes,
  }
}

const LINE_SELECT = `SELECT l.*, i.code, i.name, i.unit FROM inventory_count_lines l
  LEFT JOIN inventory_count_items i ON i.count_id = l.count_id AND i.chemical_id = l.chemical_id`

export async function createLine(request, env, rawId) {
  const { user } = await requireUser(request, env, 'count.register')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, ['abierto'], 'registrar')
  const body = await readJson(request)
  const uuid = String(body.client_uuid || '')
  if (!/^[A-Za-z0-9-]{8,64}$/.test(uuid)) throw new HttpError(400, 'Identificador de registro inválido')

  const existing = await env.DB.prepare(`${LINE_SELECT} WHERE l.count_id = ? AND l.client_uuid = ?`).bind(count.id, uuid).first()
  if (existing) return json({ line: existing, duplicate: true })

  const line = await resolveLineInput(env, count, body)
  const statements = [
    env.DB.prepare(
      `INSERT INTO inventory_count_lines
         (count_id, chemical_id, finding_name, finding_status, lot_id, lot_number, qty, qty_entered,
          unit_entered, package_type, package_count, package_content, package_unit, loose_qty, loose_unit,
          location, notes, client_uuid, counted_by)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM inventory_counts WHERE id = ? AND status = 'abierto')
       ON CONFLICT (count_id, client_uuid) DO NOTHING`,
    ).bind(
      count.id, line.chemical_id, line.finding_name, line.finding_status, line.lot_id, line.lot_number,
      line.qty, line.qty_entered, line.unit_entered, line.package_type, line.package_count,
      line.package_content, line.package_unit, line.loose_qty, line.loose_unit,
      line.location, line.notes, uuid, user.id, count.id,
    ),
  ]
  if (line.chemical_id) {
    statements.push(
      env.DB.prepare('UPDATE inventory_count_items SET recount_requested_at = NULL WHERE count_id = ? AND chemical_id = ?')
        .bind(count.id, line.chemical_id),
    )
  }
  await env.DB.batch(statements)
  const saved = await env.DB.prepare(`${LINE_SELECT} WHERE l.count_id = ? AND l.client_uuid = ?`).bind(count.id, uuid).first()
  if (!saved) throw new HttpError(409, 'El conteo ya no está abierto')
  return json({ line: saved, duplicate: false }, 201)
}

async function editableLine(env, count, user, rawLineId) {
  const line = await env.DB.prepare(
    'SELECT * FROM inventory_count_lines WHERE id = ? AND count_id = ? AND deleted_at IS NULL AND superseded_at IS NULL',
  ).bind(parseId(rawLineId, 'Registro'), count.id).first()
  if (!line) throw new HttpError(404, 'Registro no encontrado')
  if (line.counted_by !== user.id && !can(user.role, 'count.approve')) {
    throw new HttpError(403, 'Solo puedes cambiar tus propios registros', 'forbidden')
  }
  return line
}

export async function updateLine(request, env, rawId, rawLineId) {
  const { user } = await requireUser(request, env, 'count.register')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, ['abierto'], 'editar registros')
  const current = await editableLine(env, count, user, rawLineId)
  const body = await readJson(request)
  // Si llegan datos de envase se usan; si llega cantidad simple pasa a peso;
  // si no llega ninguno se conserva lo que tenía el registro.
  const hasPackage = Object.prototype.hasOwnProperty.call(body, 'package_type')
  const hasSimple = body.qty_entered !== undefined || body.unit_entered !== undefined
  const keepPackage = !hasPackage && !hasSimple && current.package_type
  const packageSource = hasPackage ? body : keepPackage ? current : {}
  const merged = {
    chemical_id: current.chemical_id,
    finding_name: current.finding_name,
    lot_id: body.lot_id !== undefined ? body.lot_id : (body.lot_number !== undefined ? null : current.lot_id),
    lot_number: body.lot_number !== undefined ? body.lot_number : current.lot_number,
    qty_entered: body.qty_entered !== undefined ? body.qty_entered : current.qty_entered,
    unit_entered: body.unit_entered !== undefined ? body.unit_entered : current.unit_entered,
    package_type: packageSource.package_type,
    package_count: packageSource.package_count,
    package_content: packageSource.package_content,
    package_unit: packageSource.package_unit,
    loose_qty: packageSource.loose_qty,
    loose_unit: packageSource.loose_unit,
    location: body.location !== undefined ? body.location : current.location,
    notes: body.notes !== undefined ? body.notes : current.notes,
  }
  const line = await resolveLineInput(env, count, merged)
  await env.DB.prepare(
    `UPDATE inventory_count_lines
     SET lot_id = ?, lot_number = ?, qty = ?, qty_entered = ?, unit_entered = ?,
         package_type = ?, package_count = ?, package_content = ?, package_unit = ?, loose_qty = ?, loose_unit = ?,
         location = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(
    line.lot_id, line.lot_number, line.qty, line.qty_entered, line.unit_entered,
    line.package_type, line.package_count, line.package_content, line.package_unit, line.loose_qty, line.loose_unit,
    line.location, line.notes, current.id,
  ).run()
  const saved = await env.DB.prepare(`${LINE_SELECT} WHERE l.id = ?`).bind(current.id).first()
  return json({ line: saved })
}

export async function deleteLine(request, env, rawId, rawLineId) {
  const { user } = await requireUser(request, env, 'count.register')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, ['abierto'], 'borrar registros')
  const line = await editableLine(env, count, user, rawLineId)
  await env.DB.prepare("UPDATE inventory_count_lines SET deleted_at = datetime('now') WHERE id = ?").bind(line.id).run()
  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

async function changeStatus(request, env, rawId, { from, to, column, event, action }) {
  const { user } = await requireUser(request, env, 'count.approve')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, from, action)
  const sets = [`status = '${to}'`, "updated_at = datetime('now')"]
  const binds = []
  if (column) {
    sets.push(`${column}_at = datetime('now')`, `${column}_by = ?`)
    binds.push(user.id)
  }
  const result = await env.DB.prepare(
    `UPDATE inventory_counts SET ${sets.join(', ')} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`,
  ).bind(...binds, count.id, ...from).run()
  if (!result.meta.changes) throw new HttpError(409, 'El conteo cambió mientras tanto. Recarga la página.')
  await audit(env, request, user, event, `#${count.id} ${count.warehouse_name}`)
  return json({ count: publicCount(await loadCount(env, count.id)) })
}

export function closeCount(request, env, rawId) {
  return changeStatus(request, env, rawId, { from: ['abierto'], to: 'revision', column: 'closed', event: 'count_closed', action: 'cerrar' })
}

export function reopenCount(request, env, rawId) {
  return changeStatus(request, env, rawId, { from: ['revision'], to: 'abierto', column: null, event: 'count_reopened', action: 'reabrir' })
}

export function cancelCount(request, env, rawId) {
  return changeStatus(request, env, rawId, { from: ['abierto', 'revision'], to: 'anulado', column: 'cancelled', event: 'count_cancelled', action: 'anular' })
}

// ---------------------------------------------------------------------------
// Revisión (administrador)
// ---------------------------------------------------------------------------

async function buildReview(env, count) {
  const balance = balanceFor(count)
  const [items, counted, current, moved, snapLots, curLots, linesByLot, lines] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM inventory_count_items WHERE count_id = ?').bind(count.id),
    env.DB.prepare(
      `SELECT chemical_id, ROUND(SUM(qty), 6) AS qty, COUNT(*) AS n FROM inventory_count_lines
       WHERE count_id = ? AND ${activeLine()} GROUP BY chemical_id`,
    ).bind(count.id),
    env.DB.prepare(
      `SELECT i.chemical_id, ROUND(COALESCE(c.${balance.chem}, 0), 6) AS qty
       FROM inventory_count_items i JOIN chemicals c ON c.id = i.chemical_id WHERE i.count_id = ?`,
    ).bind(count.id),
    env.DB.prepare(
      `SELECT m.chemical_id, COUNT(*) AS n FROM stock_movements m
       JOIN inventory_count_items i ON i.chemical_id = m.chemical_id AND i.count_id = ?
       WHERE m.created_at > ? AND COALESCE(m.reference_type, '') NOT IN ('conteo', 'conteo_lab')
       GROUP BY m.chemical_id`,
    ).bind(count.id, count.opened_at),
    env.DB.prepare('SELECT chemical_id, lot_id, lot_number, system_qty FROM inventory_count_lots WHERE count_id = ?').bind(count.id),
    env.DB.prepare(
      `SELECT l.chemical_id, l.id AS lot_id, l.lot_number, ROUND(COALESCE(l.${balance.lot}, 0), 6) AS qty
       FROM chemical_lots l JOIN inventory_count_items i ON i.chemical_id = l.chemical_id AND i.count_id = ?`,
    ).bind(count.id),
    env.DB.prepare(
      `SELECT chemical_id, lot_id, UPPER(lot_number) AS lot_number, ROUND(SUM(qty), 6) AS qty
       FROM inventory_count_lines WHERE count_id = ? AND ${activeLine()}
       GROUP BY chemical_id, lot_id, UPPER(lot_number)`,
    ).bind(count.id),
    env.DB.prepare(
      `SELECT l.id, l.chemical_id, l.finding_name, l.finding_status, l.lot_id, l.lot_number, l.qty,
              l.qty_entered, l.unit_entered, l.location, l.notes, l.counted_at, u.full_name AS counted_by_name,
              l.package_type, l.package_count, l.package_content, l.package_unit, l.loose_qty, l.loose_unit
       FROM inventory_count_lines l LEFT JOIN web_users u ON u.id = l.counted_by
       WHERE l.count_id = ? AND l.deleted_at IS NULL AND l.superseded_at IS NULL
       ORDER BY l.id`,
    ).bind(count.id),
  ])

  const mapBy = (rows, key = 'chemical_id') => new Map((rows.results || []).map((r) => [r[key], r]))
  const countedMap = mapBy(counted)
  const currentMap = mapBy(current)
  const movedMap = mapBy(moved)

  const lotsByItem = new Map()
  const lotEntry = (chemicalId, key, lotNumber) => {
    if (!lotsByItem.has(chemicalId)) lotsByItem.set(chemicalId, new Map())
    const lots = lotsByItem.get(chemicalId)
    if (!lots.has(key)) lots.set(key, { lot_number: lotNumber, system_qty: 0, current_qty: 0, counted_qty: 0 })
    return lots.get(key)
  }
  for (const l of snapLots.results || []) lotEntry(l.chemical_id, `id:${l.lot_id}`, l.lot_number).system_qty = l.system_qty
  for (const l of curLots.results || []) lotEntry(l.chemical_id, `id:${l.lot_id}`, l.lot_number).current_qty = l.qty
  for (const l of linesByLot.results || []) {
    const key = l.lot_id ? `id:${l.lot_id}` : `new:${l.lot_number}`
    const entry = lotEntry(l.chemical_id, key, l.lot_number)
    entry.counted_qty = round6(entry.counted_qty + l.qty)
    if (!l.lot_id) entry.is_new = true
  }

  const allLines = lines.results || []
  const linesByItem = new Map()
  for (const line of allLines) {
    if (!line.chemical_id || line.finding_status === 'descartado') continue
    if (!linesByItem.has(line.chemical_id)) linesByItem.set(line.chemical_id, [])
    linesByItem.get(line.chemical_id).push(line)
  }

  const summary = {
    items_total: 0, items_counted: 0, items_resolved: 0, unresolved_with_stock: 0,
    differences: 0, value_total: 0, moved: 0, lines_total: allLines.length, findings_pending: 0,
  }
  const outItems = (items.results || []).map((i) => {
    const c = countedMap.get(i.chemical_id)
    const hasLines = Boolean(c && c.n > 0)
    const confirmedZero = Boolean(i.confirmed_zero_at)
    const resolved = hasLines || confirmedZero
    const countedQty = hasLines ? c.qty : confirmedZero ? 0 : null
    const currentQty = currentMap.get(i.chemical_id)?.qty ?? 0
    const diff = resolved ? round6(countedQty - i.system_qty) : null
    const value = diff === null ? null : Math.round(diff * (i.unit_price || 0))
    const movedDuring = Number(movedMap.get(i.chemical_id)?.n || 0)
    summary.items_total += 1
    if (hasLines) summary.items_counted += 1
    if (resolved) summary.items_resolved += 1
    if (!resolved && currentQty > EPS) summary.unresolved_with_stock += 1
    if (diff !== null && Math.abs(diff) > EPS) { summary.differences += 1; summary.value_total += value }
    if (movedDuring) summary.moved += 1
    const lots = [...(lotsByItem.get(i.chemical_id)?.values() || [])]
      .filter((l) => l.system_qty > EPS || l.current_qty > EPS || l.counted_qty > EPS)
      .map((l) => ({ ...l, diff: round6(l.counted_qty - l.system_qty) }))
    return {
      chemical_id: i.chemical_id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      system_qty: i.system_qty,
      current_qty: currentQty,
      counted_qty: countedQty,
      diff,
      unit_price: i.unit_price || 0,
      currency: i.currency || 'COP',
      value,
      has_lines: hasLines,
      confirmed_zero: confirmedZero,
      recount_requested: Boolean(i.recount_requested_at),
      resolved,
      needs_resolution: !resolved && currentQty > EPS,
      moved_during_count: movedDuring,
      lots,
      lines: linesByItem.get(i.chemical_id) || [],
    }
  })
  outItems.sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0) || a.name.localeCompare(b.name, 'es'))

  const findings = allLines.filter((l) => l.finding_status)
  summary.findings_pending = findings.filter((l) => l.finding_status === 'pendiente').length
  summary.value_total = Math.round(summary.value_total)
  return { count: publicCount(count), summary, items: outItems, findings }
}

export async function reviewCount(request, env, rawId) {
  await requireUser(request, env, 'count.approve')
  const count = await loadCount(env, parseId(rawId))
  return json(await buildReview(env, count))
}

export async function confirmZero(request, env, rawId, rawChemicalId) {
  const { user } = await requireUser(request, env, 'count.approve')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, ['abierto', 'revision'], 'confirmar en cero')
  const chemicalId = parseId(rawChemicalId, 'Producto')
  const body = await readJson(request)
  const confirm = body.confirm !== false
  const result = await env.DB.prepare(
    `UPDATE inventory_count_items SET confirmed_zero_at = ${confirm ? "datetime('now')" : 'NULL'},
       confirmed_zero_by = ? WHERE count_id = ? AND chemical_id = ?`,
  ).bind(confirm ? user.id : null, count.id, chemicalId).run()
  if (!result.meta.changes) throw new HttpError(404, 'Producto no encontrado en el conteo')
  return json({ ok: true })
}

export async function confirmZeroAll(request, env, rawId) {
  const { user } = await requireUser(request, env, 'count.approve')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, ['revision'], 'confirmar en cero lo no contado')
  const result = await env.DB.prepare(
    `UPDATE inventory_count_items SET confirmed_zero_at = datetime('now'), confirmed_zero_by = ?
     WHERE count_id = ? AND confirmed_zero_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM inventory_count_lines l
                       WHERE l.count_id = inventory_count_items.count_id
                         AND l.chemical_id = inventory_count_items.chemical_id AND ${activeLine('l')})`,
  ).bind(user.id, count.id).run()
  await audit(env, request, user, 'count_zero_all', `#${count.id}: ${result.meta.changes} productos en cero`)
  return json({ ok: true, changed: result.meta.changes })
}

export async function requestRecount(request, env, rawId, rawChemicalId) {
  const { user } = await requireUser(request, env, 'count.approve')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, ['abierto'], 'pedir reconteo (reabre el conteo primero)')
  const chemicalId = parseId(rawChemicalId, 'Producto')
  const item = await env.DB.prepare('SELECT code, name FROM inventory_count_items WHERE count_id = ? AND chemical_id = ?')
    .bind(count.id, chemicalId).first()
  if (!item) throw new HttpError(404, 'Producto no encontrado en el conteo')
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE inventory_count_lines SET superseded_at = datetime('now')
       WHERE count_id = ? AND chemical_id = ? AND deleted_at IS NULL AND superseded_at IS NULL`,
    ).bind(count.id, chemicalId),
    env.DB.prepare(
      `UPDATE inventory_count_items SET recount_requested_at = datetime('now'), confirmed_zero_at = NULL
       WHERE count_id = ? AND chemical_id = ?`,
    ).bind(count.id, chemicalId),
  ])
  await audit(env, request, user, 'count_recount', `#${count.id} ${item.code} ${item.name}`)
  return json({ ok: true })
}

export async function resolveFinding(request, env, rawId, rawLineId) {
  const { user } = await requireUser(request, env, 'count.approve')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, ['abierto', 'revision'], 'resolver hallazgos')
  const balance = balanceFor(count)
  const line = await env.DB.prepare(
    `SELECT * FROM inventory_count_lines WHERE id = ? AND count_id = ? AND finding_status IS NOT NULL
       AND deleted_at IS NULL AND superseded_at IS NULL`,
  ).bind(parseId(rawLineId, 'Hallazgo'), count.id).first()
  if (!line) throw new HttpError(404, 'Hallazgo no encontrado')
  const body = await readJson(request)

  if (body.action === 'discard') {
    await env.DB.prepare(
      "UPDATE inventory_count_lines SET finding_status = 'descartado', chemical_id = NULL, lot_id = NULL, updated_at = datetime('now') WHERE id = ?",
    ).bind(line.id).run()
    await audit(env, request, user, 'count_finding_discarded', `#${count.id} ${line.finding_name}`)
    return json({ ok: true })
  }
  if (body.action !== 'assign') throw new HttpError(400, 'Acción no válida')

  const chemicalId = parseId(body.chemical_id, 'Producto')
  const chem = await env.DB.prepare(
    "SELECT id, code, name, unit, density_g_ml FROM chemicals WHERE id = ? AND deleted_at IS NULL AND code NOT LIKE 'TMP%'",
  ).bind(chemicalId).first()
  if (!chem) throw new HttpError(404, 'Producto no encontrado')
  const pkg = packageFromLine(line)
  if (!pkg && !UNITS[line.unit_entered]) {
    throw new HttpError(400, `El hallazgo está en "${line.unit_entered}". Pide registrarlo de nuevo en ${chem.unit}.`)
  }
  const qty = round6(pkg
    ? packageTotal(pkg, chem.unit, chem.density_g_ml)
    : convert(line.qty_entered, line.unit_entered, chem.unit, chem.density_g_ml))
  const lotNumber = normalizeLot(line.lot_number)
  const lot = await env.DB.prepare(
    'SELECT id FROM chemical_lots WHERE chemical_id = ? AND UPPER(lot_number) = ? ORDER BY id LIMIT 1',
  ).bind(chemicalId, lotNumber).first()

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO inventory_count_items (count_id, chemical_id, code, name, unit, system_qty, unit_price, currency)
       SELECT ?, id, code, name, unit, ROUND(COALESCE(${balance.chem}, 0), 6), COALESCE(last_unit_price, 0), COALESCE(last_unit_currency, 'COP')
       FROM chemicals WHERE id = ?`,
    ).bind(count.id, chemicalId),
    env.DB.prepare(
      `UPDATE inventory_count_lines SET chemical_id = ?, finding_status = 'asignado', lot_id = ?, lot_number = ?,
         qty = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(chemicalId, lot ? lot.id : null, lotNumber, qty, line.id),
  ])
  await audit(env, request, user, 'count_finding_assigned', `#${count.id} ${line.finding_name} → ${chem.code}`)
  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// Aplicar al inventario
// ---------------------------------------------------------------------------

export async function applyCount(request, env, rawId) {
  const { user } = await requireUser(request, env, 'count.approve')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, ['revision'], 'aplicar')
  const balance = balanceFor(count)

  const [pendingFindings, unresolved, appAdmin] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM inventory_count_lines WHERE count_id = ? AND finding_status = 'pendiente'
         AND deleted_at IS NULL AND superseded_at IS NULL`,
    ).bind(count.id),
    env.DB.prepare(
      `SELECT i.code, i.name FROM inventory_count_items i JOIN chemicals c ON c.id = i.chemical_id
       WHERE i.count_id = ? AND i.confirmed_zero_at IS NULL AND COALESCE(c.${balance.chem}, 0) > ${EPS}
         AND NOT EXISTS (SELECT 1 FROM inventory_count_lines l WHERE l.count_id = i.count_id
                         AND l.chemical_id = i.chemical_id AND ${activeLine('l')})
       LIMIT 10`,
    ).bind(count.id),
    env.DB.prepare(
      `SELECT MIN(u.id) AS id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.is_active = 1`,
    ),
  ])
  if (Number(pendingFindings.results?.[0]?.n || 0) > 0) {
    throw new HttpError(409, 'Hay hallazgos sin resolver. Asígnalos a un producto o descártalos.')
  }
  const missing = unresolved.results || []
  if (missing.length) {
    const names = missing.map((m) => `${m.code} ${m.name}`).join(', ')
    throw new HttpError(409, `Hay productos con existencias que nadie contó: ${names}. Cuéntalos o confírmalos en cero.`)
  }
  const appUserId = appAdmin.results?.[0]?.id
  if (!appUserId) throw new HttpError(500, 'No hay un usuario administrador activo en la app de escritorio')

  const affected = `SELECT i.chemical_id FROM inventory_count_items i WHERE i.count_id = ?
    AND (i.confirmed_zero_at IS NOT NULL OR EXISTS (SELECT 1 FROM inventory_count_lines l
         WHERE l.count_id = i.count_id AND l.chemical_id = i.chemical_id AND ${activeLine('l')}))`
  const countedForLot = (lotRef) => `COALESCE((SELECT SUM(l.qty) FROM inventory_count_lines l
    WHERE l.count_id = ? AND l.lot_id = ${lotRef} AND ${activeLine('l')}), 0)`
  const newLotNote = `Lote creado por conteo físico #${count.id}`
  const moveNote = `Conteo físico #${count.id} · ${count.warehouse_name} · aprobado por ${user.username} (portal)`
  const id = count.id

  const results = await env.DB.batch([
    // 1. Lotes que se encontraron y no existían.
    env.DB.prepare(
      `INSERT INTO chemical_lots (chemical_id, lot_number, quantity_received, quantity_remaining, lab_quantity, unit, notes, status)
       SELECT l.chemical_id, MAX(l.lot_number), 0, 0, 0, MAX(c.unit), ?, 'active'
       FROM inventory_count_lines l JOIN chemicals c ON c.id = l.chemical_id
       WHERE l.count_id = ? AND ${activeLine('l')} AND l.lot_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM chemical_lots x WHERE x.chemical_id = l.chemical_id
                         AND UPPER(x.lot_number) = UPPER(l.lot_number))
         AND ${GUARD_REVIEW}
       GROUP BY l.chemical_id, UPPER(l.lot_number)`,
    ).bind(newLotNote, id, id),
    // 2. Enlazar cada registro con su lote.
    env.DB.prepare(
      `UPDATE inventory_count_lines SET lot_id = (
         SELECT x.id FROM chemical_lots x WHERE x.chemical_id = inventory_count_lines.chemical_id
           AND UPPER(x.lot_number) = UPPER(inventory_count_lines.lot_number) ORDER BY x.id LIMIT 1)
       WHERE count_id = ? AND lot_id IS NULL AND ${activeLine()} AND ${GUARD_REVIEW}`,
    ).bind(id, id),
    // 3. Movimiento de ajuste por cada lote que cambia (contado - saldo actual).
    env.DB.prepare(
      `INSERT INTO stock_movements (chemical_id, lot_id, movement_type, quantity, unit, reference_type, reference_id, notes, user_id)
       SELECT x.chemical_id, x.id, 'adjustment', d.delta, c.unit, ?, ?, ?, ?
       FROM (SELECT x.id AS lot_id,
                    ROUND(${countedForLot('x.id')} - COALESCE(x.${balance.lot}, 0), 6) AS delta
             FROM chemical_lots x WHERE x.chemical_id IN (${affected})) d
       JOIN chemical_lots x ON x.id = d.lot_id
       JOIN chemicals c ON c.id = x.chemical_id
       WHERE ABS(d.delta) > ${EPS} AND ${GUARD_REVIEW}`,
    ).bind(balance.ref, id, moveNote, appUserId, id, id, id),
    // 4. Saldo de cada lote = lo contado (0 si no se encontró).
    env.DB.prepare(
      `UPDATE chemical_lots SET ${balance.lot} = ROUND(${countedForLot('chemical_lots.id')}, 6), updated_at = datetime('now')
       WHERE chemical_id IN (${affected}) AND ${GUARD_REVIEW}`,
    ).bind(id, id, id),
    // 5. Estado de los lotes y cantidad recibida de los lotes nuevos.
    env.DB.prepare(
      `UPDATE chemical_lots SET
         status = CASE WHEN COALESCE(quantity_remaining, 0) > ${EPS} OR COALESCE(lab_quantity, 0) > ${EPS}
                       THEN 'active' ELSE 'depleted' END,
         quantity_received = CASE WHEN notes = ? THEN COALESCE(quantity_remaining, 0) + COALESCE(lab_quantity, 0)
                                  ELSE quantity_received END
       WHERE chemical_id IN (${affected}) AND status != 'expired' AND ${GUARD_REVIEW}`,
    ).bind(newLotNote, id, id),
    // 6. Total del producto en la bodega = suma de sus lotes (igual que en la app).
    env.DB.prepare(
      `UPDATE chemicals SET ${balance.chem} = ROUND(COALESCE((SELECT SUM(x.${balance.lot}) FROM chemical_lots x
         WHERE x.chemical_id = chemicals.id), 0), 6), updated_at = datetime('now')
       WHERE id IN (${affected}) AND ${GUARD_REVIEW}`,
    ).bind(id, id),
    // 7. Cerrar el conteo. Va al final: si otro administrador ya lo aplicó, nada de lo anterior hace efecto.
    env.DB.prepare(
      `UPDATE inventory_counts SET status = 'aplicado', applied_at = datetime('now'), applied_by = ?,
         updated_at = datetime('now') WHERE id = ? AND status = 'revision'`,
    ).bind(user.id, id),
  ])

  if (!results[6].meta.changes) throw new HttpError(409, 'Este conteo ya fue aplicado o cambió de estado.')
  const movements = results[2].meta.changes || 0
  await audit(env, request, user, 'count_applied', `#${id} ${count.warehouse_name}: ${movements} ajustes`)
  return json({ ok: true, movements, new_lots: results[0].meta.changes || 0 })
}

export async function markSiesaAdjusted(request, env, rawId) {
  const { user } = await requireUser(request, env, 'count.approve')
  const count = await loadCount(env, parseId(rawId))
  assertStatus(count, ['aplicado'], 'marcar el ajuste en SIESA')
  if (count.siesa_adjusted_at) throw new HttpError(409, 'Ya estaba marcado como ajustado en SIESA')
  await env.DB.prepare(
    `UPDATE inventory_counts SET siesa_adjusted_at = datetime('now'), siesa_adjusted_by = ?, updated_at = datetime('now')
     WHERE id = ? AND siesa_adjusted_at IS NULL`,
  ).bind(user.id, count.id).run()
  await audit(env, request, user, 'count_siesa_adjusted', `#${count.id} ${count.warehouse_name}`)
  return json({ count: publicCount(await loadCount(env, count.id)) })
}

// ---------------------------------------------------------------------------
// Exportar diferencias para el ajuste manual en SIESA
// ---------------------------------------------------------------------------

function csvNumber(n, decimals = 3) {
  if (n === null || n === undefined) return ''
  return Number(n).toFixed(decimals).replace('.', ',')
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function exportCount(request, env, rawId) {
  await requireUser(request, env, 'count.approve')
  const count = await loadCount(env, parseId(rawId))
  const review = await buildReview(env, count)
  const header = ['Bodega', 'Código', 'Producto', 'Lote', 'Unidad', 'Sistema al abrir', 'Contado', 'Diferencia', 'Precio unitario', 'Valor diferencia']
  const rows = [header]
  for (const item of review.items) {
    if (!item.resolved) continue
    const lots = item.lots.length ? item.lots : [{ lot_number: 'S/N', system_qty: item.system_qty, counted_qty: item.counted_qty, diff: item.diff }]
    for (const lot of lots) {
      if (Math.abs(lot.diff) <= EPS) continue
      rows.push([
        count.warehouse_code, item.code, item.name, lot.lot_number, item.unit,
        csvNumber(lot.system_qty), csvNumber(lot.counted_qty), csvNumber(lot.diff),
        csvNumber(item.unit_price, 2), csvNumber(lot.diff * item.unit_price, 0),
      ])
    }
  }
  const body = `﻿${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`
  const name = `conteo-${count.id}-${String(count.warehouse_name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}
