import { recipes as api, chemicals } from '../api.js'
import { toast }  from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'
import { setPageHeader } from '../layout.js'
import { isAdmin } from '../session.js'
import { closeFloatList, isFloatListOpen, openFloatList, updateFloatList } from '../components/float-list.js'

const FIBER_LABELS = {
  lana: 'Lana', algodon: 'Algodón', acrilico: 'Acrílico', poliester: 'Poliéster',
  nylon: 'Nylon', seda: 'Seda', mezcla: 'Mezcla', otros: 'Otros',
}

const BATH_STAGES = [
  { id: 'preparacion', label: 'Preparación', tone: 'info', hint: 'Auxiliares y preparación del baño' },
  { id: 'tincion', label: 'Tinción', tone: 'accent', hint: 'Colorantes y proceso de tintura' },
  { id: 'fijacion', label: 'Fijación', tone: 'warning', hint: 'Fijadores y cierre del color' },
  { id: 'acabado', label: 'Acabado', tone: 'success', hint: 'Suavizantes y enjuagues finales' },
]

const CHEM_TYPE_LABELS = {
  acido: 'Ácido', reactivo: 'Reactivo', directo: 'Directo', auxiliar: 'Auxiliar',
  mordiente: 'Mordiente', disperso: 'Disperso', vat: 'Vat',
  blanqueador: 'Blanqueador', otros: 'Otros',
}

const STEP_TYPES = [
  { id: 'pre_lavado', label: 'Pre-lavado' },
  { id: 'bano_tinte', label: 'Baño de tinte' },
  { id: 'fijacion', label: 'Fijación' },
  { id: 'lavado', label: 'Lavado' },
  { id: 'enjuague', label: 'Enjuague' },
  { id: 'secado', label: 'Secado' },
  { id: 'otros', label: 'Otros' },
]

const RECIPE_ING_PAGE = 4
const recipeIngPage = new Map()
let recipeQuery = { search: '', status: '' }
const chemTypeById = new Map()
const chemTypeByCode = new Map()

const RECIPE_STATUSES = [
  { id: 'active', label: 'Activa', badge: 'badge-green' },
  { id: 'development', label: 'En desarrollo', badge: 'badge-blue' },
  { id: 'inactive', label: 'Inactiva', badge: 'badge-gray' },
  { id: 'discarded', label: 'Descartada', badge: 'badge-red' },
]

function recipeLifecycle(r) {
  return r.lifecycle || (
    r.status === 'archived' ? 'discarded'
      : r.status === 'draft' ? 'development'
        : Number(r.is_active) ? 'active' : 'inactive'
  )
}

function recipeStatusMeta(id) {
  return RECIPE_STATUSES.find((s) => s.id === id) || RECIPE_STATUSES[0]
}

function fmtRecipeDate(value) {
  if (!value) return '—'
  const raw = String(value).trim()
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

const WIZ_STEPS = [
  { label: 'Datos', caption: 'Identidad' },
  { label: 'Ingredientes', caption: 'Fórmula' },
  { label: 'Pasos', caption: 'Proceso' },
  { label: 'Resumen', caption: 'Revisión' },
]

const WIZ_ICO = {
  doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  bath: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v6"/><path d="M8 8h8l1 12H7L8 8z"/><path d="M9 12h6"/></svg>',
  flask: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-9V3"/></svg>',
  list: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1.2" fill="currentColor"/><circle cx="4" cy="12" r="1.2" fill="currentColor"/><circle cx="4" cy="18" r="1.2" fill="currentColor"/></svg>',
}

function uid() {
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function recipeDraftKey(recipeId) {
  return recipeId == null ? 'tintoreria.recipe-draft.new' : `tintoreria.recipe-draft.${recipeId}`
}

function readRecipeDraft(recipeId) {
  try {
    const raw = sessionStorage.getItem(recipeDraftKey(recipeId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeRecipeDraft(recipeId, data) {
  try {
    sessionStorage.setItem(recipeDraftKey(recipeId), JSON.stringify(data))
  } catch { /* ignore quota */ }
}

function clearRecipeDraft(recipeId) {
  try { sessionStorage.removeItem(recipeDraftKey(recipeId)) } catch { /* ignore */ }
}

async function askLeaveRecipe() {
  const Swal = window.Swal || window.Sweetalert2
  if (Swal?.fire) {
    const res = await Swal.fire({
      title: '¿Cerrar la receta?',
      text: 'Se guarda un borrador. Al volver a abrir, continúa donde ibas.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Cerrar',
      cancelButtonText: 'Seguir editando',
      reverseButtons: true,
    })
    return res.isConfirmed
  }
  return window.confirm('¿Cerrar la receta? Se guardará un borrador para continuar después.')
}

function sampleProcessSteps() {
  return [
    { uid: uid(), name: 'Preparación del baño', type: 'pre_lavado', duration: 15, temp: 40, notes: 'Llenar, dosificar auxiliares y homogeneizar.' },
    { uid: uid(), name: 'Carga de colorantes', type: 'bano_tinte', duration: 10, temp: 40, notes: 'Agregar colorantes disueltos en el baño.' },
    { uid: uid(), name: 'Subida de temperatura', type: 'bano_tinte', duration: 30, temp: 98, notes: 'Elevar de forma controlada hasta temperatura de tintura.' },
    { uid: uid(), name: 'Tinción / mantenimiento', type: 'bano_tinte', duration: 45, temp: 98, notes: 'Mantener tiempo de agotamiento del color.' },
    { uid: uid(), name: 'Fijación', type: 'fijacion', duration: 20, temp: 80, notes: 'Aplicar fijador según receta.' },
    { uid: uid(), name: 'Enjuague y acabado', type: 'lavado', duration: 15, temp: 40, notes: 'Enjuagar y acondicionar la fibra.' },
  ]
}

export async function showView(container) {
  closeFloatList()
  setPageHeader({
    title: 'Recetas',
    subtitle: 'Fórmulas estándar de tintura: ingredientes, pasos y parámetros de baño',
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
        <input type="text" id="search-recipes" placeholder="Buscar por nombre, código o tipo de fibra..." value="${esc(recipeQuery.search)}">
      </div>
      <div class="recipe-filters" id="recipe-filters">
        <button type="button" class="recipe-filter ${recipeQuery.status ? '' : 'is-active'}" data-status="">Todas</button>
        ${RECIPE_STATUSES.map((s) => `
          <button type="button" class="recipe-filter ${recipeQuery.status === s.id ? 'is-active' : ''}" data-status="${s.id}">${s.label}</button>
        `).join('')}
      </div>
    </div>

    <div id="recipes-list"></div>
  `

  document.getElementById('btn-new-recipe').onclick = () => openRecipeForm(null, () => loadRecipes())

  let debounce
  document.getElementById('search-recipes').oninput = (e) => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      recipeQuery.search = e.target.value
      loadRecipes()
    }, 300)
  }
  document.getElementById('recipe-filters').onclick = (e) => {
    const btn = e.target.closest('[data-status]')
    if (!btn) return
    recipeQuery.status = btn.dataset.status
    document.querySelectorAll('.recipe-filter').forEach((el) => el.classList.toggle('is-active', el === btn))
    loadRecipes()
  }
  await loadRecipes()
}

async function loadRecipes(params = {}) {
  const list = document.getElementById('recipes-list')
  if (!list) return
  closeFloatList()
  list.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div>'
  try {
    const search = params.search ?? recipeQuery.search
    const status = params.status ?? recipeQuery.status
    const data = await api.list({
      ...params,
      search: search || undefined,
      status: status || undefined,
    })
    renderCards(data, list)
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

function renderCards(items, container) {
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <h3>Sin recetas</h3><p>Crea la primera receta de tintura.</p>
      </div>`
    return
  }

  container.innerHTML = `<div class="recipe-grid">${items.map(recipeCard).join('')}</div>`
  bindRecipeCards(container, items)
}

function recipeAccent(r) {
  const hex = String(r.target_color_hex || '').trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return hex
  const tones = {
    lana: '#d97706', algodon: '#0284c7', acrilico: '#7c3aed',
    poliester: '#0f766e', nylon: '#0369a1', seda: '#be185d',
    mezcla: '#475569', otros: '#64748b',
  }
  return tones[r.fiber_type] || '#0284c7'
}

function recipeCard(r) {
  const fiber = FIBER_LABELS[r.fiber_type] || r.fiber_type || 'Sin fibra'
  const color = r.color_name || r.color_reference || ''
  const accent = recipeAccent(r)
  const known = Array.isArray(r.ingredients)
  const nIngs = known ? r.ingredients.length : Number(r.ingredient_count || 0)
  const life = recipeLifecycle(r)
  const st = recipeStatusMeta(life)
  const admin = isAdmin()
  return `
    <article class="recipe-card" data-view="${r.id}" style="--recipe-accent:${accent}">
      <div class="recipe-card-accent"></div>
      <header class="recipe-card-top">
        ${admin
          ? `<select class="recipe-status-sel ${st.badge}" data-status-id="${r.id}" title="Cambiar estado">
              ${RECIPE_STATUSES.map((s) => `<option value="${s.id}" ${s.id === life ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>`
          : `<span class="badge ${st.badge}">${st.label}</span>`}
        <span class="recipe-card-ver">v${r.version || 1}</span>
      </header>
      <p class="recipe-card-code">${esc(r.code || 'Sin código')}</p>
      <h3 class="recipe-card-name">${esc(r.name || 'Sin nombre')}</h3>
      <p class="recipe-card-meta">
        ${color ? `<span class="recipe-card-dot" style="background:${accent}"></span><span>${esc(color)}</span><span class="recipe-card-sep">·</span>` : ''}
        <span>${esc(fiber)}</span>
      </p>
      <p class="recipe-card-dates">Creada ${fmtRecipeDate(r.created_at)} · Actualizada ${fmtRecipeDate(r.updated_at)}</p>
      <div class="recipe-card-stats">
        <div><span>Temperatura</span><strong>${r.temperature_c ? `${esc(r.temperature_c)} °C` : '—'}</strong></div>
        <div><span>Relación</span><strong>${r.bath_ratio_l_per_kg ? `${esc(r.bath_ratio_l_per_kg)}:1` : '—'}</strong></div>
        <div><span>Proceso</span><strong>${r.process_time_min ? `${esc(r.process_time_min)} min` : '—'}</strong></div>
      </div>
      <div class="recipe-ings">
        <button type="button" class="recipe-ings-toggle" data-ings="${r.id}" aria-expanded="false" ${known && !nIngs ? 'disabled' : ''}>
          <span>Químicos</span>
          <strong>${known || r.ingredient_count != null ? nIngs : '…'}</strong>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <footer class="recipe-card-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-view="${r.id}">Ver</button>
        <button type="button" class="btn btn-ghost btn-sm" data-edit="${r.id}">Editar</button>
        <button type="button" class="btn btn-ghost btn-sm text-danger" data-delete="${r.id}">Eliminar</button>
      </footer>
    </article>`
}

function bindRecipeCards(container, items) {
  const byId = new Map(items.map((r) => [Number(r.id), r]))

  container.querySelectorAll('.recipe-card').forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('[data-edit], [data-delete], .recipe-ings, [data-status-id]')) return
      closeFloatList()
      openRecipeDetail(parseInt(card.dataset.view, 10))
    }
  })
  container.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation()
      closeFloatList()
      openRecipeForm(parseInt(btn.dataset.edit, 10), () => loadRecipes())
    }
  })
  container.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation()
      closeFloatList()
      deleteRecipe(parseInt(btn.dataset.delete, 10))
    }
  })
  container.querySelectorAll('[data-status-id]').forEach((sel) => {
    sel.onchange = async (e) => {
      e.stopPropagation()
      const id = Number(sel.dataset.statusId)
      const next = sel.value
      sel.disabled = true
      try {
        await api.update(id, { status: next })
        toast.success('Estado actualizado')
        await loadRecipes()
      } catch (err) {
        toast.error(err.message)
        sel.disabled = false
      }
    }
  })
  container.querySelectorAll('[data-ings]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation()
      const id = Number(btn.dataset.ings)
      if (btn.disabled) return
      if (isFloatListOpen(btn)) {
        closeFloatList()
        return
      }
      const recipe = byId.get(id)
      if (recipe && !Array.isArray(recipe.ingredients)) {
        openFloatList(btn, '<p class="recipe-ings-empty">Cargando...</p>')
        try {
          const full = await api.get(id)
          recipe.ingredients = full.ingredients || []
          const count = btn.querySelector('strong')
          if (count) count.textContent = String(recipe.ingredients.length)
        } catch (err) {
          if (isFloatListOpen(btn)) {
            updateFloatList(`<p class="recipe-ings-empty">${esc(err.message)}</p>`)
          }
          return
        }
        if (!isFloatListOpen(btn)) return
      }
      await applyChemTypes(recipe)
      showRecipeIngs(btn, recipe)
    }
  })
}

async function applyChemTypes(recipe) {
  const ings = recipe?.ingredients
  if (!Array.isArray(ings) || !ings.length) return
  if (ings.every((i) => i.chemical_type)) return
  if (!chemTypeById.size && !chemTypeByCode.size) {
    const rows = await chemicals.list().catch(() => [])
    const list = Array.isArray(rows) ? rows : []
    for (const c of rows) {
      if (c.id != null) chemTypeById.set(Number(c.id), c.chemical_type)
      if (c.code) chemTypeByCode.set(String(c.code), c.chemical_type)
    }
  }
  for (const i of ings) {
    if (i.chemical_type) continue
    i.chemical_type = chemTypeById.get(Number(i.chemical_id))
      || chemTypeByCode.get(String(i.chemical_code || i.code || ''))
      || 'otros'
  }
}

function recipeIngsHtml(recipe) {
  const ings = recipe?.ingredients || []
  if (!ings.length) return '<p class="recipe-ings-empty">Sin químicos en esta receta</p>'
  const totalPages = Math.max(1, Math.ceil(ings.length / RECIPE_ING_PAGE))
  let page = recipeIngPage.get(recipe.id) || 1
  if (page > totalPages) page = totalPages
  recipeIngPage.set(recipe.id, page)
  const start = (page - 1) * RECIPE_ING_PAGE
  const slice = ings.slice(start, start + RECIPE_ING_PAGE)
  const stageById = Object.fromEntries(BATH_STAGES.map((s) => [s.id, s]))
  return `
    <ul class="recipe-ings-list">
      ${slice.map((i) => {
        const typeKey = String(i.chemical_type || '').trim() || 'otros'
        const typeLabel = CHEM_TYPE_LABELS[typeKey] || typeKey
        const stage = stageById[i.bath_stage]
        const stageLabel = stage?.label || i.bath_stage || '—'
        const stageTone = stage?.tone || 'muted'
        return `
        <li>
          <div>
            <strong title="${esc(i.chemical_name || i.name || 'Químico')}">${esc(i.chemical_name || i.name || 'Químico')}</strong>
            <code>${esc(i.chemical_code || i.code || '—')}</code>
          </div>
          <span>${esc(i.quantity_per_kg ?? i.qty ?? 0)} ${esc(i.unit || i.chemical_unit || 'g')}/kg</span>
          <div class="recipe-ings-meta">
            <em class="recipe-ings-chip is-${esc(typeKey)}">${esc(typeLabel)}</em>
            <em class="recipe-ings-chip is-stage-${esc(stageTone)}">${esc(stageLabel)}</em>
          </div>
        </li>`
      }).join('')}
    </ul>
    ${totalPages > 1 ? `
      <nav class="recipe-ings-pager">
        <button type="button" data-ing-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Anterior">‹</button>
        <span>${page} / ${totalPages}</span>
        <button type="button" data-ing-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} aria-label="Siguiente">›</button>
      </nav>` : ''}
  `
}

function bindRecipeIngsPanel(panel, btn, recipe) {
  panel.querySelectorAll('[data-ing-page]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation()
      recipeIngPage.set(recipe.id, Number(el.dataset.ingPage))
      showRecipeIngs(btn, recipe)
    }
  })
}

function showRecipeIngs(btn, recipe) {
  const html = recipeIngsHtml(recipe)
  if (isFloatListOpen(btn)) {
    updateFloatList(html, { onBind: (panel) => bindRecipeIngsPanel(panel, btn, recipe) })
    return
  }
  openFloatList(btn, html, { onBind: (panel) => bindRecipeIngsPanel(panel, btn, recipe) })
}

// ---------------------------------------------------------------------------
// Wizard nueva / editar receta
// ---------------------------------------------------------------------------

async function openRecipeForm(recipeId, onSuccess) {
  closeFloatList()
  const isEdit = recipeId !== null
  const catalog = await chemicals.list().catch(() => [])
  let existing = null
  if (isEdit) {
    try { existing = await api.get(recipeId) }
    catch (err) { toast.error(err.message); return }
  }

  const state = {
    step: 0,
    name: existing?.name || '',
    code: existing?.code || '',
    fiber: existing?.fiber_type || '',
    color: existing?.color_name || existing?.color_reference || '',
    temp: existing?.temperature_c ?? '',
    ratio: existing?.bath_ratio_l_per_kg ?? '',
    ph: '',
    tolerance: 5,
    desc: existing?.notes || '',
    status: existing ? recipeLifecycle(existing) : 'development',
    ingredients: (existing?.ingredients || []).map((i) => ({
      uid: uid(),
      chemical_id: i.chemical_id,
      name: i.chemical_name || '',
      code: i.chemical_code || '',
      unit: i.unit || i.chemical_unit || 'g',
      qty: i.quantity_per_kg,
      stage: i.bath_stage || (BATH_STAGES.some((s) => s.id === i.notes) ? i.notes : 'tincion'),
    })),
    steps: (existing?.steps || []).map((s) => ({
      uid: uid(),
      name: s.step_name,
      type: s.step_type || 'otros',
      duration: s.duration_min ?? '',
      temp: s.temperature_c ?? '',
      notes: s.notes || '',
    })),
  }

  let restoredDraft = false
  const draft = readRecipeDraft(recipeId)
  if (draft) {
    state.step = Number(draft.step) || 0
    state.name = draft.name ?? state.name
    state.code = draft.code ?? state.code
    state.fiber = draft.fiber ?? state.fiber
    state.color = draft.color ?? state.color
    state.temp = draft.temp ?? state.temp
    state.ratio = draft.ratio ?? state.ratio
    state.ph = draft.ph ?? state.ph
    state.tolerance = draft.tolerance ?? state.tolerance
    state.desc = draft.desc ?? state.desc
    state.status = draft.status ?? state.status
    if (Array.isArray(draft.ingredients)) state.ingredients = draft.ingredients
    if (Array.isArray(draft.steps) && draft.steps.length) state.steps = draft.steps
    restoredDraft = true
  } else if (!isEdit) {
    state.steps = sampleProcessSteps()
  }

  const body = `
    <div class="wiz">
      <div class="wiz-stepper" id="wiz-stepper"></div>
      <div class="wiz-error" id="wiz-error" hidden></div>
      <div class="wiz-pane" id="wiz-pane"></div>
    </div>
  `

  function persistDraft() {
    if (document.getElementById('rf-name')) readDatos()
    if (!hasProgress()) {
      clearRecipeDraft(recipeId)
      return
    }
    writeRecipeDraft(recipeId, {
      step: state.step,
      name: state.name,
      code: state.code,
      fiber: state.fiber,
      color: state.color,
      temp: state.temp,
      ratio: state.ratio,
      ph: state.ph,
      tolerance: state.tolerance,
      desc: state.desc,
      status: state.status,
      ingredients: state.ingredients,
      steps: state.steps,
    })
  }

  function hasProgress() {
    if (document.getElementById('rf-name')) readDatos()
    return Boolean(
      state.name || state.code || state.fiber || state.color || state.temp ||
      state.ratio || state.ph || state.desc || state.ingredients.length || state.step > 0
    )
  }

  async function requestLeave() {
    persistDraft()
    if (!hasProgress()) return true
    return askLeaveRecipe()
  }

  function cleanupWizard() {
    if (state._acOutside) {
      document.removeEventListener('pointerdown', state._acOutside, true)
      state._acOutside = null
    }
  }

  openModal(isEdit ? 'Editar receta' : 'Nueva receta', body, {
    size: 'xl',
    closeOnOverlay: false,
    footerHTML: '<div id="wiz-footer" class="wiz-footer"></div>',
    onRequestClose: requestLeave,
    onClose: cleanupWizard,
  })
  const pane = document.getElementById('wiz-pane')

  function showError(msg) {
    const el = document.getElementById('wiz-error')
    if (!el) return
    if (!msg) { el.hidden = true; el.textContent = ''; return }
    el.hidden = false
    el.textContent = msg
  }

  function readDatos() {
    state.name = document.getElementById('rf-name')?.value.trim() || ''
    state.code = document.getElementById('rf-code')?.value.trim() || ''
    state.fiber = document.getElementById('rf-fiber')?.value || ''
    state.color = document.getElementById('rf-color')?.value.trim() || ''
    state.temp = document.getElementById('rf-temp')?.value || ''
    state.ratio = document.getElementById('rf-ratio')?.value || ''
    state.ph = document.getElementById('rf-ph')?.value || ''
    state.tolerance = document.getElementById('rf-tolerance')?.value || 5
    state.desc = document.getElementById('rf-desc')?.value.trim() || ''
    state.status = document.getElementById('rf-status')?.value || state.status || 'development'
  }

  function paintStepper() {
    const host = document.getElementById('wiz-stepper')
    if (!host) return
    host.innerHTML = `
      <div class="wiz-stepper-row">
        ${WIZ_STEPS.map((step, i) => {
          const done = i < state.step
          const active = i === state.step
          const klass = done ? 'is-done' : active ? 'is-active' : 'is-pending'
          return `
            <button type="button" class="wiz-step-col ${klass}" data-goto="${i}" ${i > state.step ? 'disabled' : ''}>
              <div class="wiz-step-head">
                <span class="wiz-step-dot ${klass}">${done ? '✓' : i + 1}</span>
                ${i < WIZ_STEPS.length - 1 ? `<span class="wiz-step-line ${done ? 'is-done' : ''}"></span>` : ''}
              </div>
              <span class="wiz-step-label">${step.label}</span>
              <span class="wiz-step-caption">${step.caption}</span>
            </button>`
        }).join('')}
      </div>`
    host.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.onclick = () => {
        const dest = Number(btn.dataset.goto)
        if (Number.isNaN(dest) || dest === state.step || dest > state.step) return
        if (state.step === 0) readDatos()
        state.step = dest
        paint()
      }
    })
  }

  function paintFooter() {
    const host = document.getElementById('wiz-footer')
    if (!host) return
    const last = state.step === WIZ_STEPS.length - 1
    const qty = state.ingredients.reduce((s, i) => s + Number(i.qty || 0), 0)
    const pendingUso = state.ingredients.filter((i) => !i.stage).length
    const meta = state.step === 1
      ? `${state.ingredients.length} químico${state.ingredients.length === 1 ? '' : 's'} · ${qty.toLocaleString('es-CO', { maximumFractionDigits: 2 })} g/kg${pendingUso ? ` · ${pendingUso} sin uso` : ''}`
      : state.step === 2
        ? `${state.steps.length} paso${state.steps.length === 1 ? '' : 's'} · ${state.steps.reduce((s, p) => s + Number(p.duration || 0), 0)} minutos`
        : ''
    host.innerHTML = `
      ${meta ? `<span class="wiz-meta">${meta}</span>` : '<span></span>'}
      <div class="wiz-actions">
        ${state.step === 0
          ? `<button type="button" class="btn btn-secondary" id="wiz-cancel">Cancelar</button>`
          : `<button type="button" class="btn btn-secondary" id="wiz-back">Atrás</button>`}
        <button type="button" class="btn btn-primary" id="wiz-next">${last ? (isEdit ? 'Guardar receta' : 'Crear receta') : 'Siguiente'}</button>
      </div>`
    document.getElementById('wiz-cancel')?.addEventListener('click', async () => {
      if (await requestLeave()) closeModal()
    })
    document.getElementById('wiz-back')?.addEventListener('click', () => {
      if (state.step === 1) readDatos()
      state.step -= 1
      paint()
    })
    document.getElementById('wiz-next')?.addEventListener('click', onNext)
  }

  function paneDatos() {
    return `
      ${restoredDraft ? `
        <div class="wiz-draft-bar">
          <span>Borrador recuperado. Puedes continuar donde ibas.</span>
          <button type="button" class="btn btn-ghost btn-sm" id="wiz-discard-draft">Empezar de nuevo</button>
        </div>` : ''}
      <section class="wiz-card">
        <header class="wiz-card-head">
          <span class="wiz-card-ico is-accent">${WIZ_ICO.doc}</span>
          <div>
            <h3>Identidad de la receta</h3>
            <p>Nombre, código, fibra y color objetivo</p>
          </div>
        </header>
        <div class="wiz-card-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Nombre <span class="required"></span></label>
              <input id="rf-name" class="form-input" placeholder="Nombre de la receta" value="${esc(state.name)}">
            </div>
            <div class="form-group">
              <label class="form-label">Código</label>
              <input id="rf-code" class="form-input" placeholder="Se genera automáticamente" value="${esc(state.code)}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Tipo de fibra</label>
              <select id="rf-fiber" class="form-select">
                <option value="">No especificado</option>
                ${Object.entries(FIBER_LABELS).map(([v, l]) => `<option value="${v}" ${state.fiber === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Color objetivo</label>
              <input id="rf-color" class="form-input" placeholder="Ej: ROJO-115, AZUL-MARINO" value="${esc(state.color)}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Estado</label>
              <select id="rf-status" class="form-select" ${isAdmin() ? '' : 'disabled'}>
                ${RECIPE_STATUSES.map((s) => `<option value="${s.id}" ${state.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
              </select>
              ${isAdmin() ? '' : '<p class="form-hint">Solo un administrador puede cambiar el estado.</p>'}
            </div>
            ${existing?.created_at ? `
            <div class="form-group">
              <label class="form-label">Fechas</label>
              <p class="recipe-card-dates" style="margin-top:8px">Creada ${fmtRecipeDate(existing.created_at)} · Actualizada ${fmtRecipeDate(existing.updated_at)}</p>
            </div>` : '<div></div>'}
          </div>
        </div>
      </section>
      <section class="wiz-card">
        <header class="wiz-card-head">
          <span class="wiz-card-ico is-info">${WIZ_ICO.bath}</span>
          <div>
            <h3>Condiciones de baño</h3>
            <p>Temperatura, relación, pH y tolerancia de pesaje</p>
          </div>
        </header>
        <div class="wiz-card-body">
          <div class="wiz-params">
            <div class="form-group">
              <label class="form-label">Temperatura</label>
              <div class="wiz-metric">
                <input id="rf-temp" class="form-input" type="number" min="0" max="200" step="1" placeholder="98" value="${esc(state.temp)}">
                <span>°C</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Relación de baño</label>
              <div class="wiz-metric">
                <input id="rf-ratio" class="form-input" type="number" min="0.1" step="0.1" placeholder="10" value="${esc(state.ratio)}">
                <span>L/kg</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">pH objetivo</label>
              <div class="wiz-metric">
                <input id="rf-ph" class="form-input" type="number" min="0" max="14" step="0.1" placeholder="5.5" value="${esc(state.ph)}">
                <span>pH</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Tolerancia</label>
              <div class="wiz-metric">
                <input id="rf-tolerance" class="form-input" type="number" min="0" max="100" step="0.5" value="${esc(state.tolerance)}">
                <span>%</span>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Descripción</label>
            <textarea id="rf-desc" class="form-textarea" placeholder="Notas generales de la receta">${esc(state.desc)}</textarea>
          </div>
        </div>
      </section>`
  }

  function stageSelect(selected) {
    return `
      <select class="form-select wiz-ing-stage">
        <option value="">Elegir uso</option>
        ${BATH_STAGES.map((s) => `<option value="${s.id}" ${selected === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>`
  }

  function paneIngredientes() {
    const pending = state.ingredients.filter((i) => !i.stage).length
    return `
      <section class="wiz-card wiz-toolbar">
        <div class="wiz-search-row">
          <div class="wiz-ac-wrap">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="wiz-chem-q" class="form-input" placeholder="Buscar y agregar químicos, uno tras otro" autocomplete="off">
            <div id="wiz-chem-results" class="wiz-ac" hidden></div>
          </div>
        </div>
        <p class="wiz-hint-inline">Primero agrega todos los químicos. Después, en cada fila, indica <strong>cantidad</strong> (g/kg) y <strong>uso</strong> (preparación, tinción, fijación o acabado).</p>
      </section>
      <section class="wiz-card wiz-ing-table">
        ${state.ingredients.length
          ? `
            <div class="wiz-ing-chips">
              ${BATH_STAGES.map((s) => {
                const n = state.ingredients.filter((i) => i.stage === s.id).length
                return `<span class="wiz-chip is-${s.tone}">${s.label} ${n}</span>`
              }).join('')}
              ${pending ? `<span class="wiz-chip is-pending">Sin uso ${pending}</span>` : ''}
            </div>
            <div class="wiz-ing-head">
              <span>Químico</span>
              <span>Cantidad</span>
              <span>Uso</span>
              <span></span>
            </div>
            ${state.ingredients.map((i) => `
              <div class="wiz-ing ${i.stage ? `is-${BATH_STAGES.find((s) => s.id === i.stage)?.tone || ''}` : 'is-pending'}" data-uid="${esc(i.uid)}">
                <div class="wiz-ing-copy">
                  <strong>${esc(i.name)}</strong>
                  <code>${esc(i.code || '—')}</code>
                </div>
                <div class="wiz-metric wiz-ing-metric">
                  <input class="form-input wiz-ing-qty" type="number" min="0.001" step="0.001" value="${esc(i.qty || '')}" placeholder="0">
                  <span>${esc(i.unit || 'g')}/kg</span>
                </div>
                ${stageSelect(i.stage)}
                <button type="button" class="chem-icon-btn is-danger" data-remove="${esc(i.uid)}" title="Quitar">×</button>
              </div>`).join('')}`
          : `
            <div class="wiz-ing-empty">
              <strong>Sin químicos aún</strong>
              <p>Busca arriba y agrégalos todos. El uso se elige después, fila por fila.</p>
            </div>`}
      </section>`
  }

  function panePasos() {
    return `
      <section class="wiz-card wiz-toolbar">
        <p class="wiz-hint-inline">Cada fila es un momento del baño. <strong>Tiempo</strong> es cuántos minutos dura; <strong>Temperatura</strong> es el °C del baño en ese paso.</p>
      </section>
      <div class="wiz-steps">
        ${state.steps.map((s, i) => `
          <article class="wiz-step-card" data-uid="${esc(s.uid)}">
            <div class="wiz-step-index">${i + 1}</div>
            <div class="wiz-step-main">
              <div class="wiz-step-top">
                <div class="form-group">
                  <label class="form-label">Nombre del paso</label>
                  <input class="form-input" data-k="name" value="${esc(s.name)}" placeholder="Ej: Preparación del baño">
                </div>
                <div class="form-group">
                  <label class="form-label">Tipo</label>
                  <select class="form-select" data-k="type">
                    ${STEP_TYPES.map((t) => `<option value="${t.id}" ${s.type === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
                  </select>
                </div>
                <div class="wiz-step-tools">
                  <button type="button" class="wiz-ord" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
                  <button type="button" class="wiz-ord" data-move="1" ${i === state.steps.length - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button>
                  <button type="button" class="chem-icon-btn is-danger" data-del-step="${esc(s.uid)}" title="Quitar">×</button>
                </div>
              </div>
              <div class="wiz-step-metrics">
                <div class="form-group">
                  <label class="form-label">Tiempo</label>
                  <div class="wiz-metric">
                    <input class="form-input" data-k="duration" type="number" min="0" step="1" value="${esc(s.duration)}" placeholder="0">
                    <span>min</span>
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">Temperatura</label>
                  <div class="wiz-metric">
                    <input class="form-input" data-k="temp" type="number" min="0" step="1" value="${esc(s.temp)}" placeholder="0">
                    <span>°C</span>
                  </div>
                </div>
                <div class="form-group wiz-step-instr">
                  <label class="form-label">Instrucción</label>
                  <input class="form-input" data-k="notes" value="${esc(s.notes)}" placeholder="Qué se hace en este paso">
                </div>
              </div>
            </div>
          </article>`).join('')}
      </div>
      <button type="button" class="wiz-add" id="wiz-add-step">+ Agregar paso</button>`
  }

  function paneResumen() {
    const groups = BATH_STAGES.map((st) => ({
      ...st,
      items: state.ingredients.filter((i) => i.stage === st.id),
    })).filter((g) => g.items.length)
    const mins = state.steps.reduce((s, p) => s + Number(p.duration || 0), 0)
    return `
      <section class="wiz-sum-hero">
        <div>
          <p class="wiz-kicker">${isEdit ? 'Edición de receta' : 'Nueva receta'}</p>
          <h3>${esc(state.name || 'Sin nombre')}</h3>
          <p>${esc(FIBER_LABELS[state.fiber] || 'Fibra sin definir')} · ${esc(state.color || 'Sin color')}</p>
        </div>
        <code>${esc(state.code || 'Código automático')}</code>
      </section>
      <div class="wiz-sum-stats">
        <div class="wiz-stat"><span>Temperatura</span><strong>${state.temp ? `${esc(state.temp)} °C` : '—'}</strong></div>
        <div class="wiz-stat"><span>Relación de baño</span><strong>${state.ratio ? `${esc(state.ratio)}:1` : '—'}</strong></div>
        <div class="wiz-stat"><span>pH</span><strong>${esc(state.ph || '—')}</strong></div>
        <div class="wiz-stat"><span>Proceso</span><strong>${mins} min</strong></div>
        <div class="wiz-stat"><span>Ingredientes</span><strong>${state.ingredients.length}</strong></div>
        <div class="wiz-stat"><span>Estado</span><strong>${recipeStatusMeta(state.status).label}</strong></div>
      </div>
      <div class="wiz-sum-grid">
        <section class="wiz-card">
          <header class="wiz-card-head">
            <span class="wiz-card-ico is-accent">${WIZ_ICO.flask}</span>
            <div>
              <h3>Ingredientes por etapa</h3>
              <p>Cantidades en g/kg de fibra</p>
            </div>
          </header>
          <div class="wiz-card-body">
            ${groups.length ? groups.map((g) => `
              <p class="wiz-sum-stage is-${g.tone}">${g.label}</p>
              <ul class="wiz-sum-list">
                ${g.items.map((i) => `<li><strong>${esc(i.name)}</strong> <span>${esc(i.qty || 0)} ${esc(i.unit)}/kg</span></li>`).join('')}
              </ul>`).join('') : '<p class="wiz-stage-empty">Sin ingredientes.</p>'}
          </div>
        </section>
        <section class="wiz-card">
          <header class="wiz-card-head">
            <span class="wiz-card-ico is-info">${WIZ_ICO.list}</span>
            <div>
              <h3>Pasos del proceso</h3>
              <p>Secuencia propuesta para autorización</p>
            </div>
          </header>
          <ol class="wiz-sum-steps">
            ${state.steps.map((s, i) => `
              <li>
                <span class="wiz-sum-num">${i + 1}</span>
                <div>
                  <strong>${esc(s.name)}</strong>
                  <span>${s.duration ? `${esc(s.duration)} min` : '—'} · ${s.temp ? `${esc(s.temp)} °C` : '—'}</span>
                  ${s.notes ? `<em>${esc(s.notes)}</em>` : ''}
                </div>
              </li>`).join('')}
          </ol>
        </section>
      </div>`
  }

  function bindIngredientes() {
    const input = document.getElementById('wiz-chem-q')
    const box = document.getElementById('wiz-chem-results')
    const wrap = input?.closest('.wiz-ac-wrap')

    const closeAc = () => { if (box) box.hidden = true }
    const renderAc = (q) => {
      const query = q.trim().toLowerCase()
      const used = new Set(state.ingredients.map((i) => i.chemical_id))
      const hits = catalog.filter((c) => {
        if (used.has(c.id)) return false
        if (!query) return true
        return String(c.name || '').toLowerCase().includes(query) || String(c.code || '').toLowerCase().includes(query)
      }).slice(0, 10)
      if (!hits.length) {
        box.innerHTML = '<div class="wiz-ac-empty">Sin coincidencias en el catálogo</div>'
        box.hidden = false
        return
      }
      box.innerHTML = hits.map((c) => `
        <button type="button" class="wiz-ac-item" data-chem="${c.id}">
          <strong>${esc(c.name)}</strong>
          <span>${esc(c.code || '')} · ${esc(c.unit || 'kg')}</span>
        </button>`).join('')
      box.hidden = false
      box.querySelectorAll('[data-chem]').forEach((btn) => {
        btn.onclick = () => {
          const chem = catalog.find((c) => c.id === Number(btn.dataset.chem))
          if (!chem) return
          state.ingredients.push({
            uid: uid(),
            chemical_id: chem.id,
            name: chem.name,
            code: chem.code,
            unit: chem.unit || 'g',
            qty: '',
            stage: '',
          })
          state.keepChemFocus = true
          paint()
        }
      })
    }

    if (state._acOutside) {
      document.removeEventListener('pointerdown', state._acOutside, true)
      state._acOutside = null
    }
    state._acOutside = (e) => {
      if (!wrap || wrap.contains(e.target)) return
      closeAc()
    }
    document.addEventListener('pointerdown', state._acOutside, true)

    let openOnFocus = true
    input.oninput = () => renderAc(input.value)
    input.onfocus = () => {
      if (!openOnFocus) { openOnFocus = true; return }
      renderAc(input.value)
    }
    input.onkeydown = (e) => { if (e.key === 'Escape') closeAc() }

    pane.querySelectorAll('.wiz-ing-qty').forEach((el) => {
      el.oninput = () => {
        const row = state.ingredients.find((i) => i.uid === el.closest('.wiz-ing')?.dataset.uid)
        if (row) row.qty = el.value
        persistDraft()
        paintFooter()
      }
    })
    pane.querySelectorAll('.wiz-ing-stage').forEach((el) => {
      el.onchange = () => {
        const row = state.ingredients.find((i) => i.uid === el.closest('.wiz-ing')?.dataset.uid)
        if (row) row.stage = el.value
        persistDraft()
        paintFooter()
      }
    })
    pane.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = () => {
        state.ingredients = state.ingredients.filter((i) => i.uid !== btn.dataset.remove)
        paint()
      }
    })

    if (state.keepChemFocus) {
      state.keepChemFocus = false
      openOnFocus = false
      input.focus({ preventScroll: true })
    }
  }

  function bindPasos() {
    pane.querySelectorAll('.wiz-step-card').forEach((card) => {
      const row = state.steps.find((s) => s.uid === card.dataset.uid)
      card.querySelectorAll('[data-k]').forEach((el) => {
        el.oninput = () => {
          if (row) row[el.dataset.k] = el.value
          persistDraft()
          if (el.dataset.k === 'duration') paintFooter()
        }
      })
      card.querySelectorAll('[data-move]').forEach((btn) => {
        btn.onclick = () => {
          const dir = Number(btn.dataset.move)
          const idx = state.steps.findIndex((s) => s.uid === card.dataset.uid)
          const next = idx + dir
          if (idx < 0 || next < 0 || next >= state.steps.length) return
          const copy = state.steps.splice(idx, 1)[0]
          state.steps.splice(next, 0, copy)
          paint()
        }
      })
      card.querySelector('[data-del-step]')?.addEventListener('click', () => {
        state.steps = state.steps.filter((s) => s.uid !== card.dataset.uid)
        paint()
      })
    })
    document.getElementById('wiz-add-step')?.addEventListener('click', () => {
      state.steps.push({ uid: uid(), name: '', type: 'otros', duration: '', temp: '', notes: '' })
      paint()
    })
  }

  function paint() {
    if (state._acOutside) {
      document.removeEventListener('pointerdown', state._acOutside, true)
      state._acOutside = null
    }
    showError('')
    paintStepper()
    if (state.step === 0) pane.innerHTML = paneDatos()
    if (state.step === 1) { pane.innerHTML = paneIngredientes(); bindIngredientes() }
    if (state.step === 2) { pane.innerHTML = panePasos(); bindPasos() }
    if (state.step === 3) pane.innerHTML = paneResumen()
    paintFooter()
    document.getElementById('wiz-discard-draft')?.addEventListener('click', () => {
      clearRecipeDraft(recipeId)
      restoredDraft = false
      state.step = 0
      state.name = existing?.name || ''
      state.code = existing?.code || ''
      state.fiber = existing?.fiber_type || ''
      state.color = existing?.color_name || existing?.color_reference || ''
      state.temp = existing?.temperature_c ?? ''
      state.ratio = existing?.bath_ratio_l_per_kg ?? ''
      state.ph = ''
      state.tolerance = 5
      state.desc = existing?.notes || ''
      state.status = existing ? recipeLifecycle(existing) : 'development'
      state.ingredients = (existing?.ingredients || []).map((i) => ({
        uid: uid(),
        chemical_id: i.chemical_id,
        name: i.chemical_name || '',
        code: i.chemical_code || '',
        unit: i.unit || i.chemical_unit || 'g',
        qty: i.quantity_per_kg,
        stage: i.bath_stage || (BATH_STAGES.some((s) => s.id === i.notes) ? i.notes : 'tincion'),
      }))
      state.steps = (existing?.steps || []).map((s) => ({
        uid: uid(),
        name: s.step_name,
        type: s.step_type || 'otros',
        duration: s.duration_min ?? '',
        temp: s.temperature_c ?? '',
        notes: s.notes || '',
      }))
      if (!isEdit) state.steps = sampleProcessSteps()
      paint()
    })
    persistDraft()
  }

  function collectPayload() {
    const ph = parseFloat(state.ph)
    return {
      name: state.name,
      code: state.code || undefined,
      fiber_type: state.fiber || undefined,
      color_name: state.color || undefined,
      color_reference: state.color || undefined,
      temperature_c: parseFloat(state.temp) || undefined,
      bath_ratio_l_per_kg: parseFloat(state.ratio) || undefined,
      process_time_min: state.steps.reduce((s, p) => s + (parseInt(p.duration, 10) || 0), 0) || undefined,
      notes: state.desc || undefined,
      ...(isAdmin() ? { status: state.status || 'development' } : {}),
      steps: state.steps.filter((s) => s.name.trim()).map((s, i) => ({
        step_order: i + 1,
        step_name: s.name.trim(),
        step_type: s.type || 'otros',
        duration_min: parseInt(s.duration, 10) || undefined,
        temperature_c: parseFloat(s.temp) || undefined,
        ph_target: Number.isFinite(ph) ? ph : undefined,
        notes: s.notes.trim() || undefined,
      })),
      ingredients: state.ingredients.filter((i) => i.chemical_id && Number(i.qty) > 0).map((i, idx) => ({
        chemical_id: i.chemical_id,
        quantity_per_kg: Number(i.qty),
        unit: i.unit || 'g',
        tolerance_percentage: parseFloat(state.tolerance) || 5,
        sort_order: idx,
        bath_stage: i.stage,
        notes: i.stage,
      })),
    }
  }

  async function onNext() {
    if (state.step === 0) {
      readDatos()
      if (!state.name) { showError('El nombre es obligatorio'); return }
    }
    if (state.step === 1) {
      if (state.ingredients.some((i) => !Number(i.qty))) {
        showError('Indica la cantidad de cada químico')
        return
      }
      if (state.ingredients.some((i) => !i.stage)) {
        showError('Indica el uso de cada químico: preparación, tinción, fijación o acabado')
        return
      }
    }
    if (state.step === 2) {
      if (!state.steps.some((s) => s.name.trim())) { showError('Agrega al menos un paso de proceso'); return }
    }
    if (state.step < WIZ_STEPS.length - 1) {
      state.step += 1
      paint()
      return
    }

    const submit = document.getElementById('wiz-next')
    submit.disabled = true
    submit.textContent = 'Guardando...'
    try {
      const payload = collectPayload()
      if (isEdit) {
        await api.update(recipeId, payload)
        toast.success('Receta actualizada')
      } else {
        await api.create(payload)
        toast.success('Receta creada')
      }
      clearRecipeDraft(recipeId)
      closeModal()
      if (onSuccess) onSuccess()
    } catch (err) {
      showError(err.message)
      submit.disabled = false
      submit.textContent = isEdit ? 'Guardar receta' : 'Crear receta'
    }
  }

  paint()
  if (restoredDraft) toast.info('Se recuperó el borrador de la receta')
}

// ---------------------------------------------------------------------------
// Vista de detalle
// ---------------------------------------------------------------------------

async function openRecipeDetail(recipeId) {
  closeFloatList()
  const recipe = await api.get(recipeId)
  const stageLabel = Object.fromEntries(BATH_STAGES.map((s) => [s.id, s.label]))

  const stepsHTML = recipe.steps?.length
    ? `<div class="table-wrapper"><table class="data-table">
        <thead><tr><th>#</th><th>Nombre del paso</th><th>Duración (min)</th><th>Temp. (°C)</th><th>Instrucción</th></tr></thead>
        <tbody>
          ${recipe.steps.map(s => `
            <tr>
              <td>${s.step_order}</td>
              <td>${esc(s.step_name)}</td>
              <td>${s.duration_min ?? '-'}</td>
              <td>${s.temperature_c ?? '-'}</td>
              <td style="color:var(--text-muted);font-size:12px">${esc(s.notes || '')}</td>
            </tr>`).join('')}
        </tbody>
       </table></div>`
    : '<p style="color:var(--text-muted);font-size:13px">Sin pasos definidos</p>'

  const ingredientsHTML = recipe.ingredients?.length
    ? `<div class="table-wrapper"><table class="data-table">
        <thead><tr><th>Etapa</th><th>Químico</th><th>Cantidad / kg fibra</th><th>Unidad</th></tr></thead>
        <tbody>
          ${recipe.ingredients.map(i => `
            <tr>
              <td>${esc(stageLabel[i.bath_stage] || i.bath_stage || '—')}</td>
              <td>${esc(i.chemical_name)} <code style="font-size:11px">${esc(i.chemical_code || '')}</code></td>
              <td style="font-weight:600">${i.quantity_per_kg}</td>
              <td>${esc(i.unit)}</td>
            </tr>`).join('')}
        </tbody>
       </table></div>`
    : '<p style="color:var(--text-muted);font-size:13px">Sin ingredientes.</p>'

  const body = `
    <div style="margin-bottom:16px">
      <div class="form-row" style="gap:24px">
        <div><div class="form-label">Fibra</div><div>${esc(FIBER_LABELS[recipe.fiber_type] || recipe.fiber_type || '-')}</div></div>
        <div><div class="form-label">Temperatura</div><div>${recipe.temperature_c ? recipe.temperature_c + ' °C' : '-'}</div></div>
        <div><div class="form-label">Relación de baño</div><div>${recipe.bath_ratio_l_per_kg ? recipe.bath_ratio_l_per_kg + ':1' : '-'}</div></div>
        <div><div class="form-label">Color</div><div>${esc(recipe.color_name || recipe.color_reference || '-')}</div></div>
        <div><div class="form-label">Estado</div><div><span class="badge ${recipeStatusMeta(recipeLifecycle(recipe)).badge}">${recipeStatusMeta(recipeLifecycle(recipe)).label}</span></div></div>
        <div><div class="form-label">Creada</div><div>${fmtRecipeDate(recipe.created_at)}</div></div>
        <div><div class="form-label">Actualizada</div><div>${fmtRecipeDate(recipe.updated_at)}</div></div>
      </div>
    </div>
    <h4 style="margin:0 0 8px;font-size:13px;font-weight:600">Ingredientes</h4>
    ${ingredientsHTML}
    <div class="separator"></div>
    <h4 style="margin:0 0 8px;font-size:13px;font-weight:600">Pasos del proceso</h4>
    ${stepsHTML}
  `

  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cerrar</button>
    <button class="btn btn-primary" id="rd-edit">Editar receta</button>`
  openModal(`${recipe.code} - ${recipe.name}`, body, { size: 'lg', footerHTML: footer })
  document.getElementById('rd-edit').onclick = () => {
    closeModal()
    openRecipeForm(recipeId, () => loadRecipes())
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
