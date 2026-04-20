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

  const sessionClient = {
    restore: vi.fn().mockResolvedValue({
      session: { id: 's1' },
      messages: []
    })
  }
  const streamListeners = {
    updated: [] as Array<(payload: any) => void>,
    completed: [] as Array<(payload: any) => void>,
    failed: [] as Array<(payload: any) => void>
  }
  const ipcListeners = {
    end: [] as Array<(event: unknown, payload: any) => void>,
    error: [] as Array<(event: unknown, payload: any) => void>
  }
  const chatClient = {
    onStreamUpdated: vi.fn((listener: (payload: any) => void) => {
      streamListeners.updated.push(listener)
      return () => undefined
    }),
    onStreamCompleted: vi.fn((listener: (payload: any) => void) => {
      streamListeners.completed.push(listener)
      return () => undefined
    }),
    onStreamFailed: vi.fn((listener: (payload: any) => void) => {
      streamListeners.failed.push(listener)
      return () => undefined
    })
  }

  vi.doMock('pinia', async () => {
    const actual = await vi.importActual<typeof import('pinia')>('pinia')
    return {
      ...actual,
      defineStore: (_id: string, setup: () => unknown) => setup
    }
  })

  vi.doMock('../../../src/renderer/api/SessionClient', () => ({
    SessionClient: vi.fn(() => sessionClient)
  }))
  vi.doMock('../../../src/renderer/api/ChatClient', () => ({
    ChatClient: vi.fn(() => chatClient)
  }))

  ;(window as any).electron = {
    ipcRenderer: {
      on: vi.fn((channel: string, listener: (event: unknown, payload: any) => void) => {
        if (channel === 'stream:end') {
          ipcListeners.end.push(listener)
        }
        if (channel === 'stream:error') {
          ipcListeners.error.push(listener)
        }
      }),
      removeListener: vi.fn()
    }
  }
  const { useMessageStore } = await import('@/stores/ui/message')
  const store = useMessageStore()
  return { store, sessionClient, streamListeners, ipcListeners }
}

describe('messageStore', () => {
  it('accepts stream updates after active-session sync and before persisted hydration', async () => {
    const { store, streamListeners } = await setupStore()
    store.setCurrentSessionId('s1')

    const responseHandler = streamListeners.updated[0]
    expect(typeof responseHandler).toBe('function')

    responseHandler({
      sessionId: 's1',
      requestId: 'm1',
      messageId: 'm1',
      updatedAt: 1,
      blocks: [
        {
          type: 'content',
          content: 'hello',
          status: 'pending',
          timestamp: 1
        }
      ]
    })

    expect(store.isStreaming.value).toBe(true)
    expect(store.currentStreamMessageId.value).toBe('m1')
    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.id).toBe('m1')
  })

  it('loadMessages only hydrates persisted messages', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      messages: [
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
      ]
    })

    await store.loadMessages('s1')

    expect(sessionClient.restore).toHaveBeenCalledWith('s1')
    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.metadata).toContain('"messageType":"compaction"')
  })

  it('ignores stale loadMessages results', async () => {
    const { store, sessionClient } = await setupStore()
    const firstLoad = createDeferred<any[]>()
    const secondLoad = createDeferred<any[]>()

    sessionClient.restore
      .mockReturnValueOnce(
        firstLoad.promise.then((messages) => ({
          session: { id: 's1' },
          messages
        }))
      )
      .mockReturnValueOnce(
        secondLoad.promise.then((messages) => ({
          session: { id: 's1' },
          messages
        }))
      )

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

  it('increments lastPersistedRevision for same-length persisted reloads', async () => {
    const { store, sessionClient } = await setupStore()
    const firstPayload = [
      {
        id: 'm1',
        sessionId: 's1',
        orderSeq: 1,
        role: 'assistant',
        content: '[{"type":"content","content":"first","status":"success","timestamp":1}]',
        status: 'sent',
        isContextEdge: 0,
        metadata: '{"totalTokens":1}',
        traceCount: 0,
        createdAt: 1,
        updatedAt: 1
      }
    ]
    const secondPayload = [
      {
        ...firstPayload[0],
        content: '[{"type":"content","content":"second","status":"success","timestamp":1}]',
        metadata: '{"totalTokens":2}'
      }
    ]

    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: firstPayload
      })
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: secondPayload
      })

    await store.loadMessages('s1')
    const firstRevision = store.lastPersistedRevision.value

    await store.loadMessages('s1')

    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.content).toContain('second')
    expect(store.lastPersistedRevision.value).toBe(firstRevision + 1)
  })

  it('keeps rate-limit stream messages ephemeral and skips message hydration', async () => {
    const { store, streamListeners } = await setupStore()
    await store.loadMessages('s1')
    const responseHandler = streamListeners.updated[0]

    expect(typeof responseHandler).toBe('function')

    responseHandler({
      sessionId: 's1',
      requestId: '__rate_limit__:s1:1',
      messageId: '__rate_limit__:s1:1',
      updatedAt: 1,
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
    })

    expect(store.isStreaming.value).toBe(true)
    expect(store.currentStreamMessageId.value).toBe('__rate_limit__:s1:1')
    expect(store.streamingBlocks.value).toHaveLength(1)
    expect(store.messages.value).toHaveLength(0)

    responseHandler({
      sessionId: 's1',
      requestId: '__rate_limit__:s1:1',
      messageId: '__rate_limit__:s1:1',
      updatedAt: 2,
      blocks: []
    })

    expect(store.streamingBlocks.value).toEqual([])
    expect(store.messages.value).toHaveLength(0)
  })

  it('accepts stream updates for the loaded session before any active-session sync', async () => {
    const { store, streamListeners } = await setupStore()
    await store.loadMessages('s1')

    const responseHandler = streamListeners.updated[0]
    expect(typeof responseHandler).toBe('function')

    responseHandler({
      sessionId: 's1',
      requestId: '__rate_limit__:s1:1',
      messageId: '__rate_limit__:s1:1',
      updatedAt: 1,
      blocks: [
        {
          type: 'action',
          action_type: 'rate_limit',
          status: 'pending',
          timestamp: 1
        }
      ]
    })

    expect(store.isStreaming.value).toBe(true)
    expect(store.currentStreamMessageId.value).toBe('__rate_limit__:s1:1')
    expect(store.streamingBlocks.value).toHaveLength(1)
  })

  it('reloads persisted messages once when a typed stream completion arrives', async () => {
    const { store, sessionClient, streamListeners, ipcListeners } = await setupStore()
    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: []
      })
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: [
          {
            id: 'user-1',
            sessionId: 's1',
            orderSeq: 1,
            role: 'user',
            content: '{"text":"hello","files":[],"links":[],"search":false,"think":false}',
            status: 'sent',
            isContextEdge: 0,
            metadata: '{}',
            traceCount: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ]
      })

    await store.loadMessages('s1')

    expect(ipcListeners.end).toHaveLength(0)
    expect(ipcListeners.error).toHaveLength(0)

    const completionHandler = streamListeners.completed[0]
    expect(typeof completionHandler).toBe('function')

    completionHandler({
      sessionId: 's1',
      requestId: 'user-1',
      messageId: 'user-1',
      completedAt: 2
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sessionClient.restore).toHaveBeenCalledTimes(2)
    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.id).toBe('user-1')
  })

  it('reuses parsed assistant content and metadata until the record changes', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      messages: [
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
      ]
    })

    await store.loadMessages('s1')

    const firstRecord = store.messages.value[0]!
    const firstBlocks = store.getAssistantMessageBlocks(firstRecord)
    const firstMetadata = store.getMessageMetadata(firstRecord)

    expect(store.getAssistantMessageBlocks(firstRecord)).toBe(firstBlocks)
    expect(store.getMessageMetadata(firstRecord)).toBe(firstMetadata)

    const responseHandler = streamListeners.updated[0]

    responseHandler({
      sessionId: 's1',
      requestId: 'm1',
      messageId: 'm1',
      updatedAt: 2,
      blocks: [
        {
          type: 'content',
          content: 'updated',
          status: 'pending',
          timestamp: 2
        }
      ]
    })

    const updatedRecord = store.messages.value[0]!
    expect(store.streamRevision.value).toBeGreaterThan(0)
    expect(store.getAssistantMessageBlocks(updatedRecord)).not.toBe(firstBlocks)
    expect(store.getMessageMetadata(updatedRecord)).toBe(firstMetadata)
  })
})
