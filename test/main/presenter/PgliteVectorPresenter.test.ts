import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PgliteVectorPresenter } from '@/presenter/pglitePresenter/PgliteVectorPresenter'
import fs from 'fs'
import path from 'path'
import {
  VectorInsertOptions,
  QueryOptions,
  KnowledgeFileMessage,
  KnowledgeChunkMessage,
  IndexOptions
} from '@shared/presenter'

// Mock PGLite
vi.mock('@electric-sql/pglite', () => ({
  PGlite: vi.fn().mockImplementation(() => ({
    exec: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn().mockImplementation((fn) => fn()),
    close: vi.fn().mockResolvedValue(undefined)
  }))
}))

// Mock vector extension
vi.mock('@electric-sql/pglite/vector', () => ({
  vector: {}
}))

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn()
  }
}))

describe('PgliteVectorPresenter', () => {
  let presenter: PgliteVectorPresenter
  const testDbPath = '/tmp/test_vector.pglite'

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock fs.existsSync to return false for clean setup
    vi.mocked(fs.existsSync).mockReturnValue(false)
    presenter = new PgliteVectorPresenter(testDbPath)
  })

  afterEach(async () => {
    if (presenter) {
      await presenter.close()
    }
  })

  describe('Interface Compatibility', () => {
    it('should implement IVectorDatabasePresenter interface', () => {
      // Check that all required methods exist
      expect(typeof presenter.initialize).toBe('function')
      expect(typeof presenter.open).toBe('function')
      expect(typeof presenter.close).toBe('function')
      expect(typeof presenter.destroy).toBe('function')
      expect(typeof presenter.insertVector).toBe('function')
      expect(typeof presenter.insertVectors).toBe('function')
      expect(typeof presenter.similarityQuery).toBe('function')
      expect(typeof presenter.deleteVectorsByFile).toBe('function')
      expect(typeof presenter.insertFile).toBe('function')
      expect(typeof presenter.updateFile).toBe('function')
      expect(typeof presenter.queryFile).toBe('function')
      expect(typeof presenter.queryFiles).toBe('function')
      expect(typeof presenter.listFiles).toBe('function')
      expect(typeof presenter.deleteFile).toBe('function')
      expect(typeof presenter.insertChunks).toBe('function')
      expect(typeof presenter.updateChunkStatus).toBe('function')
      expect(typeof presenter.queryChunks).toBe('function')
      expect(typeof presenter.deleteChunksByFile).toBe('function')
      expect(typeof presenter.pauseAllRunningTasks).toBe('function')
      expect(typeof presenter.resumeAllPausedTasks).toBe('function')
    })

    it('should initialize database with correct dimensions', async () => {
      const mockPgLite = (presenter as any).pgLite
      const indexOptions: IndexOptions = {
        metric: 'cosine',
        M: 16,
        efConstruction: 200
      }

      await presenter.initialize(1536, indexOptions)

      expect(mockPgLite.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE EXTENSION IF NOT EXISTS vector')
      )
      expect(mockPgLite.exec).toHaveBeenCalledWith(expect.stringContaining('vector(1536)'))
    })

    it('should open existing database', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      const mockPgLite = (presenter as any).pgLite

      await presenter.open()

      expect(mockPgLite.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE EXTENSION IF NOT EXISTS vector')
      )
    })
  })

  describe('File Operations', () => {
    it('should insert file with correct format', async () => {
      const mockPgLite = (presenter as any).pgLite
      const file: KnowledgeFileMessage = {
        id: 'file-id',
        name: 'test.txt',
        path: '/path/to/test.txt',
        mimeType: 'text/plain',
        status: 'processing',
        uploadedAt: Date.now(),
        metadata: { size: 1024, totalChunks: 5 }
      }

      await presenter.insertFile(file)

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO file'),
        expect.arrayContaining([
          file.id,
          file.name,
          file.path,
          file.mimeType,
          file.status,
          file.uploadedAt.toString(),
          JSON.stringify(file.metadata)
        ])
      )
    })

    it('should query file with correct format', async () => {
      const mockPgLite = (presenter as any).pgLite
      const mockFileRow = {
        id: 'file-id',
        name: 'test.txt',
        path: '/path/to/test.txt',
        mime_type: 'text/plain',
        status: 'completed',
        uploaded_at: '1234567890',
        metadata: JSON.stringify({ size: 1024, totalChunks: 5 })
      }

      mockPgLite.query.mockResolvedValueOnce({ rows: [mockFileRow] })

      const file = await presenter.queryFile('file-id')

      expect(file).toEqual({
        id: 'file-id',
        name: 'test.txt',
        path: '/path/to/test.txt',
        mimeType: 'text/plain',
        status: 'completed',
        uploadedAt: 1234567890,
        metadata: { size: 1024, totalChunks: 5 }
      })
    })

    it('should return null for non-existent file', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({ rows: [] })

      const file = await presenter.queryFile('non-existent')

      expect(file).toBeNull()
    })

    it('should list files in correct order', async () => {
      const mockPgLite = (presenter as any).pgLite
      const mockFiles = [
        {
          id: 'file1',
          name: 'test1.txt',
          path: '/path/to/test1.txt',
          mime_type: 'text/plain',
          status: 'completed',
          uploaded_at: '1234567890',
          metadata: '{}'
        }
      ]

      mockPgLite.query.mockResolvedValueOnce({ rows: mockFiles })

      const files = await presenter.listFiles()

      expect(files).toHaveLength(1)
      expect(files[0]).toEqual(
        expect.objectContaining({
          id: 'file1',
          name: 'test1.txt'
        })
      )
    })
  })

  describe('Chunk Operations', () => {
    it('should insert chunks in batch', async () => {
      const mockPgLite = (presenter as any).pgLite
      const chunks: KnowledgeChunkMessage[] = [
        {
          id: 'chunk1',
          fileId: 'file1',
          chunkIndex: 0,
          content: 'Content 1',
          status: 'processing'
        },
        {
          id: 'chunk2',
          fileId: 'file1',
          chunkIndex: 1,
          content: 'Content 2',
          status: 'processing'
        }
      ]

      await presenter.insertChunks(chunks)

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO chunk'),
        expect.arrayContaining([
          'chunk1',
          'file1',
          0,
          'Content 1',
          'processing',
          '',
          'chunk2',
          'file1',
          1,
          'Content 2',
          'processing',
          ''
        ])
      )
    })

    it('should update chunk status', async () => {
      const mockPgLite = (presenter as any).pgLite

      await presenter.updateChunkStatus('chunk1', 'completed')

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE chunk SET status'),
        ['completed', '', 'chunk1']
      )
    })

    it('should query chunks by conditions', async () => {
      const mockPgLite = (presenter as any).pgLite
      const mockChunks = [
        {
          id: 'chunk1',
          file_id: 'file1',
          chunk_index: 0,
          content: 'Content 1',
          status: 'completed',
          error: ''
        }
      ]

      mockPgLite.query.mockResolvedValueOnce({ rows: mockChunks })

      const chunks = await presenter.queryChunks({ fileId: 'file1' })

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        id: 'chunk1',
        fileId: 'file1',
        chunkIndex: 0,
        content: 'Content 1',
        status: 'completed',
        error: ''
      })
    })
  })

  describe('Vector Operations', () => {
    it('should insert single vector', async () => {
      const mockPgLite = (presenter as any).pgLite
      // Mock queryFile to return a file
      mockPgLite.query
        .mockResolvedValueOnce({ rows: [{ id: 'file1' }] }) // queryFile
        .mockResolvedValueOnce({ rows: [] }) // insertVector

      const vectorOptions: VectorInsertOptions = {
        vector: [0.1, 0.2, 0.3],
        fileId: 'file1',
        chunkId: 'chunk1'
      }

      await presenter.insertVector(vectorOptions)

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO vector'),
        expect.arrayContaining([
          expect.any(String), // nanoid
          '[0.1,0.2,0.3]',
          'file1',
          'chunk1'
        ])
      )
    })

    it('should insert multiple vectors in batch', async () => {
      const mockPgLite = (presenter as any).pgLite
      const vectors: VectorInsertOptions[] = [
        { vector: [0.1, 0.2], fileId: 'file1', chunkId: 'chunk1' },
        { vector: [0.3, 0.4], fileId: 'file1', chunkId: 'chunk2' }
      ]

      await presenter.insertVectors(vectors)

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO vector'),
        expect.arrayContaining([
          expect.any(String),
          '[0.1,0.2]',
          'file1',
          'chunk1',
          expect.any(String),
          '[0.3,0.4]',
          'file1',
          'chunk2'
        ])
      )
    })

    it('should perform similarity query with cosine distance', async () => {
      const mockPgLite = (presenter as any).pgLite
      const mockResults = [
        {
          id: 'vector1',
          distance: 0.1,
          content: 'Similar content',
          name: 'test.txt',
          path: '/path/to/test.txt'
        }
      ]

      mockPgLite.query.mockResolvedValueOnce({ rows: mockResults })

      const options: QueryOptions = {
        topK: 5,
        metric: 'cosine'
      }

      const results = await presenter.similarityQuery([0.1, 0.2, 0.3], options)

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual({
        id: 'vector1',
        distance: 0.1,
        metadata: {
          from: 'test.txt',
          filePath: '/path/to/test.txt',
          content: 'Similar content'
        }
      })

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('embedding <=> $1::vector'),
        expect.arrayContaining(['[0.1,0.2,0.3]', 5])
      )
    })

    it('should perform similarity query with L2 distance', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({ rows: [] })

      const options: QueryOptions = {
        topK: 5,
        metric: 'l2'
      }

      await presenter.similarityQuery([0.1, 0.2], options)

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('embedding <-> $1::vector'),
        expect.arrayContaining(['[0.1,0.2]', 5])
      )
    })

    it('should perform similarity query with inner product', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({ rows: [] })

      const options: QueryOptions = {
        topK: 5,
        metric: 'ip'
      }

      await presenter.similarityQuery([0.1, 0.2], options)

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('embedding <#> $1::vector'),
        expect.arrayContaining(['[0.1,0.2]', 5])
      )
    })
  })

  describe('Task Management', () => {
    it('should pause all running tasks', async () => {
      const mockPgLite = (presenter as any).pgLite

      await presenter.pauseAllRunningTasks()

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'paused' WHERE status = 'processing'")
      )
    })

    it('should resume all paused tasks', async () => {
      const mockPgLite = (presenter as any).pgLite

      await presenter.resumeAllPausedTasks()

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'processing' WHERE status = 'paused'")
      )
    })
  })

  describe('Database Management', () => {
    it('should destroy database and remove files', async () => {
      const mockPgLite = (presenter as any).pgLite
      vi.mocked(fs.existsSync).mockReturnValue(true)

      await presenter.destroy()

      expect(mockPgLite.close).toHaveBeenCalled()
      expect(fs.rmSync).toHaveBeenCalledWith(testDbPath, { recursive: true })
    })

    it('should set and get database metadata', async () => {
      const mockPgLite = (presenter as any).pgLite

      // Test setDatabaseMetadata
      await presenter.setDatabaseMetadata('test_key', 'test_value')

      expect(mockPgLite.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO metadata'),
        ['test_key', 'test_value']
      )

      // Test getDatabaseMetadata
      mockPgLite.query.mockResolvedValueOnce({
        rows: [{ key: 'test_key', value: 'test_value' }]
      })

      const metadata = await presenter.getDatabaseMetadata()

      expect(metadata).toEqual({ test_key: 'test_value' })
    })
  })

  describe('Error Handling', () => {
    it('should throw error when initializing existing database', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      await expect(presenter.initialize(1536)).rejects.toThrow(
        'Database already exists, cannot initialize again.'
      )
    })

    it('should throw error when opening non-existent database', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await expect(presenter.open()).rejects.toThrow(
        'Database does not exist, please initialize first.'
      )
    })

    it('should throw error when inserting vector for non-existent file', async () => {
      const mockPgLite = (presenter as any).pgLite
      mockPgLite.query.mockResolvedValueOnce({ rows: [] }) // queryFile returns null

      const vectorOptions: VectorInsertOptions = {
        vector: [0.1, 0.2],
        fileId: 'non-existent',
        chunkId: 'chunk1'
      }

      await expect(presenter.insertVector(vectorOptions)).rejects.toThrow(
        'File with ID non-existent does not exist'
      )
    })
  })

  describe('Data Conversion', () => {
    it('should convert between camelCase and snake_case correctly', () => {
      const camelToSnake = (key: string) =>
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

      expect(camelToSnake('fileId')).toBe('file_id')
      expect(camelToSnake('chunkIndex')).toBe('chunk_index')
      expect(camelToSnake('mimeType')).toBe('mime_type')
      expect(camelToSnake('uploadedAt')).toBe('uploaded_at')
    })

    it('should handle JSON metadata correctly', async () => {
      const mockPgLite = (presenter as any).pgLite
      const mockFileRow = {
        id: 'file-id',
        name: 'test.txt',
        path: '/path/to/test.txt',
        mime_type: 'text/plain',
        status: 'completed',
        uploaded_at: '1234567890',
        metadata: '{"size":1024,"totalChunks":5}'
      }

      mockPgLite.query.mockResolvedValueOnce({ rows: [mockFileRow] })

      const file = await presenter.queryFile('file-id')

      expect(file?.metadata).toEqual({ size: 1024, totalChunks: 5 })
    })
  })
})
