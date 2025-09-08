import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'

import { BaseFileAdapter } from './BaseFileAdapter'
import { FileAdapterConstructor } from './FileAdapterConstructor'
import { FileOperation } from '../../../shared/presenter'
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

export class FilePresenter implements IFilePresenter {
  private userDataPath: string
  private maxFileSize: number = 1024 * 1024 * 30 // 30 MB
  private tempDir: string
  private fileValidationService: IFileValidationService

  constructor(fileValidationService?: IFileValidationService) {
    this.userDataPath = app.getPath('userData')
    this.tempDir = path.join(this.userDataPath, 'temp')
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
    const fullPath = path.join(this.userDataPath, relativePath)
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

    console.log(`Using MIME type: ${mimeType} for file: ${filePath}`)

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
      console.log('adapter', adapter)
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
        'docx',
        'pptx',
        'xlsx',
        'csv',
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
