#!/usr/bin/env node
/**
 * Crea un administrador del portal web directamente en D1.
 *
 *   npm run admin:local  -- --username juan.romero --name "Juan Romero"
 *   npm run admin:remote -- --username juan.romero --name "Juan Romero"
 *
 * La contraseña se pide sin mostrarse en pantalla (o se lee de la variable
 * WEB_ADMIN_PASSWORD). Nunca se pasa como argumento ni se guarda en disco:
 * solo su hash PBKDF2 viaja a la base.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clampIterations, hashPassword, passwordProblem } from '../src/crypto.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          stdout.write('\n')
          resolve(value)
          return
        }
        if (ch === '\u0003') process.exit(130)
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    stdin.on('data', onData)
  })
}

function sqlText(value) {
  return value == null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`
}

function configuredIterations() {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8')
  const match = toml.match(/^\s*PBKDF2_ITERATIONS\s*=\s*"(\d+)"/m)
  return clampIterations(match ? match[1] : undefined)
}

const target = process.argv.includes('--remote') ? '--remote' : process.argv.includes('--local') ? '--local' : null
if (!target) fail('Indica --local o --remote')

const username = String(arg('username') || '').trim().toLowerCase()
const fullName = String(arg('name') || '').trim().replace(/\s+/g, ' ')
const email = arg('email') ? String(arg('email')).trim().toLowerCase() : null
if (!USERNAME_RE.test(username)) fail('--username: 3 a 32 caracteres en minúscula, números, punto, guion o guion bajo')
if (fullName.length < 3 || fullName.length > 80) fail('--name: entre 3 y 80 caracteres (usa comillas si tiene espacios)')

let password = process.env.WEB_ADMIN_PASSWORD || ''
if (!password) {
  if (!process.stdin.isTTY) fail('Sin terminal interactiva: define WEB_ADMIN_PASSWORD')
  console.log('Reglas: 10+ caracteres, mayúscula, minúscula, número, símbolo y sin el usuario.')
  password = await promptHidden('Contraseña: ')
  const again = await promptHidden('Repite la contraseña: ')
  if (password !== again) fail('Las contraseñas no coinciden')
}
const problem = passwordProblem(password, username)
if (problem) fail(problem)

const hash = await hashPassword(password, configuredIterations())
const sql = `INSERT INTO web_users
  (username, full_name, email, role, password_hash, must_change_password, password_changed_at)
VALUES (${sqlText(username)}, ${sqlText(fullName)}, ${sqlText(email)}, 'admin', ${sqlText(hash)}, 0, datetime('now'));
`

const dir = mkdtempSync(join(tmpdir(), 'tin-admin-'))
const file = join(dir, 'admin.sql')
writeFileSync(file, sql, 'utf8')
try {
  console.log(`\nCreando administrador "${username}" en D1 (${target.slice(2)})…`)
  // Comando fijo: solo varía la ruta del archivo temporal, que va entre comillas.
  const command = `npx wrangler d1 execute tintoreria ${target} --file "${file}" --yes`
  const result = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true })
  if (result.status !== 0) fail('wrangler no pudo crear el usuario (¿ya existe ese usuario? ¿falta aplicar la migración 0014?)')
  console.log(`\n✓ Administrador "${username}" creado. Ya puede ingresar al portal.\n`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
