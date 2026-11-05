import { clipboard, nativeImage } from 'electron'
import type { ClipboardHost } from '../clipboardHost'

export const electronClipboardHost: ClipboardHost = {
  readText(): string {
    return clipboard.readText()
  },

  writeText(text: string): void {
    clipboard.writeText(text)
  },

  writeImageDataUrl(dataUrl: string): void {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) {
      throw new Error('Image data cannot be copied to clipboard')
    }
    clipboard.writeImage(image)
  },

  writeImageBytes(bytes: Buffer, mimeType: string): void {
    const fromBuffer = nativeImage.createFromBuffer(bytes)
    if (!fromBuffer.isEmpty()) {
      clipboard.writeImage(fromBuffer)
      return
    }

    const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`
    const fromDataUrl = nativeImage.createFromDataURL(dataUrl)
    if (fromDataUrl.isEmpty()) {
      throw new Error('Image data cannot be copied to clipboard')
    }
    clipboard.writeImage(fromDataUrl)
  }
}
