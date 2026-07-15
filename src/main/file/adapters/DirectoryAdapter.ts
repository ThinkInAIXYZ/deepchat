import * as fs from 'fs'
import path from 'path'
import { DirectoryMetaData } from '@shared/presenter'

export class DirectoryAdapter {
  dirPath: string
  dirMetaData: DirectoryMetaData | null = null

  constructor(dirPath: string) {
    this.dirPath = dirPath
  }

  protected async extractDirectoryInfo(): Promise<{
    dirCreated: Date
    dirModified: Date
  }> {
    const stat = await fs.promises.stat(this.dirPath)
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${this.dirPath}`)
    }
    return {
      dirCreated: stat.birthtime,
      dirModified: stat.mtime
    }
  }

  public async processDirectory(): Promise<DirectoryMetaData | null> {
    if (!this.dirMetaData) {
      try {
        const { dirCreated, dirModified } = await this.extractDirectoryInfo()
        this.dirMetaData = {
          dirName: path.basename(this.dirPath),
          dirPath: this.dirPath,
          dirCreated,
          dirModified
        }
      } catch (error) {
        console.error('Error processing directory:', error)
        return null
      }
    }
    return this.dirMetaData
  }
  async getThumbnail(): Promise<string | undefined> {
    return ''
  }
}
