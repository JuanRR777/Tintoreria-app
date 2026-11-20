#!/usr/bin/env node
/**
 * Prueba del conteo físico contra `wrangler dev` con la base local y los datos
 * de scripts/seed-local-inventory.sql (químicos PRB-001 a PRB-004).
 *
 *   npx wrangler d1 execute tintoreria --local --file scripts/seed-local-inventory.sql
 *   SMOKE_ADMIN_USER=... SMOKE_ADMIN_PASSWORD=... node scripts/count-test.mjs
 *
 * Modifica inventario: solo corre contra el servidor local.
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8788').replace(/\/$/, '')
const host = new URL(BASE).hostname
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error('Esta prueba modifica inventario. Solo corre contra el servidor local.')
  process.exit(2)
}
const ADMIN_USER = process.env.SMOKE_ADMIN_USER
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD
if (!ADMIN_USER || !ADMIN_PASSWORD) { console.error('Define SMOKE_ADMIN_USER y SMOKE_ADMIN_PASSWORD'); process.exit(2) }

let passed = 0
let failed = 0
function check(label, ok, extra = '') {
  if (ok) { passed += 1; console.log(`  OK    ${label}`) }
  else { failed += 1; console.log(`  FALLA ${label}${extra ? ` → ${extra}` : ''}`) }
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6

class Client {
  constructor() { this.cookie = '' }
  async req(method, path, body) {
    const headers = { Accept: 'application/json', Origin: BASE }
    if (this.cookie) headers.Cookie = this.cookie
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0]
    const text = await res.text()
    let data = {}
    try { data = JSON.parse(text) } catch { data = { text } }
    return { status: res.status, data, headers: res.headers }
  }
}

const stamp = Date.now().toString(36)
const uuid = () => crypto.randomUUID()
const pw = () => `Ct#${Math.random().toString(36).slice(2, 10)}9Z`

async function newCounter(admin, name) {
  const username = `${name}.${stamp}`
  const temp = pw()
  await admin.req('POST', '/api/users', { username, full_name: `Prueba ${name}`, role: 'almacen', password: temp })
  const c = new Client()
  await c.req('POST', '/api/auth/login', { username, password: temp })
  const next = pw()
  await c.req('POST', '/api/auth/password', { current_password: temp, new_password: next })
  return c
}

console.log(`\nConteo físico · ${BASE}\n`)
const admin = new Client()
let r = await admin.req('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD })
check('admin ingresa', r.status === 200, JSON.stringify(r.data))

r = await admin.req('GET', '/api/warehouses')
const principal = r.data.items.find((w) => w.kind === 'principal')
const lab = r.data.items.find((w) => w.kind === 'laboratorio')

// --- Abrir ---
r = await admin.req('POST', '/api/counts', { warehouse_id: principal.id, notes: 'Prueba automática' })
check('admin abre conteo de Principal', r.status === 201, JSON.stringify(r.data))
const countId = r.data.count?.id
r = await admin.req('POST', '/api/counts', { warehouse_id: principal.id })
check('no se puede abrir otro conteo en la misma bodega', r.status === 409)

const ana = await newCounter(admin, 'ana')
const beto = await newCounter(admin, 'beto')

r = await ana.req('GET', '/api/counts')
check('almacén ve el conteo abierto', r.status === 200 && r.data.items.some((c) => c.id === countId))
r = await ana.req('GET', `/api/counts/${countId}`)
const items = r.data.items || []
const byCode = (code) => items.find((i) => i.code === code)
check('almacén recibe el catálogo del conteo', r.status === 200 && byCode('PRB-001') && byCode('PRB-004'))
check('conteo a ciegas: no recibe saldos del sistema', !JSON.stringify(r.data).includes('system_qty') && !JSON.stringify(r.data).includes('quantity_remaining'))
const lots = r.data.lots || []
const lotA1 = lots.find((l) => l.lot_number === '2609C1001')

r = await ana.req('POST', '/api/counts', { warehouse_id: lab.id })
check('almacén no puede abrir conteos', r.status === 403)
r = await ana.req('GET', `/api/counts/${countId}/review`)
check('almacén no ve la revisión', r.status === 403)

// --- Registrar ---
const u1 = uuid()
r = await ana.req('POST', `/api/counts/${countId}/lines`, { client_uuid: u1, chemical_id: byCode('PRB-001').chemical_id, lot_id: lotA1.lot_id, qty_entered: '10', unit_entered: 'kg', location: 'Estante 1' })
check('registra PRB-001 lote existente 10 kg', r.status === 201 && near(r.data.line?.qty, 10), JSON.stringify(r.data))
const lineA = r.data.line
r = await ana.req('POST', `/api/counts/${countId}/lines`, { client_uuid: u1, chemical_id: byCode('PRB-001').chemical_id, lot_id: lotA1.lot_id, qty_entered: '10', unit_entered: 'kg' })
check('reenviar el mismo registro no lo duplica', r.status === 200 && r.data.duplicate === true)

r = await ana.req('POST', `/api/counts/${countId}/lines`, { client_uuid: uuid(), chemical_id: byCode('PRB-002').chemical_id, lot_number: 'nuevo-1', qty_entered: '2500', unit_entered: 'g' })
check('2500 g se guardan como 2,5 kg en lote nuevo', r.status === 201 && near(r.data.line?.qty, 2.5) && r.data.line?.lot_number === 'NUEVO-1' && r.data.line?.lot_id === null, JSON.stringify(r.data))

r = await ana.req('POST', `/api/counts/${countId}/lines`, { client_uuid: uuid(), chemical_id: byCode('PRB-002').chemical_id, lot_number: 'x', qty_entered: '-3', unit_entered: 'kg' })
check('cantidad negativa → 400', r.status === 400)
r = await ana.req('POST', `/api/counts/${countId}/lines`, { client_uuid: uuid(), chemical_id: byCode('PRB-002').chemical_id, qty_entered: '1', unit_entered: 'L' })
check('kg contra L → 400', r.status === 400)

r = await beto.req('POST', `/api/counts/${countId}/lines`, { client_uuid: uuid(), finding_name: 'acido raro', lot_number: '', qty_entered: '3,0', unit_entered: 'kg', notes: 'Sin etiqueta' })
check('registra hallazgo con coma decimal', r.status === 201 && r.data.line?.finding_status === 'pendiente' && near(r.data.line?.qty, 3))
const finding = r.data.line

r = await beto.req('PUT', `/api/counts/${countId}/lines/${lineA.id}`, { qty_entered: '1' })
check('otra persona no puede editar un registro ajeno', r.status === 403)
r = await ana.req('PUT', `/api/counts/${countId}/lines/${lineA.id}`, { qty_entered: '10.000', unit_entered: 'kg' })
check('quien registró puede editarlo', r.status === 200 && near(r.data.line?.qty, 10))

// --- Revisión ---
r = await admin.req('GET', `/api/counts/${countId}/review`)
const rv = (code) => r.data.items.find((i) => i.code === code)
check('revisión: PRB-003 con existencias aparece sin contar', r.status === 200 && rv('PRB-003')?.needs_resolution === true)
check('revisión: diferencia PRB-001 = 10 - 12 = -2', near(rv('PRB-001')?.diff, -2))
check('revisión: 1 hallazgo pendiente', r.data.summary?.findings_pending === 1)

r = await admin.req('POST', `/api/counts/${countId}/apply`, {})
check('no se aplica mientras está abierto', r.status === 409)
r = await admin.req('POST', `/api/counts/${countId}/close`, {})
check('admin cierra el conteo (a revisión)', r.status === 200 && r.data.count?.status === 'revision')
r = await ana.req('POST', `/api/counts/${countId}/lines`, { client_uuid: uuid(), chemical_id: byCode('PRB-001').chemical_id, qty_entered: '1', unit_entered: 'kg' })
check('en revisión ya no se registra', r.status === 409)

r = await admin.req('POST', `/api/counts/${countId}/apply`, {})
check('no se aplica con hallazgos pendientes', r.status === 409 && /hallazgos/.test(r.data.error || ''))
r = await admin.req('POST', `/api/counts/${countId}/findings/${finding.id}`, { action: 'assign', chemical_id: byCode('PRB-003').chemical_id })
check('admin asigna el hallazgo a PRB-003', r.status === 200, JSON.stringify(r.data))

// --- Aplicar ---
r = await admin.req('POST', `/api/counts/${countId}/apply`, {})
check('admin aplica el conteo', r.status === 200 && r.data.movements === 6 && r.data.new_lots === 2, JSON.stringify(r.data))
r = await admin.req('POST', `/api/counts/${countId}/apply`, {})
check('aplicar dos veces no hace nada', r.status === 409)

r = await admin.req('GET', `/api/counts/${countId}/review`)
const after = (code) => r.data.items.find((i) => i.code === code)
const lotQty = (code, lot) => after(code)?.lots.find((l) => l.lot_number === lot)?.current_qty
check('PRB-001 queda en 10 kg (lote 1001 = 10, 1002 = 0)', near(after('PRB-001')?.current_qty, 10) && near(lotQty('PRB-001', '2609C1001'), 10) && near(lotQty('PRB-001', '2609C1002') ?? 0, 0))
check('PRB-002 queda en 2,5 kg en el lote nuevo', near(after('PRB-002')?.current_qty, 2.5) && near(lotQty('PRB-002', 'NUEVO-1'), 2.5))
check('PRB-003 queda en 3 kg (hallazgo en lote S/N)', near(after('PRB-003')?.current_qty, 3) && near(lotQty('PRB-003', 'S/N'), 3))
check('PRB-004 sin existencias no cambia', near(after('PRB-004')?.current_qty, 0))

const csv = await admin.req('GET', `/api/counts/${countId}/export.csv`)
const csvText = csv.data.text || ''
check('exporta CSV para SIESA', csv.status === 200 && /attachment/.test(csv.headers.get('content-disposition') || '') && csvText.includes('PRB-001') && csvText.includes('2609C1002') && csvText.includes('-4,000'))

r = await admin.req('POST', `/api/counts/${countId}/siesa`, {})
check('marca ajustado en SIESA', r.status === 200 && Boolean(r.data.count?.siesa_adjusted_at))

// --- Laboratorio no toca Principal ---
r = await admin.req('POST', '/api/counts', { warehouse_id: lab.id })
const labId = r.data.count?.id
check('abre conteo de Laboratorio', r.status === 201)
r = await ana.req('GET', `/api/counts/${labId}`)
const labItem = r.data.items.find((i) => i.code === 'PRB-001')
r = await ana.req('POST', `/api/counts/${labId}/lines`, { client_uuid: uuid(), chemical_id: labItem.chemical_id, lot_number: '2609C1001', qty_entered: '500', unit_entered: 'g' })
check('registra 500 g en laboratorio', r.status === 201 && near(r.data.line?.qty, 0.5))
await admin.req('POST', `/api/counts/${labId}/close`, {})
r = await admin.req('POST', `/api/counts/${labId}/apply`, {})
check('aplica conteo de laboratorio', r.status === 200, JSON.stringify(r.data))
r = await admin.req('GET', `/api/counts/${labId}/review`)
check('laboratorio de PRB-001 queda en 0,5 kg', near(r.data.items.find((i) => i.code === 'PRB-001')?.current_qty, 0.5))
r = await admin.req('GET', `/api/counts/${countId}/review`)
check('Principal de PRB-001 sigue en 10 kg', near(r.data.items.find((i) => i.code === 'PRB-001')?.current_qty, 10))

// --- Envases, galones y densidad (en un conteo que luego se anula) ---
r = await admin.req('POST', '/api/counts', { warehouse_id: principal.id })
const thirdId = r.data.count?.id
const chemA = byCode('PRB-001').chemical_id
const chemB = byCode('PRB-002').chemical_id
const chemC = byCode('PRB-003').chemical_id

r = await ana.req('POST', `/api/counts/${thirdId}/lines`, { client_uuid: uuid(), chemical_id: chemB, lot_number: 'S/N', package_type: 'bulto', package_count: '3', package_content: '25', package_unit: 'kg', loose_qty: '12,5', loose_unit: 'kg' })
check('3 bultos × 25 kg + 12,5 kg suelto = 87,5 kg', r.status === 201 && near(r.data.line?.qty, 87.5) && r.data.line?.package_type === 'bulto', JSON.stringify(r.data))
const bultoLine = r.data.line

r = await ana.req('POST', `/api/counts/${thirdId}/lines`, { client_uuid: uuid(), chemical_id: chemB, package_type: 'caneca', package_count: '2', package_content: '20', package_unit: 'L' })
check('litros sin densidad → 400 con explicación', r.status === 400 && /densidad/.test(r.data.error || ''))

r = await ana.req('POST', `/api/counts/${thirdId}/lines`, { client_uuid: uuid(), chemical_id: chemA, lot_number: '2609C1001', package_type: 'caneca', package_count: '2', package_content: '20', package_unit: 'L' })
check('2 canecas × 20 L con densidad 1,05 = 42 kg', r.status === 201 && near(r.data.line?.qty, 42), JSON.stringify(r.data))

r = await ana.req('POST', `/api/counts/${thirdId}/lines`, { client_uuid: uuid(), chemical_id: chemA, lot_number: '2609C1001', qty_entered: '1', unit_entered: 'gal' })
check('1 galón con densidad 1,05 = 3,974682 kg', r.status === 201 && near(r.data.line?.qty, 3.974682), JSON.stringify(r.data))

r = await ana.req('POST', `/api/counts/${thirdId}/lines`, { client_uuid: uuid(), chemical_id: chemC, package_type: 'tarro', package_count: '4', package_content: '500', package_unit: 'g' })
check('envase propio "tarro": 4 × 500 g = 2 kg', r.status === 201 && near(r.data.line?.qty, 2))

r = await ana.req('POST', `/api/counts/${thirdId}/lines`, { client_uuid: uuid(), chemical_id: chemC, package_type: 'x1', package_count: '1', package_content: '1', package_unit: 'kg' })
check('tipo de envase inválido → 400', r.status === 400)

r = await ana.req('PUT', `/api/counts/${thirdId}/lines/${bultoLine.id}`, { package_type: 'bulto', package_count: '4', package_content: '25', package_unit: 'kg', loose_qty: '12,5', loose_unit: 'kg' })
check('editar a 4 bultos recalcula 112,5 kg', r.status === 200 && near(r.data.line?.qty, 112.5))
r = await ana.req('PUT', `/api/counts/${thirdId}/lines/${bultoLine.id}`, { lot_number: 'S/N', location: 'Patio' })
check('editar solo la ubicación conserva los envases', r.status === 200 && near(r.data.line?.qty, 112.5) && r.data.line?.package_type === 'bulto')
r = await ana.req('PUT', `/api/counts/${thirdId}/lines/${bultoLine.id}`, { qty_entered: '10', unit_entered: 'kg' })
check('pasar a peso borra los datos de envase', r.status === 200 && near(r.data.line?.qty, 10) && r.data.line?.package_type === null)

r = await ana.req('GET', `/api/counts/${thirdId}`)
const lastA = r.data.items.find((i) => i.chemical_id === chemA)
check('el portal recuerda el último envase del producto', lastA?.last_package?.type === 'caneca' && near(lastA?.last_package?.content, 20))
check('el catálogo envía la densidad del producto', near(lastA?.density, 1.05))

r = await beto.req('POST', `/api/counts/${thirdId}/lines`, { client_uuid: uuid(), finding_name: 'suavizante sin etiqueta', package_type: 'caneca', package_count: '2', package_content: '20', package_unit: 'kg' })
check('hallazgo por envases: 2 canecas × 20 kg', r.status === 201 && near(r.data.line?.qty, 40))
r = await admin.req('POST', `/api/counts/${thirdId}/findings/${r.data.line.id}`, { action: 'assign', chemical_id: byCode('PRB-004').chemical_id })
r = await admin.req('GET', `/api/counts/${thirdId}/review`)
check('al asignarlo a PRB-004 cuenta 40 kg', near(r.data.items.find((i) => i.code === 'PRB-004')?.counted_qty, 40))

// --- Reconteo y anulación ---
r = await admin.req('POST', `/api/counts/${thirdId}/items/${chemA}/recount`, {})
check('admin pide reconteo', r.status === 200)
r = await ana.req('GET', `/api/counts/${thirdId}`)
check('almacén ve el producto marcado para reconteo', r.data.items.find((i) => i.chemical_id === chemA)?.recount === true)
r = await admin.req('GET', `/api/counts/${thirdId}/review`)
check('el registro anterior ya no cuenta', r.data.items.find((i) => i.code === 'PRB-001')?.has_lines === false)
r = await admin.req('POST', `/api/counts/${thirdId}/cancel`, {})
check('admin anula el conteo', r.status === 200 && r.data.count?.status === 'anulado')
r = await admin.req('GET', `/api/counts/${countId}/review`)
check('anular no cambió el inventario', near(r.data.items.find((i) => i.code === 'PRB-001')?.current_qty, 10))

console.log(`\n${passed} OK · ${failed} fallas\n`)
process.exit(failed ? 1 : 0)
