import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import { KnowledgePresenter } from '../../../src/main/presenter/knowledgePresenter'
import { IConfigPresenter, IFilePresenter } from '../../../src/shared/presenter'
import { FileValidationResult } from '../../../src/main/presenter/filePresenter/FileValidationService'
import { DuckDBPresenter } from '../../../src/main/presenter/knowledgePresenter/database/duckdbPresenter'
import { KnowledgeStorePresenter } from '../../../src/main/presenter/knowledgePresenter/knowledgeStorePresenter'
import fs from 'fs'

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
  DuckDBPresenter: vi.fn().mockImplementation(function () {
    return {
      open: vi.fn(),
      initialize: vi.fn(),
      close: vi.fn()
    }
  })
}))

// Mock KnowledgeStorePresenter
vi.mock('../../../src/main/presenter/knowledgePresenter/knowledgeStorePresenter', () => ({
  KnowledgeStorePresenter: vi.fn().mockImplementation(() => ({
    addFile: vi.fn(),
    deleteFile: vi.fn(),
    reAddFile: vi.fn(),
    queryFile: vi.fn(),
    listFiles: vi.fn().mockResolvedValue([]),
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

const createKnowledgeConfig = (id: string) => ({
  id,
  description: 'Local docs',
  embedding: {
    providerId: 'openai',
    modelId: 'text-embedding-3-small'
  },
  dimensions: 1536,
  normalized: true,
  fragmentsNumber: 6,
  enabled: true
})

describe('KnowledgePresenter Validation Methods', () => {
  let knowledgePresenter: KnowledgePresenter
  const mockDbDir = '/mock/db/dir'

  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      DuckDBPresenter as unknown as {
        mockImplementation: (factory: () => unknown) => void
      }
    ).mockImplementation(() => ({
      open: vi.fn(),
      initialize: vi.fn(),
      close: vi.fn()
    }))
    ;(
      KnowledgeStorePresenter as unknown as {
        mockImplementation: (factory: () => unknown) => void
      }
    ).mockImplementation(() => ({
      addFile: vi.fn(),
      deleteFile: vi.fn(),
      reAddFile: vi.fn(),
      queryFile: vi.fn(),
      listFiles: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
      destroy: vi.fn(),
      similarityQuery: vi.fn(),
      pauseAllRunningTasks: vi.fn(),
      resumeAllPausedTasks: vi.fn(),
      updateConfig: vi.fn()
    }))
    ;(mockConfigPresenter.getKnowledgeConfigs as Mock).mockReturnValue([])
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
    it('should list files for configs saved through ConfigPresenter', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      ;(mockConfigPresenter.getKnowledgeConfigs as Mock).mockReturnValue([config])
      ;(knowledgePresenter as any).getVectorDatabasePresenter = vi.fn().mockResolvedValue({})

      const result = await knowledgePresenter.listFiles(config.id)

      expect(result).toEqual([])
      expect(mockConfigPresenter.getKnowledgeConfigs).toHaveBeenCalled()
    })

    it('should reuse one store creation when listFiles is called concurrently', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      ;(mockConfigPresenter.getKnowledgeConfigs as Mock).mockReturnValue([config])
      const getVectorDatabasePresenter = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({}), 0)
          })
      )
      ;(knowledgePresenter as any).getVectorDatabasePresenter = getVectorDatabasePresenter

      const results = await Promise.all([
        knowledgePresenter.listFiles(config.id),
        knowledgePresenter.listFiles(config.id)
      ])

      expect(results).toEqual([[], []])
      expect(getVectorDatabasePresenter).toHaveBeenCalledTimes(1)
    })

    it('should keep throwing when the knowledge config id is missing', async () => {
      ;(mockConfigPresenter.getKnowledgeConfigs as Mock).mockReturnValue([])

      await expect(knowledgePresenter.listFiles('missing-id')).rejects.toThrow(
        'Knowledge config not found for id: missing-id'
      )
    })

    it('should remove local storage when an in-flight store creation fails during delete', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      ;(knowledgePresenter as any).storePresenterInitTasks.set(
        config.id,
        Promise.reject(new Error('failed init'))
      )
      ;(fs.existsSync as Mock).mockReturnValue(true)

      await expect(knowledgePresenter.delete(config.id)).resolves.toBeUndefined()

      expect(fs.rmSync).toHaveBeenCalledWith('/mock/db/dir/KnowledgeBase/knowledge-1', {
        recursive: true
      })
      expect(fs.rmSync).toHaveBeenCalledWith('/mock/db/dir/KnowledgeBase/knowledge-1.wal', {
        recursive: true
      })
    })

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
