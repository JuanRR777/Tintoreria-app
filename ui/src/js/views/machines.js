import { machines as machinesApi, scales as scalesApi } from '../api.js'
import { toast }  from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'
import { setPageHeader } from '../layout.js'

export async function showView(container) {
  setPageHeader({
    title: 'Maquinas y Basculas',
    subtitle: 'Equipo de tintura y perifericos de pesaje',
  })
  container.innerHTML = `
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

const EQUIPMENT_TYPES = [
  { id: 'jet', label: 'Jet' },
  { id: 'overflow', label: 'Overflow' },
  { id: 'carretel', label: 'Carretel (Winch)' },
  { id: 'autoclave', label: 'Autoclave' },
  { id: 'continuo', label: 'Continuo' },
  { id: 'barca', label: 'Barca' },
  { id: 'jigger', label: 'Jigger' },
  { id: 'otro', label: 'Otro' },
]

const LEGACY_TYPES = {
  tintura: 'Tintura', lavado: 'Lavado', secado: 'Secado',
  cardado: 'Cardado', peinado: 'Peinado', hilado: 'Hilado', otros: 'Otros',
}

const DYE_FORMATS = [
  { id: 'madeja', label: 'Madeja', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="8" cy="10" r="3"/><circle cx="16" cy="10" r="3"/><circle cx="12" cy="16" r="3"/></svg>' },
  { id: 'cono', label: 'Cono', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>' },
  { id: 'ambos', label: 'Ambos', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>' },
]

const MACHINE_STATUSES = [
  { id: 'active', label: 'Activa', tone: 'success' },
  { id: 'maintenance', label: 'Mantenimiento', tone: 'warning' },
  { id: 'inactive', label: 'Inactiva', tone: 'muted' },
]

const ICO_CALC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0"/></svg>'

function equipmentLabel(m) {
  const key = m.equipment_type || ''
  const found = EQUIPMENT_TYPES.find((t) => t.id === key)
  if (found) return found.label
  return LEGACY_TYPES[m.machine_type] || m.machine_type || '—'
}

function dyeLabel(m) {
  return DYE_FORMATS.find((f) => f.id === m.dye_format)?.label || '—'
}

function statusMeta(status) {
  return MACHINE_STATUSES.find((s) => s.id === status) || MACHINE_STATUSES[0]
}

function bathRatioText(m) {
  const ratio = Number(m.bath_ratio_l_per_kg)
  if (!ratio) return '—'
  return `1:${ratio}`
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function fmtMachineDate(value) {
  if (!value) return '—'
  const d = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
}

function machineAccent(m) {
  const tones = {
    jet: '#0284c7', overflow: '#0f766e', carretel: '#7c3aed',
    autoclave: '#d97706', continuo: '#0369a1', barca: '#be185d',
    jigger: '#ea580c', otro: '#64748b',
  }
  return tones[m.equipment_type] || '#0284c7'
}

function machineCard(m) {
  const st = statusMeta(m.status)
  const badge = m.status === 'active' ? 'badge-green' : m.status === 'maintenance' ? 'badge-amber' : 'badge-gray'
  const accent = machineAccent(m)
  const year = m.manufacture_year ? `Año ${esc(m.manufacture_year)}` : ''
  return `
    <article class="recipe-card" data-edit-machine="${m.id}" style="--recipe-accent:${accent}">
      <div class="recipe-card-accent"></div>
      <header class="recipe-card-top">
        <span class="badge ${badge}">${st.label}</span>
        <span class="recipe-card-ver">${esc(equipmentLabel(m))}</span>
      </header>
      <p class="recipe-card-code">${esc(m.code || m.name || 'Sin código')}</p>
      <h3 class="recipe-card-name">${esc(m.name || 'Sin nombre')}</h3>
      <p class="recipe-card-meta">
        <span>${esc(dyeLabel(m))}</span>
        ${year ? `<span class="recipe-card-sep">·</span><span>${year}</span>` : ''}
      </p>
      <p class="recipe-card-dates">Creada ${fmtMachineDate(m.created_at)} · Actualizada ${fmtMachineDate(m.updated_at)}</p>
      <div class="recipe-card-stats">
        <div><span>Capacidad</span><strong>${m.capacity_kg ? `${esc(m.capacity_kg)} kg` : '—'}</strong></div>
        <div><span>Agua</span><strong>${m.water_capacity_liters ? `${esc(m.water_capacity_liters)} L` : '—'}</strong></div>
        <div><span>Relación</span><strong>${bathRatioText(m)}</strong></div>
      </div>
      <footer class="recipe-card-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-edit-machine="${m.id}">Editar</button>
        <button type="button" class="btn btn-ghost btn-sm text-danger" data-delete-machine="${m.id}">Eliminar</button>
      </footer>
    </article>`
}

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

    list.innerHTML = `<div class="recipe-grid">${data.map(machineCard).join('')}</div>`

    list.querySelectorAll('.recipe-card').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('[data-delete-machine]')) return
        openMachineForm(parseInt(card.dataset.editMachine, 10), () => loadMachines())
      }
    })
    list.querySelectorAll('[data-edit-machine]').forEach((btn) => {
      if (btn.classList.contains('recipe-card')) return
      btn.onclick = (e) => {
        e.stopPropagation()
        openMachineForm(parseInt(btn.dataset.editMachine, 10), () => loadMachines())
      }
    })
    list.querySelectorAll('[data-delete-machine]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation()
        deleteMachine(parseInt(btn.dataset.deleteMachine, 10))
      }
    })
  } catch (err) {
    document.getElementById('machines-list').innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

function pillValue(name) {
  return document.querySelector(`[data-pill="${name}"].is-on`)?.dataset.value
}

function setPill(name, value) {
  document.querySelectorAll(`[data-pill="${name}"]`).forEach((btn) => {
    btn.classList.toggle('is-on', btn.dataset.value === value)
  })
}

function bindPills() {
  document.querySelectorAll('[data-pill]').forEach((btn) => {
    btn.onclick = () => setPill(btn.dataset.pill, btn.dataset.value)
  })
}

function paintBathRatio() {
  const hint = document.getElementById('mf-ratio')
  if (!hint) return
  const kg = Number(document.getElementById('mf-capacity').value)
  const liters = Number(document.getElementById('mf-water').value)
  if (kg > 0 && liters > 0) {
    hint.classList.add('is-on')
    hint.innerHTML = `${ICO_CALC}<span>Relación de baño resultante: 1:${(liters / kg).toFixed(1)} L/kg</span>`
  } else {
    hint.classList.remove('is-on')
  }
}

function openMachineForm(machineId, onSuccess) {
  const isEdit = machineId !== null
  const formHTML = `
    <form id="machine-form">
      <section class="mf-section">
        <h4 class="mf-section-title">Identificación</h4>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Nombre <span class="required"></span></label>
            <input id="mf-name" class="form-input" placeholder="Nombre de la máquina" required>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo <span class="required"></span></label>
            <select id="mf-type" class="form-select" required>
              <option value="">Seleccionar tipo</option>
              ${EQUIPMENT_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Año de fabricación</label>
            <input id="mf-year" class="form-input" type="number" min="1900" max="2100" placeholder="Ej: 2018">
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <div class="mf-pills" role="group" aria-label="Estado">
              ${MACHINE_STATUSES.map((s) => `
                <button type="button" class="mf-pill is-${s.tone}${s.id === 'active' ? ' is-on' : ''}" data-pill="status" data-value="${s.id}">${s.label}</button>
              `).join('')}
            </div>
          </div>
        </div>
      </section>

      <section class="mf-section">
        <h4 class="mf-section-title">Formato de teñido</h4>
        <div class="mf-pills" role="group" aria-label="Formato de teñido">
          ${DYE_FORMATS.map((f, i) => `
            <button type="button" class="mf-pill is-accent${i === 0 ? ' is-on' : ''}" data-pill="format" data-value="${f.id}">${f.icon}<span>${f.label}</span></button>
          `).join('')}
        </div>
      </section>

      <section class="mf-section">
        <h4 class="mf-section-title">Capacidad y proceso</h4>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Capacidad máxima</label>
            <div class="mf-unit">
              <input id="mf-capacity" class="form-input" type="number" min="0" step="0.1" placeholder="Ej: 100">
              <span>kg</span>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Capacidad de agua</label>
            <div class="mf-unit">
              <input id="mf-water" class="form-input" type="number" min="0" step="0.1" placeholder="Ej: 1000">
              <span>L</span>
            </div>
          </div>
        </div>
        <div id="mf-ratio" class="mf-calc">${ICO_CALC} Relación de baño resultante: 1:0 L/kg</div>
      </section>

      <section class="mf-section">
        <h4 class="mf-section-title">Descripción</h4>
        <div class="form-group" style="margin-bottom:0">
          <textarea id="mf-notes" class="form-textarea" placeholder="Notas adicionales"></textarea>
        </div>
      </section>
      <div id="mf-error" class="form-error" style="display:none"></div>
    </form>
  `
  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
    <button class="btn btn-primary" id="mf-submit">${isEdit ? 'Guardar' : 'Crear'}</button>
  `
  openModal(isEdit ? 'Editar máquina' : 'Nueva máquina', formHTML, { size: 'lg', footerHTML: footer })
  bindPills()
  document.getElementById('mf-capacity').oninput = paintBathRatio
  document.getElementById('mf-water').oninput = paintBathRatio

  if (isEdit) {
    machinesApi.get(machineId).then((m) => {
      document.getElementById('mf-name').value = m.name || ''
      document.getElementById('mf-type').value = m.equipment_type || ''
      document.getElementById('mf-capacity').value = m.capacity_kg || ''
      document.getElementById('mf-water').value = m.water_capacity_liters || ''
      document.getElementById('mf-year').value = m.manufacture_year || ''
      document.getElementById('mf-notes').value = m.notes || ''
      setPill('status', m.status || 'active')
      setPill('format', m.dye_format || 'madeja')
      paintBathRatio()
    })
  }

  document.getElementById('mf-submit').onclick = async () => {
    const errEl = document.getElementById('mf-error')
    const name = document.getElementById('mf-name').value.trim()
    const type = document.getElementById('mf-type').value
    const dyeFormat = pillValue('format')
    if (!name || !type) {
      errEl.textContent = 'Nombre y tipo son obligatorios'
      errEl.style.display = 'block'
      return
    }
    if (!dyeFormat) {
      errEl.textContent = 'El formato de teñido es obligatorio'
      errEl.style.display = 'block'
      return
    }

    const payload = {
      name,
      machine_type: 'tintura',
      equipment_type: type,
      dye_format: dyeFormat,
      capacity_kg: parseFloat(document.getElementById('mf-capacity').value) || 0,
      water_capacity_liters: parseFloat(document.getElementById('mf-water').value) || 0,
      manufacture_year: parseInt(document.getElementById('mf-year').value, 10) || undefined,
      status: pillValue('status') || 'active',
      notes: document.getElementById('mf-notes').value.trim() || undefined,
    }

    const btn = document.getElementById('mf-submit')
    btn.disabled = true
    errEl.style.display = 'none'

    try {
      if (isEdit) { await machinesApi.update(machineId, payload); toast.success('Máquina actualizada') }
      else { await machinesApi.create(payload); toast.success('Máquina creada') }
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
