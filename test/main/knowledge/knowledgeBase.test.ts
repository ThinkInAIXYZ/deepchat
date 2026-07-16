import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeBase } from '@/knowledge/knowledgeBase'

function createStore() {
  const fileMessage = {
    id: 'file-1',
    name: 'notes.md',
    path: '/tmp/notes.md',
    mimeType: 'text/markdown',
    status: 'processing',
    uploadedAt: Date.now(),
    metadata: {
      size: 100,
      totalChunks: 1
    }
  }

  const database = {
    queryFile: vi.fn(async () => fileMessage),
    updateFile: vi.fn(async () => undefined),
    updateChunkStatus: vi.fn(async () => undefined)
  }

  const taskQueue = {
    cancelTasksByFile: vi.fn()
  }

  const events = {
    publishFileUpdated: vi.fn(),
    publishFileProgress: vi.fn()
  }

  const store = new KnowledgeBase(
    database as any,
    {
      id: 'knowledge-1',
      chunkSize: 1000,
      chunkOverlap: 100,
      separators: ['\n']
    } as any,
    taskQueue as any,
    {} as any,
    {} as any,
    events
  )

  return { database, events, fileMessage, store }
}

describe('KnowledgeBase events', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes typed progress and file update events when a file finishes', async () => {
    const { database, events, fileMessage, store } = createStore()
    ;(store as any).fileProgressMap.set('file-1', {
      completed: 0,
      error: 0,
      total: 1
    })

    await (store as any).handleChunkCompletion('file-1_0', 'file-1')

    expect(events.publishFileProgress).toHaveBeenCalledWith('file-1', {
      completed: 1,
      error: 0,
      total: 1
    })
    expect(database.updateFile).toHaveBeenCalledWith({
      ...fileMessage,
      status: 'completed'
    })
    expect(events.publishFileUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-1', status: 'completed' })
    )
  })

  it('publishes typed progress when a chunk fails', async () => {
    const { database, events, store } = createStore()
    ;(store as any).fileProgressMap.set('file-1', {
      completed: 0,
      error: 0,
      total: 2
    })

    await (store as any).handleChunkError('file-1_0', 'file-1', 'embedding failed')

    expect(database.updateChunkStatus).toHaveBeenCalledWith('file-1_0', 'error', 'embedding failed')
    expect(events.publishFileProgress).toHaveBeenCalledWith('file-1', {
      completed: 0,
      error: 1,
      total: 2
    })
  })
})
