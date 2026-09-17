const { autoUpdater } = require('electron-updater')

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function setupAutoUpdater({ getMainWindow, bootLog }) {
  const log = (msg) => {
    if (bootLog) bootLog(`updater: ${msg}`)
  }

  const send = (payload) => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-status', payload)
    }
  }

  autoUpdater.on('checking-for-update', () => {
    log('checking')
    send({ phase: 'checking' })
  })

  autoUpdater.on('update-not-available', (info) => {
    log('not available')
    send({ phase: 'not-available', version: info?.version })
  })

  autoUpdater.on('update-available', (info) => {
    log(`available ${info?.version}`)
    send({
      phase: 'available',
      version: info?.version,
      releaseNotes: info?.releaseNotes,
    })
  })

  autoUpdater.on('error', (err) => {
    log(`error ${err.message}`)
    send({ phase: 'error', message: err.message })
  })

  autoUpdater.on('download-progress', (progress) => {
    send({
      phase: 'progress',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    log(`downloaded ${info?.version}`)
    send({ phase: 'downloaded', version: info?.version })
  })

  return autoUpdater
}

module.exports = { setupAutoUpdater }
