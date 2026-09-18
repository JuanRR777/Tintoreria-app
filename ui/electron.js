const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const { spawn }  = require('child_process')
const path       = require('path')
const os         = require('os')
const http       = require('http')
const fs         = require('fs')

const { setupAutoUpdater } = require('./updater')

const IS_DEV    = process.env.NODE_ENV === 'development' || !app.isPackaged
const API_PORT  = 8000
const API_HOST  = '127.0.0.1'
const API_URL   = `http://${API_HOST}:${API_PORT}`

let mainWindow = null
let loadingWindow = null
let apiProcess = null
let startupDone = false
let runtimePaths = null
let autoUpdater = null

function tintoreriaDataDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(base, 'Tintoreria')
}

function userEnvPath() {
  return path.join(tintoreriaDataDir(), '.env')
}

function bootLogPath() {
  if (IS_DEV) return path.join(__dirname, '..', 'electron-boot.log')
  return path.join(tintoreriaDataDir(), 'logs', 'electron-boot.log')
}

function bootLog(message) {
  try {
    const logFile = bootLogPath()
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`)
  } catch { /* ignore */ }
}

function findPythonDev(apiDir) {
  const candidates = [
    path.join(apiDir, '.venv', 'Scripts', 'python.exe'),
    path.join(apiDir, '.venv', 'python.exe'),
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return 'python'
}

function resolveRuntimePaths() {
  if (app.isPackaged) {
    const resources = process.resourcesPath
    return {
      pythonExe: path.join(resources, 'python', 'python.exe'),
      apiDir: path.join(resources, 'api'),
      envExample: path.join(resources, 'api', '.env.example'),
      apiLogPath: path.join(tintoreriaDataDir(), 'logs', 'api-startup.log'),
    }
  }
  const apiDir = path.join(__dirname, '..', 'api')
  return {
    pythonExe: findPythonDev(apiDir),
    apiDir,
    envExample: path.join(apiDir, '.env.example'),
    apiLogPath: path.join(apiDir, 'startup.log'),
  }
}

function ensureUserEnv(envExamplePath) {
  const target = userEnvPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(target)) return target
  if (envExamplePath && fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, target)
    bootLog(`created user env from ${envExamplePath}`)
  } else {
    fs.writeFileSync(
      target,
      'WORKER_URL=\nWORKER_API_KEY=\nAPI_HOST=127.0.0.1\nAPI_PORT=8000\n',
      'utf8',
    )
    bootLog('created empty user env template')
  }
  return target
}

function isAPIUp() {
  return new Promise((resolve) => {
    const req = http.get(`${API_URL}/health`, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(800, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function startAPIProcess() {
  if (!runtimePaths) runtimePaths = resolveRuntimePaths()
  const { pythonExe, apiDir, envExample, apiLogPath } = runtimePaths

  fs.mkdirSync(path.dirname(apiLogPath), { recursive: true })
  const logStream = fs.createWriteStream(apiLogPath, { flags: 'a' })

  bootLog(`spawn python ${pythonExe} cwd=${apiDir}`)
  logStream.write(`\n--- ${new Date().toISOString()} python=${pythonExe} ---\n`)

  if (!fs.existsSync(pythonExe)) {
    bootLog(`python missing: ${pythonExe}`)
    logStream.write(`Python no encontrado: ${pythonExe}\n`)
    logStream.end()
    return
  }

  const childEnv = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
  }
  if (app.isPackaged) {
    childEnv.TINTORERIA_ENV = ensureUserEnv(envExample)
  }

  apiProcess = spawn(pythonExe, ['-u', 'main.py'], {
    cwd: apiDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: childEnv,
  })

  const pipe = (chunk) => {
    try { logStream.write(chunk) } catch { /* ignore */ }
  }

  apiProcess.stdout.on('data', pipe)
  apiProcess.stderr.on('data', pipe)
  apiProcess.on('error', (err) => {
    bootLog(`python error ${err.message}`)
    try { logStream.write(`No se pudo arrancar Python: ${err.message}\n`) } catch { /* ignore */ }
  })
  apiProcess.on('close', (code) => {
    bootLog(`python exit ${code}`)
    try { logStream.end() } catch { /* ignore */ }
  })
}

function startupErrorMessage() {
  if (!runtimePaths) runtimePaths = resolveRuntimePaths()
  const lines = [
    'No se pudo conectar con el servidor Python.',
    '',
  ]
  if (app.isPackaged) {
    lines.push(`Logs: ${bootLogPath()}`)
    lines.push(`API: ${runtimePaths.apiLogPath}`)
    lines.push(`Config: ${userEnvPath()}`)
    lines.push('')
    lines.push('Completa WORKER_URL y WORKER_API_KEY en el archivo .env de AppData.')
  } else {
    lines.push('Revisa api\\startup.log o la ventana "API Tintoreria".')
  }
  return lines.join('\n')
}

function waitForAPI(retries = 90, delay = 1000) {
  return new Promise((resolve, reject) => {
    const attempt = async (remaining) => {
      if (await isAPIUp()) {
        resolve()
        return
      }
      if (remaining <= 0) {
        reject(new Error('API no disponible'))
        return
      }
      setTimeout(() => attempt(remaining - 1), delay)
    }
    attempt(retries)
  })
}

function reloadUI() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  bootLog('reload UI')
  mainWindow.webContents.reloadIgnoringCache()
}

function setupAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Ver',
      submenu: [
        { label: 'Recargar pantalla', accelerator: 'F5', click: reloadUI },
        { label: 'Recargar', accelerator: 'CmdOrCtrl+R', click: reloadUI },
        { type: 'separator' },
        {
          label: 'Herramientas de desarrollo',
          accelerator: 'F12',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.toggleDevTools()
            }
          },
        },
      ],
    },
  ]))
}

function setupLiveReload() {
  if (!IS_DEV) return
  const srcDir = path.join(__dirname, 'src')
  let timer = null
  try {
    fs.watch(srcDir, { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(reloadUI, 300)
    })
    bootLog('live reload: ui/src')
  } catch (err) {
    bootLog(`live reload error ${err.message}`)
  }
}

function createWindow() {
  bootLog('createWindow')
  mainWindow = new BrowserWindow({
    width:     1280,
    height:    800,
    minWidth:  1024,
    minHeight: 600,
    frame:     true,
    show:      true,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      nodeIntegration:    false,
      contextIsolation:   true,
      preload:            path.join(__dirname, 'preload.js'),
      webSecurity:        true,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))
  startupDone = true

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = String(input.key || '').toUpperCase()
    if (key === 'F5' || ((input.control || input.meta) && key === 'R')) {
      event.preventDefault()
      reloadUI()
    }
    if (key === 'F12') {
      event.preventDefault()
      mainWindow.webContents.toggleDevTools()
    }
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    bootLog(`did-fail-load ${code} ${desc}`)
  })

  mainWindow.once('ready-to-show', () => {
    bootLog('main ready-to-show')
    mainWindow.show()
    mainWindow.focus()
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.close()
      loadingWindow = null
    }
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function getMainWindow() {
  return mainWindow
}

function initUpdater() {
  if (!app.isPackaged || autoUpdater) return
  autoUpdater = setupAutoUpdater({ getMainWindow, bootLog })
}

ipcMain.handle('updater-is-available', () => app.isPackaged)
ipcMain.handle('app-get-version', () => app.getVersion())

ipcMain.handle('updater-check', async () => {
  if (!app.isPackaged) {
    return { ok: false, error: 'Las actualizaciones solo estan disponibles en la app instalada.' }
  }
  initUpdater()
  try {
    const result = await autoUpdater.checkForUpdates()
    return { ok: true, updateInfo: result?.updateInfo ?? null }
  } catch (err) {
    bootLog(`updater check failed ${err.message}`)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('updater-download', async () => {
  if (!app.isPackaged || !autoUpdater) {
    return { ok: false, error: 'No hay actualizacion pendiente.' }
  }
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    bootLog(`updater download failed ${err.message}`)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('updater-install', () => {
  if (!app.isPackaged || !autoUpdater) return { ok: false }
  // isSilent=true → NSIS /S + --updated (sin asistente de instalación)
  autoUpdater.quitAndInstall(true, true)
  return { ok: true }
})

ipcMain.handle('get-api-url', () => API_URL)

ipcMain.handle('open-external', (_event, url) => {
  if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
    shell.openExternal(url)
  }
})

ipcMain.handle('show-message-box', (_event, options) => {
  return dialog.showMessageBox(mainWindow, options)
})

bootLog('electron.js loaded')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
if (IS_DEV) app.commandLine.appendSwitch('disable-http-cache')

app.whenReady().then(async () => {
  bootLog('whenReady')
  runtimePaths = resolveRuntimePaths()
  setupAppMenu()
  setupLiveReload()

  loadingWindow = new BrowserWindow({
    width: 480, height: 280,
    frame: false, resizable: false,
    show: true,
    alwaysOnTop: true,
    backgroundColor: '#0f172a',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  loadingWindow.loadFile(path.join(__dirname, 'src', 'loading.html'))
  loadingWindow.show()

  try {
    const alreadyUp = await isAPIUp()
    bootLog(`api alreadyUp=${alreadyUp}`)
    if (!alreadyUp) {
      startAPIProcess()
      await waitForAPI(90, 1000)
    }
    bootLog('api ready, opening main window')
    createWindow()
  } catch (err) {
    bootLog(`startup failed ${err.message}`)
    dialog.showErrorBox('Error de inicio', startupErrorMessage())
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (!startupDone) return
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('will-quit', () => {
  bootLog('will-quit')
  if (apiProcess) {
    apiProcess.kill()
    apiProcess = null
  }
})
