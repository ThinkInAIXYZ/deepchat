import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { FileService } from '../../../src/main/file'
import { FileValidationResult, IFileValidationService } from '../../../src/main/file/validation'

// Mock all external dependencies
const mockSettings = { get: vi.fn() }

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/user/data')
  }
}))

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn()
  }
}))

vi.mock('path', () => ({
  default: {
    join: vi.fn((...args) => args.join('/')),
    extname: vi.fn(),
    dirname: vi.fn()
  }
}))

vi.mock('../../../src/main/file/validation')
vi.mock('../../../src/main/file/mime')
vi.mock('../../../src/main/file/adapters/BaseFileAdapter')
vi.mock('../../../src/main/file/adapters/DirectoryAdapter')
vi.mock('../../../src/main/file/adapters/UnsupportFileAdapter')
vi.mock('../../../src/main/file/adapters/ImageFileAdapter')
vi.mock('tokenx')
vi.mock('nanoid')

describe('FileService Integration with FileValidationService', () => {
  let fileService: FileService
  let mockFileValidationService: IFileValidationService
  let mockValidateFile: Mock
  let mockGetSupportedExtensions: Mock

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock FileValidationService
    mockValidateFile = vi.fn()
    mockGetSupportedExtensions = vi.fn()

    mockFileValidationService = {
      validateFile: mockValidateFile,
      getSupportedExtensions: mockGetSupportedExtensions,
      getSupportedMimeTypes: vi.fn()
    }

    // Create FileService with mocked service
    fileService = new FileService(mockSettings, mockFileValidationService)
  })

  describe('constructor', () => {
    it('should initialize with provided FileValidationService', () => {
      const customService = {
        validateFile: vi.fn(),
        getSupportedExtensions: vi.fn(),
        getSupportedMimeTypes: vi.fn()
      }

      const presenter = new FileService(mockSettings, customService)
      expect(presenter).toBeInstanceOf(FileService)
    })

    it('should initialize with default FileValidationService when none provided', () => {
      const presenter = new FileService(mockSettings)
      expect(presenter).toBeInstanceOf(FileService)
    })
  })

  describe('validateFileForKnowledgeBase', () => {
    it('should return validation result for supported file', async () => {
      const mockResult: FileValidationResult = {
        isSupported: true,
        mimeType: 'text/plain',
        adapterType: 'TextFileAdapter'
      }

      mockValidateFile.mockResolvedValue(mockResult)

      const result = await fileService.validateFileForKnowledgeBase('/path/to/file.txt')

      expect(mockValidateFile).toHaveBeenCalledWith('/path/to/file.txt')
      expect(result).toEqual(mockResult)
    })

    it('should return validation result for unsupported file', async () => {
      const mockResult: FileValidationResult = {
        isSupported: false,
        mimeType: 'image/jpeg',
        adapterType: 'ImageFileAdapter',
        error: 'File type not supported for knowledge base processing (ImageFileAdapter)',
        suggestedExtensions: ['txt', 'md', 'pdf']
      }

      mockValidateFile.mockResolvedValue(mockResult)

      const result = await fileService.validateFileForKnowledgeBase('/path/to/image.jpg')

      expect(mockValidateFile).toHaveBeenCalledWith('/path/to/image.jpg')
      expect(result).toEqual(mockResult)
    })

    it('should handle validation service errors gracefully', async () => {
      const errorMessage = 'MIME type detection failed'
      mockValidateFile.mockRejectedValue(new Error(errorMessage))
      mockGetSupportedExtensions.mockReturnValue(['txt', 'md', 'pdf'])

      const result = await fileService.validateFileForKnowledgeBase('/path/to/file.txt')

      expect(result.isSupported).toBe(false)
      expect(result.error).toBe(`Validation failed: ${errorMessage}`)
      expect(result.suggestedExtensions).toEqual(['txt', 'md', 'pdf'])
    })

    it('should handle unknown errors gracefully', async () => {
      mockValidateFile.mockRejectedValue('Unknown error')
      mockGetSupportedExtensions.mockReturnValue(['txt', 'md'])

      const result = await fileService.validateFileForKnowledgeBase('/path/to/file.txt')

      expect(result.isSupported).toBe(false)
      expect(result.error).toBe('Validation failed: Unknown error')
      expect(result.suggestedExtensions).toEqual(['txt', 'md'])
    })
  })

  describe('getSupportedExtensions', () => {
    it('should return supported extensions from validation service', () => {
      const mockExtensions = ['txt', 'md', 'markdown', 'pdf', 'docx', 'json']
      mockGetSupportedExtensions.mockReturnValue(mockExtensions)

      const result = fileService.getSupportedExtensions()

      expect(mockGetSupportedExtensions).toHaveBeenCalled()
      expect(result).toEqual(mockExtensions)
    })

    it('should return fallback extensions when service fails', () => {
      mockGetSupportedExtensions.mockImplementation(() => {
        throw new Error('Service unavailable')
      })

      const result = fileService.getSupportedExtensions()

      expect(result).toContain('txt')
      expect(result).toContain('md')
      expect(result).toContain('pdf')
      expect(result).toContain('json')
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should return sorted fallback extensions', () => {
      mockGetSupportedExtensions.mockImplementation(() => {
        throw new Error('Service error')
      })

      const result = fileService.getSupportedExtensions()
      const sortedResult = [...result].sort()

      expect(result).toEqual(sortedResult)
    })
  })

  describe('error handling', () => {
    it('should log errors when validation fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const error = new Error('Validation error')
      mockValidateFile.mockRejectedValue(error)
      mockGetSupportedExtensions.mockReturnValue([])

      await fileService.validateFileForKnowledgeBase('/path/to/file.txt')

      expect(consoleSpy).toHaveBeenCalledWith('Error validating file for knowledge base:', error)

      consoleSpy.mockRestore()
    })

    it('should log errors when getting supported extensions fails', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const error = new Error('Extensions error')
      mockGetSupportedExtensions.mockImplementation(() => {
        throw error
      })

      fileService.getSupportedExtensions()

      expect(consoleSpy).toHaveBeenCalledWith('Error getting supported extensions:', error)

      consoleSpy.mockRestore()
    })
  })

  describe('integration with existing FileService functionality', () => {
    it('should not interfere with existing methods', async () => {
      // Test that existing functionality still works
      expect(typeof fileService.getMimeType).toBe('function')
      expect(typeof fileService.createFileAdapter).toBe('function')
      expect(typeof fileService.prepareFile).toBe('function')
      expect(typeof fileService.isDirectory).toBe('function')
    })

    it('should maintain backward compatibility', () => {
      // Ensure new methods don't break existing interface
      const presenter = new FileService(mockSettings)
      expect(presenter).toHaveProperty('validateFileForKnowledgeBase')
      expect(presenter).toHaveProperty('getSupportedExtensions')
    })
  })
})
