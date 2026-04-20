import type { ElectronAPI } from '@electron-toolkit/preload'

type LegacyIpcRenderer = ElectronAPI['ipcRenderer']
type LegacyIpcListener = (...args: any[]) => void

type LegacyIpcRegistration = {
  channel: string
  listener: LegacyIpcListener
}

function getLegacyApi() {
  return typeof window === 'undefined' ? null : (window.api ?? null)
}

export function getLegacyIpcRenderer(): LegacyIpcRenderer | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.electron?.ipcRenderer ?? null
}

export function hasLegacyIpcRenderer() {
  return getLegacyIpcRenderer() != null
}

export function getLegacyWindowId(): number | null {
  try {
    return getLegacyApi()?.getWindowId?.() ?? null
  } catch (error) {
    console.warn('Failed to read window id:', error)
    return null
  }
}

export function getLegacyWebContentsId(): number | null {
  try {
    return getLegacyApi()?.getWebContentsId?.() ?? null
  } catch (error) {
    console.warn('Failed to read webContents id:', error)
    return null
  }
}

export function copyLegacyText(text: string) {
  getLegacyApi()?.copyText?.(text)
}

export function copyLegacyImage(image: string) {
  getLegacyApi()?.copyImage?.(image)
}

export function readLegacyClipboardText() {
  return getLegacyApi()?.readClipboardText?.() ?? ''
}

export function getLegacyPathForFile(file: File) {
  return getLegacyApi()?.getPathForFile?.(file) ?? ''
}

export async function openLegacyExternal(url: string) {
  const api = getLegacyApi()
  if (!api?.openExternal) {
    throw new Error('window.api.openExternal is not available')
  }

  await api.openExternal(url)
}

export function toLegacyRelativePath(filePath: string, baseDir?: string) {
  return getLegacyApi()?.toRelativePath?.(filePath, baseDir) ?? filePath
}

export function formatLegacyPathForInput(filePath: string) {
  return getLegacyApi()?.formatPathForInput?.(filePath) ?? filePath
}

export function onLegacyIpcChannel(channel: string, listener: LegacyIpcListener) {
  const ipcRenderer = getLegacyIpcRenderer()
  if (!ipcRenderer) {
    return () => {}
  }

  ipcRenderer.on(channel, listener)

  return () => {
    if (typeof ipcRenderer.removeListener === 'function') {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

export function sendLegacyIpc(channel: string, ...args: unknown[]) {
  const ipcRenderer = getLegacyIpcRenderer()
  ipcRenderer?.send(channel, ...args)
}

export function createLegacyIpcSubscriptionScope() {
  const registrations: LegacyIpcRegistration[] = []

  const on = (channel: string, listener: LegacyIpcListener) => {
    const unsubscribe = onLegacyIpcChannel(channel, listener)
    registrations.push({ channel, listener })
    return unsubscribe
  }

  const cleanup = () => {
    const ipcRenderer = getLegacyIpcRenderer()
    if (!ipcRenderer) {
      registrations.length = 0
      return
    }

    for (const registration of registrations.splice(0)) {
      if (typeof ipcRenderer.removeListener === 'function') {
        ipcRenderer.removeListener(registration.channel, registration.listener)
      }
    }
  }

  return {
    on,
    cleanup
  }
}
