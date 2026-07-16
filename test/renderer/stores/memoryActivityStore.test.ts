import { describe, expect, it, vi } from 'vitest'
import type { ChatMessageRecord } from '@shared/types/agent-interface'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

type MemoryUpdatedListener = (payload: {
  agentId: string
  reason: string
  version: number
  memoryId?: string
  sessionId?: string
  createdIds?: string[]
}) => void

const flushMicrotasks = async (cycles = 6): Promise<void> => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve()
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const makeSession = () => ({
  id: 'session-1',
  title: 'Session',
  agentId: 'deepchat',
  status: 'none',
  projectDir: '/workspace',
  isPinned: false,
  isDraft: false,
  sessionKind: 'regular',
  parentSessionId: null,
  subagentMeta: null,
  createdAt: 1,
  updatedAt: 1
})

const makeAgent = () => ({
  id: 'deepchat',
  name: 'DeepChat',
  type: 'deepchat',
  agentType: 'deepchat',
  enabled: true,
  config: {
    memoryEnabled: true
  }
})

const makeMemory = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  agentId: 'deepchat',
  kind: 'semantic',
  category: null,
  content: `${id} content`,
  importance: 0.6,
  status: 'embedded',
  sourceSession: null,
  sourceEntryIds: null,
  supersededBy: null,
  createdAt: 1000,
  ...overrides
})

const makeMessage = (
  id: string,
  role: ChatMessageRecord['role'],
  orderSeq: number
): ChatMessageRecord =>
  ({
    id,
    sessionId: 'session-1',
    orderSeq,
    role,
    content: role === 'user' ? '{"text":"question"}' : '[]',
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: orderSeq,
    updatedAt: orderSeq
  }) as ChatMessageRecord

async function setupStore() {
  vi.resetModules()

  const listeners: MemoryUpdatedListener[] = []
  const memoryClient = {
    getByIds: vi.fn(),
    listViewManifests: vi.fn(),
    remove: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    add: vi.fn(),
    onUpdated: vi.fn((listener: MemoryUpdatedListener) => {
      listeners.push(listener)
      return () => undefined
    })
  }
  const sessionClient = {
    getAgents: vi.fn(async () => []),
    listLightweight: vi.fn(async () => ({ items: [], hasMore: false, nextCursor: null })),
    getLightweightByIds: vi.fn(async () => []),
    create: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    onUpdated: vi.fn(() => () => undefined),
    onStatusChanged: vi.fn(() => () => undefined)
  }
  const configClient = {
    getSetting: vi.fn(async () => 'project'),
    setSetting: vi.fn(async () => undefined),
    listAgents: vi.fn(async () => []),
    onAgentsChanged: vi.fn(() => () => undefined)
  }
  const chatClient = {
    sendMessage: vi.fn(async () => ({ accepted: true, requestId: null, messageId: null }))
  }
  const onboardingClient = {
    getState: vi.fn(async () => ({
      version: 1,
      status: 'idle',
      startedAt: null,
      completedAt: null,
      lastActiveAt: 1,
      currentStepId: null,
      steps: []
    })),
    setStepStatus: vi.fn(),
    complete: vi.fn()
  }
  const memoryModule = {
    createMemoryClient: vi.fn(() => memoryClient)
  }

  vi.doMock('@api/MemoryClient', () => memoryModule)
  vi.doMock('../../../src/renderer/api/MemoryClient', () => memoryModule)
  vi.doMock('../../../src/renderer/api/SessionClient', () => ({
    createSessionClient: vi.fn(() => sessionClient)
  }))
  vi.doMock('../../../src/renderer/api/ConfigClient', () => ({
    createConfigClient: vi.fn(() => configClient)
  }))
  vi.doMock('../../../src/renderer/api/ChatClient', () => ({
    createChatClient: vi.fn(() => chatClient)
  }))
  vi.doMock('../../../src/renderer/api/OnboardingClient', () => ({
    createOnboardingClient: vi.fn(() => onboardingClient)
  }))
  vi.doMock('../../../src/renderer/api/runtime', () => ({
    getRuntimeWebContentsId: vi.fn(async () => null)
  }))
  vi.doMock('../../../src/renderer/src/stores/ui/sessionIpc', () => ({
    bindSessionStoreIpc: vi.fn(() => () => undefined)
  }))
  vi.doMock('../../../src/renderer/src/stores/ui/messageIpc', () => ({
    bindMessageStoreIpc: vi.fn(() => () => undefined)
  }))

  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { useAgentStore } = await import('@/stores/ui/agent')
  const { useSessionStore } = await import('@/stores/ui/session')
  const { useMessageStore } = await import('@/stores/ui/message')
  const { useMemoryActivityStore } = await import('@/stores/ui/memoryActivity')

  const agentStore = useAgentStore()
  const sessionStore = useSessionStore()
  const messageStore = useMessageStore()

  agentStore.agents = [makeAgent() as any]
  sessionStore.sessions = [makeSession() as any]
  sessionStore.activeSessionId = 'session-1'
  messageStore.setCurrentSessionId('session-1')

  const store = useMemoryActivityStore()
  const emitMemoryUpdated = (payload: Parameters<MemoryUpdatedListener>[0]) => {
    for (const listener of listeners) {
      listener(payload)
    }
  }

  return {
    store,
    agentStore,
    sessionStore,
    messageStore,
    memoryClient,
    emitMemoryUpdated
  }
}

describe('memoryActivity store', () => {
  it('loads chip items only for extract events from the active memory-enabled session', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])

    emitMemoryUpdated({ agentId: 'deepchat', reason: 'update', version: 1, sessionId: 'session-1' })
    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 2,
      sessionId: 'other-session',
      createdIds: ['m1']
    })
    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 3,
      sessionId: 'session-1',
      createdIds: []
    })
    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 4,
      createdIds: ['m1']
    })
    await flushMicrotasks()

    expect(memoryClient.getByIds).not.toHaveBeenCalled()
    expect(store.chipItems).toEqual([])

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 5,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    expect(memoryClient.getByIds).toHaveBeenCalledWith('deepchat', ['m1'])
    expect(store.chipItems.map((item) => item.id)).toEqual(['m1'])
  })

  it('clears chip and turn cache when the active session changes', async () => {
    const { store, sessionStore, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()
    store.selectedTurnMessageId = 'assistant-1'

    sessionStore.activeSessionId = 'session-2'
    await flushMicrotasks()

    expect(store.chipItems).toEqual([])
    expect(store.selectedTurn).toBeNull()
  })

  it('loads the latest turn manifest from the preceding user message and preserves missing ids', async () => {
    const { store, messageStore, memoryClient } = await setupStore()
    messageStore.messageCache.set('user-1', makeMessage('user-1', 'user', 1))
    messageStore.messageCache.set('assistant-1', makeMessage('assistant-1', 'assistant', 2))
    messageStore.messageIds = ['user-1', 'assistant-1']
    memoryClient.listViewManifests.mockResolvedValue([
      {
        sessionId: 'session-1',
        messageId: 'user-1',
        entryId: 12,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 100,
        selectedCount: 3,
        selectedIds: ['m2', 'missing', 'm2'],
        droppedCount: 0,
        queryHash: 'hash',
        createdAt: 200
      }
    ])
    memoryClient.getByIds.mockResolvedValue([makeMemory('m2')])

    await store.openTurnMemories('assistant-1')

    expect(memoryClient.listViewManifests).toHaveBeenCalledWith('deepchat', {
      sessionId: 'session-1',
      messageId: 'user-1',
      limit: 1
    })
    expect(memoryClient.getByIds).toHaveBeenCalledWith('deepchat', ['m2', 'missing'])
    expect(store.selectedTurn).toMatchObject({
      messageId: 'assistant-1',
      userMessageId: 'user-1',
      status: 'ready',
      manifest: expect.objectContaining({ entryId: 12 })
    })
    expect(store.selectedTurn?.details).toEqual([
      { id: 'm2', memory: expect.objectContaining({ id: 'm2' }) },
      { id: 'missing', memory: null }
    ])
  })

  it('uses orderSeq rather than messageIds order when finding the preceding user message', async () => {
    const { store, messageStore, memoryClient } = await setupStore()
    messageStore.messageCache.set('assistant-1', makeMessage('assistant-1', 'assistant', 3))
    messageStore.messageCache.set('user-1', makeMessage('user-1', 'user', 1))
    messageStore.messageIds = ['assistant-1', 'user-1']
    memoryClient.listViewManifests.mockResolvedValue([])

    await store.openTurnMemories('assistant-1')

    expect(memoryClient.listViewManifests).toHaveBeenCalledWith('deepchat', {
      sessionId: 'session-1',
      messageId: 'user-1',
      limit: 1
    })
    expect(store.selectedTurn).toMatchObject({
      messageId: 'assistant-1',
      userMessageId: 'user-1',
      status: 'ready'
    })
  })

  it('reports an error when the preceding user message is outside the loaded window', async () => {
    const { store, messageStore, memoryClient } = await setupStore()
    messageStore.messageCache.set('assistant-1', makeMessage('assistant-1', 'assistant', 2))
    messageStore.messageIds = ['assistant-1']

    await store.openTurnMemories('assistant-1')

    expect(memoryClient.listViewManifests).not.toHaveBeenCalled()
    expect(store.selectedTurn).toMatchObject({
      messageId: 'assistant-1',
      status: 'error',
      error: 'user_message_unavailable'
    })
  })

  it('does not leave a slow turn request permanently loading after another turn opens', async () => {
    const { store, messageStore, memoryClient } = await setupStore()
    messageStore.messageCache.set('user-a', makeMessage('user-a', 'user', 1))
    messageStore.messageCache.set('assistant-a', makeMessage('assistant-a', 'assistant', 2))
    messageStore.messageCache.set('user-b', makeMessage('user-b', 'user', 3))
    messageStore.messageCache.set('assistant-b', makeMessage('assistant-b', 'assistant', 4))
    messageStore.messageIds = ['user-a', 'assistant-a', 'user-b', 'assistant-b']
    const slowTurn = deferred<any[]>()
    memoryClient.listViewManifests.mockReturnValueOnce(slowTurn.promise).mockResolvedValueOnce([
      {
        sessionId: 'session-1',
        messageId: 'user-a',
        entryId: 11,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 100,
        selectedCount: 0,
        selectedIds: [],
        droppedCount: 0,
        queryHash: 'a',
        createdAt: 200
      }
    ])

    void store.openTurnMemories('assistant-b')
    await flushMicrotasks()
    expect(store.selectedTurn?.status).toBe('loading')

    await store.openTurnMemories('assistant-a')
    expect(store.selectedTurn?.manifest?.entryId).toBe(11)

    slowTurn.resolve([
      {
        sessionId: 'session-1',
        messageId: 'user-b',
        entryId: 22,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 100,
        selectedCount: 0,
        selectedIds: [],
        droppedCount: 0,
        queryHash: 'b',
        createdAt: 300
      }
    ])
    await flushMicrotasks()

    await store.openTurnMemories('assistant-b')
    expect(store.selectedTurn?.status).toBe('ready')
    expect(store.selectedTurn?.manifest?.entryId).toBe(22)
  })

  it('keeps ready turn content visible while memory updates refresh it in the background', async () => {
    const { store, messageStore, memoryClient, emitMemoryUpdated } = await setupStore()
    messageStore.messageCache.set('user-1', makeMessage('user-1', 'user', 1))
    messageStore.messageCache.set('assistant-1', makeMessage('assistant-1', 'assistant', 2))
    messageStore.messageIds = ['user-1', 'assistant-1']
    const freshManifest = deferred<any[]>()
    memoryClient.listViewManifests
      .mockResolvedValueOnce([
        {
          sessionId: 'session-1',
          messageId: 'user-1',
          entryId: 1,
          policyVersion: 1,
          tokenBudget: 1000,
          estimatedTokens: 100,
          selectedCount: 1,
          selectedIds: ['old'],
          droppedCount: 0,
          queryHash: 'old',
          createdAt: 200
        }
      ])
      .mockReturnValueOnce(freshManifest.promise)
    memoryClient.getByIds
      .mockResolvedValueOnce([makeMemory('old')])
      .mockResolvedValueOnce([makeMemory('fresh')])

    await store.openTurnMemories('assistant-1')
    expect(store.selectedTurn?.details[0].id).toBe('old')

    emitMemoryUpdated({ agentId: 'deepchat', reason: 'reindex', version: 2 })
    await flushMicrotasks()

    expect(store.selectedTurnMessageId).toBe('assistant-1')
    expect(store.selectedTurn?.status).toBe('ready')
    expect(store.selectedTurn?.details[0].id).toBe('old')
    expect(store.selectedTurn?.stale).toBe(true)

    freshManifest.resolve([
      {
        sessionId: 'session-1',
        messageId: 'user-1',
        entryId: 2,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 100,
        selectedCount: 1,
        selectedIds: ['fresh'],
        droppedCount: 0,
        queryHash: 'fresh',
        createdAt: 300
      }
    ])
    await flushMicrotasks()

    expect(store.selectedTurn?.manifest?.entryId).toBe(2)
    expect(store.selectedTurn?.details[0].id).toBe('fresh')
    expect(store.selectedTurn?.stale).toBe(false)
  })

  it('refreshes the open turn for cross-session extract without loading a chip', async () => {
    const { store, messageStore, memoryClient, emitMemoryUpdated } = await setupStore()
    messageStore.messageCache.set('user-1', makeMessage('user-1', 'user', 1))
    messageStore.messageCache.set('assistant-1', makeMessage('assistant-1', 'assistant', 2))
    messageStore.messageIds = ['user-1', 'assistant-1']
    memoryClient.listViewManifests
      .mockResolvedValueOnce([
        {
          sessionId: 'session-1',
          messageId: 'user-1',
          entryId: 1,
          policyVersion: 1,
          tokenBudget: 1000,
          estimatedTokens: 100,
          selectedCount: 0,
          selectedIds: [],
          droppedCount: 0,
          queryHash: 'old',
          createdAt: 200
        }
      ])
      .mockResolvedValueOnce([
        {
          sessionId: 'session-1',
          messageId: 'user-1',
          entryId: 2,
          policyVersion: 1,
          tokenBudget: 1000,
          estimatedTokens: 100,
          selectedCount: 0,
          selectedIds: [],
          droppedCount: 0,
          queryHash: 'fresh',
          createdAt: 300
        }
      ])

    await store.openTurnMemories('assistant-1')
    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 2,
      sessionId: 'other-session',
      createdIds: ['m-other']
    })
    await flushMicrotasks()

    expect(memoryClient.listViewManifests).toHaveBeenCalledTimes(2)
    expect(memoryClient.getByIds).not.toHaveBeenCalled()
    expect(store.chipItems).toEqual([])
    expect(store.selectedTurn?.manifest?.entryId).toBe(2)
  })

  it('runs a follow-up refresh when a turn is invalidated during an in-flight background load', async () => {
    const { store, messageStore, memoryClient, emitMemoryUpdated } = await setupStore()
    messageStore.messageCache.set('user-1', makeMessage('user-1', 'user', 1))
    messageStore.messageCache.set('assistant-1', makeMessage('assistant-1', 'assistant', 2))
    messageStore.messageIds = ['user-1', 'assistant-1']
    const inFlightRefresh = deferred<any[]>()
    memoryClient.listViewManifests
      .mockResolvedValueOnce([
        {
          sessionId: 'session-1',
          messageId: 'user-1',
          entryId: 1,
          policyVersion: 1,
          tokenBudget: 1000,
          estimatedTokens: 100,
          selectedCount: 0,
          selectedIds: [],
          droppedCount: 0,
          queryHash: 'old',
          createdAt: 200
        }
      ])
      .mockReturnValueOnce(inFlightRefresh.promise)
      .mockResolvedValueOnce([
        {
          sessionId: 'session-1',
          messageId: 'user-1',
          entryId: 3,
          policyVersion: 1,
          tokenBudget: 1000,
          estimatedTokens: 100,
          selectedCount: 0,
          selectedIds: [],
          droppedCount: 0,
          queryHash: 'final',
          createdAt: 400
        }
      ])

    await store.openTurnMemories('assistant-1')
    emitMemoryUpdated({ agentId: 'deepchat', reason: 'reindex', version: 2 })
    await flushMicrotasks()
    emitMemoryUpdated({ agentId: 'deepchat', reason: 'reindex', version: 3 })
    await flushMicrotasks()

    inFlightRefresh.resolve([
      {
        sessionId: 'session-1',
        messageId: 'user-1',
        entryId: 2,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 100,
        selectedCount: 0,
        selectedIds: [],
        droppedCount: 0,
        queryHash: 'stale',
        createdAt: 300
      }
    ])
    await flushMicrotasks()

    expect(memoryClient.listViewManifests).toHaveBeenCalledTimes(3)
    expect(store.selectedTurn?.manifest?.entryId).toBe(3)
    expect(store.selectedTurn?.stale).toBe(false)
  })

  it('does not auto-retry a failed background turn refresh until a new invalidation arrives', async () => {
    const { store, messageStore, memoryClient, emitMemoryUpdated } = await setupStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    messageStore.messageCache.set('user-1', makeMessage('user-1', 'user', 1))
    messageStore.messageCache.set('assistant-1', makeMessage('assistant-1', 'assistant', 2))
    messageStore.messageIds = ['user-1', 'assistant-1']
    memoryClient.listViewManifests.mockResolvedValueOnce([
      {
        sessionId: 'session-1',
        messageId: 'user-1',
        entryId: 1,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 100,
        selectedCount: 0,
        selectedIds: [],
        droppedCount: 0,
        queryHash: 'old',
        createdAt: 200
      }
    ])

    await store.openTurnMemories('assistant-1')
    memoryClient.listViewManifests.mockRejectedValue(new Error('db down'))

    emitMemoryUpdated({ agentId: 'deepchat', reason: 'reindex', version: 2 })
    await flushMicrotasks(40)
    const callsAfterFirstFlush = memoryClient.listViewManifests.mock.calls.length

    await flushMicrotasks(40)

    expect(callsAfterFirstFlush).toBe(2)
    expect(memoryClient.listViewManifests).toHaveBeenCalledTimes(2)
    expect(store.selectedTurn?.status).toBe('ready')
    expect(store.selectedTurn?.manifest?.entryId).toBe(1)
    expect(store.selectedTurn?.stale).toBe(true)
    expect(store.selectedTurn?.error).toBe('db down')

    memoryClient.listViewManifests.mockResolvedValueOnce([
      {
        sessionId: 'session-1',
        messageId: 'user-1',
        entryId: 2,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 100,
        selectedCount: 0,
        selectedIds: [],
        droppedCount: 0,
        queryHash: 'fresh',
        createdAt: 300
      }
    ])

    emitMemoryUpdated({ agentId: 'deepchat', reason: 'reindex', version: 3 })
    await flushMicrotasks()

    expect(memoryClient.listViewManifests).toHaveBeenCalledTimes(3)
    expect(store.selectedTurn?.manifest?.entryId).toBe(2)
    expect(store.selectedTurn?.stale).toBe(false)
    expect(store.selectedTurn?.error).toBeNull()
    warnSpy.mockRestore()
  })

  it('keeps existing chip state and draft when a newer chip load fails', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    memoryClient.getByIds
      .mockResolvedValueOnce([makeMemory('m1')])
      .mockRejectedValueOnce(new Error('load failed'))

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()
    store.startChipEdit(store.chipItems[0])
    store.setChipDraftText('draft text')

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 2,
      sessionId: 'session-1',
      createdIds: ['m2']
    })
    await flushMicrotasks()

    expect(store.chipItems.map((item) => item.id)).toEqual(['m1'])
    expect(store.displayChipItems.map((item) => item.id)).toEqual(['m1'])
    expect(store.chipDraft).toMatchObject({ memoryId: 'm1', text: 'draft text' })
    warnSpy.mockRestore()
  })

  it('keeps the chip editable when amend archive succeeds but add fails', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])
    memoryClient.archive.mockResolvedValue(true)
    memoryClient.restore.mockResolvedValue(true)
    memoryClient.add.mockRejectedValueOnce(new Error('add failed')).mockResolvedValueOnce({
      action: 'created',
      memoryId: 'm2'
    })

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    await expect(store.amend('m1', 'edited content')).resolves.toBeNull()

    expect(memoryClient.archive).toHaveBeenCalledWith('deepchat', 'm1')
    expect(memoryClient.add).toHaveBeenCalledWith('deepchat', {
      content: 'edited content',
      sessionId: 'session-1',
      importance: 0.6,
      kind: 'semantic'
    })
    expect(memoryClient.restore).toHaveBeenCalledWith('deepchat', 'm1')
    expect(store.chipItems.map((item) => item.id)).toEqual(['m1'])
    expect(store.chipItems[0].error).toBe('amend_failed_retry')

    await expect(store.amend('m1', 'edited content')).resolves.toEqual({
      action: 'created',
      memoryId: 'm2'
    })
    expect(memoryClient.archive).toHaveBeenCalledTimes(2)
    expect(memoryClient.add).toHaveBeenCalledTimes(2)
    expect(store.chipItems).toEqual([])
    warnSpy.mockRestore()
  })

  it('treats updated amend results as success and preserves category metadata', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([
      makeMemory('m1', {
        category: 'project_fact',
        importance: 0.9
      })
    ])
    memoryClient.archive.mockResolvedValue(true)
    memoryClient.add.mockResolvedValue({
      action: 'updated',
      memoryId: 'm2'
    })

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    await expect(store.amend('m1', 'updated content')).resolves.toEqual({
      action: 'updated',
      memoryId: 'm2'
    })

    expect(memoryClient.add).toHaveBeenCalledWith('deepchat', {
      content: 'updated content',
      sessionId: 'session-1',
      importance: 0.9,
      category: 'project_fact'
    })
    expect(memoryClient.restore).not.toHaveBeenCalled()
    expect(store.chipItems).toEqual([])
  })

  it('keeps the chip editable when amend resolves to noop and restores the original memory', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])
    memoryClient.archive.mockResolvedValue(true)
    memoryClient.restore.mockResolvedValue(true)
    memoryClient.add.mockResolvedValue({
      action: 'noop',
      reason: 'duplicate'
    })

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    await expect(store.amend('m1', 'duplicate content')).resolves.toBeNull()

    expect(memoryClient.restore).toHaveBeenCalledWith('deepchat', 'm1')
    expect(store.chipItems.map((item) => item.id)).toEqual(['m1'])
    expect(store.chipItems[0].memory.status).toBe('pending_embedding')
    expect(store.chipItems[0].error).toBe('amend_failed_retry')
  })

  it('marks amend as unrecovered when restore after a failed add also fails', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])
    memoryClient.archive.mockResolvedValue(true)
    memoryClient.add.mockRejectedValue(new Error('add failed'))
    memoryClient.restore.mockRejectedValue(new Error('restore failed'))

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    await expect(store.amend('m1', 'edited content')).resolves.toBeNull()

    expect(store.chipItems[0].error).toBe('amend_restore_failed')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('marks amend as unrecovered when noop restoration returns false', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])
    memoryClient.archive.mockResolvedValue(true)
    memoryClient.add.mockResolvedValue({
      action: 'noop',
      reason: 'duplicate'
    })
    memoryClient.restore.mockResolvedValue(false)

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    await expect(store.amend('m1', 'duplicate content')).resolves.toBeNull()

    expect(memoryClient.restore).toHaveBeenCalledWith('deepchat', 'm1')
    expect(store.chipItems[0].memory.status).toBe('archived')
    expect(store.chipItems[0].error).toBe('amend_restore_failed')
  })

  it('marks amend as unrecovered when restore returns false after a failed add', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])
    memoryClient.archive.mockResolvedValue(true)
    memoryClient.add.mockRejectedValue(new Error('add failed'))
    memoryClient.restore.mockResolvedValue(false)

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    await expect(store.amend('m1', 'edited content')).resolves.toBeNull()

    expect(store.chipItems[0].memory.status).toBe('archived')
    expect(store.chipItems[0].error).toBe('amend_restore_failed')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('preserves forget errors and does not clear them while clearing busy state', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])
    memoryClient.archive.mockResolvedValue(false)

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    await expect(store.forget('m1')).resolves.toBe(false)

    expect(store.chipItems[0].busy).toBe(false)
    expect(store.chipItems[0].error).toBe('archive_failed')
  })

  it('blocks undo and amend actions for archived chip items', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1', { status: 'archived' })])

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    await expect(store.undoCreated('m1')).resolves.toBe(false)
    await expect(store.amend('m1', 'edited content')).resolves.toBeNull()

    expect(memoryClient.remove).not.toHaveBeenCalled()
    expect(memoryClient.archive).not.toHaveBeenCalled()
    expect(memoryClient.add).not.toHaveBeenCalled()
  })

  it('blocks busy chip mutations at the store boundary', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()
    store.chipItems[0].busy = true

    await expect(store.undoCreated('m1')).resolves.toBe(false)
    await expect(store.forget('m1')).resolves.toBe(false)
    await expect(store.amend('m1', 'edited content')).resolves.toBeNull()

    expect(memoryClient.remove).not.toHaveBeenCalled()
    expect(memoryClient.archive).not.toHaveBeenCalled()
    expect(memoryClient.add).not.toHaveBeenCalled()
    expect(memoryClient.restore).not.toHaveBeenCalled()
  })

  it('short-circuits concurrent amend calls for the same memory', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    const archive = deferred<boolean>()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])
    memoryClient.archive.mockReturnValueOnce(archive.promise)
    memoryClient.add.mockResolvedValue({
      action: 'created',
      memoryId: 'm2'
    })

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    const firstAmend = store.amend('m1', 'edited content')
    await expect(store.amend('m1', 'second edit')).resolves.toBeNull()
    expect(memoryClient.archive).toHaveBeenCalledTimes(1)
    expect(memoryClient.add).not.toHaveBeenCalled()
    expect(memoryClient.restore).not.toHaveBeenCalled()

    archive.resolve(true)
    await expect(firstAmend).resolves.toEqual({
      action: 'created',
      memoryId: 'm2'
    })
    expect(memoryClient.add).toHaveBeenCalledTimes(1)
    expect(memoryClient.restore).not.toHaveBeenCalled()
  })

  it('keeps the turn panel open and marks details archived after forget events', async () => {
    const { store, messageStore, memoryClient, emitMemoryUpdated } = await setupStore()
    messageStore.messageCache.set('user-1', makeMessage('user-1', 'user', 1))
    messageStore.messageCache.set('assistant-1', makeMessage('assistant-1', 'assistant', 2))
    messageStore.messageIds = ['user-1', 'assistant-1']
    memoryClient.listViewManifests.mockResolvedValue([
      {
        sessionId: 'session-1',
        messageId: 'user-1',
        entryId: 12,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 100,
        selectedCount: 1,
        selectedIds: ['m1'],
        droppedCount: 0,
        queryHash: 'hash',
        createdAt: 200
      }
    ])
    memoryClient.getByIds
      .mockResolvedValueOnce([makeMemory('m1')])
      .mockResolvedValueOnce([makeMemory('m1', { status: 'archived' })])
    memoryClient.archive.mockResolvedValue(true)

    await store.openTurnMemories('assistant-1')
    await expect(store.forget('m1')).resolves.toBe(true)
    emitMemoryUpdated({ agentId: 'deepchat', reason: 'extract', version: 2 })
    await flushMicrotasks()

    expect(store.selectedTurnMessageId).toBe('assistant-1')
    expect(store.selectedTurn?.details[0].memory?.status).toBe('archived')
  })

  it('ignores late chip loads from older extract events in the same session', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    const first = deferred<ReturnType<typeof makeMemory>[]>()
    const second = deferred<ReturnType<typeof makeMemory>[]>()
    memoryClient.getByIds.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['old']
    })
    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 2,
      sessionId: 'session-1',
      createdIds: ['new']
    })

    second.resolve([makeMemory('new')])
    await flushMicrotasks()
    expect(store.chipItems.map((item) => item.id)).toEqual(['new'])

    first.resolve([makeMemory('old')])
    await flushMicrotasks()
    expect(store.chipItems.map((item) => item.id)).toEqual(['new'])
  })

  it('does not resurrect a targeted deleted chip from an in-flight chip load', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    const pendingLoad = deferred<ReturnType<typeof makeMemory>[]>()
    memoryClient.getByIds.mockReturnValueOnce(pendingLoad.promise)

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()

    emitMemoryUpdated({ agentId: 'deepchat', reason: 'delete', version: 2, memoryId: 'm1' })
    pendingLoad.resolve([makeMemory('m1')])
    await flushMicrotasks()

    expect(memoryClient.getByIds).toHaveBeenCalledWith('deepchat', ['m1'])
    expect(store.chipItems).toEqual([])
  })

  it('keeps an active chip draft when a newer extract replaces chip items', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds
      .mockResolvedValueOnce([makeMemory('m1')])
      .mockResolvedValueOnce([makeMemory('m2')])

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()
    store.startChipEdit(store.chipItems[0])
    store.setChipDraftText('draft text')

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 2,
      sessionId: 'session-1',
      createdIds: ['m2']
    })
    await flushMicrotasks()

    expect(store.chipDraft).toMatchObject({ memoryId: 'm1', text: 'draft text' })
    expect(store.displayChipItems.map((item) => item.id)).toEqual(['m1', 'm2'])
  })

  it('removes only the deleted chip item when a delete echo carries memoryId', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1'), makeMemory('m2'), makeMemory('m3')])
    memoryClient.remove.mockResolvedValue(true)

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1', 'm2', 'm3']
    })
    await flushMicrotasks()
    expect(store.chipItems.map((item) => item.id)).toEqual(['m1', 'm2', 'm3'])

    await expect(store.undoCreated('m1')).resolves.toBe(true)
    emitMemoryUpdated({ agentId: 'deepchat', reason: 'delete', version: 2, memoryId: 'm1' })
    await flushMicrotasks()

    expect(store.chipItems.map((item) => item.id)).toEqual(['m2', 'm3'])
  })

  it('clears chip state on untargeted delete and clear events for the active agent', async () => {
    const { store, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()
    expect(store.chipItems.map((item) => item.id)).toEqual(['m1'])

    emitMemoryUpdated({ agentId: 'deepchat', reason: 'delete', version: 2 })
    await flushMicrotasks()
    expect(store.chipItems).toEqual([])

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 3,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()
    expect(store.chipItems.map((item) => item.id)).toEqual(['m1'])

    emitMemoryUpdated({ agentId: 'deepchat', reason: 'clear', version: 4 })
    await flushMicrotasks()
    expect(store.chipItems).toEqual([])
  })

  it('does not let stale in-flight turn loads overwrite a newer reload', async () => {
    const { store, messageStore, memoryClient, emitMemoryUpdated } = await setupStore()
    messageStore.messageCache.set('user-1', makeMessage('user-1', 'user', 1))
    messageStore.messageCache.set('assistant-1', makeMessage('assistant-1', 'assistant', 2))
    messageStore.messageIds = ['user-1', 'assistant-1']
    const firstManifest = deferred<any[]>()
    memoryClient.listViewManifests
      .mockReturnValueOnce(firstManifest.promise)
      .mockResolvedValueOnce([
        {
          sessionId: 'session-1',
          messageId: 'user-1',
          entryId: 2,
          policyVersion: 1,
          tokenBudget: 1000,
          estimatedTokens: 100,
          selectedCount: 1,
          selectedIds: ['fresh'],
          droppedCount: 0,
          queryHash: 'fresh',
          createdAt: 300
        }
      ])
    memoryClient.getByIds.mockResolvedValue([makeMemory('fresh')])

    void store.openTurnMemories('assistant-1')
    emitMemoryUpdated({ agentId: 'deepchat', reason: 'reindex', version: 2 })
    await flushMicrotasks()

    firstManifest.resolve([
      {
        sessionId: 'session-1',
        messageId: 'user-1',
        entryId: 1,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 100,
        selectedCount: 1,
        selectedIds: ['stale'],
        droppedCount: 0,
        queryHash: 'stale',
        createdAt: 200
      }
    ])
    await flushMicrotasks()

    expect(store.selectedTurnMessageId).toBe('assistant-1')
    expect(store.selectedTurn?.manifest?.entryId).toBe(2)
    expect(store.selectedTurn?.details[0].id).toBe('fresh')
  })

  it('blocks memory mutations in read-only sessions', async () => {
    const { store, sessionStore, memoryClient, emitMemoryUpdated } = await setupStore()
    memoryClient.getByIds.mockResolvedValue([makeMemory('m1')])

    emitMemoryUpdated({
      agentId: 'deepchat',
      reason: 'extract',
      version: 1,
      sessionId: 'session-1',
      createdIds: ['m1']
    })
    await flushMicrotasks()
    sessionStore.sessions = [{ ...makeSession(), sessionKind: 'subagent' } as any]
    await flushMicrotasks()

    await expect(store.forget('m1')).resolves.toBe(false)
    await expect(store.amend('m1', 'edited content')).resolves.toBeNull()
    await expect(store.rememberSelection('remember this')).resolves.toBeNull()
    await expect(store.undoCreated('m1')).resolves.toBe(false)

    expect(memoryClient.archive).not.toHaveBeenCalled()
    expect(memoryClient.add).not.toHaveBeenCalled()
    expect(memoryClient.remove).not.toHaveBeenCalled()
  })

  it('remembers selected text with the active session id', async () => {
    const { store, memoryClient } = await setupStore()
    memoryClient.add.mockResolvedValue({ action: 'created', memoryId: 'm-new' })

    await expect(store.rememberSelection('  remember this  ')).resolves.toEqual({
      action: 'created',
      memoryId: 'm-new'
    })
    expect(memoryClient.add).toHaveBeenCalledWith('deepchat', {
      content: 'remember this',
      sessionId: 'session-1'
    })
  })
})
