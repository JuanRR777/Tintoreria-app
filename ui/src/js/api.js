/**
 * Cliente HTTP para la API FastAPI local.
 * Todas las peticiones van a http://127.0.0.1:8000
 */

let _apiBase = 'http://127.0.0.1:8000'
let _token   = null

const GET_TTL_MS = 3 * 60 * 1000
const _getCache = new Map()
const _inflight = new Map()

export function setApiBase(url) { _apiBase = url }
export function setToken(token)  { _token   = token }
export function getToken()       { return _token }
export function clearToken()     {
  _token = null
  clearApiCache()
}

function clone(data) {
  return data == null ? data : JSON.parse(JSON.stringify(data))
}

function cacheGet(path) {
  const hit = _getCache.get(path)
  if (!hit) return null
  if (Date.now() - hit.at > GET_TTL_MS) {
    _getCache.delete(path)
    return null
  }
  return clone(hit.data)
}

export function peekCache(path) {
  return cacheGet(path)
}

export function clearApiCache() {
  _getCache.clear()
  _inflight.clear()
}

async function request(method, path, body = null, opts = {}) {
  if (method === 'GET' && !opts.fresh) {
    const cached = cacheGet(path)
    if (cached !== null) return cached
    if (_inflight.has(path)) return clone(await _inflight.get(path))
  }

  const headers = { 'Content-Type': 'application/json' }
  if (_token) headers['Authorization'] = `Bearer ${_token}`

  const { fresh, ...fetchOpts } = opts
  const config = {
    method,
    headers,
    ...fetchOpts,
  }
  if (body !== null) config.body = JSON.stringify(body)

  const send = (async () => {
    const response = await fetch(`${_apiBase}${path}`, config)

    if (response.status === 204) return null

    const data = await response.json().catch(() => ({ detail: response.statusText }))

    if (!response.ok) {
      const message = data?.detail || data?.message || `Error ${response.status}`
      throw new APIError(message, response.status, data)
    }

    return data
  })()

  if (method === 'GET') _inflight.set(path, send)

  try {
    const data = await send
    if (method === 'GET') {
      _getCache.set(path, { at: Date.now(), data: clone(data) })
    } else {
      clearApiCache()
    }
    return data
  } finally {
    if (method === 'GET') _inflight.delete(path)
  }
}

export const api = {
  get:    (path, opts)        => request('GET',    path, null, opts || {}),
  post:   (path, body, opts)  => request('POST',   path, body, opts || {}),
  put:    (path, body, opts)  => request('PUT',    path, body, opts || {}),
  patch:  (path, body, opts)  => request('PATCH',  path, body, opts || {}),
  delete: (path, opts)        => request('DELETE', path, null, opts || {}),
}

// Endpoints organizados por dominio
export const auth = {
  login:          (u, p) => api.post('/auth/login', { username: u, password: p }),
  me:             ()     => api.get('/auth/me'),
  logout:         ()     => api.post('/auth/logout'),
  changePassword: (cur, nw) => api.post('/auth/change-password', { current_password: cur, new_password: nw }),
  users:          ()     => api.get('/auth/users'),
  createUser:     (d)    => api.post('/auth/users', d),
  updateUser:     (id, d) => api.put(`/auth/users/${id}`, d),
  roles:          ()     => api.get('/auth/roles'),
}

export const chemicals = {
  list:        (params = {}, opts = {}) => api.get('/chemicals' + toQuery(params), opts),
  get:         (id)          => api.get(`/chemicals/${id}`),
  create:      (d)           => api.post('/chemicals', d),
  update:      (id, d)       => api.put(`/chemicals/${id}`, d),
  delete:      (id)          => api.delete(`/chemicals/${id}`),
  lots:        (id)          => api.get(`/chemicals/${id}/lots`),
  addLot:      (id, d)       => api.post(`/chemicals/${id}/lots`, d),
  movements:   (id)          => api.get(`/chemicals/${id}/movements`),
}

export const recipes = {
  list:             (params = {}) => api.get('/recipes' + toQuery(params)),
  get:              (id)          => api.get(`/recipes/${id}`),
  create:           (d)           => api.post('/recipes', d),
  update:           (id, d)       => api.put(`/recipes/${id}`, d),
  delete:           (id)          => api.delete(`/recipes/${id}`),
  addStep:          (id, d)       => api.post(`/recipes/${id}/steps`, d),
  deleteStep:       (id, stepId)  => api.delete(`/recipes/${id}/steps/${stepId}`),
  addIngredient:    (id, d)       => api.post(`/recipes/${id}/ingredients`, d),
  deleteIngredient: (id, ingId)   => api.delete(`/recipes/${id}/ingredients/${ingId}`),
}

export const processes = {
  list:           (params = {}) => api.get('/processes' + toQuery(params)),
  get:            (id)          => api.get(`/processes/${id}`),
  create:         (d)           => api.post('/processes', d),
  updateStatus:   (id, d)       => api.patch(`/processes/${id}/status`, d),
  weighings:      (id)          => api.get(`/processes/${id}/weighings`),
  updateWeighing: (pid, wid, d) => api.patch(`/processes/${pid}/weighings/${wid}`, d),
}

export const machines = {
  list:   ()     => api.get('/machines'),
  get:    (id)   => api.get(`/machines/${id}`),
  create: (d)    => api.post('/machines', d),
  update: (id,d) => api.put(`/machines/${id}`, d),
  delete: (id)   => api.delete(`/machines/${id}`),
}

export const scales = {
  list:   ()     => api.get('/scales'),
  ports:  ()     => api.get('/scales/ports'),
  get:    (id)   => api.get(`/scales/${id}`),
  create: (d)    => api.post('/scales', d),
  update: (id,d) => api.put(`/scales/${id}`, d),
  delete: (id)   => api.delete(`/scales/${id}`),
}

export const stock = {
  summary:   (opts)   => api.get('/stock/summary', opts || {}),
  movements: (params) => api.get('/stock/movements' + toQuery(params || {})),
}

export const requests = {
  bundle:    (opts)         => api.get('/requests/bundle', opts),
  summary:   (params, opts) => api.get('/requests/summary' + toQuery(params || {}), opts),
  soc:       (params, opts) => api.get('/requests/soc' + toQuery(params || {}), opts),
  occ:       (params, opts) => api.get('/requests/occ' + toQuery(params || {}), opts),
  importSoc: (file)   => uploadFile('/requests/import/soc', file),
  importOcc: (file)   => uploadFile('/requests/import/occ', file),
  syncCatalog: ()     => api.post('/requests/sync-catalog', {}),
}

export const reports = {
  dashboard:     ()       => api.get('/reports/dashboard'),
  consumption:   (params) => api.get('/reports/consumption' + toQuery(params || {})),
  processes:     (params) => api.get('/reports/processes' + toQuery(params || {})),
  weighingSummary: (id)   => api.get(`/reports/processes/${id}/weighings-summary`),
}

export const sync = {
  status:       () => api.get('/sync/status'),
  queue:        () => api.get('/sync/queue'),
  retryErrors:  () => api.post('/sync/retry-errors'),
  pushNow:      () => api.post('/sync/push-now'),
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function uploadFile(path, file) {
  const headers = {}
  if (_token) headers['Authorization'] = `Bearer ${_token}`

  const body = new FormData()
  body.append('file', file)

  const response = await fetch(`${_apiBase}${path}`, { method: 'POST', headers, body })
  const data = await response.json().catch(() => ({ detail: response.statusText }))
  if (!response.ok) {
    const message = data?.detail || data?.message || `Error ${response.status}`
    throw new APIError(message, response.status, data)
  }
  clearApiCache()
  return data
}

function toQuery(params) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return q ? `?${q}` : ''
}

export class APIError extends Error {
  constructor(message, status, data) {
    super(message)
    this.name   = 'APIError'
    this.status = status
    this.data   = data
  }
}

// WebSocket helper para basculas
export function openScaleSocket(scaleId, onMessage, onError) {
  const wsBase = _apiBase.replace('http://', 'ws://').replace('https://', 'wss://')
  const ws     = new WebSocket(`${wsBase}/ws/scales/${scaleId}/stream`)

  ws.onmessage = (evt) => {
    try { onMessage(JSON.parse(evt.data)) }
    catch { /* ignorar parse errors */ }
  }
  ws.onerror = (err) => onError && onError(err)
  ws.onclose = ()    => onError && onError(new Error('Conexion cerrada'))

  return ws
}
