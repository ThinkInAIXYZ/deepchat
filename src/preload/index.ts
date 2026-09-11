import path from 'path'
import { contextBridge, ipcRenderer, webUtils, webFrame, shell } from 'electron'
import { CLIPBOARD_IPC_CHANNELS } from '@shared/clipboardChannels'
import { normalizeExternalUrl } from '@shared/externalUrl'
import { createBridge } from './createBridge'

const isDevHiddenApiEnabled =
  process.env.NODE_ENV === 'development' || Boolean(process.env.ELECTRON_RENDERER_URL)
const DEV_WELCOME_OVERRIDE_KEY = '__deepchat_dev_force_welcome'

// Electron 44 removed the clipboard module from renderer processes, so the
// clipboard APIs below are bridged to main-process handlers.
const reportClipboardError = (operation: string, error: unknown) => {
  console.error(`Failed to ${operation}:`, error)
}

const api = Object.freeze({
  copyText: (text: string) => {
    ipcRenderer
      .invoke(CLIPBOARD_IPC_CHANNELS.WRITE_TEXT, text)
      .catch((error) => reportClipboardError('copy text to the clipboard', error))
  },
  copyImage: (image: string) => {
    ipcRenderer
      .invoke(CLIPBOARD_IPC_CHANNELS.WRITE_IMAGE, image)
      .catch((error) => reportClipboardError('copy the image to the clipboard', error))
  },
  readClipboardText: () => {
    return ipcRenderer.invoke(CLIPBOARD_IPC_CHANNELS.READ_TEXT)
  },
  getPathForFile: (file: File) => {
    return webUtils.getPathForFile(file)
  },
  getPlatform: () => process.platform,
  getArch: () => process.arch,
  openExternal: (url: string) => {
    const externalUrl = normalizeExternalUrl(url)
    if (!externalUrl) {
      console.warn('Preload: Blocked openExternal for disallowed URL:', url)
      return Promise.reject(new Error('URL protocol not allowed'))
    }
    return shell.openExternal(externalUrl)
  },
  toRelativePath: (filePath: string, baseDir?: string) => {
    if (!baseDir) return filePath

    try {
      const relative = path.relative(baseDir, filePath)
      if (
        relative === '' ||
        (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
      ) {
        return relative
      }
    } catch (error) {
      console.warn('Preload: Failed to compute relative path', filePath, baseDir, error)
    }
    return filePath
  },
  formatPathForInput: (filePath: string) => {
    const containsSpace = /\s/.test(filePath)
    const hasDoubleQuote = filePath.includes('"')
    const hasSingleQuote = filePath.includes("'")

    if (!containsSpace && !hasDoubleQuote && !hasSingleQuote) {
      return filePath
    }

    // Prefer double quotes; escape any existing ones
    if (hasDoubleQuote) {
      const escaped = filePath.replace(/"/g, '\\"')
      return `"${escaped}"`
    }

    // Use double quotes when only spaces
    if (containsSpace) {
      return `"${filePath}"`
    }

    // Fallback: no spaces but contains single quotes
    return `'${filePath.replace(/'/g, `'\\''`)}'`
  }
})

const setDevWelcomeOverride = (enabled: boolean) => {
  try {
    if (enabled) {
      window.sessionStorage.setItem(DEV_WELCOME_OVERRIDE_KEY, '1')
    } else {
      window.sessionStorage.removeItem(DEV_WELCOME_OVERRIDE_KEY)
    }
  } catch (error) {
    console.warn('Preload: Failed to update dev welcome override:', error)
  }
}

const deepchatDevApi = isDevHiddenApiEnabled
  ? Object.freeze({
      goToWelcome: () => {
        setDevWelcomeOverride(true)
        window.location.hash = '/welcome'
        return true
      },
      clearWelcomeOverride: () => {
        setDevWelcomeOverride(false)
        return true
      }
    })
  : undefined
const deepchatBridge = Object.freeze(createBridge(ipcRenderer))

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('deepchat', deepchatBridge)
    if (deepchatDevApi) {
      contextBridge.exposeInMainWorld('__deepchatDev', deepchatDevApi)
    }
  } catch (error) {
    console.error('Preload: Failed to expose API via contextBridge:', error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.deepchat = deepchatBridge
  if (deepchatDevApi) {
    // @ts-ignore (define in dts)
    window.__deepchatDev = deepchatDevApi
  }
}
window.addEventListener('DOMContentLoaded', () => {
  webFrame.setVisualZoomLevelLimits(1, 1) // Disable trackpad zooming
  webFrame.setZoomFactor(1)
})
