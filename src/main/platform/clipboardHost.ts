/**
 * Clipboard boundary.
 *
 * The renderer copies text and images through main-process handlers, and the
 * file service copies a saved image. Electron has `clipboard` plus
 * `nativeImage`; mygo has `Clipboard.Write` with `transfer` formats, so this
 * boundary takes bytes and data URLs and leaves decoding to the host.
 */
export interface ClipboardHost {
  readText(): string
  writeText(text: string): void
  /** Writes an image from a `data:` URL. Throws when the payload is not an image. */
  writeImageDataUrl(dataUrl: string): void
  /** Writes an image from raw bytes, falling back to a data URL when needed. */
  writeImageBytes(bytes: Buffer, mimeType: string): void
}

export { electronClipboardHost as clipboardHost } from './electron/clipboardHost'
