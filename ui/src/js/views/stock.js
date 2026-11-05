import { chemicals as chemicalsApi, requests as requestsApi, stock } from '../api.js'
import { setPageHeader } from '../layout.js'
import { toast } from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'
import { importInventoryCsv, openChemicalForm } from './chemicals.js'
import { convertQty, entryUnits, expressLab, labUnit } from '../units.js'

const TYPE_LABELS = {
  acido: 'Ácido', reactivo: 'Reactivo', directo: 'Directo', auxiliar: 'Auxiliar',
  mordiente: 'Mordiente', disperso: 'Disperso', vat: 'Vat',
  blanqueador: 'Blanqueador', otros: 'Otros',
}

const TYPE_ORDER = [
  'auxiliar', 'blanqueador', 'reactivo', 'acido', 'directo',
  'disperso', 'vat', 'mordiente', 'otros',
]

const VIEWS = {
  all: { qtyLabel: 'En bodega', empty: 'Sin químicos con stock en bodega' },
  low: { qtyLabel: 'En bodega', empty: 'Sin alertas de stock bajo' },
  expiring: { qtyLabel: 'Quedan', empty: 'Sin lotes por vencer en los próximos 30 días' },
  waiting: { qtyLabel: 'Solicitado', empty: 'Sin solicitudes en espera' },
  ordered: { qtyLabel: 'Entrado / pedido', empty: 'Sin órdenes de compra abiertas' },
  lab: { qtyLabel: 'En laboratorio', empty: 'Sin químicos en el inventario de laboratorio' },
}

const MOVE_TABS = [
  { id: 'all', label: 'Todos' },
  { id: 'in', label: 'Entradas' },
  { id: 'out', label: 'Salidas' },
  { id: 'adjustment', label: 'Ajustes' },
]

const ROW_H = 44
const GROUP_H = 30
const MOVE_ROW_H = 48
const MOVE_GROUP_H = 46

const ICON_ALERT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.87l-8.106-13.536a1.914 1.914 0 0 0-3.274 0z"/><path d="M12 16h.01"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'

const state = {
  view: 'all',
  type: '',
  query: '',
  page: 1,
  moveTab: 'all',
  movePage: 1,
  summary: null,
  chemicals: [],
  movements: [],
  tablePages: [],
  movePages: [],
  selectedId: null,
}

let resizeTimer = null
let onResize = null

export async function showView(container) {
  setPageHeader({
    title: 'Inventario',
    subtitle: 'Catálogo, stock, lotes y movimientos en un solo lugar',
    actionsHtml: `
      <input type="file" id="file-inv" accept=".csv,text/csv" hidden>
      <button class="btn btn-secondary" id="btn-new-chem">Nuevo químico</button>
      <button class="btn btn-primary" id="btn-import-inv">Cargar inventario</button>`,
  })
  container.innerHTML = `
    <div id="stock-content"><div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div></div>
  `
  const fileInv = document.getElementById('file-inv')
  document.getElementById('btn-import-inv').onclick = () => fileInv.click()
  document.getElementById('btn-new-chem').onclick = () => openChemicalForm(null, () => loadStock())
  fileInv.onchange = async () => {
    await importInventoryCsv(fileInv)
    await loadStock()
  }

  onResize = () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      fitPage()
      paintTable()
      paintMoves()
    }, 120)
  }
  window.addEventListener('resize', onResize)

  await loadStock()
  return () => {
    window.removeEventListener('resize', onResize)
    clearTimeout(resizeTimer)
    closeChemDrawer()
  }
}

async function loadStock({ keepPage = false } = {}) {
  const container = document.getElementById('stock-content')
  if (!container) return
  try {
    const [summary, chems, moves] = await Promise.all([
      stock.summary({ fresh: true }),
      chemicalsApi.list({}, { fresh: true }),
      stock.movements({ limit: 500 }).catch(() => []),
    ])
    summary.pending_purchase = await withOccNumbers(summary.pending_purchase || [])
    state.summary = summary
    state.chemicals = Array.isArray(chems) ? chems : []
    state.movements = Array.isArray(moves) ? moves : []
    if (!keepPage) {
      state.page = 1
      state.movePage = 1
    }
    renderShell(container)
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`
  }
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

function itemKey(value) {
  const raw = String(value || '').trim()
  const stripped = raw.replace(/^0+/, '')
  return stripped || raw
}

function occSortValue(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits ? Number(digits) : Number.POSITIVE_INFINITY
}

function isWaiting(c) {
  return (c.procurement_status || '') === 'espera'
}

function occLineOpen(row) {
  const orderedQty = Number(row.qty_ordered || 0)
  const entered = Number(row.qty_entered || 0)
  const pending = Number(row.qty_pending || 0)
  if (orderedQty > 0) return entered + 1e-4 < orderedQty
  return pending > 1e-4
}

async function withOccNumbers(items) {
  const transit = items.filter((c) => !isWaiting(c))
  if (!transit.length) return items
  const needsOcc = transit.some((c) => !c.occ_number)
  const needsQty = transit.some((c) => c.qty_ordered == null && c.qty_entered == null)
  if (!needsOcc && !needsQty) return items
  try {
    const rows = await requestsApi.occ()
    const list = Array.isArray(rows) ? rows : []
    const latest = new Map()
    const counts = new Map()
    const totals = new Map()
    for (const row of list) {
      const code = itemKey(row.item_code)
      const occ = String(row.occ_number || '').trim()
      if (!code || !occ) continue
      const orderedQty = Number(row.qty_ordered || 0)
      const entered = Number(row.qty_entered || 0)
      const pending = Number(row.qty_pending || 0)
      const open = occLineOpen(row)
      const stamp = `${row.created_at || ''}|${row.id || 0}`
      const prev = latest.get(code)
      if (!prev || (open && !prev.open) || (open === prev.open && stamp > prev.stamp)) {
        latest.set(code, { occ, open, stamp, orderedQty, entered, pending })
      }
      if (open) {
        const set = counts.get(code) || new Set()
        set.add(occ)
        counts.set(code, set)
        const acc = totals.get(code) || { orderedQty: 0, entered: 0, pending: 0 }
        acc.orderedQty += orderedQty
        acc.entered += entered
        acc.pending += pending
        totals.set(code, acc)
      }
    }
    return items.map((c) => {
      if (isWaiting(c)) return c
      const key = itemKey(c.code)
      const hit = latest.get(key)
      const acc = totals.get(key)
      if (!hit && !acc) return c
      return {
        ...c,
        occ_number: c.occ_number || hit?.occ,
        occ_count: counts.get(key)?.size || c.occ_count || 1,
        qty_ordered: acc?.orderedQty ?? hit?.orderedQty ?? c.qty_ordered,
        qty_entered: acc?.entered ?? hit?.entered ?? c.qty_entered,
        qty_pending: acc?.pending ?? hit?.pending ?? c.qty_pending ?? c.pending_qty,
      }
    })
  } catch {
    return items
  }
}

function chemTypeOf(c) {
  return c.chemical_type || 'otros'
}

function typeRank(type) {
  const i = TYPE_ORDER.indexOf(type || 'otros')
  return i < 0 ? TYPE_ORDER.length : i
}

function byTypeThenName(a, b) {
  const rank = typeRank(a.type) - typeRank(b.type)
  if (rank) return rank
  return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' })
}

function chemStatus(c) {
  const stock = Number(c.stock_quantity || 0)
  const min = Number(c.min_stock_alert || 0)
  const pending = Number(c.pending_qty || 0)
  const unit = c.unit || 'kg'
  if (stock <= min && (min > 0 || stock <= 0)) return { tone: 'danger', label: 'Stock bajo' }
  if (pending > 0) return { tone: 'warning', label: `Parcial · faltan ${fmtQty(pending)} ${unit}` }
  return { tone: 'success', label: 'Disponible' }
}

function inStock(c) {
  const status = c.procurement_status || 'disponible'
  return status === 'disponible' || Number(c.stock_quantity || 0) > 0
}

function chemExtras(id) {
  const c = state.chemicals.find((x) => Number(x.id) === Number(id))
  return {
    id,
    lots: c ? Number(c.active_lot_count || 0) : null,
    supplier: c?.supplier || '',
    lotNo: c?.current_lot_number || '',
    min: c ? Number(c.min_stock_alert || 0) : 0,
  }
}

function rowsForView() {
  const s = state.summary || {}
  const pending = s.pending_purchase || []
  if (state.view === 'low') {
    return (s.low_stock_chemicals || []).map((c) => ({
      ...chemExtras(c.id),
      code: c.code, name: c.name, type: chemTypeOf(c),
      qty: c.stock_quantity, unit: c.unit,
      status: Number(c.min_stock_alert) > 0
        ? { tone: 'danger', label: 'Stock bajo' }
        : { tone: 'danger', label: 'Sin stock' },
    }))
  }
  if (state.view === 'expiring') {
    return (s.expiring_lots_30d || []).map((l) => {
      const days = daysUntil(l.expiry_date)
      const label = days == null ? 'Por vencer'
        : days < 0 ? 'Vencido'
          : days === 0 ? 'Vence hoy'
            : `Vence en ${days} ${days === 1 ? 'día' : 'días'} · ${formatDay(l.expiry_date)}`
      return {
        ...chemExtras(l.chemical_id),
        code: l.chemical_code, name: l.chemical_name, sub: l.lot_number ? `Lote ${l.lot_number}` : '',
        type: '', qty: l.quantity_remaining, unit: l.unit, min: 0,
        status: { tone: days != null && days <= 7 ? 'danger' : 'warning', label },
      }
    })
  }
  if (state.view === 'waiting') {
    return pending.filter(isWaiting).map((c) => ({
      ...chemExtras(c.id),
      code: c.code, name: c.name, type: chemTypeOf(c),
      qty: c.pending_qty, unit: c.unit, min: 0,
      status: { tone: 'warning', label: 'En espera · SOC' },
    }))
  }
  if (state.view === 'lab') {
    return state.chemicals.filter((c) => Number(c.lab_quantity || 0) > 0).map((c) => {
      const shown = expressLab(c.lab_quantity, c.unit)
      return {
        ...chemExtras(c.id),
        code: c.code, name: c.name, type: chemTypeOf(c),
        qty: shown.qty, unit: shown.unit, min: 0,
        status: { tone: 'accent', label: 'En laboratorio' },
      }
    })
  }
  if (state.view === 'ordered') {
    return pending.filter((c) => !isWaiting(c))
      .sort((a, b) => occSortValue(a.occ_number) - occSortValue(b.occ_number))
      .map((c) => {
        const ordered = Number(c.qty_ordered) || 0
        const entered = Number(c.qty_entered) || 0
        const falta = ordered > 0 ? Math.max(0, ordered - entered) : Number(c.qty_pending ?? c.pending_qty) || 0
        const occ = String(c.occ_number || '').trim()
        const extra = Number(c.occ_count) > 1 ? ` +${Number(c.occ_count) - 1}` : ''
        return {
          ...chemExtras(c.id),
          code: c.code, name: c.name, type: chemTypeOf(c),
          qtyText: ordered > 0 ? `${fmtQty(entered)} / ${fmtQty(ordered)}` : fmtQty(falta),
          unit: c.unit, min: 0,
          status: entered > 0
            ? { tone: 'warning', label: `Parcial · faltan ${fmtQty(falta)} ${c.unit || 'kg'}` }
            : { tone: 'accent', label: occ ? `Pedido · ${occ}${extra}` : 'Pedido' },
        }
      })
  }
  return state.chemicals.filter(inStock).map((c) => ({
    ...chemExtras(c.id),
    code: c.code, name: c.name, type: chemTypeOf(c),
    qty: c.stock_quantity, unit: c.unit,
    status: chemStatus(c),
  }))
}

function matchesQuery(r) {
  const q = state.query.trim().toLowerCase()
  if (!q) return true
  return [r.code, r.name, r.sub, r.supplier, r.lotNo].some((v) => String(v || '').toLowerCase().includes(q))
}

function filteredRows() {
  return rowsForView().filter(matchesQuery).sort(byTypeThenName)
}

// ---------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------

function renderShell(container) {
  const s = state.summary || {}
  const inStockCount = state.chemicals.filter((c) => Number(c.stock_quantity || 0) > 0).length
  const labCount = state.chemicals.filter((c) => Number(c.lab_quantity || 0) > 0).length
  const low = s.low_stock_count ?? (s.low_stock_chemicals || []).length
  const expiring = (s.expiring_lots_30d || []).length
  const waiting = (s.pending_purchase || []).filter(isWaiting).length
  const ordered = (s.pending_purchase || []).filter((c) => !isWaiting(c)).length
  const kpis = [
    { id: 'all', label: 'Total químicos', value: s.total_chemicals ?? state.chemicals.length, sub: `${inStockCount} con stock en bodega` },
    { id: 'lab', label: 'Laboratorio', value: labCount, sub: 'Saldo aparte de bodega' },
    { id: 'low', label: 'Stock bajo', value: low, sub: 'Por debajo del mínimo', alert: low > 0 },
    { id: 'expiring', label: 'Lotes por vencer', value: expiring, sub: 'Próximos 30 días' },
    { id: 'waiting', label: 'En espera', value: waiting, sub: 'Solicitudes (SOC)' },
    { id: 'ordered', label: 'Pedidos', value: ordered, sub: 'Órdenes de compra (OCC)' },
  ]

  container.innerHTML = `
    <div class="sk-page" id="sk-page">
      <div class="sk-kpis">
        ${kpis.map((k) => `
          <button type="button" class="sk-kpi ${k.alert ? 'is-alert' : ''} ${state.view === k.id ? 'is-active' : ''}" data-sk-view="${k.id}">
            <span class="sk-kpi-label">${k.alert ? ICON_ALERT : ''}${esc(k.label)}</span>
            <strong>${esc(k.value)}</strong>
            <span class="sk-kpi-sub">${esc(k.sub)}</span>
          </button>`).join('')}
      </div>
      <div class="sk-main">
        <section class="sk-card sk-table">
          <div class="sk-toolbar">
            <label class="sk-search">
              ${ICON_SEARCH}
              <input type="text" id="sk-search" placeholder="Buscar por nombre, código, lote o proveedor" value="${esc(state.query)}">
            </label>
            <div class="sk-seg" id="sk-types"></div>
          </div>
          <div class="sk-thead">
            <span>Código</span>
            <span>Producto ↑</span>
            <span class="is-num">Lotes</span>
            <span class="is-num" id="sk-qty-label">${esc(VIEWS[state.view].qtyLabel)}</span>
            <span>Estado</span>
          </div>
          <div class="sk-tbody" id="sk-tbody"></div>
          <div class="sk-tfoot">
            <span id="sk-range"></span>
            <nav class="sk-pager" id="sk-pager" aria-label="Paginación"></nav>
          </div>
        </section>
        <aside class="sk-card sk-moves">
          <header class="sk-moves-head">
            <h3>Movimientos</h3>
            <p>Entradas, salidas y ajustes de bodega</p>
          </header>
          <div class="sk-seg sk-seg-full" id="sk-move-tabs">
            ${MOVE_TABS.map((t) => `<button type="button" data-sk-move="${t.id}" class="${state.moveTab === t.id ? 'is-active' : ''}">${t.label}</button>`).join('')}
          </div>
          <div class="sk-moves-body" id="sk-moves-body"></div>
          <div class="sk-moves-foot">
            <span id="sk-move-range"></span>
            <nav class="sk-pager" id="sk-move-pager" aria-label="Paginación de movimientos"></nav>
          </div>
        </aside>
      </div>
    </div>`

  container.querySelectorAll('[data-sk-view]').forEach((btn) => {
    btn.onclick = () => {
      state.view = btn.dataset.skView
      state.type = ''
      state.page = 1
      container.querySelectorAll('[data-sk-view]').forEach((b) => b.classList.toggle('is-active', b === btn))
      const label = document.getElementById('sk-qty-label')
      if (label) label.textContent = VIEWS[state.view].qtyLabel
      paintTable()
    }
  })
  let debounce
  document.getElementById('sk-search').oninput = (e) => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      state.query = e.target.value
      state.page = 1
      paintTable()
    }, 200)
  }
  container.querySelectorAll('[data-sk-move]').forEach((btn) => {
    btn.onclick = () => {
      state.moveTab = btn.dataset.skMove
      state.movePage = 1
      container.querySelectorAll('[data-sk-move]').forEach((b) => b.classList.toggle('is-active', b === btn))
      paintMoves()
    }
  })

  fitPage()
  paintTable()
  paintMoves()
}

function fitPage() {
  const page = document.getElementById('sk-page')
  if (!page) return
  const top = page.getBoundingClientRect().top
  page.style.height = `${Math.max(420, window.innerHeight - top - 28)}px`
}

// ---------------------------------------------------------------------------
// Tabla
// ---------------------------------------------------------------------------

function paginate(entries, capacity, groupH, rowH, groupKey) {
  const pages = []
  let current = []
  let used = 0
  let lastGroup = null
  for (const entry of entries) {
    const key = groupKey(entry)
    const needsHeader = key != null && (key !== lastGroup || !current.length)
    const cost = rowH + (needsHeader ? groupH : 0)
    if (current.length && used + cost > capacity) {
      pages.push(current)
      current = []
      used = 0
    }
    const header = key != null && (key !== lastGroup || !current.length)
    current.push({ entry, header })
    used += rowH + (header ? groupH : 0)
    lastGroup = key
  }
  if (current.length) pages.push(current)
  return pages
}

function paintTypes(rows) {
  const host = document.getElementById('sk-types')
  if (!host) return
  const base = rowsForView().filter(matchesQuery)
  const counts = new Map()
  for (const r of base) if (r.type) counts.set(r.type, (counts.get(r.type) || 0) + 1)
  if (state.type && !counts.has(state.type)) state.type = ''
  const types = TYPE_ORDER.filter((t) => counts.has(t))
  host.hidden = !types.length
  host.innerHTML = [
    `<button type="button" data-sk-type="" class="${state.type === '' ? 'is-active' : ''}">Todos <b>${base.length}</b></button>`,
    ...types.map((t) => `<button type="button" data-sk-type="${t}" class="${state.type === t ? 'is-active' : ''}">${esc(TYPE_LABELS[t] || t)} <b>${counts.get(t)}</b></button>`),
  ].join('')
  host.querySelectorAll('[data-sk-type]').forEach((btn) => {
    btn.onclick = () => {
      state.type = btn.dataset.skType
      state.page = 1
      paintTable()
    }
  })
  return rows
}

function paintTable() {
  const body = document.getElementById('sk-tbody')
  if (!body) return
  const all = filteredRows()
  paintTypes(all)
  const rows = state.type ? all.filter((r) => r.type === state.type) : all
  const groupKey = (r) => (r.type ? r.type : null)
  const capacity = Math.max(ROW_H * 3, body.clientHeight)
  const pages = paginate(rows, capacity, GROUP_H, ROW_H, groupKey)
  state.tablePages = pages
  const totalPages = Math.max(1, pages.length)
  if (state.page > totalPages) state.page = totalPages
  if (state.page < 1) state.page = 1

  const range = document.getElementById('sk-range')
  const pager = document.getElementById('sk-pager')
  if (!rows.length) {
    body.innerHTML = `<p class="sk-empty">${esc(VIEWS[state.view].empty)}</p>`
    if (range) range.textContent = '0 químicos'
    if (pager) pager.innerHTML = ''
    return
  }

  const pageIdx = state.page - 1
  const current = pages[pageIdx] || []
  const typeTotal = new Map()
  for (const r of rows) if (r.type) typeTotal.set(r.type, (typeTotal.get(r.type) || 0) + 1)
  const typePages = new Map()
  pages.forEach((p, i) => p.forEach(({ entry }) => {
    if (!entry.type) return
    const set = typePages.get(entry.type) || []
    if (!set.includes(i)) set.push(i)
    typePages.set(entry.type, set)
  }))

  body.innerHTML = current.map(({ entry: r, header }) => {
    let head = ''
    if (header && r.type) {
      const spread = typePages.get(r.type) || []
      const notes = []
      if (spread[0] < pageIdx) notes.push(`continúa de la página ${spread[0] + 1}`)
      notes.push(`${typeTotal.get(r.type)} producto${typeTotal.get(r.type) === 1 ? '' : 's'}`)
      if (spread[spread.length - 1] > pageIdx) notes.push(`sigue en la página ${spread[spread.length - 1] + 1}`)
      head = `<div class="sk-group"><strong>${esc(TYPE_LABELS[r.type] || r.type)}</strong><span>${esc(notes.join(' · '))}</span></div>`
    }
    const qty = r.qtyText ?? fmtQty(r.qty)
    const second = r.sub || r.supplier || 'Sin proveedor'
    return `${head}
      <div class="sk-tr ${r.id && Number(r.id) === Number(state.selectedId) ? 'is-selected' : ''}" ${r.id ? `data-chem-id="${r.id}"` : ''} role="button" tabindex="0">
        <code>${esc(r.code || '—')}</code>
        <span class="sk-name" title="${esc(r.name || '')}">
          <b>${esc(r.name || '—')}</b>
          <small>${esc(second)}</small>
        </span>
        <span class="is-num">${r.lots == null ? '—' : esc(r.lots)}</span>
        <span class="is-num sk-qty">
          <span><b>${esc(qty || '0')}</b> <small>${esc(r.unit || 'kg')}</small></span>
          ${r.min > 0 ? `<small>mín. ${esc(fmtQty(r.min))} ${esc(r.unit || 'kg')}</small>` : ''}
        </span>
        <span><em class="sk-status is-${r.status.tone}">${esc(r.status.label)}</em></span>
      </div>`
  }).join('')
  body.querySelectorAll('[data-chem-id]').forEach((tr) => {
    const open = () => openChemDrawer(Number(tr.dataset.chemId))
    tr.onclick = open
    tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }
  })

  const before = pages.slice(0, pageIdx).reduce((n, p) => n + p.length, 0)
  if (range) range.textContent = `${before + 1}–${before + current.length} de ${rows.length} químicos · página ${state.page} de ${totalPages}`
  if (pager) {
    pager.innerHTML = pagerHtml(state.page, totalPages, 5)
    pager.querySelectorAll('[data-page]').forEach((btn) => {
      btn.onclick = () => {
        state.page = Number(btn.dataset.page)
        paintTable()
      }
    })
  }
}

function pagerHtml(page, total, windowSize) {
  if (total <= 1) return ''
  let start = Math.max(1, page - Math.floor(windowSize / 2))
  const end = Math.min(total, start + windowSize - 1)
  start = Math.max(1, end - windowSize + 1)
  const nums = []
  for (let i = start; i <= end; i++) {
    nums.push(`<button type="button" data-page="${i}" class="${i === page ? 'is-active' : ''}" aria-label="Página ${i}">${i}</button>`)
  }
  return `
    <button type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Anterior">‹</button>
    ${nums.join('')}
    <button type="button" data-page="${page + 1}" ${page >= total ? 'disabled' : ''} aria-label="Siguiente">›</button>`
}

// ---------------------------------------------------------------------------
// Panel del químico
// ---------------------------------------------------------------------------

const MOVE_LABEL = { in: 'Entrada', out: 'Salida', adjustment: 'Ajuste', waste: 'Merma', return: 'Devolución' }

function moveLabel(m) {
  if (m.movement_type === 'out' && m.reference_type === 'laboratorio') return 'Salida a laboratorio'
  return MOVE_LABEL[m.movement_type] || m.movement_type || 'Movimiento'
}
const LOT_STATUS = { active: 'Activo', depleted: 'Agotado', expired: 'Vencido' }

let _chemDrawer = null

function closeChemDrawer() {
  if (!_chemDrawer) return
  document.removeEventListener('keydown', _chemDrawer.onKey)
  _chemDrawer.root.remove()
  _chemDrawer = null
  state.selectedId = null
  document.querySelectorAll('.sk-tr.is-selected').forEach((el) => el.classList.remove('is-selected'))
}

async function openChemDrawer(id, tab = 'lots') {
  closeChemDrawer()
  state.selectedId = id
  document.querySelectorAll('.sk-tr').forEach((el) => el.classList.toggle('is-selected', Number(el.dataset.chemId) === id))
  const root = document.createElement('div')
  root.className = 'rq-root'
  root.innerHTML = `
    <div class="rq-scrim"></div>
    <aside class="rq-drawer cd-drawer" role="dialog" aria-modal="true" aria-labelledby="cd-title">
      <div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div>
    </aside>`
  document.body.appendChild(root)
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('#modal-overlay[style*="flex"]')) closeChemDrawer() }
  document.addEventListener('keydown', onKey)
  _chemDrawer = { root, onKey, id }
  root.querySelector('.rq-scrim').onclick = closeChemDrawer

  let chem, lots, moves, occ
  try {
    ;[chem, lots, moves, occ] = await Promise.all([
      chemicalsApi.get(id),
      chemicalsApi.lots(id).catch(() => []),
      chemicalsApi.movements(id).catch(() => []),
      requestsApi.occ().catch(() => []),
    ])
  } catch (err) {
    if (_chemDrawer?.root !== root) return
    root.querySelector('.rq-drawer').innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`
    return
  }
  if (_chemDrawer?.root !== root) return
  const history = (Array.isArray(occ) ? occ : [])
    .filter((row) => itemKey(row.item_code) === itemKey(chem.code))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  paintChemDrawer(root, chem, lots || [], moves || [], history, tab)
}

function paintChemDrawer(root, chem, lots, moves, history, tab) {
  const unit = chem.unit || 'kg'
  const labShown = expressLab(chem.lab_quantity || 0, unit)
  const stockQty = Number(chem.stock_quantity || 0)
  const min = Number(chem.min_stock_alert || 0)
  const falta = Math.max(0, min - stockQty)
  const status = chemStatus(chem)
  const scale = Math.max(min * 1.5, stockQty, 1)
  const pct = Math.min(100, Math.round((stockQty / scale) * 100))
  const activeLots = lots.filter((l) => l.status === 'active')
  const typeLabel = TYPE_LABELS[chemTypeOf(chem)] || chemTypeOf(chem)
  const tabs = [
    { id: 'lots', label: 'Lotes', count: activeLots.length || lots.length },
    { id: 'moves', label: 'Movimientos', count: moves.length },
    { id: 'sheet', label: 'Ficha técnica' },
    { id: 'history', label: 'Historial', count: history.length },
  ]

  root.querySelector('.rq-drawer').innerHTML = `
    <div class="rq-header">
      <div>
        <p class="cd-chips">
          <code>${esc(chem.code || '—')}</code>
          <span class="rq-cat">${esc(typeLabel)}</span>
          <em class="sk-status is-${status.tone}">${esc(status.label)}</em>
        </p>
        <h3 id="cd-title">${esc(chem.name || '—')}</h3>
        <p>${esc([chem.supplier || 'Sin proveedor', 'Bodega 10502'].join(' · '))}</p>
      </div>
      <button class="rq-close" type="button" aria-label="Cerrar">×</button>
    </div>
    <div class="rq-scroll">
      <section class="cd-stock">
        <div class="cd-stock-top">
          <div class="cd-stock-balances">
            <div>
              <span>En bodega</span>
              <strong>${esc(fmtQty(stockQty))}<small>${esc(unit)}</small></strong>
            </div>
            <div>
              <span>En laboratorio</span>
              <strong>${esc(fmtQty(labShown.qty))}<small>${esc(labShown.unit)}</small></strong>
            </div>
          </div>
          <div class="cd-stock-min">
            ${min > 0 ? `<span>Mínimo <b>${esc(fmtQty(min))} ${esc(unit)}</b></span>` : '<span>Sin mínimo definido</span>'}
            ${falta > 0 ? `<span class="is-danger">Faltan ${esc(fmtQty(falta))} ${esc(unit)}</span>` : ''}
          </div>
        </div>
        <div class="cd-bar is-${status.tone}"><span style="width:${pct}%"></span>${min > 0 ? `<i style="left:${Math.min(100, Math.round((min / scale) * 100))}%"></i>` : ''}</div>
        <button type="button" class="btn btn-primary cd-move-btn" data-cd="move">Registrar movimiento</button>
      </section>
      <nav class="cd-tabs" role="tablist">
        ${tabs.map((t) => `<button type="button" role="tab" data-cd-tab="${t.id}" class="${t.id === tab ? 'is-active' : ''}">${t.label}${t.count != null ? ` <b>${t.count}</b>` : ''}</button>`).join('')}
      </nav>
      <div class="cd-pane" data-cd-pane="lots" ${tab === 'lots' ? '' : 'hidden'}>${lotsPaneHtml(chem, lots)}</div>
      <div class="cd-pane" data-cd-pane="moves" ${tab === 'moves' ? '' : 'hidden'}>${movesPaneHtml(chem, moves)}</div>
      <div class="cd-pane" data-cd-pane="sheet" ${tab === 'sheet' ? '' : 'hidden'}>${sheetPaneHtml(chem)}</div>
      <div class="cd-pane" data-cd-pane="history" ${tab === 'history' ? '' : 'hidden'}>${historyPaneHtml(chem, history)}</div>
    </div>
    <div class="rq-foot">
      <button type="button" class="btn btn-secondary btn-sm" data-cd="edit">Editar ficha</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cd="copy">Duplicar</button>
      <span class="rq-dates"></span>
      <button type="button" class="btn btn-ghost btn-sm text-danger" data-cd="off">Desactivar</button>
    </div>`

  const drawer = root.querySelector('.rq-drawer')
  drawer.querySelector('.rq-close').onclick = closeChemDrawer
  drawer.querySelectorAll('[data-cd-tab]').forEach((btn) => {
    btn.onclick = () => {
      drawer.querySelectorAll('[data-cd-tab]').forEach((b) => b.classList.toggle('is-active', b === btn))
      drawer.querySelectorAll('[data-cd-pane]').forEach((p) => { p.hidden = p.dataset.cdPane !== btn.dataset.cdTab })
    }
  })
  drawer.querySelector('[data-cd="move"]').onclick = () => openMovementForm(chem, lots)
  drawer.querySelector('[data-cd="edit"]').onclick = () => {
    closeChemDrawer()
    openChemicalForm(chem.id, async () => {
      await loadStock({ keepPage: true })
      openChemDrawer(chem.id, 'sheet')
    })
  }
  drawer.querySelector('[data-cd="copy"]').onclick = () => {
    closeChemDrawer()
    openChemicalForm(null, () => loadStock({ keepPage: true }), {
      prefill: { ...chem, code: '', name: `${chem.name} (copia)` },
    })
  }
  drawer.querySelector('[data-cd="off"]').onclick = async () => {
    const ok = await confirm(`${esc(chem.name)} dejará de aparecer en el inventario y en las fórmulas nuevas.`, 'Desactivar químico')
    if (!ok) return
    try {
      await chemicalsApi.delete(chem.id)
      toast.success('Químico desactivado')
      closeChemDrawer()
      await loadStock({ keepPage: true })
    } catch (err) {
      toast.error(err.message)
    }
  }
  drawer.querySelectorAll('[data-lot-expiry]').forEach((btn) => {
    btn.onclick = () => {
      const card = btn.closest('.cd-lot')
      const form = card?.querySelector('.cd-lot-expiry')
      if (form) form.hidden = !form.hidden
    }
  })
  drawer.querySelectorAll('.cd-lot-expiry').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault()
      const value = form.querySelector('input').value
      if (!value) return
      try {
        await chemicalsApi.updateLot(chem.id, Number(form.dataset.lotId), { expiry_date: value })
        toast.success('Vencimiento guardado')
        await loadStock({ keepPage: true })
        openChemDrawer(chem.id, 'lots')
      } catch (err) {
        toast.error(err.message)
      }
    }
  })
}

function lotsPaneHtml(chem, lots) {
  if (!lots.length) return '<p class="sk-empty">Sin lotes. El lote se crea al ingresar el producto por OCC o al cargar el inventario.</p>'
  const unit = chem.unit || 'kg'
  const ordered = [...lots].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1))
  return ordered.map((l) => {
    const cost = Number(l.unit_cost || 0)
    const left = Number(l.quantity_remaining || 0)
    const days = daysUntil(l.expiry_date)
    const expiry = l.expiry_date
      ? `<em class="sk-status is-${days != null && days < 0 ? 'danger' : days != null && days <= 30 ? 'warning' : 'success'}">${esc(formatDay(l.expiry_date))}${days != null && days >= 0 ? ` · ${days} días` : days != null ? ' · vencido' : ''}</em>`
      : '<em class="sk-status is-warning">Sin fecha de vencimiento</em>'
    return `
      <article class="cd-lot ${l.status !== 'active' ? 'is-off' : ''}">
        <header>
          <div><span>Lote</span><code>${esc(l.lot_number || '—')}</code></div>
          <strong>${esc(fmtQty(left))} <small>${esc(l.unit || unit)}</small></strong>
        </header>
        <dl>
          <div><dt>Recibido</dt><dd>${esc(fmtQty(l.quantity_received))} ${esc(l.unit || unit)}</dd></div>
          ${Number(l.lab_quantity) > 0 ? `<div><dt>En laboratorio</dt><dd>${esc(labText(l.lab_quantity, l.unit || unit))}</dd></div>` : ''}
          <div><dt>Fecha de compra</dt><dd>${esc(formatDay(l.purchase_date || l.created_at) || '—')}</dd></div>
          <div><dt>Costo unitario</dt><dd>${cost > 0 ? `${esc(fmtMoney(cost))} / ${esc(l.unit || unit)}` : '—'}</dd></div>
          <div><dt>Valor del lote</dt><dd>${cost > 0 ? esc(fmtMoney(cost * left)) : '—'}</dd></div>
          <div class="is-wide">
            <dt>Vencimiento</dt>
            <dd class="cd-lot-exp">${expiry}${l.status === 'active' ? `<button type="button" class="cd-link" data-lot-expiry>${l.expiry_date ? 'Cambiar fecha' : 'Agregar fecha'}</button>` : ''}</dd>
          </div>
          ${l.status !== 'active' ? `<div><dt>Estado</dt><dd>${esc(LOT_STATUS[l.status] || l.status)}</dd></div>` : ''}
        </dl>
        <form class="cd-lot-expiry" data-lot-id="${l.id}" hidden>
          <input type="date" class="form-input" value="${esc(String(l.expiry_date || '').slice(0, 10))}" required>
          <button type="submit" class="btn btn-primary btn-sm">Guardar</button>
        </form>
      </article>`
  }).join('')
}

function movesPaneHtml(chem, moves) {
  if (!moves.length) return '<p class="sk-empty">Sin movimientos registrados.</p>'
  return `<div class="cd-list">${moves.map((m) => {
    const kind = m.movement_type || ''
    const qty = Number(m.quantity) || 0
    const negative = kind === 'out' || kind === 'waste' || (kind === 'adjustment' && qty < 0)
    return `
      <div class="sk-move">
        <div>
          <strong>${esc(moveLabel(m))}${m.lot_number ? ` · <code>${esc(m.lot_number)}</code>` : ''}</strong>
          <small>${esc([formatDay(m.created_at), fmtTime(m.created_at), m.user_name].filter(Boolean).join(' · '))}${m.notes ? ` — ${esc(m.notes)}` : ''}</small>
        </div>
        <div class="sk-move-qty">
          <b class="${negative ? 'is-out' : 'is-in'}">${negative ? '−' : '+'}${esc(moveQtyText(m, chem.unit))}</b>
        </div>
      </div>`
  }).join('')}</div>`
}

function sheetPaneHtml(chem) {
  const fields = [
    ['Unidad', chem.unit || 'kg'],
    ['Ubicación', chem.location || 'Sin asignar'],
    ['Stock mínimo', Number(chem.min_stock_alert) > 0 ? `${fmtQty(chem.min_stock_alert)} ${chem.unit || 'kg'}` : 'Sin definir'],
    ['Densidad', chem.density_g_ml ? `${fmtQty(chem.density_g_ml, 3)} g/mL` : '—'],
    ['Número CAS', chem.cas_number || 'Sin registrar'],
    ['Material peligroso', Number(chem.is_hazardous) ? 'Sí' : 'No'],
    ['Último precio', Number(chem.last_unit_price) > 0 ? `${fmtMoney(chem.last_unit_price)} / ${chem.unit || 'kg'}` : '—'],
    ['Proveedor', chem.supplier || 'Sin proveedor'],
  ]
  return `
    <dl class="cd-sheet">
      ${fields.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
      ${chem.safety_notes ? `<div class="is-wide"><dt>Notas de seguridad</dt><dd>${esc(chem.safety_notes)}</dd></div>` : ''}
      ${chem.notes ? `<div class="is-wide"><dt>Notas</dt><dd>${esc(chem.notes)}</dd></div>` : ''}
    </dl>`
}

function historyPaneHtml(chem, rows) {
  if (!rows.length) return '<p class="sk-empty">Sin compras registradas por OCC.</p>'
  const unit = chem.unit || 'kg'
  return `<div class="cd-list">${rows.map((r) => {
    const ordered = Number(r.qty_ordered || 0)
    const entered = Number(r.qty_entered || 0)
    const done = ordered > 0 && entered + 1e-4 >= ordered
    return `
      <div class="sk-move">
        <div>
          <strong>${esc(r.occ_number || 'OCC')}${r.soc_number ? ` · ${esc(r.soc_number)}` : ''}</strong>
          <small>${esc([formatDay(r.created_at), r.supplier, Number(r.unit_price) > 0 ? `${fmtMoney(r.unit_price)} / ${unit}` : ''].filter(Boolean).join(' · '))}</small>
        </div>
        <div class="sk-move-qty">
          <b>${esc(fmtQty(entered))} / ${esc(fmtQty(ordered))} ${esc(unit)}</b>
          <small>${done ? 'Entregado' : entered > 0 ? 'Parcial' : 'Pedido'}</small>
        </div>
      </div>`
  }).join('')}</div>`
}

function openMovementForm(chem, lots) {
  const unit = chem.unit || 'kg'
  const active = lots.filter((l) => l.status === 'active' || Number(l.quantity_remaining) > 0)
  const kinds = [
    { id: 'in', label: 'Entrada' },
    { id: 'out', label: 'Salida' },
    { id: 'adj-up', label: 'Ajuste +' },
    { id: 'adj-down', label: 'Ajuste −' },
    { id: 'waste', label: 'Merma' },
  ]
  openModal(`Registrar movimiento · ${chem.name}`, `
    <form id="mv-form">
      <div class="form-group">
        <label class="form-label">Tipo</label>
        <div class="mf-pills" role="group" aria-label="Tipo de movimiento">
          ${kinds.map((k, i) => `<button type="button" class="mf-pill is-accent${i === 0 ? ' is-on' : ''}" data-mv-kind="${k.id}">${k.label}</button>`).join('')}
        </div>
      </div>
      <div class="form-group" id="mv-dest-wrap" hidden>
        <label class="form-label">Destino de la salida</label>
        <div class="mf-pills" role="group" aria-label="Destino">
          <button type="button" class="mf-pill is-accent is-on" data-mv-dest="consumo">Consumo</button>
          <button type="button" class="mf-pill is-accent" data-mv-dest="laboratorio">Laboratorio</button>
        </div>
        <p class="form-hint" id="mv-dest-hint">Sale de bodega y no entra a otro inventario.</p>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Cantidad <span class="required"></span></label>
          <div class="mf-unit" id="mv-unit-box">
            <input id="mv-qty" class="form-input" type="number" min="0.001" step="0.001" required>
            <select id="mv-unit" class="mf-unit-select" hidden></select>
            <span id="mv-unit-label">${esc(unit)}</span>
          </div>
          <p class="form-hint" id="mv-stock-hint"></p>
          <p class="form-hint" id="mv-convert" hidden></p>
        </div>
        <div class="form-group">
          <label class="form-label">Lote</label>
          <select id="mv-lot" class="form-select">
            <option value="">Sin lote</option>
            ${active.map((l) => `<option value="${l.id}">${esc(l.lot_number)} · ${esc(fmtQty(l.quantity_remaining))} ${esc(l.unit || unit)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Nota</label>
        <input id="mv-notes" class="form-input" placeholder="Motivo del movimiento">
      </div>
      <div id="mv-error" class="form-error" style="display:none"></div>
    </form>`, {
    footerHTML: `
      <button class="btn btn-secondary" id="mv-cancel">Cancelar</button>
      <button class="btn btn-primary" id="mv-submit">Registrar</button>`,
  })
  let kind = 'in'
  let destination = 'consumo'
  const destWrap = document.getElementById('mv-dest-wrap')
  const qtyInput = document.getElementById('mv-qty')
  const unitSelect = document.getElementById('mv-unit')
  const unitLabel = document.getElementById('mv-unit-label')
  const unitBox = document.getElementById('mv-unit-box')
  const choices = entryUnits(unit)
  const labEntry = () => kind === 'out' && destination === 'laboratorio' && choices.length > 1
  const entryUnit = () => (labEntry() ? unitSelect.value : unit)
  const paintEntry = () => {
    const lab = labEntry()
    destWrap.hidden = kind !== 'out'
    unitSelect.hidden = !lab
    unitLabel.hidden = lab
    unitBox.classList.toggle('is-choice', lab)
    if (lab) {
      const current = choices.includes(unitSelect.value) ? unitSelect.value : labUnit(unit)
      unitSelect.innerHTML = choices.map((u) => `<option value="${u}">${u}</option>`).join('')
      unitSelect.value = current
      qtyInput.step = current === 'g' || current === 'mL' ? '0.1' : '0.001'
      qtyInput.min = current === 'g' || current === 'mL' ? '0.1' : '0.001'
    } else {
      qtyInput.step = '0.001'
      qtyInput.min = '0.001'
    }
    const labShown = expressLab(chem.lab_quantity || 0, unit)
    document.getElementById('mv-stock-hint').textContent =
      `En bodega: ${fmtQty(chem.stock_quantity)} ${unit} · En laboratorio: ${fmtQty(labShown.qty)} ${labShown.unit}`
    const typed = parseFloat(qtyInput.value)
    const entered = entryUnit()
    const convert = document.getElementById('mv-convert')
    const baseQty = Number.isFinite(typed) ? convertQty(typed, entered, unit) : null
    if (lab && entered !== unit && baseQty != null && typed > 0) {
      convert.hidden = false
      convert.textContent = `${fmtQty(typed, 1)} ${entered} salen como ${fmtQty(baseQty, 3)} ${unit} de bodega.`
    } else {
      convert.hidden = true
      convert.textContent = ''
    }
  }
  paintEntry()
  document.querySelectorAll('[data-mv-kind]').forEach((btn) => {
    btn.onclick = () => {
      kind = btn.dataset.mvKind
      document.querySelectorAll('[data-mv-kind]').forEach((b) => b.classList.toggle('is-on', b === btn))
      paintEntry()
    }
  })
  document.querySelectorAll('[data-mv-dest]').forEach((btn) => {
    btn.onclick = () => {
      destination = btn.dataset.mvDest
      document.querySelectorAll('[data-mv-dest]').forEach((b) => b.classList.toggle('is-on', b === btn))
      document.getElementById('mv-dest-hint').textContent = destination === 'laboratorio'
        ? `Sale de bodega y entra al inventario de laboratorio. Puedes anotarlo en ${labUnit(unit)}.`
        : 'Sale de bodega y no entra a otro inventario.'
      paintEntry()
    }
  })
  unitSelect.onchange = paintEntry
  qtyInput.oninput = paintEntry
  document.getElementById('mv-cancel').onclick = () => closeModal()
  document.getElementById('mv-submit').onclick = async () => {
    const errEl = document.getElementById('mv-error')
    const typed = parseFloat(qtyInput.value)
    const entered = entryUnit()
    const qty = convertQty(typed, entered, unit)
    if (!typed || typed <= 0 || qty == null || qty <= 0) {
      errEl.textContent = 'Indica una cantidad mayor que cero'
      errEl.style.display = 'block'
      return
    }
    const lotId = Number(document.getElementById('mv-lot').value) || undefined
    const payload = {
      movement_type: kind.startsWith('adj') ? 'adjustment' : kind,
      direction: kind === 'adj-up' ? 'up' : kind === 'adj-down' ? 'down' : undefined,
      quantity: qty,
      unit,
      lot_id: lotId,
      destination: kind === 'out' ? destination : undefined,
      notes: document.getElementById('mv-notes').value.trim() || undefined,
    }
    const btn = document.getElementById('mv-submit')
    btn.disabled = true
    errEl.style.display = 'none'
    try {
      await chemicalsApi.addMovement(chem.id, payload)
      toast.success('Movimiento registrado')
      closeModal()
      await loadStock({ keepPage: true })
      openChemDrawer(chem.id, 'moves')
    } catch (err) {
      errEl.textContent = err.message
      errEl.style.display = 'block'
      btn.disabled = false
    }
  }
}

function fmtMoney(n) {
  const amount = Number(n)
  if (!Number.isFinite(amount)) return ''
  return `$${amount.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

function moveKind(m) {
  if (m.movement_type === 'in') return 'in'
  if (m.movement_type === 'out' || m.movement_type === 'waste') return 'out'
  return 'adjustment'
}

function moveGroupKey(m) {
  const day = String(m.created_at || '').slice(0, 10)
  return `${day}|${m.notes || m.reference_type || moveKind(m)}|${m.user_name || ''}`
}

function paintMoves() {
  const body = document.getElementById('sk-moves-body')
  if (!body) return
  const list = state.movements.filter((m) => state.moveTab === 'all' || moveKind(m) === state.moveTab)
  const range = document.getElementById('sk-move-range')
  const pager = document.getElementById('sk-move-pager')
  if (!list.length) {
    body.innerHTML = '<p class="sk-empty">Sin movimientos registrados</p>'
    if (range) range.textContent = ''
    if (pager) pager.innerHTML = ''
    return
  }
  const groupSizes = new Map()
  for (const m of list) {
    const key = moveGroupKey(m)
    groupSizes.set(key, (groupSizes.get(key) || 0) + 1)
  }
  const capacity = Math.max(MOVE_ROW_H * 2, body.clientHeight)
  const pages = paginate(list, capacity, MOVE_GROUP_H, MOVE_ROW_H, moveGroupKey)
  state.movePages = pages
  const totalPages = Math.max(1, pages.length)
  if (state.movePage > totalPages) state.movePage = totalPages
  if (state.movePage < 1) state.movePage = 1
  const current = pages[state.movePage - 1] || []

  body.innerHTML = current.map(({ entry: m, header }) => {
    const kind = moveKind(m)
    const qty = Math.abs(Number(m.quantity) || 0)
    const negative = kind === 'out' || Number(m.quantity) < 0
    const label = moveLabel(m)
    let head = ''
    if (header) {
      const n = groupSizes.get(moveGroupKey(m)) || 1
      head = `
        <div class="sk-move-group">
          <strong>${esc(fmtLongDay(m.created_at))} · ${esc(m.notes || label)}</strong>
          <span>${esc(['Bodega 10502', m.user_name, `${n} producto${n === 1 ? '' : 's'}`].filter(Boolean).join(' · '))}</span>
        </div>`
    }
    return `${head}
      <div class="sk-move">
        <div>
          <strong title="${esc(m.chemical_name || '')}">${esc(m.chemical_name || '—')}</strong>
          <small>${esc(fmtTime(m.created_at))}</small>
        </div>
        <div class="sk-move-qty">
          <b class="${negative ? 'is-out' : 'is-in'}">${negative ? '−' : '+'}${esc(moveQtyText(m))}</b>
          <small>${label}</small>
        </div>
      </div>`
  }).join('')

  if (range) range.textContent = `${list.length} movimiento${list.length === 1 ? '' : 's'}`
  if (pager) {
    pager.innerHTML = totalPages > 1 ? `
      <button type="button" data-page="${state.movePage - 1}" ${state.movePage <= 1 ? 'disabled' : ''} aria-label="Anterior">‹</button>
      <span>${state.movePage} / ${totalPages}</span>
      <button type="button" data-page="${state.movePage + 1}" ${state.movePage >= totalPages ? 'disabled' : ''} aria-label="Siguiente">›</button>` : ''
    pager.querySelectorAll('[data-page]').forEach((btn) => {
      btn.onclick = () => {
        state.movePage = Number(btn.dataset.page)
        paintMoves()
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Formatos
// ---------------------------------------------------------------------------

function parseStamp(value) {
  if (!value) return null
  const raw = String(value).trim()
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function fmtLongDay(value) {
  const d = parseStamp(value)
  if (!d) return ''
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })
}

function fmtTime(value) {
  const d = parseStamp(value)
  if (!d) return ''
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function daysUntil(value) {
  if (!value) return null
  const raw = String(value).split('T')[0]
  const [year, month, day] = raw.split('-').map(Number)
  if (!year || !month || !day) return null
  const target = new Date(year, month - 1, day)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}

function formatDay(value) {
  if (!value) return ''
  const raw = String(value).split('T')[0]
  const [year, month, day] = raw.split('-').map(Number)
  if (!year || !month || !day) return raw
  return new Date(year, month - 1, day).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function labText(qty, unit) {
  const shown = expressLab(qty, unit)
  const digits = shown.unit === 'g' || shown.unit === 'mL' ? 1 : 2
  return `${fmtQty(shown.qty, digits)} ${shown.unit}`
}

function moveQtyText(m, fallbackUnit) {
  const qty = Math.abs(Number(m.quantity) || 0)
  const unit = m.unit || fallbackUnit || 'kg'
  if (m.reference_type === 'laboratorio') return labText(qty, unit)
  return `${fmtQty(qty, 3)} ${unit}`
}

function fmtQty(n, fractionDigits) {
  if (n == null || n === '') return ''
  const digits = fractionDigits == null ? undefined : fractionDigits
  return Number(n).toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits ?? 2,
  })
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
