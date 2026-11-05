import { chemicals as chemicalsApi, stock } from '../api.js'
import { setPageHeader } from '../layout.js'
import { expressLab } from '../units.js'

const TYPE_LABELS = {
  acido: 'Ácido', reactivo: 'Reactivo', directo: 'Directo', auxiliar: 'Auxiliar',
  mordiente: 'Mordiente', disperso: 'Disperso', vat: 'Vat',
  blanqueador: 'Blanqueador', otros: 'Otros',
}

let items = []
let moves = []
let query = ''
let selectedId = null

export async function showView(container) {
  setPageHeader({
    title: 'Inventario lab',
    subtitle: 'Saldo en gramos que llegó desde bodega con destino a laboratorio',
  })
  container.innerHTML = `<div id="lab-content"><div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div></div>`
  await load(container)
}

async function load(container) {
  const host = container.querySelector('#lab-content') || container
  try {
    const [chems, movements] = await Promise.all([
      chemicalsApi.list({}, { fresh: true }),
      stock.movements({ limit: 500 }).catch(() => []),
    ])
    items = (Array.isArray(chems) ? chems : []).filter((c) => Number(c.lab_quantity || 0) > 0)
    moves = (Array.isArray(movements) ? movements : []).filter((m) => m.reference_type === 'laboratorio')
    if (selectedId && !items.some((c) => Number(c.id) === Number(selectedId))) selectedId = null
    paint(host)
  } catch (err) {
    host.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`
  }
}

function paint(host) {
  const rows = filtered()
  const selected = items.find((c) => Number(c.id) === Number(selectedId)) || null
  const feed = selected
    ? moves.filter((m) => Number(m.chemical_id) === Number(selected.id))
    : moves
  host.innerHTML = `
    <div class="sk-page lab-page">
      <section class="sk-card sk-table">
        <div class="sk-toolbar">
          <label class="sk-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="lab-search" placeholder="Buscar por nombre o código" value="${esc(query)}">
          </label>
          <span class="lab-count">${rows.length} producto${rows.length === 1 ? '' : 's'}</span>
        </div>
        <div class="lab-head">
          <span>Código</span>
          <span>Producto</span>
          <span>Tipo</span>
          <span>En laboratorio</span>
        </div>
        <div class="sk-tbody" id="lab-tbody">
          ${rows.length ? rows.map((c) => `
            <button type="button" class="lab-row ${Number(c.id) === Number(selectedId) ? 'is-on' : ''}" data-lab="${c.id}">
              <code>${esc(c.code || '—')}</code>
              <strong>${esc(c.name || '—')}</strong>
              <span>${esc(TYPE_LABELS[c.chemical_type] || c.chemical_type || '—')}</span>
              <b>${esc(labText(c.lab_quantity, c.unit))}</b>
            </button>`).join('') : '<p class="sk-empty">Todavía no hay químicos en laboratorio. Llegan cuando en bodega se registra una salida con destino Laboratorio.</p>'}
        </div>
      </section>
      <aside class="sk-card lab-side">
        <header class="sk-moves-head">
          <h3>${selected ? esc(selected.name) : 'Entradas'}</h3>
          <p>${selected ? `${esc(labText(selected.lab_quantity, selected.unit))} en laboratorio` : 'Salidas de bodega hacia laboratorio'}</p>
        </header>
        <div class="lab-side-body" id="lab-side"></div>
      </aside>
    </div>`
  host.querySelector('#lab-search').oninput = (e) => {
    query = e.target.value
    paint(host)
  }
  host.querySelectorAll('[data-lab]').forEach((btn) => {
    btn.onclick = () => {
      const id = Number(btn.dataset.lab)
      selectedId = selectedId === id ? null : id
      paint(host)
    }
  })
  paintSide(selected, feed)
}

async function paintSide(selected, feed) {
  const body = document.getElementById('lab-side')
  if (!body) return
  let lots = []
  if (selected) {
    lots = await chemicalsApi.lots(selected.id).catch(() => [])
    lots = (Array.isArray(lots) ? lots : []).filter((l) => Number(l.lab_quantity || 0) > 0)
  }
  if (!document.getElementById('lab-side')) return
  const lotBlock = selected ? `
    <p class="lab-kicker">Lotes</p>
    ${lots.length ? lots.map((l) => `
      <div class="sk-move">
        <div><strong><code>${esc(l.lot_number || '—')}</code></strong></div>
        <div class="sk-move-qty"><b>${esc(labText(l.lab_quantity, l.unit || selected.unit))}</b></div>
      </div>`).join('') : '<p class="sk-empty">Sin lote asignado. El saldo está en el producto.</p>'}
    <p class="lab-kicker">Cómo llegó</p>` : ''
  body.innerHTML = `
    ${lotBlock}
    ${feed.length ? feed.slice(0, 40).map((m) => `
      <div class="sk-move">
        <div>
          <strong>${esc(m.chemical_name || '—')}</strong>
          <small>${esc([formatWhen(m.created_at), m.lot_number ? `Lote ${m.lot_number}` : '', m.user_name].filter(Boolean).join(' · '))}</small>
        </div>
        <div class="sk-move-qty">
          <b class="is-in">+${esc(labText(m.quantity, m.unit))}</b>
          <small>Desde bodega</small>
        </div>
      </div>`).join('') : '<p class="sk-empty">Sin entradas registradas.</p>'}`
}

function filtered() {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((c) => `${c.name || ''} ${c.code || ''}`.toLowerCase().includes(q))
}

function labText(qty, unit) {
  const shown = expressLab(qty, unit)
  const digits = shown.unit === 'g' || shown.unit === 'mL' ? 1 : 2
  return `${fmtQty(shown.qty, digits)} ${shown.unit}`
}

function fmtQty(n, digits = 2) {
  const value = Number(n)
  if (!Number.isFinite(value)) return '0'
  return value.toLocaleString('es-CO', { maximumFractionDigits: digits })
}

function formatWhen(value) {
  if (!value) return ''
  const raw = String(value).trim()
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
