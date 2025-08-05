import * as fs from 'fs'
import * as crypto from 'crypto'
import { FileMetaData } from '@shared/presenter'
import path from 'path'
import { detectMimeType } from './mime'

export abstract class BaseFileAdapter {
  filePath: string
  mimeType: string | null = null
  fileMetaData: FileMetaData | null = null

  constructor(filePath: string) {
    this.filePath = filePath
  }

  protected async readFile(): Promise<Buffer> {
    return fs.promises.readFile(this.filePath)
  }

  protected async calculateFileHash(fileBuffer: Buffer): Promise<string> {
    const hash = crypto.createHash('sha256')
    hash.update(fileBuffer)
    return hash.digest('hex')
  }

  protected async extractBasicInfo(): Promise<{
    fileSize: number
    fileCreated: Date
    fileModified: Date
  }> {
    const stat = await fs.promises.stat(this.filePath)
    return {
      fileSize: stat.size,
      fileCreated: stat.birthtime,
      fileModified: stat.mtime
    }
  }

  protected async preprocessFile(): Promise<void> {
    this.mimeType = await detectMimeType(this.filePath)
  }

  public async processFile(): Promise<FileMetaData | null> {
    if (!this.mimeType) {
      await this.preprocessFile()
    }

    if (!this.fileMetaData) {
      try {
        // const fileBuffer = await this.readFile()
        // const fileHash = await this.calculateFileHash(fileBuffer)
        const { fileSize, fileCreated, fileModified } = await this.extractBasicInfo()
        this.fileMetaData = {
          fileName: path.basename(this.filePath),
          fileSize,
          // fileHash,
          fileDescription: this.getFileDescription(),
          fileCreated,
          fileModified
        }
      } catch (error) {
        console.error('Error processing file:', error)
        return null
      }
    }

    return this.fileMetaData
  }

  protected abstract getFileDescription(): string | undefined
  public abstract getContent(): Promise<string | undefined>
  public abstract getLLMContent(): Promise<string | undefined>
  public abstract getThumbnail(): Promise<string | undefined>
}
