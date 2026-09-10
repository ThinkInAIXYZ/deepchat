import { ClipboardItem, clipboard, nativeImage, type IpcMain } from 'electron'
import { CLIPBOARD_IPC_CHANNELS } from '@shared/clipboardChannels'

// Electron 44 removed the clipboard module from renderer processes (including
// non-sandboxed preloads), so the preload `api` bridges copy/read through these
// main-process handlers.
export function registerClipboardIpc(ipcMain: IpcMain): void {
  ipcMain.handle(CLIPBOARD_IPC_CHANNELS.WRITE_TEXT, (_event, text: string) =>
    clipboard.writeText(text)
  )

  ipcMain.handle(CLIPBOARD_IPC_CHANNELS.WRITE_IMAGE, (_event, dataUrl: string) => {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) {
      throw new Error('Image data cannot be copied to clipboard')
    }
    const pngBlob = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' })
    return clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
  })

  ipcMain.handle(CLIPBOARD_IPC_CHANNELS.READ_TEXT, () => clipboard.readText())
}
