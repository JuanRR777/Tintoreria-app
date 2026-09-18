import { reports } from '../api.js'
import { navigate } from '../router.js'
import { setPageHeader } from '../layout.js'

const TYPE_LABELS = {
  acido: 'Acido', reactivo: 'Reactivo', directo: 'Directo', auxiliar: 'Auxiliar',
  mordiente: 'Mordiente', disperso: 'Disperso', vat: 'Vat',
  blanqueador: 'Blanqueador', otros: 'Otros',
}

const PROC_LABELS = {
  disponible: 'En bodega',
  espera: 'En espera',
  pedido: 'Pedido',
}

const PROC_COLORS = {
  disponible: '#16a34a',
  espera: '#d97706',
  pedido: '#0284c7',
}

const CHART_COLORS = {
  accent: '#0284c7',
  accentFill: 'rgba(2, 132, 199, 0.16)',
  success: '#16a34a',
  successFill: 'rgba(22, 163, 74, 0.16)',
  warning: '#d97706',
  muted: '#94a3b8',
  grid: '#e2e8f0',
  text: '#64748b',
}

let charts = []

export async function showView(container) {
  destroyCharts()
  setPageHeader({
    title: 'Dashboard',
    subtitle: 'Resumen operativo de inventario, compras y produccion',
  })
  container.innerHTML = `
    <div id="dash-content"><div class="loading-state"><div class="spinner"></div><span>Cargando datos...</span></div></div>
  `

  try {
    const kpis = await reports.dashboard()
    renderDashboard(kpis)
    bindNav()
    paintCharts(kpis)
  } catch (err) {
    const el = document.getElementById('dash-content')
    if (el) el.innerHTML = `<div class="empty-state"><p>No se pudieron cargar los datos: ${esc(err.message)}</p></div>`
  }

  return destroyCharts
}

function renderDashboard(d) {
  const transit = (d.waiting_count || 0) + (d.ordered_count || 0)
  const host = document.getElementById('dash-content')
  if (!host) return

  host.innerHTML = `
    <div class="dash-kpis">
      ${kpiCard({
        tone: 'accent',
        nav: 'chemicals',
        label: 'Químicos',
        value: d.chemicals_total ?? 0,
        hint: `${d.available_count ?? 0} en bodega · ${fmtQty(d.stock_kg)} kg`,
        icon: ICON.flask,
      })}
      ${kpiCard({
        tone: (d.low_stock_count || 0) > 0 ? 'danger' : 'success',
        nav: 'stock',
        label: 'Stock bajo',
        value: d.low_stock_count ?? 0,
        hint: (d.low_stock_count || 0) > 0 ? 'Requieren reposicion' : 'Sin alertas',
        icon: ICON.alert,
      })}
      ${kpiCard({
        tone: transit > 0 ? 'warning' : 'accent',
        nav: 'stock',
        label: 'En transito',
        value: transit,
        hint: `${d.waiting_count ?? 0} espera · ${d.ordered_count ?? 0} pedido`,
        icon: ICON.truck,
      })}
      ${kpiCard({
        tone: (d.active_processes || 0) > 0 ? 'success' : 'neutral',
        nav: 'processes',
        label: 'Procesos A',
        value: d.active_processes ?? 0,
        hint: 'En ejecucion ahora',
        icon: ICON.clock,
      })}
      ${kpiCard({
        tone: 'warning',
        nav: 'processes',
        label: 'Completados',
        value: d.completed_this_month ?? 0,
        hint: 'Lotes finalizados',
        icon: ICON.check,
      })}
      ${kpiCard({
        tone: 'accent',
        nav: 'recipes',
        label: 'Recetas activas',
        value: d.recipes_count ?? 0,
        hint: 'Formulas disponibles',
        icon: ICON.doc,
      })}
    </div>

    <div class="dash-charts">
      <section class="dash-card dash-card-wide">
        <header class="dash-card-head">
          <div>
            <h3>Movimientos de bodega</h3>
            <p>Entradas y salidas · ultimos 14 dias</p>
          </div>
        </header>
        <div class="dash-chart-wrap">
          <canvas id="chart-movements"></canvas>
        </div>
      </section>

      <div class="dash-charts-row">
        <section class="dash-card">
          <header class="dash-card-head">
            <div>
              <h3>Estado de inventario</h3>
              <p>Disponible, espera y pedido</p>
            </div>
          </header>
          <div class="dash-chart-wrap is-donut">
            <canvas id="chart-procurement"></canvas>
          </div>
        </section>

        <section class="dash-card">
          <header class="dash-card-head">
            <div>
              <h3>Tipos de quimico</h3>
              <p>Composicion del catalogo</p>
            </div>
          </header>
          <div class="dash-chart-wrap is-donut">
            <canvas id="chart-types"></canvas>
          </div>
        </section>

        <section class="dash-card">
          <header class="dash-card-head">
            <div>
              <h3>Mayor consumo</h3>
              <p>Salidas de inventario · 7 dias</p>
            </div>
          </header>
          <div class="dash-chart-wrap">
            <canvas id="chart-consumption"></canvas>
          </div>
        </section>
      </div>
    </div>

    <div class="dash-bottom">
      <section class="dash-card">
        <header class="dash-card-head">
          <div>
            <h3>Procesos recientes</h3>
            <p>Ultimos lotes registrados</p>
          </div>
          <button class="btn btn-ghost btn-sm" data-nav="processes">Ver todos</button>
        </header>
        ${renderRecentProcesses(d.recent_processes)}
      </section>
    </div>
  `
}

function kpiCard({ tone, nav, label, value, hint, icon }) {
  return `
    <button type="button" class="dash-kpi is-${esc(tone)}" data-nav="${esc(nav)}">
      <span class="dash-kpi-icon">${icon}</span>
      <span class="dash-kpi-copy">
        <span class="dash-kpi-label">${esc(label)}</span>
        <strong class="dash-kpi-value">${esc(value)}</strong>
        <span class="dash-kpi-hint">${hint}</span>
      </span>
    </button>`
}

function paintCharts(d) {
  const Chart = window.Chart
  if (!Chart) return
  applyChartDefaults(Chart)

  const canvas = (id) => document.getElementById(id)
  const days = d.movements_14d || []
  if (canvas('chart-movements')) {
    charts.push(new Chart(canvas('chart-movements'), {
    type: 'bar',
    data: {
      labels: days.map((row) => row.label),
      datasets: [
        {
          label: 'Entradas',
          data: days.map((row) => Number(row.qty_in) || 0),
          backgroundColor: CHART_COLORS.success,
          borderRadius: 4,
          maxBarThickness: 16,
        },
        {
          label: 'Salidas',
          data: days.map((row) => Number(row.qty_out) || 0),
          backgroundColor: CHART_COLORS.accent,
          borderRadius: 4,
          maxBarThickness: 16,
        },
      ],
    },
    options: barOptions('kg'),
  }))
  }

  const procOrder = ['disponible', 'espera', 'pedido']
  const procMap = Object.fromEntries((d.procurement || []).map((row) => [row.status, Number(row.count) || 0]))
  const procLabels = procOrder.map((key) => PROC_LABELS[key])
  const procData = procOrder.map((key) => procMap[key] || 0)
  const procColors = procOrder.map((key) => PROC_COLORS[key])
  if (canvas('chart-procurement')) {
    charts.push(new Chart(canvas('chart-procurement'), {
    type: 'doughnut',
    data: {
      labels: procLabels,
      datasets: [{ data: procData, backgroundColor: procColors, borderWidth: 0, hoverOffset: 4 }],
    },
    options: doughnutOptions(),
  }))
  }

  const top = d.top_consumption_7d || []
  if (canvas('chart-consumption')) {
    charts.push(new Chart(canvas('chart-consumption'), {
    type: 'bar',
    data: {
      labels: top.length ? top.map((row) => row.name) : ['Sin consumo'],
      datasets: [{
        label: 'Consumo',
        data: top.length ? top.map((row) => Number(row.total) || 0) : [0],
        backgroundColor: CHART_COLORS.accent,
        borderRadius: 4,
        maxBarThickness: 18,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: barOptions(top[0]?.unit || 'kg').plugins.tooltip,
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: CHART_COLORS.grid },
          ticks: { color: CHART_COLORS.muted },
          border: { display: false },
        },
        y: {
          grid: { display: false },
          ticks: { color: CHART_COLORS.text },
          border: { display: false },
        },
      },
    },
  }))
  }

  const types = d.chemical_types || []
  const typePalette = ['#0284c7', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4f46e5', '#0f766e', '#64748b']
  if (canvas('chart-types')) {
    charts.push(new Chart(canvas('chart-types'), {
    type: 'doughnut',
    data: {
      labels: types.length ? types.map((row) => TYPE_LABELS[row.type] || row.type) : ['Sin datos'],
      datasets: [{
        data: types.length ? types.map((row) => Number(row.count) || 0) : [1],
        backgroundColor: types.length ? types.map((_, i) => typePalette[i % typePalette.length]) : ['#e2e8f0'],
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: doughnutOptions(),
  }))
  }
}

function applyChartDefaults(Chart) {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily || 'system-ui'
  Chart.defaults.font.size = 11
  Chart.defaults.font.weight = '400'
  Chart.defaults.color = CHART_COLORS.text
  Chart.defaults.plugins.legend.labels.boxWidth = 8
  Chart.defaults.plugins.legend.labels.usePointStyle = true
  Chart.defaults.plugins.legend.labels.pointStyle = 'circle'
  Chart.defaults.maintainAspectRatio = false
}

function barOptions(unit) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: { padding: 12, color: CHART_COLORS.text },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        padding: 10,
        cornerRadius: 8,
        callbacks: unit ? {
          label(ctx) {
            const value = Number(ctx.raw) || 0
            return ` ${ctx.dataset.label}: ${value.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${unit}`
          },
        } : undefined,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { maxRotation: 0, color: CHART_COLORS.muted },
        border: { display: false },
      },
      y: {
        beginAtZero: true,
        grid: { color: CHART_COLORS.grid },
        ticks: { color: CHART_COLORS.muted },
        border: { display: false },
      },
    },
  }
}

function doughnutOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: {
        position: 'bottom',
        labels: { padding: 14, color: CHART_COLORS.text },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        padding: 10,
        cornerRadius: 8,
      },
    },
  }
}

function renderRecentProcesses(processes) {
  if (!processes?.length) {
    return '<p class="dash-empty">Sin procesos recientes</p>'
  }

  const statusMap = {
    pending:     ['is-muted', 'Pendiente'],
    in_progress: ['is-accent', 'En proceso'],
    paused:      ['is-warning', 'Pausado'],
    completed:   ['is-success', 'Completado'],
    cancelled:   ['is-danger', 'Cancelado'],
  }

  return `<ul class="dash-list">${processes.map((p) => {
    const [cls, label] = statusMap[p.status] || ['is-muted', p.status]
    return `
      <li class="dash-list-item">
        <div>
          <strong>${esc(p.batch_number)}</strong>
          <span>${esc(p.recipe_name)} · ${fmtQty(p.fiber_weight_kg)} kg</span>
        </div>
        <em class="dash-pill ${cls}">${esc(label)}</em>
      </li>`
  }).join('')}</ul>`
}

function bindNav() {
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.onclick = () => navigate(btn.dataset.nav)
  })
}

function destroyCharts() {
  charts.forEach((chart) => {
    try { chart.destroy() } catch { /* ignore */ }
  })
  charts = []
}

function fmtQty(n) {
  const value = Number(n)
  if (!Number.isFinite(value)) return '0'
  return value.toLocaleString('es-CO', { maximumFractionDigits: 2 })
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const ICON = {
  flask: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6"/><path d="M10 9h4"/><path d="M9 3v7l-5.5 9.5A1.65 1.65 0 0 0 5.9 22h12.2a1.65 1.65 0 0 0 1.4-2.5L15 10V3"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 16h.01"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0"/><path d="M17 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0"/><path d="M5 17H3v-4M2 5h11v12m-4 0h6m4 0h2v-6h-8M13 5h5l3 5"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  doc: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
}
