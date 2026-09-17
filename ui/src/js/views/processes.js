import { processes as api, recipes, machines } from '../api.js'
import { toast }   from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'
import { navigate } from '../router.js'

const STATUS_MAP = {
  pending:     ['badge-gray',  'Pendiente'],
  in_progress: ['badge-blue',  'En proceso'],
  paused:      ['badge-amber', 'Pausado'],
  completed:   ['badge-green', 'Completado'],
  cancelled:   ['badge-red',   'Cancelado'],
}

export async function showView(container, params = {}) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Procesos</h1>
        <p class="page-subtitle">Lotes de produccion: historial y ejecucion</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-process">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo proceso
        </button>
      </div>
    </div>

    <div class="toolbar">
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="search-processes" placeholder="Buscar por lote o receta...">
      </div>
      <select class="form-select" id="filter-status" style="width:160px">
        <option value="">Todos los estados</option>
        ${Object.entries(STATUS_MAP).map(([v,[,l]]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
    </div>

    <div id="processes-list"></div>
  `

  document.getElementById('btn-new-process').onclick = () => openNewProcessForm(reload)

  const search     = document.getElementById('search-processes')
  const statusFilt = document.getElementById('filter-status')
  let debounce
  const onFilter = () => { clearTimeout(debounce); debounce = setTimeout(reload, 300) }
  search.oninput        = onFilter
  statusFilt.onchange   = onFilter

  if (params.status) statusFilt.value = params.status

  async function reload() {
    await loadProcesses({ search: search.value || undefined, status: statusFilt.value || undefined })
  }
  await reload()
}

async function loadProcesses(params = {}) {
  const list = document.getElementById('processes-list')
  if (!list) return
  list.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div>'
  try {
    const data = await api.list(params)
    renderTable(data, list)
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

function renderTable(items, container) {
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <h3>Sin procesos</h3><p>Crea un nuevo proceso para comenzar.</p>
      </div>`
    return
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Lote</th><th>Receta</th><th>Maquina</th>
            <th>Fibra (kg)</th><th>Operador</th><th>Estado</th>
            <th>Inicio</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(p => processRow(p)).join('')}
        </tbody>
      </table>
    </div>
  `

  container.querySelectorAll('[data-weighing]').forEach(btn =>
    btn.onclick = () => navigate('weighing', { processId: parseInt(btn.dataset.weighing) })
  )
  container.querySelectorAll('[data-complete]').forEach(btn =>
    btn.onclick = () => completeProcess(parseInt(btn.dataset.complete))
  )
  container.querySelectorAll('[data-cancel]').forEach(btn =>
    btn.onclick = () => cancelProcess(parseInt(btn.dataset.cancel))
  )
}

function processRow(p) {
  const [cls, label] = STATUS_MAP[p.status] || ['badge-gray', p.status]
  const startDate = p.started_at ? p.started_at.split('T')[0] : (p.created_at?.split('T')[0] || '-')
  const canWeigh    = ['pending','in_progress'].includes(p.status)
  const canComplete = p.status === 'in_progress'
  const canCancel   = ['pending','in_progress','paused'].includes(p.status)

  return `
    <tr>
      <td><code style="font-weight:700">${p.batch_number}</code></td>
      <td>${p.recipe_name} <span style="color:var(--text-muted);font-size:11px">(${p.recipe_code})</span></td>
      <td style="color:var(--text-muted)">${p.machine_name || '-'}</td>
      <td style="font-variant-numeric:tabular-nums">${Number(p.fiber_weight_kg).toFixed(2)} kg</td>
      <td style="color:var(--text-muted)">${p.operator_name}</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td style="color:var(--text-muted);font-size:12px">${startDate}</td>
      <td>
        <div class="actions-cell">
          ${canWeigh    ? `<button class="btn btn-primary btn-sm"  data-weighing="${p.id}">Pesar</button>` : ''}
          ${canComplete ? `<button class="btn btn-success btn-sm"  data-complete="${p.id}">Completar</button>` : ''}
          ${canCancel   ? `<button class="btn btn-ghost btn-sm text-danger" data-cancel="${p.id}">Cancelar</button>` : ''}
        </div>
      </td>
    </tr>
  `
}

// ---------------------------------------------------------------------------
// Formulario nuevo proceso
// ---------------------------------------------------------------------------

async function openNewProcessForm(onSuccess) {
  const [recipeList, machineList] = await Promise.all([
    recipes.list({ status: 'active' }),
    machines.list(),
  ])

  const formHTML = `
    <form id="process-form">
      <div class="form-group">
        <label class="form-label">Receta <span class="required"></span></label>
        <select id="pf-recipe" class="form-select" required>
          <option value="">Seleccionar receta</option>
          ${recipeList.map(r => `<option value="${r.id}">[${r.code}] ${r.name} - ${r.fiber_type || 'fibra no especificada'}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Peso de fibra a tenir (kg) <span class="required"></span></label>
        <input id="pf-weight" class="form-input" type="number" min="0.001" step="0.001" placeholder="Ej: 25.500" required>
        <div class="form-hint" id="pf-water-hint"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Maquina</label>
        <select id="pf-machine" class="form-select">
          <option value="">Sin asignar</option>
          ${machineList.filter(m => m.status === 'active').map(m => `<option value="${m.id}">${m.name} (${m.machine_type}) - cap. ${m.capacity_kg} kg</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Tipo de fibra</label>
          <select id="pf-fiber" class="form-select">
            <option value="">De la receta</option>
            <option value="lana">Lana</option>
            <option value="algodon">Algodon</option>
            <option value="acrilico">Acrilico</option>
            <option value="poliester">Poliester</option>
            <option value="nylon">Nylon</option>
            <option value="seda">Seda</option>
            <option value="mezcla">Mezcla</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Referencia de color</label>
          <input id="pf-color" class="form-input" placeholder="Ej: ROJO-115">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notas</label>
        <textarea id="pf-notes" class="form-textarea" placeholder="Notas del lote"></textarea>
      </div>
      <div id="pf-error" class="form-error" style="display:none"></div>
    </form>
  `

  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
    <button class="btn btn-primary" id="pf-submit">Crear proceso</button>
  `

  openModal('Nuevo proceso de produccion', formHTML, { footerHTML: footer })

  // Calcular agua cuando cambia la receta o el peso
  document.getElementById('pf-recipe').onchange = updateWaterHint
  document.getElementById('pf-weight').oninput  = updateWaterHint

  function updateWaterHint() {
    const recipeId = parseInt(document.getElementById('pf-recipe').value)
    const weight   = parseFloat(document.getElementById('pf-weight').value)
    const hint     = document.getElementById('pf-water-hint')
    if (!recipeId || !weight) { hint.textContent = ''; return }

    const recipe = recipeList.find(r => r.id === recipeId)
    if (recipe?.bath_ratio_l_per_kg) {
      const liters = (recipe.bath_ratio_l_per_kg * weight).toFixed(1)
      hint.textContent = `Volumen de bano estimado: ${liters} L (relacion ${recipe.bath_ratio_l_per_kg}:1)`
    } else {
      hint.textContent = 'La receta no tiene relacion de bano configurada'
    }
  }

  document.getElementById('pf-submit').onclick = async () => {
    const errEl  = document.getElementById('pf-error')
    const submit = document.getElementById('pf-submit')
    const recipeId = parseInt(document.getElementById('pf-recipe').value)
    const weight   = parseFloat(document.getElementById('pf-weight').value)

    if (!recipeId || !weight || weight <= 0) {
      errEl.textContent   = 'Receta y peso de fibra son obligatorios'
      errEl.style.display = 'block'
      return
    }

    const machineId = parseInt(document.getElementById('pf-machine').value) || undefined

    submit.disabled = true
    submit.textContent = 'Creando...'
    errEl.style.display = 'none'

    try {
      const process = await api.create({
        recipe_id:       recipeId,
        machine_id:      machineId,
        fiber_weight_kg: weight,
        fiber_type:      document.getElementById('pf-fiber').value   || undefined,
        color_reference: document.getElementById('pf-color').value.trim() || undefined,
        notes:           document.getElementById('pf-notes').value.trim() || undefined,
      })
      toast.success(`Proceso ${process.batch_number} creado`)
      closeModal()
      if (onSuccess) onSuccess()
      navigate('weighing', { processId: process.id })
    } catch (err) {
      errEl.textContent  = err.message
      errEl.style.display = 'block'
      submit.disabled    = false
      submit.textContent = 'Crear proceso'
    }
  }
}

async function completeProcess(id) {
  const ok = await confirm('Marcar este proceso como completado. Se descontara el stock de todos los pesajes registrados.', 'Completar proceso')
  if (!ok) return
  try {
    await api.updateStatus(id, { status: 'completed' })
    toast.success('Proceso completado. Stock actualizado.')
    await loadProcesses()
  } catch (err) {
    toast.error(err.message)
  }
}

async function cancelProcess(id) {
  const ok = await confirm('Cancelar este proceso. No se descontara stock.', 'Cancelar proceso')
  if (!ok) return
  try {
    await api.updateStatus(id, { status: 'cancelled' })
    toast.warning('Proceso cancelado')
    await loadProcesses()
  } catch (err) {
    toast.error(err.message)
  }
}
