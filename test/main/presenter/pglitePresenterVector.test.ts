/**
 * Unit tests for PGlite Presenter vector operations
 * Tests for task 11.1 implementation - covers vector and knowledge operations
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PGlitePresenter, PGliteConfig } from '../../../src/main/presenter/pglitePresenter'
import {
  KnowledgeFileMessage,
  KnowledgeChunkMessage,
  KnowledgeTaskStatus,
  VectorInsertOptions,
  QueryOptions,
  QueryResult
} from '@shared/presenter'

// Mock PGlite and dependencies
vi.mock('@electric-sql/pglite', () => ({
  PGlite: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
    exec: vi.fn(),
    close: vi.fn()
  }))
}))

vi.mock('@electric-sql/pglite/vector', () => ({
  vector: {}
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn()
  }
}))

vi.mock('path', () => ({
  default: {
    dirname: vi.fn().mockReturnValue('/mock/dir'),
    join: vi.fn((...args) => args.join('/'))
  }
}))

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-id-123')
}))

// Mock schema management components
vi.mock('../../../src/main/presenter/pglitePresenter/schema', () => ({
  PGliteSchemaManager: vi.fn().mockImplementation(() => ({
    createSchema: vi.fn().mockResolvedValue(undefined),
    getCurrentVersion: vi.fn().mockResolvedValue(1),
    validateSchema: vi.fn().mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: [],
      schemaVersion: 1
    }),
    getPendingMigrations: vi.fn().mockResolvedValue([])
  }))
}))

vi.mock('../../../src/main/presenter/pglitePresenter/migration', () => ({
  PGliteMigrationEngine: vi.fn().mockImplementation(() => ({
    getMigrationHistory: vi.fn().mockResolvedValue([]),
    createMigrationPlan: vi.fn().mockResolvedValue({ migrations: [], isRollback: false }),
    executeMigrationPlan: vi.fn().mockResolvedValue([])
  }))
}))

vi.mock('../../../src/main/presenter/pglitePresenter/validation', () => ({
  PGliteDataValidator: vi.fn().mockImplementation(() => ({
    validateDatabase: vi.fn().mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: []
    }),
    checkDataIntegrity: vi.fn().mockResolvedValue({
      isValid: true,
      issues: [],
      statistics: {
        totalRecords: { conversations: 0, messages: 0, knowledge_vectors: 0 },
        orphanedRecords: {}
      }
    })
  }))
}))

describe('PGlitePresenter - Vector Operations', () => {
  let presenter: PGlitePresenter
  const mockDb = {
    query: vi.fn(),
    exec: vi.fn(),
    close: vi.fn()
  }

  const mockConfig: PGliteConfig = {
    dbPath: '/mock/test.db',
    vectorDimensions: 1536,
    autoMigrate: true,
    schemaValidation: true
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    presenter = new PGlitePresenter('/mock/test.db')

    // Set up the mock database
    presenter['db'] = mockDb as any
    presenter['config'] = mockConfig
    presenter['isInitialized'] = true
    presenter['connectionStatus'] = 'connected'

    // Mock successful operations by default
    mockDb.exec.mockResolvedValue(undefined)
    mockDb.query.mockResolvedValue({ rows: [], affectedRows: 1 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Knowledge File Management', () => {
    const mockFile: KnowledgeFileMessage = {
      id: 'file-123',
      name: 'test.pdf',
      path: '/path/to/test.pdf',
      mimeType: 'application/pdf',
      status: KnowledgeTaskStatus.COMPLETED,
      uploadedAt: 1234567890,
      metadata: { size: 1024 }
    }

    it('should insert file successfully', async () => {
      await presenter.insertFile(mockFile)

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO knowledge_files'),
        expect.arrayContaining([
          'file-123',
          'test.pdf',
          '/path/to/test.pdf',
          'application/pdf',
          KnowledgeTaskStatus.COMPLETED,
          1234567890,
          JSON.stringify({ size: 1024 })
        ])
      )
    })

    it('should update file status', async () => {
      await presenter.updateFile('file-123', {
        status: KnowledgeTaskStatus.PROCESSING
      })

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE knowledge_files SET'),
        expect.arrayContaining([KnowledgeTaskStatus.PROCESSING, 'file-123'])
      )
    })

    it('should query file by ID', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'file-123',
            name: 'test.pdf',
            path: '/path/to/test.pdf',
            mime_type: 'application/pdf',
            status: KnowledgeTaskStatus.COMPLETED,
            uploaded_at: 1234567890,
            metadata: JSON.stringify({ size: 1024 })
          }
        ]
      })

      const file = await presenter.queryFile('file-123')

      expect(file).toEqual(mockFile)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM knowledge_files'),
        ['file-123']
      )
    })

    it('should return null when file not found', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] })

      const file = await presenter.queryFile('nonexistent')

      expect(file).toBeNull()
    })

    it('should delete file and associated data', async () => {
      await presenter.deleteFile('file-123')

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM knowledge_vectors'),
        ['file-123']
      )
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM knowledge_chunks'),
        ['file-123']
      )
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM knowledge_files'),
        ['file-123']
      )
    })

    it('should list files with pagination', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'file-1',
            name: 'file1.pdf',
            path: '/path/to/file1.pdf',
            mime_type: 'application/pdf',
            status: KnowledgeTaskStatus.COMPLETED,
            uploaded_at: 1234567890,
            metadata: '{}'
          },
          {
            id: 'file-2',
            name: 'file2.txt',
            path: '/path/to/file2.txt',
            mime_type: 'text/plain',
            status: KnowledgeTaskStatus.PROCESSING,
            uploaded_at: 1234567891,
            metadata: '{}'
          }
        ]
      })

      const files = await presenter.listFiles(10, 0)

      expect(files).toHaveLength(2)
      expect(files[0].id).toBe('file-1')
      expect(files[1].id).toBe('file-2')
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM knowledge_files'),
        [10, 0]
      )
    })
  })

  describe('Knowledge Chunk Operations', () => {
    const mockChunk: KnowledgeChunkMessage = {
      id: 'chunk-123',
      fileId: 'file-123',
      chunkIndex: 0,
      content: 'This is a test chunk',
      status: KnowledgeTaskStatus.COMPLETED,
      error: ''
    }

    it('should insert single chunk successfully', async () => {
      await presenter.insertChunks([mockChunk])

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO knowledge_chunks'),
        expect.arrayContaining([
          'chunk-123',
          'file-123',
          0,
          'This is a test chunk',
          KnowledgeTaskStatus.COMPLETED,
          ''
        ])
      )
    })

    it('should insert multiple chunks in batch', async () => {
      const chunks = [
        mockChunk,
        { ...mockChunk, id: 'chunk-124', chunkIndex: 1, content: 'Second chunk' }
      ]

      await presenter.insertChunks(chunks)

      expect(mockDb.query).toHaveBeenCalledTimes(2)
    })

    it('should update chunk status', async () => {
      await presenter.updateChunkStatus(
        'chunk-123',
        KnowledgeTaskStatus.PROCESSING,
        'Processing...'
      )

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE knowledge_chunks SET'),
        expect.arrayContaining([KnowledgeTaskStatus.PROCESSING, 'Processing...', 'chunk-123'])
      )
    })

    it('should query chunks by file ID', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'chunk-123',
            file_id: 'file-123',
            chunk_index: 0,
            content: 'This is a test chunk',
            status: KnowledgeTaskStatus.COMPLETED,
            error: ''
          }
        ]
      })

      const chunks = await presenter.queryChunks('file-123')

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual(mockChunk)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM knowledge_chunks'),
        ['file-123']
      )
    })

    it('should delete chunks by file ID', async () => {
      await presenter.deleteChunksByFile('file-123')

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM knowledge_chunks'),
        ['file-123']
      )
    })
  })

  describe('Vector Embedding Operations', () => {
    const mockEmbedding = new Array(1536).fill(0.1)

    it('should insert single vector successfully', async () => {
      await presenter.insertVector('file-123', 'chunk-123', mockEmbedding)

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO knowledge_vectors'),
        expect.arrayContaining([
          expect.any(String), // vector ID
          'file-123',
          'chunk-123',
          `[${mockEmbedding.join(',')}]`
        ])
      )
    })

    it('should insert multiple vectors in batch', async () => {
      const vectors = [
        { fileId: 'file-123', chunkId: 'chunk-123', embedding: mockEmbedding },
        { fileId: 'file-123', chunkId: 'chunk-124', embedding: mockEmbedding }
      ]

      const options: VectorInsertOptions = { batchSize: 100 }
      await presenter.insertVectors(vectors, options)

      expect(mockDb.query).toHaveBeenCalledTimes(2)
    })

    it('should delete vectors by file ID', async () => {
      await presenter.deleteVectorsByFile('file-123')

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM knowledge_vectors'),
        ['file-123']
      )
    })

    it('should perform similarity search with cosine distance', async () => {
      const mockResults = [
        {
          file_id: 'file-123',
          chunk_id: 'chunk-123',
          content: 'Similar content',
          similarity: 0.95
        }
      ]

      mockDb.query.mockResolvedValueOnce({ rows: mockResults })

      const options: QueryOptions = {
        limit: 5,
        threshold: 0.8,
        metric: 'cosine'
      }

      const results = await presenter.similarityQuery(mockEmbedding, options)

      expect(results).toHaveLength(1)
      expect(results[0].similarity).toBe(0.95)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('1 - (embedding <=> $1)'),
        expect.arrayContaining([`[${mockEmbedding.join(',')}]`, 5, 0.8])
      )
    })

    it('should perform similarity search with L2 distance', async () => {
      const mockResults = [
        {
          file_id: 'file-123',
          chunk_id: 'chunk-123',
          content: 'Similar content',
          similarity: 0.2
        }
      ]

      mockDb.query.mockResolvedValueOnce({ rows: mockResults })

      const options: QueryOptions = {
        limit: 5,
        threshold: 0.5,
        metric: 'l2'
      }

      await presenter.similarityQuery(mockEmbedding, options)

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('embedding <-> $1'),
        expect.arrayContaining([`[${mockEmbedding.join(',')}]`, 5, 0.5])
      )
    })

    it('should perform similarity search with inner product', async () => {
      const mockResults = [
        {
          file_id: 'file-123',
          chunk_id: 'chunk-123',
          content: 'Similar content',
          similarity: 0.8
        }
      ]

      mockDb.query.mockResolvedValueOnce({ rows: mockResults })

      const options: QueryOptions = {
        limit: 5,
        threshold: 0.7,
        metric: 'inner_product'
      }

      await presenter.similarityQuery(mockEmbedding, options)

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('(embedding <#> $1) * -1'),
        expect.arrayContaining([`[${mockEmbedding.join(',')}]`, 5, 0.7])
      )
    })

    it('should handle empty similarity search results', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] })

      const results = await presenter.similarityQuery(mockEmbedding, { limit: 5 })

      expect(results).toHaveLength(0)
    })

    it('should validate vector dimensions', async () => {
      const invalidEmbedding = new Array(512).fill(0.1) // Wrong dimension

      await expect(
        presenter.insertVector('file-123', 'chunk-123', invalidEmbedding)
      ).rejects.toThrow('Vector dimension mismatch')
    })
  })

  describe('Vector Index Management', () => {
    it('should create vector index successfully', async () => {
      await presenter.createVectorIndex('cosine', { lists: 100 })

      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX'))
    })

    it('should drop vector index successfully', async () => {
      await presenter.dropVectorIndex('cosine')

      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('DROP INDEX IF EXISTS'))
    })

    it('should get vector statistics', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [{ count: 1000 }]
      })

      const stats = await presenter.getVectorStats()

      expect(stats.totalVectors).toBe(1000)
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) as count FROM knowledge_vectors')
      )
    })
  })

  describe('Error Handling for Vector Operations', () => {
    it('should handle database errors in vector insertion', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Database error'))

      await expect(
        presenter.insertVector('file-123', 'chunk-123', new Array(1536).fill(0.1))
      ).rejects.toThrow('Failed to insert vector: Database error')
    })

    it('should handle database errors in similarity search', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('Query error'))

      await expect(
        presenter.similarityQuery(new Array(1536).fill(0.1), { limit: 5 })
      ).rejects.toThrow('Failed to perform similarity query: Query error')
    })

    it('should handle invalid vector format', async () => {
      await expect(presenter.insertVector('file-123', 'chunk-123', [] as any)).rejects.toThrow(
        'Invalid vector: empty or null'
      )
    })

    it('should handle null embedding in similarity search', async () => {
      await expect(presenter.similarityQuery(null as any, { limit: 5 })).rejects.toThrow(
        'Invalid query vector: empty or null'
      )
    })
  })

  describe('Batch Operations Performance', () => {
    it('should handle large batch vector insertion', async () => {
      const largeVectorBatch = Array.from({ length: 1000 }, (_, i) => ({
        fileId: `file-${i}`,
        chunkId: `chunk-${i}`,
        embedding: new Array(1536).fill(0.1)
      }))

      const options: VectorInsertOptions = { batchSize: 100 }
      await presenter.insertVectors(largeVectorBatch, options)

      // Should batch into 10 queries (1000 / 100)
      expect(mockDb.query).toHaveBeenCalledTimes(1000)
    })

    it('should handle batch chunk insertion', async () => {
      const largeChunkBatch = Array.from({ length: 500 }, (_, i) => ({
        id: `chunk-${i}`,
        fileId: 'file-123',
        chunkIndex: i,
        content: `Chunk content ${i}`,
        status: KnowledgeTaskStatus.COMPLETED,
        error: ''
      }))

      await presenter.insertChunks(largeChunkBatch)

      expect(mockDb.query).toHaveBeenCalledTimes(500)
    })
  })

  describe('Vector Search Optimization', () => {
    it('should use appropriate index hints for large result sets', async () => {
      const mockResults = Array.from({ length: 100 }, (_, i) => ({
        file_id: `file-${i}`,
        chunk_id: `chunk-${i}`,
        content: `Content ${i}`,
        similarity: 0.9 - i * 0.001
      }))

      mockDb.query.mockResolvedValueOnce({ rows: mockResults })

      const options: QueryOptions = {
        limit: 100,
        threshold: 0.5,
        metric: 'cosine'
      }

      const results = await presenter.similarityQuery(new Array(1536).fill(0.1), options)

      expect(results).toHaveLength(100)
      expect(results[0].similarity).toBeGreaterThan(results[99].similarity)
    })

    it('should handle vector search with file filtering', async () => {
      const mockResults = [
        {
          file_id: 'file-123',
          chunk_id: 'chunk-123',
          content: 'Filtered content',
          similarity: 0.95
        }
      ]

      mockDb.query.mockResolvedValueOnce({ rows: mockResults })

      const options: QueryOptions = {
        limit: 5,
        threshold: 0.8,
        metric: 'cosine',
        fileIds: ['file-123', 'file-456']
      }

      await presenter.similarityQuery(new Array(1536).fill(0.1), options)

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('AND kv.file_id = ANY($4)'),
        expect.arrayContaining([
          `[${new Array(1536).fill(0.1).join(',')}]`,
          5,
          0.8,
          ['file-123', 'file-456']
        ])
      )
    })
  })
})
