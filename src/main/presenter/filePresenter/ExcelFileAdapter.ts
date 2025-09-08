import { BaseFileAdapter } from './BaseFileAdapter'
import fs from 'fs/promises'
import * as XLSX from 'xlsx'

export class ExcelFileAdapter extends BaseFileAdapter {
  private fileContent: string | undefined
  private maxFileSize: number
  private workbook: XLSX.WorkBook | undefined

  constructor(filePath: string, maxFileSize: number) {
    super(filePath)
    this.maxFileSize = maxFileSize
  }

  protected getFileDescription(): string | undefined {
    return 'Excel File'
  }

  private async loadWorkbook(): Promise<XLSX.WorkBook | undefined> {
    if (!this.workbook) {
      const stats = await fs.stat(this.filePath)
      if (stats.size <= this.maxFileSize) {
        const buffer = await fs.readFile(this.filePath)
        this.workbook = XLSX.read(buffer)
      }
    }
    return this.workbook
  }

  private generateSheetContent(sheet: XLSX.WorkSheet): string {
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
    const rows: string[][] = []

    // Get all cell data
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c })
        const cell = sheet[cellAddress]
        row.push(cell ? XLSX.utils.format_cell(cell) : '')
      }
      rows.push(row)
    }

    // 转换为格式化的字符串
    return rows.map((row) => row.join('\t')).join('\n')
  }

  async getContent(): Promise<string | undefined> {
    if (this.fileContent === undefined) {
      const workbook = await this.loadWorkbook()
      if (workbook) {
        const sheets = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name]
          return `Sheet: ${name}\n${this.generateSheetContent(sheet)}`
        })
        this.fileContent = sheets.join('\n\n')
      }
    }
    return this.fileContent
  }

  public async getLLMContent(): Promise<string | undefined> {
    const workbook = await this.loadWorkbook()
    if (!workbook) return undefined

    // const stats = await fs.stat(this.filePath)

    const fileDescription = `
    # Excel File Description

    ## Basic Excel File Information
    * **Total Sheets:** ${workbook.SheetNames.length}

    ## Sheets Information\n`

    // Generate preview for each worksheet
    const sheetsContent = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName]
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1')
      const totalRows = range.e.r - range.s.r + 1
      const totalCols = range.e.c - range.s.c + 1

      return `
        ### Sheet: ${sheetName}
        * **Total Rows:** ${totalRows}
        * **Total Columns:** ${totalCols}

        #### Data Preview (First 10 Rows)
        \`\`\`
        ${this.generateSheetContent(sheet).split('\n').slice(0, 10).join('\n')}
        \`\`\`
      `
    }).join('\n')

    return fileDescription + sheetsContent
  }
  async getThumbnail(): Promise<string | undefined> {
    return ''
  }
}
