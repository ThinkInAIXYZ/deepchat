import { clipboard, dialog, nativeImage, net } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

type SaveImageInput = {
  source: string
  mimeType?: string
  suggestedName?: string
}

type ResolvedImageData = {
  data: Buffer
  mimeType: string
}

const IMAGE_SAVE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico']
const INVALID_FILE_NAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

function normalizeImageMimeType(mimeType?: string): string | null {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase()
  if (!normalized?.startsWith('image/')) {
    return null
  }
  return normalized
}

function getImageExtensionFromMimeType(mimeType?: string): string {
  const normalized = normalizeImageMimeType(mimeType)
  if (!normalized) {
    return 'png'
  }

  switch (normalized) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/svg+xml':
      return 'svg'
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return 'ico'
    default:
      return normalized.replace('image/', '').replace(/[^a-z0-9]/g, '') || 'png'
  }
}

function inferImageMimeTypeFromPath(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    case '.avif':
      return 'image/avif'
    case '.ico':
      return 'image/x-icon'
    default:
      return null
  }
}

function sanitizeFileName(fileName?: string): string | null {
  const sanitized = fileName
    ?.split('')
    .map((char) => (INVALID_FILE_NAME_CHARS.has(char) || char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()

  return sanitized || null
}

function formatImageTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function buildDefaultImageName(mimeType: string, suggestedName?: string): string {
  const extension = getImageExtensionFromMimeType(mimeType)
  const sanitizedName = sanitizeFileName(suggestedName)
  if (sanitizedName) {
    return path.extname(sanitizedName) ? sanitizedName : `${sanitizedName}.${extension}`
  }

  return `deepchat-image-${formatImageTimestamp(new Date())}.${extension}`
}

export class DesktopImageActions {
  constructor(private readonly userDataPath: string) {
    if (!path.isAbsolute(userDataPath)) throw new Error('Image profile directory must be absolute')
  }

  async saveImage(file: SaveImageInput): Promise<{ canceled: boolean; path?: string }> {
    const image = await this.resolveImageData(file)
    const defaultPath = buildDefaultImageName(image.mimeType, file.suggestedName)

    const preferredExtension = getImageExtensionFromMimeType(image.mimeType)
    const extensions = Array.from(new Set([preferredExtension, ...IMAGE_SAVE_EXTENSIONS]))
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath,
      filters: [
        { name: 'Images', extensions },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (canceled || !filePath) {
      return { canceled: true }
    }

    await fs.writeFile(filePath, image.data)
    return { canceled: false, path: filePath }
  }

  async copyImage(file: SaveImageInput): Promise<{ copied: boolean }> {
    const image = await this.resolveImageData(file)
    const clipboardImage = this.createClipboardImage(image)
    clipboard.writeImage(clipboardImage)
    return { copied: true }
  }

  private async resolveImageData(file: SaveImageInput): Promise<ResolvedImageData> {
    const source = file.source.trim()
    if (source.startsWith('data:image/')) {
      return this.resolveDataUrlImage(source)
    }

    if (source.startsWith('imgcache://')) {
      return this.resolveCachedImage(source)
    }

    if (source.startsWith('http://') || source.startsWith('https://')) {
      return this.resolveRemoteImage(source, file.mimeType)
    }

    return this.resolveRawBase64Image(source, file.mimeType)
  }

  private resolveDataUrlImage(source: string): ResolvedImageData {
    const match = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s)
    const mimeType = normalizeImageMimeType(match?.[1])
    const base64Data = match?.[2]?.replace(/\s/g, '')

    if (!mimeType || !base64Data) {
      throw new Error('Invalid image data URL')
    }

    const data = Buffer.from(base64Data, 'base64')
    if (data.length === 0) {
      throw new Error('Invalid image data URL')
    }

    return { data, mimeType }
  }

  private async resolveCachedImage(source: string): Promise<ResolvedImageData> {
    const cacheDir = path.join(this.userDataPath, 'images')
    const rawCachePath = source.slice('imgcache://'.length)
    const cachePath = this.safeDecodePath(rawCachePath)
    const fullPath = path.resolve(cacheDir, cachePath)
    const relativePath = path.relative(cacheDir, fullPath)

    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('Invalid cached image path')
    }

    const mimeType = inferImageMimeTypeFromPath(fullPath)
    if (!mimeType) {
      throw new Error('Invalid cached image type')
    }

    return {
      data: await fs.readFile(fullPath),
      mimeType
    }
  }

  private async resolveRemoteImage(
    source: string,
    fallbackMimeType?: string
  ): Promise<ResolvedImageData> {
    const url = new URL(source)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported image URL')
    }

    const response = await net.fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`)
    }

    const responseMimeType = normalizeImageMimeType(
      response.headers.get('content-type') ?? undefined
    )
    const mimeType =
      responseMimeType ||
      normalizeImageMimeType(fallbackMimeType) ||
      inferImageMimeTypeFromPath(url.pathname)

    if (!mimeType) {
      throw new Error('Remote URL is not an image')
    }

    return {
      data: Buffer.from(await response.arrayBuffer()),
      mimeType
    }
  }

  private resolveRawBase64Image(source: string, fallbackMimeType?: string): ResolvedImageData {
    const mimeType = normalizeImageMimeType(fallbackMimeType)
    if (!mimeType) {
      throw new Error('Raw image data requires an image MIME type')
    }

    const data = Buffer.from(source.replace(/\s/g, ''), 'base64')
    if (data.length === 0) {
      throw new Error('Invalid raw image data')
    }

    return { data, mimeType }
  }

  private createClipboardImage(image: ResolvedImageData): Electron.NativeImage {
    const imageFromBuffer = nativeImage.createFromBuffer(image.data)
    if (!imageFromBuffer.isEmpty()) {
      return imageFromBuffer
    }

    const dataUrl = `data:${image.mimeType};base64,${image.data.toString('base64')}`
    const imageFromDataUrl = nativeImage.createFromDataURL(dataUrl)
    if (!imageFromDataUrl.isEmpty()) {
      return imageFromDataUrl
    }

    throw new Error('Image data cannot be copied to clipboard')
  }

  private safeDecodePath(filePath: string): string {
    try {
      return decodeURIComponent(filePath)
    } catch {
      return filePath
    }
  }
}
