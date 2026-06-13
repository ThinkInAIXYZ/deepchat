import { describe, expect, it, vi } from 'vitest'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    void innerReject
  })
  return { promise, resolve }
}

function buildUserMessage(id: string, sessionId: string, orderSeq: number, text: string) {
  return {
    id,
    sessionId,
    orderSeq,
    role: 'user' as const,
    content: JSON.stringify({ text, files: [], links: [], search: false, think: false }),
    status: 'sent' as const,
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: orderSeq,
    updatedAt: orderSeq
  }
}

const setupStore = async () => {
  vi.resetModules()

  const sessionClient = {
    restore: vi.fn().mockResolvedValue({
      session: { id: 's1' },
      messages: [],
      nextCursor: null,
      hasMore: false
    }),
    listMessagesPage: vi.fn().mockResolvedValue({
      messages: [],
      nextCursor: null,
      hasMore: false
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
    createSessionClient: vi.fn(() => sessionClient)
  }))
  vi.doMock('../../../src/renderer/api/ChatClient', () => ({
    createChatClient: vi.fn(() => chatClient)
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
      nextCursor: null,
      hasMore: false,
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

    expect(sessionClient.restore).toHaveBeenCalledWith('s1', 100)
    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.metadata).toContain('"messageType":"compaction"')
  })

  it('does not resort message ids when an existing message keeps the same order', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [buildUserMessage('m1', 's1', 1, 'hello')]
    })

    await store.loadMessages('s1')
    const sortSpy = vi.spyOn(store.messageIds.value, 'sort')
    streamListeners.updated[0]({
      sessionId: 's1',
      requestId: 'm1',
      messageId: 'm1',
      updatedAt: 2,
      blocks: [
        {
          type: 'content',
          content: 'streaming',
          status: 'pending',
          timestamp: 2
        }
      ]
    })

    expect(sortSpy).not.toHaveBeenCalled()
    expect(store.messageIds.value).toEqual(['m1'])
  })

  it('ignores stale loadMessages results', async () => {
    const { store, sessionClient } = await setupStore()
    const firstLoad = createDeferred<any[]>()
    const secondLoad = createDeferred<any[]>()

    sessionClient.restore
      .mockReturnValueOnce(
        firstLoad.promise.then((messages) => ({
          session: { id: 's1' },
          nextCursor: null,
          hasMore: false,
          messages
        }))
      )
      .mockReturnValueOnce(
        secondLoad.promise.then((messages) => ({
          session: { id: 's1' },
          nextCursor: null,
          hasMore: false,
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
        messages: firstPayload,
        nextCursor: null,
        hasMore: false
      })
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: secondPayload,
        nextCursor: null,
        hasMore: false
      })

    await store.loadMessages('s1')
    const firstRevision = store.lastPersistedRevision.value

    await store.loadMessages('s1')

    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.content).toContain('second')
    expect(store.lastPersistedRevision.value).toBe(firstRevision + 1)
  })

  it('preserves loaded history across same-session refreshes', async () => {
    const { store, sessionClient } = await setupStore()
    const olderMessages = Array.from({ length: 50 }, (_, index) =>
      buildUserMessage(`m${index + 1}`, 's1', index + 1, `older-${index + 1}`)
    )
    const recentMessages = Array.from({ length: 100 }, (_, index) =>
      buildUserMessage(`m${index + 51}`, 's1', index + 51, `recent-${index + 51}`)
    )

    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: recentMessages,
        nextCursor: { orderSeq: 51, id: 'm51' },
        hasMore: true
      })
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: [...olderMessages, ...recentMessages],
        nextCursor: null,
        hasMore: false
      })
    sessionClient.listMessagesPage.mockResolvedValueOnce({
      messages: olderMessages,
      nextCursor: null,
      hasMore: false
    })

    await store.loadMessages('s1')
    await store.loadOlderMessages()
    await store.loadMessages('s1')

    expect(sessionClient.restore).toHaveBeenNthCalledWith(2, 's1', 150)
    expect(store.messages.value).toHaveLength(150)
    expect(store.messages.value[0]?.id).toBe('m1')
    expect(store.messages.value[149]?.id).toBe('m150')
  })

  it('ignores stale older-history results after switching sessions', async () => {
    const { store, sessionClient } = await setupStore()
    const recentMessages = Array.from({ length: 100 }, (_, index) =>
      buildUserMessage(`s1-${index + 2}`, 's1', index + 2, `recent-${index + 2}`)
    )
    const olderPage = createDeferred<{
      messages: ReturnType<typeof buildUserMessage>[]
      nextCursor: null
      hasMore: false
    }>()

    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: recentMessages,
        nextCursor: { orderSeq: 2, id: 's1-2' },
        hasMore: true
      })
      .mockResolvedValueOnce({
        session: { id: 's2' },
        messages: [buildUserMessage('s2-only', 's2', 1, 'other-session')],
        nextCursor: null,
        hasMore: false
      })
    sessionClient.listMessagesPage.mockReturnValueOnce(olderPage.promise)

    await store.loadMessages('s1')
    void store.loadOlderMessages()

    store.clear()
    await store.loadMessages('s2')

    olderPage.resolve({
      messages: [buildUserMessage('s1-older', 's1', 1, 'stale-history')],
      nextCursor: null,
      hasMore: false
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.id).toBe('s2-only')
    expect(store.hasMoreHistory.value).toBe(false)
    expect(store.isLoadingHistory.value).toBe(false)
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
        messages: [],
        nextCursor: null,
        hasMore: false
      })
      .mockResolvedValueOnce({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
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

  it('reloads persisted messages when a typed stream failure arrives', async () => {
    const { store, sessionClient, streamListeners, ipcListeners } = await setupStore()
    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: [],
        nextCursor: null,
        hasMore: false
      })
      .mockResolvedValueOnce({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
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

    const failedHandler = streamListeners.failed[0]
    expect(typeof failedHandler).toBe('function')

    failedHandler({
      sessionId: 's1',
      requestId: 'user-1',
      messageId: 'user-1',
      error: {
        message: 'stream failed'
      },
      failedAt: 2
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
      nextCursor: null,
      hasMore: false,
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
