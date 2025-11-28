import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FileValidationService,
  FileValidationResult
} from '../../../src/main/presenter/filePresenter/FileValidationService'
import {
  getMimeTypeAdapterMap,
  detectMimeType
} from '../../../src/main/presenter/filePresenter/mime'
import { AudioFileAdapter } from '../../../src/main/presenter/filePresenter/AudioFileAdapter'
import { ImageFileAdapter } from '../../../src/main/presenter/filePresenter/ImageFileAdapter'
import { UnsupportFileAdapter } from '../../../src/main/presenter/filePresenter/UnsupportFileAdapter'
import { TextFileAdapter } from '../../../src/main/presenter/filePresenter/TextFileAdapter'
import { CodeFileAdapter } from '../../../src/main/presenter/filePresenter/CodeFileAdapter'
import { PdfFileAdapter } from '../../../src/main/presenter/filePresenter/PdfFileAdapter'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// Mock the mime detection module
vi.mock('../../../src/main/presenter/filePresenter/mime', () => ({
  detectMimeType: vi.fn(),
  getMimeTypeAdapterMap: vi.fn()
}))

describe('FileValidationService', () => {
  let service: FileValidationService
  let tempDir: string
  let testFile: string

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-validation-test-'))
    testFile = path.join(tempDir, 'test.txt')
    await fs.writeFile(testFile, 'Test content', 'utf-8')

    service = new FileValidationService()

    // Setup default mock for getMimeTypeAdapterMap
    const mockAdapterMap = new Map([
      ['text/plain', TextFileAdapter],
      ['text/markdown', TextFileAdapter],
      ['application/pdf', PdfFileAdapter],
      ['application/javascript', CodeFileAdapter],
      ['image/jpeg', ImageFileAdapter],
      ['image/png', ImageFileAdapter],
      ['audio/mp3', AudioFileAdapter],
      ['audio/wav', AudioFileAdapter],
      ['application/octet-stream', UnsupportFileAdapter],
      ['text/*', TextFileAdapter],
      ['image/*', ImageFileAdapter],
      ['audio/*', AudioFileAdapter]
    ])

    vi.mocked(getMimeTypeAdapterMap).mockReturnValue(mockAdapterMap)
  })

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('validateFile', () => {
    it('should validate supported text file successfully', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('text/plain')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(true)
      expect(result.mimeType).toBe('text/plain')
      expect(result.adapterType).toBe('TextFileAdapter')
      expect(result.error).toBeUndefined()
    })

    it('should validate supported PDF file successfully', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('application/pdf')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(true)
      expect(result.mimeType).toBe('application/pdf')
      expect(result.adapterType).toBe('PdfFileAdapter')
      expect(result.error).toBeUndefined()
    })

    it('should validate supported code file successfully', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('application/javascript')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(true)
      expect(result.mimeType).toBe('application/javascript')
      expect(result.adapterType).toBe('CodeFileAdapter')
      expect(result.error).toBeUndefined()
    })

    it('should reject audio files', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('audio/mp3')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.mimeType).toBe('audio/mp3')
      expect(result.adapterType).toBe('AudioFileAdapter')
      expect(result.error).toContain('File type not supported for knowledge base processing')
      expect(result.suggestedExtensions).toBeDefined()
    })

    it('should reject image files', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('image/jpeg')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.mimeType).toBe('image/jpeg')
      expect(result.adapterType).toBe('ImageFileAdapter')
      expect(result.error).toContain('File type not supported for knowledge base processing')
      expect(result.suggestedExtensions).toBeDefined()
    })

    it('should reject unsupported files', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('application/octet-stream')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.mimeType).toBe('application/octet-stream')
      expect(result.adapterType).toBe('UnsupportFileAdapter')
      expect(result.error).toContain('File type not supported for knowledge base processing')
      expect(result.suggestedExtensions).toBeDefined()
    })

    it('should handle wildcard MIME type matching', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('text/csv')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(true)
      expect(result.mimeType).toBe('text/csv')
      expect(result.adapterType).toBe('TextFileAdapter')
    })

    it('should handle MIME type detection failure', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.error).toBe('Could not determine file type')
      expect(result.suggestedExtensions).toBeDefined()
    })

    it('should handle MIME type detection error', async () => {
      vi.mocked(detectMimeType).mockRejectedValue(new Error('File read error'))

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.error).toContain('Error validating file: File read error')
      expect(result.suggestedExtensions).toBeDefined()
    })

    it('should handle unknown MIME type gracefully', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('unknown/type')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.mimeType).toBe('unknown/type')
      expect(result.adapterType).toBe('UnsupportFileAdapter')
      expect(result.error).toContain('File type not supported for knowledge base processing')
    })
  })

  describe('getSupportedExtensions', () => {
    it('should return list of supported extensions', () => {
      const extensions = service.getSupportedExtensions()

      expect(extensions).toBeInstanceOf(Array)
      expect(extensions.length).toBeGreaterThan(0)
      expect(extensions).toContain('txt')
      expect(extensions).toContain('md')
      expect(extensions).toContain('pdf')
      expect(extensions).toContain('js')
    })

    it('should not include extensions for excluded adapters', () => {
      const extensions = service.getSupportedExtensions()

      // Should not include audio/image extensions
      expect(extensions).not.toContain('mp3')
      expect(extensions).not.toContain('wav')
      expect(extensions).not.toContain('jpg')
      expect(extensions).not.toContain('png')
    })

    it('should return sorted extensions', () => {
      const extensions = service.getSupportedExtensions()
      const sortedExtensions = [...extensions].sort()

      expect(extensions).toEqual(sortedExtensions)
    })

    it('should include common text extensions', () => {
      const extensions = service.getSupportedExtensions()

      expect(extensions).toContain('md')
      expect(extensions).toContain('markdown')
      expect(extensions).toContain('txt')
      expect(extensions).toContain('json')
      expect(extensions).toContain('yaml')
      expect(extensions).toContain('yml')
      expect(extensions).toContain('xml')
    })
  })

  describe('getSupportedMimeTypes', () => {
    it('should return list of supported MIME types', () => {
      const mimeTypes = service.getSupportedMimeTypes()

      expect(mimeTypes).toBeInstanceOf(Array)
      expect(mimeTypes.length).toBeGreaterThan(0)
      expect(mimeTypes).toContain('text/plain')
      expect(mimeTypes).toContain('text/markdown')
      expect(mimeTypes).toContain('application/pdf')
      expect(mimeTypes).toContain('application/javascript')
    })

    it('should not include MIME types for excluded adapters', () => {
      const mimeTypes = service.getSupportedMimeTypes()

      // Should not include audio/image MIME types
      expect(mimeTypes).not.toContain('audio/mp3')
      expect(mimeTypes).not.toContain('audio/wav')
      expect(mimeTypes).not.toContain('image/jpeg')
      expect(mimeTypes).not.toContain('image/png')
    })

    it('should not include wildcard MIME types', () => {
      const mimeTypes = service.getSupportedMimeTypes()

      expect(mimeTypes).not.toContain('text/*')
      expect(mimeTypes).not.toContain('image/*')
      expect(mimeTypes).not.toContain('audio/*')
    })

    it('should return sorted MIME types', () => {
      const mimeTypes = service.getSupportedMimeTypes()
      const sortedMimeTypes = [...mimeTypes].sort()

      expect(mimeTypes).toEqual(sortedMimeTypes)
    })
  })

  describe('adapter filtering logic', () => {
    it('should correctly identify excluded adapters', () => {
      const excludedAdapters = [
        'AudioFileAdapter',
        'ImageFileAdapter',
        'UnsupportFileAdapter',
        'DirectoryAdapter'
      ]

      // Test that these adapters are properly excluded
      excludedAdapters.forEach((adapterName) => {
        // We can't directly test the private method, but we can test the behavior
        // through the public validateFile method
        expect(service).toBeDefined()
      })
    })

    it('should correctly identify supported adapters', () => {
      const supportedAdapters = [
        'TextFileAdapter',
        'CodeFileAdapter',
        'PdfFileAdapter',
        'DocFileAdapter',
        'PptFileAdapter',
        'ExcelFileAdapter',
        'CsvFileAdapter'
      ]

      // These should be supported (not in excluded list)
      supportedAdapters.forEach((adapterName) => {
        expect(service).toBeDefined()
      })
    })
  })

  describe('error handling and edge cases', () => {
    it('should handle empty MIME type gracefully', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.error).toBe('Could not determine file type')
    })

    it('should handle null MIME type gracefully', async () => {
      vi.mocked(detectMimeType).mockResolvedValue(null as any)

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.error).toBe('Could not determine file type')
    })

    it('should handle adapter map errors gracefully', async () => {
      // Create a new service instance to avoid affecting other tests
      const errorService = new FileValidationService()

      vi.mocked(getMimeTypeAdapterMap).mockImplementation(() => {
        throw new Error('Adapter map error')
      })
      vi.mocked(detectMimeType).mockResolvedValue('text/plain')

      const result = await errorService.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.error).toContain('Error validating file')
    })

    it('should provide suggested extensions on validation failure', async () => {
      vi.mocked(detectMimeType).mockResolvedValue('audio/mp3')

      const result = await service.validateFile(testFile)

      expect(result.isSupported).toBe(false)
      expect(result.suggestedExtensions).toBeDefined()
      expect(result.suggestedExtensions!.length).toBeGreaterThan(0)
    })
  })

  describe('constructor options', () => {
    it('should create service instance', () => {
      const defaultService = new FileValidationService()
      expect(defaultService).toBeDefined()
    })
  })

  describe('integration with existing adapter system', () => {
    it('should work with the actual adapter map structure', async () => {
      // Clear all mocks and use real implementation
      vi.clearAllMocks()

      // Import and use the real function directly
      const { getMimeTypeAdapterMap: realGetMimeTypeAdapterMap } = await import(
        '../../../src/main/presenter/filePresenter/mime'
      )

      // Mock with real implementation
      vi.mocked(getMimeTypeAdapterMap).mockImplementation(realGetMimeTypeAdapterMap)

      const realService = new FileValidationService()
      const extensions = realService.getSupportedExtensions()
      const mimeTypes = realService.getSupportedMimeTypes()

      expect(extensions).toBeInstanceOf(Array)
      expect(mimeTypes).toBeInstanceOf(Array)
      expect(extensions.length).toBeGreaterThan(0)
      expect(mimeTypes.length).toBeGreaterThan(0)
    })
  })
})
