/**
 * Pesaje de los químicos de la receta. El peso real sale de la báscula.
 */
import { processes as api, scales, openScaleSocket } from '../api.js'
import { toast }  from '../components/toast.js'
import { confirm } from '../components/modal.js'
import { navigate } from '../router.js'
import { setPageHeader } from '../layout.js'
import {
  esc, isWeighed, lotLine, processMetaLine, processStage,
  renderStepper, stageBadge, weighCounts,
} from '../components/process-ui.js'

let _ws       = null
let _scaleId  = null
let _scaleMeta = null
let _closing  = false
let _live = { connected: false, weight: null, stable: false, unit: '', port: '' }
let _weighings = []

export async function showView(container, params = {}) {
  setPageHeader({
    title: 'Pesaje',
    subtitle: 'Captura el peso de cada químico desde la báscula',
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
    closeScaleSocket()
  }
}

function closeScaleSocket() {
  _closing = true
  if (_ws) {
    try { _ws.close() } catch { /* ignore */ }
  }
  _ws = null
  _live.connected = false
  _live.weight = null
  _live.stable = false
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
    _weighings = weighings
    const actives = scaleList.filter((s) => Number(s.is_active) !== 0)
    if (!_scaleId) _scaleId = actives[0]?.id || null
    _scaleMeta = actives.find((s) => s.id === _scaleId) || actives[0] || null

    const canWeigh = ['pending', 'in_progress', 'paused'].includes(process.status)
    const { done, total } = weighCounts(process, weighings)
    const stage = processStage(process, { inWeighing: true })
    const [cls, label] = stageBadge(stage, process.status)
    const allWeighed = total > 0 && done >= total
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

        ${canWeigh ? scaleCardHtml(actives) : ''}

        <article class="proc-card">
          ${weighings.length ? `
            <p class="form-hint weigh-capture-hint">La báscula debe marcar exactamente la cantidad de la receta. Sin % de tolerancia no se acepta de más ni de menos.</p>
            <div class="proc-weigh weigh-list" id="weigh-list">
              ${weighings.map((w) => weighRow(w, canWeigh)).join('')}
            </div>
            <div class="weigh-list-footer">
              <p class="proc-weigh-count" id="weighing-progress">${done} de ${total} pesados</p>
              ${canWeigh && total > 0 && (!allWeighed || canStartDye) ? `
                <button type="button" class="btn btn-primary" id="btn-confirm-weigh" ${allWeighed ? '' : 'disabled'}>
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

    bindCaptureButtons(process, processId, weighings, canWeigh)
    const confirmBtn = document.getElementById('btn-confirm-weigh')
    if (confirmBtn) confirmBtn.onclick = () => confirmWeighAndStart(process, weighings, processId)
    document.getElementById('btn-back-processes')?.addEventListener('click', () => navigate('processes'))
    setupScaleControls(actives)
    setupProcessActions(process, processId)
    paintLiveWeight()
    syncCaptureButtons()
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

function scaleCardHtml(scaleList) {
  if (!scaleList.length) {
    return `
      <article class="proc-card weigh-scale-card">
        <p class="proc-weigh-empty">No hay básculas registradas. En Máquinas → Básculas agrega el puerto COM para poder pesar.</p>
      </article>`
  }
  return `
    <article class="proc-card weigh-scale-card">
      <header class="proc-card-top">
        <div>
          <p class="proc-card-code" style="font-size:15px">Báscula</p>
          <p class="proc-card-meta">El pesaje usa esta lectura, no el valor de la receta</p>
        </div>
      </header>
      <div class="weigh-scale-body">
        <div class="weigh-scale-toolbar">
          <select id="scale-select" class="form-select">
            ${scaleList.map((s) => `<option value="${s.id}" ${s.id === _scaleId ? 'selected' : ''}>${esc(s.name)} (${esc(s.port || 'sin puerto')})</option>`).join('')}
          </select>
          <button type="button" class="btn ${_live.connected ? 'btn-secondary' : 'btn-primary'} btn-sm" id="btn-connect-scale">
            ${_live.connected ? 'Desconectar' : 'Conectar'}
          </button>
        </div>
        <div class="weight-display" id="weight-display">
          <div class="weight-value" id="weight-value">${_live.weight == null ? '---' : esc(fmtWeight(_live.weight, scaleUnit()))}</div>
          <div class="weight-status" id="weight-status">${_live.connected ? (_live.stable ? 'ESTABLE' : 'Estabilizando...') : 'Sin conexión'}</div>
        </div>
        <div id="ws-status" class="form-hint">${_live.connected ? `Conectado · ${_live.port || _scaleMeta?.port || ''}` : 'Sin conexión a la báscula'}</div>
        <p class="form-hint" id="weigh-target-line"></p>
      </div>
    </article>`
}

function scaleUnit() {
  return _live.unit || _scaleMeta?.unit || 'kg'
}

function fmtWeight(qty, unit) {
  const u = normalizeUnit(unit)
  const num = Number(qty)
  if (!Number.isFinite(num)) return '—'
  if (u === 'g') {
    return `${Math.round(num).toLocaleString('es-CO')} g`
  }
  const rounded = Math.round(num * 10) / 10
  const digits = Math.abs(rounded - Math.round(rounded)) < 0.05 ? 0 : 1
  return `${rounded.toLocaleString('es-CO', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 1,
  })} kg`
}

function mismatchMessage(w) {
  const now = _live.weight == null
    ? 'sin lectura'
    : fmtWeight(_live.weight, scaleUnit())
  return `La receta pide ${fmtWeight(w.expected_quantity, w.unit)}. La báscula marca ${now}. El botón se activa solo cuando coinciden.`
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000
}

function targetOnScale(w) {
  return convertWeight(Number(w.expected_quantity), w.unit, scaleUnit())
}

function readingMatches(w) {
  if (!(_live.weight > 0) || !Number.isFinite(_live.weight)) return false
  const target = targetOnScale(w)
  if (!Number.isFinite(target) || target <= 0) return false
  const tol = Number(w.tolerance_percentage)
  const pct = Number.isFinite(tol) && tol > 0 ? tol : 0
  if (pct <= 0) return round3(_live.weight) === round3(target)
  return Math.abs(_live.weight - target) / target * 100 <= pct
}

function weighRow(w, canWeigh) {
  const weighed = isWeighed(w)
  const actual = weighed ? fmtWeight(w.actual_quantity, w.unit) : '—'
  return `
    <div class="proc-weigh-row ${weighed ? 'is-done' : ''}">
      <div>
        <strong>${esc(w.chemical_name)}</strong>
        <span>${esc(lotLine(w))}${weighed && w.notes ? ` · ${esc(w.notes)}` : ''}</span>
        ${!weighed ? `<span>Pesar ${esc(fmtWeight(w.expected_quantity, w.unit))}</span>` : ''}
      </div>
      <em title="Esperado según receta">${esc(fmtWeight(w.expected_quantity, w.unit))}</em>
      <span class="weigh-actual ${weighed ? 'is-on' : ''}" title="Peso capturado">${esc(actual)}</span>
      ${canWeigh && !weighed
        ? `<button type="button" class="btn btn-primary btn-sm weigh-capture is-blocked" data-wid="${w.id}">Capturar peso</button>`
        : ''}
      <input type="checkbox" class="weigh-check" disabled ${weighed ? 'checked' : ''}
        aria-label="${esc(w.chemical_name)} ${weighed ? 'pesado' : 'pendiente'}">
    </div>`
}

function bindCaptureButtons(process, processId, weighings, canWeigh) {
  if (!canWeigh) return
  document.querySelectorAll('.weigh-capture').forEach((btn) => {
    btn.onclick = () => {
      const w = weighings.find((item) => item.id === Number(btn.dataset.wid))
      if (w) captureFromScale(w, process, processId)
    }
  })
}

function normalizeUnit(unit) {
  const v = String(unit || 'kg').trim().toLowerCase()
  if (['g', 'gr', 'gramo', 'gramos'].includes(v)) return 'g'
  if (['kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(v)) return 'kg'
  return v
}

function convertWeight(weight, fromUnit, toUnit) {
  const from = normalizeUnit(fromUnit)
  const to = normalizeUnit(toUnit)
  if (from === to) return weight
  if (from === 'g' && to === 'kg') return weight / 1000
  if (from === 'kg' && to === 'g') return weight * 1000
  return weight
}

function paintLiveWeight() {
  const valueEl  = document.getElementById('weight-value')
  const statusEl = document.getElementById('weight-status')
  const wsEl     = document.getElementById('ws-status')
  const btn      = document.getElementById('btn-connect-scale')
  if (!valueEl) return

  if (_live.connected && _live.weight != null && Number.isFinite(_live.weight)) {
    valueEl.textContent = fmtWeight(_live.weight, scaleUnit())
  } else if (!_live.connected) {
    valueEl.textContent = '---'
  }

  if (statusEl) {
    if (!_live.connected) {
      statusEl.textContent = 'Sin conexión'
      statusEl.className = 'weight-status'
    } else {
      statusEl.textContent = _live.stable ? 'ESTABLE' : 'Estabilizando...'
      statusEl.className = `weight-status ${_live.stable ? 'stable' : 'unstable'}`
    }
  }
  if (wsEl) {
    wsEl.textContent = _live.connected
      ? `Conectado · ${_live.port || _scaleMeta?.port || ''}`
      : 'Sin conexión a la báscula'
  }
  if (btn) {
    btn.textContent = _live.connected ? 'Desconectar' : 'Conectar'
    btn.className = `btn ${_live.connected ? 'btn-secondary' : 'btn-primary'} btn-sm`
  }
  syncCaptureButtons()
}

function syncCaptureButtons() {
  const unit = scaleUnit()
  const pending = _weighings.filter((w) => !isWeighed(w))
  const focus = pending[0]
  const targetEl = document.getElementById('weigh-target-line')
  if (targetEl) {
    if (!_live.connected) {
      targetEl.textContent = 'Conecta la báscula para ver el peso objetivo.'
    } else if (!focus) {
      targetEl.textContent = 'Todos los químicos ya tienen peso capturado.'
    } else {
      const now = _live.weight == null ? '—' : fmtWeight(_live.weight, unit)
      const ok = readingMatches(focus)
      targetEl.textContent = ok
        ? `Peso exacto: ${fmtWeight(focus.expected_quantity, focus.unit)}. Ya puedes capturar.`
        : `Objetivo: ${fmtWeight(focus.expected_quantity, focus.unit)} · Ahora: ${now}. Aún no coinciden.`
      targetEl.classList.toggle('is-warn', !ok)
      targetEl.classList.toggle('is-ok', ok)
    }
  }

  document.querySelectorAll('.weigh-capture').forEach((btn) => {
    const w = _weighings.find((item) => item.id === Number(btn.dataset.wid))
    if (!w) return
    const ok = _live.connected && _live.stable && readingMatches(w)
    btn.classList.toggle('is-blocked', !ok)
    btn.title = ok ? 'Peso exacto. Capturar.' : mismatchMessage(w)
  })
}

async function captureFromScale(w, process, processId) {
  if (!_live.connected || !_ws) {
    toast.warning('Conecta la báscula antes de capturar el peso')
    return
  }
  if (!_live.stable) {
    toast.warning('Espera a que la báscula esté ESTABLE')
    return
  }
  if (!(_live.weight > 0)) {
    toast.warning('La báscula está en cero. Coloca el químico y espera ESTABLE.')
    return
  }
  if (!readingMatches(w)) {
    toast.warning(mismatchMessage(w))
    return
  }

  const actual = convertWeight(_live.weight, scaleUnit(), w.unit)
  const btn = document.querySelector(`.weigh-capture[data-wid="${w.id}"]`)
  if (btn) { btn.disabled = true; btn.textContent = 'Capturando...' }

  try {
    await api.updateWeighing(process.id, w.id, {
      actual_quantity: actual,
      lot_id: w.lot_id || w.suggested_lot_id || undefined,
      scale_id: _scaleId || undefined,
      notes: `lectura ${_live.weight} ${_live.unit || _scaleMeta?.unit || ''}`.trim(),
    })
    toast.success(`Capturado ${fmtWeight(actual, w.unit)} de ${w.chemical_name}`)
    await renderWeighingPanel(document.getElementById('weighing-content'), processId)
  } catch (err) {
    toast.error(err.message)
    if (btn) { btn.disabled = false; btn.textContent = 'Capturar peso' }
  }
}

async function confirmWeighAndStart(process, weighings, processId) {
  const pending = weighings.filter((w) => !isWeighed(w))
  if (pending.length) {
    toast.warning('Captura el peso de todos los químicos con la báscula')
    return
  }

  const btn = document.getElementById('btn-confirm-weigh')
  if (btn) { btn.disabled = true; btn.textContent = 'Confirmando...' }

  try {
    if (process.status !== 'in_progress') {
      await api.updateStatus(process.id, { status: 'in_progress' })
    }
    toast.success('Pesaje confirmado. El proceso pasó a tiñendo.')
    await renderWeighingPanel(document.getElementById('weighing-content'), processId)
  } catch (err) {
    toast.error(err.message)
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar pesaje e iniciar tiñendo' }
  }
}

function setupScaleControls(scaleList) {
  const connectBtn  = document.getElementById('btn-connect-scale')
  const scaleSelect = document.getElementById('scale-select')
  if (!connectBtn || !scaleSelect) return

  scaleSelect.onchange = () => {
    _scaleId = parseInt(scaleSelect.value, 10) || null
    _scaleMeta = scaleList.find((s) => s.id === _scaleId) || null
    if (_ws) {
      closeScaleSocket()
      paintLiveWeight()
    }
  }

  connectBtn.onclick = () => {
    const id = parseInt(scaleSelect.value, 10)
    if (!id) { toast.warning('Selecciona una báscula'); return }

    if (_ws) {
      closeScaleSocket()
      paintLiveWeight()
      return
    }

    _scaleId = id
    _scaleMeta = scaleList.find((s) => s.id === id) || null
    connectBtn.textContent = 'Conectando...'
    connectScale(id)
  }
}

function connectScale(scaleId) {
  _closing = false
  const wsStatusEl = document.getElementById('ws-status')
  if (wsStatusEl) wsStatusEl.textContent = 'Conectando...'

  _ws = openScaleSocket(
    scaleId,
    (data) => {
      if (data?.error) {
        toast.error(data.error)
        closeScaleSocket()
        paintLiveWeight()
        return
      }
      _live.connected = true
      _live.weight = Number(data.weight)
      _live.stable = Boolean(data.stable)
      _live.unit = data.unit || _scaleMeta?.unit || 'kg'
      _live.port = _scaleMeta?.port || ''
      paintLiveWeight()
    },
    (err) => {
      if (_closing) {
        _closing = false
        return
      }
      _ws = null
      _live.connected = false
      _live.stable = false
      paintLiveWeight()
      const wsEl = document.getElementById('ws-status')
      if (wsEl) wsEl.textContent = `Error: ${err.message || 'Conexión perdida'}`
      const btn = document.getElementById('btn-connect-scale')
      if (btn) btn.textContent = 'Reconectar'
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
