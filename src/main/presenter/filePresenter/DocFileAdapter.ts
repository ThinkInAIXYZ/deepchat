/* eslint-disable @typescript-eslint/no-unused-vars */
import { BaseFileAdapter } from './BaseFileAdapter'
import fs from 'fs/promises'
import mammoth from 'mammoth'
import TurndownService from 'turndown'

export class DocFileAdapter extends BaseFileAdapter {
  private fileContent: string | undefined
  private maxFileSize: number
  private htmlContent: string | undefined
  private documentError: string | undefined
  private turndownService: TurndownService

  constructor(filePath: string, maxFileSize: number) {
    super(filePath)
    this.maxFileSize = maxFileSize
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    })
  }

  protected getFileDescription(): string | undefined {
    return 'Word Document'
  }

  private async loadDocumentContent(): Promise<string | undefined> {
    if (!this.htmlContent) {
      const stats = await fs.stat(this.filePath)
      if (stats.size <= this.maxFileSize) {
        const buffer = await fs.readFile(this.filePath)
        try {
          const result = await mammoth.convertToHtml(
            {
              buffer
            },
            {
              convertImage: mammoth.images.imgElement(function (_image) {
                return Promise.resolve({ type: 'ignore', src: '' })
              })
            }
          )
          this.htmlContent = result.value
        } catch (error) {
          const rawText = await mammoth.extractRawText({ buffer }).catch(() => undefined)
          if (rawText?.value) {
            this.htmlContent = rawText.value
              .split(/\n{2,}/)
              .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
              .join('\n')
            return this.htmlContent
          }

          this.documentError = `Error processing Word document: ${(error as Error).message}`
          console.error('Error extracting text from Word document:', error)
        }
      }
    }
    return this.htmlContent
  }

  private paginateContent(markdown: string): string[] {
    // Simple pagination by headings (h1, h2)
    const headingRegex = /^(# |## )/m
    const pages = markdown.split(headingRegex)

    // Skip the first empty element if it exists
    if (pages[0].trim() === '') {
      pages.shift()
    }

    // Reconstruct pages with headings
    const result: string[] = []
    for (let i = 0; i < pages.length; i += 2) {
      if (i + 1 < pages.length) {
        result.push(`${pages[i]}${pages[i + 1]}`)
      } else {
        result.push(pages[i])
      }
    }

    // If no headings were found, return the original content as a single page
    return result.length > 0 ? result : [markdown]
  }

  async getContent(): Promise<string | undefined> {
    if (this.fileContent === undefined) {
      const html = await this.loadDocumentContent()
      if (html) {
        const markdown = this.turndownService.turndown(html)
        this.fileContent = markdown
      } else if (this.documentError) {
        this.fileContent = this.documentError
      }
    }
    return this.fileContent
  }

  public async getLLMContent(): Promise<string | undefined> {
    const html = await this.loadDocumentContent()
    if (!html) return this.documentError

    const markdown = this.turndownService.turndown(html)
    const pages = this.paginateContent(markdown)

    const fileDescription = `
    # Word Document Description

    ## Basic Word Document Information
    * **Total Pages:** ${pages.length}

    ## Document Content \n
    `

    // Generate a preview for each page
    const pagesContent = pages
      .map((page, index) => {
        return `### Page ${index + 1}
      \`\`\`
      ${page}
      \`\`\`
      `
      })
      .join('\n')

    return fileDescription + pagesContent
  }

  async getThumbnail(): Promise<string | undefined> {
    return ''
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
