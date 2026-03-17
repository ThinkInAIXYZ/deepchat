import { CsvFileAdapter } from './CsvFileAdapter'
import { ExcelFileAdapter } from './ExcelFileAdapter'
import { FileAdapterConstructor } from './FileAdapterConstructor'
import { ImageFileAdapter } from './ImageFileAdapter'
import { PdfFileAdapter } from './PdfFileAdapter'
import { TextFileAdapter } from './TextFileAdapter'
import { DocFileAdapter } from './DocFileAdapter'
import { PptFileAdapter } from './PptFileAdapter'
import { CodeFileAdapter } from './CodeFileAdapter'
import { AudioFileAdapter } from './AudioFileAdapter'
import { UnsupportFileAdapter } from './UnsupportFileAdapter'
import fs from 'fs/promises'
import path from 'path'
import { lookup } from 'es-mime-types'

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

export const getMimeTypeAdapterMap = (): Map<string, FileAdapterConstructor> => {
  const map = new Map<string, FileAdapterConstructor>()

  // Text formats
  map.set('text/plain', TextFileAdapter)
  map.set('text/csv', CsvFileAdapter)
  map.set('text/markdown', TextFileAdapter)
  map.set('application/json', TextFileAdapter)
  map.set('application/x-yaml', TextFileAdapter)
  map.set('application/xml', TextFileAdapter)
  map.set('text/*', TextFileAdapter)

  // Audio formats
  map.set('audio/mp3', AudioFileAdapter)
  map.set('audio/mpeg', AudioFileAdapter)
  map.set('audio/wav', AudioFileAdapter)
  map.set('audio/x-wav', AudioFileAdapter)
  map.set('audio/x-m4a', AudioFileAdapter)
  map.set('audio/m4a', AudioFileAdapter)

  // Code formats
  map.set('application/javascript', CodeFileAdapter)
  map.set('application/typescript', CodeFileAdapter)
  map.set('application/x-typescript', CodeFileAdapter)
  map.set('text/typescript', CodeFileAdapter)
  map.set('text/x-typescript', CodeFileAdapter)
  // On macOS, .ts files are sometimes misidentified as MPEG Transport Stream (video/mp2t)
  // This mapping ensures TypeScript files are still handled correctly in such cases
  map.set('video/mp2t', CodeFileAdapter)
  map.set('application/x-sh', CodeFileAdapter)
  map.set('text/x-python', CodeFileAdapter)
  map.set('text/x-python-script', CodeFileAdapter)
  map.set('text/x-java', CodeFileAdapter)
  map.set('text/x-c', CodeFileAdapter)
  map.set('text/x-cpp', CodeFileAdapter)
  map.set('text/x-csharp', CodeFileAdapter)
  map.set('text/x-go', CodeFileAdapter)
  map.set('text/x-ruby', CodeFileAdapter)
  map.set('text/x-php', CodeFileAdapter)
  map.set('text/x-rust', CodeFileAdapter)
  map.set('text/x-swift', CodeFileAdapter)
  map.set('text/x-kotlin', CodeFileAdapter)
  map.set('text/x-scala', CodeFileAdapter)
  map.set('text/x-perl', CodeFileAdapter)
  map.set('text/x-lua', CodeFileAdapter)

  // Web formats
  map.set('text/html', CodeFileAdapter)
  map.set('text/css', CodeFileAdapter)
  map.set('application/xhtml+xml', CodeFileAdapter)

  // Excel formats
  map.set('application/vnd.ms-excel', ExcelFileAdapter)
  map.set('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ExcelFileAdapter)
  map.set('application/vnd.oasis.opendocument.spreadsheet', ExcelFileAdapter)
  map.set('application/vnd.ms-excel.sheet.binary.macroEnabled.12', ExcelFileAdapter)
  map.set('application/vnd.apple.numbers', ExcelFileAdapter)

  // Image formats
  map.set('image/jpeg', ImageFileAdapter)
  map.set('image/jpg', ImageFileAdapter)
  map.set('image/png', ImageFileAdapter)
  map.set('image/gif', ImageFileAdapter)
  map.set('image/webp', ImageFileAdapter)
  map.set('image/bmp', ImageFileAdapter)
  map.set('image/*', ImageFileAdapter)

  // PDF format
  map.set('application/pdf', PdfFileAdapter)

  // Word document formats
  map.set('application/msword', DocFileAdapter)
  map.set('application/vnd.openxmlformats-officedocument.wordprocessingml.document', DocFileAdapter)

  // PowerPoint formats
  map.set('application/vnd.ms-powerpoint', PptFileAdapter)
  map.set(
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    PptFileAdapter
  )

  // Additional C/C++ formats
  map.set('text/x-c-header', CodeFileAdapter)
  map.set('text/x-c++hdr', CodeFileAdapter)
  map.set('text/x-h', CodeFileAdapter)
  map.set('text/x-hpp', CodeFileAdapter)

  // Other formats
  map.set('*/*', UnsupportFileAdapter)
  map.set('', UnsupportFileAdapter)

  return map
}

export const detectMimeType = async (filePath: string): Promise<string> => {
  try {
    const mimeType = lookup(filePath)

    if (mimeType === 'video/mp2t' && TYPESCRIPT_EXTENSIONS.has(path.extname(filePath))) {
      return (await isLikelyTextFile(filePath)) ? 'application/typescript' : mimeType
    }

    if (mimeType) {
      return mimeType
    }

    const isText = await isLikelyTextFile(filePath)
    return isText ? 'text/plain' : 'application/octet-stream'
  } catch {
    try {
      const isText = await isLikelyTextFile(filePath)
      return isText ? 'text/plain' : 'application/octet-stream'
    } catch (textCheckError) {
      console.error(`Error during text check for ${filePath}:`, textCheckError)
      return 'application/octet-stream' // Final fallback on error
    }
  }
}

// Helper function to check if a file is likely text-based
export const isLikelyTextFile = async (filePath: string, bytesToRead = 1024): Promise<boolean> => {
  let fileHandle: fs.FileHandle | undefined
  try {
    fileHandle = await fs.open(filePath, 'r')
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, 0)
    await fileHandle.close() // Close the file handle promptly

    if (bytesRead === 0) {
      return false
    }

    const content = buffer.slice(0, bytesRead)

    const hasNullByte = content.includes(0)
    if (hasNullByte) {
      return false
    }

    let nonTextChars = 0
    for (let i = 0; i < content.length; i++) {
      const byte = content[i]
      if (
        !((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13 || byte >= 128)
      ) {
        nonTextChars++
      }
    }

    const nonTextRatio = bytesRead > 0 ? nonTextChars / bytesRead : 0

    if (nonTextRatio > 0.1) {
      return false
    }

    return true
  } catch (error) {
    console.error(`[isLikelyTextFile] Failed to read file ${path.basename(filePath)}:`, error)
    if (fileHandle) {
      await fileHandle.close() // Ensure closure even on error
    }
    return false // Default to not-text on error
  }
}
