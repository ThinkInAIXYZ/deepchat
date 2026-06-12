import path from 'path'
import {
  clipboard,
  contextBridge,
  nativeImage,
  webUtils,
  webFrame,
  ipcRenderer,
  shell
} from 'electron'
import { exposeElectronAPI } from '@electron-toolkit/preload'
import { normalizeExternalUrl } from '@shared/externalUrl'
import { createBridge } from './createBridge'

const isDevHiddenApiEnabled =
  process.env.NODE_ENV === 'development' || Boolean(process.env.ELECTRON_RENDERER_URL)
const DEV_WELCOME_OVERRIDE_KEY = '__deepchat_dev_force_welcome'

// Cache variables
let cachedWindowId: number | undefined = undefined
let cachedWebContentsId: number | undefined = undefined

// Custom APIs for renderer
const api = Object.freeze({
  copyText: (text: string) => {
    clipboard.writeText(text)
  },
  copyImage: (image: string) => {
    const img = nativeImage.createFromDataURL(image)
    clipboard.writeImage(img)
  },
  readClipboardText: () => {
    return clipboard.readText()
  },
  getPathForFile: (file: File) => {
    return webUtils.getPathForFile(file)
  },
  getWindowId: () => {
    if (cachedWindowId !== undefined) {
      return cachedWindowId
    }
    cachedWindowId = ipcRenderer.sendSync('get-window-id')
    return cachedWindowId
  },
  getWebContentsId: () => {
    if (cachedWebContentsId !== undefined) {
      return cachedWebContentsId
    }
    cachedWebContentsId = ipcRenderer.sendSync('get-web-contents-id')
    return cachedWebContentsId
  },
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

exposeElectronAPI()

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
  cachedWebContentsId = ipcRenderer.sendSync('get-web-contents-id')
  cachedWindowId = ipcRenderer.sendSync('get-window-id')
  console.log(
    'Preload: Initialized with WebContentsId:',
    cachedWebContentsId,
    'WindowId:',
    cachedWindowId
  )
  webFrame.setVisualZoomLevelLimits(1, 1) // Disable trackpad zooming
  webFrame.setZoomFactor(1)
})
