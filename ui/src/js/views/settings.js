import { auth, sync as syncApi, processes as processesApi } from '../api.js'
import { toast }  from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'
import { getAppVersion } from '../appVersion.js'
import { applyViewAccess, setPageHeader } from '../layout.js'
import { APP_VIEWS, getSession, isAdmin, roleGrantsAll, setSession, viewsFromPermissions } from '../session.js'

const IDLE_OPTIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '60 min' },
  { value: '120', label: '2 h' },
  { value: '0', label: 'Nunca' },
]

const SETTINGS_SECTIONS = [
  { id: 'users', title: 'Usuarios', desc: 'Cuentas, contraseñas y acceso' },
  { id: 'sync', title: 'Sincronizacion', desc: 'Cola con la nube' },
  { id: 'app', title: 'Aplicacion', desc: 'Version y actualizaciones' },
]

let activeSettingsSection = null

export async function showView(container) {
  setPageHeader({
    title: 'Configuracion',
    subtitle: 'Usuarios, sincronizacion y actualizaciones del sistema',
  })
  const sections = isAdmin()
    ? SETTINGS_SECTIONS
    : SETTINGS_SECTIONS.map((s) => (
      s.id === 'users' ? { ...s, title: 'Seguridad', desc: 'Contraseña y sesión' } : s
    ))
  container.innerHTML = `
    <div class="settings-layout">
      <nav class="settings-nav" id="settings-nav" aria-label="Secciones de configuracion">
        ${sections.map((s) => `
          <button type="button" class="settings-nav-item" data-section="${s.id}">
            <span class="settings-nav-title">${s.title}</span>
            <span class="settings-nav-desc">${s.desc}</span>
          </button>
        `).join('')}
      </nav>
      <div class="settings-panel">
        <div id="settings-section"></div>
      </div>
    </div>
  `

  const nav = container.querySelector('#settings-nav')
  nav?.querySelectorAll('[data-section]').forEach((btn) => {
    btn.onclick = () => {
      nav.querySelectorAll('.settings-nav-item').forEach((b) => b.classList.remove('is-active'))
      btn.classList.add('is-active')
      renderSection(btn.dataset.section)
    }
  })

  const first = nav?.querySelector('[data-section="users"]') || nav?.querySelector('[data-section]')
  first?.classList.add('is-active')
  renderSection(first?.dataset.section || 'password')
}

function renderSection(section) {
  const c = document.getElementById('settings-section')
  if (!c) return
  if (activeSettingsSection === 'app' && c._cleanupUpdates) {
    c._cleanupUpdates()
    c._cleanupUpdates = null
  }
  activeSettingsSection = section
  if (section === 'users') renderUsers(c)
  else if (section === 'sync') renderSync(c)
  else if (section === 'app') renderAppUpdates(c)
}

// ---------------------------------------------------------------------------
// Actualizaciones (Electron instalado)
// ---------------------------------------------------------------------------

function formatUpdaterError(raw) {
  const text = String(raw || '')
  if (text.includes('404') && text.includes('releases')) {
    return (
      'No se puede leer las releases de GitHub (error 404). ' +
      'Si el repo Tintoreria-app es PRIVADO, ponlo PUBLICO en GitHub ' +
      '(Settings del repo → Change visibility) o instala manualmente el .exe. ' +
      'Luego vuelve a pulsar Buscar actualizaciones.'
    )
  }
  if (text.length > 280) {
    return 'Error al conectar con GitHub Releases. Revisa que el repo sea publico y que exista una release con latest.yml.'
  }
  return text || 'Error al buscar actualizaciones.'
}

const RELEASES_URL = 'https://api.github.com/repos/JuanRR777/Tintoreria-app/releases?per_page=8'
const RELEASES_WEB = 'https://github.com/JuanRR777/Tintoreria-app/releases'
const CHECKED_KEY = 'tintoreria_update_checked_at'
const SNOOZE_KEY = 'tintoreria_update_snooze'

function versionTag(value) {
  const text = String(value || '').trim()
  if (!text || text === 'desarrollo') return text
  return text.startsWith('v') ? text : `v${text}`
}

function sameVersion(a, b) {
  return versionTag(a).replace(/^v/i, '') === versionTag(b).replace(/^v/i, '')
}

function relativeTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const hours = Math.round(min / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'hace 1 día' : `hace ${days} días`
}

function releaseNotes(body) {
  const lines = String(body || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('<!--'))
  return lines.slice(0, 4)
}

function openRelease(url) {
  if (!url) return
  if (window.electron?.openExternal) window.electron.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

async function loadGithubReleases() {
  try {
    const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return []
    const rows = await res.json()
    if (!Array.isArray(rows)) return []
    return rows.filter((row) => !row.draft).map((row) => ({
      tag: row.tag_name || row.name || '',
      body: row.body || '',
      url: row.html_url || RELEASES_WEB,
      published: row.published_at || '',
    }))
  } catch {
    return []
  }
}

async function countRunningProcesses() {
  try {
    const [running, paused] = await Promise.all([
      processesApi.list({ status: 'in_progress' }),
      processesApi.list({ status: 'paused' }),
    ])
    return (Array.isArray(running) ? running.length : 0) + (Array.isArray(paused) ? paused.length : 0)
  } catch {
    return null
  }
}

async function renderAppUpdates(c) {
  const updates = window.electron?.updates
  const version = await getAppVersion()
  const installed = versionTag(version)
  const state = {
    installed,
    packaged: Boolean(updates),
    phase: updates ? 'idle' : 'browser',
    pending: '',
    progress: 0,
    error: '',
    checkedAt: localStorage.getItem(CHECKED_KEY) || '',
    snooze: localStorage.getItem(SNOOZE_KEY) || '',
    releases: [],
    busy: null,
  }

  c.innerHTML = `
    <div class="settings-section-head">
      <h2 class="settings-section-title">Aplicación</h2>
      <p class="settings-section-lead">Versión instalada y actualizaciones del sistema.</p>
    </div>
    <div class="app-upd">
      <div id="app-upd-offer"></div>
      <aside class="app-upd-side">
        <section class="card">
          <div class="card-body">
            <div class="settings-stat-label">Versión instalada</div>
            <div class="settings-stat-value">${esc(installed === 'desarrollo' ? 'Desarrollo' : installed)}</div>
            <dl class="app-upd-meta">
              <div><dt>Última comprobación</dt><dd id="app-upd-checked">${esc(relativeTime(state.checkedAt))}</dd></div>
              <div><dt>Origen</dt><dd><button type="button" class="app-upd-link" id="app-upd-origin">GitHub · Tintoreria-app</button></dd></div>
            </dl>
            ${updates ? '<button type="button" class="btn btn-secondary btn-sm" id="btn-check-updates">Buscar actualizaciones</button>' : ''}
          </div>
        </section>
        <section class="card" id="app-upd-history" hidden></section>
      </aside>
    </div>
  `

  const offer = document.getElementById('app-upd-offer')
  const history = document.getElementById('app-upd-history')
  const checkedEl = document.getElementById('app-upd-checked')

  function paintHistory() {
    if (!history) return
    const rows = state.releases.filter((row) => row.tag)
    if (!rows.length) {
      history.hidden = true
      history.innerHTML = ''
      return
    }
    history.hidden = false
    history.innerHTML = `
      <div class="card-header"><h3 class="card-title">Versiones anteriores</h3></div>
      <ul class="app-upd-history">
        ${rows.map((row) => `
          <li>
            <span>${esc(versionTag(row.tag))}${sameVersion(row.tag, state.installed) ? '<em>Instalada</em>' : ''}</span>
            <button type="button" class="app-upd-link" data-release="${esc(row.url)}">Notas</button>
          </li>`).join('')}
      </ul>`
    history.querySelectorAll('[data-release]').forEach((btn) => {
      btn.onclick = () => openRelease(btn.dataset.release)
    })
  }

  function offerNotes(versionName) {
    const match = state.releases.find((row) => sameVersion(row.tag, versionName))
    const notes = releaseNotes(match?.body)
    if (!notes.length) return ''
    return `
      <p class="app-offer-kicker">Novedades</p>
      <ul class="app-offer-notes">${notes.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
      <button type="button" class="app-upd-link" id="app-upd-notes">Ver notas completas en GitHub</button>`
  }

  function processBanner() {
    if (state.busy == null) return ''
    if (state.busy > 0) {
      return `<p class="app-offer-flag is-warn">Hay ${state.busy} proceso${state.busy === 1 ? '' : 's'} de teñido en curso. Espera a que terminen antes de instalar.</p>`
    }
    return '<p class="app-offer-flag is-ok">No hay procesos de teñido en curso. Puedes instalar ahora.</p>'
  }

  function paintOffer() {
    if (!offer) return
    const snoozed = state.pending && state.snooze === versionTag(state.pending)
    if (snoozed) {
      offer.innerHTML = `
        <section class="card app-offer">
          <div class="card-body">
            <h3>Actualización pospuesta</h3>
            <p>${esc(versionTag(state.pending))} queda pendiente. Vuelve a buscar cuando quieras instalarla.</p>
          </div>
        </section>`
      return
    }
    if (!state.packaged) {
      offer.innerHTML = `
        <section class="card app-offer">
          <div class="card-body">
            <h3>Actualizaciones del instalador</h3>
            <p>La descarga del .exe solo está disponible en la aplicación instalada. Esta copia es ${esc(installed === 'desarrollo' ? 'de desarrollo' : installed)}.</p>
          </div>
        </section>`
      return
    }
    if (state.phase === 'error') {
      offer.innerHTML = `
        <section class="card app-offer">
          <div class="card-body">
            <h3>No se pudo comprobar</h3>
            <p>${esc(state.error)}</p>
          </div>
        </section>`
      return
    }
    if (!state.pending || snoozed || state.phase === 'current') {
      offer.innerHTML = `
        <section class="card app-offer">
          <div class="card-body">
            <h3>${state.phase === 'checking' ? 'Buscando actualizaciones…' : 'Estás al día'}</h3>
            <p>${state.phase === 'current' ? `Tienes la última versión publicada, ${esc(installed)}.` : 'Busca si hay una versión nueva en GitHub Releases.'}</p>
          </div>
        </section>`
      return
    }
    const ready = state.phase === 'downloaded'
    const downloading = state.phase === 'progress'
    offer.innerHTML = `
      <section class="card app-offer">
        <div class="card-body">
          <div class="app-offer-head">
            <span class="app-offer-ico" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>
            </span>
            <div>
              <h3>Hay una nueva versión: ${esc(versionTag(state.pending))}</h3>
              <p>Tienes ${esc(installed)} · publicada en GitHub</p>
            </div>
          </div>
          ${offerNotes(state.pending)}
          ${processBanner()}
          <div id="app-update-progress" class="settings-update-progress" ${downloading ? '' : 'hidden'}>
            <div class="form-label">Descargando… ${Math.round(state.progress)}%</div>
            <div class="settings-progress-track"><div id="app-update-bar" class="settings-progress-bar" style="width:${Math.round(state.progress)}%"></div></div>
          </div>
          <div class="settings-update-actions">
            <button type="button" class="btn btn-primary" id="btn-apply-update" ${downloading || state.busy > 0 ? 'disabled' : ''}>${ready ? 'Instalar y reiniciar' : 'Descargar e instalar'}</button>
            <button type="button" class="btn btn-secondary" id="btn-snooze-update">Recordar más tarde</button>
          </div>
        </div>
      </section>`
    document.getElementById('app-upd-notes')?.addEventListener('click', () => {
      const match = state.releases.find((row) => sameVersion(row.tag, state.pending))
      openRelease(match?.url || RELEASES_WEB)
    })
    document.getElementById('btn-snooze-update').onclick = () => {
      state.snooze = versionTag(state.pending)
      localStorage.setItem(SNOOZE_KEY, state.snooze)
      paintOffer()
    }
    document.getElementById('btn-apply-update').onclick = async () => {
      if (ready) {
        updates.install()
        return
      }
      const btn = document.getElementById('btn-apply-update')
      btn.disabled = true
      try {
        const result = await updates.download()
        if (!result?.ok) {
          state.error = result?.error || 'No se pudo descargar.'
          state.phase = 'error'
          paintOffer()
        }
      } catch (err) {
        state.error = err.message
        state.phase = 'error'
        paintOffer()
      }
    }
  }

  paintOffer()
  document.getElementById('app-upd-origin').onclick = () => openRelease(RELEASES_WEB)

  let unsubscribe = null
  if (updates) {
    unsubscribe = updates.onStatus((payload) => {
      if (!payload?.phase) return
      if (payload.phase === 'checking') state.phase = 'checking'
      else if (payload.phase === 'not-available') {
        state.phase = 'current'
        state.pending = ''
        state.checkedAt = new Date().toISOString()
        localStorage.setItem(CHECKED_KEY, state.checkedAt)
        if (checkedEl) checkedEl.textContent = relativeTime(state.checkedAt)
      } else if (payload.phase === 'available') {
        state.phase = 'available'
        state.pending = payload.version || ''
        state.checkedAt = new Date().toISOString()
        localStorage.setItem(CHECKED_KEY, state.checkedAt)
        if (checkedEl) checkedEl.textContent = relativeTime(state.checkedAt)
      } else if (payload.phase === 'progress') {
        state.phase = 'progress'
        state.progress = payload.percent || 0
      } else if (payload.phase === 'downloaded') {
        state.phase = 'downloaded'
        if (payload.version) state.pending = payload.version
      } else if (payload.phase === 'error') {
        state.phase = 'error'
        state.error = formatUpdaterError(payload.message)
      }
      paintOffer()
    })
    document.getElementById('btn-check-updates').onclick = async () => {
      const btn = document.getElementById('btn-check-updates')
      btn.disabled = true
      state.phase = 'checking'
      state.error = ''
      paintOffer()
      try {
        const result = await updates.check()
        if (!result?.ok && state.phase !== 'available' && state.phase !== 'current') {
          state.phase = 'error'
          state.error = formatUpdaterError(result?.error)
          paintOffer()
        }
      } catch (err) {
        state.phase = 'error'
        state.error = formatUpdaterError(err.message)
        paintOffer()
      } finally {
        btn.disabled = false
      }
    }
  }

  c._cleanupUpdates = () => {
    if (unsubscribe) unsubscribe()
  }

  const [releases, busy] = await Promise.all([loadGithubReleases(), countRunningProcesses()])
  if (activeSettingsSection !== 'app') return
  state.releases = releases
  state.busy = busy
  paintHistory()
  paintOffer()
}

// ---------------------------------------------------------------------------
// Contraseña y sesión
// ---------------------------------------------------------------------------

const PENCIL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function passwordChecks(value) {
  return {
    length: value.length >= 8,
    mix: /[A-Z]/.test(value) && /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  }
}

function passwordLevel(checks) {
  const met = Object.values(checks).filter(Boolean).length
  if (!met) return { id: '', label: '' }
  if (met < 3) return met === 1
    ? { id: 'baja', label: 'Seguridad baja' }
    : { id: 'media', label: 'Seguridad media' }
  return { id: 'alta', label: 'Seguridad alta' }
}

function passwordFieldsHtml({ prefix, askCurrent }) {
  return `
    ${askCurrent ? `
      <div class="pwd-field">
        <label class="form-label" for="${prefix}-current">Contraseña actual <span class="required"></span></label>
        <div class="pwd-input">
          <input id="${prefix}-current" class="form-input" type="password" autocomplete="current-password">
          <button type="button" class="pwd-reveal" data-reveal="${prefix}-current">Mostrar</button>
        </div>
      </div>` : ''}
    <div class="pwd-field">
      <label class="form-label" for="${prefix}-new">Nueva contraseña <span class="required"></span></label>
      <div class="pwd-input">
        <input id="${prefix}-new" class="form-input" type="password" autocomplete="new-password">
        <button type="button" class="pwd-reveal" data-reveal="${prefix}-new">Mostrar</button>
      </div>
      <div class="pwd-meter" data-meter="${prefix}" hidden><span data-meter-bar></span></div>
      <p class="pwd-meter-label" data-meter-label="${prefix}" hidden></p>
      <ul class="pwd-rules" data-rules="${prefix}">
        <li data-rule="length"><i></i>Al menos 8 caracteres</li>
        <li data-rule="mix"><i></i>Una mayúscula y un número</li>
        <li data-rule="symbol"><i></i>Un símbolo (! # $ _)</li>
      </ul>
    </div>
    <div class="pwd-field">
      <label class="form-label" for="${prefix}-confirm">Confirmar nueva contraseña <span class="required"></span></label>
      <div class="pwd-input">
        <input id="${prefix}-confirm" class="form-input" type="password" autocomplete="new-password">
        <button type="button" class="pwd-reveal" data-reveal="${prefix}-confirm">Mostrar</button>
      </div>
      <p class="pwd-match" data-match="${prefix}" hidden></p>
    </div>`
}

function bindPasswordFields(root, prefix) {
  root.querySelectorAll(`[data-reveal="${prefix}-current"], [data-reveal="${prefix}-new"], [data-reveal="${prefix}-confirm"]`).forEach((btn) => {
    btn.onclick = () => {
      const input = document.getElementById(btn.dataset.reveal)
      if (!input) return
      const show = input.type === 'password'
      input.type = show ? 'text' : 'password'
      btn.textContent = show ? 'Ocultar' : 'Mostrar'
    }
  })
  const next = () => paintPassword(prefix)
  document.getElementById(`${prefix}-new`)?.addEventListener('input', next)
  document.getElementById(`${prefix}-confirm`)?.addEventListener('input', next)
  paintPassword(prefix)
}

function paintPassword(prefix) {
  const value = document.getElementById(`${prefix}-new`)?.value || ''
  const confirmValue = document.getElementById(`${prefix}-confirm`)?.value || ''
  const checks = passwordChecks(value)
  const level = passwordLevel(checks)
  const meter = document.querySelector(`[data-meter="${prefix}"]`)
  const label = document.querySelector(`[data-meter-label="${prefix}"]`)
  if (meter) {
    meter.hidden = !value
    meter.className = `pwd-meter${level.id ? ` is-${level.id}` : ''}`
  }
  if (label) {
    label.hidden = !value
    label.textContent = level.label
    label.className = `pwd-meter-label${level.id ? ` is-${level.id}` : ''}`
  }
  document.querySelectorAll(`[data-rules="${prefix}"] [data-rule]`).forEach((item) => {
    item.classList.toggle('is-ok', Boolean(checks[item.dataset.rule]) && Boolean(value))
  })
  const match = document.querySelector(`[data-match="${prefix}"]`)
  if (match) {
    const ready = Boolean(confirmValue)
    match.hidden = !ready
    const same = value === confirmValue
    match.className = `pwd-match${same ? ' is-ok' : ' is-bad'}`
    match.textContent = same ? 'Las contraseñas coinciden' : 'Las contraseñas no coinciden'
  }
}

function readOptionalPassword(prefix, { askCurrent }) {
  const current = document.getElementById(`${prefix}-current`)?.value || ''
  const next = document.getElementById(`${prefix}-new`)?.value || ''
  const confirmValue = document.getElementById(`${prefix}-confirm`)?.value || ''
  if (!current && !next && !confirmValue) return { skip: true }
  return readPassword(prefix, { askCurrent })
}

function readPassword(prefix, { askCurrent }) {
  const current = document.getElementById(`${prefix}-current`)?.value || ''
  const next = document.getElementById(`${prefix}-new`)?.value || ''
  const confirmValue = document.getElementById(`${prefix}-confirm`)?.value || ''
  if (askCurrent && !current) return { error: 'Escribe la contraseña actual' }
  if (!next || !confirmValue) return { error: 'Completa la nueva contraseña y su confirmación' }
  const checks = passwordChecks(next)
  if (!checks.length || !checks.mix || !checks.symbol) {
    return { error: 'La contraseña debe cumplir las tres condiciones' }
  }
  if (next !== confirmValue) return { error: 'Las contraseñas no coinciden' }
  return { current, next }
}

function idleValue(minutes) {
  const value = String(minutes ?? 30)
  return IDLE_OPTIONS.some((o) => o.value === value) ? value : '30'
}

function idleLabel(minutes) {
  return IDLE_OPTIONS.find((o) => o.value === idleValue(minutes))?.label || '30 min'
}

function viewFieldsHtml() {
  const sections = [...new Set(APP_VIEWS.map((view) => view.section))]
  return `
    <section class="pwd-session" id="uf-views">
      <h4>Vistas</h4>
      <p class="settings-muted">Elige qué secciones ve este usuario en el menú.</p>
      ${sections.map((section) => `
        <div class="perm-group">
          <p>${esc(section)}</p>
          <div class="perm-grid">
            ${APP_VIEWS.filter((view) => view.section === section).map((view) => `
              <label class="perm-item">
                <input type="checkbox" data-view-perm="${view.id}">
                <span>${esc(view.label)}</span>
              </label>`).join('')}
          </div>
        </div>`).join('')}
    </section>
    <p class="settings-muted" id="uf-views-admin" hidden>El administrador ve todas las vistas.</p>`
}

function setViewChecks(ids) {
  const allowed = new Set(ids)
  document.querySelectorAll('[data-view-perm]').forEach((input) => {
    input.checked = allowed.has(input.dataset.viewPerm)
  })
}

function readViews() {
  return [...document.querySelectorAll('[data-view-perm]:checked')].map((input) => input.dataset.viewPerm)
}

function sessionFieldsHtml(minutes) {
  const current = idleValue(minutes)
  return `
    <section class="pwd-session">
      <h4>Sesión</h4>
      <div class="settings-session-row">
        <label class="form-label" for="uf-idle">Cerrar sesión tras un tiempo sin uso</label>
        <select id="uf-idle" class="form-select">
          ${IDLE_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
      <p class="settings-muted">Solo aplica a esta cuenta, en cualquier equipo.</p>
    </section>`
}

function readIdleMinutes() {
  return Number(document.getElementById('uf-idle')?.value ?? 30)
}

function rememberOwnIdle(userId, minutes) {
  const me = getSession()
  if (!me || Number(me.id) !== Number(userId)) return
  setSession({ ...me, idle_minutes: Number(minutes) })
  window.dispatchEvent(new Event('tintoreria-idle-change'))
}

function renderOwnSecurity(c) {
  c.innerHTML = `
    <div class="settings-section-head">
      <h2 class="settings-section-title">Seguridad</h2>
      <p class="settings-section-lead">Actualiza la contraseña de tu cuenta. Tu sesión se cierra tras ${esc(idleLabel(getSession()?.idle_minutes))} sin uso.</p>
    </div>
    <div class="card settings-own-security">
      <div class="card-header"><h3 class="card-title">Cambiar contraseña</h3></div>
      <div class="card-body">
        ${passwordFieldsHtml({ prefix: 'own', askCurrent: true })}
        <div id="own-error" class="form-error" style="display:none"></div>
        <button class="btn btn-primary" id="own-submit" type="button">Actualizar contraseña</button>
      </div>
    </div>
  `
  bindPasswordFields(c, 'own')
  document.getElementById('own-submit').onclick = async () => {
    const errEl = document.getElementById('own-error')
    const read = readPassword('own', { askCurrent: true })
    if (read.error) {
      errEl.textContent = read.error
      errEl.style.display = 'block'
      return
    }
    errEl.style.display = 'none'
    const btn = document.getElementById('own-submit')
    btn.disabled = true
    try {
      await auth.changePassword(read.current, read.next)
      toast.success('Contraseña actualizada')
      document.getElementById('own-current').value = ''
      document.getElementById('own-new').value = ''
      document.getElementById('own-confirm').value = ''
      paintPassword('own')
    } catch (err) {
      errEl.textContent = err.message
      errEl.style.display = 'block'
    } finally {
      btn.disabled = false
    }
  }
}

// ---------------------------------------------------------------------------
// Gestion de usuarios
// ---------------------------------------------------------------------------

async function renderUsers(c) {
  if (!isAdmin()) {
    renderOwnSecurity(c)
    return
  }
  c.innerHTML = `
    <div class="settings-section-head">
      <h2 class="settings-section-title">Usuarios</h2>
      <p class="settings-section-lead">Cuentas, contraseñas y acceso. El lápiz abre la ficha del usuario.</p>
    </div>
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Usuarios del sistema</h3>
        <button class="btn btn-primary btn-sm" id="btn-new-user">Nuevo usuario</button>
      </div>
      <div id="users-list"><div class="loading-state"><div class="spinner"></div></div></div>
    </div>
  `
  document.getElementById('btn-new-user').onclick = () => openUserForm(null, () => renderUsers(c))
  await loadUsers(c)
}

async function loadUsers(c) {
  const list = document.getElementById('users-list')
  if (!list) return
  try {
    const users = await auth.users()
    const me = Number(getSession()?.id)
    list.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Sesión</th><th></th></tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td><code>${esc(u.username)}</code>${Number(u.id) === me ? '<span class="usr-you">Tú</span>' : ''}</td>
                <td>${esc(u.full_name || '—')}</td>
                <td><span class="badge badge-blue">${esc(u.role_name || '—')}</span></td>
                <td>
                  <button type="button" class="usr-state ${u.is_active ? 'is-on' : 'is-off'}" data-toggle-user="${u.id}" aria-pressed="${u.is_active ? 'true' : 'false'}">
                    ${u.is_active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td>${esc(idleLabel(u.idle_minutes))}</td>
                <td>
                  <div class="actions-cell">
                    <button type="button" class="usr-icon" data-edit-user="${u.id}" aria-label="Editar usuario" title="Editar">${PENCIL}</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `
    list.querySelectorAll('[data-edit-user]').forEach((btn) => {
      btn.onclick = () => openUserForm(parseInt(btn.dataset.editUser, 10), () => renderUsers(c))
    })
    list.querySelectorAll('[data-toggle-user]').forEach((btn) => {
      btn.onclick = () => {
        const user = users.find((x) => x.id === Number(btn.dataset.toggleUser))
        if (user) toggleUserActive(user, () => loadUsers(c))
      }
    })
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>${esc(err.message)}</p></div>`
  }
}

async function toggleUserActive(user, onSuccess) {
  const next = user.is_active ? 0 : 1
  if (!next && Number(user.id) === Number(getSession()?.id)) {
    toast.error('No puedes desactivar tu propia cuenta')
    return
  }
  const ok = await confirm(
    next
      ? `Activar a ${esc(user.username)}. Podrá volver a entrar.`
      : `Desactivar a ${esc(user.username)}. No podrá iniciar sesión.`,
    next ? 'Activar usuario' : 'Desactivar usuario',
  )
  if (!ok) return
  try {
    await auth.updateUser(user.id, { is_active: next })
    toast.success(next ? 'Usuario activado' : 'Usuario desactivado')
    if (onSuccess) await onSuccess()
  } catch (err) {
    toast.error(err.message)
  }
}

async function openUserForm(userId, onSuccess) {
  const isEdit = userId !== null
  const roles  = await auth.roles()
  const users = isEdit ? await auth.users() : []
  const current = isEdit ? users.find((x) => x.id === userId) : null

  const formHTML = `
    <form id="user-form">
      <div class="form-group">
        <label class="form-label">Nombre de usuario <span class="required"></span></label>
        <input id="uf-username" class="form-input" placeholder="usuario.apellido" ${isEdit ? 'readonly' : ''}>
      </div>
      <div class="form-group">
        <label class="form-label">Nombre completo</label>
        <input id="uf-fullname" class="form-input" placeholder="Nombre completo">
      </div>
      <div class="form-group">
        <label class="form-label">Rol <span class="required"></span></label>
        <select id="uf-role" class="form-select" required>
          ${roles.map((r) => `<option value="${r.id}">${esc(r.display_name || r.name)}</option>`).join('')}
        </select>
      </div>
      <section class="pwd-session">
        <h4>Contraseña</h4>
        ${isEdit ? `<p class="settings-muted">${Number(current?.id) === Number(getSession()?.id)
          ? 'Déjala en blanco si no quieres cambiarla. Para cambiar la tuya, confirma la actual.'
          : 'Déjala en blanco si no quieres cambiarla. Si escribes una nueva, la anterior deja de servir.'}</p>` : ''}
        ${passwordFieldsHtml({ prefix: 'uf', askCurrent: isEdit && Number(current?.id) === Number(getSession()?.id) })}
      </section>
      ${sessionFieldsHtml(current?.idle_minutes)}
      ${viewFieldsHtml()}
      <div id="uf-error" class="form-error" style="display:none"></div>
    </form>
  `
  const footer = `
    <button class="btn btn-secondary" id="uf-cancel" type="button">Cancelar</button>
    <button class="btn btn-primary" id="uf-submit" type="button">${isEdit ? 'Guardar' : 'Crear usuario'}</button>
  `
  openModal(isEdit ? 'Editar usuario' : 'Nuevo usuario', formHTML, { footerHTML: footer, drawer: true })
  const mine = isEdit && Number(current?.id) === Number(getSession()?.id)
  bindPasswordFields(document.getElementById('modal-body'), 'uf')
  document.getElementById('uf-cancel').onclick = () => closeModal()

  if (current) {
    document.getElementById('uf-username').value = current.username || ''
    document.getElementById('uf-fullname').value = current.full_name || ''
    document.getElementById('uf-role').value = current.role_id || roles[0]?.id
  }

  const roleById = () => roles.find((role) => String(role.id) === document.getElementById('uf-role').value)
  const paintViews = (fromRole) => {
    const role = roleById()
    const adminRole = roleGrantsAll(role)
    document.getElementById('uf-views').hidden = adminRole
    document.getElementById('uf-views-admin').hidden = !adminRole
    if (adminRole) return
    const saved = !fromRole && current?.user_permissions
      ? viewsFromPermissions(current.user_permissions)
      : null
    setViewChecks(saved || viewsFromPermissions(role?.permissions))
  }
  paintViews(false)
  document.getElementById('uf-role').onchange = () => paintViews(true)

  document.getElementById('uf-submit').onclick = async () => {
    const errEl = document.getElementById('uf-error')
    const username = document.getElementById('uf-username').value.trim()
    const roleId = parseInt(document.getElementById('uf-role').value, 10)

    if (!username || !roleId) {
      errEl.textContent = 'Usuario y rol son obligatorios'
      errEl.style.display = 'block'
      return
    }

    const payload = {
      username,
      full_name: document.getElementById('uf-fullname').value.trim() || username,
      role_id: roleId,
      email: current?.email || `${username}@local.tintoreria`,
      idle_minutes: readIdleMinutes(),
    }

    const read = isEdit
      ? readOptionalPassword('uf', { askCurrent: mine })
      : readPassword('uf', { askCurrent: false })
    if (read.error) {
      errEl.textContent = read.error
      errEl.style.display = 'block'
      return
    }
    if (!isEdit) payload.password = read.next
    const chosenRole = roles.find((role) => role.id === roleId)
    if (!roleGrantsAll(chosenRole)) payload.views = readViews()

    const btn = document.getElementById('uf-submit')
    btn.disabled = true
    errEl.style.display = 'none'

    try {
      if (isEdit) {
        await auth.updateUser(userId, {
          full_name: payload.full_name,
          role_id: payload.role_id,
          idle_minutes: payload.idle_minutes,
          ...('views' in payload ? { views: payload.views } : {}),
        })
        if (!read.skip) {
          if (mine) await auth.changePassword(read.current, read.next)
          else await auth.updateUser(userId, { password: read.next })
        }
        rememberOwnIdle(userId, payload.idle_minutes)
        if (Number(userId) === Number(getSession()?.id)) {
          const me = getSession()
          setSession({
            ...me,
            role_id: payload.role_id,
            role_name: chosenRole?.name || me?.role_name,
            permissions: roleGrantsAll(chosenRole) ? '["*"]' : JSON.stringify(payload.views || []),
          })
          applyViewAccess()
        }
        toast.success('Usuario actualizado')
      } else {
        await auth.createUser(payload)
        toast.success('Usuario creado')
      }
      closeModal()
      if (onSuccess) onSuccess()
    } catch (err) {
      errEl.textContent = err.message
      errEl.style.display = 'block'
      btn.disabled = false
    }
  }
}

// ---------------------------------------------------------------------------
// Sincronizacion
// ---------------------------------------------------------------------------

async function renderSync(c) {
  c.innerHTML = `
    <div class="settings-section-head">
      <h2 class="settings-section-title">Sincronizacion</h2>
      <p class="settings-section-lead">Estado de la cola hacia la nube.</p>
    </div>
    <div class="loading-state"><div class="spinner"></div></div>`
  try {
    const status = await syncApi.status()
    const queue  = await syncApi.queue()

    c.innerHTML = `
      <div class="settings-section-head">
        <h2 class="settings-section-title">Sincronizacion</h2>
        <p class="settings-section-lead">Estado de la cola hacia la nube.</p>
      </div>
      <div class="card" style="max-width:600px">
        <div class="card-header">
          <h3 class="card-title">Estado de sincronizacion</h3>
          <span class="badge ${status.enabled ? 'badge-green' : 'badge-gray'}">${status.enabled ? 'Habilitada' : 'Deshabilitada'}</span>
        </div>
        <div class="card-body">
          ${!status.enabled
            ? `<p style="color:var(--text-muted);font-size:13px">La sincronizacion con la nube no esta configurada. Configura las variables de entorno <code>SYNC_API_URL</code> y <code>SYNC_API_KEY</code> para activarla.</p>`
            : `<div style="display:flex;flex-direction:column;gap:12px">
                <div class="form-row" style="gap:24px">
                  <div><div class="form-label">Pendientes</div><div style="font-size:20px;font-weight:700">${queue.pending ?? 0}</div></div>
                  <div><div class="form-label">Enviados</div><div style="font-size:20px;font-weight:700;color:var(--success)">${queue.sent ?? 0}</div></div>
                  <div><div class="form-label">Con error</div><div style="font-size:20px;font-weight:700;color:var(--danger)">${queue.error ?? 0}</div></div>
                </div>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-primary btn-sm" id="btn-push-now">Sincronizar ahora</button>
                  ${(queue.error ?? 0) > 0 ? `<button class="btn btn-secondary btn-sm" id="btn-retry">Reintentar errores</button>` : ''}
                </div>
               </div>`
          }
        </div>
      </div>
    `

    if (status.enabled) {
      document.getElementById('btn-push-now')?.addEventListener('click', async () => {
        try { await syncApi.pushNow(); toast.success('Sincronizacion iniciada'); await renderSync(c) }
        catch (err) { toast.error(err.message) }
      })
      document.getElementById('btn-retry')?.addEventListener('click', async () => {
        try { await syncApi.retryErrors(); toast.success('Errores puestos en cola'); await renderSync(c) }
        catch (err) { toast.error(err.message) }
      })
    }
  } catch (err) {
    c.innerHTML = `
      <div class="settings-section-head">
        <h2 class="settings-section-title">Sincronizacion</h2>
        <p class="settings-section-lead">Estado de la cola hacia la nube.</p>
      </div>
      <div class="empty-state"><p>${err.message}</p></div>`
  }
}
