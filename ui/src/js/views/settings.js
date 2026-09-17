import { auth, sync as syncApi } from '../api.js'
import { toast }  from '../components/toast.js'
import { openModal, closeModal, confirm } from '../components/modal.js'

export async function showView(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Configuracion</h1>
        <p class="page-subtitle">Usuarios, seguridad y sincronizacion</p>
      </div>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      <button class="btn btn-primary" data-section="password">Cambiar contrasena</button>
      <button class="btn btn-secondary" data-section="users">Usuarios</button>
      <button class="btn btn-secondary" data-section="sync">Sincronizacion</button>
      <button class="btn btn-secondary" data-section="app">Aplicacion</button>
    </div>
    <div id="settings-section"></div>
  `

  container.querySelectorAll('[data-section]').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('[data-section]').forEach(b => b.className = 'btn btn-secondary')
      btn.className = 'btn btn-primary'
      renderSection(btn.dataset.section)
    }
  })

  renderSection('password')
}

function renderSection(section) {
  const c = document.getElementById('settings-section')
  if (!c) return
  if (section === 'password') renderChangePassword(c)
  else if (section === 'users') renderUsers(c)
  else if (section === 'sync') renderSync(c)
  else if (section === 'app') renderAppUpdates(c)
}

// ---------------------------------------------------------------------------
// Actualizaciones (Electron instalado)
// ---------------------------------------------------------------------------

function renderAppUpdates(c) {
  const updates = window.electron?.updates
  if (!updates) {
    c.innerHTML = `
      <div class="card" style="max-width:560px">
        <div class="card-body">
          <p style="color:var(--text-muted);font-size:13px;margin:0">
            Esta pantalla solo aplica a la aplicacion de escritorio instalada (.exe).
          </p>
        </div>
      </div>`
    return
  }

  c.innerHTML = `
    <div class="card" style="max-width:560px">
      <div class="card-header">
        <h3 class="card-title">Version de la aplicacion</h3>
      </div>
      <div class="card-body">
        <p style="margin:0 0 16px;font-size:14px">
          Instalada: <strong id="app-version-label">...</strong>
        </p>
        <p id="app-update-status" style="color:var(--text-muted);font-size:13px;margin:0 0 16px">
          Comprueba si hay una version nueva en el servidor de actualizaciones.
        </p>
        <div id="app-update-progress" style="display:none;margin-bottom:16px">
          <div class="form-label">Descargando...</div>
          <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
            <div id="app-update-bar" style="height:100%;width:0;background:var(--primary);transition:width .2s"></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="btn-check-updates">Buscar actualizaciones</button>
          <button class="btn btn-secondary btn-sm" id="btn-download-update" style="display:none">Descargar</button>
          <button class="btn btn-primary btn-sm" id="btn-install-update" style="display:none">Reiniciar e instalar</button>
        </div>
      </div>
    </div>
  `

  const statusEl = document.getElementById('app-update-status')
  const progressWrap = document.getElementById('app-update-progress')
  const progressBar = document.getElementById('app-update-bar')
  const btnCheck = document.getElementById('btn-check-updates')
  const btnDownload = document.getElementById('btn-download-update')
  const btnInstall = document.getElementById('btn-install-update')

  let pendingVersion = null
  let unsubscribe = null

  updates.getVersion().then((v) => {
    const el = document.getElementById('app-version-label')
    if (el) el.textContent = v || '—'
  })

  unsubscribe = updates.onStatus((payload) => {
    if (!payload?.phase) return
    switch (payload.phase) {
      case 'checking':
        statusEl.textContent = 'Buscando actualizaciones...'
        btnCheck.disabled = true
        break
      case 'not-available':
        statusEl.textContent = 'Ya tienes la ultima version publicada.'
        btnCheck.disabled = false
        btnDownload.style.display = 'none'
        break
      case 'available':
        pendingVersion = payload.version
        statusEl.textContent = `Disponible la version ${payload.version}. Descarga e instala para actualizar.`
        btnCheck.disabled = false
        btnDownload.style.display = 'inline-flex'
        btnInstall.style.display = 'none'
        progressWrap.style.display = 'none'
        break
      case 'progress':
        progressWrap.style.display = 'block'
        progressBar.style.width = `${Math.round(payload.percent || 0)}%`
        statusEl.textContent = `Descargando... ${Math.round(payload.percent || 0)}%`
        btnDownload.disabled = true
        break
      case 'downloaded':
        statusEl.textContent = `Version ${payload.version || pendingVersion} lista. Reinicia para completar la instalacion.`
        btnDownload.style.display = 'none'
        btnInstall.style.display = 'inline-flex'
        btnCheck.disabled = false
        btnDownload.disabled = false
        progressWrap.style.display = 'none'
        break
      case 'error':
        statusEl.textContent = payload.message || 'Error al buscar actualizaciones.'
        btnCheck.disabled = false
        btnDownload.disabled = false
        toast.error(statusEl.textContent)
        break
      default:
        break
    }
  })

  btnCheck.onclick = async () => {
    btnCheck.disabled = true
    statusEl.textContent = 'Buscando actualizaciones...'
    try {
      const result = await updates.check()
      if (!result?.ok) {
        statusEl.textContent = result?.error || 'No se pudo comprobar actualizaciones.'
        toast.error(statusEl.textContent)
      }
    } catch (err) {
      statusEl.textContent = err.message
      toast.error(err.message)
    } finally {
      btnCheck.disabled = false
    }
  }

  btnDownload.onclick = async () => {
    btnDownload.disabled = true
    try {
      const result = await updates.download()
      if (!result?.ok) {
        toast.error(result?.error || 'No se pudo descargar.')
        btnDownload.disabled = false
      }
    } catch (err) {
      toast.error(err.message)
      btnDownload.disabled = false
    }
  }

  btnInstall.onclick = () => {
    updates.install()
  }

  c._cleanupUpdates = () => {
    if (unsubscribe) unsubscribe()
  }
}

// ---------------------------------------------------------------------------
// Cambio de contrasena
// ---------------------------------------------------------------------------

function renderChangePassword(c) {
  c.innerHTML = `
    <div class="card" style="max-width:480px">
      <div class="card-header"><h3 class="card-title">Cambiar contrasena</h3></div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Contrasena actual <span class="required"></span></label>
          <input id="pwd-current" class="form-input" type="password" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label class="form-label">Nueva contrasena <span class="required"></span></label>
          <input id="pwd-new" class="form-input" type="password" autocomplete="new-password">
        </div>
        <div class="form-group">
          <label class="form-label">Confirmar nueva contrasena <span class="required"></span></label>
          <input id="pwd-confirm" class="form-input" type="password" autocomplete="new-password">
        </div>
        <div id="pwd-error" class="form-error" style="display:none"></div>
        <button class="btn btn-primary" id="btn-change-pwd">Actualizar contrasena</button>
      </div>
    </div>
  `

  document.getElementById('btn-change-pwd').onclick = async () => {
    const errEl   = document.getElementById('pwd-error')
    const current = document.getElementById('pwd-current').value
    const nw      = document.getElementById('pwd-new').value
    const confirm2 = document.getElementById('pwd-confirm').value

    if (!current || !nw) { errEl.textContent = 'Completa todos los campos'; errEl.style.display = 'block'; return }
    if (nw !== confirm2) { errEl.textContent = 'Las contrasenas no coinciden'; errEl.style.display = 'block'; return }
    if (nw.length < 6)   { errEl.textContent = 'Minimo 6 caracteres'; errEl.style.display = 'block'; return }

    errEl.style.display = 'none'
    try {
      await auth.changePassword(current, nw)
      toast.success('Contrasena actualizada correctamente')
      document.getElementById('pwd-current').value = ''
      document.getElementById('pwd-new').value     = ''
      document.getElementById('pwd-confirm').value = ''
    } catch (err) {
      errEl.textContent = err.message
      errEl.style.display = 'block'
    }
  }
}

// ---------------------------------------------------------------------------
// Gestion de usuarios (solo admin)
// ---------------------------------------------------------------------------

async function renderUsers(c) {
  c.innerHTML = `
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
    list.innerHTML = `
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td><code>${u.username}</code></td>
                <td>${u.full_name || '-'}</td>
                <td><span class="badge badge-blue">${u.role_name || '-'}</span></td>
                <td><span class="badge ${u.is_active ? 'badge-green' : 'badge-gray'}">${u.is_active ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  <div class="actions-cell">
                    <button class="btn btn-ghost btn-sm" data-edit-user="${u.id}">Editar</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `
    list.querySelectorAll('[data-edit-user]').forEach(btn =>
      btn.onclick = () => openUserForm(parseInt(btn.dataset.editUser), () => renderUsers(c))
    )
  } catch (err) {
    list.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}

async function openUserForm(userId, onSuccess) {
  const isEdit = userId !== null
  const roles  = await auth.roles()

  const formHTML = `
    <form id="user-form">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Nombre de usuario <span class="required"></span></label>
          <input id="uf-username" class="form-input" placeholder="usuario.apellido" ${isEdit ? 'readonly' : ''}>
        </div>
        <div class="form-group">
          <label class="form-label">Nombre completo</label>
          <input id="uf-fullname" class="form-input" placeholder="Nombre completo">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Rol <span class="required"></span></label>
          <select id="uf-role" class="form-select" required>
            ${roles.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Estado</label>
          <select id="uf-active" class="form-select">
            <option value="1">Activo</option>
            <option value="0">Inactivo</option>
          </select>
        </div>
      </div>
      ${!isEdit ? `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Contrasena <span class="required"></span></label>
            <input id="uf-password" class="form-input" type="password" autocomplete="new-password">
          </div>
        </div>` : ''}
      <div id="uf-error" class="form-error" style="display:none"></div>
    </form>
  `
  const footer = `
    <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Cancelar</button>
    <button class="btn btn-primary" id="uf-submit">${isEdit ? 'Guardar' : 'Crear usuario'}</button>
  `
  openModal(isEdit ? 'Editar usuario' : 'Nuevo usuario', formHTML, { footerHTML: footer })

  if (isEdit) {
    const users = await auth.users()
    const u = users.find(x => x.id === userId)
    if (u) {
      document.getElementById('uf-username').value = u.username || ''
      document.getElementById('uf-fullname').value = u.full_name || ''
      document.getElementById('uf-role').value     = u.role_id || roles[0]?.id
      document.getElementById('uf-active').value   = u.is_active ? '1' : '0'
    }
  }

  document.getElementById('uf-submit').onclick = async () => {
    const errEl = document.getElementById('uf-error')
    const username = document.getElementById('uf-username').value.trim()
    const roleId   = parseInt(document.getElementById('uf-role').value)

    if (!username || !roleId) { errEl.textContent = 'Usuario y rol son obligatorios'; errEl.style.display = 'block'; return }

    const payload = {
      username,
      full_name: document.getElementById('uf-fullname').value.trim() || undefined,
      role_id:   roleId,
      is_active: document.getElementById('uf-active').value === '1' ? 1 : 0,
    }

    if (!isEdit) {
      const pwd = document.getElementById('uf-password')?.value
      if (!pwd || pwd.length < 6) { errEl.textContent = 'Contrasena minimo 6 caracteres'; errEl.style.display = 'block'; return }
      payload.password = pwd
    }

    const btn = document.getElementById('uf-submit')
    btn.disabled = true
    errEl.style.display = 'none'

    try {
      if (isEdit) { await auth.updateUser(userId, payload); toast.success('Usuario actualizado') }
      else        { await auth.createUser(payload);         toast.success('Usuario creado') }
      closeModal()
      if (onSuccess) onSuccess()
    } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; btn.disabled = false }
  }
}

// ---------------------------------------------------------------------------
// Sincronizacion
// ---------------------------------------------------------------------------

async function renderSync(c) {
  c.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>'
  try {
    const status = await syncApi.status()
    const queue  = await syncApi.queue()

    c.innerHTML = `
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
    c.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`
  }
}
