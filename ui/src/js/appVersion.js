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
  return `Versión ${version}`
}

export function formatVersionShort(version) {
  if (!version || version === 'desarrollo') return 'dev'
  return `v ${version}`
}

export async function refreshVersionLabels() {
  const version = await getAppVersion()
  const text = formatVersionLabel(version)
  const short = formatVersionShort(version)
  document.querySelectorAll('[data-app-version]').forEach((el) => {
    el.textContent = text
    el.setAttribute('title', text)
  })
  document.querySelectorAll('[data-app-version-short]').forEach((el) => {
    el.textContent = short
    el.setAttribute('title', text)
  })
}
