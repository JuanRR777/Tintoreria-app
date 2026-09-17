import { chemicals as chemicalsApi, requests as requestsApi, stock } from '../api.js'

const TYPE_LABELS = {
  acido: 'Acido', reactivo: 'Reactivo', directo: 'Directo', auxiliar: 'Auxiliar',
  mordiente: 'Mordiente', disperso: 'Disperso', vat: 'Vat',
  blanqueador: 'Blanqueador', otros: 'Otros',
}

const TYPE_ORDER = [
  'auxiliar', 'blanqueador', 'reactivo', 'acido', 'directo',
  'disperso', 'vat', 'mordiente', 'otros',
]

let currentTab = 'general'
let generalType = ''
let generalAll = []

const PAGE_SIZE = {
  general: 12,
  critical: 8,
  expiring: 8,
  transit: 8,
  movements: 10,
}

const pages = {
  general: 1,
  critical: 1,
  expiring: 1,
  transit: 1,
  movements: 1,
}

const cache = {
  general: [],
  critical: [],
  expiring: [],
  transit: [],
  movements: [],
}

const ICON = {
  alert: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636-2.87l-8.106-13.536a1.914 1.914 0 0 0-3.274 0z"/><path d="M12 16h.01"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.986 12.51a9 9 0 1 0-8.476 8.48"/><path d="M12 7v5l3 3"/><path d="M19 16v3"/><path d="M19 22v.01"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0"/><path d="M17 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0"/><path d="M5 17H3v-4M2 5h11v12m-4 0h6m4 0h2v-6h-8M13 5h5l3 5"/><path d="M3 9h4"/></svg>`,
  flask: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"/><path d="M10 9h4"/><path d="M9 3v7l-5.5 9.5A1.65 1.65 0 0 0 5.9 22h12.2a1.65 1.65 0 0 0 1.4-2.5L15 10V3"/></svg>`,
  warehouse: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13"/><path d="M13 13h4v8h-4z"/><path d="M7 13h4v8H7z"/></svg>`,
  wait: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12"/><path d="M6 20h12"/><path d="M8 4c0 5 8 6 8 12"/><path d="M16 20c0-5-8-6-8-12"/></svg>`,
}

const CHEM_ART = {
  acido: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M18 8h12v7l8 15.5A6 6 0 0 1 32.7 40H15.3A6 6 0 0 1 10 30.5L18 15V8z" fill="currentColor" opacity=".16"/><path d="M18 8h12M20 15h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 8v7l-8 15.5A6 6 0 0 0 15.3 40h17.4A6 6 0 0 0 38 30.5L30 15V8" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="21" cy="29" r="1.4" fill="currentColor" opacity=".55"/><circle cx="28" cy="33" r="1.1" fill="currentColor" opacity=".4"/></svg>`,
  reactivo: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M14 12h20v20a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8V12z" fill="currentColor" opacity=".16"/><path d="M14 12h20" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 12v18a8 8 0 0 0 8 8 8 8 0 0 0 8-8V12" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 26h16" stroke="currentColor" stroke-width="2" opacity=".35"/><path d="M22 8h4v4h-4z" fill="currentColor" opacity=".5"/></svg>`,
  directo: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M20 8h8v8l6 6v16a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V22l6-6V8z" fill="currentColor" opacity=".16"/><path d="M20 8h8v8l6 6v16a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V22l6-6V8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16 24h16" stroke="currentColor" stroke-width="2" opacity=".35"/><circle cx="24" cy="34" r="3" fill="currentColor" opacity=".45"/></svg>`,
  auxiliar: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M18 10h12v6l4 4v18a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V20l4-4v-6z" fill="currentColor" opacity=".16"/><path d="M18 10h12v6l4 4v18a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V20l4-4v-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M21 10V7h6v3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 26c3 3 13 3 16 0" fill="none" stroke="currentColor" stroke-width="2" opacity=".4"/></svg>`,
  mordiente: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M16 14h4v10l-7 14h22l-7-14V14h4" fill="currentColor" opacity=".14"/><path d="M16 14h4v10l-7 14h22l-7-14V14h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M20 8h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="32" r="2" fill="currentColor" opacity=".5"/></svg>`,
  disperso: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M24 8c6 8 12 14 12 22a12 12 0 0 1-24 0c0-8 6-14 12-22z" fill="currentColor" opacity=".16"/><path d="M24 8c6 8 12 14 12 22a12 12 0 0 1-24 0c0-8 6-14 12-22z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="20" cy="28" r="1.4" fill="currentColor" opacity=".5"/><circle cx="27" cy="32" r="1.8" fill="currentColor" opacity=".4"/><circle cx="24" cy="22" r="1.1" fill="currentColor" opacity=".45"/></svg>`,
  vat: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M10 18h28v16a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V18z" fill="currentColor" opacity=".16"/><path d="M10 18h28v16a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V18z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 18V12h20v6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 26h24" stroke="currentColor" stroke-width="2" opacity=".35"/></svg>`,
  blanqueador: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M19 12h10l3 6v18a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V18l3-6z" fill="currentColor" opacity=".16"/><path d="M19 12h10l3 6v18a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V18l3-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M32 10l2-3M36 14l3-1M31 16l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 24h12" stroke="currentColor" stroke-width="2" opacity=".35"/></svg>`,
  otros: `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path d="M18 8h12v8l8 16a6 6 0 0 1-5.2 9H15.2A6 6 0 0 1 10 32l8-16V8z" fill="currentColor" opacity=".16"/><path d="M18 8h12M20 16h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 8v8l-8 16a6 6 0 0 0 5.2 9h17.6A6 6 0 0 0 38 32l-8-16V8" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
}

export async function showView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Stock</h1>
        <p class="page-subtitle">Estado de inventario, alertas y movimientos de quimicos</p>
      </div>
    </div>
    <div id="stock-content"><div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div></div>
  `
  await loadStock()
}

async function loadStock() {
  const container = document.getElementById('stock-content')
  if (!container) return
  try {
    const summary = await stock.summary({ fresh: true })
    summary.pending_purchase = await withOccNumbers(summary.pending_purchase || [])
    renderStock(summary, container)
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`
  }
}

function itemKey(value) {
  const raw = String(value || '').trim()
  const stripped = raw.replace(/^0+/, '')
  return stripped || raw
}

function occSortValue(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits ? Number(digits) : Number.POSITIVE_INFINITY
}

function byOccNumber(a, b) {
  const diff = occSortValue(a.occ_number) - occSortValue(b.occ_number)
  if (diff) return diff
  return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' })
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

function renderStock(s, container) {
  const low = s.low_stock_chemicals || []
  const expiring = s.expiring_lots_30d || []
  const pending = s.pending_purchase || []
  const waiting = pending.filter(isWaiting)
  const ordered = pending.filter((c) => !isWaiting(c)).sort(byOccNumber)
  const availableCount = Math.max(0, (s.chemicals_total ?? s.total_chemicals ?? 0) - (s.waiting_count ?? 0) - (s.ordered_count ?? 0))

  container.innerHTML = `
    <div class="stats-grid" style="margin-bottom:16px">
      <div class="stat-card is-clickable" data-tab="general">
        <div class="stat-icon blue"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></div>
        <div class="stat-info">
          <div class="stat-label">Total quimicos</div>
          <div class="stat-value">${s.chemicals_total ?? s.total_chemicals ?? 0}</div>
        </div>
      </div>
      <div class="stat-card is-clickable" data-tab="critical">
        <div class="stat-icon ${(s.low_stock_count ?? 0) > 0 ? 'red' : 'green'}">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>
        </div>
        <div class="stat-info">
          <div class="stat-label">Alertas stock bajo</div>
          <div class="stat-value">${s.low_stock_count ?? 0}</div>
        </div>
      </div>
      <div class="stat-card is-clickable" data-tab="expiring">
        <div class="stat-icon ${(s.expiring_soon_count ?? 0) > 0 ? 'amber' : 'green'}">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="stat-info">
          <div class="stat-label">Lotes por vencer (30d)</div>
          <div class="stat-value">${s.expiring_soon_count ?? 0}</div>
        </div>
      </div>
      <div class="stat-card is-clickable" data-tab="transit">
        <div class="stat-icon ${(s.waiting_count ?? 0) > 0 ? 'amber' : 'blue'}">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="stat-info">
          <div class="stat-label">En espera (SOC)</div>
          <div class="stat-value">${s.waiting_count ?? 0}</div>
        </div>
      </div>
      <div class="stat-card is-clickable" data-tab="transit">
        <div class="stat-icon ${(s.ordered_count ?? 0) > 0 ? 'blue' : 'green'}">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="stat-info">
          <div class="stat-label">Pedido (OCC)</div>
          <div class="stat-value">${s.ordered_count ?? 0}</div>
        </div>
      </div>
    </div>

    <div class="inv-tabs" role="tablist">
      ${tabButton('general', 'Inventario general', availableCount)}
      ${tabButton('critical', 'Stock crítico', low.length)}
      ${tabButton('expiring', 'Por vencer', expiring.length)}
      ${tabButton('transit', 'En tránsito', pending.length)}
    </div>

    <div class="inv-panel" data-panel="general" ${panelHidden('general')}>
      <div class="inv-layout">
        <section class="inv-board is-success">
          <header class="inv-board-head">
            <div class="inv-board-icon">${ICON.warehouse}</div>
            <div class="inv-board-copy">
              <h3>Disponible en bodega</h3>
              <p>Inventario real con entrada</p>
            </div>
            <span class="inv-board-count" id="inv-available-count">${availableCount}</span>
          </header>
          <div class="inv-board-toolbar">
            <div class="search-box">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="inv-general-search" placeholder="Buscar por nombre, codigo o proveedor...">
            </div>
            <div class="inv-type-filters" id="inv-type-filters"></div>
          </div>
          <div id="inv-general-list"><div class="loading-state"><div class="spinner"></div><span>Cargando inventario...</span></div></div>
        </section>
        <aside class="inv-side">
          <header class="inv-side-head">
            <h3>Movimientos</h3>
            <p>Entradas, salidas y ajustes de bodega</p>
          </header>
          <div id="movements-list" class="inv-side-body">
            <div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div>
          </div>
        </aside>
      </div>
    </div>

    <div class="inv-panel" data-panel="critical" ${panelHidden('critical')}>
      ${board({
        theme: 'danger',
        icon: ICON.alert,
        title: 'Stock crítico',
        subtitle: 'Requiere reposición inmediata',
        count: low.length,
        body: '<div id="inv-critical-list"></div>',
      })}
    </div>

    <div class="inv-panel" data-panel="expiring" ${panelHidden('expiring')}>
      ${board({
        theme: 'warning',
        icon: ICON.clock,
        title: 'Por vencer',
        subtitle: 'Próximos 30 días',
        count: expiring.length,
        body: '<div id="inv-expiring-list"></div>',
      })}
    </div>

    <div class="inv-panel" data-panel="transit" ${panelHidden('transit')}>
      ${board({
        theme: 'accent',
        icon: ICON.truck,
        title: 'En tránsito',
        subtitle: 'Aún falta completar entrada a bodega',
        count: pending.length,
        body: '<div id="inv-transit-list"></div>',
      })}
    </div>
  `

  cache.critical = low
  cache.expiring = expiring
  cache.transit = [...waiting, ...ordered]
  pages.critical = 1
  pages.expiring = 1
  pages.transit = 1

  bindTabs(container)
  bindStockClicks(container)
  bindGeneralSearch()
  paintMini('critical', miniLowStock, 'Sin alertas de stock bajo')
  paintMini('expiring', miniExpiring, 'Sin lotes por vencer')
  paintTransit()
  loadGeneralList()
  loadMovements()
}

function tabButton(id, label, count) {
  const active = currentTab === id
  return `
    <button type="button" class="inv-tab ${active ? 'is-active' : ''} is-${id}" data-tab="${id}" role="tab" aria-selected="${active ? 'true' : 'false'}">
      ${esc(label)}
      <span class="inv-tab-count">${count}</span>
    </button>`
}

function panelHidden(id) {
  return currentTab === id ? '' : 'hidden'
}

function bindTabs(container) {
  container.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.onclick = () => setTab(container, btn.dataset.tab)
  })
}

function setTab(container, tab) {
  currentTab = tab
  container.querySelectorAll('.inv-tab[data-tab], .stat-card[data-tab]').forEach((btn) => {
    if (btn.classList.contains('inv-tab')) {
      const on = btn.dataset.tab === tab
      btn.classList.toggle('is-active', on)
      btn.setAttribute('aria-selected', on ? 'true' : 'false')
    }
  })
  container.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab
  })
}

function bindGeneralSearch() {
  const search = document.getElementById('inv-general-search')
  if (!search) return
  let debounce
  search.oninput = () => {
    clearTimeout(debounce)
    debounce = setTimeout(loadGeneralList, 200)
  }
}

async function loadGeneralList() {
  const list = document.getElementById('inv-general-list')
  if (!list) return
  const query = (document.getElementById('inv-general-search')?.value || '').trim()
  try {
    const items = await chemicalsApi.list({ search: query || undefined }, { fresh: true })
    generalAll = items
      .filter((c) => chemKind(c) === 'disponible')
      .sort((a, b) => byTypeThenName(a, b))
    if (!query) {
      const countEl = document.querySelector('.inv-tab[data-tab="general"] .inv-tab-count')
      const boardCount = document.getElementById('inv-available-count')
      if (countEl) countEl.textContent = generalAll.length
      if (boardCount) boardCount.textContent = generalAll.length
    }
    paintTypeFilters()
    applyGeneralFilter()
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`
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
  const rank = typeRank(chemTypeOf(a)) - typeRank(chemTypeOf(b))
  if (rank) return rank
  return String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' })
}

function paintTypeFilters() {
  const el = document.getElementById('inv-type-filters')
  if (!el) return
  const counts = new Map()
  for (const c of generalAll) {
    const type = chemTypeOf(c)
    counts.set(type, (counts.get(type) || 0) + 1)
  }
  if (generalType && !counts.has(generalType)) generalType = ''
  const chips = [
    `<button type="button" class="inv-type-chip is-all${generalType === '' ? ' is-active' : ''}" data-inv-type=""><span class="inv-type-dot"></span>Todos <strong>${generalAll.length}</strong></button>`,
  ]
  for (const key of TYPE_ORDER) {
    const n = counts.get(key)
    if (!n) continue
    chips.push(
      `<button type="button" class="inv-type-chip is-${esc(key)}${generalType === key ? ' is-active' : ''}" data-inv-type="${esc(key)}"><span class="inv-type-dot"></span>${esc(TYPE_LABELS[key] || key)} <strong>${n}</strong></button>`
    )
  }
  el.innerHTML = `<span class="inv-type-label">Tipo</span>${chips.join('')}`
}

function applyGeneralFilter() {
  const filtered = generalType
    ? generalAll.filter((c) => chemTypeOf(c) === generalType)
    : generalAll
  cache.general = filtered
  pages.general = 1
  renderGeneralCards()
}

function chemKind(c) {
  if (c.procurement_status === 'espera') return 'espera'
  if (c.procurement_status === 'pedido') return 'pedido'
  return 'disponible'
}

function renderGeneralCards() {
  const container = document.getElementById('inv-general-list')
  if (!container) return
  if (!cache.general.length) {
    container.innerHTML = emptyMsg(generalType
      ? `Sin químicos de tipo ${TYPE_LABELS[generalType] || generalType} en bodega`
      : 'Sin químicos disponibles en bodega')
    return
  }
  const { items, page, totalPages } = slicePage('general')
  container.innerHTML = `
    ${generalType ? `<div class="inv-chem-grid">${items.map((c) => chemCard(c, 'disponible')).join('')}</div>` : groupedCards(items)}
    ${pagerMarkup('general', page, totalPages)}`
}

function groupedCards(items) {
  const groups = []
  for (const c of items) {
    const type = chemTypeOf(c)
    if (!groups.length || groups[groups.length - 1].type !== type) {
      groups.push({ type, items: [c] })
    } else {
      groups[groups.length - 1].items.push(c)
    }
  }
  return groups.map((group) => {
    const total = generalAll.filter((c) => chemTypeOf(c) === group.type).length
    return `
    <div class="inv-type-band is-${esc(group.type)}">
      <span class="inv-type-dot"></span>
      <strong>${esc(TYPE_LABELS[group.type] || group.type)}</strong>
      <span class="inv-type-band-count">${total}</span>
    </div>
    <div class="inv-chem-grid">${group.items.map((c) => chemCard(c, 'disponible')).join('')}</div>
  `
  }).join('')
}

function chemCard(c, kind) {
  const type = c.chemical_type || 'otros'
  const art = CHEM_ART[type] || CHEM_ART.otros
  const typeLabel = TYPE_LABELS[type] || type
  const unit = c.unit || 'kg'
  const stock = Number(c.stock_quantity || 0)
  const pending = Number(c.pending_qty || 0)
  const price = fmtPrice(c.last_unit_price, c.last_unit_currency)
  const supplier = String(c.supplier || '').trim()

  let main = ''
  let extra = ''
  if (kind === 'disponible') {
    const partial = pending > 0
    main = `<p class="inv-chem-main is-success">${fmtQty(stock, 2)} ${esc(unit)}</p>`
    extra = [
      partial ? `<span class="inv-badge is-partial">Parcial</span>` : '',
      partial ? `<p class="inv-chem-sub">pendiente ${fmtQty(pending)} ${esc(unit)}</p>` : '',
    ].join('')
  } else if (kind === 'espera') {
    extra = `<span class="inv-badge">En espera</span>`
  } else {
    if (pending > 0) main = `<p class="inv-chem-main is-accent">${fmtQty(pending)} ${esc(unit)}</p>`
    extra = [
      supplier ? `<span class="inv-chem-sub">${esc(supplier)}</span>` : '',
      price ? `<span class="inv-chem-sub">${esc(price)}</span>` : '',
    ].join('')
  }

  return `
    <article class="inv-chem is-${kind}${kind === 'disponible' && pending > 0 ? ' is-partial' : ''}">
      <div class="inv-chem-art is-${esc(type)}">${art}</div>
      <span class="inv-chem-code">${esc(c.code || '')}</span>
      <p class="inv-chem-name" title="${esc(c.name || '')}">${esc(c.name || '')}</p>
      <p class="inv-chem-type">${esc(typeLabel)}</p>
      ${main}
      ${extra}
    </article>`
}

function board({ theme, icon, title, subtitle, count, body }) {
  return `
    <section class="inv-board is-${theme}">
      <header class="inv-board-head">
        <div class="inv-board-icon">${icon}</div>
        <div class="inv-board-copy">
          <h3>${esc(title)}</h3>
          <p>${esc(subtitle)}</p>
        </div>
        <span class="inv-board-count">${count}</span>
      </header>
      ${body}
    </section>`
}

function emptyMsg(text) {
  return `<p class="inv-empty">${esc(text)}</p>`
}

function paintMini(key, itemHtml, emptyText) {
  const el = document.getElementById(`inv-${key}-list`)
  if (!el) return
  if (!cache[key].length) {
    el.innerHTML = emptyMsg(emptyText)
    return
  }
  const { items, page, totalPages } = slicePage(key)
  el.innerHTML = `
    <div class="inv-mini-grid">${items.map(itemHtml).join('')}</div>
    ${pagerMarkup(key, page, totalPages)}`
}

function paintTransit() {
  const el = document.getElementById('inv-transit-list')
  if (!el) return
  if (!cache.transit.length) {
    el.innerHTML = emptyMsg('Sin items en espera o pedido. Importa SOC/OCC en Solicitudes.')
    return
  }
  const { items, page, totalPages } = slicePage('transit')
  const waiting = items.filter(isWaiting)
  const ordered = items.filter((c) => !isWaiting(c)).sort(byOccNumber)
  const waitBlock = waiting.length
    ? `<p class="inv-subhead">En espera</p>
       <div class="inv-mini-grid">${waiting.map(miniWaiting).join('')}</div>`
    : ''
  const orderBlock = ordered.length
    ? `<p class="inv-subhead">Pedido</p>
       <div class="inv-mini-grid">${ordered.map(miniOrdered).join('')}</div>`
    : ''
  el.innerHTML = `
    <div class="inv-board-body">${waitBlock}${orderBlock}</div>
    ${pagerMarkup('transit', page, totalPages)}`
}

function paintMovements() {
  const container = document.getElementById('movements-list')
  if (!container) return
  if (!cache.movements.length) {
    container.innerHTML = '<p class="inv-empty">Sin movimientos registrados</p>'
    return
  }
  const { items, page, totalPages } = slicePage('movements')
  container.innerHTML = `
    <div class="inv-side-moves">${items.map(moveCard).join('')}</div>
    ${pagerMarkup('movements', page, totalPages)}`
}

function moveCard(m) {
  const kind = m.movement_type === 'in' ? 'in' : m.movement_type === 'out' ? 'out' : 'adj'
  const label = kind === 'in' ? 'Entrada' : kind === 'out' ? 'Salida' : 'Ajuste'
  const qty = Number(m.quantity) || 0
  const signed = kind === 'out' ? `−${fmtQty(Math.abs(qty), 3)}` : `+${fmtQty(Math.abs(qty), 3)}`
  const when = formatDay(m.created_at) || (m.created_at || '').split('T')[0] || ''
  return `
    <article class="inv-move is-${kind}">
      <div class="inv-move-top">
        <strong title="${esc(m.chemical_name || '')}">${esc(m.chemical_name || '—')}</strong>
        <span class="inv-move-qty">${signed} ${esc(m.unit || 'kg')}</span>
      </div>
      <div class="inv-move-meta">
        <span>${esc(when)}</span>
        <span>${label}</span>
        ${m.user_name ? `<span>${esc(m.user_name)}</span>` : ''}
      </div>
      ${m.notes ? `<p class="inv-move-ref">${esc(m.notes)}</p>` : ''}
    </article>`
}

function slicePage(key) {
  const items = cache[key] || []
  const size = PAGE_SIZE[key]
  const totalPages = Math.max(1, Math.ceil(items.length / size))
  let page = pages[key] || 1
  if (page > totalPages) page = totalPages
  if (page < 1) page = 1
  pages[key] = page
  const start = (page - 1) * size
  return { items: items.slice(start, start + size), page, totalPages, total: items.length }
}

function pagerMarkup(key, page, totalPages) {
  if (totalPages <= 1) return ''
  return `
    <nav class="inv-pager" data-pager="${key}" aria-label="Paginación">
      <button type="button" class="inv-pager-btn" data-dir="-1" ${page <= 1 ? 'disabled' : ''} aria-label="Anterior">‹</button>
      <span>${page} / ${totalPages}</span>
      <button type="button" class="inv-pager-btn" data-dir="1" ${page >= totalPages ? 'disabled' : ''} aria-label="Siguiente">›</button>
    </nav>`
}

function paintKey(key) {
  if (key === 'general') renderGeneralCards()
  else if (key === 'movements') paintMovements()
  else if (key === 'critical') paintMini('critical', miniLowStock, 'Sin alertas de stock bajo')
  else if (key === 'expiring') paintMini('expiring', miniExpiring, 'Sin lotes por vencer')
  else if (key === 'transit') paintTransit()
}

function miniLowStock(c) {
  const min = Number(c.min_stock_alert)
  const showMin = Number.isFinite(min) && min > 0
  return `
    <div class="inv-mini">
      <div class="inv-mini-top">
        <span class="inv-mini-ico is-danger">${ICON.flask}</span>
        <span class="inv-mini-code">${esc(c.code || '')}</span>
      </div>
      <p class="inv-mini-name" title="${esc(c.name || '')}">${esc(c.name || '')}</p>
      <p class="inv-mini-main is-danger">${fmtQty(c.stock_quantity, 2)} ${esc(c.unit || 'kg')}</p>
      ${showMin ? `<p class="inv-mini-sub">mínimo ${fmtQty(min, 2)} ${esc(c.unit || 'kg')}</p>` : ''}
    </div>`
}

function miniExpiring(l) {
  const days = daysUntil(l.expiry_date)
  const main = days == null
    ? ''
    : days < 0
      ? '<p class="inv-mini-main is-danger">Vencido</p>'
      : days === 0
        ? '<p class="inv-mini-main is-warning">Vence hoy</p>'
        : `<p class="inv-mini-main is-warning">${days} ${days === 1 ? 'día' : 'días'}</p>`
  const expiry = formatDay(l.expiry_date)
  return `
    <div class="inv-mini">
      <div class="inv-mini-top">
        <span class="inv-mini-ico is-warning">${ICON.flask}</span>
        <span class="inv-mini-code">${esc(l.chemical_code || '')}</span>
      </div>
      <p class="inv-mini-name" title="${esc(l.chemical_name || '')}">${esc(l.chemical_name || '')}</p>
      ${main}
      ${l.lot_number ? `<p class="inv-mini-sub">${esc(l.lot_number)}</p>` : ''}
      ${expiry ? `<p class="inv-mini-sub">${esc(expiry)}</p>` : ''}
    </div>`
}

function miniWaiting(c) {
  return `
    <div class="inv-mini">
      <div class="inv-mini-top">
        <span class="inv-mini-ico is-accent">${ICON.flask}</span>
        <span class="inv-mini-code">${esc(c.code || '')}</span>
      </div>
      <p class="inv-mini-name" title="${esc(c.name || '')}">${esc(c.name || '')}</p>
      <span class="inv-badge">En espera</span>
    </div>`
}

function miniOrdered(c) {
  const unit = c.unit || 'kg'
  const ordered = Number(c.qty_ordered)
  const entered = Number(c.qty_entered)
  const pending = Number(c.qty_pending ?? c.pending_qty)
  const hasOrdered = Number.isFinite(ordered) && ordered > 0
  const enteredQty = Number.isFinite(entered) && entered > 0 ? entered : 0
  const falta = hasOrdered
    ? Math.max(0, ordered - enteredQty)
    : (Number.isFinite(pending) && pending > 0 ? pending : 0)
  const partial = hasOrdered && enteredQty > 0 && falta > 1e-4
  const pct = hasOrdered ? Math.min(100, Math.round((enteredQty / ordered) * 100)) : 0
  const price = fmtPrice(c.last_unit_price, c.last_unit_currency)
  const supplier = String(c.supplier || '').trim()
  const occ = String(c.occ_number || '').trim()
  const extraOcc = Number(c.occ_count) > 1 ? ` +${Number(c.occ_count) - 1}` : ''
  const occLabel = occ ? `${occ}${extraOcc}` : ''

  let qtyBlock = ''
  if (hasOrdered) {
    qtyBlock = `
      <p class="inv-mini-main">${fmtQty(enteredQty)} / ${fmtQty(ordered)} ${esc(unit)}</p>
      <div class="inv-mini-fill" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${pct}%"></span>
      </div>
      <p class="inv-mini-sub">${falta > 0 ? `faltan ${fmtQty(falta)} ${esc(unit)}` : 'Entrega completa'}</p>`
  } else if (falta > 0) {
    qtyBlock = `<p class="inv-mini-main">${fmtQty(falta)} ${esc(unit)}</p>`
  }

  return `
    <div class="inv-mini is-ordered${partial ? ' is-partial' : ''}">
      ${occLabel ? `<p class="inv-mini-occ" title="${esc(occLabel)}">${esc(occLabel)}</p>` : ''}
      ${partial ? '<span class="inv-badge is-partial">Parcial</span>' : ''}
      <div class="inv-mini-top">
        <span class="inv-mini-ico is-accent">${ICON.flask}</span>
        <span class="inv-mini-code">${esc(c.code || '')}</span>
      </div>
      <p class="inv-mini-name" title="${esc(c.name || '')}">${esc(c.name || '')}</p>
      ${qtyBlock}
      ${supplier ? `<a class="inv-supplier" href="#" data-goto-chemicals="${esc(supplier)}">${esc(supplier)}</a>` : ''}
      ${price ? `<p class="inv-mini-sub">${esc(price)}</p>` : ''}
    </div>`
}

function bindStockClicks(container) {
  container.removeEventListener('click', onStockClick)
  container.addEventListener('click', onStockClick)
}

function onStockClick(event) {
  const typeBtn = event.target.closest('[data-inv-type]')
  if (typeBtn) {
    event.preventDefault()
    generalType = typeBtn.dataset.invType || ''
    paintTypeFilters()
    applyGeneralFilter()
    return
  }
  const pagerBtn = event.target.closest('.inv-pager-btn')
  if (pagerBtn) {
    event.preventDefault()
    if (pagerBtn.disabled) return
    const nav = pagerBtn.closest('[data-pager]')
    if (!nav) return
    const key = nav.dataset.pager
    pages[key] = (pages[key] || 1) + Number(pagerBtn.dataset.dir)
    paintKey(key)
    return
  }
  const el = event.target.closest('[data-goto-chemicals]')
  if (!el) return
  event.preventDefault()
}

async function loadMovements() {
  const container = document.getElementById('movements-list')
  if (!container) return
  try {
    const data = await stock.movements({ limit: 500 })
    cache.movements = data
    pages.movements = 1
    paintMovements()
  } catch (err) {
    container.innerHTML = `<p class="inv-empty">${esc(err.message)}</p>`
  }
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

function fmtQty(n, fractionDigits) {
  if (n == null || n === '') return ''
  const digits = fractionDigits == null ? undefined : fractionDigits
  return Number(n).toLocaleString('es-CO', {
    minimumFractionDigits: digits ?? 0,
    maximumFractionDigits: digits ?? 2,
  })
}

function fmtPrice(n, currency) {
  const amount = Number(n)
  if (!Number.isFinite(amount) || amount <= 0) return ''
  const formatted = amount.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return (currency || 'COP') === 'COP' ? `$${formatted}` : `${formatted} ${currency}`
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
