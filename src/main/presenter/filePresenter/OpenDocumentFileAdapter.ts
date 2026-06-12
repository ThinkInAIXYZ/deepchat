import { BaseFileAdapter } from './BaseFileAdapter'
import fs from 'fs/promises'
import path from 'path'
import { unzip } from 'fflate'
import { parseStringPromise } from 'xml2js'

type XmlNode = string | number | boolean | null | XmlNode[] | { [key: string]: XmlNode }

export class OpenDocumentFileAdapter extends BaseFileAdapter {
  private fileContent: string | undefined
  private maxFileSize: number
  private textDecoder = new TextDecoder()

  constructor(filePath: string, maxFileSize: number) {
    super(filePath)
    this.maxFileSize = maxFileSize
  }

  protected getFileDescription(): string | undefined {
    const ext = path.extname(this.filePath).toLowerCase()
    if (ext === '.odp') {
      return 'OpenDocument Presentation'
    }
    return 'OpenDocument Text'
  }

  private async extractContentXml(): Promise<string | undefined> {
    const stats = await fs.stat(this.filePath)
    if (stats.size > this.maxFileSize) {
      return undefined
    }

    const fileBuffer = await fs.readFile(this.filePath)
    const zipBuffer = new Uint8Array(
      fileBuffer.buffer,
      fileBuffer.byteOffset,
      fileBuffer.byteLength
    )

    return new Promise((resolve, reject) => {
      unzip(zipBuffer, (error, result) => {
        if (error) {
          reject(error)
          return
        }

        const content = result['content.xml']
        resolve(content ? this.textDecoder.decode(content) : undefined)
      })
    })
  }

  private collectText(node: XmlNode, collectedText: string[] = []): string[] {
    if (typeof node === 'string') {
      const value = node.trim()
      if (value) {
        collectedText.push(value)
      }
      return collectedText
    }

    if (!node || typeof node !== 'object') {
      return collectedText
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        this.collectText(item, collectedText)
      }
      return collectedText
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === '$') {
        continue
      }
      this.collectText(value, collectedText)
    }

    return collectedText
  }

  async getContent(): Promise<string | undefined> {
    if (this.fileContent === undefined) {
      try {
        const contentXml = await this.extractContentXml()
        if (!contentXml) {
          return undefined
        }

        const parsed = await parseStringPromise(contentXml)
        const body = parsed?.['office:document-content']?.['office:body'] ?? parsed
        this.fileContent = this.collectText(body)
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
      } catch (error) {
        console.error('Error extracting text from OpenDocument file:', error)
        this.fileContent = `Error processing OpenDocument file: ${(error as Error).message}`
      }
    }

    return this.fileContent
  }

  public async getLLMContent(): Promise<string | undefined> {
    const content = await this.getContent()
    if (!content) {
      return undefined
    }

    return `
    # OpenDocument File Description

    ## Document Content
    \`\`\`
    ${content}
    \`\`\`
    `
  }

  async getThumbnail(): Promise<string | undefined> {
    return ''
  }
}
