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

  return map
}
