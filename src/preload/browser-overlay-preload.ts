import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { browserActivityChangedEvent } from '@shared/contracts/events'
import type { YoBrowserActivityPayload } from '@shared/types/browser'

const browserOverlayApi = Object.freeze({
  onActivityChanged: (callback: (payload: YoBrowserActivityPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: YoBrowserActivityPayload) => {
      callback(payload)
    }

    ipcRenderer.on(browserActivityChangedEvent.name, listener)
    return () => {
      ipcRenderer.removeListener(browserActivityChangedEvent.name, listener)
    }
  }
})

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('yoBrowserOverlay', browserOverlayApi)
} else {
  // @ts-ignore Defined for the dedicated browser overlay renderer.
  window.yoBrowserOverlay = browserOverlayApi
}
