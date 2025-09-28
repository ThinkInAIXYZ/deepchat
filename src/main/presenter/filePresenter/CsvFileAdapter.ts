import { BaseFileAdapter } from './BaseFileAdapter'
import fs from 'fs/promises'
import path from 'path'

export class CsvFileAdapter extends BaseFileAdapter {
  private fileContent: string | undefined
  private maxFileSize: number

  constructor(filePath: string, maxFileSize: number) {
    super(filePath)
    this.maxFileSize = maxFileSize
    this.fileContent = undefined
  }

  protected getFileDescription(): string | undefined {
    return 'CSV File'
  }

  private parseCsvContent(content: string): string[][] {
    const rows = content
      .split('\n')
      .map((row) => row.split(',').map((cell) => cell.trim().replace(/^["'](.*)["']$/, '$1')))
    return rows.filter((row) => row.some((cell) => cell.length > 0))
  }

  private generateTableMarkdown(rows: string[][]): string {
    if (rows.length === 0) return ''

    const headers = rows[0]
    const data = rows.slice(1)

    // Generate table headers
    let markdown = '| ' + headers.join(' | ') + ' |\n'
    markdown += '| ' + headers.map(() => '---').join(' | ') + ' |\n'

    // Generate data rows
    data.forEach((row) => {
      markdown += '| ' + row.map((cell) => cell || '').join(' | ') + ' |\n'
    })

    return markdown
  }

  public async getLLMContent(): Promise<string | undefined> {
    // const fullPath = path.join(this.filePath)
    const content = await this.getContent()

    if (!content) return undefined

    const csvRows = this.parseCsvContent(content)
    const headers = csvRows[0] || []

    const fileDescription = `
      # CSV File Description

      ## Basic CSV File Information
      * **Total Rows:** ${csvRows.length}
      * **Total Columns:** ${headers.length}

      ## Column Headers
      ${headers.map((header, index) => `${index + 1}. ${header}`).join('\n')}

      ## Data Preview (First 10 Rows)
      ${this.generateTableMarkdown(csvRows.slice(0, 11))}
      `
    return fileDescription
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
