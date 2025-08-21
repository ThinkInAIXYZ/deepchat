import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { FilePresenter } from '../../../src/main/presenter/filePresenter/FilePresenter'
import {
  FileValidationResult,
  IFileValidationService
} from '../../../src/main/presenter/filePresenter/FileValidationService'

// Mock all external dependencies
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

vi.mock('../../../src/main/presenter/filePresenter/FileValidationService')
vi.mock('../../../src/main/presenter/filePresenter/mime')
vi.mock('../../../src/main/presenter/filePresenter/BaseFileAdapter')
vi.mock('../../../src/main/presenter/filePresenter/DirectoryAdapter')
vi.mock('../../../src/main/presenter/filePresenter/UnsupportFileAdapter')
vi.mock('../../../src/main/presenter/filePresenter/ImageFileAdapter')
vi.mock('tokenx')
vi.mock('nanoid')

describe('FilePresenter Integration with FileValidationService', () => {
  let filePresenter: FilePresenter
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

    // Create FilePresenter with mocked service
    filePresenter = new FilePresenter(mockFileValidationService)
  })

  describe('constructor', () => {
    it('should initialize with provided FileValidationService', () => {
      const customService = {
        validateFile: vi.fn(),
        getSupportedExtensions: vi.fn(),
        getSupportedMimeTypes: vi.fn()
      }

      const presenter = new FilePresenter(customService)
      expect(presenter).toBeInstanceOf(FilePresenter)
    })

    it('should initialize with default FileValidationService when none provided', () => {
      const presenter = new FilePresenter()
      expect(presenter).toBeInstanceOf(FilePresenter)
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

      const result = await filePresenter.validateFileForKnowledgeBase('/path/to/file.txt')

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

      const result = await filePresenter.validateFileForKnowledgeBase('/path/to/image.jpg')

      expect(mockValidateFile).toHaveBeenCalledWith('/path/to/image.jpg')
      expect(result).toEqual(mockResult)
    })

    it('should handle validation service errors gracefully', async () => {
      const errorMessage = 'MIME type detection failed'
      mockValidateFile.mockRejectedValue(new Error(errorMessage))
      mockGetSupportedExtensions.mockReturnValue(['txt', 'md', 'pdf'])

      const result = await filePresenter.validateFileForKnowledgeBase('/path/to/file.txt')

      expect(result.isSupported).toBe(false)
      expect(result.error).toBe(`Validation failed: ${errorMessage}`)
      expect(result.suggestedExtensions).toEqual(['txt', 'md', 'pdf'])
    })

    it('should handle unknown errors gracefully', async () => {
      mockValidateFile.mockRejectedValue('Unknown error')
      mockGetSupportedExtensions.mockReturnValue(['txt', 'md'])

      const result = await filePresenter.validateFileForKnowledgeBase('/path/to/file.txt')

      expect(result.isSupported).toBe(false)
      expect(result.error).toBe('Validation failed: Unknown error')
      expect(result.suggestedExtensions).toEqual(['txt', 'md'])
    })
  })

  describe('getSupportedExtensions', () => {
    it('should return supported extensions from validation service', () => {
      const mockExtensions = ['txt', 'md', 'markdown', 'pdf', 'docx', 'json']
      mockGetSupportedExtensions.mockReturnValue(mockExtensions)

      const result = filePresenter.getSupportedExtensions()

      expect(mockGetSupportedExtensions).toHaveBeenCalled()
      expect(result).toEqual(mockExtensions)
    })

    it('should return fallback extensions when service fails', () => {
      mockGetSupportedExtensions.mockImplementation(() => {
        throw new Error('Service unavailable')
      })

      const result = filePresenter.getSupportedExtensions()

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

      const result = filePresenter.getSupportedExtensions()
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

      await filePresenter.validateFileForKnowledgeBase('/path/to/file.txt')

      expect(consoleSpy).toHaveBeenCalledWith('Error validating file for knowledge base:', error)

      consoleSpy.mockRestore()
    })

    it('should log errors when getting supported extensions fails', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const error = new Error('Extensions error')
      mockGetSupportedExtensions.mockImplementation(() => {
        throw error
      })

      filePresenter.getSupportedExtensions()

      expect(consoleSpy).toHaveBeenCalledWith('Error getting supported extensions:', error)

      consoleSpy.mockRestore()
    })
  })

  describe('integration with existing FilePresenter functionality', () => {
    it('should not interfere with existing methods', async () => {
      // Test that existing functionality still works
      expect(typeof filePresenter.getMimeType).toBe('function')
      expect(typeof filePresenter.createFileAdapter).toBe('function')
      expect(typeof filePresenter.prepareFile).toBe('function')
      expect(typeof filePresenter.isDirectory).toBe('function')
    })

    it('should maintain backward compatibility', () => {
      // Ensure new methods don't break existing interface
      const presenter = new FilePresenter()
      expect(presenter).toHaveProperty('validateFileForKnowledgeBase')
      expect(presenter).toHaveProperty('getSupportedExtensions')
    })
  })
})
