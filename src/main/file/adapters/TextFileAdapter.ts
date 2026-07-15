import { BaseFileAdapter } from './BaseFileAdapter'
import fs from 'fs/promises'
import path from 'path'

export class TextFileAdapter extends BaseFileAdapter {
  public async getLLMContent(): Promise<string | undefined> {
    const content = await this.getContent()

    return `
    ## File Content
      \`\`\`
      ${content}
      \`\`\`
  `
  }
  private maxFileSize: number
  private fileContent: string | undefined

  constructor(filePath: string, maxFileSize: number) {
    super(filePath)
    this.maxFileSize = maxFileSize
    this.fileContent = undefined
  }

  protected getFileDescription(): string | undefined {
    return 'Text File'
  }

  async getContent(): Promise<string | undefined> {
    if (this.fileContent === undefined) {
      const fullPath = path.join(this.filePath)
      const stats = await fs.stat(fullPath)
      if (stats.size <= this.maxFileSize) {
        this.fileContent = await fs.readFile(fullPath, 'utf-8')
      }
    }
    return this.fileContent
  }
  async getThumbnail(): Promise<string | undefined> {
    return ''
  }
}
