import { machines as machinesApi, scales as scalesApi } from '../api.js'
import { toast }  from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'

export async function showView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Maquinas y Basculas</h1>
        <p class="page-subtitle">Equipo de tintura y perifericos de pesaje</p>
      </div>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:16px">
      <button class="btn ${_tab==='machines'?'btn-primary':'btn-secondary'}" id="tab-machines" data-tab="machines">Maquinas</button>
      <button class="btn ${_tab==='scales'?'btn-primary':'btn-secondary'}"   id="tab-scales"   data-tab="scales">Basculas</button>
    </div>
    <div id="machines-panel"></div>
  `

  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => {
      _tab = btn.dataset.tab
      document.querySelectorAll('[data-tab]').forEach(b => b.className = `btn ${_tab === b.dataset.tab ? 'btn-primary' : 'btn-secondary'}`)
      render()
    }
  })

  async function render() {
    if (_tab === 'machines') await loadMachines()
    else await loadScales()
  }
  await render()
}

let _tab = 'machines'

// ---------------------------------------------------------------------------
// Maquinas
// ---------------------------------------------------------------------------

async function loadMachines() {
  const panel = document.getElementById('machines-panel')
  if (!panel) return
  panel.innerHTML = `
    <div class="toolbar" style="margin-bottom:12px">
      <div style="flex:1"></div>
      <button class="btn btn-primary" id="btn-new-machine">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nueva maquina
      </button>
    </div>
    <div id="machines-list"><div class="loading-state"><div class="spinner"></div></div></div>
  `
  document.getElementById('btn-new-machine').onclick = () => openMachineForm(null, () => loadMachines())

  try {
    const data = await machinesApi.list()
    const list = document.getElementById('machines-list')

    if (!data.length) {
      list.innerHTML = '<div class="empty-state"><p>Sin maquinas registradas</p></div>'
      return
    }

    list.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Capacidad (kg)</th><th>Año</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${data.map(m => `
              <tr>
                <td><span style="font-weight:500">${m.name}</span></td>
                <td style="color:var(--text-muted)">${m.machine_type}</td>
                <td style="font-variant-numeric:tabular-nums">${m.capacity_kg ?? '-'}</td>
                <td style="color:var(--text-muted)">${m.manufacture_year || '-'}</td>
                <td><span class="badge ${m.status === 'active' ? 'badge-green' : m.status === 'maintenance' ? 'badge-amber' : 'badge-gray'}">${m.status}</span></td>
                <td>
                  <div class="actions-cell">
                    <button class="btn btn-ghost btn-sm" data-edit-machine="${m.id}">Editar</button>
                    <button class="btn btn-ghost btn-sm text-danger" data-delete-machine="${m.id}">Eliminar</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `

    list.querySelectorAll('[data-edit-machine]').forEach(btn =>
      btn.onclick = () => openMachineForm(parseInt(btn.dataset.editMachine), () => loadMachines())
    )
    list.querySelectorAll('[data-delete-machine]').forEach(btn =>
      btn.onclick = () => deleteMachine(parseInt(btn.dataset.deleteMachine))
    )
  } catch (err) {
    document.getElementById('machines-list').innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

function openMachineForm(machineId, onSuccess) {
  const isEdit = machineId !== null
  const formHTML = `
    <form id="machine-form">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Nombre <span class="required"></span></label>
          <input id="mf-name" class="form-input" placeholder="Nombre de la maquina" required>
        </div>
        <div class="form-group">
          <label class="form-label">Tipo <span class="required"></span></label>
          <select id="mf-type" class="form-select" required>
            <option value="">Seleccionar tipo</option>
            <option value="devanadora">Devanadora</option>
            <option value="madejera">Madejera</option>
            <option value="tintureria">Tintureria</option>
            <option value="centrifuga">Centrifuga</option>
            <option value="secadora">Secadora</option>
            <option value="lavadora">Lavadora</option>
            <option value="otro">Otro</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Capacidad (kg)</label>
          <input id="mf-capacity" class="form-input" type="number" min="0" step="0.1" placeholder="Ej: 100">
        </div>
        <div class="form-group">
          <label class="form-label">Ano de fabricacion</label>
          <input id="mf-year" class="form-input" type="number" min="1900" max="2100" placeholder="Ej: 2018">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Estado</label>
        <select id="mf-status" class="form-select">
          <option value="active">Activa</option>
          <option value="maintenance">En mantenimiento</option>
          <option value="inactive">Inactiva</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Descripcion</label>
        <textarea id="mf-notes" class="form-textarea" placeholder="Notas adicionales"></textarea>
      </div>
      <div id="mf-error" class="form-error" style="display:none"></div>
    </form>
  `
  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
    <button class="btn btn-primary" id="mf-submit">${isEdit ? 'Guardar' : 'Crear'}</button>
  `
  openModal(isEdit ? 'Editar maquina' : 'Nueva maquina', formHTML, { footerHTML: footer })

  if (isEdit) {
    machinesApi.get(machineId).then(m => {
      document.getElementById('mf-name').value     = m.name || ''
      document.getElementById('mf-type').value     = m.machine_type || ''
      document.getElementById('mf-capacity').value = m.capacity_kg || ''
      document.getElementById('mf-year').value     = m.manufacture_year || ''
      document.getElementById('mf-status').value   = m.status || 'active'
      document.getElementById('mf-notes').value    = m.notes || ''
    })
  }

  document.getElementById('mf-submit').onclick = async () => {
    const errEl = document.getElementById('mf-error')
    const name  = document.getElementById('mf-name').value.trim()
    const type  = document.getElementById('mf-type').value
    if (!name || !type) { errEl.textContent = 'Nombre y tipo son obligatorios'; errEl.style.display = 'block'; return }

    const payload = {
      name,
      machine_type:     type,
      capacity_kg:      parseFloat(document.getElementById('mf-capacity').value) || undefined,
      manufacture_year: parseInt(document.getElementById('mf-year').value)        || undefined,
      status:           document.getElementById('mf-status').value,
      notes:            document.getElementById('mf-notes').value.trim() || undefined,
    }

    const btn = document.getElementById('mf-submit')
    btn.disabled = true
    errEl.style.display = 'none'

    try {
      if (isEdit) { await machinesApi.update(machineId, payload); toast.success('Maquina actualizada') }
      else        { await machinesApi.create(payload);            toast.success('Maquina creada') }
      closeModal()
      if (onSuccess) onSuccess()
    } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; btn.disabled = false }
  }
}

async function deleteMachine(id) {
  const ok = await confirm('Eliminar esta maquina del sistema.', 'Eliminar maquina')
  if (!ok) return
  try { await machinesApi.delete(id); toast.success('Maquina eliminada'); await loadMachines() }
  catch (err) { toast.error(err.message) }
}

// ---------------------------------------------------------------------------
// Basculas
// ---------------------------------------------------------------------------

async function loadScales() {
  const panel = document.getElementById('machines-panel')
  if (!panel) return
  panel.innerHTML = `
    <div class="toolbar" style="margin-bottom:12px">
      <div style="flex:1"></div>
      <button class="btn btn-primary" id="btn-new-scale">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nueva bascula
      </button>
    </div>
    <div id="scales-list"><div class="loading-state"><div class="spinner"></div></div></div>
  `
  document.getElementById('btn-new-scale').onclick = () => openScaleForm(null, () => loadScales())

  try {
    const data = await scalesApi.list()
    const list = document.getElementById('scales-list')

    if (!data.length) { list.innerHTML = '<div class="empty-state"><p>Sin basculas registradas</p></div>'; return }

    list.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Nombre</th><th>Puerto</th><th>Protocolo</th><th>Baud rate</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${data.map(s => `
              <tr>
                <td><span style="font-weight:500">${s.name}</span></td>
                <td><code>${s.port}</code></td>
                <td style="color:var(--text-muted)">${s.protocol}</td>
                <td style="color:var(--text-muted)">${s.baud_rate}</td>
                <td><span class="badge ${s.is_active ? 'badge-green' : 'badge-gray'}">${s.is_active ? 'Activa' : 'Inactiva'}</span></td>
                <td>
                  <div class="actions-cell">
                    <button class="btn btn-ghost btn-sm" data-edit-scale="${s.id}">Editar</button>
                    <button class="btn btn-ghost btn-sm text-danger" data-delete-scale="${s.id}">Eliminar</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `

    list.querySelectorAll('[data-edit-scale]').forEach(btn =>
      btn.onclick = () => openScaleForm(parseInt(btn.dataset.editScale), () => loadScales())
    )
    list.querySelectorAll('[data-delete-scale]').forEach(btn =>
      btn.onclick = () => deleteScale(parseInt(btn.dataset.deleteScale))
    )
  } catch (err) {
    document.getElementById('scales-list').innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

async function openScaleForm(scaleId, onSuccess) {
  const isEdit = scaleId !== null
  let ports = []
  try { ports = await scalesApi.ports() } catch { ports = [] }

  const formHTML = `
    <form id="scale-form">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Nombre <span class="required"></span></label>
          <input id="sf-name" class="form-input" placeholder="Ej: Bascula de dosificacion" required>
        </div>
        <div class="form-group">
          <label class="form-label">Puerto COM <span class="required"></span></label>
          <select id="sf-port" class="form-select" required>
            <option value="">Seleccionar puerto</option>
            ${ports.map(p => `<option value="${p.port}">${p.port} - ${p.description}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Protocolo</label>
          <select id="sf-protocol" class="form-select">
            <option value="generic">Generico</option>
            <option value="toledo">Toledo</option>
            <option value="sartorius">Sartorius</option>
            <option value="mettler">Mettler</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Baud rate</label>
          <select id="sf-baud" class="form-select">
            <option value="9600">9600</option>
            <option value="2400">2400</option>
            <option value="4800">4800</option>
            <option value="19200">19200</option>
          </select>
        </div>
      </div>
      <div id="sf-error" class="form-error" style="display:none"></div>
    </form>
  `
  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
    <button class="btn btn-primary" id="sf-submit">${isEdit ? 'Guardar' : 'Crear'}</button>
  `
  openModal(isEdit ? 'Editar bascula' : 'Nueva bascula', formHTML, { footerHTML: footer })

  if (isEdit) {
    scalesApi.get(scaleId).then(s => {
      document.getElementById('sf-name').value     = s.name || ''
      document.getElementById('sf-port').value     = s.port || ''
      document.getElementById('sf-protocol').value = s.protocol || 'generic'
      document.getElementById('sf-baud').value     = s.baud_rate || 9600
    })
  }

  document.getElementById('sf-submit').onclick = async () => {
    const errEl = document.getElementById('sf-error')
    const name  = document.getElementById('sf-name').value.trim()
    const port  = document.getElementById('sf-port').value
    if (!name || !port) { errEl.textContent = 'Nombre y puerto son obligatorios'; errEl.style.display = 'block'; return }

    const payload = {
      name,
      port,
      protocol:  document.getElementById('sf-protocol').value,
      baud_rate: parseInt(document.getElementById('sf-baud').value),
    }

    const btn = document.getElementById('sf-submit')
    btn.disabled = true
    errEl.style.display = 'none'

    try {
      if (isEdit) { await scalesApi.update(scaleId, payload); toast.success('Bascula actualizada') }
      else        { await scalesApi.create(payload);          toast.success('Bascula registrada') }
      closeModal()
      if (onSuccess) onSuccess()
    } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; btn.disabled = false }
  }
}

async function deleteScale(id) {
  const ok = await confirm('Eliminar esta bascula.', 'Eliminar bascula')
  if (!ok) return
  try { await scalesApi.delete(id); toast.success('Bascula eliminada'); await loadScales() }
  catch (err) { toast.error(err.message) }
}
