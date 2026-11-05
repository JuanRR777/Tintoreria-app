const FIBER_LABELS = {
  lana: 'Lana', algodon: 'Algodón', acrilico: 'Acrílico', poliester: 'Poliéster',
  nylon: 'Nylon', seda: 'Seda', mezcla: 'Mezcla', otros: 'Otros',
}

export const PROC_STEPS = [
  { id: 'programado', label: 'Programado' },
  { id: 'pesaje', label: 'Pesaje' },
  { id: 'tincion', label: 'Tiñendo' },
  { id: 'fijacion', label: 'Fijación' },
  { id: 'terminado', label: 'Terminado' },
]

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function isWeighed(w) {
  return w?.status === 'weighed' || w?.status === 'validated'
}

export function fiberLabel(value) {
  return FIBER_LABELS[value] || value || 'Sin definir'
}

export function recipeColor(p) {
  return p.recipe_color_name || p.recipe_color_ref || p.color_reference || 'Sin definir'
}

export function fmtLotDate(value) {
  if (!value) return ''
  const d = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return String(value)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export function fmtQty(n, unit = 'kg') {
  const num = Number(n || 0)
  const text = Number.isFinite(num)
    ? num.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : '0,0'
  return `${text} ${unit || 'kg'}`
}

export function fmtExactQty(n, unit = 'kg') {
  const num = Number(n)
  if (!Number.isFinite(num)) return `— ${unit || 'kg'}`
  const text = num.toLocaleString('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })
  return `${text} ${unit || 'kg'}`
}

export function lotLine(w) {
  const lot = w.lot_number || w.suggested_lot
  const exp = w.suggested_expiry
    ? `vence ${fmtLotDate(w.suggested_expiry)}`
    : (lot ? 'sin vencimiento' : 'sin lote')
  return lot ? `Lote sugerido: ${lot} · ${exp}` : exp
}

export function weighCounts(p, weighings = []) {
  const items = p.weighings || weighings
  const total = Number(p.weigh_total || items.length || 0)
  const done = Number(p.weigh_done ?? items.filter(isWeighed).length)
  return { total, done, items }
}

export function processStage(p, { inWeighing = false } = {}) {
  if (p.status === 'cancelled') return -1
  if (p.status === 'completed') return 4
  const { total, done } = weighCounts(p)
  if (inWeighing) {
    if (p.status === 'in_progress' && total > 0 && done >= total) return 2
    return 1
  }
  if (p.status === 'pending' && done === 0) return 0
  if (total > 0 && done < total) return 1
  if (p.status === 'paused') return 1
  return 2
}

export function stageBadge(stage, status) {
  if (status === 'cancelled') return ['badge-red', 'Cancelado']
  if (status === 'completed' || stage === 4) return ['badge-green', 'Terminado']
  if (stage === 0) return ['badge-gray', 'Programado']
  if (stage === 1) return ['badge-blue', 'Pesaje']
  if (stage === 2) return ['badge-blue', 'Tiñendo']
  if (stage === 3) return ['badge-amber', 'Fijación']
  return ['badge-gray', status || '—']
}

export function renderStepper(active) {
  return `
    <div class="proc-stepper" role="list">
      ${PROC_STEPS.map((step, i) => {
        const state = active < 0 ? 'pending' : i < active ? 'done' : i === active ? 'active' : 'pending'
        return `
          <div class="proc-step is-${state}" role="listitem">
            <span class="proc-step-dot">${state === 'done' ? '✓' : ''}</span>
            <span class="proc-step-label">${step.label}</span>
          </div>`
      }).join('')}
    </div>`
}

export function processMetaLine(p) {
  const fiber = fiberLabel(p.fiber_type || p.recipe_fiber)
  const kg = Number(p.fiber_weight_kg || 0)
  const weight = Number.isFinite(kg)
    ? `${kg.toLocaleString('es-CO', { maximumFractionDigits: 0 })} kg`
    : '—'
  return `${p.recipe_code || ''} · ${fiber} · ${weight}`.replace(/^\s·\s/, '')
}
