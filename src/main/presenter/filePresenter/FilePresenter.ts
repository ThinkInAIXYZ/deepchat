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

export class FilePresenter implements IFilePresenter {
  private userDataPath: string
  private maxFileSize: number = 1024 * 1024 * 30 // 30 MB
  private tempDir: string

  constructor() {
    this.userDataPath = app.getPath('userData')
    this.tempDir = path.join(this.userDataPath, 'temp')
    // Ensure temp directory exists
    fs.mkdir(this.tempDir, { recursive: true }).catch(console.error)
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
   * 准备文件，返回一个完整的 MessageFile 对象，支持不同的 contentType（兼容旧方法调用）
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
                ? approximateTokenSize(`音频文件路径: ${adapter.filePath}`)
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
    // 首先尝试精确匹配，一定要先精确匹配，比如text/*默认是 Text Adapter，但是text/csv并不是
    const exactMatch = adapterMap.get(mimeType)
    if (exactMatch) {
      return exactMatch
    }

    // 尝试通配符匹配
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
    // 检查是否是base64格式的图片数据
    if (!file.content.startsWith('data:image/')) {
      throw new Error('Invalid image base64 data')
    }

    // 从base64字符串中提取实际的图片数据
    const base64Data = file.content.split(',')[1]
    if (!base64Data) {
      throw new Error('Invalid base64 image format')
    }

    // 将base64转换为二进制数据
    const binaryData = Buffer.from(base64Data, 'base64')

    // 获取文件扩展名
    const mimeMatch = file.content.match(/^data:image\/([a-zA-Z0-9]+);base64,/)
    const ext = mimeMatch ? `.${mimeMatch[1].toLowerCase()}` : '.png'

    // 生成临时文件名
    const tempName = `${nanoid()}${ext}`
    const tempPath = path.join(this.tempDir, tempName)

    // 写入文件
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
}

function calculateImageTokens(adapter: ImageFileAdapter): number {
  // 方法1：基于图片尺寸
  const pixelBasedTokens = Math.round(
    ((adapter.imageMetadata.compressWidth ?? adapter.imageMetadata.width ?? 1) *
      (adapter.imageMetadata.compressHeight ?? adapter.imageMetadata.height ?? 1)) /
      750
  )
  return pixelBasedTokens
}
