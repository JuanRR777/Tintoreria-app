import { processes as api, recipes, machines } from '../api.js'
import { toast }   from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'
import { navigate } from '../router.js'
import { openRecipeForm } from './recipes.js'
import { setPageHeader } from '../layout.js'
import {
  esc, fiberLabel, processMetaLine, processStage, renderStepper, weighCounts,
} from '../components/process-ui.js'

const STATUS_MAP = {
  pending:     ['badge-gray',  'Programado'],
  in_progress: ['badge-blue',  'En proceso'],
  paused:      ['badge-amber', 'Pausado'],
  completed:   ['badge-green', 'Terminado'],
  cancelled:   ['badge-red',   'Cancelado'],
}

function liquidateDose(ing, fiberKg, bathRatio) {
  const value = Number(ing.quantity_per_kg || ing.qty || 0)
  const basis = String(ing.dose_basis || '').trim()
  const unit = String(ing.unit || '').trim().toLowerCase()
  const fiber = Number(fiberKg) || 0
  let qtyKg = 0
  if (basis === 'percent' || unit === '%') {
    qtyKg = fiber * value / 100
  } else if (basis === 'g_l' || unit === 'g/l') {
    if (!bathRatio) return 'falta relación de baño'
    qtyKg = (value * Number(bathRatio) * fiber) / 1000
  } else if (unit === 'g' || unit === 'gr') {
    qtyKg = value * fiber / 1000
  } else {
    qtyKg = value * fiber
  }
  if (qtyKg < 1) return `${Number((qtyKg * 1000).toFixed(3))} g`
  return `${Number(qtyKg.toFixed(3))} kg`
}

export async function showView(container, params = {}) {
  setPageHeader({
    title: 'Procesos',
    subtitle: 'Programa el lote desde la receta y comienza el pesaje',
    actionsHtml: `
      <button class="btn btn-primary" id="btn-new-process">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nuevo proceso
      </button>`,
  })
  container.innerHTML = `
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
    renderProcessCards(data, list)
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

function renderProcessCards(items, container) {
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <h3>Sin procesos</h3><p>Crea un nuevo proceso para comenzar.</p>
      </div>`
    return
  }

  container.innerHTML = `<div class="proc-grid">${items.map(processCard).join('')}</div>`

  container.querySelectorAll('[data-weighing]').forEach((btn) => {
    btn.onclick = () => navigate('weighing', { processId: parseInt(btn.dataset.weighing, 10) })
  })
  container.querySelectorAll('[data-complete]').forEach((btn) => {
    btn.onclick = () => completeProcess(parseInt(btn.dataset.complete, 10))
  })
  container.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.onclick = () => cancelProcess(parseInt(btn.dataset.cancel, 10))
  })
}

function processCard(p) {
  const [cls, label] = STATUS_MAP[p.status] || ['badge-gray', p.status]
  const stage = processStage(p)
  const { total, done } = weighCounts(p)
  const canWeigh = ['pending', 'in_progress', 'paused'].includes(p.status)
  const canComplete = p.status === 'in_progress' && total > 0 && done >= total
  const canCancel = ['pending', 'in_progress', 'paused'].includes(p.status)

  return `
    <article class="proc-card">
      <header class="proc-card-top">
        <div>
          <p class="proc-card-code">${esc(p.batch_number)}</p>
          <p class="proc-card-meta">${esc(processMetaLine(p))}</p>
        </div>
        <span class="badge ${cls}">${label}</span>
      </header>
      ${renderStepper(stage)}
      <footer class="proc-card-actions">
        ${canWeigh ? `<button type="button" class="btn btn-primary btn-sm" data-weighing="${p.id}">${done ? 'Continuar pesaje' : 'Comenzar pesaje'}</button>` : ''}
        ${canComplete ? `<button type="button" class="btn btn-success btn-sm" data-complete="${p.id}">Completar</button>` : ''}
        ${canCancel ? `<button type="button" class="btn btn-ghost btn-sm text-danger" data-cancel="${p.id}">Cancelar</button>` : ''}
      </footer>
    </article>`
}

// ---------------------------------------------------------------------------
// Formulario nuevo proceso
// ---------------------------------------------------------------------------

async function openNewProcessForm(onSuccess) {
  const [recipeList, machineList] = await Promise.all([
    recipes.list({ status: 'active' }),
    machines.list(),
  ])

  const actives = machineList.filter((m) => m.status === 'active')
  const formHTML = `
    <form id="process-form">
      <div class="form-group">
        <label class="form-label">Receta <span class="required"></span></label>
        <select id="pf-recipe" class="form-select" required>
          <option value="">Seleccionar receta</option>
          ${recipeList.map((r) => `<option value="${r.id}">[${esc(r.code)}] ${esc(r.name)}</option>`).join('')}
        </select>
        <div id="pf-recipe-inherit" class="pf-inherit" hidden>
          Datos de la receta, no editables aquí
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Peso de fibra a teñir (kg) <span class="required"></span></label>
        <input id="pf-weight" class="form-input" type="number" min="0.001" step="0.001" placeholder="Ej: 200" required>
        <div class="form-hint" id="pf-water-hint"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Fecha y hora programada <span class="required"></span></label>
        <input id="pf-when" class="form-input" type="datetime-local" required>
      </div>
      <div class="form-group">
        <label class="form-label">Máquina</label>
        <select id="pf-machine" class="form-select">
          <option value="">Sin asignar</option>
          ${actives.map((m) => `<option value="${m.id}">${esc(m.name)} (${esc(m.equipment_type || m.machine_type || '—')}) · cap. ${esc(m.capacity_kg || 0)} kg</option>`).join('')}
        </select>
        <div class="form-hint" id="pf-machine-hint"></div>
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

  openModal('Nuevo proceso de producción', formHTML, { footerHTML: footer })

  document.getElementById('pf-recipe').onchange = refreshProcessHints
  document.getElementById('pf-weight').oninput = refreshProcessHints
  document.getElementById('pf-machine').onchange = refreshProcessHints

  function refreshProcessHints() {
    const recipe = recipeList.find((r) => r.id === Number(document.getElementById('pf-recipe').value))
    const inherit = document.getElementById('pf-recipe-inherit')
    const waterHint = document.getElementById('pf-water-hint')
    const machineHint = document.getElementById('pf-machine-hint')
    const weight = Number(document.getElementById('pf-weight').value)
    const machine = actives.find((m) => m.id === Number(document.getElementById('pf-machine').value))

    if (!recipe) {
      inherit.hidden = true
      waterHint.textContent = ''
      machineHint.textContent = ''
      machineHint.className = 'form-hint'
      return
    }

    const color = recipe.color_name || recipe.color_reference || 'Sin definir'
    const recipeRatio = Number(recipe.bath_ratio_l_per_kg) || 0
    const machineRatio = machine && Number(machine.capacity_kg) > 0 && Number(machine.water_capacity_liters) > 0
      ? Number(machine.water_capacity_liters) / Number(machine.capacity_kg)
      : 0
    const ratio = machineRatio || recipeRatio
    const ings = recipe.ingredients || []
    const temps = ings.filter((i) => Number(i.is_temporary) === 1)
    const preview = (weight > 0 && ings.length)
      ? ings.slice(0, 6).map((i) => {
          const liq = liquidateDose(i, weight, ratio)
          return `<span>${esc(i.chemical_name || i.name || 'Químico')}: <strong>${liq}</strong></span>`
        }).join('')
      : ''
    inherit.hidden = false
    inherit.innerHTML = `
      ${recipe.commercial_ref ? `<span>Referencia: <strong>${esc(recipe.commercial_ref)}</strong></span>` : ''}
      ${recipe.yarn_title ? `<span>Título: <strong>${esc(recipe.yarn_title)}</strong></span>` : ''}
      <span>Fibra: <strong>${esc(fiberLabel(recipe.fiber_type))}</strong></span>
      ${recipe.process_path_label ? `<span>Ruta: <strong>${esc(recipe.process_path_label)}</strong></span>` : ''}
      <span>Color: <strong>${esc(color)}</strong></span>
      <span>Relación de baño: <strong>${ratio ? `${esc(Number(ratio.toFixed(1)))}:1` : '—'}</strong></span>
      <span>Químicos a pesar: <strong>${ings.length}</strong></span>
      ${temps.length ? `<span class="pf-temp-warn">Sin inventario: <strong>${temps.map((i) => esc(i.chemical_name || i.name)).join(', ')}</strong>.</span><button type="button" class="btn btn-secondary btn-sm" id="pf-edit-recipe">Editar receta para asociar</button>` : ''}
      ${preview}
      <small>El % va sobre los kg del lote. Los g/L usan la relación de baño de la máquina.</small>`
    document.getElementById('pf-edit-recipe')?.addEventListener('click', () => {
      const id = Number(document.getElementById('pf-recipe').value)
      closeModal()
      openRecipeForm(id, null, { step: 1 })
    })

    if (weight > 0 && ratio) {
      waterHint.textContent = `Volumen de baño estimado: ${(ratio * weight).toFixed(1)} L (relación ${Number(ratio.toFixed(1))}:1)`
    } else if (weight > 0 && !ratio) {
      waterHint.textContent = 'Falta relación de baño en la máquina'
    } else {
      waterHint.textContent = ''
    }

    if (!machine) {
      machineHint.textContent = ''
      machineHint.className = 'form-hint'
      return
    }
    const issues = []
    if (machine.capacity_kg && weight > Number(machine.capacity_kg)) {
      issues.push('El peso supera la capacidad de la máquina')
    }
    const needWater = ratio && weight > 0 ? ratio * weight : 0
    if (machine.water_capacity_liters && needWater > Number(machine.water_capacity_liters)) {
      issues.push('El volumen de baño supera el agua de la máquina')
    }
    if (issues.length) {
      machineHint.className = 'form-hint is-warn'
      machineHint.textContent = issues.join(' · ')
    } else {
      machineHint.className = 'form-hint is-ok'
      machineHint.textContent = 'Compatible con la capacidad de la máquina'
    }
  }

  document.getElementById('pf-submit').onclick = async () => {
    const errEl = document.getElementById('pf-error')
    const submit = document.getElementById('pf-submit')
    const recipeId = parseInt(document.getElementById('pf-recipe').value, 10)
    const weight = parseFloat(document.getElementById('pf-weight').value)
    const when = document.getElementById('pf-when').value

    if (!recipeId || !weight || weight <= 0) {
      errEl.textContent = 'Receta y peso de fibra son obligatorios'
      errEl.style.display = 'block'
      return
    }
    const chosen = recipeList.find((r) => r.id === recipeId)
    const temps = (chosen?.ingredients || []).filter((i) => Number(i.is_temporary) === 1)
    if (temps.length) {
      errEl.textContent = `Asocia estos productos temporales antes del proceso: ${temps.map((i) => i.chemical_name || i.name).join(', ')}`
      errEl.style.display = 'block'
      return
    }
    if (!when) {
      errEl.textContent = 'La fecha y hora programada es obligatoria'
      errEl.style.display = 'block'
      return
    }

    submit.disabled = true
    submit.textContent = 'Creando...'
    errEl.style.display = 'none'

    try {
      const process = await api.create({
        recipe_id: recipeId,
        machine_id: parseInt(document.getElementById('pf-machine').value, 10) || undefined,
        fiber_weight_kg: weight,
        scheduled_at: when || undefined,
        notes: document.getElementById('pf-notes').value.trim() || undefined,
      })
      toast.success(`Proceso ${process.batch_number} creado. Abriendo pesaje.`)
      closeModal()
      if (onSuccess) onSuccess()
      navigate('weighing', { processId: process.id })
    } catch (err) {
      errEl.textContent = err.message
      errEl.style.display = 'block'
      submit.disabled = false
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
