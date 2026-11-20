/** Registro de seguridad: quién hizo qué y desde dónde. */

import { clientIp, json } from './http.js'
import { requireUser } from './auth.js'

export async function audit(env, request, actor, event, detail) {
  try {
    await env.DB.prepare(
      'INSERT INTO web_audit (user_id, username, event, detail, ip) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      actor && actor.id ? actor.id : null,
      actor && actor.username ? String(actor.username).slice(0, 64) : null,
      event,
      detail ? String(detail).slice(0, 300) : null,
      clientIp(request),
    ).run()
  } catch (err) {
    console.error('No se pudo registrar auditoría', event, err)
  }
}

export async function listAudit(request, env, url) {
  await requireUser(request, env, 'audit.view')
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 300)
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, username, event, detail, ip, created_at
     FROM web_audit ORDER BY id DESC LIMIT ?`,
  ).bind(limit).all()
  return json({ items: results || [] })
}
