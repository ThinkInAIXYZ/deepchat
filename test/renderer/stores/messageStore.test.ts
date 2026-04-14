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

  const agentSessionPresenter = {
    getMessages: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue(null)
  }
  const activeSession = {
    activeSessionId: 's1'
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })

  vi.doMock('@/composables/usePresenter', () => ({
    usePresenter: () => agentSessionPresenter
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
  return { store, agentSessionPresenter }
}

describe('messageStore', () => {
  it('loadMessages only hydrates persisted messages', async () => {
    const { store, agentSessionPresenter } = await setupStore()
    agentSessionPresenter.getMessages.mockResolvedValueOnce([
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

    expect(agentSessionPresenter.getMessages).toHaveBeenCalledWith('s1')
    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.metadata).toContain('"messageType":"compaction"')
  })

  it('ignores stale loadMessages results', async () => {
    const { store, agentSessionPresenter } = await setupStore()
    const firstLoad = createDeferred<any[]>()
    const secondLoad = createDeferred<any[]>()

    agentSessionPresenter.getMessages
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

  it('keeps rate-limit stream messages ephemeral and skips message hydration', async () => {
    const { store, agentSessionPresenter } = await setupStore()
    const responseHandler = (
      (window as any).electron.ipcRenderer.on as ReturnType<typeof vi.fn>
    ).mock.calls.find(([eventName]) => eventName === 'stream:response')?.[1]

    expect(typeof responseHandler).toBe('function')

    responseHandler(
      {},
      {
        conversationId: 's1',
        messageId: '__rate_limit__:s1:1',
        blocks: [
          {
            type: 'action',
            action_type: 'rate_limit',
            status: 'pending',
            timestamp: 1,
            extra: {
              providerId: 'openai',
              qpsLimit: 1,
              currentQps: 1,
              queueLength: 2,
              estimatedWaitTime: 4000
            }
          }
        ]
      }
    )

    expect(store.isStreaming.value).toBe(true)
    expect(store.currentStreamMessageId.value).toBe('__rate_limit__:s1:1')
    expect(store.streamingBlocks.value).toHaveLength(1)
    expect(store.messages.value).toHaveLength(0)
    expect(agentSessionPresenter.getMessage).not.toHaveBeenCalled()

    responseHandler(
      {},
      {
        conversationId: 's1',
        messageId: '__rate_limit__:s1:1',
        blocks: []
      }
    )

    expect(store.streamingBlocks.value).toEqual([])
    expect(store.messages.value).toHaveLength(0)
    expect(agentSessionPresenter.getMessage).not.toHaveBeenCalled()
  })

  it('reuses parsed assistant content and metadata until the record changes', async () => {
    const { store, agentSessionPresenter } = await setupStore()
    agentSessionPresenter.getMessages.mockResolvedValueOnce([
      {
        id: 'm1',
        sessionId: 's1',
        orderSeq: 1,
        role: 'assistant',
        content: '[{"type":"content","content":"hello","status":"success","timestamp":1}]',
        status: 'sent',
        isContextEdge: 0,
        metadata: '{"totalTokens":42}',
        traceCount: 0,
        createdAt: 1,
        updatedAt: 1
      }
    ])

    await store.loadMessages('s1')

    const firstRecord = store.messages.value[0]!
    const firstBlocks = store.getAssistantMessageBlocks(firstRecord)
    const firstMetadata = store.getMessageMetadata(firstRecord)

    expect(store.getAssistantMessageBlocks(firstRecord)).toBe(firstBlocks)
    expect(store.getMessageMetadata(firstRecord)).toBe(firstMetadata)

    const responseHandler = (
      (window as any).electron.ipcRenderer.on as ReturnType<typeof vi.fn>
    ).mock.calls.find(([eventName]) => eventName === 'stream:response')?.[1]

    responseHandler(
      {},
      {
        conversationId: 's1',
        messageId: 'm1',
        blocks: [
          {
            type: 'content',
            content: 'updated',
            status: 'pending',
            timestamp: 2
          }
        ]
      }
    )

    const updatedRecord = store.messages.value[0]!
    expect(store.streamRevision.value).toBeGreaterThan(0)
    expect(store.getAssistantMessageBlocks(updatedRecord)).not.toBe(firstBlocks)
    expect(store.getMessageMetadata(updatedRecord)).toBe(firstMetadata)
  })
})
