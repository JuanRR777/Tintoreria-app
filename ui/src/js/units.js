const IN_BASE = { kg: 1, g: 0.001, L: 1, mL: 0.001 }

function family(unit) {
  if (unit === 'kg' || unit === 'g') return 'mass'
  if (unit === 'L' || unit === 'mL') return 'vol'
  return null
}

export function convertQty(qty, from, to) {
  const amount = Number(qty)
  if (!Number.isFinite(amount)) return null
  if (from === to) return amount
  if (!family(from) || family(from) !== family(to)) return null
  return amount * IN_BASE[from] / IN_BASE[to]
}

export function labUnit(base) {
  if (base === 'kg') return 'g'
  if (base === 'L') return 'mL'
  return base || 'g'
}

export function entryUnits(base) {
  if (base === 'kg' || base === 'g') return ['g', 'kg']
  if (base === 'L' || base === 'mL') return ['mL', 'L']
  return [base || 'kg']
}

export function expressLab(qty, unit) {
  const base = unit || 'kg'
  const display = labUnit(base)
  const value = convertQty(qty, base, display)
  return { qty: value == null ? Number(qty) || 0 : value, unit: display }
}
