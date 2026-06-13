import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeStorePresenter } from '@/presenter/knowledgePresenter/knowledgeStorePresenter'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'

vi.mock('@/presenter', () => ({
  presenter: {
    filePresenter: {}
  }
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

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

  const vectorPresenter = {
    queryFile: vi.fn(async () => fileMessage),
    updateFile: vi.fn(async () => undefined),
    updateChunkStatus: vi.fn(async () => undefined)
  }

  const taskPresenter = {
    cancelTasksByFile: vi.fn()
  }

  const store = new KnowledgeStorePresenter(
    vectorPresenter as any,
    {
      id: 'knowledge-1',
      chunkSize: 1000,
      chunkOverlap: 100,
      separators: ['\n']
    } as any,
    taskPresenter as any
  )

  return { fileMessage, store, vectorPresenter }
}

function getPublishedEventPayloads(eventName: string) {
  return vi
    .mocked(publishDeepchatEvent)
    .mock.calls.filter(([name]) => name === eventName)
    .map(([, payload]) => payload)
}

describe('KnowledgeStorePresenter events', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes typed progress and file update events when a file finishes', async () => {
    const { fileMessage, store, vectorPresenter } = createStore()
    ;(store as any).fileProgressMap.set('file-1', {
      completed: 0,
      error: 0,
      total: 1
    })

    await (store as any).handleChunkCompletion('file-1_0', 'file-1')

    expect(getPublishedEventPayloads('knowledge.file.progress')).toContainEqual({
      fileId: 'file-1',
      completed: 1,
      error: 0,
      total: 1,
      version: Date.now()
    })
    expect(vectorPresenter.updateFile).toHaveBeenCalledWith({
      ...fileMessage,
      status: 'completed'
    })
    expect(getPublishedEventPayloads('knowledge.file.updated')).toContainEqual(
      expect.objectContaining({
        id: 'file-1',
        status: 'completed',
        version: Date.now()
      })
    )
  })

  it('publishes typed progress when a chunk fails', async () => {
    const { store, vectorPresenter } = createStore()
    ;(store as any).fileProgressMap.set('file-1', {
      completed: 0,
      error: 0,
      total: 2
    })

    await (store as any).handleChunkError('file-1_0', 'file-1', 'embedding failed')

    expect(vectorPresenter.updateChunkStatus).toHaveBeenCalledWith(
      'file-1_0',
      'error',
      'embedding failed'
    )
    expect(getPublishedEventPayloads('knowledge.file.progress')).toContainEqual({
      fileId: 'file-1',
      completed: 0,
      error: 1,
      total: 2,
      version: Date.now()
    })
  })
})
