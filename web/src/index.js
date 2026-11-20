/**
 * Portal web Tintorería de Hilos.
 * Rutas fijas; nunca recibe SQL. Las recetas no se consultan desde aquí.
 */

import { HttpError, assertSameOrigin, errorResponse, json, withSecurityHeaders } from './http.js'
import { changeOwnPassword, login, logout, me, publicConfig } from './auth.js'
import { listAudit } from './audit.js'
import { createUser, listUsers, resetPassword, unlockUser, updateUser } from './users.js'
import { createWarehouse, listWarehouses, updateWarehouse } from './warehouses.js'
import {
  applyCount, cancelCount, closeCount, confirmZero, confirmZeroAll, createLine, deleteLine, exportCount,
  getCount, listCounts, listLines, markSiesaAdjusted, openCount, reopenCount, requestRecount, resolveFinding,
  reviewCount, updateLine,
} from './counts.js'

const routes = [
  ['GET', /^\/api\/health$/, () => json({ status: 'ok', service: 'tintoreria-web' })],
  ['GET', /^\/api\/config$/, (req, env) => publicConfig(env)],
  ['POST', /^\/api\/auth\/login$/, (req, env) => login(req, env)],
  ['POST', /^\/api\/auth\/logout$/, (req, env) => logout(req, env)],
  ['GET', /^\/api\/auth\/me$/, (req, env) => me(req, env)],
  ['POST', /^\/api\/auth\/password$/, (req, env) => changeOwnPassword(req, env)],
  ['GET', /^\/api\/users$/, (req, env) => listUsers(req, env)],
  ['POST', /^\/api\/users$/, (req, env) => createUser(req, env)],
  ['PUT', /^\/api\/users\/(\d+)$/, (req, env, m) => updateUser(req, env, m[1])],
  ['POST', /^\/api\/users\/(\d+)\/password$/, (req, env, m) => resetPassword(req, env, m[1])],
  ['POST', /^\/api\/users\/(\d+)\/unlock$/, (req, env, m) => unlockUser(req, env, m[1])],
  ['GET', /^\/api\/warehouses$/, (req, env) => listWarehouses(req, env)],
  ['POST', /^\/api\/warehouses$/, (req, env) => createWarehouse(req, env)],
  ['PUT', /^\/api\/warehouses\/(\d+)$/, (req, env, m) => updateWarehouse(req, env, m[1])],
  ['GET', /^\/api\/audit$/, (req, env, m, url) => listAudit(req, env, url)],
  // Conteo físico
  ['GET', /^\/api\/counts$/, (req, env) => listCounts(req, env)],
  ['POST', /^\/api\/counts$/, (req, env) => openCount(req, env)],
  ['GET', /^\/api\/counts\/(\d+)$/, (req, env, m) => getCount(req, env, m[1])],
  ['GET', /^\/api\/counts\/(\d+)\/lines$/, (req, env, m, url) => listLines(req, env, m[1], url)],
  ['POST', /^\/api\/counts\/(\d+)\/lines$/, (req, env, m) => createLine(req, env, m[1])],
  ['PUT', /^\/api\/counts\/(\d+)\/lines\/(\d+)$/, (req, env, m) => updateLine(req, env, m[1], m[2])],
  ['DELETE', /^\/api\/counts\/(\d+)\/lines\/(\d+)$/, (req, env, m) => deleteLine(req, env, m[1], m[2])],
  ['GET', /^\/api\/counts\/(\d+)\/review$/, (req, env, m) => reviewCount(req, env, m[1])],
  ['GET', /^\/api\/counts\/(\d+)\/export\.csv$/, (req, env, m) => exportCount(req, env, m[1])],
  ['POST', /^\/api\/counts\/(\d+)\/close$/, (req, env, m) => closeCount(req, env, m[1])],
  ['POST', /^\/api\/counts\/(\d+)\/reopen$/, (req, env, m) => reopenCount(req, env, m[1])],
  ['POST', /^\/api\/counts\/(\d+)\/cancel$/, (req, env, m) => cancelCount(req, env, m[1])],
  ['POST', /^\/api\/counts\/(\d+)\/apply$/, (req, env, m) => applyCount(req, env, m[1])],
  ['POST', /^\/api\/counts\/(\d+)\/siesa$/, (req, env, m) => markSiesaAdjusted(req, env, m[1])],
  ['POST', /^\/api\/counts\/(\d+)\/confirm-zero$/, (req, env, m) => confirmZeroAll(req, env, m[1])],
  ['POST', /^\/api\/counts\/(\d+)\/items\/(\d+)\/confirm-zero$/, (req, env, m) => confirmZero(req, env, m[1], m[2])],
  ['POST', /^\/api\/counts\/(\d+)\/items\/(\d+)\/recount$/, (req, env, m) => requestRecount(req, env, m[1], m[2])],
  ['POST', /^\/api\/counts\/(\d+)\/findings\/(\d+)$/, (req, env, m) => resolveFinding(req, env, m[1], m[2])],
]

async function handleApi(request, env, url) {
  let pathMatched = false
  for (const [method, pattern, handler] of routes) {
    const match = url.pathname.match(pattern)
    if (!match) continue
    pathMatched = true
    if (method !== request.method) continue
    assertSameOrigin(request)
    return handler(request, env, match, url)
  }
  if (pathMatched) throw new HttpError(405, 'Método no permitido')
  throw new HttpError(404, 'No encontrado')
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    let response
    try {
      if (url.pathname.startsWith('/api/')) {
        response = await handleApi(request, env, url)
      } else if (request.method === 'GET' || request.method === 'HEAD') {
        response = await env.ASSETS.fetch(request)
      } else {
        response = json({ error: 'Método no permitido' }, 405)
      }
    } catch (err) {
      response = errorResponse(err)
    }
    return withSecurityHeaders(response, env, url)
  },
}
