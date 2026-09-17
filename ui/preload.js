const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  getApiUrl:      ()        => ipcRenderer.invoke('get-api-url'),
  openExternal:   (url)     => ipcRenderer.invoke('open-external', url),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  updates: {
    isAvailable: () => ipcRenderer.invoke('updater-is-available'),
    getVersion:  () => ipcRenderer.invoke('app-get-version'),
    check:       () => ipcRenderer.invoke('updater-check'),
    download:    () => ipcRenderer.invoke('updater-download'),
    install:     () => ipcRenderer.invoke('updater-install'),
    onStatus:    (callback) => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('updater-status', listener)
      return () => ipcRenderer.removeListener('updater-status', listener)
    },
  },
})
