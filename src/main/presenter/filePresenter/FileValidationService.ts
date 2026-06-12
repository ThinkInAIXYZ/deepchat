import { FileAdapterConstructor } from './FileAdapterConstructor'
import { getMimeTypeAdapterMap, detectMimeType } from './mime'
import { UnsupportFileAdapter } from './UnsupportFileAdapter'
import { extension as mimeTypesExtension } from 'es-mime-types'

export interface FileValidationResult {
  isSupported: boolean
  mimeType?: string
  adapterType?: string
  error?: string
  suggestedExtensions?: string[]
}

export interface IFileValidationService {
  validateFile(filePath: string): Promise<FileValidationResult>
  getSupportedExtensions(): string[]
  getSupportedMimeTypes(): string[]
}

export class FileValidationService implements IFileValidationService {
  private excludedAdapters = [
    'AudioFileAdapter',
    'ImageFileAdapter',
    'UnsupportFileAdapter',
    'DirectoryAdapter'
  ]

  constructor() {
    // Constructor kept for future extensibility
  }

  /**
   * Validates if a file is supported for knowledge base processing
   * @param filePath Path to the file to validate
   * @returns FileValidationResult with validation details
   */
  async validateFile(filePath: string): Promise<FileValidationResult> {
    try {
      // Detect MIME type from file content
      const mimeType = await detectMimeType(filePath)

      if (!mimeType) {
        return {
          isSupported: false,
          error: 'Could not determine file type',
          suggestedExtensions: this.getSupportedExtensions()
        }
      }

      // Get adapter map and find appropriate adapter
      const adapterMap = getMimeTypeAdapterMap()
      const AdapterConstructor = this.findAdapterForMimeType(mimeType, adapterMap)

      if (!AdapterConstructor) {
        return {
          isSupported: false,
          mimeType,
          error: 'File type not supported for knowledge base processing',
          suggestedExtensions: this.getSupportedExtensions()
        }
      }

      // Check if adapter is supported (not in excluded list)
      const isSupported = this.isAdapterSupported(AdapterConstructor)
      const adapterType = AdapterConstructor.name

      if (!isSupported) {
        return {
          isSupported: false,
          mimeType,
          adapterType,
          error: 'File type not supported for knowledge base processing',
          suggestedExtensions: this.getSupportedExtensions()
        }
      }

      return {
        isSupported: true,
        mimeType,
        adapterType
      }
    } catch (error) {
      return {
        isSupported: false,
        error: `Error validating file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        suggestedExtensions: this.getSupportedExtensions()
      }
    }
  }

  /**
   * Checks if an adapter is supported for knowledge base processing
   * @param adapterConstructor The adapter constructor to check
   * @returns true if adapter is supported, false otherwise
   */
  private isAdapterSupported(adapterConstructor: FileAdapterConstructor): boolean {
    const adapterName = adapterConstructor.name
    return !this.excludedAdapters.includes(adapterName)
  }

  /**
   * Finds the appropriate adapter for a given MIME type
   * @param mimeType The MIME type to find an adapter for
   * @param adapterMap Map of MIME types to adapter constructors
   * @returns The adapter constructor or undefined if not found
   */
  private findAdapterForMimeType(
    mimeType: string,
    adapterMap: Map<string, FileAdapterConstructor>
  ): FileAdapterConstructor | undefined {
    // First try exact match
    const exactMatch = adapterMap.get(mimeType)
    if (exactMatch) {
      return exactMatch
    }

    // Try wildcard match
    const type = mimeType.split('/')[0]
    const wildcardMatch = adapterMap.get(`${type}/*`)

    if (wildcardMatch) {
      return wildcardMatch
    }

    // Return UnsupportFileAdapter as fallback
    return UnsupportFileAdapter
  }

  /**
   * Gets all supported file extensions for knowledge base processing
   * @returns Array of supported file extensions (without dots)
   */
  getSupportedExtensions(): string[] {
    try {
      const adapterMap = getMimeTypeAdapterMap()
      const supportedExtensions = new Set<string>()

      // Iterate through all MIME types in the adapter map
      for (const [mimeType, AdapterConstructor] of adapterMap.entries()) {
        // Skip excluded adapters and wildcard entries
        if (!this.isAdapterSupported(AdapterConstructor) || mimeType.includes('*')) {
          continue
        }

        // Get extensions for this MIME type
        const extension = mimeTypesExtension(mimeType)
        if (extension) {
          supportedExtensions.add(extension)
        }
      }

      // Add some common extensions that might not be in the MIME type map
      const commonExtensions = [
        'csv',
        'docm',
        'docx',
        'dotm',
        'dotx',
        'html',
        'json',
        'md',
        'markdown',
        'odp',
        'ods',
        'odt',
        'pdf',
        'pptm',
        'pptx',
        'rtf',
        'tsv',
        'txt',
        'xls',
        'xlsb',
        'xlsm',
        'xlsx',
        'xltm',
        'xltx',
        'xml',
        'yaml',
        'yml'
      ]
      commonExtensions.forEach((ext) => supportedExtensions.add(ext))

      return Array.from(supportedExtensions).sort()
    } catch (error) {
      // Fallback to common extensions if adapter map fails
      console.error('Error getting supported extensions:', error)
      return [
        'txt',
        'md',
        'markdown',
        'pdf',
        'rtf',
        'docx',
        'docm',
        'dotx',
        'dotm',
        'pptx',
        'pptm',
        'ppsx',
        'ppsm',
        'xlsx',
        'xls',
        'xlsm',
        'xlsb',
        'ods',
        'odt',
        'odp',
        'csv',
        'tsv',
        'json',
        'yaml',
        'yml',
        'xml',
        'js',
        'ts',
        'py',
        'java',
        'cpp',
        'c',
        'h',
        'css',
        'html'
      ].sort()
    }
  }

  /**
   * Gets all supported MIME types for knowledge base processing
   * @returns Array of supported MIME types
   */
  getSupportedMimeTypes(): string[] {
    try {
      const adapterMap = getMimeTypeAdapterMap()
      const supportedMimeTypes: string[] = []

      // Iterate through all MIME types in the adapter map
      for (const [mimeType, AdapterConstructor] of adapterMap.entries()) {
        // Skip excluded adapters and wildcard entries
        if (!this.isAdapterSupported(AdapterConstructor) || mimeType.includes('*')) {
          continue
        }

        supportedMimeTypes.push(mimeType)
      }

      return supportedMimeTypes.sort()
    } catch (error) {
      // Fallback to common MIME types if adapter map fails
      console.error('Error getting supported MIME types:', error)
      return [
        'text/plain',
        'text/markdown',
        'application/pdf',
        'application/rtf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-word.document.macroenabled.12',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint.presentation.macroenabled.12',
        'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel.sheet.macroenabled.12',
        'application/vnd.ms-excel.sheet.binary.macroenabled.12',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.presentation',
        'application/vnd.oasis.opendocument.spreadsheet',
        'text/csv',
        'text/tab-separated-values',
        'application/json',
        'application/javascript',
        'text/html',
        'text/css'
      ].sort()
    }
  }
}
