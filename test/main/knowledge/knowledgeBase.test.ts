import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeFileMessage } from '@shared/types/knowledge'
import { KnowledgeBase } from '@/knowledge/knowledgeBase'
import type {
  KnowledgeDatabasePort,
  KnowledgeEmbeddingPort,
  KnowledgeFilePort
} from '@/knowledge/ports'
import { KnowledgeTaskQueue } from '@/knowledge/taskQueue'

function createStore() {
  const files = new Map<string, KnowledgeFileMessage>()
  const saveFile = async (file: KnowledgeFileMessage) => {
    files.set(file.id, structuredClone(file))
  }
  const database = {
    queryFile: vi.fn(async (id: string) => files.get(id) ?? null),
    queryFiles: vi.fn(async () => []),
    insertFile: vi.fn(saveFile),
    updateFile: vi.fn(saveFile),
    deleteFile: vi.fn(async (id: string) => {
      files.delete(id)
    }),
    insertChunks: vi.fn(async () => undefined),
    updateChunkStatus: vi.fn(async () => undefined),
    insertVector: vi.fn(async () => undefined)
  }
  const taskQueue = new KnowledgeTaskQueue(1)
  const events = {
    publishFileUpdated: vi.fn(),
    publishFileProgress: vi.fn()
  }
  const embeddings = {
    getEmbeddings: vi.fn<KnowledgeEmbeddingPort['getEmbeddings']>(async () => [[0.1, 0.2]])
  }
  const filePort = {
    getMimeType: async () => 'text/markdown',
    prepareFileCompletely: async () => ({
      name: 'notes.md',
      content: 'A short note.',
      metadata: { fileSize: 13 }
    })
  }
  const store = new KnowledgeBase(
    database as unknown as KnowledgeDatabasePort,
    {
      id: 'knowledge-1',
      description: 'Notes',
      embedding: { providerId: 'provider-1', modelId: 'embedding-1' },
      dimensions: 2,
      normalized: false,
      fragmentsNumber: 5,
      enabled: true,
      chunkSize: 1000,
      chunkOverlap: 100,
      separators: ['\n']
    },
    taskQueue,
    filePort as KnowledgeFilePort,
    embeddings,
    events
  )
  return { database, embeddings, events, store, taskQueue }
}

describe('KnowledgeBase file processing', () => {
  let context: ReturnType<typeof createStore>

  beforeEach(() => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    context = createStore()
  })

  afterEach(() => {
    context.taskQueue.destroy()
  })

  it('stores vectors and publishes progress when an imported file finishes', async () => {
    const { database, events, store } = context
    const { data: file } = await store.addFile('/tmp/notes.md')

    await vi.waitFor(() =>
      expect(events.publishFileUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ id: file!.id, status: 'completed' })
      )
    )

    expect(database.insertVector).toHaveBeenCalledWith({
      vector: [0.1, 0.2],
      fileId: file!.id,
      chunkId: `${file!.id}_0`
    })
    expect(events.publishFileProgress).toHaveBeenCalledWith(file!.id, {
      completed: 1,
      error: 0,
      total: 1
    })
    expect((await store.queryFile(file!.id))?.status).toBe('completed')
  })

  it('records embedding failures and publishes failed chunk progress', async () => {
    const { database, embeddings, events, store } = context
    embeddings.getEmbeddings.mockRejectedValueOnce(new Error('embedding failed'))
    const { data: file } = await store.addFile('/tmp/notes.md')

    await vi.waitFor(() =>
      expect(events.publishFileProgress).toHaveBeenCalledWith(file!.id, {
        completed: 0,
        error: 1,
        total: 1
      })
    )
    expect(database.updateChunkStatus).toHaveBeenCalledWith(
      `${file!.id}_0`,
      'error',
      'embedding failed'
    )
    expect(database.insertVector).not.toHaveBeenCalled()
  })

  it('aborts an in-flight embedding request when its file is deleted', async () => {
    const { database, embeddings, events, store, taskQueue } = context
    const aborted = vi.fn()
    let finishRequest!: (vectors: number[][]) => void
    embeddings.getEmbeddings.mockImplementationOnce(
      (_providerId, _modelId, _texts, signal) =>
        new Promise((resolve, reject) => {
          finishRequest = resolve
          signal?.addEventListener(
            'abort',
            () => {
              aborted()
              reject(signal.reason)
            },
            { once: true }
          )
        })
    )

    try {
      const { data: file } = await store.addFile('/tmp/notes.md')
      await vi.waitFor(() => expect(embeddings.getEmbeddings).toHaveBeenCalledTimes(1))
      await store.deleteFile(file!.id)

      expect(aborted).toHaveBeenCalledTimes(1)
      expect(await store.queryFile(file!.id)).toBeNull()
      expect(taskQueue.getStatus().totalTasks).toBe(0)
      expect(database.insertVector).not.toHaveBeenCalled()
      expect(database.updateChunkStatus).not.toHaveBeenCalled()
      expect(events.publishFileProgress).not.toHaveBeenCalled()
    } finally {
      finishRequest?.([[0.1, 0.2]])
    }
  })
})
