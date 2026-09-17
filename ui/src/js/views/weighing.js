/**
 * Vista de Pesaje - modulo mas critico del sistema
 * Integra WebSocket con bascula + lista de ingredientes + confirmacion de pesajes
 */
import { processes as api, scales, openScaleSocket } from '../api.js'
import { toast }  from '../components/toast.js'
import { confirm } from '../components/modal.js'
import { navigate } from '../router.js'

let _ws       = null
let _scaleId  = null

export async function showView(container, params = {}) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Pesaje</h1>
        <p class="page-subtitle">Control de dosificacion con bascula en tiempo real</p>
      </div>
    </div>
    <div id="weighing-content"></div>
  `

  const processId = params.processId

  if (!processId) {
    await renderProcessSelector(document.getElementById('weighing-content'))
    return
  }

  await renderWeighingPanel(document.getElementById('weighing-content'), processId)

  // Retornar funcion de cleanup para cerrar WebSocket al navegar
  return () => {
    if (_ws) { _ws.close(); _ws = null }
  }
}

// ---------------------------------------------------------------------------
// Selector de proceso activo
// ---------------------------------------------------------------------------

async function renderProcessSelector(container) {
  try {
    const data = await api.list({ status: 'in_progress' })
    const pending = await api.list({ status: 'pending' })
    const all = [...data, ...pending]

    container.innerHTML = `
      <div class="card" style="max-width:600px;margin:0 auto">
        <div class="card-header"><h3 class="card-title">Seleccionar proceso activo</h3></div>
        <div class="card-body">
          ${all.length
            ? `<div class="form-group">
                <label class="form-label">Proceso</label>
                <select id="process-selector" class="form-select">
                  <option value="">Seleccionar...</option>
                  ${all.map(p => `<option value="${p.id}">[${p.batch_number}] ${p.recipe_name} - ${p.fiber_weight_kg} kg</option>`).join('')}
                </select>
               </div>
               <button class="btn btn-primary" id="btn-open-weighing">Abrir pesaje</button>`
            : '<p style="color:var(--text-muted);margin:0">No hay procesos en curso. Crea un proceso desde la vista de Procesos.</p>'
          }
        </div>
      </div>
    `

    if (all.length) {
      document.getElementById('btn-open-weighing').onclick = () => {
        const id = parseInt(document.getElementById('process-selector').value)
        if (!id) { toast.warning('Selecciona un proceso'); return }
        navigate('weighing', { processId: id })
      }
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

// ---------------------------------------------------------------------------
// Panel principal de pesaje
// ---------------------------------------------------------------------------

async function renderWeighingPanel(container, processId) {
  try {
    const [process, weighings, scaleList] = await Promise.all([
      api.get(processId),
      api.weighings(processId),
      scales.list(),
    ])

    _scaleId = scaleList[0]?.id || null

    const canWeigh = ['pending', 'in_progress'].includes(process.status)

    container.innerHTML = `
      <div class="weighing-layout">

        <!-- Panel izq: bascula y proceso -->
        <div class="weighing-left">

          <!-- Info proceso -->
          <div class="card" style="margin-bottom:12px">
            <div class="card-body" style="padding:14px 18px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                <span style="font-size:18px;font-weight:700">${process.batch_number}</span>
                <span class="badge ${process.status === 'in_progress' ? 'badge-blue' : 'badge-gray'}">${process.status}</span>
              </div>
              <div style="font-size:13px;color:var(--text-muted)">
                Receta: <strong style="color:var(--text-primary)">${process.recipe_name}</strong>
                &nbsp;&middot;&nbsp; Fibra: <strong style="color:var(--text-primary)">${process.fiber_weight_kg} kg</strong>
                &nbsp;&middot;&nbsp; Bano: <strong style="color:var(--text-primary)">${process.water_volume_liters ? process.water_volume_liters + ' L' : '-'}</strong>
              </div>
            </div>
          </div>

          <!-- Display bascula -->
          <div class="card" style="margin-bottom:12px">
            <div class="card-header">
              <h3 class="card-title">Bascula</h3>
              <div style="display:flex;align-items:center;gap:8px">
                <select id="scale-select" class="form-select" style="width:200px;font-size:12px">
                  <option value="">Sin bascula</option>
                  ${scaleList.map(s => `<option value="${s.id}" ${s.id === _scaleId ? 'selected' : ''}>${s.name} (${s.port})</option>`).join('')}
                </select>
                <button class="btn btn-ghost btn-sm" id="btn-connect-scale">Conectar</button>
              </div>
            </div>
            <div class="card-body" style="padding:20px;text-align:center">
              <div class="weight-display" id="weight-display">
                <div class="weight-value" id="weight-value">---</div>
                <div class="weight-unit">kg</div>
                <div class="weight-status" id="weight-status">Sin conexion</div>
              </div>
              <div id="ws-status" style="margin-top:8px;font-size:12px;color:var(--text-muted)">WebSocket desconectado</div>
            </div>
          </div>

          <!-- Acciones de proceso -->
          ${canWeigh ? `
            <div class="card">
              <div class="card-body" style="padding:14px 18px;display:flex;gap:8px;flex-wrap:wrap">
                ${process.status === 'pending'
                  ? `<button class="btn btn-primary" id="btn-start">Iniciar proceso</button>`
                  : `<button class="btn btn-success" id="btn-complete">Marcar completado</button>
                     <button class="btn btn-ghost" id="btn-pause">Pausar</button>`
                }
                <button class="btn btn-ghost text-danger" id="btn-cancel-proc">Cancelar proceso</button>
              </div>
            </div>` : ''
          }
        </div>

        <!-- Panel der: ingredientes -->
        <div class="weighing-right">
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Ingredientes del lote</h3>
              <div style="font-size:12px;color:var(--text-muted)" id="weighing-progress"></div>
            </div>
            <div id="ingredients-list"></div>
          </div>
        </div>

      </div>
    `

    renderIngredients(weighings, canWeigh, process)
    setupScaleControls()
    setupProcessActions(process, processId)

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

// ---------------------------------------------------------------------------
// Render lista de ingredientes
// ---------------------------------------------------------------------------

function renderIngredients(weighings, canWeigh, process) {
  const container = document.getElementById('ingredients-list')
  const progress  = document.getElementById('weighing-progress')
  if (!container) return

  const done  = weighings.filter(w => w.actual_quantity !== null).length
  const total = weighings.length

  if (progress) progress.textContent = `${done} / ${total} pesados`

  if (!weighings.length) {
    container.innerHTML = '<div class="empty-state" style="padding:30px"><p>Sin ingredientes en esta receta</p></div>'
    return
  }

  container.innerHTML = weighings.map(w => {
    const weighed = w.actual_quantity !== null
    const variance = weighed ? ((w.actual_quantity - w.expected_quantity) / w.expected_quantity * 100) : null
    const isOk    = variance !== null && Math.abs(variance) <= (w.tolerance_percent || 5)
    const isWarn  = variance !== null && !isOk && Math.abs(variance) <= 15
    const isError = variance !== null && Math.abs(variance) > 15

    const rowClass = weighed
      ? (isOk ? 'weighing-row ok' : isWarn ? 'weighing-row warn' : 'weighing-row error')
      : 'weighing-row'

    return `
      <div class="${rowClass}" data-wid="${w.id}">
        <div class="weighing-row-header">
          <div class="weighing-chemical-name">${w.chemical_name}</div>
          ${w.chemical_code ? `<code style="font-size:11px;color:var(--text-muted)">${w.chemical_code}</code>` : ''}
        </div>
        <div class="weighing-amounts">
          <div class="weighing-amount-block">
            <div class="amount-label">Esperado</div>
            <div class="amount-value">${Number(w.expected_quantity).toFixed(3)} ${w.unit}</div>
          </div>
          ${weighed ? `
            <div class="weighing-amount-block">
              <div class="amount-label">Real</div>
              <div class="amount-value actual ${isOk ? 'ok' : isWarn ? 'warn' : 'error'}">
                ${Number(w.actual_quantity).toFixed(3)} ${w.unit}
              </div>
            </div>
            <div class="weighing-amount-block">
              <div class="amount-label">Variacion</div>
              <div class="amount-value ${isOk ? 'ok' : isWarn ? 'warn' : 'error'}">
                ${variance > 0 ? '+' : ''}${variance.toFixed(2)}%
              </div>
            </div>
          ` : '<div class="weighing-amount-block"><div class="amount-label">Pendiente de pesaje</div></div>'}
        </div>
        ${canWeigh && !weighed ? `
          <div class="weighing-actions">
            <input class="form-input actual-input" data-wid="${w.id}" type="number" min="0" step="0.001"
              placeholder="Cantidad real" style="width:140px"
              title="Puedes usar el peso de la bascula con el boton Aplicar peso">
            <button class="btn btn-ghost btn-sm" id="apply-scale-${w.id}" title="Usar peso actual de la bascula">Aplicar peso</button>
            <button class="btn btn-primary btn-sm confirm-weighing" data-wid="${w.id}">Confirmar</button>
          </div>
        ` : ''}
      </div>
    `
  }).join('')

  // Listeners para confirmar pesaje
  if (canWeigh) {
    container.querySelectorAll('.confirm-weighing').forEach(btn => {
      btn.onclick = () => confirmWeighing(parseInt(btn.dataset.wid), process)
    })
    container.querySelectorAll('[id^="apply-scale-"]').forEach(btn => {
      btn.onclick = () => {
        const wid = btn.id.replace('apply-scale-', '')
        const weightValue = document.getElementById('weight-value')?.textContent
        const parsed = parseFloat(weightValue)
        if (!isNaN(parsed)) {
          const input = container.querySelector(`input.actual-input[data-wid="${wid}"]`)
          if (input) input.value = parsed.toFixed(3)
        } else {
          toast.warning('No hay lectura valida de la bascula')
        }
      }
    })
  }
}

async function confirmWeighing(wid, process) {
  const input = document.querySelector(`input.actual-input[data-wid="${wid}"]`)
  const value = parseFloat(input?.value)

  if (!value || value <= 0) {
    toast.warning('Ingresa una cantidad valida antes de confirmar')
    return
  }

  try {
    await api.updateWeighing(process.id, wid, { actual_quantity: value })

    // Activar proceso si estaba pendiente
    if (process.status === 'pending') {
      await api.updateStatus(process.id, { status: 'in_progress' })
    }

    toast.success('Pesaje confirmado')

    // Recargar pesajes
    const weighings = await api.weighings(process.id)
    renderIngredients(weighings, true, process)
  } catch (err) {
    toast.error(err.message)
  }
}

// ---------------------------------------------------------------------------
// Bascula WebSocket
// ---------------------------------------------------------------------------

function setupScaleControls() {
  const connectBtn  = document.getElementById('btn-connect-scale')
  const scaleSelect = document.getElementById('scale-select')
  if (!connectBtn) return

  connectBtn.onclick = () => {
    const id = parseInt(scaleSelect.value)
    if (!id) { toast.warning('Selecciona una bascula'); return }

    if (_ws) {
      _ws.close()
      _ws = null
      connectBtn.textContent = 'Conectar'
      document.getElementById('ws-status').textContent = 'Desconectado'
      return
    }

    connectBtn.textContent = 'Desconectando...'
    _scaleId = id
    connectScale(id, connectBtn)
  }
}

function connectScale(scaleId, btn) {
  const weightValueEl  = document.getElementById('weight-value')
  const weightStatusEl = document.getElementById('weight-status')
  const wsStatusEl     = document.getElementById('ws-status')

  if (wsStatusEl) wsStatusEl.textContent = 'Conectando...'

  _ws = openScaleSocket(
    scaleId,
    (data) => {
      if (weightValueEl) weightValueEl.textContent = Number(data.weight).toFixed(3)
      if (weightStatusEl) {
        weightStatusEl.textContent = data.stable ? 'ESTABLE' : 'Estabilizando...'
        weightStatusEl.className = `weight-status ${data.stable ? 'stable' : 'unstable'}`
      }
      if (wsStatusEl) wsStatusEl.textContent = `Conectado - Puerto: ${data.port || scaleId}`
      if (btn) btn.textContent = 'Desconectar'
    },
    (err) => {
      if (weightStatusEl) { weightStatusEl.textContent = 'Sin conexion'; weightStatusEl.className = 'weight-status' }
      if (wsStatusEl) wsStatusEl.textContent = `Error: ${err.message || 'Conexion perdida'}`
      if (btn) btn.textContent = 'Reconectar'
      _ws = null
    }
  )
}

// ---------------------------------------------------------------------------
// Acciones de proceso
// ---------------------------------------------------------------------------

function setupProcessActions(process, processId) {
  const startBtn    = document.getElementById('btn-start')
  const completeBtn = document.getElementById('btn-complete')
  const pauseBtn    = document.getElementById('btn-pause')
  const cancelBtn   = document.getElementById('btn-cancel-proc')

  if (startBtn) {
    startBtn.onclick = async () => {
      try {
        await api.updateStatus(processId, { status: 'in_progress' })
        toast.success('Proceso iniciado')
        navigate('weighing', { processId })
      } catch (err) { toast.error(err.message) }
    }
  }

  if (completeBtn) {
    completeBtn.onclick = async () => {
      const ok = await confirm('Completar proceso. Se descontara el stock de quimicos utilizado.', 'Completar proceso')
      if (!ok) return
      try {
        await api.updateStatus(processId, { status: 'completed' })
        toast.success('Proceso completado. Stock actualizado.')
        navigate('processes')
      } catch (err) { toast.error(err.message) }
    }
  }

  if (pauseBtn) {
    pauseBtn.onclick = async () => {
      try {
        await api.updateStatus(processId, { status: 'paused' })
        toast.warning('Proceso pausado')
        navigate('processes')
      } catch (err) { toast.error(err.message) }
    }
  }

  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      const ok = await confirm('Cancelar este proceso. No se descontara stock.', 'Cancelar proceso')
      if (!ok) return
      try {
        await api.updateStatus(processId, { status: 'cancelled' })
        toast.warning('Proceso cancelado')
        navigate('processes')
      } catch (err) { toast.error(err.message) }
    }
  }
}
