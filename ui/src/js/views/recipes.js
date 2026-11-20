import { recipes as api, chemicals } from '../api.js'
import { toast }  from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'
import { setPageHeader } from '../layout.js'
import { isAdmin } from '../session.js'
import { closeFloatList, isFloatListOpen, openFloatList } from '../components/float-list.js'

const FIBER_LABELS = {
  lana: 'Lana', algodon: 'Algodón', acrilico: 'Acrílico', poliester: 'Poliéster',
  nylon: 'Nylon', seda: 'Seda', mezcla: 'Mezcla', otros: 'Otros',
}

const BATH_STAGES = [
  { id: 'preblanqueo', label: 'Preblanqueo', tone: 'info', hint: 'Preblanqueo de la fibra', type: 'pre_lavado', duration: 20, temp: 90 },
  { id: 'descrude', label: 'Descrude', tone: 'pending', hint: 'Descrude de la fibra', type: 'pre_lavado', duration: 20, temp: 90 },
  { id: 'tenido', label: 'Teñido', tone: 'accent', hint: 'Colorantes y proceso de tintura', type: 'bano_tinte', duration: 45, temp: 98 },
  { id: 'reductivo', label: 'Reductivo', tone: 'warning', hint: 'Baño reductivo posterior al teñido', type: 'otros', duration: 20, temp: 80 },
  { id: 'jabonado', label: 'Jabonado', tone: 'info', hint: 'Jabonado posterior al teñido', type: 'lavado', duration: 15, temp: 80 },
  { id: 'fijado', label: 'Fijado', tone: 'warning', hint: 'Fijadores y cierre del color', type: 'fijacion', duration: 20, temp: 80 },
  { id: 'suavizado', label: 'Suavizado', tone: 'success', hint: 'Suavizado y acabado', type: 'otros', duration: 15, temp: 40 },
]

const STAGE_ALIASES = {
  preparacion: 'preblanqueo',
  tincion: 'tenido',
  fijacion: 'fijado',
  acabado: 'suavizado',
}

const DOSE_BASES = [
  { id: 'percent', label: '%' },
  { id: 'g_l', label: 'g/L' },
  { id: 'per_kg', label: 'g/kg' },
]

const CHEM_TYPE_LABELS = {
  acido: 'Ácido', reactivo: 'Reactivo', directo: 'Directo', auxiliar: 'Auxiliar',
  mordiente: 'Mordiente', disperso: 'Disperso', vat: 'Vat',
  blanqueador: 'Blanqueador', otros: 'Otros',
}

const chemTypeById = new Map()
const chemTypeByCode = new Map()
let recipeQuery = { search: '', status: '' }

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

function fmtRecipeDateCard(value) {
  if (!value) return '—'
  const raw = String(value).trim()
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return raw
  const month = d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')
  return `${d.getDate()} ${month} ${d.getFullYear()}`
}

const WIZ_STEPS = [
  { label: 'Datos', caption: 'Identidad' },
  { label: 'Fórmula', caption: 'Hoja' },
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

function canonicalStage(raw) {
  const id = String(raw || '').trim()
  if (STAGE_ALIASES[id]) return STAGE_ALIASES[id]
  if (BATH_STAGES.some((s) => s.id === id)) return id
  return ''
}

function stageIdsFor(fiber, colorDepth, processRoute) {
  if (fiber === 'acrilico') return colorDepth === 'claros' ? ['tenido'] : ['tenido', 'reductivo']
  if (fiber === 'algodon') {
    const start = processRoute === 'descrude' ? 'descrude' : 'preblanqueo'
    return [start, 'tenido', 'jabonado', 'fijado', 'suavizado']
  }
  if (fiber === 'mezcla') return ['reductivo', 'tenido', 'jabonado', 'fijado', 'suavizado']
  return BATH_STAGES.map((s) => s.id)
}

function stagesFor(fiber, colorDepth, processRoute) {
  const byId = Object.fromEntries(BATH_STAGES.map((s) => [s.id, s]))
  return stageIdsFor(fiber, colorDepth, processRoute).map((id) => byId[id]).filter(Boolean)
}

function processPathLabel(fiber, colorDepth, processRoute) {
  if (fiber === 'acrilico') return colorDepth === 'claros' ? 'Claros' : 'Oscuros / medios'
  if (fiber === 'algodon') return processRoute === 'descrude' ? 'Descrude' : 'Preblanqueo'
  if (fiber === 'mezcla') return 'Reductivo → teñido, jabonado, fijado, suavizado'
  return ''
}

function processPathHint(fiber, colorDepth, processRoute) {
  if (fiber === 'acrilico' && colorDepth === 'claros') return 'Acrílico claro: solo teñido.'
  if (fiber === 'acrilico') return 'Acrílico oscuro o medio: teñido y reductivo.'
  if (fiber === 'algodon' && processRoute === 'descrude') return 'Algodón: descrude, teñido, jabonado, fijado y suavizado.'
  if (fiber === 'algodon') return 'Algodón: preblanqueo, teñido, jabonado, fijado y suavizado.'
  if (fiber === 'mezcla') return 'Mezcla: reductivo, teñido, jabonado, fijado y suavizado.'
  if (!fiber) return 'Elige el tipo de fibra para ver las etapas de esa fórmula.'
  return 'Sin ruta fija para esta fibra; usa las etapas que pida la fórmula.'
}

function inferStageFromStepName(name) {
  const n = String(name || '').trim().toLowerCase()
  const hit = BATH_STAGES.find((s) => s.label.toLowerCase() === n || s.id === n)
  return hit?.id || ''
}

function formatPhase(p) {
  const t = p.temp !== '' && p.temp != null ? `${p.temp}°C` : ''
  const d = p.duration !== '' && p.duration != null ? `${p.duration}'` : ''
  if (t && d) return `${t}-${d}`
  return t || d || '—'
}

function blankStageCurve() {
  return { ph: '', phases: [], notes: [] }
}

function curveToRecipeSteps(curve, fiber, colorDepth, processRoute, stageList) {
  const steps = []
  let order = 1
  for (const st of stageList || stagesFor(fiber, colorDepth, processRoute)) {
    const meta = curve?.[st.id] || blankStageCurve()
    const ph = parseFloat(meta.ph)
    const phVal = Number.isFinite(ph) ? ph : undefined
    const phases = (meta.phases || []).filter((p) => String(p.temp ?? '').trim() !== '' || String(p.duration ?? '').trim() !== '')
    if (!phases.length) {
      if (phVal != null) {
        steps.push({
          step_order: order++,
          step_name: st.label,
          step_type: st.type || 'otros',
          ph_target: phVal,
          notes: st.id,
          bath_stage: st.id,
        })
      }
    } else {
      phases.forEach((p, i) => {
        const temp = parseFloat(p.temp)
        const duration = parseInt(p.duration, 10)
        steps.push({
          step_order: order++,
          step_name: i === 0 ? st.label : formatPhase(p),
          step_type: st.type || 'otros',
          duration_min: Number.isFinite(duration) ? duration : undefined,
          temperature_c: Number.isFinite(temp) ? temp : undefined,
          ph_target: i === 0 ? phVal : undefined,
          notes: st.id,
          bath_stage: st.id,
        })
      })
    }
    for (const note of meta.notes || []) {
      const text = String(note.text || '').trim()
      if (!text) continue
      steps.push({
        step_order: order++,
        step_name: text,
        step_type: st.type || 'otros',
        notes: 'indicacion',
        bath_stage: st.id,
      })
    }
  }
  return steps
}

function mapWizardCurve(steps, fiber, colorDepth, processRoute) {
  const ids = stageIdsFor(fiber, colorDepth, processRoute)
  const byStage = Object.fromEntries(ids.map((id) => [id, blankStageCurve()]))
  const unmatched = []
  for (const s of steps || []) {
    let stage = canonicalStage(s.bath_stage) || inferStageFromStepName(s.step_name)
    if (stage && !byStage[stage]) stage = ''
    if (stage && String(s.notes || '') === 'indicacion') {
      byStage[stage].notes.push({ uid: uid(), text: s.step_name || '' })
      continue
    }
    const temp = s.temperature_c ?? s.temp ?? ''
    const duration = s.duration_min ?? s.duration ?? ''
    const ph = s.ph_target ?? ''
    if (stage) {
      if (ph !== '' && ph != null && !byStage[stage].ph) byStage[stage].ph = ph
      if (temp !== '' || duration !== '') {
        byStage[stage].phases.push({ uid: uid(), temp, duration })
      }
    } else if (temp !== '' || duration !== '') {
      unmatched.push({ uid: uid(), temp, duration })
    }
  }
  if (unmatched.length && ids[0]) byStage[ids[0]].phases.push(...unmatched)
  return byStage
}

function inferDoseBasis(unit) {
  const u = String(unit || '').trim().toLowerCase().replace(/\s/g, '')
  if (u === '%' || u === 'percent' || u === 'owf') return 'percent'
  if (u === 'g/l' || u === 'g_l' || u === 'gl') return 'g_l'
  return 'per_kg'
}

function doseParts(i) {
  const qty = i.quantity_per_kg ?? i.qty ?? ''
  const basis = i.dose_basis || i.basis || inferDoseBasis(i.unit)
  if (basis === 'percent') return { qty, measure: '%' }
  if (basis === 'g_l') return { qty, measure: 'g/L' }
  const unit = i.unit || i.chemical_unit || 'g'
  if (unit === '%' || unit === 'g/L') return { qty, measure: unit }
  return { qty, measure: `${unit}/kg` }
}

function formatDose(i) {
  const { qty, measure } = doseParts(i)
  return `${qty} ${measure}`
}

function doseHint(i) {
  const n = parseInt(i?.dose_min ?? i?.doseMin, 10)
  return Number.isFinite(n) && n > 0 ? `Dosificar ${n} min` : ''
}

function stageSheetHtml(g) {
  const items = g.items || []
  const phases = (g.meta?.phases || []).filter((p) => String(p.temp ?? '').trim() !== '' || String(p.duration ?? '').trim() !== '')
  return `
    <div class="wiz-sheet-stage is-${esc(g.tone)}">
      <div class="wiz-sheet-stage-h">
        <span>${esc(g.label)}</span>
        ${g.meta?.ph ? `<span class="wiz-stage-ph">pH ${esc(g.meta.ph)}</span>` : ''}
      </div>
      <div class="wiz-sheet-split">
        <div class="wiz-sheet-col is-products">
          <div class="wiz-sum-head">
            <span>Productos</span>
            <span>Cantidad</span>
          </div>
          ${items.length ? `
            <ul class="wiz-sum-list">
              ${items.map((i) => {
                const hint = doseHint(i)
                const temp = Boolean(i.temporary) || Number(i.is_temporary) === 1
                return `<li><div><strong>${esc(i.chemical_name || i.name)}</strong>${temp ? `<em class="wiz-temp-tag">Temporal</em>` : ''}${hint ? `<em class="wiz-dose-note">${esc(hint)}</em>` : ''}</div><span>${esc(formatDose(i))}</span></li>`
              }).join('')}
            </ul>` : '<p class="wiz-stage-empty">Sin productos</p>'}
        </div>
        <div class="wiz-sheet-col is-curve">
          <div class="wiz-sum-head">
            <span>°C</span>
            <span>min</span>
          </div>
          ${phases.length ? `
            <ul class="wiz-sum-list">
              ${phases.map((p) => {
                const t = p.temp !== '' && p.temp != null ? `${p.temp}°C` : '—'
                const d = p.duration !== '' && p.duration != null ? `${p.duration}'` : '—'
                return `<li><strong>${esc(t)}</strong><span>${esc(d)}</span></li>`
              }).join('')}
            </ul>` : '<p class="wiz-stage-empty">Sin temperatura</p>'}
        </div>
      </div>
      ${(g.meta?.notes || []).filter((n) => String(n.text || '').trim()).length ? `
        <ul class="wiz-note-list">
          ${(g.meta.notes || []).filter((n) => String(n.text || '').trim()).map((n) => `<li>${esc(n.text)}</li>`).join('')}
        </ul>` : ''}
    </div>`
}

function composeRecipeName(ref, title, color) {
  return [ref, title, color].map((s) => String(s || '').trim()).filter(Boolean).join(' · ')
}

function nameIsLocked(name, ref, title, color) {
  const n = String(name || '').trim()
  if (!n) return false
  if (/\s*\(copia\)\s*$/i.test(n)) return false
  return n !== composeRecipeName(ref, title, color)
}

function mapWizardIng(i) {
  return {
    uid: uid(),
    chemical_id: i.chemical_id,
    name: i.chemical_name || i.name || '',
    code: i.chemical_code || i.code || '',
    unit: i.unit || i.chemical_unit || 'g',
    qty: i.quantity_per_kg ?? i.qty ?? '',
    stage: canonicalStage(i.bath_stage || i.notes),
    basis: i.dose_basis || i.basis || inferDoseBasis(i.unit),
    doseMin: i.dose_min ?? '',
    temporary: Number(i.is_temporary) === 1,
  }
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

export async function showView(container) {
  closeFloatList()
  setPageHeader({
    title: 'Recetas',
    subtitle: 'Etapas según la fibra: acrílico, algodón o mezcla',
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
        <input type="text" id="search-recipes" placeholder="Buscar por código, referencia, título o color..." value="${esc(recipeQuery.search)}">
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
  return closeRecipeDrawer
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

  container.innerHTML = `<div class="rc-grid">${items.map(recipeCard).join('')}</div>`
  bindRecipeCards(container, items)
}

function recipeStamp(value) {
  if (!value) return 0
  const raw = String(value).trim()
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

function recipeWasModified(created, updated) {
  const a = recipeStamp(created)
  const b = recipeStamp(updated)
  if (!a || !b) return false
  return b - a > 2 * 60 * 1000
}

function isSameDay(value) {
  const t = recipeStamp(value)
  if (!t) return false
  const d = new Date(t)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function fmtProcessSpan(min) {
  const n = Number(min) || 0
  if (n < 60) return ''
  const h = Math.floor(n / 60)
  const m = n % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

const RC_STATUS_TONE = {
  active: 'success', development: 'warning', inactive: 'muted', discarded: 'danger',
}

function recipeCard(r) {
  const color = r.color_name || r.color_reference || ''
  const title = r.yarn_title || ''
  const ref = r.commercial_ref || ''
  const known = Array.isArray(r.ingredients)
  const nIngs = known ? r.ingredients.length : Number(r.ingredient_count || 0)
  const life = recipeLifecycle(r)
  const st = recipeStatusMeta(life)
  const tone = RC_STATUS_TONE[life] || 'muted'
  const modified = recipeWasModified(r.created_at, r.updated_at)
  const stamp = modified ? r.updated_at : r.created_at
  const when = isSameDay(stamp) ? 'hoy' : fmtRecipeDateCard(stamp)
  const span = fmtProcessSpan(r.process_time_min)
  const caption = [ref && 'Referencia', title && 'Título'].filter(Boolean).join(' · ')
  return `
    <article class="rc-card" data-view="${r.id}">
      <header class="rc-top">
        <code>${esc(r.code || 'Sin código')}</code>
        <span class="rc-ver">v${r.version || 1}</span>
        ${isAdmin()
          ? `<button type="button" class="rc-status is-${tone}" data-status-recipe="${r.id}" aria-haspopup="menu" aria-expanded="false"><i></i>${esc(st.label)}</button>`
          : `<span class="rc-status is-${tone}"><i></i>${esc(st.label)}</span>`}
      </header>
      <div class="rc-id">
        <div class="rc-color">
          <span>Color</span>
          <strong>${esc(color || '—')}</strong>
        </div>
        <div class="rc-name">
          <h3>${ref || title
            ? `${ref ? `<b>${esc(ref)}</b>` : ''} ${title ? `<em>${esc(title)}</em>` : ''}`
            : `<b>${esc(r.name || 'Sin nombre')}</b>`}</h3>
          <p>${esc(caption || 'Nombre')}</p>
        </div>
      </div>
      <div class="rc-stats">
        <div>
          <span>Temperatura</span>
          <strong>${r.temperature_c ? `${esc(r.temperature_c)}<small>°C</small>` : '—'}</strong>
        </div>
        <div>
          <span>Proceso</span>
          <strong>${r.process_time_min ? `${esc(r.process_time_min)}<small>min</small>${span ? `<small class="rc-span">${span}</small>` : ''}` : '—'}</strong>
        </div>
      </div>
      <button type="button" class="rc-ings" data-ings="${r.id}">
        <span class="rc-ings-main">
          <span>Químicos <strong>${known || r.ingredient_count != null ? nIngs : '…'}</strong></span>
          ${known && nIngs ? `<small>${stageSummary(r)}</small>` : ''}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>
      </button>
      <footer class="rc-foot">
        <span class="${modified ? 'is-changed' : ''}" title="Creada ${esc(fmtRecipeDateCard(r.created_at))} · Modificada ${esc(fmtRecipeDateCard(r.updated_at))}">${modified ? 'Modificada' : 'Creada'} ${esc(when)}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-next-color="${r.id}">Otro color</button>
        <button type="button" class="btn btn-secondary btn-sm" data-edit="${r.id}">Editar</button>
        <button type="button" class="mc-more" data-more="${r.id}" aria-label="Más acciones">···</button>
      </footer>
    </article>`
}

async function changeRecipeStatus(id, next, current) {
  closeFloatList()
  if (next === current) return
  try {
    await api.update(id, { status: next })
    toast.success('Estado actualizado')
    await loadRecipes()
    if (_drawer) await openRecipeDrawer(id)
  } catch (err) {
    toast.error(err.message)
  }
}

function recipeStatusMenu(current) {
  return `
    <div class="mc-menu mc-status-menu">
      ${RECIPE_STATUSES.map((s) => `
        <button type="button" data-rc-status="${s.id}" class="${s.id === current ? 'is-current' : ''}">
          <i class="is-${RC_STATUS_TONE[s.id] || 'muted'}"></i>${esc(s.label)}
        </button>`).join('')}
    </div>`
}

function recipeMenuHtml() {
  return `
    <div class="mc-menu">
      <button type="button" data-rc-act="delete" class="is-danger">Eliminar</button>
    </div>`
}

function bindRecipeCards(container, items) {
  const byId = new Map(items.map((r) => [Number(r.id), r]))

  container.querySelectorAll('.rc-card').forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('[data-edit], [data-more], [data-status-recipe], [data-next-color]')) return
      openRecipeDrawer(parseInt(card.dataset.view, 10))
    }
  })
  container.querySelectorAll('[data-more]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation()
      if (isFloatListOpen(btn)) { closeFloatList(); return }
      const r = byId.get(Number(btn.dataset.more))
      if (!r) return
      openFloatList(btn, recipeMenuHtml(), {
        onBind: (panel) => {
          panel.querySelector('[data-rc-act="delete"]')?.addEventListener('click', () => {
            closeFloatList()
            deleteRecipe(r.id)
          })
        },
      })
    }
  })
  container.querySelectorAll('[data-next-color]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation()
      closeFloatList()
      openNextColor(Number(btn.dataset.nextColor))
    }
  })
  container.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation()
      closeFloatList()
      openRecipeForm(parseInt(btn.dataset.edit, 10), () => loadRecipes())
    }
  })
  container.querySelectorAll('[data-status-recipe]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation()
      if (isFloatListOpen(btn)) { closeFloatList(); return }
      const r = byId.get(Number(btn.dataset.statusRecipe))
      if (!r) return
      const life = recipeLifecycle(r)
      openFloatList(btn, recipeStatusMenu(life), {
        onBind: (panel) => {
          panel.querySelectorAll('[data-rc-status]').forEach((item) => {
            item.onclick = () => changeRecipeStatus(r.id, item.dataset.rcStatus, life)
          })
        },
      })
    }
  })
  container.querySelectorAll('[data-ings]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation()
      if (btn.disabled) return
      openRecipeDrawer(Number(btn.dataset.ings))
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

function recipeStageGroups(recipe) {
  const stageById = Object.fromEntries(BATH_STAGES.map((s) => [s.id, s]))
  const order = stagesFor(recipe.fiber_type, recipe.color_depth, recipe.process_route).map((s) => s.id)
  const curve = mapWizardCurve(recipe.steps, recipe.fiber_type, recipe.color_depth, recipe.process_route)
  const items = new Map()
  for (const i of recipe.ingredients || []) {
    const id = canonicalStage(i.bath_stage || i.notes) || 'otros'
    if (!items.has(id)) items.set(id, [])
    items.get(id).push(i)
  }
  const ids = [
    ...order,
    ...[...items.keys()].filter((id) => !order.includes(id)),
  ]
  return ids.map((id) => {
    const st = stageById[id]
    const meta = curve[id] || blankStageCurve()
    return {
      id,
      label: st?.label || id,
      tone: st?.tone || 'muted',
      items: items.get(id) || [],
      ph: meta.ph,
      phases: (meta.phases || []).filter((p) => String(p.temp ?? '').trim() !== '' || String(p.duration ?? '').trim() !== ''),
      notes: (meta.notes || []).filter((n) => String(n.text || '').trim()),
    }
  }).filter((g) => g.items.length || g.ph || g.phases.length || g.notes.length)
}

function stageSummary(recipe) {
  const counts = new Map()
  const order = stagesFor(recipe.fiber_type, recipe.color_depth, recipe.process_route).map((s) => s.id)
  for (const i of recipe.ingredients || []) {
    const id = canonicalStage(i.bath_stage || i.notes) || 'otros'
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  const label = (id) => BATH_STAGES.find((s) => s.id === id)?.label || id
  return [...order.filter((id) => counts.has(id)), ...[...counts.keys()].filter((id) => !order.includes(id))]
    .map((id) => `${esc(label(id))} <b>${counts.get(id)}</b>`)
    .join(' · ')
}

function stageMinutes(g) {
  return g.phases.reduce((s, p) => s + (Number(p.duration) || 0), 0)
}

function fmtDuration(min) {
  const n = Number(min) || 0
  if (!n) return '—'
  if (n < 60) return `${n} min`
  const h = Math.floor(n / 60)
  const m = n % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

function tempProfileSvg(groups) {
  const segs = []
  groups.forEach((g, stageIdx) => {
    for (const p of g.phases) {
      const t = Number(p.temp)
      const d = Number(p.duration) || 0
      if (!Number.isFinite(t) || !d) continue
      segs.push({ t, d, stageIdx })
    }
  })
  if (!segs.length) return ''
  const total = segs.reduce((s, x) => s + x.d, 0)
  const temps = segs.map((s) => s.t)
  const hi = Math.max(...temps)
  const lo = Math.max(0, Math.floor((Math.min(...temps) - 10) / 10) * 10)
  const X0 = 30
  const X1 = 412
  const YB = 108
  const YT = 31.5
  const x = (m) => +(X0 + (m / total) * (X1 - X0)).toFixed(1)
  const y = (t) => +(YB - ((t - lo) / Math.max(1, hi - lo)) * (YB - YT)).toFixed(1)

  let cum = 0
  let line = `M${X0} ${y(segs[0].t)}`
  const labels = []
  const bounds = []
  let prevStage = segs[0].stageIdx
  const stageSpan = new Map()
  for (const s of segs) {
    const xs = x(cum)
    const xe = x(cum + s.d)
    if (s.stageIdx !== prevStage) bounds.push(xs)
    prevStage = s.stageIdx
    line += ` L${xs} ${y(s.t)} L${xe} ${y(s.t)}`
    labels.push(`<text class="pf-temp" x="${((xs + xe) / 2).toFixed(1)}" y="${(y(s.t) - 5).toFixed(1)}" text-anchor="middle">${s.t}°</text>`)
    const span = stageSpan.get(s.stageIdx) || { a: xs, b: xe }
    span.b = xe
    stageSpan.set(s.stageIdx, span)
    cum += s.d
  }
  const area = `${line} L${X1} ${YB} L${X0} ${YB} Z`

  const grid = []
  for (let t = Math.ceil((lo + 5) / 20) * 20; t <= hi; t += 20) {
    grid.push(`<line class="pf-grid" x1="${X0}" x2="${X1}" y1="${y(t)}" y2="${y(t)}"/><text class="pf-axis" x="25" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${t}°</text>`)
  }
  const ticks = [`<text class="pf-axis" x="${X0}" y="122" text-anchor="middle">0</text>`]
  for (let m = 30; m < total; m += 30) {
    if (total - m < 15) break
    ticks.push(`<text class="pf-axis" x="${x(m)}" y="122" text-anchor="middle">${m}</text>`)
  }
  ticks.push(`<text class="pf-axis" x="${X1}" y="122" text-anchor="end">${total} min</text>`)

  const nums = [...stageSpan.entries()].map(([idx, s]) => {
    const cx = ((s.a + s.b) / 2).toFixed(1)
    return `<g class="pf-num"><circle cx="${cx}" cy="9" r="7"/><text x="${cx}" y="12" text-anchor="middle">${idx + 1}</text></g>`
  })
  const aria = groups.map((g, i) => `${i + 1} ${g.label}: ${g.phases.map((p) => `${p.temp} °C ${p.duration} min`).join(', ')}`).join('; ')

  return `
    <div class="rq-profile">
      <h5>Perfil de temperatura</h5>
      <svg viewBox="0 0 420 126" role="img" aria-label="Perfil de temperatura. ${esc(aria)}">
        ${grid.join('')}
        <path class="pf-area" d="${area}"/>
        <path class="pf-line" d="${line}"/>
        ${bounds.map((bx) => `<line class="pf-sep" x1="${bx}" x2="${bx}" y1="16" y2="${YB}"/>`).join('')}
        ${labels.join('')}
        ${nums.join('')}
        ${ticks.join('')}
      </svg>
    </div>`
}

function drawerStageHtml(g, index) {
  const mins = stageMinutes(g)
  const meta = [mins ? `${mins} min` : '', `${g.items.length} prod.`].filter(Boolean).join(' · ')
  const cond = g.phases.map((p) => {
    const t = p.temp !== '' && p.temp != null ? `<b>${esc(p.temp)} °C</b>` : '<b>—</b>'
    const d = p.duration !== '' && p.duration != null ? ` ${esc(p.duration)} min` : ''
    return `<span>${t}${d}</span>`
  }).join('<span aria-hidden="true">→</span>')
  return `
    <section class="rq-stage is-${esc(g.tone)}">
      <div class="rq-stage-h"><i>${index + 1}</i><h4>${esc(g.label)}</h4><span>${esc(meta)}</span></div>
      ${cond || g.ph ? `<p class="rq-cond">${cond}${g.ph ? `<span class="ph">pH <b>${esc(g.ph)}</b></span>` : ''}</p>` : ''}
      ${g.notes.length ? `<ul class="rq-notes">${g.notes.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul>` : ''}
      ${g.items.length ? `<ul class="rq-list">
        ${g.items.map((i) => {
          const typeKey = String(i.chemical_type || '').trim() || 'otros'
          const typeLabel = CHEM_TYPE_LABELS[typeKey] || typeKey
          const temp = Number(i.is_temporary) === 1
          const name = i.chemical_name || i.name || 'Químico'
          return `
            <li class="rq-row ${temp ? 'is-temp' : ''}">
              <div class="rq-prod">
                <b>${esc(name)}</b>
                <span class="rq-meta">
                  <code>${esc(i.chemical_code || i.code || '—')}</code>
                  <span class="rq-cat">${esc(typeLabel)}</span>
                  ${temp ? '<span class="rq-flag" title="Producto temporal, sin inventario todavía">Temporal</span>' : ''}
                  ${doseHint(i) ? `<span class="rq-flag">${esc(doseHint(i))}</span>` : ''}
                </span>
              </div>
              <div class="rq-dose">${esc(formatDose(i))}</div>
            </li>`
        }).join('')}
      </ul>` : ''}
    </section>`
}

let _drawer = null

function closeRecipeDrawer() {
  if (!_drawer) return
  document.removeEventListener('keydown', _drawer.onKey)
  _drawer.root.remove()
  _drawer = null
}

async function openRecipeDrawer(recipeId) {
  closeFloatList()
  closeRecipeDrawer()
  const root = document.createElement('div')
  root.className = 'rq-root'
  root.innerHTML = `
    <div class="rq-scrim"></div>
    <aside class="rq-drawer" role="dialog" aria-modal="true" aria-labelledby="rq-title-drawer">
      <div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div>
    </aside>`
  document.body.appendChild(root)
  const onKey = (e) => { if (e.key === 'Escape') closeRecipeDrawer() }
  document.addEventListener('keydown', onKey)
  _drawer = { root, onKey }
  root.querySelector('.rq-scrim').onclick = closeRecipeDrawer

  let recipe
  try {
    recipe = await api.get(recipeId)
    await applyChemTypes(recipe)
  } catch (err) {
    if (_drawer?.root !== root) return
    root.querySelector('.rq-drawer').innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`
    return
  }
  if (_drawer?.root !== root) return

  const life = recipeLifecycle(recipe)
  const st = recipeStatusMeta(life)
  const tone = RC_STATUS_TONE[life] || 'muted'
  const color = recipe.color_name || recipe.color_reference || ''
  const ident = [recipe.commercial_ref, recipe.yarn_title].filter(Boolean).join(' ') || recipe.name || ''
  const nIngs = (recipe.ingredients || []).length
  const groups = recipeStageGroups(recipe)
  const totalMin = Number(recipe.process_time_min) || groups.reduce((s, g) => s + stageMinutes(g), 0)
  const modified = recipeWasModified(recipe.created_at, recipe.updated_at)
  const facts = [
    ['Fibra', FIBER_LABELS[recipe.fiber_type] || '—'],
    ['Temp. máx.', recipe.temperature_c ? `${recipe.temperature_c} °C` : '—'],
    ['Duración', fmtDuration(totalMin)],
    ['Etapas', String(groups.length || '—')],
  ]

  root.querySelector('.rq-drawer').innerHTML = `
    <div class="rq-header">
      <div>
        <h3 id="rq-title-drawer">Químicos<span>${esc(ident)}</span></h3>
        <p>${esc([`${recipe.code} v${recipe.version || 1}`, color && `Color ${color}`, `${nIngs} producto${nIngs === 1 ? '' : 's'}`].filter(Boolean).join(' · '))}</p>
      </div>
      ${isAdmin()
        ? `<button type="button" class="rc-status is-${tone}" data-drawer-status="${recipe.id}" aria-haspopup="menu" aria-expanded="false"><i></i>${esc(st.label)}</button>`
        : `<span class="rc-status is-${tone}"><i></i>${esc(st.label)}</span>`}
      <button class="rq-close" type="button" aria-label="Cerrar">×</button>
    </div>
    <div class="rq-scroll">
      <dl class="rq-facts">
        ${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
      </dl>
      ${tempProfileSvg(groups)}
      <div class="rq-cols"><span>Producto</span><span>Dosis</span></div>
      <div class="rq-body">
        ${groups.length ? groups.map(drawerStageHtml).join('') : '<p class="wiz-stage-empty">Sin fórmula aún.</p>'}
      </div>
    </div>
    <div class="rq-foot">
      <span class="rq-dates">Creada ${esc(fmtRecipeDateCard(recipe.created_at))}${modified ? ` · <b>Modificada ${esc(fmtRecipeDateCard(recipe.updated_at))}</b>` : ''}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-rd="copy">Otro color</button>
      <button type="button" class="btn btn-primary btn-sm" data-rd="edit">Editar receta</button>
    </div>`

  root.querySelector('.rq-close').onclick = closeRecipeDrawer
  const statusBtn = root.querySelector('[data-drawer-status]')
  if (statusBtn) {
    statusBtn.onclick = (e) => {
      e.stopPropagation()
      if (isFloatListOpen(statusBtn)) { closeFloatList(); return }
      openFloatList(statusBtn, recipeStatusMenu(life), {
        onBind: (panel) => {
          panel.querySelectorAll('[data-rc-status]').forEach((item) => {
            item.onclick = () => changeRecipeStatus(recipe.id, item.dataset.rcStatus, life)
          })
        },
      })
    }
  }
  root.querySelector('[data-rd="edit"]').onclick = () => {
    closeRecipeDrawer()
    openRecipeForm(recipe.id, () => loadRecipes())
  }
  root.querySelector('[data-rd="copy"]').onclick = () => {
    closeRecipeDrawer()
    openNextColor(recipe.id)
  }
}

// ---------------------------------------------------------------------------
// Wizard nueva / editar receta
// ---------------------------------------------------------------------------

export async function openRecipeForm(recipeId, onSuccess, opts = {}) {
  closeFloatList()
  const isEdit = recipeId !== null
  const catalog = await chemicals.list().catch(() => [])
  let existing = null
  if (isEdit) {
    try { existing = await api.get(recipeId) }
    catch (err) { toast.error(err.message); return }
  }

  const identityColor = existing?.color_name || existing?.color_reference || ''
  const identityTitle = existing?.yarn_title || ''
  const identityRef = existing?.commercial_ref || ''
  const existingName = String(existing?.name || '').trim()
  const existingStages = (existing?.ingredients || []).map((i) => canonicalStage(i.bath_stage || i.notes))
  const inferredDepth = existing?.color_depth
    || (existing?.fiber_type === 'acrilico' && existingStages.includes('reductivo') ? 'oscuros' : existing?.fiber_type === 'acrilico' ? 'oscuros' : '')
  const inferredRoute = existing?.process_route
    || (existingStages.includes('descrude') ? 'descrude' : existingStages.includes('preblanqueo') ? 'preblanqueo' : existing?.fiber_type === 'algodon' ? 'preblanqueo' : '')
  const state = {
    step: 0,
    name: existingName,
    nameLocked: nameIsLocked(existingName, identityRef, identityTitle, identityColor),
    code: existing?.code || '',
    fiber: existing?.fiber_type || '',
    color: identityColor,
    yarnTitle: identityTitle,
    commercialRef: identityRef,
    colorDepth: inferredDepth,
    processRoute: inferredRoute,
    temp: existing?.temperature_c ?? '',
    tolerance: 5,
    desc: existing?.notes || '',
    status: existing ? recipeLifecycle(existing) : 'development',
    stepsTouched: Boolean(existing?.steps?.length),
    ingredients: (existing?.ingredients || []).map(mapWizardIng),
    curve: mapWizardCurve(existing?.steps, existing?.fiber_type, inferredDepth, inferredRoute),
  }

  let restoredDraft = false
  const draft = readRecipeDraft(recipeId)
  if (draft) {
    state.step = Number(draft.step) || 0
    state.name = draft.name ?? state.name
    state.nameLocked = draft.nameLocked ?? state.nameLocked
    state.code = draft.code ?? state.code
    state.fiber = draft.fiber ?? state.fiber
    state.color = draft.color ?? state.color
    state.yarnTitle = draft.yarnTitle ?? state.yarnTitle
    state.commercialRef = draft.commercialRef ?? state.commercialRef
    state.colorDepth = draft.colorDepth ?? state.colorDepth
    state.processRoute = draft.processRoute ?? state.processRoute
    state.temp = draft.temp ?? state.temp
    state.tolerance = draft.tolerance ?? state.tolerance
    state.desc = draft.desc ?? state.desc
    state.status = draft.status ?? state.status
    if (Array.isArray(draft.ingredients)) state.ingredients = draft.ingredients
    if (draft.curve && typeof draft.curve === 'object') {
      state.curve = draft.curve
    } else if (Array.isArray(draft.steps)) {
      state.curve = mapWizardCurve(
        draft.steps.map((s) => ({
          bath_stage: s.notes || s.stage || s.bath_stage,
          step_name: s.name || s.step_name,
          temperature_c: s.temp ?? s.temperature_c,
          duration_min: s.duration ?? s.duration_min,
          ph_target: s.ph_target ?? draft.ph,
        })),
        state.fiber,
        state.colorDepth,
        state.processRoute,
      )
    }
    state.stepsTouched = draft.stepsTouched ?? state.stepsTouched
    restoredDraft = true
  }
  if (opts.step != null) state.step = opts.step
  {
    const ids = stageIdsFor(state.fiber, state.colorDepth, state.processRoute)
    const allowed = new Set(ids)
    const fallback = ids[0] || ''
    state.ingredients.forEach((i) => {
      if (i.stage && !allowed.has(i.stage)) i.stage = fallback
    })
  }

  const body = `
    <div class="wiz">
      <div class="wiz-stepper" id="wiz-stepper"></div>
      <div class="wiz-error" id="wiz-error" hidden></div>
      <div class="wiz-pane" id="wiz-pane"></div>
    </div>
  `

  function persistDraft() {
    snapshotPane()
    if (!hasProgress()) {
      clearRecipeDraft(recipeId)
      return
    }
    writeRecipeDraft(recipeId, {
      step: state.step,
      name: state.name,
      nameLocked: state.nameLocked,
      code: state.code,
      fiber: state.fiber,
      color: state.color,
      yarnTitle: state.yarnTitle,
      commercialRef: state.commercialRef,
      colorDepth: state.colorDepth,
      processRoute: state.processRoute,
      temp: state.temp,
      tolerance: state.tolerance,
      desc: state.desc,
      status: state.status,
      ingredients: state.ingredients,
      curve: state.curve,
      stepsTouched: state.stepsTouched,
    })
  }

  function hasProgress() {
    snapshotPane()
    return Boolean(
      state.name || state.code || state.fiber || state.color || state.yarnTitle ||
      state.commercialRef || state.colorDepth || state.processRoute || state.temp ||
      state.desc || state.ingredients.length || state.step > 0 ||
      Object.values(state.curve || {}).some((c) => c.ph || (c.phases || []).length || (c.notes || []).some((n) => String(n.text || '').trim()))
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

  function field(id) {
    return document.getElementById(id)
  }

  function readDatos() {
    const ref = field('rf-ref')
    if (ref) state.commercialRef = ref.value.trim()
    const title = field('rf-title')
    if (title) state.yarnTitle = title.value.trim()
    const color = field('rf-color')
    if (color) state.color = color.value.trim()
    const name = field('rf-name')
    if (name) state.name = name.value.trim()
    const code = field('rf-code')
    if (code) state.code = code.value.trim()
    const fiber = field('rf-fiber')
    if (fiber) {
      state.fiber = fiber.value || ''
      if (state.fiber === 'acrilico') {
        state.colorDepth = field('rf-depth')?.value || state.colorDepth || 'oscuros'
        state.processRoute = ''
      } else if (state.fiber === 'algodon') {
        state.colorDepth = ''
        state.processRoute = field('rf-route')?.value || state.processRoute || 'preblanqueo'
      } else {
        state.colorDepth = ''
        state.processRoute = ''
      }
    }
    const desc = field('rf-desc')
    if (desc) state.desc = desc.value.trim()
    const status = field('rf-status')
    if (status) state.status = status.value || state.status || 'development'
  }

  function ensureCurve() {
    if (!state.curve) state.curve = {}
    for (const st of allowedStages()) {
      if (!state.curve[st.id]) state.curve[st.id] = blankStageCurve()
      if (!Array.isArray(state.curve[st.id].phases)) state.curve[st.id].phases = []
      if (!Array.isArray(state.curve[st.id].notes)) state.curve[st.id].notes = []
    }
  }

  function readIngredientes() {
    pane.querySelectorAll('.wiz-ing').forEach((rowEl) => {
      const row = state.ingredients.find((i) => i.uid === rowEl.dataset.uid)
      if (!row) return
      const qty = rowEl.querySelector('.wiz-ing-qty')
      const basis = rowEl.querySelector('.wiz-ing-basis')
      if (qty) row.qty = qty.value
      if (basis) row.basis = basis.value
      const tempName = rowEl.querySelector('.wiz-temp-name')
      if (tempName) {
        row.name = tempName.value.toUpperCase()
        row.temporary = true
      }
      if (rowEl.dataset.stage) row.stage = rowEl.dataset.stage
    })
    pane.querySelectorAll('[data-stage-ph]').forEach((el) => {
      const id = el.dataset.stagePh
      if (!state.curve[id]) state.curve[id] = blankStageCurve()
      state.curve[id].ph = el.value
    })
    pane.querySelectorAll('.wiz-phase').forEach((el) => {
      const stage = el.dataset.stage
      const meta = state.curve[stage]
      const phase = meta?.phases?.find((p) => p.uid === el.dataset.uid)
      if (!phase) return
      phase.temp = el.querySelector('[data-phase-temp]')?.value ?? ''
      phase.duration = el.querySelector('[data-phase-duration]')?.value ?? ''
    })
    pane.querySelectorAll('.wiz-note').forEach((el) => {
      const stage = el.dataset.stage
      const meta = state.curve[stage]
      const note = meta?.notes?.find((n) => n.uid === el.dataset.uid)
      if (!note) return
      note.text = el.querySelector('[data-note-text]')?.value ?? ''
    })
  }

  function snapshotPane() {
    readDatos()
    readIngredientes()
  }

  function syncAutoName() {
    if (state.nameLocked) return
    const auto = composeRecipeName(state.commercialRef, state.yarnTitle, state.color)
    state.name = auto
    const nameEl = document.getElementById('rf-name')
    if (nameEl) nameEl.value = auto
  }

  function allowedStages() {
    return stagesFor(state.fiber, state.colorDepth, state.processRoute)
  }

  function applyPathToIngredients() {
    const allowed = allowedStages()
    const ids = new Set(allowed.map((s) => s.id))
    const fallback = allowed[0]?.id || ''
    state.ingredients.forEach((i) => {
      if (!ids.has(i.stage)) i.stage = fallback
    })
  }

  function bindDatos() {
    const onIdentity = () => {
      readDatos()
      syncAutoName()
      persistDraft()
    }
    const onFiberPath = () => {
      snapshotPane()
      applyPathToIngredients()
      ensureCurve()
      persistDraft()
      paint()
    }
    document.getElementById('rf-fiber')?.addEventListener('change', onFiberPath)
    document.getElementById('rf-depth')?.addEventListener('change', onFiberPath)
    document.getElementById('rf-route')?.addEventListener('change', onFiberPath)
    document.getElementById('rf-ref')?.addEventListener('input', onIdentity)
    document.getElementById('rf-title')?.addEventListener('input', onIdentity)
    document.getElementById('rf-color')?.addEventListener('input', onIdentity)
    document.getElementById('rf-name')?.addEventListener('input', () => {
      const typed = document.getElementById('rf-name')?.value.trim() || ''
      const auto = composeRecipeName(
        document.getElementById('rf-ref')?.value,
        document.getElementById('rf-title')?.value,
        document.getElementById('rf-color')?.value,
      )
      state.nameLocked = Boolean(typed && auto && typed !== auto)
      state.name = typed
    })
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
        snapshotPane()
        state.step = dest
        paint()
      }
    })
  }

  function paintFooter() {
    const host = document.getElementById('wiz-footer')
    if (!host) return
    const last = state.step === WIZ_STEPS.length - 1
    const phaseCount = Object.values(state.curve || {}).reduce((n, c) => n + (c.phases || []).length, 0)
    const meta = state.step === 1
      ? `${state.ingredients.length} producto${state.ingredients.length === 1 ? '' : 's'}${phaseCount ? ` · ${phaseCount} fase${phaseCount === 1 ? '' : 's'}` : ''}`
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
      snapshotPane()
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
            <p>Como en la hoja: referencia, título del hilo y color</p>
          </div>
        </header>
        <div class="wiz-card-body">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Referencia comercial</label>
              <input id="rf-ref" class="form-input" placeholder="Ej: Turin MP" value="${esc(state.commercialRef)}">
            </div>
            <div class="form-group">
              <label class="form-label">Título</label>
              <input id="rf-title" class="form-input" placeholder="Ej: 20/2" value="${esc(state.yarnTitle)}">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Color</label>
              <input id="rf-color" class="form-input" placeholder="Ej: 8770" value="${esc(state.color)}">
            </div>
            <div class="form-group">
              <label class="form-label">Tipo de fibra <span class="required"></span></label>
              <select id="rf-fiber" class="form-select">
                <option value="">Elegir fibra</option>
                ${Object.entries(FIBER_LABELS).map(([v, l]) => `<option value="${v}" ${state.fiber === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
          </div>
          ${state.fiber === 'acrilico' ? `
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Tono del color</label>
              <select id="rf-depth" class="form-select">
                <option value="oscuros" ${state.colorDepth !== 'claros' ? 'selected' : ''}>Oscuros / medios — teñido y reductivo</option>
                <option value="claros" ${state.colorDepth === 'claros' ? 'selected' : ''}>Claros — solo teñido</option>
              </select>
            </div>
          </div>` : ''}
          ${state.fiber === 'algodon' ? `
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Ruta de la fórmula</label>
              <select id="rf-route" class="form-select">
                <option value="preblanqueo" ${state.processRoute !== 'descrude' ? 'selected' : ''}>Preblanqueo → teñido, jabonado, fijado, suavizado</option>
                <option value="descrude" ${state.processRoute === 'descrude' ? 'selected' : ''}>Descrude → teñido, jabonado, fijado, suavizado</option>
              </select>
            </div>
          </div>` : ''}
          <p class="form-hint">${esc(processPathHint(state.fiber, state.colorDepth, state.processRoute))}</p>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Nombre en lista</label>
              <input id="rf-name" class="form-input" placeholder="Se arma con referencia, título y color" value="${esc(state.name)}">
            </div>
            <div class="form-group">
              <label class="form-label">Código</label>
              <input id="rf-code" class="form-input" placeholder="Se genera automáticamente" value="${esc(state.code)}">
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
          <div class="form-group">
            <label class="form-label">Notas</label>
            <textarea id="rf-desc" class="form-textarea" placeholder="Notas de la receta">${esc(state.desc)}</textarea>
          </div>
        </div>
      </section>`
  }

  function doseSelect(selected) {
    const opts = DOSE_BASES.filter((d) => d.id !== 'per_kg' || selected === 'per_kg')
    return `
      <select class="form-select wiz-ing-basis" title="Base de la dosis">
        ${opts.map((d) => `<option value="${d.id}" ${selected === d.id ? 'selected' : ''}>${d.label}</option>`).join('')}
      </select>`
  }

  function sheetRow(i, stageId) {
    const temp = Boolean(i.temporary)
    const product = temp
      ? `<input class="form-input wiz-temp-name" value="${esc(String(i.name || '').toUpperCase())}" placeholder="Nombre temporal" autocapitalize="characters">${isEdit ? `<div class="wiz-ac-wrap wiz-link-wrap"><input class="form-input wiz-link-q" data-uid="${esc(i.uid)}" placeholder="Asociar con inventario" autocomplete="off"><div class="wiz-ac" hidden></div></div>` : ''}`
      : `<strong>${esc(i.name)}</strong><code>${esc(i.code || '—')}</code>`
    return `
      <div class="wiz-ing wiz-sheet-row ${temp ? 'is-temp' : ''}" data-uid="${esc(i.uid)}" data-stage="${esc(stageId)}">
        <input class="form-input wiz-ing-qty" type="number" min="0.001" step="0.001" value="${esc(i.qty || '')}" placeholder="0">
        <div class="wiz-ing-copy">${product}</div>
        ${doseSelect(i.basis || 'percent')}
        <button type="button" class="chem-icon-btn is-danger" data-remove="${esc(i.uid)}" title="Quitar">×</button>
      </div>`
  }

  function paneIngredientes() {
    ensureCurve()
    const stages = allowedStages()
    return `
      <section class="wiz-card wiz-sheet">
        <div class="wiz-sheet-meta">
          <p class="wiz-hint-inline">${esc(processPathHint(state.fiber, state.colorDepth, state.processRoute))} La relación de baño la trae la máquina al crear el lote. En cada etapa van el pH, los °C/min y las indicaciones de la hoja.</p>
        </div>
        ${stages.map((st) => {
          const items = state.ingredients.filter((i) => i.stage === st.id)
          const meta = state.curve[st.id] || blankStageCurve()
          return `
            <div class="wiz-sheet-stage is-${st.tone}" data-stage-block="${st.id}">
              <div class="wiz-sheet-stage-h">
                <span>${esc(st.label)}</span>
                <label class="wiz-stage-ph">pH
                  <input class="form-input" data-stage-ph="${st.id}" type="number" min="0" max="14" step="0.01" placeholder="—" value="${esc(meta.ph || '')}">
                </label>
              </div>
              <div class="wiz-sheet-split">
                <div class="wiz-sheet-col is-products">
                  <div class="wiz-sheet-head">
                    <span>%</span>
                    <span>Productos usados</span>
                    <span>Base</span>
                    <span></span>
                  </div>
                  ${items.map((i) => sheetRow(i, st.id)).join('')}
                  <div class="wiz-sheet-add">
                    <div class="wiz-ac-wrap">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      <input class="form-input wiz-chem-q" data-stage="${st.id}" placeholder="Agregar producto a ${esc(st.label)}" autocomplete="off">
                      <div class="wiz-ac" hidden></div>
                    </div>
                    <button type="button" class="wiz-add wiz-add-temp" data-add-temp="${st.id}">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Producto temporal
                    </button>
                  </div>
                </div>
                <div class="wiz-sheet-col is-curve">
                  <div class="wiz-sheet-head wiz-sheet-head-curve">
                    <span>°C</span>
                    <span></span>
                    <span>min</span>
                    <span></span>
                  </div>
                  ${(meta.phases || []).map((p) => `
                    <div class="wiz-phase" data-uid="${esc(p.uid)}" data-stage="${st.id}">
                      <div class="wiz-metric">
                        <input class="form-input" data-phase-temp type="number" min="0" step="1" value="${esc(p.temp)}" placeholder="80">
                        <span>°C</span>
                      </div>
                      <span class="wiz-phase-dash">—</span>
                      <div class="wiz-metric">
                        <input class="form-input" data-phase-duration type="number" min="0" step="1" value="${esc(p.duration)}" placeholder="10">
                        <span>min</span>
                      </div>
                      <button type="button" class="chem-icon-btn is-danger" data-del-phase="${esc(p.uid)}" title="Quitar fase">×</button>
                    </div>`).join('')}
                  <div class="wiz-sheet-add">
                    <button type="button" class="wiz-add" data-add-phase="${st.id}">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Agregar temperatura
                    </button>
                  </div>
                </div>
              </div>
              <div class="wiz-notes">
                ${(meta.notes || []).map((n) => `
                  <div class="wiz-note" data-uid="${esc(n.uid)}" data-stage="${st.id}">
                    <input class="form-input" data-note-text value="${esc(n.text || '')}" placeholder="Enfriar, drenar, lavar, dosificar…">
                    <button type="button" class="chem-icon-btn is-danger" data-del-note="${esc(n.uid)}" title="Quitar indicación">×</button>
                  </div>`).join('')}
                <button type="button" class="wiz-add" data-add-note="${st.id}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Indicación
                </button>
              </div>
            </div>`
        }).join('')}
      </section>`
  }

  function paneResumen() {
    ensureCurve()
    const groups = allowedStages().map((st) => ({
      ...st,
      items: state.ingredients.filter((i) => i.stage === st.id),
      meta: state.curve[st.id] || { ph: '', phases: [] },
    })).filter((g) => g.items.length || g.meta.ph || (g.meta.phases || []).length || (g.meta.notes || []).some((n) => String(n.text || '').trim()))
    const mins = Object.values(state.curve).reduce(
      (s, c) => s + (c.phases || []).reduce((n, p) => n + (Number(p.duration) || 0), 0),
      0,
    )
    return `
      <section class="wiz-sum-hero">
        <div>
          <p class="wiz-kicker">${isEdit ? 'Edición de receta' : 'Nueva receta'}</p>
          <h3>${esc(state.name || 'Sin nombre')}</h3>
          <p>${[state.commercialRef, state.yarnTitle && `Título ${state.yarnTitle}`, state.color, FIBER_LABELS[state.fiber], processPathLabel(state.fiber, state.colorDepth, state.processRoute)].filter(Boolean).map(esc).join(' · ') || 'Sin identidad'}</p>
        </div>
        <code>${esc(state.code || 'Código automático')}</code>
      </section>
      <div class="wiz-sum-stats">
        <div class="wiz-stat"><span>Proceso</span><strong>${mins} min</strong></div>
        <div class="wiz-stat"><span>Productos</span><strong>${state.ingredients.length}</strong></div>
        <div class="wiz-stat"><span>Estado</span><strong>${recipeStatusMeta(state.status).label}</strong></div>
      </div>
      <section class="wiz-card wiz-sheet">
        <header class="wiz-card-head">
          <span class="wiz-card-ico is-accent">${WIZ_ICO.flask}</span>
          <div>
            <h3>Hoja por etapa</h3>
            <p>Productos y cantidad a la izquierda · °C y min a la derecha</p>
          </div>
        </header>
        ${groups.length ? groups.map(stageSheetHtml).join('') : '<p class="wiz-stage-empty">Sin fórmula aún.</p>'}
      </section>`
  }

  function bindIngredientes() {
    const wraps = [...pane.querySelectorAll('.wiz-ac-wrap')]

    const closeAllAc = (except) => {
      wraps.forEach((wrap) => {
        if (wrap === except) return
        const box = wrap.querySelector('.wiz-ac')
        if (box) box.hidden = true
      })
    }

    const bindSearch = (wrap) => {
      const input = wrap.querySelector('.wiz-chem-q')
      const box = wrap.querySelector('.wiz-ac')
      if (!input || !box) return
      const stageId = input.dataset.stage
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
            <span>${esc(c.code || '')}</span>
          </button>`).join('')
        box.hidden = false
        box.querySelectorAll('[data-chem]').forEach((btn) => {
          btn.onclick = () => {
            const chem = catalog.find((c) => c.id === Number(btn.dataset.chem))
            if (!chem) return
            readIngredientes()
            const rowUid = uid()
            state.ingredients.push({
              uid: rowUid,
              chemical_id: chem.id,
              name: chem.name,
              code: chem.code,
              unit: chem.unit || 'g',
              qty: '',
              stage: stageId,
              basis: 'percent',
              doseMin: '',
            })
            state.keepChemUid = rowUid
            paint()
          }
        })
      }
      input.oninput = () => { closeAllAc(wrap); renderAc(input.value) }
      input.onfocus = () => {
        closeAllAc(wrap)
        renderAc(input.value)
      }
      input.onkeydown = (e) => { if (e.key === 'Escape') box.hidden = true }
    }

    wraps.forEach(bindSearch)

    if (state._acOutside) {
      document.removeEventListener('pointerdown', state._acOutside, true)
      state._acOutside = null
    }
    state._acOutside = (e) => {
      if (wraps.some((wrap) => wrap.contains(e.target))) return
      closeAllAc()
    }
    document.addEventListener('pointerdown', state._acOutside, true)

    pane.querySelectorAll('.wiz-ing-qty').forEach((el) => {
      el.oninput = () => {
        const row = state.ingredients.find((i) => i.uid === el.closest('.wiz-ing')?.dataset.uid)
        if (row) row.qty = el.value
        persistDraft()
        paintFooter()
      }
    })
    pane.querySelectorAll('.wiz-ing-basis').forEach((el) => {
      el.onchange = () => {
        const row = state.ingredients.find((i) => i.uid === el.closest('.wiz-ing')?.dataset.uid)
        if (row) row.basis = el.value
        persistDraft()
      }
    })
    pane.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = () => {
        readIngredientes()
        state.ingredients = state.ingredients.filter((i) => i.uid !== btn.dataset.remove)
        paint()
      }
    })
    pane.querySelectorAll('.wiz-temp-name').forEach((el) => {
      el.oninput = () => {
        const next = el.value.toUpperCase()
        if (el.value !== next) {
          const pos = el.selectionStart
          el.value = next
          el.setSelectionRange(pos, pos)
        }
        const row = state.ingredients.find((i) => i.uid === el.closest('.wiz-ing')?.dataset.uid)
        if (row) {
          row.name = next
          row.temporary = true
        }
        persistDraft()
      }
    })
    pane.querySelectorAll('[data-add-temp]').forEach((btn) => {
      btn.onclick = () => {
        readIngredientes()
        const rowUid = uid()
        state.ingredients.push({
          uid: rowUid,
          chemical_id: null,
          name: '',
          code: '',
          temporary: true,
          qty: '',
          stage: btn.dataset.addTemp,
          basis: 'percent',
          doseMin: '',
        })
        state.keepTempUid = rowUid
        paint()
      }
    })
    pane.querySelectorAll('.wiz-link-wrap').forEach((wrap) => {
      const input = wrap.querySelector('.wiz-link-q')
      const box = wrap.querySelector('.wiz-ac')
      if (!input || !box) return
      const rowUid = input.dataset.uid
      const render = (q) => {
        const query = q.trim().toLowerCase()
        const hits = catalog.filter((c) => {
          if (!query) return true
          return String(c.name || '').toLowerCase().includes(query) || String(c.code || '').toLowerCase().includes(query)
        }).slice(0, 8)
        if (!hits.length) {
          box.innerHTML = '<div class="wiz-ac-empty">Sin coincidencias en inventario</div>'
          box.hidden = false
          return
        }
        box.innerHTML = hits.map((c) => `
          <button type="button" class="wiz-ac-item" data-chem="${c.id}">
            <strong>${esc(c.name)}</strong><span>${esc(c.code || '')}</span>
          </button>`).join('')
        box.hidden = false
        box.querySelectorAll('[data-chem]').forEach((el) => {
          el.onclick = () => {
            const chem = catalog.find((c) => c.id === Number(el.dataset.chem))
            const row = state.ingredients.find((i) => i.uid === rowUid)
            if (!chem || !row) return
            readIngredientes()
            row.temporary = false
            row.chemical_id = chem.id
            row.name = chem.name
            row.code = chem.code
            row.unit = chem.unit || row.unit
            paint()
          }
        })
      }
      input.oninput = () => render(input.value)
      input.onfocus = () => render(input.value)
    })
    pane.querySelectorAll('[data-stage-ph]').forEach((el) => {
      el.oninput = () => {
        const id = el.dataset.stagePh
        if (!state.curve[id]) state.curve[id] = blankStageCurve()
        state.curve[id].ph = el.value
        persistDraft()
      }
    })
    pane.querySelectorAll('[data-phase-temp], [data-phase-duration]').forEach((el) => {
      el.oninput = () => {
        readIngredientes()
        persistDraft()
      }
    })
    pane.querySelectorAll('[data-add-phase]').forEach((btn) => {
      btn.onclick = () => {
        readIngredientes()
        const id = btn.dataset.addPhase
        if (!state.curve[id]) state.curve[id] = blankStageCurve()
        const rowUid = uid()
        state.curve[id].phases.push({ uid: rowUid, temp: '', duration: '' })
        state.keepPhaseUid = rowUid
        paint()
      }
    })
    pane.querySelectorAll('[data-del-phase]').forEach((btn) => {
      btn.onclick = () => {
        readIngredientes()
        const uidDel = btn.dataset.delPhase
        Object.values(state.curve).forEach((c) => {
          c.phases = (c.phases || []).filter((p) => p.uid !== uidDel)
        })
        paint()
      }
    })
    pane.querySelectorAll('[data-note-text]').forEach((el) => {
      el.oninput = () => {
        readIngredientes()
        persistDraft()
      }
    })
    pane.querySelectorAll('[data-add-note]').forEach((btn) => {
      btn.onclick = () => {
        readIngredientes()
        const id = btn.dataset.addNote
        if (!state.curve[id]) state.curve[id] = blankStageCurve()
        if (!Array.isArray(state.curve[id].notes)) state.curve[id].notes = []
        const rowUid = uid()
        state.curve[id].notes.push({ uid: rowUid, text: '' })
        state.keepNoteUid = rowUid
        paint()
      }
    })
    pane.querySelectorAll('[data-del-note]').forEach((btn) => {
      btn.onclick = () => {
        readIngredientes()
        const uidDel = btn.dataset.delNote
        Object.values(state.curve).forEach((c) => {
          c.notes = (c.notes || []).filter((n) => n.uid !== uidDel)
        })
        paint()
      }
    })
    if (state.keepNoteUid) {
      const input = pane.querySelector(`.wiz-note[data-uid="${state.keepNoteUid}"] [data-note-text]`)
      state.keepNoteUid = ''
      input?.focus({ preventScroll: true })
    }
    if (state.keepPhaseUid) {
      const temp = pane.querySelector(`.wiz-phase[data-uid="${state.keepPhaseUid}"] [data-phase-temp]`)
      state.keepPhaseUid = ''
      temp?.focus({ preventScroll: true })
    }

    if (state.keepTempUid) {
      const name = pane.querySelector(`.wiz-ing[data-uid="${state.keepTempUid}"] .wiz-temp-name`)
      state.keepTempUid = ''
      name?.focus({ preventScroll: true })
    }
    if (state.keepChemUid) {
      const qty = pane.querySelector(`.wiz-ing[data-uid="${state.keepChemUid}"] .wiz-ing-qty`)
      state.keepChemUid = ''
      if (qty) {
        qty.focus({ preventScroll: true })
        qty.select()
      }
    }
  }

  function paint() {
    if (state._acOutside) {
      document.removeEventListener('pointerdown', state._acOutside, true)
      state._acOutside = null
    }
    showError('')
    paintStepper()
    if (state.step === 0) { pane.innerHTML = paneDatos(); bindDatos() }
    if (state.step === 1) { pane.innerHTML = paneIngredientes(); bindIngredientes() }
    if (state.step === 2) pane.innerHTML = paneResumen()
    paintFooter()
    document.getElementById('wiz-discard-draft')?.addEventListener('click', () => {
      clearRecipeDraft(recipeId)
      restoredDraft = false
      state.step = 0
      state.name = existing?.name || ''
      state.nameLocked = nameIsLocked(existing?.name, existing?.commercial_ref, existing?.yarn_title, existing?.color_name || existing?.color_reference)
      state.code = existing?.code || ''
      state.fiber = existing?.fiber_type || ''
      state.color = existing?.color_name || existing?.color_reference || ''
      state.yarnTitle = existing?.yarn_title || ''
      state.commercialRef = existing?.commercial_ref || ''
      state.colorDepth = existing?.color_depth || (existing?.fiber_type === 'acrilico' ? 'oscuros' : '')
      state.processRoute = existing?.process_route || (existing?.fiber_type === 'algodon' ? 'preblanqueo' : '')
      state.temp = existing?.temperature_c ?? ''
      state.tolerance = 5
      state.desc = existing?.notes || ''
      state.stepsTouched = Boolean(existing?.steps?.length)
      state.status = existing ? recipeLifecycle(existing) : 'development'
      state.ingredients = (existing?.ingredients || []).map(mapWizardIng)
      state.curve = mapWizardCurve(existing?.steps, existing?.fiber_type, state.colorDepth, state.processRoute)
      paint()
    })
    persistDraft()
  }

  function collectPayload() {
    ensureCurve()
    const unitFor = (basis, fallback) => (
      basis === 'percent' ? '%' : basis === 'g_l' ? 'g/L' : (fallback || 'g')
    )
    const stageOrder = allowedStages().map((s) => s.id)
    const steps = curveToRecipeSteps(state.curve, state.fiber, state.colorDepth, state.processRoute)
    const maxTemp = steps.reduce((m, s) => Math.max(m, parseFloat(s.temperature_c) || 0), 0)
    const mins = steps.reduce((s, p) => s + (parseInt(p.duration_min, 10) || 0), 0)
    const sortedIngs = [...state.ingredients].sort((a, b) => (
      stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage)
    ))
    return {
      name: state.name,
      code: state.code || undefined,
      fiber_type: state.fiber || undefined,
      color_name: state.color || undefined,
      color_reference: state.color || undefined,
      yarn_title: state.yarnTitle || '',
      commercial_ref: state.commercialRef || '',
      color_depth: state.fiber === 'acrilico' ? (state.colorDepth || 'oscuros') : null,
      process_route: state.fiber === 'algodon' ? (state.processRoute || 'preblanqueo') : null,
      temperature_c: maxTemp || undefined,
      bath_ratio_l_per_kg: null,
      process_time_min: mins || undefined,
      notes: state.desc || undefined,
      ...(isAdmin() ? { status: state.status || 'development' } : {}),
      steps,
      ingredients: sortedIngs.filter((i) => Number(i.qty) > 0 && (i.chemical_id || (i.temporary && String(i.name || '').trim()))).map((i, idx) => ({
        chemical_id: i.chemical_id || undefined,
        temp_name: i.temporary ? String(i.name || '').trim().toUpperCase() : undefined,
        quantity_per_kg: Number(i.qty),
        unit: unitFor(i.basis, i.unit),
        dose_basis: i.basis || 'percent',
        tolerance_percentage: parseFloat(state.tolerance) || 5,
        sort_order: idx,
        bath_stage: i.stage,
        notes: i.stage,
        dose_min: parseInt(i.doseMin, 10) > 0 ? parseInt(i.doseMin, 10) : null,
      })),
    }
  }

  async function ensureTempChemicals() {
    for (const ing of state.ingredients) {
      if (!ing.temporary || ing.chemical_id) continue
      const name = String(ing.name || '').trim().toUpperCase()
      if (!name) continue
      ing.name = name
      const created = await chemicals.create({
        name,
        code: `TMP${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
        chemical_type: 'otros',
        unit: 'kg',
        notes: 'Producto temporal de fórmula',
      })
      ing.chemical_id = created.id
      ing.code = created.code || ing.code
    }
  }

  async function onNext() {
    snapshotPane()
    if (state.step === 0) {
      if (!state.name) state.name = composeRecipeName(state.commercialRef, state.yarnTitle, state.color)
      if (!state.fiber) { showError('Indica el tipo de fibra: las etapas dependen de eso'); return }
      if (!state.name) { showError('Indica referencia, título, color o un nombre'); return }
    }
    if (state.step === 1) {
      if (!state.ingredients.length) {
        showError('Agrega al menos un producto en una etapa')
        return
      }
      if (state.ingredients.some((i) => i.temporary && !String(i.name || '').trim())) {
        showError('Indica el nombre de cada producto temporal')
        return
      }
      if (state.ingredients.some((i) => !Number(i.qty))) {
        showError('Indica la cantidad de cada producto')
        return
      }
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
      await ensureTempChemicals()
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

function loadCurve(recipe) {
  const curve = mapWizardCurve(recipe.steps, recipe.fiber_type, recipe.color_depth, recipe.process_route)
  const known = new Set(stageIdsFor(recipe.fiber_type, recipe.color_depth, recipe.process_route))
  for (const s of recipe.steps || []) {
    const stage = canonicalStage(s.bath_stage) || inferStageFromStepName(s.step_name)
    if (!stage || known.has(stage)) continue
    if (!curve[stage]) curve[stage] = blankStageCurve()
    if (String(s.notes || '') === 'indicacion') {
      curve[stage].notes.push({ uid: uid(), text: s.step_name || '' })
      continue
    }
    const temp = s.temperature_c ?? ''
    const duration = s.duration_min ?? ''
    const ph = s.ph_target ?? ''
    if (ph !== '' && ph != null && !curve[stage].ph) curve[stage].ph = ph
    if (temp !== '' || duration !== '') curve[stage].phases.push({ uid: uid(), temp, duration })
  }
  return curve
}

async function openNextColor(sourceId) {
  let base
  let catalog = []
  let library = []
  try {
    const [recipe, chems, all] = await Promise.all([
      api.get(sourceId),
      chemicals.list().catch(() => []),
      api.list({}, { fresh: true }).catch(() => []),
    ])
    base = recipe
    catalog = Array.isArray(chems) ? chems : []
    library = Array.isArray(all) ? all : []
  } catch (err) {
    toast.error(err.message)
    return
  }

  const state = {
    base,
    color: '',
    ref: base.commercial_ref || '',
    title: base.yarn_title || '',
    fiber: base.fiber_type || '',
    ingredients: (base.ingredients || []).map(mapWizardIng),
    curve: loadCurve(base),
    formulaOk: false,
    saved: 0,
    hint: 'Confirma la fórmula o marca que es igual a la hoja.',
  }

  openModal('Otro color', `<div id="nx-root"></div>`, {
    drawer: true,
    size: 'wide',
    footerHTML: `
      <button type="button" class="btn btn-secondary" id="nx-close">Cerrar</button>
      <button type="button" class="btn btn-primary" id="nx-save" disabled>Guardar y siguiente hoja</button>`,
  })

  const root = () => document.getElementById('nx-root')
  const stagesOf = () => {
    const known = stageIdsFor(state.fiber, state.base.color_depth, state.base.process_route)
    const extra = [...state.ingredients.map((i) => i.stage), ...Object.keys(state.curve || {})]
      .filter((id) => id && !known.includes(id))
    const ids = [...known, ...new Set(extra)]
    return ids.map((id) => BATH_STAGES.find((s) => s.id === id)).filter(Boolean)
  }

  function readLines() {
    const host = root()
    if (!host) return
    state.color = host.querySelector('#nx-color')?.value.trim() || ''
    state.ref = host.querySelector('#nx-ref')?.value.trim() || ''
    state.title = host.querySelector('#nx-title')?.value.trim() || ''
    state.fiber = host.querySelector('#nx-fiber')?.value || ''
    host.querySelectorAll('.nx-line').forEach((row) => {
      const item = state.ingredients.find((i) => i.uid === row.dataset.uid)
      if (!item) return
      item.qty = row.querySelector('.nx-qty')?.value || ''
      item.basis = row.querySelector('.nx-basis')?.value || item.basis
      const name = row.querySelector('.nx-temp')
      if (name) item.name = name.value
    })
    host.querySelectorAll('[data-nx-ph]').forEach((el) => {
      const id = el.dataset.nxPh
      if (!state.curve[id]) state.curve[id] = blankStageCurve()
      state.curve[id].ph = el.value
    })
    host.querySelectorAll('.nx-phase').forEach((row) => {
      const phase = state.curve[row.dataset.stage]?.phases?.find((p) => p.uid === row.dataset.uid)
      if (!phase) return
      phase.temp = row.querySelector('[data-nx-temp]')?.value ?? ''
      phase.duration = row.querySelector('[data-nx-min]')?.value ?? ''
    })
    host.querySelectorAll('.nx-note').forEach((row) => {
      const note = state.curve[row.dataset.stage]?.notes?.find((n) => n.uid === row.dataset.uid)
      if (note) note.text = row.querySelector('[data-nx-note]')?.value ?? ''
    })
  }

  function canSave() {
    return Boolean(state.color.trim()) && state.formulaOk && state.ingredients.some((i) => Number(i.qty) > 0)
  }

  function paintSave() {
    const btn = document.getElementById('nx-save')
    if (btn) btn.disabled = !canSave()
    const flag = root()?.querySelector('#nx-flag')
    if (flag) {
      flag.textContent = state.formulaOk ? 'Fórmula confirmada' : 'Fórmula sin confirmar'
      flag.classList.toggle('is-ok', state.formulaOk)
    }
  }

  function paint() {
    const host = root()
    if (!host) return
    for (const st of stagesOf()) {
      if (!state.curve[st.id]) state.curve[st.id] = blankStageCurve()
    }
    const stages = stagesOf()
    const grouped = stages.map((st) => ({
      ...st,
      items: state.ingredients.filter((i) => (i.stage || 'tenido') === st.id),
    }))
    host.innerHTML = `
      <div class="nx-sheet">
        <p class="nx-lead">${state.saved ? `${state.saved} hoja${state.saved === 1 ? '' : 's'} guardada${state.saved === 1 ? '' : 's'}. ` : ''}Escribe el color de la hoja. La fórmula viene de la base: confírmala si es igual, o cambia la línea que sea distinta.</p>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Color <span class="required"></span></label>
            <input id="nx-color" class="form-input" placeholder="Ej: 8770" value="${esc(state.color)}" autofocus>
          </div>
          <div class="form-group">
            <label class="form-label">Referencia</label>
            <input id="nx-ref" class="form-input" value="${esc(state.ref)}" placeholder="Otra referencia cambia la base">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Título</label>
            <input id="nx-title" class="form-input" value="${esc(state.title)}">
          </div>
          <div class="form-group">
            <label class="form-label">Fibra</label>
            <select id="nx-fiber" class="form-select">
              <option value="">Sin fibra</option>
              ${Object.entries(FIBER_LABELS).map(([id, label]) => `<option value="${id}" ${state.fiber === id ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </div>
        </div>
        <p class="form-hint" id="nx-hint">${esc(state.hint)}</p>
        <div class="nx-formula">
          <div class="nx-formula-h">
            <strong>Fórmula</strong>
            <span id="nx-flag" class="${state.formulaOk ? 'is-ok' : ''}">${state.formulaOk ? 'Fórmula confirmada' : 'Fórmula sin confirmar'}</span>
            <button type="button" class="btn btn-secondary btn-sm" id="nx-same">La fórmula es igual</button>
          </div>
          ${grouped.map((st) => `
            <section class="nx-block" data-stage-box="${esc(st.id)}">
              <div class="nx-stage-h">
                <p class="nx-stage">${esc(st.label)}</p>
                <label class="nx-ph">pH
                  <input class="form-input" data-nx-ph="${esc(st.id)}" type="number" min="0" max="14" step="0.01" placeholder="—" value="${esc((state.curve[st.id] || {}).ph || '')}">
                </label>
              </div>
              <div class="nx-split">
                <div class="nx-col">
                  <div class="nx-add">
                    <input class="form-input nx-add-q" data-nx-q="${esc(st.id)}" placeholder="Buscar o escribir producto" autocomplete="off">
                    <button type="button" class="btn btn-secondary btn-sm" data-nx-add="${esc(st.id)}">Agregar</button>
                  </div>
                  <div class="nx-hits" data-nx-hits="${esc(st.id)}" hidden></div>
                  ${st.items.map((i) => `
                    <div class="nx-line" data-uid="${esc(i.uid)}">
                      <input class="form-input nx-qty" type="number" min="0" step="0.001" value="${esc(i.qty)}">
                      ${i.temporary
                        ? `<input class="form-input nx-temp" value="${esc(i.name)}" placeholder="Producto">`
                        : `<div class="nx-name"><strong>${esc(i.name)}</strong><code>${esc(i.code || '')}</code></div>`}
                      <select class="form-select nx-basis">
                        ${DOSE_BASES.map((d) => `<option value="${d.id}" ${i.basis === d.id ? 'selected' : ''}>${d.label}</option>`).join('')}
                      </select>
                      <button type="button" class="chem-icon-btn is-danger" data-nx-del="${esc(i.uid)}" title="Quitar">×</button>
                    </div>`).join('')}
                </div>
                <div class="nx-col nx-curve">
                  <div class="nx-curve-h"><span>°C</span><span>min</span></div>
                  ${((state.curve[st.id] || {}).phases || []).map((p) => `
                    <div class="nx-phase" data-uid="${esc(p.uid)}" data-stage="${esc(st.id)}">
                      <div class="nx-metric">
                        <input class="form-input" data-nx-temp type="number" min="0" step="1" value="${esc(p.temp)}" placeholder="80">
                        <span>°C</span>
                      </div>
                      <span class="nx-dash">—</span>
                      <div class="nx-metric">
                        <input class="form-input" data-nx-min type="number" min="0" step="1" value="${esc(p.duration)}" placeholder="10">
                        <span>min</span>
                      </div>
                      <button type="button" class="chem-icon-btn is-danger" data-nx-del-phase="${esc(p.uid)}" title="Quitar">×</button>
                    </div>`).join('')}
                  <button type="button" class="btn btn-secondary btn-sm nx-mini" style="justify-content: center; font-size: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted);" data-nx-phase="${esc(st.id)}">+ Temperatura</button>
                </div>
              </div>
              <div class="nx-notes">
                ${((state.curve[st.id] || {}).notes || []).map((n) => `
                  <div class="nx-note" data-uid="${esc(n.uid)}" data-stage="${esc(st.id)}">
                    <input class="form-input" data-nx-note value="${esc(n.text || '')}" placeholder="Enfriar, drenar, lavar, dosificar…">
                    <button type="button" class="chem-icon-btn is-danger" data-nx-del-note="${esc(n.uid)}" title="Quitar">×</button>
                  </div>`).join('')}
                <button type="button" class="btn btn-secondary btn-sm nx-mini" style="justify-content: center; font-size: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted);" data-nx-note-add="${esc(st.id)}">+ Indicación</button>
              </div>
            </section>
          `).join('')}
        </div>
      </div>`
    host.querySelector('#nx-color').oninput = (e) => { state.color = e.target.value.trim(); paintSave() }
    host.querySelector('#nx-title').oninput = (e) => { state.title = e.target.value.trim() }
    host.querySelector('#nx-fiber').onchange = (e) => { state.fiber = e.target.value }
    host.querySelector('#nx-ref').onchange = async (e) => {
      const next = e.target.value.trim()
      state.ref = next
      await switchBase(next)
    }
    host.querySelectorAll('.nx-qty, .nx-basis, .nx-temp').forEach((el) => {
      el.oninput = () => { readLines(); state.formulaOk = true; state.hint = 'Hay cambios en la fórmula.'; paintSave(); const hint = host.querySelector('#nx-hint'); if (hint) hint.textContent = state.hint }
    })
    host.querySelectorAll('[data-nx-del]').forEach((btn) => {
      btn.onclick = () => {
        readLines()
        state.ingredients = state.ingredients.filter((i) => i.uid !== btn.dataset.nxDel)
        state.formulaOk = true
        state.hint = 'Quitaste un producto. Revisa el resto y guarda.'
        paint()
      }
    })
    host.querySelectorAll('[data-nx-ph], [data-nx-temp], [data-nx-min], [data-nx-note]').forEach((el) => {
      el.oninput = () => {
        readLines()
        state.formulaOk = true
        state.hint = 'Hay cambios en la curva de la etapa.'
        const hint = host.querySelector('#nx-hint')
        if (hint) hint.textContent = state.hint
        paintSave()
      }
    })
    host.querySelectorAll('[data-nx-phase]').forEach((btn) => {
      btn.onclick = () => {
        readLines()
        const id = btn.dataset.nxPhase
        if (!state.curve[id]) state.curve[id] = blankStageCurve()
        const rowUid = uid()
        state.curve[id].phases.push({ uid: rowUid, temp: '', duration: '' })
        state.focusSel = `.nx-phase[data-uid="${rowUid}"] [data-nx-temp]`
        state.formulaOk = true
        state.hint = 'Agregaste una temperatura. Indica °C y minutos.'
        paint()
      }
    })
    host.querySelectorAll('[data-nx-del-phase]').forEach((btn) => {
      btn.onclick = () => {
        readLines()
        Object.values(state.curve).forEach((c) => {
          c.phases = (c.phases || []).filter((p) => p.uid !== btn.dataset.nxDelPhase)
        })
        state.formulaOk = true
        paint()
      }
    })
    host.querySelectorAll('[data-nx-note-add]').forEach((btn) => {
      btn.onclick = () => {
        readLines()
        const id = btn.dataset.nxNoteAdd
        if (!state.curve[id]) state.curve[id] = blankStageCurve()
        const rowUid = uid()
        state.curve[id].notes.push({ uid: rowUid, text: '' })
        state.focusSel = `.nx-note[data-uid="${rowUid}"] [data-nx-note]`
        state.formulaOk = true
        state.hint = 'Agregaste una indicación.'
        paint()
      }
    })
    host.querySelectorAll('[data-nx-del-note]').forEach((btn) => {
      btn.onclick = () => {
        readLines()
        Object.values(state.curve).forEach((c) => {
          c.notes = (c.notes || []).filter((n) => n.uid !== btn.dataset.nxDelNote)
        })
        state.formulaOk = true
        paint()
      }
    })
    host.querySelector('#nx-same').onclick = () => {
      readLines()
      state.formulaOk = true
      state.hint = 'Fórmula igual a la base. Solo cambia el color.'
      const hint = host.querySelector('#nx-hint')
      if (hint) hint.textContent = state.hint
      paintSave()
    }
    host.querySelectorAll('[data-nx-q]').forEach((query) => {
      const stage = query.dataset.nxQ
      const hits = host.querySelector(`[data-nx-hits="${stage}"]`)
      query.oninput = () => {
        const q = query.value.trim().toLowerCase()
        if (q.length < 2) { hits.hidden = true; hits.innerHTML = ''; return }
        const found = catalog.filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(q)).slice(0, 6)
        hits.hidden = !found.length
        hits.innerHTML = found.map((c) => `<button type="button" data-chem="${c.id}">${esc(c.name)} <code>${esc(c.code || '')}</code></button>`).join('')
        hits.querySelectorAll('[data-chem]').forEach((btn) => {
          btn.onclick = () => addChemical(catalog.find((c) => c.id === Number(btn.dataset.chem)), null, stage)
        })
      }
    })
    host.querySelectorAll('[data-nx-add]').forEach((btn) => {
      btn.onclick = () => {
        const stage = btn.dataset.nxAdd
        const query = host.querySelector(`[data-nx-q="${stage}"]`)
        const name = query?.value.trim() || ''
        if (!name) return
        const found = catalog.find((c) => c.name.toLowerCase() === name.toLowerCase() || String(c.code || '').toLowerCase() === name.toLowerCase())
        if (found) addChemical(found, null, stage)
        else addChemical(null, name, stage)
      }
    })
    paintSave()
    if (state.focusUid) {
      const qty = host.querySelector(`.nx-line[data-uid="${state.focusUid}"] .nx-qty`)
      state.focusUid = ''
      if (qty) {
        qty.focus()
        qty.select()
        return
      }
    }
    if (state.focusSel) {
      const el = host.querySelector(state.focusSel)
      state.focusSel = ''
      if (el) {
        el.focus()
        return
      }
    }
    if (!state.color) host.querySelector('#nx-color')?.focus()
  }

  function addChemical(chem, tempName, stage = 'tenido') {
    readLines()
    const rowUid = uid()
    const row = chem ? {
      uid: rowUid,
      chemical_id: chem.id,
      name: chem.name,
      code: chem.code || '',
      unit: chem.unit || 'g',
      qty: '',
      stage,
      basis: 'percent',
      temporary: false,
    } : {
      uid: rowUid,
      chemical_id: null,
      name: String(tempName || '').toUpperCase(),
      code: '',
      unit: 'g',
      qty: '',
      stage,
      basis: 'percent',
      temporary: true,
    }
    const at = state.ingredients.findIndex((i) => (i.stage || 'tenido') === stage)
    if (at === -1) state.ingredients.push(row)
    else state.ingredients.splice(at, 0, row)
    state.focusUid = rowUid
    state.formulaOk = true
    state.hint = 'Agregaste un producto. Indica su dosis.'
    paint()
  }

  async function switchBase(ref) {
    const key = ref.trim().toLowerCase()
    if (!key || key === String(state.base.commercial_ref || '').trim().toLowerCase()) {
      state.hint = 'Misma referencia. Sigue con el siguiente color.'
      paint()
      return
    }
    const hits = library.filter((r) => String(r.commercial_ref || '').trim().toLowerCase() === key)
    const titled = hits.find((r) => String(r.yarn_title || '').trim().toLowerCase() === state.title.trim().toLowerCase())
    const pick = titled || hits[0]
    if (!pick) {
      state.hint = 'No hay una receta con esa referencia. La fórmula actual se conserva.'
      paint()
      return
    }
    try {
      const full = await api.get(pick.id)
      state.base = full
      state.ref = full.commercial_ref || ref
      state.title = full.yarn_title || state.title
      state.fiber = full.fiber_type || state.fiber
      state.ingredients = (full.ingredients || []).map(mapWizardIng)
      state.curve = loadCurve(full)
      state.formulaOk = false
      state.hint = `Base cambiada a ${full.color_name || full.code || 'esa referencia'}. Confirma la fórmula.`
      paint()
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function save() {
    readLines()
    const errHost = root()?.querySelector('#nx-hint')
    if (!state.color) {
      if (errHost) errHost.textContent = 'Indica el color de la hoja.'
      return
    }
    if (!state.formulaOk) {
      if (errHost) errHost.textContent = 'Confirma la fórmula con “La fórmula es igual” o editando una línea.'
      return
    }
    const usable = state.ingredients.filter((i) => Number(i.qty) > 0 && (i.chemical_id || (i.temporary && String(i.name || '').trim())))
    if (!usable.length) {
      if (errHost) errHost.textContent = 'Deja al menos un producto con dosis.'
      return
    }
    const btn = document.getElementById('nx-save')
    btn.disabled = true
    try {
      for (const ing of usable) {
        if (!ing.temporary || ing.chemical_id) continue
        const name = String(ing.name || '').trim().toUpperCase()
        const created = await chemicals.create({
          name,
          code: `TMP${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
          chemical_type: 'otros',
          unit: 'kg',
          notes: 'Producto temporal de fórmula',
        })
        ing.chemical_id = created.id
        ing.code = created.code || ''
        ing.name = name
      }
      const unitFor = (basis, fallback) => (basis === 'percent' ? '%' : basis === 'g_l' ? 'g/L' : (fallback || 'g'))
      const steps = curveToRecipeSteps(state.curve, state.fiber, state.base.color_depth, state.base.process_route, stagesOf())
      const maxTemp = steps.reduce((m, s) => Math.max(m, Number(s.temperature_c) || 0), 0)
      const mins = steps.reduce((s, p) => s + (Number(p.duration_min) || 0), 0)
      const created = await api.create({
        name: composeRecipeName(state.ref, state.title, state.color),
        fiber_type: state.fiber || undefined,
        color_name: state.color,
        color_reference: state.color,
        yarn_title: state.title,
        commercial_ref: state.ref,
        color_depth: state.fiber === 'acrilico' ? (state.base.color_depth || 'oscuros') : null,
        process_route: state.fiber === 'algodon' ? (state.base.process_route || 'preblanqueo') : null,
        temperature_c: maxTemp || undefined,
        process_time_min: mins || undefined,
        notes: state.base.notes || undefined,
        status: 'development',
        steps,
        ingredients: usable.map((i, idx) => ({
          chemical_id: i.chemical_id || undefined,
          temp_name: i.temporary ? String(i.name || '').trim().toUpperCase() : undefined,
          quantity_per_kg: Number(i.qty),
          unit: unitFor(i.basis, i.unit),
          dose_basis: i.basis || 'percent',
          sort_order: idx,
          bath_stage: i.stage,
          notes: i.stage,
        })),
      })
      state.saved += 1
      state.color = ''
      state.formulaOk = false
      state.hint = `Se guardó ${created.code || 'la hoja'}. Escribe el siguiente color o cambia la referencia.`
      library.push({
        id: created.id,
        commercial_ref: state.ref,
        yarn_title: state.title,
        color_name: created.color_name,
        code: created.code,
      })
      toast.success(`Hoja ${created.code || ''} guardada`.trim())
      loadRecipes()
      paint()
    } catch (err) {
      if (errHost) errHost.textContent = err.message
      toast.error(err.message)
      paintSave()
    }
  }

  document.getElementById('nx-close').onclick = () => closeModal()
  document.getElementById('nx-save').onclick = save
  paint()
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
