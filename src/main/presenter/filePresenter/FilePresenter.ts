import logger from '@shared/logger'
import { app, clipboard, dialog, nativeImage, net } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { BaseFileAdapter } from './BaseFileAdapter'
import { FileAdapterConstructor } from './FileAdapterConstructor'
import { FileOperation, IConfigPresenter } from '../../../shared/presenter'
import { detectMimeType, getMimeTypeAdapterMap } from './mime'
import { IFilePresenter } from '../../../shared/presenter'
import { MessageFile } from '@shared/chat'
import { approximateTokenSize } from 'tokenx'
import { ImageFileAdapter } from './ImageFileAdapter'
import { nanoid } from 'nanoid'
import { DirectoryAdapter } from './DirectoryAdapter'
import { UnsupportFileAdapter } from './UnsupportFileAdapter'
import {
  FileValidationService,
  FileValidationResult,
  IFileValidationService
} from './FileValidationService'

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

export class FilePresenter implements IFilePresenter {
  private userDataPath: string
  private configPresenter: IConfigPresenter
  private tempDir: string
  private fileValidationService: IFileValidationService

  get maxFileSize(): number {
    return this.configPresenter.getSetting<number>('maxFileSize') ?? 1024 * 1024 * 30 //30MB
  }

  constructor(configPresenter: IConfigPresenter, fileValidationService?: IFileValidationService) {
    this.userDataPath = app.getPath('userData')
    this.tempDir = path.join(this.userDataPath, 'temp')
    this.configPresenter = configPresenter
    this.fileValidationService = fileValidationService || new FileValidationService()
    // Ensure temp directory exists
    try {
      const mkdirResult = fs.mkdir(this.tempDir, { recursive: true })
      if (mkdirResult && typeof mkdirResult.catch === 'function') {
        mkdirResult.catch(console.error)
      }
    } catch (error) {
      console.error('Failed to create temp directory:', error)
    }
  }

  async getMimeType(filePath: string): Promise<string> {
    return detectMimeType(filePath)
  }

  async readFile(relativePath: string): Promise<string> {
    const fullPath = await this.resolveUserDataReadPath(relativePath)
    return fs.readFile(fullPath, 'utf-8')
  }

  async writeFile(operation: FileOperation): Promise<void> {
    const fullPath = path.join(this.userDataPath, operation.path)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, operation.content || '', 'utf-8')
  }

  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = path.join(this.userDataPath, relativePath)
    await fs.unlink(fullPath)
  }

  async createFileAdapter(filePath: string, typeInfo?: string): Promise<BaseFileAdapter> {
    // Use the refined getMimeType method
    // Prioritize provided typeInfo if available
    const mimeType = typeInfo ?? (await this.getMimeType(filePath))

    if (!mimeType) {
      // This case should be less likely now, but handle it defensively
      throw new Error(`Could not determine MIME type for file: ${filePath}`)
    }

    logger.info(`Using MIME type: ${mimeType} for file: ${filePath}`)

    const adapterMap = getMimeTypeAdapterMap()
    const AdapterConstructor = this.findAdapterForMimeType(mimeType, adapterMap)
    if (!AdapterConstructor) {
      // If no specific or wildcard adapter found, maybe use a generic default?
      // For now, we throw an error as before, but with the determined type.
      throw new Error(
        `No adapter found for file "${filePath}" with determined mime type "${mimeType}"`
      )
    }

    return new AdapterConstructor(filePath, this.maxFileSize)
  }

  async prepareDirectory(absPath: string): Promise<MessageFile> {
    const fullPath = path.join(absPath)
    const adapter = new DirectoryAdapter(fullPath)
    await adapter.processDirectory()
    return {
      name: adapter.dirMetaData?.dirName ?? '',
      token: approximateTokenSize(adapter.dirMetaData?.dirName ?? ''),
      path: adapter.dirPath,
      mimeType: 'directory',
      metadata: {
        fileName: adapter.dirMetaData?.dirName ?? '',
        fileSize: 0,
        fileDescription: 'directory',
        fileCreated: adapter.dirMetaData?.dirCreated ?? new Date(),
        fileModified: adapter.dirMetaData?.dirModified ?? new Date()
      },
      thumbnail: '',
      content: ''
    }
  }

  /**
   * Prepare file and return a complete MessageFile object, supporting different contentType (compatible with legacy method calls)
   * @param absPath
   * @param typeInfo
   * @param contentType
   * @returns
   */
  async prepareFileCompletely(
    absPath: string,
    typeInfo?: string,
    contentType?: null | 'origin' | 'llm-friendly'
  ): Promise<MessageFile> {
    const fullPath = path.join(absPath)
    try {
      const adapter = await this.createFileAdapter(fullPath, typeInfo)
      logger.info('adapter', adapter)
      if (adapter) {
        await adapter.processFile()
        let content
        switch (contentType) {
          case 'llm-friendly':
            content = await adapter.getLLMContent()
            break
          case 'origin':
            content = await adapter.getContent()
            break
          default:
            content = null
            break
        }
        const thumbnail = adapter.getThumbnail ? await adapter.getThumbnail() : undefined
        const result = {
          name: adapter.fileMetaData?.fileName ?? '',
          token:
            adapter.mimeType && adapter.mimeType.startsWith('image')
              ? calculateImageTokens(adapter as ImageFileAdapter)
              : adapter.mimeType && adapter.mimeType.startsWith('audio')
                ? approximateTokenSize(`Audio file path: ${adapter.filePath}`)
                : approximateTokenSize(content || ''),
          path: adapter.filePath,
          mimeType: adapter.mimeType ?? '',
          metadata: adapter.fileMetaData ?? {
            fileName: '',
            fileSize: 0,
            fileDescription: '',
            fileCreated: new Date(),
            fileModified: new Date()
          },
          thumbnail: thumbnail,
          content: content || ''
        }
        return result
      } else {
        throw new Error(`Can not create file adapter: ${fullPath}`)
      }
    } catch (error) {
      // Clean up temp file in case of error
      console.error(error)
      throw new Error(`Can not read file: ${fullPath}`)
    }
  }

  async prepareFile(absPath: string, typeInfo?: string): Promise<MessageFile> {
    return this.prepareFileCompletely(absPath, typeInfo, 'llm-friendly')
  }

  private findAdapterForMimeType(
    mimeType: string,
    adapterMap: Map<string, FileAdapterConstructor>
  ): FileAdapterConstructor | undefined {
    // First try exact match - must do exact match first, e.g. text/* defaults to Text Adapter, but text/csv is not
    const exactMatch = adapterMap.get(mimeType)
    if (exactMatch) {
      return exactMatch
    }

    // Try wildcard match
    const type = mimeType.split('/')[0]
    const wildcardMatch = adapterMap.get(`${type}/*`)

    if (wildcardMatch) {
      return wildcardMatch
    }

    return UnsupportFileAdapter
  }

  async writeTemp(file: { name: string; content: string | Buffer | ArrayBuffer }): Promise<string> {
    const ext = path.extname(file.name)
    const tempName = `${nanoid()}${ext || '.tmp'}` // Add .tmp extension if original name has none
    const tempPath = path.join(this.tempDir, tempName)
    // Check if content is binary (Buffer or ArrayBuffer) or string
    if (typeof file.content === 'string') {
      await fs.writeFile(tempPath, file.content, 'utf-8')
    } else if (Buffer.isBuffer(file.content)) {
      // If it's already a Buffer, write it directly
      await fs.writeFile(tempPath, file.content)
    } else {
      // Otherwise, assume it's ArrayBuffer and convert to Buffer
      await fs.writeFile(tempPath, Buffer.from(file.content))
    }

    return tempPath
  }

  async writeImageBase64(file: { name: string; content: string }): Promise<string> {
    // Check if it's base64 format image data
    if (!file.content.startsWith('data:image/')) {
      throw new Error('Invalid image base64 data')
    }

    // Extract actual image data from base64 string
    const base64Data = file.content.split(',')[1]
    if (!base64Data) {
      throw new Error('Invalid base64 image format')
    }

    // Convert base64 to binary data
    const binaryData = Buffer.from(base64Data, 'base64')

    // Get file extension
    const mimeMatch = file.content.match(/^data:image\/([a-zA-Z0-9]+);base64,/)
    const ext = mimeMatch ? `.${mimeMatch[1].toLowerCase()}` : '.png'

    // Generate temporary filename
    const tempName = `${nanoid()}${ext}`
    const tempPath = path.join(this.tempDir, tempName)

    // Write file
    await fs.writeFile(tempPath, binaryData)

    return tempPath
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
    const cacheDir = path.join(app.getPath('userData'), 'images')
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

  async isDirectory(absPath: string): Promise<boolean> {
    try {
      const fullPath = path.join(absPath)
      const stats = await fs.stat(fullPath)
      return stats.isDirectory()
    } catch {
      // If the path doesn't exist or there's any other error, return false
      return false
    }
  }

  /**
   * Validates if a file is supported for knowledge base processing
   * @param filePath Path to the file to validate
   * @returns FileValidationResult with validation details
   */
  async validateFileForKnowledgeBase(filePath: string): Promise<FileValidationResult> {
    try {
      return await this.fileValidationService.validateFile(filePath)
    } catch (error) {
      console.error('Error validating file for knowledge base:', error)
      return {
        isSupported: false,
        error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        suggestedExtensions: this.fileValidationService.getSupportedExtensions()
      }
    }
  }

  /**
   * Gets all supported file extensions for knowledge base processing
   * @returns Array of supported file extensions (without dots)
   */
  getSupportedExtensions(): string[] {
    try {
      return this.fileValidationService.getSupportedExtensions()
    } catch (error) {
      console.error('Error getting supported extensions:', error)
      // Return fallback extensions if service fails
      return [
        'txt',
        'md',
        'markdown',
        'pdf',
        'rtf',
        'docx',
        'docm',
        'dotx',
        'dotm',
        'pptx',
        'pptm',
        'ppsx',
        'ppsm',
        'xlsx',
        'xls',
        'xlsm',
        'xlsb',
        'ods',
        'odt',
        'odp',
        'csv',
        'tsv',
        'json',
        'yaml',
        'yml',
        'xml',
        'js',
        'ts',
        'py',
        'java',
        'cpp',
        'c',
        'h',
        'css',
        'html'
      ].sort()
    }
  }

  private async resolveUserDataReadPath(relativePath: string): Promise<string> {
    const normalizedPath = relativePath.trim()
    if (!normalizedPath) {
      throw new Error('File path is required')
    }

    if (path.isAbsolute(normalizedPath)) {
      throw new Error('Absolute paths are not allowed')
    }

    const basePath = await fs
      .realpath(this.userDataPath)
      .catch(() => path.resolve(this.userDataPath))
    const candidatePath = path.resolve(this.userDataPath, normalizedPath)
    const resolvedPath = await fs.realpath(candidatePath).catch(() => candidatePath)
    const relativeToBase = path.relative(basePath, resolvedPath)

    if (
      relativeToBase !== '' &&
      (relativeToBase.startsWith('..') || path.isAbsolute(relativeToBase))
    ) {
      throw new Error('File path escapes user data directory')
    }

    return resolvedPath
  }
}

function calculateImageTokens(adapter: ImageFileAdapter): number {
  // Method 1: Based on image dimensions
  const pixelBasedTokens = Math.round(
    ((adapter.imageMetadata.compressWidth ?? adapter.imageMetadata.width ?? 1) *
      (adapter.imageMetadata.compressHeight ?? adapter.imageMetadata.height ?? 1)) /
      750
  )
  return pixelBasedTokens
}
