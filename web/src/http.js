/** Respuestas JSON, errores y cabeceras de seguridad. */

export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status)
  }
  console.error('Error no controlado:', err && err.stack ? err.stack : err)
  return json({ error: 'Error interno. Intenta de nuevo.' }, 500)
}

const MAX_BODY = 16 * 1024

export async function readJson(request) {
  const type = request.headers.get('Content-Type') || ''
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Se esperaba JSON')
  }
  const text = await request.text()
  if (text.length > MAX_BODY) throw new HttpError(413, 'Solicitud demasiado grande')
  try {
    const data = JSON.parse(text || '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('no es objeto')
    return data
  } catch {
    throw new HttpError(400, 'JSON inválido')
  }
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Real-IP') || 'local'
}

/** Bloquea peticiones de escritura que no vengan de esta misma web (CSRF). */
export function assertSameOrigin(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return
  const origin = request.headers.get('Origin')
  const own = new URL(request.url).origin
  if (!origin || origin !== own) throw new HttpError(403, 'Origen no permitido')
}

const TURNSTILE_HOST = 'https://challenges.cloudflare.com'

export function withSecurityHeaders(response, env, url) {
  const res = new Response(response.body, response)
  const turnstile = Boolean(env.TURNSTILE_SITE_KEY)
  const csp = [
    "default-src 'self'",
    `script-src 'self'${turnstile ? ` ${TURNSTILE_HOST}` : ''}`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src ${turnstile ? TURNSTILE_HOST : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  res.headers.set('Content-Security-Policy', csp)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  if (url.protocol === 'https:') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    res.headers.set('Cache-Control', 'no-store')
  }
  return res
}
