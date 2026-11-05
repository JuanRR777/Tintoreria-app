import { chemicals as api, stock } from '../api.js'
import { toast }      from '../components/toast.js'
import { showError, showLoading, showSuccess, showWarning } from '../components/swal.js'
import { openModal, closeModal, confirm } from '../components/modal.js'
import { setPageHeader } from '../layout.js'

const TYPE_LABELS = {
  acido:'Acido', reactivo:'Reactivo', directo:'Directo', auxiliar:'Auxiliar',
  mordiente:'Mordiente', disperso:'Disperso', vat:'Vat',
  blanqueador:'Blanqueador', otros:'Otros',
}

const PROCUREMENT = {
  espera:      ['badge-amber', 'En espera'],
  pedido:      ['badge-blue',  'Pedido'],
  disponible:  ['badge-green', 'Disponible'],
}

const LOT_STATUS = {
  active: 'Activo',
  depleted: 'Agotado',
  expired: 'Vencido',
}

const MOVE_TYPE = {
  in: 'Entrada',
  out: 'Salida',
  adjustment: 'Ajuste',
  waste: 'Merma',
  return: 'Devolución',
}

const ICO = {
  flask: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"/><path d="M10 9h4"/><path d="M9 3v7l-5.5 9.5A1.65 1.65 0 0 0 5.9 22h12.2a1.65 1.65 0 0 0 1.4-2.5L15 10V3"/></svg>`,
  lots: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5"/><path d="M12 22V12"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`,
}

const CHEM_PAGE_SIZE = 10

let reloadList = async () => {}
let chemPage = 1

export async function showView(container, params = {}) {
  setPageHeader({
    title: 'Quimicos',
    subtitle: 'Inventario de materias primas y auxiliares',
    actionsHtml: `
      <input type="file" id="file-inv" accept=".csv,text/csv" hidden>
      <button class="btn btn-secondary" id="btn-import-inv">Cargar inventario</button>
      <button class="btn btn-primary" id="btn-new-chemical">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nuevo quimico
      </button>`,
  })
  container.innerHTML = `
    <div class="chem-summary" id="chem-summary"></div>

    <div class="toolbar">
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="search-chemicals" placeholder="Buscar por nombre, codigo, lote o proveedor...">
      </div>
      <select class="form-select" id="filter-type" style="width:180px">
        <option value="">Todos los tipos</option>
        ${Object.entries(TYPE_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
      <select class="form-select" id="filter-procurement" style="width:180px">
        <option value="">Todos los estados</option>
        <option value="espera">En espera (SOC)</option>
        <option value="pedido">Pedido (OCC)</option>
        <option value="disponible">Disponible</option>
      </select>
      <label class="chem-check">
        <input type="checkbox" id="filter-low-stock"> Stock bajo
      </label>
    </div>

    <div id="chemicals-list"></div>
  `

  document.getElementById('btn-new-chemical').onclick = () => openChemicalForm(null, reload)
  const fileInv = document.getElementById('file-inv')
  document.getElementById('btn-import-inv').onclick = () => fileInv.click()
  fileInv.onchange = () => importInventoryCsv(fileInv, reload)

  const search   = document.getElementById('search-chemicals')
  if (params.search) search.value = params.search
  const typeFilter = document.getElementById('filter-type')
  const procFilter = document.getElementById('filter-procurement')
  const lowStockF  = document.getElementById('filter-low-stock')

  let debounce
  const onFilter = () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => reload({ resetPage: true }), 300)
  }
  search.oninput   = onFilter
  typeFilter.onchange = onFilter
  procFilter.onchange = onFilter
  lowStockF.onchange  = onFilter

  document.getElementById('chem-summary').onclick = (event) => {
    const btn = event.target.closest('[data-sum]')
    if (!btn) return
    const key = btn.dataset.sum
    if (key === 'all') {
      procFilter.value = ''
      lowStockF.checked = false
    } else if (key === 'low') {
      procFilter.value = ''
      lowStockF.checked = true
    } else {
      procFilter.value = key
      lowStockF.checked = false
    }
    reload({ resetPage: true })
  }

  async function reload(opts = {}) {
    if (opts.resetPage) chemPage = 1
    const query = {
      search:        search.value || undefined,
      chemical_type: typeFilter.value || undefined,
      procurement_status: procFilter.value || undefined,
      low_stock:     lowStockF.checked ? true : undefined,
    }
    await loadChemicals(query, {
      proc: procFilter.value,
      low: lowStockF.checked,
      reload,
    })
  }

  reloadList = reload
  await reload()
}

async function loadChemicals(params = {}, ctx = {}) {
  const list = document.getElementById('chemicals-list')
  if (!list) return
  list.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div>'

  try {
    const [data, summary] = await Promise.all([
      api.list(params),
      stock.summary().catch(() => ({})),
    ])
    renderSummary(summary, ctx)
    renderChemicalTable(data, list, ctx.reload || reloadList)
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`
  }
}

function renderSummary(s, ctx = {}) {
  const el = document.getElementById('chem-summary')
  if (!el) return
  const total = s.chemicals_total ?? s.total_chemicals ?? 0
  const wait = s.waiting_count ?? 0
  const ordered = s.ordered_count ?? 0
  const low = s.low_stock_count ?? 0
  const available = Math.max(0, total - wait - ordered)
  const active = ctx.low ? 'low' : (ctx.proc || 'all')

  el.innerHTML = `
    ${sumChip('all', 'Todos', total, active)}
    ${sumChip('disponible', 'Disponible', available, active)}
    ${sumChip('espera', 'En espera', wait, active)}
    ${sumChip('pedido', 'Pedido', ordered, active)}
    ${sumChip('low', 'Stock bajo', low, active)}
  `
}

function sumChip(key, label, count, active) {
  return `
    <button type="button" class="chem-sum is-${key} ${active === key ? 'is-active' : ''}" data-sum="${key}">
      <span>${label}</span>
      <strong>${count}</strong>
    </button>`
}

function paginateChemicals(items) {
  const ordered = groupChemicalsByType(items).flatMap((group) => group.items)
  const total = ordered.length
  const totalPages = Math.max(1, Math.ceil(total / CHEM_PAGE_SIZE) || 1)
  if (chemPage > totalPages) chemPage = totalPages
  if (chemPage < 1) chemPage = 1
  const start = (chemPage - 1) * CHEM_PAGE_SIZE
  const pageItems = ordered.slice(start, start + CHEM_PAGE_SIZE)
  return {
    groups: groupChemicalsByType(pageItems),
    total,
    totalPages,
    page: chemPage,
    from: total ? start + 1 : 0,
    to: start + pageItems.length,
  }
}

function chemPageList(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const set = new Set([1, totalPages, page, page - 1, page + 1])
  if (page <= 3) [2, 3, 4].forEach((n) => set.add(n))
  if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((n) => set.add(n))
  return [...set].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b)
}

function chemPagerMarkup(page, totalPages) {
  if (totalPages <= 1) return ''
  const nums = chemPageList(page, totalPages)
  let html = `
    <nav class="chem-pager" aria-label="Paginación">
      <button type="button" class="chem-pager-btn" data-chem-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Anterior">‹</button>`
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) html += '<span class="chem-pager-ellipsis">…</span>'
    html += n === page
      ? `<button type="button" class="chem-pager-btn is-current" disabled aria-current="page">${n}</button>`
      : `<button type="button" class="chem-pager-btn" data-chem-page="${n}">${n}</button>`
  })
  html += `
      <button type="button" class="chem-pager-btn" data-chem-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} aria-label="Siguiente">›</button>
    </nav>`
  return html
}

function chemTableBar(paged, position) {
  const pager = chemPagerMarkup(paged.page, paged.totalPages)
  const meta = paged.totalPages > 1
    ? `${paged.from}–${paged.to} de ${paged.total}`
    : `${paged.total} químico${paged.total === 1 ? '' : 's'}`
  if (position === 'bottom' && !pager) return ''
  return `
    <div class="chem-table-bar${position === 'bottom' ? ' is-bottom' : ''}">
      <div class="chem-table-meta">${meta}</div>
      ${pager}
    </div>`
}

function renderChemicalTable(items, container, reload) {
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3v11l-3 3h12l-3-3V3"/><path d="M6 3h12"/></svg>
        <h3>Sin resultados</h3>
        <p>No se encontraron quimicos con los filtros aplicados.</p>
      </div>`
    return
  }

  const paged = paginateChemicals(items)
  const body = paged.groups.map((group) => `
    <tr class="chem-group-row">
      <td colspan="9">
        <span class="chem-group-label">${esc(group.label)}</span>
        <span class="chem-group-count">${group.items.length}</span>
      </td>
    </tr>
    ${group.items.map((c) => chemicalRow(c)).join('')}
  `).join('')

  container.innerHTML = `
    ${chemTableBar(paged, 'top')}
    <div class="table-wrapper chem-wrap">
      <table class="data-table chem-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Lote</th>
            <th>Tipo</th>
            <th>Stock actual</th>
            <th>Pedido</th>
            <th>Valor unitario</th>
            <th>Proveedor</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${body}
        </tbody>
      </table>
    </div>
    ${chemTableBar(paged, 'bottom')}
  `

  const runReload = reload || reloadList
  container.querySelectorAll('[data-edit]').forEach(btn =>
    btn.onclick = () => openChemicalForm(parseInt(btn.dataset.edit), runReload)
  )
  container.querySelectorAll('[data-lots]').forEach(btn =>
    btn.onclick = () => openLotsModal(parseInt(btn.dataset.lots))
  )
  container.querySelectorAll('[data-delete]').forEach(btn =>
    btn.onclick = () => deleteChemical(parseInt(btn.dataset.delete))
  )
  container.querySelectorAll('[data-chem-page]').forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return
      const next = Number(btn.dataset.chemPage)
      if (!Number.isFinite(next) || next < 1) return
      chemPage = next
      renderChemicalTable(items, container, runReload)
      container.querySelector('.chem-table-bar')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  })
}

function groupChemicalsByType(items) {
  const groups = new Map()
  for (const c of items) {
    const key = c.chemical_type || 'otros'
    const label = TYPE_LABELS[key] || c.chemical_type || 'Otros'
    if (!groups.has(key)) groups.set(key, { key, label, items: [] })
    groups.get(key).items.push(c)
  }

  const list = [...groups.values()]
  list.sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }))
  for (const group of list) {
    group.items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es', { sensitivity: 'base' }))
  }
  return list
}

function chemicalRow(c) {
  const stockQty = Number(c.stock_quantity || 0)
  const min = Number(c.min_stock_alert || 0)
  const isLow = stockQty <= min
  const pending = Number(c.pending_qty || 0)
  const kind = c.procurement_status === 'espera' || c.procurement_status === 'pedido' ? c.procurement_status : 'disponible'
  const isPartial = kind === 'disponible' && pending > 0
  const [procCls, procLabel] = isPartial
    ? ['badge-amber', 'Parcial']
    : (PROCUREMENT[c.procurement_status] || ['badge-gray', c.procurement_status || '—'])
  const typeLabel = TYPE_LABELS[c.chemical_type] || c.chemical_type || '—'
  const fill = min > 0 ? Math.min(100, Math.round((stockQty / min) * 100)) : (stockQty > 0 ? 100 : 0)
  const location = String(c.location || '').trim()

  const lotNumber = String(c.current_lot_number || '').trim()
  const extraLots = Math.max(0, Number(c.active_lot_count || 0) - (lotNumber ? 1 : 0))
  const supplier = c.current_lot_supplier || c.supplier

  return `
    <tr class="is-${esc(kind)} ${isLow ? 'is-low' : ''}">
      <td>
        <div class="chem-product">
          <span class="chem-art is-${esc(kind)}">${ICO.flask}</span>
          <div class="chem-product-copy">
            <strong title="${esc(c.name)}">${esc(c.name)}</strong>
            <div class="chem-product-meta">
              <code>${esc(c.code || '—')}</code>
              ${c.is_hazardous ? '<span class="badge badge-amber">Peligroso</span>' : ''}
              ${location ? `<span class="chem-loc">${esc(location)}</span>` : ''}
            </div>
          </div>
        </div>
      </td>
      <td>${lotNumber
        ? `<button type="button" class="chem-lot" data-lots="${c.id}" title="Ver historial de lotes">
             <code>${esc(lotNumber)}</code>
             ${extraLots ? `<span class="chem-lot-more">+${extraLots}</span>` : ''}
           </button>`
        : '<span class="chem-lot is-empty">—</span>'}</td>
      <td><span class="chem-type">${esc(typeLabel)}</span></td>
      <td>
        <div class="chem-stock ${isLow ? 'is-low' : ''}">
          <strong>${fmtQty(stockQty, 2)} ${esc(c.unit || 'kg')}</strong>
          ${min > 0 ? `<span>mín. ${fmtQty(min, 2)} ${esc(c.unit || 'kg')}</span>` : ''}
          <div class="chem-stock-bar" aria-hidden="true"><span style="width:${fill}%"></span></div>
        </div>
      </td>
      <td class="chem-num ${pending ? 'has-pending' : ''}">${pending ? `${fmtQty(pending)} ${esc(c.unit || 'kg')}` : '—'}</td>
      <td class="chem-num">${fmtPrice(c.last_unit_price, c.last_unit_currency) || '—'}</td>
      <td class="chem-supplier">${esc(supplier || '—')}</td>
      <td>${isPartial
        ? `<span class="badge badge-green">Disponible</span> <span class="badge badge-amber">Parcial</span>`
        : `<span class="badge ${procCls}">${esc(procLabel)}</span>`}</td>
      <td>
        <div class="actions-cell">
          <button class="chem-icon-btn is-lots" data-lots="${c.id}" title="Historial de lotes">${ICO.lots}</button>
          <button class="chem-icon-btn is-edit" data-edit="${c.id}" title="Editar">${ICO.edit}</button>
          <button class="chem-icon-btn is-danger" data-delete="${c.id}" title="Eliminar">${ICO.trash}</button>
        </div>
      </td>
    </tr>
  `
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

// ---------------------------------------------------------------------------
// Formulario quimico
// ---------------------------------------------------------------------------

export function openChemicalForm(chemicalId, onSuccess, { prefill = null } = {}) {
  const isEdit = chemicalId !== null

  const formHTML = `
    <form id="chemical-form">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Nombre <span class="required"></span></label>
          <input id="cf-name" class="form-input" placeholder="Nombre del quimico" required>
        </div>
        <div class="form-group">
          <label class="form-label">Codigo</label>
          <input id="cf-code" class="form-input" placeholder="Se genera automaticamente">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Tipo <span class="required"></span></label>
          <select id="cf-type" class="form-select" required>
            <option value="">Seleccionar tipo</option>
            ${Object.entries(TYPE_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Unidad</label>
          <select id="cf-unit" class="form-select">
            <option value="kg">kg</option>
            <option value="g">g</option>
            <option value="L">L</option>
            <option value="mL">mL</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Stock minimo (alerta)</label>
          <input id="cf-min-stock" class="form-input" type="number" min="0" step="0.01" value="0">
        </div>
        <div class="form-group">
          <label class="form-label">Densidad (g/mL, solo liquidos)</label>
          <input id="cf-density" class="form-input" type="number" min="0" step="0.001" placeholder="Opcional">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Proveedor</label>
          <input id="cf-supplier" class="form-input" placeholder="Proveedor">
        </div>
        <div class="form-group">
          <label class="form-label">Ubicacion (estante/area)</label>
          <input id="cf-location" class="form-input" placeholder="Ej: Estante A-3">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Numero CAS</label>
          <input id="cf-cas" class="form-input" placeholder="Opcional">
        </div>
        <div class="form-group" style="display:flex;align-items:flex-end;gap:8px;padding-bottom:4px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="cf-hazardous"> Material peligroso
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notas de seguridad</label>
        <textarea id="cf-safety" class="form-textarea" placeholder="Instrucciones de manejo, EPP requerido, etc."></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Notas generales</label>
        <textarea id="cf-notes" class="form-textarea" placeholder="Notas adicionales"></textarea>
      </div>
      <div id="cf-error" class="form-error" style="display:none"></div>
    </form>
  `

  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
    <button class="btn btn-primary" id="cf-submit">${isEdit ? 'Guardar cambios' : 'Crear quimico'}</button>
  `

  openModal(isEdit ? 'Editar químico' : 'Nuevo químico', formHTML, { footerHTML: footer, drawer: true })

  const fill = (c) => {
      document.getElementById('cf-name').value     = c.name || ''
      document.getElementById('cf-code').value     = c.code || ''
      document.getElementById('cf-type').value     = c.chemical_type || ''
      document.getElementById('cf-unit').value     = c.unit || 'kg'
      document.getElementById('cf-min-stock').value = c.min_stock_alert ?? 0
      document.getElementById('cf-density').value  = c.density_g_ml || ''
      document.getElementById('cf-supplier').value = c.supplier || ''
      document.getElementById('cf-location').value = c.location || ''
      document.getElementById('cf-cas').value      = c.cas_number || ''
      document.getElementById('cf-hazardous').checked = !!c.is_hazardous
      document.getElementById('cf-safety').value  = c.safety_notes || ''
      document.getElementById('cf-notes').value   = c.notes || ''
  }
  if (isEdit) api.get(chemicalId).then(fill)
  else if (prefill) fill(prefill)

  document.getElementById('cf-submit').onclick = async () => {
    const errEl  = document.getElementById('cf-error')
    const submitBtn = document.getElementById('cf-submit')
    const name   = document.getElementById('cf-name').value.trim()
    const type   = document.getElementById('cf-type').value

    if (!name || !type) {
      errEl.textContent = 'Nombre y tipo son obligatorios'
      errEl.style.display = 'block'
      return
    }

    const payload = {
      name,
      code:          document.getElementById('cf-code').value.trim() || undefined,
      chemical_type: type,
      unit:          document.getElementById('cf-unit').value,
      min_stock_alert: parseFloat(document.getElementById('cf-min-stock').value) || 0,
      density_g_ml:  parseFloat(document.getElementById('cf-density').value) || undefined,
      supplier:      document.getElementById('cf-supplier').value.trim() || undefined,
      location:      document.getElementById('cf-location').value.trim() || undefined,
      cas_number:    document.getElementById('cf-cas').value.trim() || undefined,
      is_hazardous:  document.getElementById('cf-hazardous').checked ? 1 : 0,
      safety_notes:  document.getElementById('cf-safety').value.trim() || undefined,
      notes:         document.getElementById('cf-notes').value.trim() || undefined,
    }

    submitBtn.disabled = true
    submitBtn.textContent = 'Guardando...'
    errEl.style.display = 'none'

    try {
      if (isEdit) {
        await api.update(chemicalId, payload)
        toast.success('Quimico actualizado')
      } else {
        await api.create(payload)
        toast.success('Quimico creado correctamente')
      }
      closeModal()
      if (onSuccess) onSuccess()
    } catch (err) {
      errEl.textContent   = err.message
      errEl.style.display = 'block'
      submitBtn.disabled  = false
      submitBtn.textContent = isEdit ? 'Guardar cambios' : 'Crear quimico'
    }
  }
}

// ---------------------------------------------------------------------------
// Modal de lotes
// ---------------------------------------------------------------------------

function toDateInput(value) {
  if (!value) return ''
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  return ''
}

function fmtDay(value) {
  const iso = toDateInput(value)
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function fmtWhen(value) {
  if (!value) return '—'
  const text = String(value).replace('T', ' ').trim()
  const day = fmtDay(text)
  const time = text.slice(11, 16)
  return time ? `${day} ${time}` : day
}

function fmtMoveNote(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.replace(/\bOCC\s+(OCC-)/i, '$1')
}

function fillLotForm(lot, chem) {
  const unit = lot?.unit || chem.unit || 'kg'
  document.getElementById('lot-number').value = lot?.lot_number || ''
  document.getElementById('lot-qty').value = lot ? Number(lot.quantity_received || 0) : ''
  document.getElementById('lot-qty').placeholder = unit
  document.getElementById('lot-purchase').value = toDateInput(lot?.purchase_date)
  document.getElementById('lot-expiry').value = toDateInput(lot?.expiry_date)
  const cost = Number(lot?.unit_cost || chem.last_unit_price || 0)
  document.getElementById('lot-cost').value = Number.isFinite(cost) ? cost : 0
  document.getElementById('lot-supplier').value = lot?.supplier || chem.supplier || ''
}

async function openLotsModal(chemicalId) {
  const chem = await api.get(chemicalId)
  const [lots, moves] = await Promise.all([
    api.lots(chemicalId),
    api.movements(chemicalId).catch(() => []),
  ])
  const preferred = lots.find((l) => !l.expiry_date && l.status === 'active') || lots.find((l) => l.status === 'active') || lots[0] || null

  const lotsHTML = lots.length
    ? `<div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Lote</th>
              <th>Proveedor</th>
              <th>Ingreso</th>
              <th>Recibido</th>
              <th>Restante</th>
              <th>Vencimiento</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${lots.map(l => `
              <tr class="lot-pick-row${preferred && preferred.id === l.id ? ' is-selected' : ''}" data-lot-id="${l.id}">
                <td><code class="chem-lot-code">${esc(l.lot_number)}</code></td>
                <td>${esc(l.supplier || chem.supplier || '—')}</td>
                <td>${fmtDay(l.purchase_date || l.created_at)}</td>
                <td>${l.quantity_received} ${esc(l.unit)}</td>
                <td style="font-weight:600">${Number(l.quantity_remaining).toFixed(2)} ${esc(l.unit)}</td>
                <td>${fmtDay(l.expiry_date)}</td>
                <td><span class="badge ${l.status === 'active' ? 'badge-green' : 'badge-gray'}">${esc(LOT_STATUS[l.status] || l.status)}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
       </div>`
    : '<div class="empty-state" style="padding:20px"><p>Sin lotes. El lote se crea al ingresar el producto por OCC.</p></div>'

  const movesHTML = moves.length
    ? `<div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Movimiento</th>
              <th>Lote</th>
              <th>Cantidad</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            ${moves.map((m) => {
              const kind = m.movement_type || ''
              const sign = kind === 'out' || kind === 'waste' ? '−' : kind === 'in' || kind === 'return' ? '+' : ''
              return `
                <tr>
                  <td>${fmtWhen(m.created_at)}</td>
                  <td><span class="chem-move-kind is-${esc(kind)}">${esc(MOVE_TYPE[kind] || kind || '—')}</span></td>
                  <td>${m.lot_number ? `<code class="chem-lot-code">${esc(m.lot_number)}</code>` : '—'}</td>
                  <td class="chem-num">${sign}${fmtQty(m.quantity, 2)} ${esc(m.unit || chem.unit || '')}</td>
                  <td class="chem-move-note">${esc(fmtMoveNote(m.notes) || m.user_name || '—')}</td>
                </tr>`
            }).join('')}
          </tbody>
        </table>
       </div>`
    : '<p class="chem-history-empty">Sin movimientos registrados.</p>'

  const addForm = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Numero de lote</label>
        <input id="lot-number" class="form-input" readonly>
      </div>
      <div class="form-group">
        <label class="form-label">Cantidad recibida</label>
        <input id="lot-qty" class="form-input" type="number" readonly>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha de compra</label>
        <input id="lot-purchase" class="form-input" type="date" readonly>
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de vencimiento <span class="required"></span></label>
        <input id="lot-expiry" class="form-input" type="date" ${lots.length ? '' : 'disabled'}>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Costo unitario</label>
        <input id="lot-cost" class="form-input" type="number" readonly>
      </div>
      <div class="form-group">
        <label class="form-label">Proveedor</label>
        <input id="lot-supplier" class="form-input" readonly>
      </div>
    </div>
    <div id="lot-error" class="form-error" style="display:none"></div>
  `

  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cerrar</button>
    <button class="btn btn-primary" id="lot-submit" ${lots.length ? '' : 'disabled'}>Guardar</button>
  `

  const bodyEl = openModal(`Lotes: ${chem.name}`, `
    <div class="lot-tabs" role="tablist">
      <button type="button" class="lot-tab is-active" data-lot-tab="detalle" role="tab">Detalle</button>
      <button type="button" class="lot-tab" data-lot-tab="movimientos" role="tab">
        Movimientos <span class="lot-tab-count">${moves.length}</span>
      </button>
      <button type="button" class="lot-tab" data-lot-tab="historial" role="tab">
        Historial <span class="lot-tab-count">${lots.length}</span>
      </button>
    </div>
    <div class="lot-pane" data-lot-pane="detalle">${addForm}</div>
    <div class="lot-pane" data-lot-pane="movimientos" hidden>${movesHTML}</div>
    <div class="lot-pane" data-lot-pane="historial" hidden>${lotsHTML}</div>
  `, { size: 'lg', footerHTML: footer })
  let selectedId = preferred ? preferred.id : null
  fillLotForm(preferred, chem)

  const showLotTab = (name) => {
    bodyEl.querySelectorAll('[data-lot-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lotTab === name)
    })
    bodyEl.querySelectorAll('[data-lot-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.lotPane !== name
    })
    const submit = document.getElementById('lot-submit')
    if (submit) submit.hidden = name !== 'detalle'
  }

  bodyEl.querySelectorAll('[data-lot-tab]').forEach((btn) => {
    btn.onclick = () => showLotTab(btn.dataset.lotTab)
  })

  bodyEl.querySelectorAll('.lot-pick-row').forEach((row) => {
    row.onclick = () => {
      selectedId = Number(row.dataset.lotId)
      bodyEl.querySelectorAll('.lot-pick-row').forEach((el) => el.classList.toggle('is-selected', Number(el.dataset.lotId) === selectedId))
      const lot = lots.find((l) => l.id === selectedId)
      fillLotForm(lot, chem)
      showLotTab('detalle')
    }
  })

  document.getElementById('lot-submit').onclick = async () => {
    const errEl = document.getElementById('lot-error')
    const expiry = document.getElementById('lot-expiry').value
    if (!selectedId) {
      errEl.textContent = 'No hay lote de OCC para este producto'
      errEl.style.display = 'block'
      return
    }
    if (!expiry) {
      errEl.textContent = 'Indica la fecha de vencimiento'
      errEl.style.display = 'block'
      return
    }

    try {
      await api.updateLot(chemicalId, selectedId, { expiry_date: expiry })
      toast.success('Lote actualizado')
      reloadList()
      await openLotsModal(chemicalId)
    } catch (err) {
      errEl.textContent = err.message
      errEl.style.display = 'block'
    }
  }
}

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

async function deleteChemical(id) {
  const ok = await confirm('Esta accion eliminara el quimico del sistema. ¿Continuar?', 'Eliminar quimico')
  if (!ok) return
  try {
    await api.delete(id)
    toast.success('Quimico eliminado')
    await reloadList()
  } catch (err) {
    toast.error(err.message)
  }
}

export async function importInventoryCsv(input, onDone) {
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const btn = document.getElementById('btn-import-inv')
  if (btn) btn.disabled = true
  showLoading({
    title: 'Cargando inventario',
    text: `Procesando ${file.name}. Item, nombre y kilos de bodega.`,
  })
  try {
    const result = await stock.importInv(file)
    if (onDone) await onDone({ resetPage: true })
    const catalog = result.catalog || {}
    const lines = [
      `${result.imported ?? 0} lineas del informe`,
      `${catalog.created || 0} quimicos nuevos, ${catalog.updated || 0} actualizados`,
      `${catalog.lots || 0} lotes · ${catalog.kg || 0} kg`,
      result.skipped ? `${result.skipped} lineas omitidas` : '',
      result.other_warehouse ? `${result.other_warehouse} de otra bodega` : '',
    ].filter(Boolean)
    const errorLines = (result.errors || []).slice(0, 3)
    const html = `
      <p style="margin:0 0 10px;font-size:14px;color:#475569">Archivo <strong>${esc(file.name)}</strong></p>
      <ul style="margin:0;padding-left:18px;text-align:left;font-size:13px;color:#334155;line-height:1.6">
        ${lines.map((line) => `<li>${esc(line)}</li>`).join('')}
        ${errorLines.map((line) => `<li>${esc(line)}</li>`).join('')}
      </ul>
      <p style="margin:10px 0 0;font-size:12px;color:#64748b">El precio queda en 0 hasta que entre por SOC.</p>`
    if ((result.imported || 0) > 0 && !errorLines.length) {
      await showSuccess({ title: 'Inventario cargado', html })
    } else if ((result.imported || 0) > 0) {
      await showWarning({ title: 'Inventario cargado con avisos', html })
    } else {
      await showWarning({ title: 'Sin lineas de inventario', html })
    }
  } catch (err) {
    await showError({
      title: 'No se pudo cargar el inventario',
      text: err.message || 'Ocurrio un error inesperado.',
    })
  } finally {
    if (btn) btn.disabled = false
  }
}
