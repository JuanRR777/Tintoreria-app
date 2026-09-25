/**
 * Pesaje de los químicos de la receta del proceso.
 * La báscula queda como apoyo opcional para tomar el peso real.
 */
import { processes as api, scales, openScaleSocket } from '../api.js'
import { toast }  from '../components/toast.js'
import { confirm } from '../components/modal.js'
import { navigate } from '../router.js'
import { setPageHeader } from '../layout.js'
import {
  esc, fmtQty, isWeighed, lotLine, processMetaLine, processStage,
  renderStepper, stageBadge, weighCounts,
} from '../components/process-ui.js'

let _ws       = null
let _scaleId  = null

export async function showView(container, params = {}) {
  setPageHeader({
    title: 'Pesaje',
    subtitle: 'Confirma los químicos de la receta e inicia la tinción',
  })
  container.innerHTML = `
    <div id="weighing-content"></div>
  `

  const processId = params.processId

  if (!processId) {
    await renderProcessSelector(document.getElementById('weighing-content'))
    return
  }

  await renderWeighingPanel(document.getElementById('weighing-content'), processId)

  return () => {
    if (_ws) { _ws.close(); _ws = null }
  }
}

async function renderProcessSelector(container) {
  try {
    const [pending, active, paused] = await Promise.all([
      api.list({ status: 'pending' }),
      api.list({ status: 'in_progress' }),
      api.list({ status: 'paused' }),
    ])
    const all = [...pending, ...active, ...paused]

    if (!all.length) {
      container.innerHTML = `
        <div class="empty-state">
          <h3>Sin procesos para pesar</h3>
          <p>Crea un proceso desde la vista de Procesos. Al crearlo se abrirá el pesaje de la receta.</p>
          <button type="button" class="btn btn-primary" id="btn-go-processes">Ir a Procesos</button>
        </div>`
      document.getElementById('btn-go-processes').onclick = () => navigate('processes')
      return
    }

    container.innerHTML = `
      <div class="proc-grid">
        ${all.map((p) => {
          const stage = processStage(p, { inWeighing: true })
          const [cls, label] = stageBadge(stage, p.status)
          const { done, total } = weighCounts(p)
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
              <p class="proc-weigh-count">${done} de ${total} pesados</p>
              <footer class="proc-card-actions">
                <button type="button" class="btn btn-primary btn-sm" data-weighing="${p.id}">
                  ${done ? 'Continuar pesaje' : 'Comenzar pesaje'}
                </button>
              </footer>
            </article>`
        }).join('')}
      </div>`

    container.querySelectorAll('[data-weighing]').forEach((btn) => {
      btn.onclick = () => navigate('weighing', { processId: parseInt(btn.dataset.weighing, 10) })
    })
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

async function renderWeighingPanel(container, processId) {
  try {
    const [process, weighings, scaleList] = await Promise.all([
      api.get(processId),
      api.weighings(processId),
      scales.list(),
    ])

    process.weighings = weighings
    _scaleId = _scaleId || scaleList[0]?.id || null

    const canWeigh = ['pending', 'in_progress', 'paused'].includes(process.status)
    const { done, total } = weighCounts(process, weighings)
    const stage = processStage(process, { inWeighing: true })
    const [cls, label] = stageBadge(stage, process.status)
    const allWeighed = total > 0 && done >= total
    const canConfirm = canWeigh && total > 0 && !allWeighed
    const canStartDye = canWeigh && allWeighed && process.status !== 'in_progress'

    container.innerHTML = `
      <div class="weigh-page">
        <article class="proc-card">
          <header class="proc-card-top">
            <div>
              <p class="proc-card-code">${esc(process.batch_number)}</p>
              <p class="proc-card-meta">${esc(processMetaLine(process))}</p>
            </div>
            <span class="badge ${cls}">${label}</span>
          </header>
          ${renderStepper(stage)}
        </article>

        <article class="proc-card">
          ${weighings.length ? `
            <div class="proc-weigh weigh-list">
              ${weighings.map((w) => weighRow(w, canWeigh)).join('')}
            </div>
            <div class="weigh-list-footer">
              <p class="proc-weigh-count" id="weighing-progress">${done} de ${total} pesados</p>
              ${canWeigh && total > 0 && (canConfirm || canStartDye) ? `
                <button type="button" class="btn btn-primary" id="btn-confirm-weigh" disabled>
                  Confirmar pesaje e iniciar tiñendo
                </button>` : ''}
            </div>
          ` : `
            <p class="proc-weigh-empty">Esta receta no tiene químicos para pesar.</p>
            <footer class="proc-card-actions">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-back-processes">Volver a procesos</button>
            </footer>
          `}
        </article>

        ${canWeigh ? `
          <details class="card weigh-scale">
            <summary>Báscula (opcional)</summary>
            <div class="weigh-scale-body">
              <div class="weigh-scale-toolbar">
                <select id="scale-select" class="form-select">
                  <option value="">Sin báscula</option>
                  ${scaleList.map((s) => `<option value="${s.id}" ${s.id === _scaleId ? 'selected' : ''}>${esc(s.name)} (${esc(s.port)})</option>`).join('')}
                </select>
                <button type="button" class="btn btn-ghost btn-sm" id="btn-connect-scale">Conectar</button>
              </div>
              <div class="weight-display" id="weight-display">
                <div class="weight-value" id="weight-value">---</div>
                <div class="weight-unit">kg</div>
                <div class="weight-status" id="weight-status">Sin conexión</div>
              </div>
              <div id="ws-status" class="form-hint">WebSocket desconectado</div>
            </div>
          </details>
        ` : ''}

        ${process.status === 'in_progress' && allWeighed ? `
          <footer class="proc-card-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-back-processes">Volver a procesos</button>
            <button type="button" class="btn btn-success btn-sm" id="btn-complete">Marcar completado</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-pause">Pausar</button>
            <button type="button" class="btn btn-ghost btn-sm text-danger" id="btn-cancel-proc">Cancelar proceso</button>
          </footer>
        ` : canWeigh ? `
          <footer class="proc-card-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-back-processes">Volver a procesos</button>
            <button type="button" class="btn btn-ghost btn-sm text-danger" id="btn-cancel-proc">Cancelar proceso</button>
          </footer>
        ` : `
          <footer class="proc-card-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-back-processes">Volver a procesos</button>
          </footer>
        `}
      </div>
    `

    bindWeighChecks(container, weighings, canWeigh)
    const confirmBtn = document.getElementById('btn-confirm-weigh')
    if (confirmBtn) {
      confirmBtn.onclick = () => confirmWeighAndStart(process, weighings, processId)
      syncConfirmButton(weighings)
    }
    document.getElementById('btn-back-processes')?.addEventListener('click', () => navigate('processes'))
    setupScaleControls()
    setupProcessActions(process, processId)
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

function weighRow(w, canWeigh) {
  const weighed = isWeighed(w)
  return `
    <label class="proc-weigh-row ${weighed ? 'is-done' : ''}">
      <div>
        <strong>${esc(w.chemical_name)}</strong>
        <span>${esc(lotLine(w))}</span>
      </div>
      <em>${esc(fmtQty(w.expected_quantity, w.unit))}</em>
      <input type="checkbox" class="weigh-check" data-wid="${w.id}"
        ${weighed ? 'checked disabled' : ''}
        ${!canWeigh && !weighed ? 'disabled' : ''}
        aria-label="Marcar ${esc(w.chemical_name)} como pesado">
    </label>`
}

function bindWeighChecks(container, weighings, canWeigh) {
  if (!canWeigh) return
  container.querySelectorAll('.weigh-check').forEach((box) => {
    box.addEventListener('change', () => syncConfirmButton(weighings))
  })
}

function syncConfirmButton(weighings) {
  const btn = document.getElementById('btn-confirm-weigh')
  const progress = document.getElementById('weighing-progress')
  if (!btn) return
  const checked = new Set(
    [...document.querySelectorAll('.weigh-check:checked')].map((el) => Number(el.dataset.wid))
  )
  const marked = weighings.filter((w) => isWeighed(w) || checked.has(w.id)).length
  if (progress) progress.textContent = `${marked} de ${weighings.length} pesados`
  btn.disabled = marked < weighings.length || weighings.length === 0
}

function currentScaleWeight() {
  const raw = document.getElementById('weight-value')?.textContent
  const value = parseFloat(String(raw || '').replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : null
}

async function confirmWeighAndStart(process, weighings, processId) {
  const btn = document.getElementById('btn-confirm-weigh')
  const checked = new Set(
    [...document.querySelectorAll('.weigh-check:checked')].map((el) => Number(el.dataset.wid))
  )
  const pending = weighings.filter((w) => !isWeighed(w))
  if (pending.some((w) => !checked.has(w.id))) {
    toast.warning('Marca todos los químicos de la receta para confirmar el pesaje')
    return
  }

  btn.disabled = true
  btn.textContent = 'Confirmando...'
  const scaleWeight = currentScaleWeight()

  try {
    for (const w of pending) {
      await api.updateWeighing(process.id, w.id, {
        actual_quantity: scaleWeight && pending.length === 1 ? scaleWeight : w.expected_quantity,
        lot_id: w.lot_id || w.suggested_lot_id || undefined,
        scale_id: _scaleId || undefined,
      })
    }
    if (process.status !== 'in_progress') {
      await api.updateStatus(process.id, { status: 'in_progress' })
    }
    toast.success('Pesaje confirmado. El proceso pasó a tiñendo.')
    await renderWeighingPanel(document.getElementById('weighing-content'), processId)
  } catch (err) {
    toast.error(err.message)
    btn.disabled = false
    btn.textContent = 'Confirmar pesaje e iniciar tiñendo'
  }
}

function setupScaleControls() {
  const connectBtn  = document.getElementById('btn-connect-scale')
  const scaleSelect = document.getElementById('scale-select')
  if (!connectBtn) return

  connectBtn.onclick = () => {
    const id = parseInt(scaleSelect.value, 10)
    if (!id) { toast.warning('Selecciona una báscula'); return }

    if (_ws) {
      _ws.close()
      _ws = null
      connectBtn.textContent = 'Conectar'
      const status = document.getElementById('ws-status')
      if (status) status.textContent = 'Desconectado'
      return
    }

    connectBtn.textContent = 'Conectando...'
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
      if (wsStatusEl) wsStatusEl.textContent = `Conectado · Puerto: ${data.port || scaleId}`
      if (btn) btn.textContent = 'Desconectar'
    },
    (err) => {
      if (weightStatusEl) { weightStatusEl.textContent = 'Sin conexión'; weightStatusEl.className = 'weight-status' }
      if (wsStatusEl) wsStatusEl.textContent = `Error: ${err.message || 'Conexión perdida'}`
      if (btn) btn.textContent = 'Reconectar'
      _ws = null
    }
  )
}

function setupProcessActions(process, processId) {
  const completeBtn = document.getElementById('btn-complete')
  const pauseBtn    = document.getElementById('btn-pause')
  const cancelBtn   = document.getElementById('btn-cancel-proc')

  if (completeBtn) {
    completeBtn.onclick = async () => {
      const ok = await confirm('Completar proceso. Se descontará el stock de químicos utilizado.', 'Completar proceso')
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
      const ok = await confirm('Cancelar este proceso. No se descontará stock.', 'Cancelar proceso')
      if (!ok) return
      try {
        await api.updateStatus(processId, { status: 'cancelled' })
        toast.warning('Proceso cancelado')
        navigate('processes')
      } catch (err) { toast.error(err.message) }
    }
  }
}
