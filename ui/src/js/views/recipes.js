import { recipes as api, chemicals } from '../api.js'
import { toast }  from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'
import { setPageHeader } from '../layout.js'

export async function showView(container) {
  setPageHeader({
    title: 'Recetas',
    subtitle: 'Formulas estandar de tintura: ingredientes, pasos y parametros de bano',
    actionsHtml: `
      <button class="btn btn-primary" id="btn-new-recipe">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nueva receta
      </button>`,
  })
  container.innerHTML = `
    <div class="toolbar">
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="search-recipes" placeholder="Buscar por nombre, codigo o tipo de fibra...">
      </div>
    </div>

    <div id="recipes-list"></div>
  `

  document.getElementById('btn-new-recipe').onclick = () => openRecipeForm(null, reload)

  let debounce
  document.getElementById('search-recipes').oninput = (e) => {
    clearTimeout(debounce)
    debounce = setTimeout(() => reload(e.target.value), 300)
  }

  async function reload(search = '') {
    await loadRecipes({ search: search || undefined })
  }
  await reload()
}

async function loadRecipes(params = {}) {
  const list = document.getElementById('recipes-list')
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
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <h3>Sin recetas</h3><p>Crea la primera receta de tintura.</p>
      </div>`
    return
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Codigo</th><th>Nombre</th><th>Fibra</th>
            <th>Temp (C)</th><th>Relacion bano</th><th>Version</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${items.map(r => recipeRow(r)).join('')}
        </tbody>
      </table>
    </div>
  `

  container.querySelectorAll('[data-view]').forEach(btn =>
    btn.onclick = () => openRecipeDetail(parseInt(btn.dataset.view))
  )
  container.querySelectorAll('[data-edit]').forEach(btn =>
    btn.onclick = () => openRecipeForm(parseInt(btn.dataset.edit), () => loadRecipes())
  )
  container.querySelectorAll('[data-delete]').forEach(btn =>
    btn.onclick = () => deleteRecipe(parseInt(btn.dataset.delete))
  )
}

function recipeRow(r) {
  return `
    <tr>
      <td><code>${r.code}</code></td>
      <td><span style="font-weight:500">${r.name}</span></td>
      <td style="color:var(--text-muted)">${r.fiber_type || '-'}</td>
      <td style="font-variant-numeric:tabular-nums">${r.temperature_c ? r.temperature_c + '°' : '-'}</td>
      <td style="font-variant-numeric:tabular-nums">${r.bath_ratio_l_per_kg ? r.bath_ratio_l_per_kg + ':1' : '-'}</td>
      <td style="color:var(--text-muted)">v${r.version}</td>
      <td><span class="badge ${r.is_active ? 'badge-green' : 'badge-gray'}">${r.is_active ? 'Activa' : 'Inactiva'}</span></td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-ghost btn-sm" data-view="${r.id}">Ver detalle</button>
          <button class="btn btn-ghost btn-sm" data-edit="${r.id}">Editar</button>
          <button class="btn btn-ghost btn-sm text-danger" data-delete="${r.id}">Eliminar</button>
        </div>
      </td>
    </tr>
  `
}

// ---------------------------------------------------------------------------
// Formulario receta
// ---------------------------------------------------------------------------

function openRecipeForm(recipeId, onSuccess) {
  const isEdit = recipeId !== null

  const formHTML = `
    <form id="recipe-form">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Nombre <span class="required"></span></label>
          <input id="rf-name" class="form-input" placeholder="Nombre de la receta" required>
        </div>
        <div class="form-group">
          <label class="form-label">Codigo</label>
          <input id="rf-code" class="form-input" placeholder="Se genera automaticamente">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Tipo de fibra</label>
          <select id="rf-fiber" class="form-select">
            <option value="">No especificado</option>
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
          <label class="form-label">Color objetivo</label>
          <input id="rf-color" class="form-input" placeholder="Ej: ROJO-115, AZUL-MARINO">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Temperatura (C)</label>
          <input id="rf-temp" class="form-input" type="number" min="0" max="200" step="1" placeholder="Ej: 98">
        </div>
        <div class="form-group">
          <label class="form-label">Relacion de bano (L/kg)</label>
          <input id="rf-ratio" class="form-input" type="number" min="0.1" step="0.1" placeholder="Ej: 10">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">pH objetivo</label>
          <input id="rf-ph" class="form-input" type="number" min="0" max="14" step="0.1" placeholder="Ej: 5.5">
        </div>
        <div class="form-group">
          <label class="form-label">Tolerancia de pesaje (%)</label>
          <input id="rf-tolerance" class="form-input" type="number" min="0" max="100" step="0.5" value="5">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Descripcion</label>
        <textarea id="rf-desc" class="form-textarea" placeholder="Descripcion general de la receta"></textarea>
      </div>
      <div id="rf-error" class="form-error" style="display:none"></div>
    </form>
  `

  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
    <button class="btn btn-primary" id="rf-submit">${isEdit ? 'Guardar' : 'Crear receta'}</button>
  `

  openModal(isEdit ? 'Editar receta' : 'Nueva receta', formHTML, { footerHTML: footer })

  if (isEdit) {
    api.get(recipeId).then(r => {
      document.getElementById('rf-name').value      = r.name || ''
      document.getElementById('rf-code').value      = r.code || ''
      document.getElementById('rf-fiber').value     = r.fiber_type || ''
      document.getElementById('rf-color').value     = r.target_color || ''
      document.getElementById('rf-temp').value      = r.temperature_c || ''
      document.getElementById('rf-ratio').value     = r.bath_ratio_l_per_kg || ''
      document.getElementById('rf-ph').value        = r.target_ph || ''
      document.getElementById('rf-tolerance').value = r.weighing_tolerance_percent || 5
      document.getElementById('rf-desc').value      = r.description || ''
    })
  }

  document.getElementById('rf-submit').onclick = async () => {
    const errEl  = document.getElementById('rf-error')
    const submit = document.getElementById('rf-submit')
    const name   = document.getElementById('rf-name').value.trim()

    if (!name) { errEl.textContent = 'El nombre es obligatorio'; errEl.style.display = 'block'; return }

    const payload = {
      name,
      code:                    document.getElementById('rf-code').value.trim() || undefined,
      fiber_type:              document.getElementById('rf-fiber').value      || undefined,
      target_color:            document.getElementById('rf-color').value.trim() || undefined,
      temperature_c:           parseFloat(document.getElementById('rf-temp').value)      || undefined,
      bath_ratio_l_per_kg:     parseFloat(document.getElementById('rf-ratio').value)     || undefined,
      target_ph:               parseFloat(document.getElementById('rf-ph').value)        || undefined,
      weighing_tolerance_percent: parseFloat(document.getElementById('rf-tolerance').value) || 5,
      description:             document.getElementById('rf-desc').value.trim() || undefined,
    }

    submit.disabled = true
    submit.textContent = 'Guardando...'
    errEl.style.display = 'none'

    try {
      if (isEdit) {
        await api.update(recipeId, payload)
        toast.success('Receta actualizada')
      } else {
        await api.create(payload)
        toast.success('Receta creada')
      }
      closeModal()
      if (onSuccess) onSuccess()
    } catch (err) {
      errEl.textContent  = err.message
      errEl.style.display = 'block'
      submit.disabled    = false
      submit.textContent = isEdit ? 'Guardar' : 'Crear receta'
    }
  }
}

// ---------------------------------------------------------------------------
// Vista de detalle con ingredientes y pasos
// ---------------------------------------------------------------------------

async function openRecipeDetail(recipeId) {
  const recipe = await api.get(recipeId)
  const chemList = await chemicals.list()

  const stepsHTML = recipe.steps?.length
    ? `<div class="table-wrapper"><table class="data-table">
        <thead><tr><th>#</th><th>Nombre del paso</th><th>Duracion (min)</th><th>Temp. final (C)</th><th>Descripcion</th></tr></thead>
        <tbody>
          ${recipe.steps.map(s => `
            <tr>
              <td>${s.step_order}</td>
              <td>${s.step_name}</td>
              <td>${s.duration_minutes ?? '-'}</td>
              <td>${s.target_temperature_c ?? '-'}</td>
              <td style="color:var(--text-muted);font-size:12px">${s.description || ''}</td>
            </tr>`).join('')}
        </tbody>
       </table></div>`
    : '<p style="color:var(--text-muted);font-size:13px">Sin pasos definidos</p>'

  const ingredientsHTML = recipe.ingredients?.length
    ? `<div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Quimico</th><th>Cantidad por kg de fibra</th><th>Unidad</th><th>Tolerancia (%)</th></tr></thead>
        <tbody>
          ${recipe.ingredients.map(i => `
            <tr>
              <td>${i.chemical_name} <code style="font-size:11px">${i.chemical_code}</code></td>
              <td style="font-weight:600">${i.quantity_per_kg}</td>
              <td>${i.unit}</td>
              <td>${i.tolerance_percent}</td>
            </tr>`).join('')}
        </tbody>
       </table></div>
       <div style="margin-top:12px">
         <h4 style="font-size:12px;font-weight:600;margin-bottom:8px">Agregar ingrediente</h4>
         <div class="form-row">
           <select id="add-chem-select" class="form-select" style="flex:1">
             <option value="">Seleccionar quimico</option>
             ${chemList.map(c => `<option value="${c.id}">${c.name} (${c.unit})</option>`).join('')}
           </select>
           <input id="add-qty" class="form-input" type="number" min="0.001" step="0.001" placeholder="g/kg" style="width:120px">
           <button class="btn btn-primary" id="add-ingredient-btn">Agregar</button>
         </div>
       </div>`
    : `<p style="color:var(--text-muted);font-size:13px">Sin ingredientes.
        <button class="btn btn-ghost btn-sm" id="show-add-ingredient">Agregar primero</button></p>`

  const body = `
    <div style="margin-bottom:16px">
      <div class="form-row" style="gap:24px">
        <div><div class="form-label">Fibra</div><div>${recipe.fiber_type || '-'}</div></div>
        <div><div class="form-label">Temperatura</div><div>${recipe.temperature_c ? recipe.temperature_c + ' C' : '-'}</div></div>
        <div><div class="form-label">Relacion bano</div><div>${recipe.bath_ratio_l_per_kg ? recipe.bath_ratio_l_per_kg + ':1' : '-'}</div></div>
        <div><div class="form-label">pH objetivo</div><div>${recipe.target_ph || '-'}</div></div>
      </div>
    </div>
    <h4 style="margin:0 0 8px;font-size:13px;font-weight:600">Ingredientes</h4>
    <div id="detail-ingredients">${ingredientsHTML}</div>
    <div class="separator"></div>
    <h4 style="margin:0 0 8px;font-size:13px;font-weight:600">Pasos del proceso</h4>
    ${stepsHTML}
  `

  const footer = `<button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cerrar</button>`
  openModal(`${recipe.code} - ${recipe.name}`, body, { size: 'lg', footerHTML: footer })

  const addBtn = document.getElementById('add-ingredient-btn')
  if (addBtn) {
    addBtn.onclick = async () => {
      const chemId = parseInt(document.getElementById('add-chem-select').value)
      const qty    = parseFloat(document.getElementById('add-qty').value)
      if (!chemId || !qty) { toast.warning('Selecciona quimico y cantidad'); return }
      const chem = chemList.find(c => c.id === chemId)
      try {
        await api.addIngredient(recipeId, { chemical_id: chemId, quantity_per_kg: qty, unit: chem?.unit || 'g' })
        toast.success('Ingrediente agregado')
        closeModal()
        await openRecipeDetail(recipeId)
      } catch (err) { toast.error(err.message) }
    }
  }
}

async function deleteRecipe(id) {
  const ok = await confirm('Eliminar esta receta. Solo es posible si no tiene procesos activos.', 'Eliminar receta')
  if (!ok) return
  try {
    await api.delete(id)
    toast.success('Receta eliminada')
    await loadRecipes()
  } catch (err) { toast.error(err.message) }
}
