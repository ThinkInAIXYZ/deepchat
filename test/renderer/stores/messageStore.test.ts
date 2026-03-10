import { describe, expect, it, vi } from 'vitest'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    void innerReject
  })
  return { promise, resolve }
}

const setupStore = async () => {
  vi.resetModules()

  const newAgentPresenter = {
    getMessages: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue(null)
  }
  const activeSession = {
    activeSessionId: 's1'
  }

  vi.doMock('pinia', () => ({
    defineStore: (_id: string, setup: () => unknown) => setup
  }))

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => newAgentPresenter
  }))

  vi.doMock('@/stores/ui/session', () => ({
    useSessionStore: () => activeSession
  }))
  ;(window as any).electron = {
    ipcRenderer: {
      on: vi.fn(),
      removeListener: vi.fn()
    }
  }

  const { useMessageStore } = await import('@/stores/ui/message')
  const store = useMessageStore()
  return { store, newAgentPresenter }
}

describe('messageStore', () => {
  it('loadMessages only hydrates persisted messages', async () => {
    const { store, newAgentPresenter } = await setupStore()
    newAgentPresenter.getMessages.mockResolvedValueOnce([
      {
        id: 'm1',
        sessionId: 's1',
        orderSeq: 1,
        role: 'assistant',
        content: '[]',
        status: 'sent',
        isContextEdge: 0,
        metadata: '{"messageType":"compaction","compactionStatus":"compacted"}',
        traceCount: 0,
        createdAt: 1,
        updatedAt: 1
      }
    ])

    await store.loadMessages('s1')

    expect(newAgentPresenter.getMessages).toHaveBeenCalledWith('s1')
    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.metadata).toContain('"messageType":"compaction"')
  })

  it('ignores stale loadMessages results', async () => {
    const { store, newAgentPresenter } = await setupStore()
    const firstLoad = createDeferred<any[]>()
    const secondLoad = createDeferred<any[]>()

    newAgentPresenter.getMessages
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)

    const firstPromise = store.loadMessages('s1')
    const secondPromise = store.loadMessages('s1')

    secondLoad.resolve([
      {
        id: 'm2',
        sessionId: 's1',
        orderSeq: 2,
        role: 'user',
        content: '{"text":"latest","files":[],"links":[],"search":false,"think":false}',
        status: 'sent',
        isContextEdge: 0,
        metadata: '{}',
        traceCount: 0,
        createdAt: 2,
        updatedAt: 2
      }
    ])
    await secondPromise

    firstLoad.resolve([
      {
        id: 'm1',
        sessionId: 's1',
        orderSeq: 1,
        role: 'user',
        content: '{"text":"stale","files":[],"links":[],"search":false,"think":false}',
        status: 'sent',
        isContextEdge: 0,
        metadata: '{}',
        traceCount: 0,
        createdAt: 1,
        updatedAt: 1
      }
    ])
    await firstPromise

    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.id).toBe('m2')
  })
})
