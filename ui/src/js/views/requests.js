import { requests as api, peekCache } from '../api.js'
import { showError, showLoading, showSuccess, showWarning } from '../components/swal.js'
import { setPageHeader } from '../layout.js'

const WAREHOUSE = '10502'
const ITEMS_PER_PAGE = 3

const ICON_CHECK = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>`
const ICON_CHEVRON = `<svg class="req-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`

export async function showView(container) {
  setPageHeader({
    title: 'Solicitudes',
    subtitle: `Trazabilidad de compras de tintoreria · bodega ${WAREHOUSE}`,
    actionsHtml: `
      <input type="file" id="file-soc" accept=".csv,text/csv" hidden>
      <input type="file" id="file-occ" accept=".csv,text/csv" hidden>
      <button class="btn btn-secondary" id="btn-import-soc">Importar SOC</button>
      <button class="btn btn-secondary" id="btn-import-occ">Importar OCC</button>
      <button class="btn btn-secondary" id="btn-sync-catalog">Actualizar inventario</button>`,
  })
  container.innerHTML = `
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Solicitudes SOC</div>
          <div class="stat-value" id="kpi-soc">0</div>
          <div class="stat-desc">Documentos / lineas</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Ordenes OCC</div>
          <div class="stat-value" id="kpi-occ">0</div>
          <div class="stat-desc">Documentos / lineas</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Aprobacion SOC</div>
          <div class="stat-value" id="kpi-t-soc">—</div>
          <div class="stat-desc">Creacion → aprobacion de la solicitud</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Paso a compra</div>
          <div class="stat-value" id="kpi-t-link">—</div>
          <div class="stat-desc">SOC aprobada → OCC creada</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Aprobacion OCC</div>
          <div class="stat-value" id="kpi-t-occ">—</div>
          <div class="stat-desc">Creacion → se aprobo comprar</div>
        </div>
      </div>
    </div>

    <div class="toolbar">
      <div class="request-filters" id="request-filters">
        <button class="chip is-active" data-filter="all">Todas</button>
        <button class="chip" data-filter="espera">En espera</button>
        <button class="chip" data-filter="pedido">Pedido</button>
        <button class="chip" data-filter="cumplido">Cumplido</button>
      </div>
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="search-requests" placeholder="Buscar SOC, OCC, item, producto o proveedor...">
      </div>
      <span class="badge badge-blue">Bodega ${WAREHOUSE}</span>
    </div>

    <div id="requests-list"></div>
  `

  const fileSoc = document.getElementById('file-soc')
  const fileOcc = document.getElementById('file-occ')
  document.getElementById('btn-import-soc').onclick = () => fileSoc.click()
  document.getElementById('btn-import-occ').onclick = () => fileOcc.click()
  document.getElementById('btn-sync-catalog').onclick = () => runSyncCatalog()

  let filter = 'all'
  let cache = { soc: [], occ: [] }
  const openById = new Set()
  const pageById = new Map()
  const search = document.getElementById('search-requests')
  const chips = container.querySelectorAll('#request-filters [data-filter]')

  const paint = () => {
    chips.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.filter === filter))
    const query = (search.value || '').trim().toLowerCase()
    const groups = sortBySocNumber(
      groupRequests(cache.soc, cache.occ).filter((group) => {
        if (filter !== 'all' && group.stage !== filter) return false
        if (!query) return true
        return group.searchText.includes(query)
      }),
    )
    renderCards(groups, openById, pageById)
    bindToggles(openById, pageById, paint)
    bindPagers(groups, pageById, paint)
  }

  chips.forEach((btn) => {
    btn.onclick = () => {
      filter = btn.dataset.filter
      paint()
    }
  })

  let debounce
  search.oninput = () => {
    clearTimeout(debounce)
    debounce = setTimeout(paint, 200)
  }

  const runSyncCatalog = async () => {
    const buttons = [
      document.getElementById('btn-import-soc'),
      document.getElementById('btn-import-occ'),
      document.getElementById('btn-sync-catalog'),
    ]
    buttons.forEach((btn) => { if (btn) btn.disabled = true })
    showLoading({
      title: 'Actualizando inventario',
      text: 'Usando los SOC/OCC ya importados. No hace falta volver a cargar los CSV.',
    })
    try {
      const result = await api.syncCatalog()
      try {
        await loadData(cache, { fresh: true })
        paint()
      } catch { /* el catalogo ya se actualizo */ }
      const cat = result.catalog || {}
      await showSuccess({
        title: 'Inventario actualizado',
        html: `<p style="margin:0;font-size:14px;color:#475569">${cat.received || 0} entrada(s) aplicada(s) · ${cat.updated || 0} items actualizados · ${cat.created || 0} nuevos</p>`,
      })
    } catch (err) {
      await showError({
        title: 'No se pudo actualizar el inventario',
        text: err.message || 'Ocurrio un error inesperado.',
      })
    } finally {
      buttons.forEach((btn) => { if (btn) btn.disabled = false })
    }
  }

  const runImport = async (kind, input) => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    const label = kind.toUpperCase()
    const buttons = [
      document.getElementById('btn-import-soc'),
      document.getElementById('btn-import-occ'),
      document.getElementById('btn-sync-catalog'),
    ]
    buttons.forEach((btn) => { if (btn) btn.disabled = true })

    showLoading({
      title: `Importando ${label}`,
      text: `Procesando ${file.name}. Espera un momento, esto puede tardar.`,
    })

    try {
      const result = kind === 'soc' ? await api.importSoc(file) : await api.importOcc(file)
      try {
        await loadData(cache, { fresh: true })
        paint()
      } catch {
        /* el archivo ya se importo; el tablero se puede recargar despues */
      }

      const lines = [
        `${result.imported ?? 0} lineas de ${label}`,
        result.catalog ? `inventario: ${result.catalog.created || 0} nuevos, ${result.catalog.updated || 0} actualizados` : '',
        result.catalog?.received ? `${result.catalog.received} entrada(s) a inventario` : '',
        result.other_warehouse ? `${result.other_warehouse} de otra bodega omitidas` : '',
        result.skipped ? `${result.skipped} lineas omitidas` : '',
      ].filter(Boolean)
      const errorLines = (result.errors || []).slice(0, 3)
      const html = `
        <p style="margin:0 0 10px;font-size:14px;color:#475569">Archivo <strong>${esc(file.name)}</strong></p>
        <ul style="margin:0;padding-left:18px;text-align:left;font-size:13px;color:#334155;line-height:1.6">
          ${lines.map((line) => `<li>${esc(line)}</li>`).join('')}
          ${errorLines.map((line) => `<li>${esc(line)}</li>`).join('')}
        </ul>`

      if ((result.imported || 0) > 0 && !errorLines.length) {
        await showSuccess({ title: `${label} importado`, html })
      } else if ((result.imported || 0) > 0) {
        await showWarning({ title: `${label} importado con avisos`, html })
      } else {
        await showWarning({
          title: `Sin lineas de ${label}`,
          html,
        })
      }
    } catch (err) {
      await showError({
        title: `No se pudo importar ${label}`,
        text: err.message || 'Ocurrio un error inesperado.',
      })
    } finally {
      buttons.forEach((btn) => { if (btn) btn.disabled = false })
    }
  }

  fileSoc.onchange = () => runImport('soc', fileSoc)
  fileOcc.onchange = () => runImport('occ', fileOcc)

  await loadData(cache)
  paint()
}

async function loadData(cache, { fresh = false } = {}) {
  const list = document.getElementById('requests-list')
  const cached = !fresh ? peekCache('/requests/bundle') : null

  if (!cached && list) {
    list.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Cargando solicitudes...</span></div>'
  }

  try {
    const payload = cached || await api.bundle({ fresh })
    cache.soc = payload.soc || []
    cache.occ = payload.occ || []
    fillKpis(payload.summary || {})
  } catch (err) {
    if (list) {
      list.innerHTML = `<div class="empty-state"><h3>No se pudieron leer las solicitudes</h3><p>${esc(err.message)}</p><p>Aplica las migraciones 0002, 0003 y 0004 en D1 y reinicia la API.</p></div>`
    }
    toast.error(err.message)
  }
}

function fillKpis(s) {
  const socEl = document.getElementById('kpi-soc')
  const occEl = document.getElementById('kpi-occ')
  if (socEl) socEl.textContent = `${s.soc_documents ?? 0} / ${s.soc_lines ?? 0}`
  if (occEl) occEl.textContent = `${s.occ_documents ?? 0} / ${s.occ_lines ?? 0}`
  setKpi('kpi-t-soc', s.avg_soc_approval_min)
  setKpi('kpi-t-link', s.avg_soc_to_occ_min)
  setKpi('kpi-t-occ', s.avg_occ_approval_min)
}

function setKpi(id, minutes) {
  const el = document.getElementById(id)
  if (el) el.textContent = formatMinutes(minutes)
}

function groupRequests(socRows, occRows) {
  const groups = new Map()

  for (const row of socRows || []) {
    const key = row.soc_number || 'SIN-SOC'
    if (!groups.has(key)) {
      groups.set(key, { id: key, soc_number: row.soc_number, socLines: [], occLines: [] })
    }
    groups.get(key).socLines.push(row)
  }

  const orphans = []
  for (const row of occRows || []) {
    const key = row.soc_number
    if (key && groups.has(key)) {
      groups.get(key).occLines.push(row)
    } else {
      orphans.push(row)
    }
  }

  const occOrphans = new Map()
  for (const row of orphans) {
    const key = row.occ_number || `OCC-${orphans.indexOf(row)}`
    if (!occOrphans.has(key)) {
      occOrphans.set(key, { id: key, soc_number: row.soc_number || '', socLines: [], occLines: [] })
    }
    occOrphans.get(key).occLines.push(row)
  }

  return [...groups.values(), ...occOrphans.values()].map(enrichGroup)
}

function docNumber(group) {
  const raw = group.soc_number || group.occNumbers?.[0] || group.title || ''
  const digits = String(raw).replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

function sortBySocNumber(groups) {
  return [...groups].sort((a, b) => {
    const diff = docNumber(b) - docNumber(a)
    if (diff) return diff
    return String(a.title || '').localeCompare(String(b.title || ''), 'es', { sensitivity: 'base' })
  })
}

function enrichGroup(group) {
  const socLines = group.socLines
  const occLines = group.occLines
  const items = sortRequestItems(mergeItems(socLines, occLines))
  const occNumbers = unique(occLines.map((r) => r.occ_number).filter(Boolean))
  const suppliers = unique(occLines.map((r) => r.supplier).filter(Boolean))
  const requesters = unique(socLines.map((r) => r.requester).filter(Boolean))
  const qtyRequested = sum(socLines.map((r) => r.qty_requested))
  const qtyOrdered = sum(socLines.length ? socLines.map((r) => r.qty_ordered) : occLines.map((r) => r.qty_ordered))
  const qtyPending = sum(socLines.length ? socLines.map((r) => r.qty_pending) : occLines.map((r) => r.qty_pending))
  const netValue = sum(occLines.map((r) => r.net_value))
  const unit = (socLines[0] || occLines[0] || {}).unit || 'KG'
  const created = firstDate(socLines.map((r) => r.created_at).concat(occLines.map((r) => r.created_at)))
  const createdSoc = earliestValue(socLines.map((r) => r.created_at))
  const createdOcc = earliestValue(occLines.map((r) => r.created_at))
  const approvedSoc = earliestValue(socLines.map((r) => r.approved_at))
  const approvedOcc = earliestValue(occLines.map((r) => r.approved_at))
  const socApproved = Boolean(approvedSoc) || socLines.some((r) => /aprobad/i.test(String(r.status || '')))
  const socApprovalMin = minutesBetween(createdSoc, approvedSoc)
  const socToOccCreatedMin = minutesBetween(approvedSoc, createdOcc)
  const socToOccMin = minutesBetween(approvedSoc, approvedOcc)
  const qtyWithOcc = sum(items.map((item) => {
    if (!item.occ.length) return 0
    const occQty = sum(item.occ.map((row) => row.qty_ordered))
    return occQty > 0 ? occQty : Number(item.qtyRequested || item.qtyOrdered || 0)
  }))
  const qtyTotal = qtyRequested || sum(items.map((item) => item.qtyRequested || item.qtyOrdered))
  const progress = qtyTotal > 0 ? Math.min(100, Math.round((qtyWithOcc / qtyTotal) * 100)) : (occLines.length ? 100 : 0)

  let stage = 'espera'
  if (!socLines.length) stage = 'sin_soc'
  else if (progress >= 100) stage = 'cumplido'
  else if (progress > 0 || occLines.length) stage = 'pedido'
  const title = group.soc_number || occNumbers[0] || group.id
  const productHint = items[0]?.name || 'Sin producto'

  const searchText = [
    group.soc_number,
    ...occNumbers,
    ...items.map((i) => `${i.code} ${i.name}`),
    ...suppliers,
    ...requesters,
  ].join(' ').toLowerCase()

  return {
    ...group,
    title,
    stage,
    items,
    occNumbers,
    suppliers,
    requesters,
    qtyRequested,
    qtyOrdered,
    qtyWithOcc,
    qtyTotal,
    qtyPending,
    netValue,
    unit,
    created,
    createdSoc,
    createdOcc,
    approvedSoc,
    socApproved,
    approvedOcc,
    socApprovalMin,
    socToOccCreatedMin,
    socToOccMin,
    waitingItems: items.filter((item) => !item.occ.length).length,
    linkedItems: items.filter((item) => item.occ.length).length,
    progress,
    productHint,
    searchText,
  }
}

function mergeItems(socLines, occLines) {
  const map = new Map()

  const keyOf = (row) => `${row.item_code || ''}|${row.detail_ext_1 || ''}`

  for (const row of socLines) {
    const key = keyOf(row)
    map.set(key, {
      code: row.item_code,
      name: row.item_name,
      detail: row.detail_ext_1,
      unit: row.unit,
      qtyRequested: row.qty_requested,
      qtyOrdered: row.qty_ordered,
      qtyPending: row.qty_pending,
      socStatus: row.status,
      occ: [],
    })
  }

  for (const row of occLines) {
    const key = keyOf(row)
    if (!map.has(key)) {
      map.set(key, {
        code: row.item_code,
        name: row.item_name,
        detail: row.detail_ext_1,
        unit: row.unit,
        qtyRequested: 0,
        qtyOrdered: row.qty_ordered,
        qtyPending: row.qty_pending,
        socStatus: '',
        occ: [],
      })
    }
    map.get(key).occ.push(row)
    const item = map.get(key)
    if (!item.qtyOrdered && row.qty_ordered) item.qtyOrdered = row.qty_ordered
  }

  return [...map.values()]
}

function sortRequestItems(items) {
  const byName = (a, b) => String(a.name || a.code || '').localeCompare(String(b.name || b.code || ''), 'es', { sensitivity: 'base' })
  const waiting = items.filter((item) => !item.occ.length).sort(byName)
  const ordered = items.filter((item) => item.occ.length).sort(byName)
  return [...waiting, ...ordered]
}

function renderCards(groups, openById, pageById) {
  const list = document.getElementById('requests-list')
  if (!list) return

  if (!groups.length) {
    list.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <h3>Sin solicitudes</h3>
        <p>Importa el CSV SOC y luego el OCC (solo bodega ${WAREHOUSE}) para armar el tablero.</p>
      </div>`
    return
  }

  list.innerHTML = `
    <div class="req-section-head">
      <h3>Solicitudes <span>(${groups.length})</span></h3>
    </div>
    <div class="req-grid">
      ${groups.map((group) => requestCard(group, openById, pageById)).join('')}
    </div>`
}

function pageState(group, pageById) {
  const totalPages = Math.max(1, Math.ceil(group.items.length / ITEMS_PER_PAGE))
  let page = pageById.get(group.id) || 1
  if (page > totalPages) page = totalPages
  if (page < 1) page = 1
  pageById.set(group.id, page)
  const start = (page - 1) * ITEMS_PER_PAGE
  return { page, totalPages, start, slice: group.items.slice(start, start + ITEMS_PER_PAGE) }
}

function bindToggles(openById, pageById, paint) {
  document.querySelectorAll('[data-req-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.reqToggle
      if (openById.has(id)) openById.delete(id)
      else {
        openById.add(id)
        if (!pageById.has(id)) pageById.set(id, 1)
      }
      paint()
    }
  })
}

function bindPagers(groups, pageById, paint) {
  document.querySelectorAll('[data-req-dir]').forEach((btn) => {
    btn.onclick = () => {
      const group = groups.find((item) => item.id === btn.dataset.id)
      if (!group) return
      const { page, totalPages } = pageState(group, pageById)
      pageById.set(group.id, Math.min(totalPages, Math.max(1, page + Number(btn.dataset.reqDir))))
      paint()
    }
  })
}

function buildStepper(g) {
  const hasSoc = g.socLines.length > 0
  const hasApproved = hasSoc && Boolean(g.socApproved || g.approvedSoc)
  const hasOcc = g.occLines.length > 0
  const fulfilled = hasOcc && g.progress >= 100

  const steps = []
  if (hasSoc) {
    steps.push({
      key: 'soc',
      label: 'Solicitud',
      complete: true,
      tooltip: `Creada ${formatDate(g.createdSoc || g.created)}`,
    })
    steps.push({
      key: 'approved',
      label: 'Aprobada',
      complete: hasApproved,
      tooltip: hasApproved
        ? (g.socApprovalMin != null
          ? `Creación → aprobación ${formatMinutes(g.socApprovalMin)}`
          : 'SOC aprobada')
        : 'Pendiente de aprobación',
    })
  }

  steps.push({
    key: 'occ',
    label: 'OCC creada',
    complete: hasOcc,
    tooltip: hasOcc
      ? (hasSoc
        ? (g.socToOccCreatedMin != null
          ? `SOC aprobada → OCC creada ${formatMinutes(g.socToOccCreatedMin)}`
          : 'OCC asociada a la solicitud')
        : 'OCC sin solicitud previa')
      : 'En espera de OCC',
  })
  steps.push({
    key: 'done',
    label: 'Cumplido',
    complete: fulfilled,
    tooltip: fulfilled
      ? `Surtido 100% · SOC → OCC ${formatMinutes(g.socToOccMin)}`
      : `Surtido ${g.progress}%`,
  })

  let foundActive = false
  return steps.map((step) => {
    if (step.complete) return { ...step, state: 'done' }
    if (!foundActive) {
      foundActive = true
      return { ...step, state: 'active' }
    }
    return { ...step, state: 'pending' }
  })
}

function requestCard(g, openById, pageById) {
  const open = openById.has(g.id)
  const steps = buildStepper(g)
  const { page, totalPages, slice } = pageState(g, pageById)
  const party = g.suppliers[0] || g.requesters[0] || 'Sin proveedor'
  const extraParty = g.suppliers.length > 1 ? ` +${g.suppliers.length - 1}` : ''
  const unit = g.unit || 'KG'
  const qtyLeft = g.qtyWithOcc || g.qtyOrdered
  const qtyRight = g.qtyTotal || qtyLeft
  const waiting = g.waitingItems || 0
  const summary = waiting > 0
    ? `${g.items.length} items · <span class="req-wait-count">${waiting} en espera de OCC</span>`
    : `${g.items.length} items · <span class="req-ok-count">con OCC</span>`

  return `
    <article class="req-card">
      <div class="req-head">
        <div class="req-head-main">
          <p class="req-id">${esc(g.title)}</p>
          <p class="req-party" title="${esc(g.suppliers.join(', ') || g.requesters.join(', '))}">${esc(party)}${esc(extraParty)}</p>
        </div>
        <div class="req-neto">
          <p class="req-neto-label">Neto</p>
          <p class="req-neto-value">${fmtNeto(g.netValue)}</p>
        </div>
      </div>

      <div class="req-rule"></div>

      <div class="req-stepper">
        <div class="req-stepper-row">
          ${steps.map((step, index) => {
            const last = index === steps.length - 1
            const next = steps[index + 1]
            const lineDone = !last && step.state === 'done' && next?.state === 'done'
            return `
              <div class="req-step-col ${last ? 'is-last' : ''}" title="${esc(step.tooltip)}">
                <div class="req-step-head">
                  <div class="req-step-dot is-${esc(step.state)}">${step.state === 'done' ? ICON_CHECK : ''}</div>
                  ${last ? '' : `<div class="req-step-line ${lineDone ? 'is-done' : ''}"></div>`}
                </div>
                <span class="req-step-label">${esc(step.label)}</span>
              </div>`
          }).join('')}
        </div>
      </div>

      <div class="req-fill">
        <div class="req-fill-meta">
          <span>Surtido</span>
          <span class="req-fill-qty">${fmtQty(qtyLeft)} / ${fmtQty(qtyRight)} ${esc(unit)} · ${g.progress}%</span>
        </div>
        <div class="req-fill-bar" role="progressbar" aria-valuenow="${g.progress}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${g.progress}%"></span>
        </div>
      </div>

      <button type="button" class="req-toggle ${open ? 'is-open' : ''}" data-req-toggle="${esc(g.id)}" aria-expanded="${open ? 'true' : 'false'}">
        <span>${summary}</span>
        ${ICON_CHEVRON}
      </button>
      ${open ? `
        <ul class="req-items">${renderItemSlice(slice)}</ul>
        <div class="req-pager ${totalPages > 1 ? '' : 'is-disabled'}">
          <button type="button" class="req-pager-btn" data-id="${esc(g.id)}" data-req-dir="-1" ${page <= 1 ? 'disabled' : ''} aria-label="Anterior">‹</button>
          <span>${page} / ${totalPages}</span>
          <button type="button" class="req-pager-btn" data-id="${esc(g.id)}" data-req-dir="1" ${page >= totalPages ? 'disabled' : ''} aria-label="Siguiente">›</button>
        </div>
      ` : ''}
    </article>`
}

function renderItemSlice(slice) {
  let lastKind = null
  return slice.map((item) => {
    const waiting = !item.occ.length
    const kind = waiting ? 'wait' : 'ok'
    const heading = kind !== lastKind
      ? `<li class="req-item-group is-${kind}">${waiting ? 'En espera de OCC' : 'Con OCC'}</li>`
      : ''
    lastKind = kind
    return `${heading}${itemRow(item, waiting)}`
  }).join('')
}

function itemRow(item, waiting = !item.occ.length) {
  const occ = item.occ[0]
  const extraOcc = item.occ.length > 1 ? ` +${item.occ.length - 1}` : ''
  const heading = occ
    ? `<div class="req-item-occ">${esc(occ.occ_number)}${esc(extraOcc)}${occ.supplier ? ` · ${esc(short(occ.supplier, 32))}` : ''}</div>`
    : ''
  const unitPrice = occ && occ.unit_price
    ? `<div class="req-item-unit">Unitario ${fmtPesos(occ.unit_price)} / ${esc(item.unit || 'KG')}</div>`
    : ''
  const net = occ && occ.net_value
    ? `<div class="req-item-price">${fmtPesos(occ.net_value)}</div>`
    : ''
  return `
    <li class="req-item ${waiting ? 'is-wait' : 'is-ok'}">
      ${heading}
      <div class="req-item-main">
        <strong class="req-item-name">${esc(item.name || '—')}</strong>
        <span class="req-item-qty">${fmtQty(item.qtyRequested || item.qtyOrdered)} ${esc(item.unit || 'KG')}</span>
      </div>
      <div class="req-item-code">${esc(item.code || '—')}</div>
      ${unitPrice}
      ${net}
    </li>`
}

function unique(values) {
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))]
}

function sum(values) {
  return values.reduce((acc, value) => acc + (Number(value) || 0), 0)
}

function avg(values) {
  const nums = values.map(Number).filter((n) => Number.isFinite(n) && n >= 0)
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function firstDate(values) {
  return values.find(Boolean) || null
}

function parseBogota(value) {
  if (!value) return null
  let iso = String(value).trim()
  if (!iso.includes('T')) iso = iso.replace(' ', 'T')
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(iso)) iso += '-05:00'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function earliestValue(values) {
  let best = null
  let bestTime = Infinity
  for (const value of values) {
    const date = parseBogota(value)
    if (!date) continue
    if (date.getTime() < bestTime) {
      bestTime = date.getTime()
      best = value
    }
  }
  return best
}

function minutesBetween(start, end) {
  const from = parseBogota(start)
  const to = parseBogota(end)
  if (!from || !to) return null
  const minutes = (to - from) / 60000
  return minutes >= 0 ? minutes : null
}

function short(text, max) {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function formatDate(value) {
  const date = parseBogota(value)
  if (!date) return value ? String(value) : '—'
  return date.toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatMinutes(value) {
  if (value == null || value === '') return '—'
  const total = Math.round(Number(value))
  if (Number.isNaN(total)) return '—'
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`
}

function fmtQty(n) {
  if (n == null || n === '') return '—'
  return Number(n).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function fmtPesos(n) {
  if (n == null || n === '') return ''
  return `$ ${Number(n).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtNeto(n) {
  if (n == null || n === '' || Number(n) === 0) return '—'
  return `$${Number(n).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
