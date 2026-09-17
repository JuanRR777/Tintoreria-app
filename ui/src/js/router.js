/**
 * Router SPA - mapea vistas a funciones de render
 */

import { showView as dashboardView }  from './views/dashboard.js'
import { showView as chemicalsView }  from './views/chemicals.js'
import { showView as stockView }      from './views/stock.js'
import { showView as recipesView }    from './views/recipes.js'
import { showView as processesView }  from './views/processes.js'
import { showView as weighingView }   from './views/weighing.js'
import { showView as machinesView }   from './views/machines.js'
import { showView as reportsView }    from './views/reports.js'
import { showView as settingsView }   from './views/settings.js'
import { showView as requestsView }   from './views/requests.js'

const VIEWS = {
  dashboard: dashboardView,
  chemicals: chemicalsView,
  stock:     stockView,
  requests:  requestsView,
  recipes:   recipesView,
  processes: processesView,
  weighing:  weighingView,
  machines:  machinesView,
  reports:   reportsView,
  settings:  settingsView,
}

let _currentView    = null
let _container      = null
let _onViewChange   = null
let _cleanupCurrent = null

export function initRouter(container, onViewChange) {
  _container    = container
  _onViewChange = onViewChange
}

export async function navigate(viewName, params = {}) {
  if (!_container) return

  const viewFn = VIEWS[viewName]
  if (!viewFn) {
    console.warn(`Vista desconocida: ${viewName}`)
    return
  }

  // Limpiar vista anterior si expone un metodo de cleanup
  if (_cleanupCurrent) {
    try { _cleanupCurrent() } catch { /* ignorar */ }
    _cleanupCurrent = null
  }

  _container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Cargando...</span></div>'
  _currentView = viewName

  if (_onViewChange) _onViewChange(viewName)

  try {
    const cleanup = await viewFn(_container, params)
    if (typeof cleanup === 'function') _cleanupCurrent = cleanup
  } catch (err) {
    console.error(`Error renderizando vista ${viewName}:`, err)
    _container.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <h3>Error al cargar la vista</h3>
        <p>${err.message}</p>
      </div>`
  }
}

export function getCurrentView() { return _currentView }
