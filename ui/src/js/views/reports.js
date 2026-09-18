import { reports, sync as syncApi } from '../api.js'
import { setPageHeader } from '../layout.js'

export async function showView(container) {
  setPageHeader({
    title: 'Reportes',
    subtitle: 'Consumo de quimicos e historial de produccion',
  })
  container.innerHTML = `
    <div class="toolbar" style="margin-bottom:16px">
      <label class="form-label" style="margin:0;align-self:center">Desde:</label>
      <input type="date" id="rpt-from" class="form-input" style="width:160px">
      <label class="form-label" style="margin:0;align-self:center">Hasta:</label>
      <input type="date" id="rpt-to" class="form-input" style="width:160px">
      <button class="btn btn-primary" id="btn-run-report">Generar</button>
    </div>

    <div id="report-content"></div>
  `

  // Defaults: ultimo mes
  const today = new Date()
  const from  = new Date(today.getFullYear(), today.getMonth(), 1)
  document.getElementById('rpt-from').value = from.toISOString().split('T')[0]
  document.getElementById('rpt-to').value   = today.toISOString().split('T')[0]

  document.getElementById('btn-run-report').onclick = runReport

  await runReport()
}

async function runReport() {
  const from = document.getElementById('rpt-from')?.value
  const to   = document.getElementById('rpt-to')?.value
  const container = document.getElementById('report-content')
  if (!container) return

  container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Generando reporte...</span></div>'

  try {
    const [consumption, processHistory] = await Promise.all([
      reports.consumption({ date_from: from, date_to: to }),
      reports.processes({ date_from: from, date_to: to }),
    ])
    renderReports(consumption, processHistory, container)
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

function renderReports(consumption, processHistory, container) {
  const consumptionRows = consumption?.length
    ? consumption.map(r => `
        <tr>
          <td style="font-size:12px;color:var(--text-muted)">${r.date?.split('T')[0] || r.date || '-'}</td>
          <td>${r.chemical_name}</td>
          <td><code style="font-size:11px">${r.chemical_code}</code></td>
          <td style="font-weight:600;font-variant-numeric:tabular-nums">${Number(r.total_quantity).toFixed(3)}</td>
          <td style="color:var(--text-muted)">${r.unit}</td>
          <td style="color:var(--text-muted)">${r.process_count} procesos</td>
        </tr>`).join('')
    : '<tr><td colspan="6" class="text-center" style="color:var(--text-muted)">Sin consumos en el periodo</td></tr>'

  const STATUS_MAP = {
    pending:     ['badge-gray',  'Pendiente'],
    in_progress: ['badge-blue',  'En proceso'],
    completed:   ['badge-green', 'Completado'],
    cancelled:   ['badge-red',   'Cancelado'],
  }

  const processRows = processHistory?.length
    ? processHistory.map(p => {
        const [cls, label] = STATUS_MAP[p.status] || ['badge-gray', p.status]
        return `
          <tr>
            <td><code>${p.batch_number}</code></td>
            <td>${p.recipe_name}</td>
            <td style="font-variant-numeric:tabular-nums">${Number(p.fiber_weight_kg).toFixed(2)} kg</td>
            <td><span class="badge ${cls}">${label}</span></td>
            <td style="font-size:12px;color:var(--text-muted)">${p.started_at?.split('T')[0] || '-'}</td>
            <td style="font-size:12px;color:var(--text-muted)">${p.completed_at?.split('T')[0] || '-'}</td>
          </tr>`
      }).join('')
    : '<tr><td colspan="6" class="text-center" style="color:var(--text-muted)">Sin procesos en el periodo</td></tr>'

  container.innerHTML = `
    <div class="grid-2" style="margin-bottom:24px">
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Procesos en el periodo</div>
          <div class="stat-value">${processHistory?.length ?? 0}</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-label">Registros de consumo</div>
          <div class="stat-value">${consumption?.length ?? 0}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      <div class="card-header"><h3 class="card-title">Consumo de quimicos</h3></div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Quimico</th><th>Codigo</th><th>Total consumido</th><th>Unidad</th><th>Procesos</th></tr></thead>
          <tbody>${consumptionRows}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3 class="card-title">Historial de procesos</h3></div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Lote</th><th>Receta</th><th>Fibra</th><th>Estado</th><th>Inicio</th><th>Fin</th></tr></thead>
          <tbody>${processRows}</tbody>
        </table>
      </div>
    </div>
  `
}
