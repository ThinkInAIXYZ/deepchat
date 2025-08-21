import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import { KnowledgePresenter } from '../../../src/main/presenter/knowledgePresenter'
import { IConfigPresenter, IFilePresenter } from '../../../src/shared/presenter'
import { FileValidationResult } from '../../../src/main/presenter/filePresenter/FileValidationService'

// Mock all external dependencies
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/user/data'),
    getAppPath: vi.fn().mockReturnValue('/mock/app/path')
  }
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    rmSync: vi.fn()
  }
}))

vi.mock('path', () => ({
  default: {
    join: vi.fn((...args) => args.join('/'))
  }
}))

// Mock the eventBus
vi.mock('../../../src/main/eventbus', () => ({
  eventBus: {
    on: vi.fn(),
    emit: vi.fn()
  }
}))

// Mock the presenter module to avoid circular dependencies
vi.mock('../../../src/main/presenter', () => ({
  presenter: {
    dialogPresenter: {
      showDialog: vi.fn()
    }
  }
}))

// Mock DuckDBPresenter
vi.mock('../../../src/main/presenter/knowledgePresenter/database/duckdbPresenter', () => ({
  DuckDBPresenter: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    initialize: vi.fn(),
    close: vi.fn()
  }))
}))

// Mock KnowledgeStorePresenter
vi.mock('../../../src/main/presenter/knowledgePresenter/knowledgeStorePresenter', () => ({
  KnowledgeStorePresenter: vi.fn().mockImplementation(() => ({
    addFile: vi.fn(),
    deleteFile: vi.fn(),
    reAddFile: vi.fn(),
    queryFile: vi.fn(),
    listFiles: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    similarityQuery: vi.fn(),
    pauseAllRunningTasks: vi.fn(),
    resumeAllPausedTasks: vi.fn(),
    updateConfig: vi.fn()
  }))
}))

// Mock KnowledgeTaskPresenter
vi.mock('../../../src/main/presenter/knowledgePresenter/knowledgeTaskPresenter', () => ({
  KnowledgeTaskPresenter: vi.fn().mockImplementation(() => ({
    getStatus: vi.fn().mockReturnValue({ totalTasks: 0 })
  }))
}))

// Mock text splitters
vi.mock('../../../src/main/lib/textsplitters', () => ({
  RecursiveCharacterTextSplitter: {
    getSeparatorsForLanguage: vi.fn().mockReturnValue(['\n\n', '\n', ' ', ''])
  },
  SupportedTextSplitterLanguages: ['javascript', 'python', 'markdown']
}))

// Mock vector utils
vi.mock('../../../src/main/utils/vector', () => ({
  getMetric: vi.fn().mockReturnValue('cosine')
}))

// Mock the dependencies
const mockConfigPresenter: IConfigPresenter = {
  getKnowledgeConfigs: vi.fn(),
  diffKnowledgeConfigs: vi.fn(),
  setKnowledgeConfigs: vi.fn()
} as any

const mockFilePresenter: IFilePresenter = {
  validateFileForKnowledgeBase: vi.fn(),
  getSupportedExtensions: vi.fn()
} as any

describe('KnowledgePresenter Validation Methods', () => {
  let knowledgePresenter: KnowledgePresenter
  const mockDbDir = '/mock/db/dir'

  beforeEach(() => {
    vi.clearAllMocks()
    knowledgePresenter = new KnowledgePresenter(mockConfigPresenter, mockDbDir, mockFilePresenter)
  })

  describe('validateFile', () => {
    it('should successfully validate a supported file', async () => {
      const mockFilePath = '/path/to/test.txt'
      const mockValidationResult: FileValidationResult = {
        isSupported: true,
        mimeType: 'text/plain',
        adapterType: 'TextFileAdapter'
      }

      ;(mockFilePresenter.validateFileForKnowledgeBase as Mock).mockResolvedValue(
        mockValidationResult
      )

      const result = await knowledgePresenter.validateFile(mockFilePath)

      expect(mockFilePresenter.validateFileForKnowledgeBase).toHaveBeenCalledWith(mockFilePath)
      expect(result).toEqual(mockValidationResult)
      expect(result.isSupported).toBe(true)
      expect(result.mimeType).toBe('text/plain')
    })

    it('should handle validation failure for unsupported file', async () => {
      const mockFilePath = '/path/to/unsupported.xyz'
      const mockValidationResult: FileValidationResult = {
        isSupported: false,
        error: 'Unsupported file type',
        suggestedExtensions: ['txt', 'md', 'pdf']
      }

      ;(mockFilePresenter.validateFileForKnowledgeBase as Mock).mockResolvedValue(
        mockValidationResult
      )

      const result = await knowledgePresenter.validateFile(mockFilePath)

      expect(mockFilePresenter.validateFileForKnowledgeBase).toHaveBeenCalledWith(mockFilePath)
      expect(result).toEqual(mockValidationResult)
      expect(result.isSupported).toBe(false)
      expect(result.error).toBe('Unsupported file type')
    })

    it('should handle FilePresenter validation errors gracefully', async () => {
      const mockFilePath = '/path/to/error.txt'
      const mockError = new Error('File validation service error')

      ;(mockFilePresenter.validateFileForKnowledgeBase as Mock).mockRejectedValue(mockError)
      ;(mockFilePresenter.getSupportedExtensions as Mock).mockReturnValue(['txt', 'md', 'pdf'])

      const result = await knowledgePresenter.validateFile(mockFilePath)

      expect(mockFilePresenter.validateFileForKnowledgeBase).toHaveBeenCalledWith(mockFilePath)
      expect(result.isSupported).toBe(false)
      expect(result.error).toContain('File validation error: File validation service error')
      expect(result.suggestedExtensions).toEqual(['txt', 'md', 'pdf'])
    })

    it('should handle unknown errors gracefully', async () => {
      const mockFilePath = '/path/to/error.txt'
      const mockError = 'Unknown string error'

      ;(mockFilePresenter.validateFileForKnowledgeBase as Mock).mockRejectedValue(mockError)
      ;(mockFilePresenter.getSupportedExtensions as Mock).mockReturnValue(['txt', 'md'])

      const result = await knowledgePresenter.validateFile(mockFilePath)

      expect(result.isSupported).toBe(false)
      expect(result.error).toContain('File validation error: Unknown error')
      expect(result.suggestedExtensions).toEqual(['txt', 'md'])
    })
  })

  describe('getSupportedFileExtensions', () => {
    it('should return supported extensions from FilePresenter', async () => {
      const mockExtensions = ['txt', 'md', 'markdown', 'pdf', 'docx', 'json']
      ;(mockFilePresenter.getSupportedExtensions as Mock).mockReturnValue(mockExtensions)

      const result = await knowledgePresenter.getSupportedFileExtensions()

      expect(mockFilePresenter.getSupportedExtensions).toHaveBeenCalled()
      expect(result).toEqual(mockExtensions)
    })

    it('should return fallback extensions when FilePresenter fails', async () => {
      const mockError = new Error('FilePresenter error')
      ;(mockFilePresenter.getSupportedExtensions as Mock).mockImplementation(() => {
        throw mockError
      })

      const result = await knowledgePresenter.getSupportedFileExtensions()

      expect(mockFilePresenter.getSupportedExtensions).toHaveBeenCalled()
      expect(result).toEqual([
        'c',
        'cpp',
        'css',
        'csv',
        'docx',
        'h',
        'html',
        'java',
        'js',
        'json',
        'markdown',
        'md',
        'pdf',
        'pptx',
        'py',
        'ts',
        'txt',
        'xlsx',
        'xml',
        'yaml',
        'yml'
      ])
    })

    it('should handle unknown errors and return fallback extensions', async () => {
      ;(mockFilePresenter.getSupportedExtensions as Mock).mockImplementation(() => {
        throw 'Unknown error'
      })

      const result = await knowledgePresenter.getSupportedFileExtensions()

      expect(result).toEqual([
        'c',
        'cpp',
        'css',
        'csv',
        'docx',
        'h',
        'html',
        'java',
        'js',
        'json',
        'markdown',
        'md',
        'pdf',
        'pptx',
        'py',
        'ts',
        'txt',
        'xlsx',
        'xml',
        'yaml',
        'yml'
      ])
    })
  })

  describe('integration with existing methods', () => {
    it('should not interfere with existing KnowledgePresenter functionality', () => {
      // Verify that the new methods don't break existing functionality
      expect(typeof knowledgePresenter.validateFile).toBe('function')
      expect(typeof knowledgePresenter.getSupportedFileExtensions).toBe('function')
      expect(typeof knowledgePresenter.addFile).toBe('function')
      expect(typeof knowledgePresenter.deleteFile).toBe('function')
      expect(typeof knowledgePresenter.listFiles).toBe('function')
    })
  })
})
