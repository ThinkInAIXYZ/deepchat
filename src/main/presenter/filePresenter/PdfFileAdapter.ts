import { BaseFileAdapter } from './BaseFileAdapter'
import fs from 'fs/promises'
import pdfParse from 'pdf-parse-new'

export class PdfFileAdapter extends BaseFileAdapter {
  private fileContent: string | undefined
  private maxFileSize: number
  private pdfData: (pdfParse.Result & { pageContents?: string[] }) | undefined

  constructor(filePath: string, maxFileSize: number) {
    super(filePath)
    this.maxFileSize = maxFileSize
  }

  protected getFileDescription(): string | undefined {
    return 'PDF Document'
  }

  private async loadPdfData(): Promise<
    (pdfParse.Result & { pageContents?: string[] }) | undefined
  > {
    if (!this.pdfData) {
      const stats = await fs.stat(this.filePath)
      if (stats.size <= this.maxFileSize) {
        const buffer = await fs.readFile(this.filePath)

        // Create custom rendering options to collect content for each page
        const pageTexts: string[] = []
        const renderOptions = {
          verbosityLevel: 0 as 0 | 5 | undefined,
          pageTexts,
          normalizeWhitespace: false,
          disableCombineTextItems: false,
          // Custom renderer to collect text by page
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pagerender: function (pageData: any) {
            // Get text content from current page
            const renderOptions = {
              normalizeWhitespace: false,
              disableCombineTextItems: false
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return pageData.getTextContent(renderOptions).then(function (textContent: any) {
              let lastY: number | null = null
              let text = ''

              // Process text items, try to preserve paragraph structure
              for (const item of textContent.items) {
                if (lastY === null || Math.abs(lastY - item.transform[5]) > 5) {
                  if (text) text += '\n'
                  lastY = item.transform[5]
                } else if (text && !text.endsWith(' ')) {
                  text += ' '
                }
                text += item.str
              }

              // Add current page text to page collection
              pageTexts.push(text)
              return text
            })
          }
        }

        try {
          this.pdfData = await pdfParse(buffer, renderOptions)
          // Add page contents to pdfData object
          this.pdfData.pageContents = pageTexts
        } catch (error) {
          console.error('Error parsing PDF:', error)
          return undefined
        }
      }
    }
    return this.pdfData
  }

  private convertTextToMarkdown(text: string): string {
    // Split text into lines and then paragraphs
    const lines = text.split('\n')
    const paragraphs: string[] = []
    let currentParagraph = ''

    // Group lines into paragraphs
    for (const line of lines) {
      const trimmedLine = line.trim()

      // If line is empty and we have content in current paragraph, push it and reset
      if (!trimmedLine && currentParagraph) {
        paragraphs.push(currentParagraph)
        currentParagraph = ''
        continue
      }

      // If line is not empty, add it to current paragraph
      if (trimmedLine) {
        if (currentParagraph) {
          // Check if this might be a new paragraph or continuation
          // Heuristic: If line starts with lowercase and previous ends with period, likely continuation
          const lastChar = currentParagraph[currentParagraph.length - 1]
          const firstChar = trimmedLine[0]

          if (
            (lastChar === '.' || lastChar === '?' || lastChar === '!') &&
            firstChar === firstChar.toUpperCase() &&
            /[a-zA-Z]/.test(firstChar)
          ) {
            // Likely a new sentence in a new paragraph
            paragraphs.push(currentParagraph)
            currentParagraph = trimmedLine
          } else {
            // Continuation of current paragraph
            currentParagraph += ' ' + trimmedLine
          }
        } else {
          currentParagraph = trimmedLine
        }
      }
    }

    // Add the last paragraph if there's content
    if (currentParagraph) {
      paragraphs.push(currentParagraph)
    }

    // Process each paragraph to determine its type and format accordingly
    const markdownParagraphs = paragraphs.map((paragraph) => {
      // Skip empty paragraphs
      if (!paragraph.trim()) return ''

      // Check if paragraph is a heading (simple heuristics)
      if (paragraph.length < 100) {
        // Likely a main heading (all caps, short)
        if (paragraph === paragraph.toUpperCase() && paragraph.length < 50) {
          return `# ${paragraph}`
        }

        // Likely a subheading (ends with colon, no period)
        if (paragraph.endsWith(':') && !paragraph.includes('.')) {
          return `## ${paragraph}`
        }

        // Possible section heading (short, no punctuation at end)
        if (paragraph.length < 60 && !/[.,:;?!]$/.test(paragraph) && /^[A-Z0-9]/.test(paragraph)) {
          return `### ${paragraph}`
        }
      }

      // Check if paragraph is a numbered list item
      if (/^\d+\.?\s/.test(paragraph)) {
        // Ensure proper Markdown numbered list format
        return paragraph.replace(/^(\d+)\.?\s/, '$1. ')
      }

      // Check if paragraph is a bullet point
      if (/^[•\-*]\s/.test(paragraph)) {
        // Ensure proper Markdown bullet list format
        return paragraph.replace(/^[•\-*]\s/, '* ')
      }

      // Check for table-like content (contains multiple tabs or spaces in sequence)
      if (paragraph.includes('\t') || /\s{3,}/.test(paragraph)) {
        // Convert to code block for better preservation of formatting
        return '```\n' + paragraph + '\n```'
      }

      // Regular paragraph
      return paragraph
    })

    // Join paragraphs with double newlines
    return markdownParagraphs.filter((p) => p).join('\n\n')
  }

  // Get raw text content for specified page
  public async getPageContent(pageNumber: number): Promise<string | undefined> {
    const pdfData = await this.loadPdfData()
    if (!pdfData || !pdfData.pageContents) return undefined

    // Page numbers start from 1, array index starts from 0
    const pageIndex = pageNumber - 1
    if (pageIndex < 0 || pageIndex >= pdfData.pageContents.length) {
      return undefined
    }

    return pdfData.pageContents[pageIndex]
  }

  // Get Markdown format content for specified page
  public async getPageMarkdown(pageNumber: number): Promise<string | undefined> {
    const pageContent = await this.getPageContent(pageNumber)
    if (!pageContent) return undefined

    return this.convertTextToMarkdown(pageContent)
  }

  // Get Markdown format content for all pages
  public async getAllPagesMarkdown(): Promise<string[] | undefined> {
    const pdfData = await this.loadPdfData()
    if (!pdfData || !pdfData.pageContents) return undefined

    return pdfData.pageContents.map((pageContent) => this.convertTextToMarkdown(pageContent))
  }

  async getContent(): Promise<string | undefined> {
    if (this.fileContent === undefined) {
      const pdfData = await this.loadPdfData()
      if (pdfData) {
        // If page contents exist, use page contents
        if (pdfData.pageContents && pdfData.pageContents.length > 0) {
          this.fileContent = pdfData.pageContents.join('\n\n--- Page Separator ---\n\n')
        } else {
          // Otherwise use overall content
          this.fileContent = pdfData.text
        }
      }
    }
    return this.fileContent
  }

  public async getLLMContent(): Promise<string | undefined> {
    const pdfData = await this.loadPdfData()
    if (!pdfData) return undefined

    // Get Markdown content for all pages
    let allPagesMarkdown = ''
    if (pdfData.pageContents) {
      const markdownPages = pdfData.pageContents.map((pageContent, index) => {
        const pageNumber = index + 1
        const pageMarkdown = this.convertTextToMarkdown(pageContent)
        return `## Page ${pageNumber}\n\n${pageMarkdown}`
      })

      allPagesMarkdown = markdownPages.join('\n\n---\n\n')
    } else {
      // If no page contents, use overall content
      allPagesMarkdown = this.convertTextToMarkdown(pdfData.text)
    }

    const fileDescription = `
      # PDF file description

      ## Basic PDF file information
      * **Total pages:** ${pdfData.numpages}
      * **PDF version:** ${pdfData.info?.PDFFormatVersion || 'Unknown'}
      * **PDF generator:** ${pdfData.info?.Producer || 'Unknown'}
      * **PDF creator:** ${pdfData.info?.Creator || 'Unknown'}

      ## PDF content (page by page)
      ${allPagesMarkdown}
`
    return fileDescription
  }

  async getThumbnail(): Promise<string | undefined> {
    return ''
  }
}
