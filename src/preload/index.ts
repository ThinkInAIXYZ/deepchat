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

// Cache variables
let cachedWindowId: number | undefined = undefined
let cachedWebContentsId: number | undefined = undefined

// Custom APIs for renderer
const api = {
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
    return shell.openExternal(url)
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
    if (/\s/.test(filePath)) {
      return `"${filePath}"`
    }
    return filePath
  }
}
exposeElectronAPI()

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Preload: Failed to expose API via contextBridge:', error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
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
