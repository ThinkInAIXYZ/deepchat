import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { browserActivityChangedEvent } from '@shared/contracts/events'
import type { YoBrowserActivityPayload } from '@shared/types/browser'

const browserOverlayApi = Object.freeze({
  onActivityChanged: (callback: (payload: YoBrowserActivityPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => {
      const result = browserActivityChangedEvent.payload.safeParse(payload)
      if (!result.success) {
        console.warn('YoBrowserOverlayPreload: Ignoring invalid browser activity payload')
        return
      }

      callback(result.data)
    }

    ipcRenderer.on(browserActivityChangedEvent.name, listener)
    return () => {
      ipcRenderer.removeListener(browserActivityChangedEvent.name, listener)
    }
  }
})

if (!process.contextIsolated) {
  throw new Error('YoBrowser overlay preload requires contextIsolation')
}

contextBridge.exposeInMainWorld('yoBrowserOverlay', browserOverlayApi)
