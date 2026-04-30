import { BaseFileAdapter } from './BaseFileAdapter'
import fs from 'fs/promises'
import { unzip } from 'fflate'
import { parseStringPromise } from 'xml2js'

// Define a type for XML content structure
type XMLContent = {
  [key: string]: string | string[] | XMLContent | XMLContent[]
}

export class PptFileAdapter extends BaseFileAdapter {
  private fileContent: string | undefined
  private maxFileSize: number
  private textDecoder = new TextDecoder()

  constructor(filePath: string, maxFileSize: number) {
    super(filePath)
    this.maxFileSize = maxFileSize
  }

  protected getFileDescription(): string | undefined {
    return 'PowerPoint Presentation'
  }

  /**
   * Unzip a PPTX file and return slide files
   */
  private async unzipPresentation(): Promise<Array<{ name: string; content: Uint8Array }>> {
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
        } else {
          // Filter out only the slide XML files
          const slideFiles = Object.keys(result)
            .filter((name) => /ppt\/slides\/slide\d+\.xml/.test(name))
            .map((name) => {
              return { name, content: result[name] }
            })
          resolve(slideFiles)
        }
      })
    })
  }

  /**
   * Extract text from a slide section recursively
   */
  private async parseSlideSection(
    slideSection: XMLContent | XMLContent[] | string | string[],
    collectedText: string[] = []
  ): Promise<string[]> {
    // If it's an array, process each element
    if (Array.isArray(slideSection)) {
      for (const element of slideSection) {
        if (typeof element === 'string' && element !== '') {
          collectedText.push(element)
        } else {
          await this.parseSlideSection(element, collectedText)
        }
      }
      return collectedText
    }

    // If it's an object, process its properties
    if (typeof slideSection === 'object' && slideSection !== null) {
      for (const property of Object.keys(slideSection)) {
        const value = slideSection[property]

        // The PPTX format stores text inside 'a:t' or '_' properties
        if (typeof value === 'string') {
          if ((property === 'a:t' || property === '_') && value !== '') {
            collectedText.push(value)
          }
        } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
          if ((property === 'a:t' || property === '_') && value[0] !== '') {
            collectedText.push(value[0])
          }
        } else {
          await this.parseSlideSection(value, collectedText)
        }
      }
      return collectedText
    }

    return collectedText
  }

  async getContent(): Promise<string | undefined> {
    if (this.fileContent === undefined) {
      try {
        const stats = await fs.stat(this.filePath)

        if (stats.size > this.maxFileSize) {
          return `File too large to process (${stats.size} bytes, max: ${this.maxFileSize} bytes)`
        }

        const slideFiles = await this.unzipPresentation()
        const slidesText: string[] = []

        for (let i = 0; i < slideFiles.length; i++) {
          const file = slideFiles[i]
          const contents = this.textDecoder.decode(file.content)
          const slideData = await parseStringPromise(contents)
          const textLines = await this.parseSlideSection(slideData)

          slidesText.push(`Slide ${i + 1}:\n${textLines.join('\n')}`)
        }

        this.fileContent = slidesText.join('\n\n')

        if (slidesText.length === 0) {
          this.fileContent = 'No slides found in the presentation.'
        }
      } catch (error) {
        console.error('Error extracting text from PowerPoint:', error)
        this.fileContent = `Error processing PowerPoint file: ${(error as Error).message}`
      }
    }

    return this.fileContent
  }

  public async getLLMContent(): Promise<string | undefined> {
    try {
      const stats = await fs.stat(this.filePath)

      if (stats.size > this.maxFileSize) {
        return `File too large to process (${stats.size} bytes, max: ${this.maxFileSize} bytes)`
      }

      const slideFiles = await this.unzipPresentation()

      const fileDescription = `
      # PowerPoint Presentation Description

      ## Basic PowerPoint Presentation Information
      * **Total Slides:** ${slideFiles.length}

      ## Slides Information\n`

      // Generate preview for each slide
      const slidesContent = await Promise.all(
        slideFiles.map(async (file, index) => {
          const contents = this.textDecoder.decode(file.content)
          const slideData = await parseStringPromise(contents)
          const textLines = await this.parseSlideSection(slideData)

          return `### Slide ${index + 1}
\`\`\`
${textLines.join('\n')}
\`\`\`
`
        })
      )

      return fileDescription + slidesContent.join('\n')
    } catch (error) {
      console.error('Error generating LLM content for PowerPoint:', error)
      return `Error processing PowerPoint file: ${(error as Error).message}`
    }
  }

  async getThumbnail(): Promise<string | undefined> {
    return ''
  }
}
