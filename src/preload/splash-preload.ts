import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { createBridge } from './createBridge'
import { createSplashApi } from './splashApi'
import { configGetLanguageRoute } from '@shared/contracts/routes/config.routes'

const bridge = createBridge(ipcRenderer)
const splashApi = createSplashApi({
  on: (channel, listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => {
      listener(payload)
    }
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  send: (channel, payload) => {
    ipcRenderer.send(channel, payload)
  },
  getLanguageState: async () => await bridge.invoke(configGetLanguageRoute.name, {})
})

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('deepchatSplash', splashApi)
} else {
  // @ts-ignore (defined for the splash renderer)
  window.deepchatSplash = splashApi
}

window.addEventListener('DOMContentLoaded', () => {
  webFrame.setVisualZoomLevelLimits(1, 1)
  webFrame.setZoomFactor(1)
})
