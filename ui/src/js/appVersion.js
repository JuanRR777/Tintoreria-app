let cachedVersion = null

export async function getAppVersion() {
  if (cachedVersion) return cachedVersion
  if (window.electron?.updates?.getVersion) {
    try {
      cachedVersion = await window.electron.updates.getVersion()
      return cachedVersion || '—'
    } catch {
      cachedVersion = '—'
      return cachedVersion
    }
  }
  cachedVersion = null
  return 'desarrollo'
}

export function formatVersionLabel(version) {
  if (!version || version === 'desarrollo') return 'Modo desarrollo'
  return `Version ${version}`
}

export async function refreshVersionLabels() {
  const version = await getAppVersion()
  const text = formatVersionLabel(version)
  document.querySelectorAll('[data-app-version]').forEach((el) => {
    el.textContent = text
    el.setAttribute('title', text)
  })
}
