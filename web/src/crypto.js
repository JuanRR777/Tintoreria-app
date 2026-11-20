/**
 * Contraseñas con PBKDF2-SHA256 (WebCrypto nativo del Worker) y tokens de sesión.
 * Formato guardado: pbkdf2-sha256$<iteraciones>$<sal base64>$<hash base64>
 */

const encoder = new TextEncoder()
const SCHEME = 'pbkdf2-sha256'
export const MAX_ITERATIONS = 100000

export function toBase64(bytes) {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

export function fromBase64(value) {
  const text = atob(value)
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i)
  return out
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(size = 32) {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

export function clampIterations(value) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < 10000) return MAX_ITERATIONS
  return Math.min(n, MAX_ITERATIONS)
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

export async function hashPassword(password, iterations) {
  const rounds = clampIterations(iterations)
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const hash = await derive(password, salt, rounds)
  return `${SCHEME}$${rounds}$${toBase64(salt)}$${toBase64(hash)}`
}

function parseStored(stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 4 || parts[0] !== SCHEME) return null
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return null
  try {
    return { iterations, salt: fromBase64(parts[2]), hash: fromBase64(parts[3]) }
  } catch {
    return null
  }
}

/** Hash ficticio para que un usuario inexistente tarde lo mismo que uno real. */
function dummyStored(iterations) {
  return `${SCHEME}$${clampIterations(iterations)}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`
}

/**
 * Verifica la contraseña. Si stored es null calcula igual contra un hash
 * ficticio y devuelve false, para no revelar si el usuario existe.
 */
export async function verifyPassword(password, stored, iterations) {
  const parsed = parseStored(stored || dummyStored(iterations))
  if (!parsed) return { ok: false, iterations: 0 }
  const candidate = await derive(password, parsed.salt, parsed.iterations)
  const ok = Boolean(stored) && timingSafeEqual(candidate, parsed.hash)
  return { ok, iterations: parsed.iterations }
}

/** Reglas de contraseña del portal (expuesto a internet: algo más estricto que la app). */
export function passwordProblem(password, username = '') {
  const value = String(password || '')
  if (value.length < 10) return 'La contraseña debe tener al menos 10 caracteres'
  if (value.length > 128) return 'La contraseña no puede pasar de 128 caracteres'
  if (!/[a-z]/.test(value)) return 'La contraseña necesita una minúscula'
  if (!/[A-Z]/.test(value)) return 'La contraseña necesita una mayúscula'
  if (!/\d/.test(value)) return 'La contraseña necesita un número'
  if (!/[^A-Za-z0-9]/.test(value)) return 'La contraseña necesita un símbolo'
  const user = String(username || '').trim().toLowerCase()
  if (user.length >= 3 && value.toLowerCase().includes(user)) {
    return 'La contraseña no puede contener el usuario'
  }
  return ''
}
