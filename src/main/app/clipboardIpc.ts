import type { IpcMain } from 'electron'
import { clipboardHost } from '@/platform/clipboardHost'
import { CLIPBOARD_IPC_CHANNELS } from '@shared/clipboardChannels'
import type { AuthorizeRendererIpc } from './rendererIpcSecurity'

// Electron 44 will remove the clipboard module from renderer processes
// (including non-sandboxed preloads), so the preload `api` already bridges
// copy/read through these main-process handlers.
export function registerClipboardIpc(ipcMain: IpcMain, authorize: AuthorizeRendererIpc): void {
  ipcMain.handle(CLIPBOARD_IPC_CHANNELS.WRITE_TEXT, (event, text: string) => {
    authorize(event)
    clipboardHost.writeText(text)
  })

  ipcMain.handle(CLIPBOARD_IPC_CHANNELS.WRITE_IMAGE, (event, dataUrl: string) => {
    authorize(event)
    clipboardHost.writeImageDataUrl(dataUrl)
  })

  ipcMain.handle(CLIPBOARD_IPC_CHANNELS.READ_TEXT, (event) => {
    authorize(event)
    return clipboardHost.readText()
  })
}
