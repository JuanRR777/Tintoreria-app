import { chemicals as api, stock } from '../api.js'
import { toast }      from '../components/toast.js'
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

const ICO = {
  flask: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"/><path d="M10 9h4"/><path d="M9 3v7l-5.5 9.5A1.65 1.65 0 0 0 5.9 22h12.2a1.65 1.65 0 0 0 1.4-2.5L15 10V3"/></svg>`,
  lots: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7L12 12l8.7-5"/><path d="M12 22V12"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`,
}

let reloadList = async () => {}

export async function showView(container, params = {}) {
  setPageHeader({
    title: 'Quimicos',
    subtitle: 'Inventario de materias primas y auxiliares',
    actionsHtml: `
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
        <input type="text" id="search-chemicals" placeholder="Buscar por nombre, codigo o proveedor...">
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

  const search   = document.getElementById('search-chemicals')
  if (params.search) search.value = params.search
  const typeFilter = document.getElementById('filter-type')
  const procFilter = document.getElementById('filter-procurement')
  const lowStockF  = document.getElementById('filter-low-stock')

  let debounce
  const onFilter = () => {
    clearTimeout(debounce)
    debounce = setTimeout(reload, 300)
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
    reload()
  }

  async function reload() {
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

  container.innerHTML = `
    <div class="chem-table-meta">${items.length} químico${items.length === 1 ? '' : 's'}</div>
    <div class="table-wrapper chem-wrap">
      <table class="data-table chem-table">
        <thead>
          <tr>
            <th>Producto</th>
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
          ${items.map(c => chemicalRow(c)).join('')}
        </tbody>
      </table>
    </div>
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
      <td class="chem-supplier">${esc(c.supplier || '—')}</td>
      <td>${isPartial
        ? `<span class="badge badge-green">Disponible</span> <span class="badge badge-amber">Parcial</span>`
        : `<span class="badge ${procCls}">${esc(procLabel)}</span>`}</td>
      <td>
        <div class="actions-cell">
          <button class="chem-icon-btn" data-lots="${c.id}" title="Ver lotes y stock">${ICO.lots}</button>
          <button class="chem-icon-btn" data-edit="${c.id}" title="Editar">${ICO.edit}</button>
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

function openChemicalForm(chemicalId, onSuccess) {
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

  openModal(isEdit ? 'Editar quimico' : 'Nuevo quimico', formHTML, { footerHTML: footer })

  if (isEdit) {
    api.get(chemicalId).then(c => {
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
    })
  }

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

async function openLotsModal(chemicalId) {
  const chem = await api.get(chemicalId)
  const lots = await api.lots(chemicalId)

  const lotsHTML = lots.length
    ? `<div class="table-wrapper" style="margin-bottom:16px">
        <table class="data-table">
          <thead><tr><th>Lote</th><th>Recibido</th><th>Restante</th><th>Vencimiento</th><th>Estado</th></tr></thead>
          <tbody>
            ${lots.map(l => `
              <tr>
                <td>${l.lot_number}</td>
                <td>${l.quantity_received} ${l.unit}</td>
                <td style="font-weight:600">${Number(l.quantity_remaining).toFixed(2)} ${l.unit}</td>
                <td>${l.expiry_date ? l.expiry_date.split('T')[0] : '-'}</td>
                <td><span class="badge ${l.status === 'active' ? 'badge-green' : 'badge-gray'}">${l.status}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
       </div>`
    : '<div class="empty-state" style="padding:20px"><p>Sin lotes registrados</p></div>'

  const addForm = `
    <div class="separator"></div>
    <h4 style="margin:0 0 12px;font-size:13px;font-weight:600">Agregar lote de entrada</h4>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Numero de lote <span class="required"></span></label>
        <input id="lot-number" class="form-input" placeholder="Ej: LOT-2026-001">
      </div>
      <div class="form-group">
        <label class="form-label">Cantidad recibida <span class="required"></span></label>
        <input id="lot-qty" class="form-input" type="number" min="0.001" step="0.001" placeholder="0.000">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Fecha de compra</label>
        <input id="lot-purchase" class="form-input" type="date">
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de vencimiento</label>
        <input id="lot-expiry" class="form-input" type="date">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Costo unitario</label>
        <input id="lot-cost" class="form-input" type="number" min="0" step="0.01" value="0">
      </div>
      <div class="form-group">
        <label class="form-label">Proveedor</label>
        <input id="lot-supplier" class="form-input" placeholder="Proveedor del lote">
      </div>
    </div>
    <div id="lot-error" class="form-error" style="display:none"></div>
  `

  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cerrar</button>
    <button class="btn btn-primary" id="lot-submit">Agregar lote</button>
  `

  openModal(`Lotes: ${chem.name}`, lotsHTML + addForm, { size: 'lg', footerHTML: footer })

  document.getElementById('lot-submit').onclick = async () => {
    const errEl  = document.getElementById('lot-error')
    const lotNum = document.getElementById('lot-number').value.trim()
    const qty    = parseFloat(document.getElementById('lot-qty').value)

    if (!lotNum || !qty || qty <= 0) {
      errEl.textContent   = 'Numero de lote y cantidad son obligatorios'
      errEl.style.display = 'block'
      return
    }

    try {
      await api.addLot(chemicalId, {
        lot_number:      lotNum,
        quantity_received: qty,
        unit:            chem.unit,
        purchase_date:   document.getElementById('lot-purchase').value || undefined,
        expiry_date:     document.getElementById('lot-expiry').value   || undefined,
        unit_cost:       parseFloat(document.getElementById('lot-cost').value) || 0,
        supplier:        document.getElementById('lot-supplier').value.trim() || undefined,
      })
      toast.success(`Lote ${lotNum} agregado. Stock actualizado.`)
      closeModal()
    } catch (err) {
      errEl.textContent   = err.message
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
