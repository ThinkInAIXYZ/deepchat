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

  const messageListeners: Array<(payload: any) => void> = []
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
    }),
    onMessagesChanged: vi.fn((listener: (payload: any) => void) => {
      messageListeners.push(listener)
      return () => undefined
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
  store.setCurrentSessionId('s1')
  return { store, sessionClient, streamListeners, ipcListeners, messageListeners }
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
      providerId: 'acp',
      modelId: 'dimcode',
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
    expect(store.committedSessionId.value).toBeNull()
    expect(store.messages.value).toHaveLength(0)

    await store.loadMessages('s1')

    expect(store.committedSessionId.value).toBe('s1')
    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.id).toBe('m1')
    expect(store.messages.value[0]?.metadata).toBe('{"provider":"acp","model":"dimcode"}')
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

  it('applies persisted steer receipt updates without reloading the transcript', async () => {
    const { store, sessionClient, messageListeners } = await setupStore()
    const unreadMessage = {
      ...buildUserMessage('steer-1', 's1', 1, 'redirect'),
      status: 'pending' as const,
      metadata: '{"inputReceipt":{"mode":"steer","readAt":null}}'
    }
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [unreadMessage]
    })
    await store.loadMessages('s1')
    const revision = store.lastPersistedRevision.value

    messageListeners[0]({
      sessionId: 's1',
      messages: [
        {
          ...unreadMessage,
          metadata: '{"inputReceipt":{"mode":"steer","readAt":1000}}',
          updatedAt: 2
        }
      ]
    })

    expect(store.messages.value[0]?.metadata).toContain('"readAt":1000')
    expect(store.lastPersistedRevision.value).toBe(revision + 1)

    messageListeners[0]({
      sessionId: 's1',
      messages: [unreadMessage]
    })
    expect(store.messages.value[0]?.metadata).toContain('"readAt":1000')
  })

  it('replaces an optimistic user with its persisted source record', async () => {
    const { store, messageListeners } = await setupStore()
    await store.loadMessages('s1')

    const optimisticId = store.addOptimisticUserMessage('s1', {
      text: 'hello',
      files: [],
      search: true,
      activeSkills: ['skill-a']
    })

    expect(store.messages.value).toHaveLength(1)
    expect(store.messages.value[0]?.id).toBe(optimisticId)
    expect(store.messages.value[0]?.content).toContain('skill-a')
    expect(JSON.parse(store.messages.value[0]!.content)).toMatchObject({ search: true })

    messageListeners[0]({
      sessionId: 's1',
      messages: [
        buildUserMessage('source-user', 's1', 1, 'hello'),
        {
          ...buildUserMessage('steer-user', 's1', 2, 'steer'),
          status: 'pending',
          metadata: '{"inputReceipt":{"mode":"steer","readAt":null}}'
        }
      ]
    })

    expect(store.messageIds.value).toEqual(['source-user', 'steer-user'])
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

  it('does not let a refresh overwrite an optimistic message added after request start', async () => {
    const { store, sessionClient } = await setupStore()
    const persisted = buildUserMessage('m1', 's1', 1, 'persisted')
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [persisted]
    })
    await store.loadMessages('s1')

    const refresh = createDeferred<ReturnType<typeof buildUserMessage>[]>()
    sessionClient.restore.mockReturnValueOnce(
      refresh.promise.then((messages) => ({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages
      }))
    )
    const pendingRefresh = store.loadMessages('s1')
    const optimisticId = store.addOptimisticUserMessage('s1', 'optimistic')

    refresh.resolve([persisted])
    await pendingRefresh

    expect(optimisticId).not.toBeNull()
    expect(store.messageIds.value).toEqual(['m1', optimisticId])
  })

  it('does not let a refresh overwrite streaming records added after request start', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    const persisted = buildUserMessage('m1', 's1', 1, 'persisted')
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [persisted]
    })
    await store.loadMessages('s1')

    const refresh = createDeferred<ReturnType<typeof buildUserMessage>[]>()
    sessionClient.restore.mockReturnValueOnce(
      refresh.promise.then((messages) => ({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages
      }))
    )
    const pendingRefresh = store.loadMessages('s1')
    streamListeners.updated[0]({
      sessionId: 's1',
      requestId: 'assistant-stream',
      messageId: 'assistant-stream',
      updatedAt: 2,
      blocks: [{ type: 'content', content: 'live', status: 'pending', timestamp: 2 }]
    })

    refresh.resolve([persisted])
    await pendingRefresh

    expect(store.messageIds.value).toEqual(['m1', 'assistant-stream'])
    expect(store.messageCache.value.get('assistant-stream')?.content).toContain('live')
  })

  it('does not cancel an in-flight load when recent-session cache lookup misses', async () => {
    const { store, sessionClient } = await setupStore()
    const deferredLoad = createDeferred<ReturnType<typeof buildUserMessage>[]>()
    sessionClient.restore.mockReturnValueOnce(
      deferredLoad.promise.then((messages) => ({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages
      }))
    )

    const pendingLoad = store.loadMessages('s1')
    expect(store.activateRecentSessionView('s1')).toBe(false)
    deferredLoad.resolve([buildUserMessage('m1', 's1', 1, 'loaded')])
    await pendingLoad

    expect(store.committedSessionId.value).toBe('s1')
    expect(store.messageIds.value).toEqual(['m1'])
  })

  it('rejects a cached view after a known session invalidation', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages: [buildUserMessage('s1-message', 's1', 1, 'session one')]
      })
      .mockResolvedValueOnce({
        session: { id: 's2' },
        nextCursor: null,
        hasMore: false,
        messages: [buildUserMessage('s2-message', 's2', 1, 'session two')]
      })

    await store.loadMessages('s1')
    store.setCurrentSessionId('s2')
    await store.loadMessages('s2')
    store.invalidateRecentSessionView('s1')
    store.setCurrentSessionId('s1')

    expect(store.activateRecentSessionView('s1')).toBe(false)
    expect(store.committedSessionId.value).toBe('s2')
  })

  it('invalidates a cached view when its inactive session receives a stream update', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages: [buildUserMessage('s1-message', 's1', 1, 'session one')]
      })
      .mockResolvedValueOnce({
        session: { id: 's2' },
        nextCursor: null,
        hasMore: false,
        messages: [buildUserMessage('s2-message', 's2', 1, 'session two')]
      })

    await store.loadMessages('s1')
    store.setCurrentSessionId('s2')
    await store.loadMessages('s2')
    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'background-request',
      messageId: 'background-message',
      updatedAt: 2,
      blocks: [{ type: 'content', content: 'background', status: 'pending', timestamp: 2 }]
    })
    store.setCurrentSessionId('s1')

    expect(store.activateRecentSessionView('s1')).toBe(false)
    expect(store.committedSessionId.value).toBe('s2')
  })

  it('does not recache an active view invalidated before a session switch', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages: [buildUserMessage('s1-message', 's1', 1, 'session one')]
      })
      .mockResolvedValueOnce({
        session: { id: 's2' },
        nextCursor: null,
        hasMore: false,
        messages: [buildUserMessage('s2-message', 's2', 1, 'session two')]
      })

    await store.loadMessages('s1')
    store.invalidateRecentSessionView('s1')
    store.setCurrentSessionId('s2')
    await store.loadMessages('s2')
    store.setCurrentSessionId('s1')

    expect(store.activateRecentSessionView('s1')).toBe(false)
  })

  it('keeps a view uncacheable when invalidation crosses its persisted refresh', async () => {
    const { store, sessionClient } = await setupStore()
    const sessionOne = buildUserMessage('s1-message', 's1', 1, 'session one')
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [sessionOne]
    })
    await store.loadMessages('s1')

    store.invalidateRecentSessionView('s1')
    const refresh = createDeferred<ReturnType<typeof buildUserMessage>[]>()
    sessionClient.restore.mockReturnValueOnce(
      refresh.promise.then((messages) => ({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages
      }))
    )
    const pendingRefresh = store.loadMessages('s1')
    store.invalidateRecentSessionView('s1')
    refresh.resolve([sessionOne])
    await pendingRefresh

    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's2' },
      nextCursor: null,
      hasMore: false,
      messages: [buildUserMessage('s2-message', 's2', 1, 'session two')]
    })
    store.setCurrentSessionId('s2')
    await store.loadMessages('s2')
    store.setCurrentSessionId('s1')

    expect(store.activateRecentSessionView('s1')).toBe(false)
  })

  it('does not let a late load select a session owned by another navigation', async () => {
    const { store, sessionClient } = await setupStore()
    await store.loadMessages('s1')
    store.setCurrentSessionId('s2')

    const restoreCallsBeforeLateLoad = sessionClient.restore.mock.calls.length
    expect(await store.loadMessages('s1')).toBeNull()

    expect(store.currentSessionId.value).toBe('s2')
    expect(store.committedSessionId.value).toBe('s1')
    expect(sessionClient.restore).toHaveBeenCalledTimes(restoreCallsBeforeLateLoad)
  })

  it('rejects an old session load after a rapid A-B-A selection cycle', async () => {
    const { store, sessionClient } = await setupStore()
    const staleLoad = createDeferred<ReturnType<typeof buildUserMessage>[]>()
    sessionClient.restore.mockReturnValueOnce(
      staleLoad.promise.then((messages) => ({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages
      }))
    )

    const pendingStaleLoad = store.loadMessages('s1')
    store.setCurrentSessionId('s2')
    store.setCurrentSessionId('s1')
    staleLoad.resolve([buildUserMessage('stale', 's1', 1, 'stale')])
    await pendingStaleLoad

    expect(store.currentSessionId.value).toBe('s1')
    expect(store.committedSessionId.value).toBeNull()
    expect(store.messageIds.value).toEqual([])
  })

  it('keeps the committed session view intact until an uncached target is ready', async () => {
    const { store, sessionClient } = await setupStore()
    const secondLoad = createDeferred<ReturnType<typeof buildUserMessage>[]>()
    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages: [buildUserMessage('s1-message', 's1', 1, 'session one')]
      })
      .mockReturnValueOnce(
        secondLoad.promise.then((messages) => ({
          session: { id: 's2' },
          nextCursor: null,
          hasMore: false,
          messages
        }))
      )

    await store.loadMessages('s1')
    store.setCurrentSessionId('s2')
    const pendingSwitch = store.loadMessages('s2')

    expect(store.currentSessionId.value).toBe('s2')
    expect(store.committedSessionId.value).toBe('s1')
    expect(store.messages.value.map((message) => message.id)).toEqual(['s1-message'])

    secondLoad.resolve([buildUserMessage('s2-message', 's2', 1, 'session two')])
    await pendingSwitch

    expect(store.currentSessionId.value).toBe('s2')
    expect(store.committedSessionId.value).toBe('s2')
    expect(store.messages.value.map((message) => message.id)).toEqual(['s2-message'])
  })

  it('restores a recently visited session view synchronously', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        nextCursor: null,
        hasMore: false,
        messages: [buildUserMessage('s1-message', 's1', 1, 'session one')]
      })
      .mockResolvedValueOnce({
        session: { id: 's2' },
        nextCursor: null,
        hasMore: false,
        messages: [buildUserMessage('s2-message', 's2', 1, 'session two')]
      })

    await store.loadMessages('s1')
    store.setCurrentSessionId('s2')
    await store.loadMessages('s2')

    store.setCurrentSessionId('s1')
    expect(store.activateRecentSessionView('s1')).toBe(true)
    expect(store.currentSessionId.value).toBe('s1')
    expect(store.messages.value.map((message) => message.id)).toEqual(['s1-message'])
  })

  it('does not fold target-session stream records into the previously committed view', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [buildUserMessage('s1-message', 's1', 1, 'session one')]
    })
    await store.loadMessages('s1')

    store.setCurrentSessionId('s2')
    streamListeners.updated[0]({
      sessionId: 's2',
      requestId: 's2-stream',
      messageId: 's2-stream',
      updatedAt: 2,
      blocks: [{ type: 'content', content: 'target stream', status: 'pending', timestamp: 2 }]
    })

    expect(store.currentStreamMessageId.value).toBe('s2-stream')
    expect(store.committedSessionId.value).toBe('s1')
    expect(store.messageIds.value).toEqual(['s1-message'])
    expect(store.messageCache.value.has('s2-stream')).toBe(false)
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

  it('marks a failed history request as retryable without exhausting history', async () => {
    const { store, sessionClient } = await setupStore()
    // A full first page keeps loadMessages' fill loop from issuing the paged
    // request itself, so the rejection below is consumed by loadOlderMessages.
    const recentMessages = Array.from({ length: 100 }, (_, index) =>
      buildUserMessage(`m${index + 2}`, 's1', index + 2, 'recent')
    )
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      messages: recentMessages,
      nextCursor: { orderSeq: 2, id: 'm2' },
      hasMore: true
    })
    sessionClient.listMessagesPage.mockRejectedValueOnce(new Error('offline'))

    await store.loadMessages('s1')
    await store.loadOlderMessages()

    expect(store.historyLoadError.value).toBe(true)
    expect(store.hasMoreHistory.value).toBe(true)
    expect(store.isLoadingHistory.value).toBe(false)

    sessionClient.listMessagesPage.mockResolvedValueOnce({
      messages: [buildUserMessage('m1', 's1', 1, 'older')],
      nextCursor: null,
      hasMore: false
    })

    await store.loadOlderMessages()

    expect(store.historyLoadError.value).toBe(false)
    expect(store.messageIds.value).toEqual(['m1', ...recentMessages.map((message) => message.id)])
  })

  it('clears the history failure state when switching sessions', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      messages: Array.from({ length: 100 }, (_, index) =>
        buildUserMessage(`m${index + 2}`, 's1', index + 2, 'recent')
      ),
      nextCursor: { orderSeq: 2, id: 'm2' },
      hasMore: true
    })
    sessionClient.listMessagesPage.mockRejectedValueOnce(new Error('offline'))

    await store.loadMessages('s1')
    await store.loadOlderMessages()
    expect(store.historyLoadError.value).toBe(true)

    store.setCurrentSessionId('s2')

    expect(store.historyLoadError.value).toBe(false)
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
    store.setCurrentSessionId('s2')
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

  it('does not let an overlapping history page replace an existing record', async () => {
    const { store, sessionClient } = await setupStore()
    const current = buildUserMessage('m2', 's1', 2, 'current')
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      messages: [current],
      nextCursor: { orderSeq: 2, id: 'm2' },
      hasMore: true
    })
    sessionClient.listMessagesPage.mockResolvedValueOnce({
      messages: [
        buildUserMessage('m1', 's1', 1, 'older'),
        buildUserMessage('m2', 's1', 2, 'stale duplicate')
      ],
      nextCursor: null,
      hasMore: false
    })

    await store.loadMessages('s1', 1)
    const loadedCount = await store.loadOlderMessages()

    expect(loadedCount).toBe(1)
    expect(store.messageIds.value).toEqual(['m1', 'm2'])
    expect(store.messageCache.value.get('m2')?.content).toBe(current.content)
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

  it('does not let an old terminal event settle a newer stream in the same session', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    await store.loadMessages('s1')

    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-old',
      messageId: 'message-old',
      updatedAt: 1,
      blocks: [{ type: 'content', content: 'old', status: 'pending', timestamp: 1 }]
    })
    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-new',
      messageId: 'message-new',
      updatedAt: 2,
      blocks: [{ type: 'content', content: 'new', status: 'pending', timestamp: 2 }]
    })

    streamListeners.completed[0]({
      sessionId: 's1',
      requestId: 'request-old',
      messageId: 'message-old',
      completedAt: 3
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sessionClient.restore).toHaveBeenCalledTimes(1)
    expect(store.isStreaming.value).toBe(true)
    expect(store.currentStreamRequestId.value).toBe('request-new')
    expect(store.currentStreamMessageId.value).toBe('message-new')
    expect(store.messageCache.value.get('message-new')?.content).toContain('new')
  })

  it('does not let a superseded request reclaim the stream with a later snapshot', async () => {
    const { store, streamListeners } = await setupStore()
    await store.loadMessages('s1')

    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-old',
      messageId: 'message-old',
      updatedAt: 1,
      blocks: [{ type: 'content', content: 'old', status: 'pending', timestamp: 1 }]
    })
    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-new',
      messageId: 'message-new',
      updatedAt: 2,
      blocks: [{ type: 'content', content: 'new', status: 'pending', timestamp: 2 }]
    })
    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-old',
      messageId: 'message-old',
      updatedAt: 3,
      blocks: [{ type: 'content', content: 'late old', status: 'pending', timestamp: 3 }]
    })

    expect(store.currentStreamRequestId.value).toBe('request-new')
    expect(store.currentStreamMessageId.value).toBe('message-new')
    expect(store.streamingBlocks.value[0]).toMatchObject({ content: 'new' })
    expect(store.messageCache.value.get('message-old')?.content).not.toContain('late old')
  })

  it('keeps settled request tombstones after many later terminals', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    await store.loadMessages('s1')

    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-settled',
      messageId: 'message-settled',
      updatedAt: 1,
      blocks: [{ type: 'content', content: 'live', status: 'pending', timestamp: 1 }]
    })
    streamListeners.completed[0]({
      sessionId: 's1',
      requestId: 'request-settled',
      messageId: 'message-settled',
      completedAt: 2
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    for (let index = 0; index < 129; index += 1) {
      streamListeners.completed[0]({
        sessionId: `inactive-${index}`,
        requestId: `request-${index}`,
        messageId: `message-${index}`,
        completedAt: index + 3
      })
    }

    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-settled',
      messageId: 'message-settled',
      updatedAt: 500,
      blocks: [{ type: 'content', content: 'resurrected', status: 'pending', timestamp: 500 }]
    })

    expect(sessionClient.restore).toHaveBeenCalledTimes(2)
    expect(store.isStreaming.value).toBe(false)
    expect(store.currentStreamRequestId.value).toBeNull()
    expect(store.streamingBlocks.value).toEqual([])
  })

  it('ignores stream snapshots that arrive after their terminal event', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: [],
        nextCursor: null,
        hasMore: false
      })
      .mockResolvedValueOnce({
        session: { id: 's1' },
        messages: [buildUserMessage('persisted', 's1', 1, 'persisted')],
        nextCursor: null,
        hasMore: false
      })
    await store.loadMessages('s1')

    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-1',
      messageId: 'message-1',
      updatedAt: 1,
      blocks: [{ type: 'content', content: 'live', status: 'pending', timestamp: 1 }]
    })
    streamListeners.completed[0]({
      sessionId: 's1',
      requestId: 'request-1',
      messageId: 'message-1',
      completedAt: 2
    })
    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-1',
      messageId: 'message-1',
      updatedAt: 3,
      blocks: [{ type: 'content', content: 'late', status: 'pending', timestamp: 3 }]
    })
    streamListeners.failed[0]({
      sessionId: 's1',
      requestId: 'request-1',
      messageId: 'message-1',
      failedAt: 4,
      error: 'duplicate terminal'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sessionClient.restore).toHaveBeenCalledTimes(2)
    expect(store.isStreaming.value).toBe(false)
    expect(store.currentStreamRequestId.value).toBeNull()
    expect(store.messageIds.value).toEqual(['persisted'])
  })

  it('rejects an older snapshot for the current stream request', async () => {
    const { store, streamListeners } = await setupStore()
    await store.loadMessages('s1')

    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-1',
      messageId: 'message-1',
      updatedAt: 2,
      blocks: [{ type: 'content', content: 'newer', status: 'pending', timestamp: 2 }]
    })
    streamListeners.updated[0]({
      kind: 'snapshot',
      sessionId: 's1',
      requestId: 'request-1',
      messageId: 'message-1',
      updatedAt: 1,
      blocks: [{ type: 'content', content: 'older', status: 'pending', timestamp: 1 }]
    })

    expect(store.streamingBlocks.value[0]).toMatchObject({ content: 'newer' })
    expect(store.messageCache.value.get('message-1')?.content).toContain('newer')
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

  it('inserts optimistic messages without resorting sorted persisted ids', async () => {
    const { store, sessionClient } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [buildUserMessage('m1', 's1', 1, 'one'), buildUserMessage('m2', 's1', 2, 'two')]
    })

    await store.loadMessages('s1')
    const sortSpy = vi.spyOn(store.messageIds.value, 'sort')

    const optimisticId = store.addOptimisticUserMessage('s1', 'optimistic')

    expect(sortSpy).not.toHaveBeenCalled()
    expect(store.messageIds.value).toEqual(['m1', 'm2', optimisticId])
  })

  it('appends local messages after a high-order paginated window', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: { orderSeq: 501, id: 'm501' },
      hasMore: true,
      messages: [
        buildUserMessage('m501', 's1', 501, 'one'),
        buildUserMessage('m502', 's1', 502, 'two')
      ]
    })

    await store.loadMessages('s1')
    const optimisticId = store.addOptimisticUserMessage('s1', 'next')!

    expect(store.messageCache.value.get(optimisticId)?.orderSeq).toBe(503)
    expect(store.messageIds.value.at(-1)).toBe(optimisticId)

    streamListeners.updated[0]({
      sessionId: 's1',
      requestId: 'm504',
      messageId: 'm504',
      updatedAt: 504,
      blocks: [
        {
          type: 'content',
          content: 'streaming',
          status: 'pending',
          timestamp: 504
        }
      ]
    })

    expect(store.messageCache.value.get('m504')?.orderSeq).toBe(504)
    expect(store.messageIds.value).toEqual(['m501', 'm502', optimisticId, 'm504'])
  })

  it('falls back to full sort after older history creates an unsorted id window', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: { orderSeq: 3, id: 'm3' },
      hasMore: true,
      messages: [buildUserMessage('m3', 's1', 3, 'three'), buildUserMessage('m4', 's1', 4, 'four')]
    })
    sessionClient.listMessagesPage.mockResolvedValueOnce({
      messages: [buildUserMessage('m2', 's1', 2, 'two'), buildUserMessage('m1', 's1', 1, 'one')],
      nextCursor: null,
      hasMore: false
    })

    await store.loadMessages('s1')
    await store.loadOlderMessages()
    expect(store.messageIds.value).toEqual(['m2', 'm1', 'm3', 'm4'])

    streamListeners.updated[0]({
      sessionId: 's1',
      requestId: 'm5',
      messageId: 'm5',
      updatedAt: 5,
      blocks: [
        {
          type: 'content',
          content: 'streaming',
          status: 'pending',
          timestamp: 5
        }
      ]
    })

    expect(store.messageIds.value).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
  })

  it('appends a newly hydrated stream after the highest loaded order', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [buildUserMessage('m1', 's1', 1, 'one'), buildUserMessage('m3', 's1', 3, 'three')]
    })

    await store.loadMessages('s1')
    const sortSpy = vi.spyOn(store.messageIds.value, 'sort')

    streamListeners.updated[0]({
      sessionId: 's1',
      requestId: 'm2',
      messageId: 'm2',
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
    expect(store.messageCache.value.get('m2')?.orderSeq).toBe(4)
    expect(store.messageIds.value).toEqual(['m1', 'm3', 'm2'])
  })

  it('evicts the least recently used parsed message entry after 1024 records', async () => {
    const { store, sessionClient } = await setupStore()
    const messages = Array.from({ length: 1025 }, (_, index) => ({
      ...buildUserMessage(`m${index + 1}`, 's1', index + 1, `message-${index + 1}`),
      role: 'assistant' as const,
      content: `[{"type":"content","content":"message-${index + 1}","status":"success","timestamp":${index + 1}}]`
    }))
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages
    })

    await store.loadMessages('s1')

    const firstRecord = store.messageCache.value.get('m1')!
    const firstBlocks = store.getAssistantMessageBlocks(firstRecord)
    for (let index = 1; index < messages.length; index += 1) {
      store.getAssistantMessageBlocks(store.messageCache.value.get(`m${index + 1}`)!)
    }

    expect(store.getAssistantMessageBlocks(firstRecord)).not.toBe(firstBlocks)
  })

  it('refreshes parsed message LRU entries on cache hits', async () => {
    const { store, sessionClient } = await setupStore()
    const messages = Array.from({ length: 1025 }, (_, index) => ({
      ...buildUserMessage(`m${index + 1}`, 's1', index + 1, `message-${index + 1}`),
      role: 'assistant' as const,
      content: `[{"type":"content","content":"message-${index + 1}","status":"success","timestamp":${index + 1}}]`
    }))
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages
    })

    await store.loadMessages('s1')

    const firstRecord = store.messageCache.value.get('m1')!
    const secondRecord = store.messageCache.value.get('m2')!
    const firstBlocks = store.getAssistantMessageBlocks(firstRecord)
    const secondBlocks = store.getAssistantMessageBlocks(secondRecord)
    expect(store.getAssistantMessageBlocks(firstRecord)).toBe(firstBlocks)

    for (let index = 2; index < messages.length; index += 1) {
      store.getAssistantMessageBlocks(store.messageCache.value.get(`m${index + 1}`)!)
    }

    expect(store.getAssistantMessageBlocks(firstRecord)).toBe(firstBlocks)
    expect(store.getAssistantMessageBlocks(secondRecord)).not.toBe(secondBlocks)
  })

  it('reuses stable assistant blocks when shallow payload fields are equivalent', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [
        {
          ...buildUserMessage('m1', 's1', 1, 'assistant'),
          role: 'assistant' as const,
          content:
            '[{"type":"action","action_type":"rate_limit","status":"success","timestamp":1,"extra":{"providerId":"openai","currentQps":1}},{"type":"content","content":"done","status":"success","timestamp":2}]'
        }
      ]
    })

    await store.loadMessages('s1')
    const firstBlocks = store.getAssistantMessageBlocks(store.messages.value[0]!)

    streamListeners.updated[0]({
      sessionId: 's1',
      requestId: 'm1',
      messageId: 'm1',
      updatedAt: 2,
      blocks: [
        {
          type: 'action',
          action_type: 'rate_limit',
          status: 'success',
          timestamp: 1,
          extra: { providerId: 'openai', currentQps: 1 }
        },
        {
          type: 'content',
          content: 'streaming',
          status: 'pending',
          timestamp: 2
        }
      ]
    })

    const updatedBlocks = store.getAssistantMessageBlocks(store.messages.value[0]!)
    expect(updatedBlocks[0]).toBe(firstBlocks[0])
  })

  it('reuses validated stream blocks without parsing the serialized record again', async () => {
    const { store, streamListeners } = await setupStore()
    await store.loadMessages('s1')
    const blocks = [
      {
        type: 'content' as const,
        content: 'streaming',
        status: 'pending' as const,
        timestamp: 1
      }
    ]

    streamListeners.updated[0]({
      sessionId: 's1',
      requestId: 'm1',
      messageId: 'm1',
      updatedAt: 1,
      blocks
    })

    const record = store.messageCache.value.get('m1')!
    const parsedBlocks = store.getAssistantMessageBlocks(record)
    expect(parsedBlocks[0]).toBe(blocks[0])
    expect(store.getAssistantMessageBlocks(record)).toBe(parsedBlocks)
  })

  it('does not reuse stable assistant blocks when shallow payload fields change', async () => {
    const { store, sessionClient, streamListeners } = await setupStore()
    sessionClient.restore.mockResolvedValueOnce({
      session: { id: 's1' },
      nextCursor: null,
      hasMore: false,
      messages: [
        {
          ...buildUserMessage('m1', 's1', 1, 'assistant'),
          role: 'assistant' as const,
          content:
            '[{"type":"tool_call","status":"success","timestamp":1,"tool_call":{"id":"tool-1","name":"read","response":"old"}},{"type":"content","content":"done","status":"success","timestamp":2}]'
        }
      ]
    })

    await store.loadMessages('s1')
    const firstBlocks = store.getAssistantMessageBlocks(store.messages.value[0]!)

    streamListeners.updated[0]({
      sessionId: 's1',
      requestId: 'm1',
      messageId: 'm1',
      updatedAt: 2,
      blocks: [
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 1,
          tool_call: { id: 'tool-1', name: 'read', response: 'new' }
        },
        {
          type: 'content',
          content: 'streaming',
          status: 'pending',
          timestamp: 2
        }
      ]
    })

    const updatedBlocks = store.getAssistantMessageBlocks(store.messages.value[0]!)
    expect(updatedBlocks[0]).not.toBe(firstBlocks[0])
  })
})
