import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import { KnowledgeService } from '../../../src/main/knowledge'
import type { FileValidationResult } from '../../../src/shared/types/knowledge'
import { KnowledgeDatabase } from '../../../src/main/knowledge/database/knowledgeDatabase'
import { KnowledgeBase } from '../../../src/main/knowledge/knowledgeBase'
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

// Mock KnowledgeDatabase
vi.mock('../../../src/main/knowledge/database/knowledgeDatabase', () => ({
  KnowledgeDatabase: vi.fn().mockImplementation(function () {
    return {
      open: vi.fn(),
      initialize: vi.fn(),
      close: vi.fn()
    }
  })
}))

// Mock KnowledgeBase
vi.mock('../../../src/main/knowledge/knowledgeBase', () => ({
  KnowledgeBase: vi.fn().mockImplementation(() => ({
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

// Mock KnowledgeTaskQueue
vi.mock('../../../src/main/knowledge/taskQueue', () => ({
  KnowledgeTaskQueue: vi.fn().mockImplementation(() => ({
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
const mockProviderSettings = {
  getKnowledgeConfigs: vi.fn(),
  diffKnowledgeConfigs: vi.fn(),
  setKnowledgeConfigs: vi.fn()
} as any

const mockFileService = {
  validateFileForKnowledgeBase: vi.fn(),
  getSupportedExtensions: vi.fn()
} as any

const mockDialogPresenter = {
  showDialog: vi.fn()
} as any

const mockProviderRuntime = {
  getEmbeddings: vi.fn()
} as any

const mockEvents = {
  publishFileUpdated: vi.fn(),
  publishFileProgress: vi.fn()
}

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

describe('KnowledgeService Validation Methods', () => {
  let knowledgeService: KnowledgeService
  const mockDbDir = '/mock/db/dir'

  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      KnowledgeDatabase as unknown as {
        mockImplementation: (factory: () => unknown) => void
      }
    ).mockImplementation(() => ({
      open: vi.fn(),
      initialize: vi.fn(),
      close: vi.fn()
    }))
    ;(
      KnowledgeBase as unknown as {
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
    ;(mockProviderSettings.getKnowledgeConfigs as Mock).mockReturnValue([])
    knowledgeService = new KnowledgeService({
      config: mockProviderSettings,
      storageRoot: mockDbDir,
      files: mockFileService,
      dialog: mockDialogPresenter,
      embeddings: mockProviderRuntime,
      events: mockEvents
    })
  })

  describe('validateFile', () => {
    it('should successfully validate a supported file', async () => {
      const mockFilePath = '/path/to/test.txt'
      const mockValidationResult: FileValidationResult = {
        isSupported: true,
        mimeType: 'text/plain',
        adapterType: 'TextFileAdapter'
      }

      ;(mockFileService.validateFileForKnowledgeBase as Mock).mockResolvedValue(
        mockValidationResult
      )

      const result = await knowledgeService.validateFile(mockFilePath)

      expect(mockFileService.validateFileForKnowledgeBase).toHaveBeenCalledWith(mockFilePath)
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

      ;(mockFileService.validateFileForKnowledgeBase as Mock).mockResolvedValue(
        mockValidationResult
      )

      const result = await knowledgeService.validateFile(mockFilePath)

      expect(mockFileService.validateFileForKnowledgeBase).toHaveBeenCalledWith(mockFilePath)
      expect(result).toEqual(mockValidationResult)
      expect(result.isSupported).toBe(false)
      expect(result.error).toBe('Unsupported file type')
    })

    it('should handle FileService validation errors gracefully', async () => {
      const mockFilePath = '/path/to/error.txt'
      const mockError = new Error('File validation service error')

      ;(mockFileService.validateFileForKnowledgeBase as Mock).mockRejectedValue(mockError)
      ;(mockFileService.getSupportedExtensions as Mock).mockReturnValue(['txt', 'md', 'pdf'])

      const result = await knowledgeService.validateFile(mockFilePath)

      expect(mockFileService.validateFileForKnowledgeBase).toHaveBeenCalledWith(mockFilePath)
      expect(result.isSupported).toBe(false)
      expect(result.error).toContain('File validation error: File validation service error')
      expect(result.suggestedExtensions).toEqual(['txt', 'md', 'pdf'])
    })

    it('should handle unknown errors gracefully', async () => {
      const mockFilePath = '/path/to/error.txt'
      const mockError = 'Unknown string error'

      ;(mockFileService.validateFileForKnowledgeBase as Mock).mockRejectedValue(mockError)
      ;(mockFileService.getSupportedExtensions as Mock).mockReturnValue(['txt', 'md'])

      const result = await knowledgeService.validateFile(mockFilePath)

      expect(result.isSupported).toBe(false)
      expect(result.error).toContain('File validation error: Unknown error')
      expect(result.suggestedExtensions).toEqual(['txt', 'md'])
    })
  })

  describe('getSupportedFileExtensions', () => {
    it('should return supported extensions from FileService', async () => {
      const mockExtensions = ['txt', 'md', 'markdown', 'pdf', 'docx', 'json']
      ;(mockFileService.getSupportedExtensions as Mock).mockReturnValue(mockExtensions)

      const result = await knowledgeService.getSupportedFileExtensions()

      expect(mockFileService.getSupportedExtensions).toHaveBeenCalled()
      expect(result).toEqual(mockExtensions)
    })

    it('should return fallback extensions when FileService fails', async () => {
      const mockError = new Error('FileService error')
      ;(mockFileService.getSupportedExtensions as Mock).mockImplementation(() => {
        throw mockError
      })

      const result = await knowledgeService.getSupportedFileExtensions()

      expect(mockFileService.getSupportedExtensions).toHaveBeenCalled()
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
      ;(mockFileService.getSupportedExtensions as Mock).mockImplementation(() => {
        throw 'Unknown error'
      })

      const result = await knowledgeService.getSupportedFileExtensions()

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
    it('should list files for configs saved through KnowledgeSettings', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      ;(mockProviderSettings.getKnowledgeConfigs as Mock).mockReturnValue([config])
      ;(knowledgeService as any).openKnowledgeDatabase = vi.fn().mockResolvedValue({})

      const result = await knowledgeService.listFiles(config.id)

      expect(result).toEqual([])
      expect(mockProviderSettings.getKnowledgeConfigs).toHaveBeenCalled()
    })

    it('should reuse one store creation when listFiles is called concurrently', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      ;(mockProviderSettings.getKnowledgeConfigs as Mock).mockReturnValue([config])
      const openKnowledgeDatabase = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({}), 0)
          })
      )
      ;(knowledgeService as any).openKnowledgeDatabase = openKnowledgeDatabase

      const results = await Promise.all([
        knowledgeService.listFiles(config.id),
        knowledgeService.listFiles(config.id)
      ])

      expect(results).toEqual([[], []])
      expect(openKnowledgeDatabase).toHaveBeenCalledTimes(1)
    })

    it('should keep throwing when the knowledge config id is missing', async () => {
      ;(mockProviderSettings.getKnowledgeConfigs as Mock).mockReturnValue([])

      await expect(knowledgeService.listFiles('missing-id')).rejects.toThrow(
        'Knowledge config not found for id: missing-id'
      )
    })

    it('should remove local storage when an in-flight store creation fails during delete', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      ;(knowledgeService as any).knowledgeBaseInitializations.set(
        config.id,
        Promise.reject(new Error('failed init'))
      )
      ;(fs.existsSync as Mock).mockReturnValue(true)

      await expect(knowledgeService.delete(config.id)).resolves.toBeUndefined()

      expect(fs.rmSync).toHaveBeenCalledWith('/mock/db/dir/KnowledgeBase/knowledge-1', {
        recursive: true
      })
      expect(fs.rmSync).toHaveBeenCalledWith('/mock/db/dir/KnowledgeBase/knowledge-1.wal', {
        recursive: true
      })
      expect((knowledgeService as any).knowledgeBaseInitializations.has(config.id)).toBe(false)
      expect((knowledgeService as any).knowledgeBases.has(config.id)).toBe(false)
    })

    it('should remove the init task before destroying a resolved store during delete', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      const destroy = vi.fn().mockImplementation(() => {
        expect((knowledgeService as any).knowledgeBaseInitializations.has(config.id)).toBe(false)
        return Promise.resolve()
      })
      ;(knowledgeService as any).knowledgeBaseInitializations.set(
        config.id,
        Promise.resolve({ destroy })
      )

      await expect(knowledgeService.delete(config.id)).resolves.toBeUndefined()

      expect(destroy).toHaveBeenCalled()
      expect((knowledgeService as any).knowledgeBases.has(config.id)).toBe(false)
    })

    it('should swallow rejected initialization when updating an enabled config', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      ;(knowledgeService as any).knowledgeBaseInitializations.set(
        config.id,
        Promise.reject(new Error('failed init'))
      )

      await expect(knowledgeService.update(config)).resolves.toBeUndefined()
    })

    it('should close cached store and clear cache when disabling after initialization failed', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      const close = vi.fn().mockResolvedValue(undefined)
      ;(knowledgeService as any).knowledgeBases.set(config.id, { close })
      ;(knowledgeService as any).knowledgeBaseInitializations.set(
        config.id,
        Promise.reject(new Error('failed init'))
      )

      await expect(knowledgeService.update({ ...config, enabled: false })).resolves.toBeUndefined()

      expect(close).toHaveBeenCalled()
      expect((knowledgeService as any).knowledgeBases.has(config.id)).toBe(false)
    })

    it('should close the vector database and preserve the error when store creation fails', async () => {
      const config = createKnowledgeConfig('knowledge-1')
      const close = vi.fn().mockResolvedValue(undefined)
      const error = new Error('store constructor failed')
      ;(mockProviderSettings.getKnowledgeConfigs as Mock).mockReturnValue([config])
      ;(knowledgeService as any).openKnowledgeDatabase = vi.fn().mockResolvedValue({ close })
      ;(KnowledgeBase as unknown as Mock).mockImplementationOnce(() => {
        throw error
      })

      await expect(knowledgeService.listFiles(config.id)).rejects.toBe(error)

      expect(close).toHaveBeenCalled()
      expect((knowledgeService as any).knowledgeBases.has(config.id)).toBe(false)
    })
  })
})
