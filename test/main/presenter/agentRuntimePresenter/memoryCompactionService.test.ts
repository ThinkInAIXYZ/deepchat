import { beforeEach, describe, expect, it, vi } from 'vitest'
import { publishDeepchatEvent } from '@/routes/publishDeepchatEvent'
import { RuntimeSharedState } from '@/presenter/agentRuntimePresenter/runtimeSharedState'
import {
  MemoryCompactionService,
  type ManualCompactionRequest,
  type MemoryCompactionDependencies,
  type MemoryCompactionHost
} from '@/presenter/agentRuntimePresenter/memoryCompactionService'
import type { CompactionIntent } from '@/presenter/agentRuntimePresenter/compactionService'

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: vi.fn()
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('MemoryCompactionService', () => {
  let runtimeSharedState: RuntimeSharedState
  let summaryState: {
    summaryText: string | null
    summaryCursorOrderSeq: number
    summaryUpdatedAt: number | null
  }
  let memoryCursor: number
  let sessionStore: Record<string, ReturnType<typeof vi.fn>>
  let messageStore: Record<string, ReturnType<typeof vi.fn>>
  let compactionService: Record<string, ReturnType<typeof vi.fn>>
  let sqlitePresenter: any
  let memoryPort: Record<string, ReturnType<typeof vi.fn>>
  let host: MemoryCompactionHost
  let service: MemoryCompactionService

  const intent = (): CompactionIntent => ({
    sessionId: 's1',
    previousState: {
      summaryText: null,
      summaryCursorOrderSeq: 1,
      summaryUpdatedAt: null
    },
    targetCursorOrderSeq: 5,
    summaryBlocks: ['summary input'],
    currentModel: {
      providerId: 'openai',
      modelId: 'gpt-4',
      contextLength: 32000
    },
    reserveTokens: 4096
  })

  beforeEach(() => {
    vi.clearAllMocks()
    runtimeSharedState = new RuntimeSharedState()
    runtimeSharedState.runtimeState.set('s1', {
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4',
      permissionMode: 'full_access'
    })
    summaryState = {
      summaryText: null,
      summaryCursorOrderSeq: 1,
      summaryUpdatedAt: null
    }
    memoryCursor = 0
    sessionStore = {
      get: vi.fn(() => ({ id: 's1' })),
      getSummaryState: vi.fn(() => ({ ...summaryState })),
      resetSummaryState: vi.fn(() => {
        summaryState = {
          summaryText: null,
          summaryCursorOrderSeq: 1,
          summaryUpdatedAt: null
        }
      })
    }
    messageStore = {
      createCompactionMessage: vi.fn(() => 'compaction-message'),
      createCompactionMessageAtOrderSeq: vi.fn(() => 'compaction-message'),
      getNextOrderSeq: vi.fn(() => 7),
      updateCompactionMessage: vi.fn(),
      deleteMessage: vi.fn(),
      getMessagesUpToOrderSeq: vi.fn(() => [])
    }
    compactionService = {
      prepareForNextUserTurn: vi.fn(),
      prepareForContextPressureRecovery: vi.fn(),
      prepareForResumeTurn: vi.fn(),
      prepareForManualCompaction: vi.fn(),
      applyCompaction: vi.fn()
    }
    sqlitePresenter = {
      deepchatSessionsTable: {
        getMemoryCursorOrderSeq: vi.fn(() => memoryCursor),
        updateMemoryCursorOrderSeq: vi.fn((_sessionId: string, cursor: number) => {
          memoryCursor = cursor
        }),
        rewindMemoryCursorOrderSeq: vi.fn((_sessionId: string, cursor: number) => {
          memoryCursor = cursor
        })
      },
      deepchatTapeEntriesTable: {
        appendAnchor: vi.fn(),
        getBySession: vi.fn(() => [])
      },
      deepchatMemoryIngestionProjectionTable: {
        readCurrentRange: vi.fn(() => ({ current: true, rows: [], maxEntryId: 0 })),
        replaceSession: vi.fn(),
        invalidateSession: vi.fn()
      }
    }
    memoryPort = {
      isEnabled: vi.fn(() => true),
      buildInjection: vi.fn(),
      recordInjectionAccess: vi.fn(),
      extractAndStore: vi.fn(),
      observeExtractionQueue: vi.fn()
    }
    host = {
      getSessionAgentId: vi.fn(() => 'deepchat'),
      getSessionListState: vi.fn(async () => runtimeSharedState.runtimeState.get('s1') ?? null),
      hasPendingInteractions: vi.fn(() => false),
      supportsManualCompaction: vi.fn(() => true),
      buildManualCompactionRequest: vi.fn(async () => ({
        sessionId: 's1',
        providerId: 'openai',
        modelId: 'gpt-4',
        systemPrompt: 'system',
        contextLength: 32000,
        reserveTokens: 4096,
        supportsVision: false,
        supportsAudioInput: false,
        preserveInterleavedReasoning: false,
        historyRecords: []
      })) as MemoryCompactionHost['buildManualCompactionRequest'],
      setSessionStatus: vi.fn((sessionId, status) => {
        const state = runtimeSharedState.runtimeState.get(sessionId)
        if (state) state.status = status
      }),
      emitMessageRefresh: vi.fn()
    }
    service = new MemoryCompactionService(
      {
        sqlitePresenter,
        sessionStore,
        messageStore,
        runtimeSharedState,
        compactionService,
        memoryPort
      } as unknown as MemoryCompactionDependencies,
      host
    )
  })

  it('initializes idle state and reconciles persisted compacted state', async () => {
    service.initializeSession('s1')
    summaryState = {
      summaryText: 'persisted summary',
      summaryCursorOrderSeq: 5,
      summaryUpdatedAt: 100
    }

    await expect(service.getSessionCompactionState('s1')).resolves.toEqual({
      status: 'compacted',
      cursorOrderSeq: 5,
      summaryUpdatedAt: 100
    })
  })

  it('applies compaction and owns message plus state event transitions', async () => {
    compactionService.applyCompaction.mockImplementation(async () => {
      summaryState = {
        summaryText: 'new summary',
        summaryCursorOrderSeq: 5,
        summaryUpdatedAt: 200
      }
      return { succeeded: true, summaryState: { ...summaryState } }
    })

    await expect(service.applyCompactionIntent('s1', intent())).resolves.toEqual(summaryState)

    expect(messageStore.createCompactionMessage).toHaveBeenCalledWith('s1', 7, 'compacting', null)
    expect(messageStore.updateCompactionMessage).toHaveBeenCalledWith(
      'compaction-message',
      'compacted',
      200
    )
    expect(host.emitMessageRefresh).toHaveBeenCalledTimes(2)
    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'sessions.compaction.changed',
      expect.objectContaining({ sessionId: 's1', status: 'compacting', cursorOrderSeq: 5 })
    )
    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'sessions.compaction.changed',
      expect.objectContaining({ sessionId: 's1', status: 'compacted', cursorOrderSeq: 5 })
    )
  })

  it('removes the transient message and restores prior state when cancellation wins', async () => {
    const controller = new AbortController()
    compactionService.applyCompaction.mockImplementation(async () => {
      controller.abort()
      throw new Error('late failure')
    })

    await expect(
      service.applyCompactionIntent('s1', intent(), { signal: controller.signal })
    ).rejects.toThrow('late failure')

    expect(messageStore.deleteMessage).toHaveBeenCalledWith('compaction-message')
    expect(publishDeepchatEvent).toHaveBeenLastCalledWith(
      'sessions.compaction.changed',
      expect.objectContaining({ sessionId: 's1', status: 'idle', cursorOrderSeq: 1 })
    )
  })

  it('cleans up transient compaction state on a normal apply rejection', async () => {
    compactionService.applyCompaction.mockRejectedValue(new Error('provider failed'))

    await expect(service.applyCompactionIntent('s1', intent())).rejects.toThrow('provider failed')

    expect(messageStore.deleteMessage).toHaveBeenCalledWith('compaction-message')
    expect(host.emitMessageRefresh).toHaveBeenCalledTimes(2)
    expect(publishDeepchatEvent).toHaveBeenLastCalledWith(
      'sessions.compaction.changed',
      expect.objectContaining({ sessionId: 's1', status: 'idle', cursorOrderSeq: 1 })
    )
  })

  it('resolves resume compaction with one signal and inserts before applying', async () => {
    const controller = new AbortController()
    const preparedIntent = intent()
    const compactedSummary = {
      summaryText: 'resume summary',
      summaryCursorOrderSeq: 5,
      summaryUpdatedAt: 250
    }
    compactionService.prepareForResumeTurn.mockResolvedValue(preparedIntent)
    compactionService.applyCompaction.mockResolvedValue({
      succeeded: true,
      summaryState: compactedSummary
    })
    const request = {
      sessionId: 's1',
      messageId: 'assistant-1',
      providerId: 'openai',
      modelId: 'gpt-4',
      systemPrompt: 'system',
      contextLength: 32000,
      reserveTokens: 4096,
      supportsVision: false,
      preserveInterleavedReasoning: false,
      compactionMessageOrderSeq: 4,
      signal: controller.signal
    }

    await expect(service.resolveCompactionStateForResumeTurn(request)).resolves.toEqual(
      compactedSummary
    )

    expect(compactionService.prepareForResumeTurn).toHaveBeenCalledWith(request)
    expect(messageStore.createCompactionMessageAtOrderSeq).toHaveBeenCalledWith(
      's1',
      4,
      'compacting',
      null,
      { shiftExistingMessages: true }
    )
    expect(compactionService.applyCompaction).toHaveBeenCalledWith(
      preparedIntent,
      controller.signal
    )
    expect(compactionService.prepareForResumeTurn.mock.invocationCallOrder[0]).toBeLessThan(
      messageStore.createCompactionMessageAtOrderSeq.mock.invocationCallOrder[0]
    )
    expect(messageStore.createCompactionMessageAtOrderSeq.mock.invocationCallOrder[0]).toBeLessThan(
      compactionService.applyCompaction.mock.invocationCallOrder[0]
    )
  })

  it('manually compacts through the preparation host and always restores idle', async () => {
    const preparedIntent = intent()
    compactionService.prepareForManualCompaction.mockResolvedValue(preparedIntent)
    compactionService.applyCompaction.mockImplementation(async () => {
      summaryState = {
        summaryText: 'manual summary',
        summaryCursorOrderSeq: 5,
        summaryUpdatedAt: 300
      }
      return { succeeded: true, summaryState: { ...summaryState } }
    })

    await expect(service.compactSession('s1')).resolves.toEqual({
      compacted: true,
      state: { status: 'compacted', cursorOrderSeq: 5, summaryUpdatedAt: 300 }
    })
    expect(host.buildManualCompactionRequest).toHaveBeenCalledWith(
      's1',
      expect.any(Object),
      expect.any(AbortSignal)
    )
    expect(vi.mocked(host.setSessionStatus).mock.calls).toEqual([
      ['s1', 'generating'],
      ['s1', 'idle']
    ])
    expect(compactionService.prepareForManualCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        signal: expect.any(AbortSignal)
      }) as ManualCompactionRequest
    )
    expect(runtimeSharedState.runtimeState.get('s1')?.status).toBe('idle')
  })

  it('rejects unsupported, active, and interaction-blocked manual compaction', async () => {
    vi.mocked(host.supportsManualCompaction).mockReturnValue(false)
    await expect(service.compactSession('s1')).rejects.toThrow(
      'Manual compaction is only available for DeepChat agent sessions.'
    )

    vi.mocked(host.supportsManualCompaction).mockReturnValue(true)
    runtimeSharedState.runtimeState.get('s1')!.status = 'generating'
    await expect(service.compactSession('s1')).rejects.toThrow(
      'Manual compaction is only available when the session is idle.'
    )

    runtimeSharedState.runtimeState.get('s1')!.status = 'idle'
    vi.mocked(host.hasPendingInteractions).mockReturnValue(true)
    await expect(service.compactSession('s1')).rejects.toThrow(
      'Pending tool interactions must be resolved before compacting.'
    )
    expect(compactionService.prepareForManualCompaction).not.toHaveBeenCalled()
  })

  it('cancels owned manual compaction and restores idle status', async () => {
    const preparation = deferred<ManualCompactionRequest>()
    vi.mocked(host.buildManualCompactionRequest).mockReturnValue(preparation.promise)

    const compacting = service.compactSession('s1')
    await vi.waitFor(() => expect(host.buildManualCompactionRequest).toHaveBeenCalled())
    const signal = vi.mocked(host.buildManualCompactionRequest).mock.calls[0][2]

    expect(service.cancelManualCompaction('s1')).toBe(true)
    expect(runtimeSharedState.runtimeState.get('s1')?.status).toBe('idle')
    expect(vi.mocked(host.setSessionStatus).mock.calls).toEqual([
      ['s1', 'generating'],
      ['s1', 'idle']
    ])
    preparation.resolve({
      sessionId: 's1',
      providerId: 'openai',
      modelId: 'gpt-4',
      systemPrompt: 'system',
      contextLength: 32000,
      reserveTokens: 4096,
      supportsVision: false,
      preserveInterleavedReasoning: false
    })

    await expect(compacting).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal?.aborted).toBe(true)
    expect(vi.mocked(host.setSessionStatus).mock.calls).toEqual([
      ['s1', 'generating'],
      ['s1', 'idle']
    ])
    expect(service.cancelManualCompaction('s1')).toBe(false)
    expect(compactionService.prepareForManualCompaction).not.toHaveBeenCalled()
  })

  it('does not let cancelled compaction completion idle a replacement turn', async () => {
    const preparation = deferred<ManualCompactionRequest>()
    vi.mocked(host.buildManualCompactionRequest).mockReturnValue(preparation.promise)

    const compacting = service.compactSession('s1')
    await vi.waitFor(() => expect(host.buildManualCompactionRequest).toHaveBeenCalled())

    expect(service.cancelManualCompaction('s1')).toBe(true)
    host.setSessionStatus('s1', 'generating')
    preparation.resolve({
      sessionId: 's1',
      providerId: 'openai',
      modelId: 'gpt-4',
      systemPrompt: 'system',
      contextLength: 32000,
      reserveTokens: 4096,
      supportsVision: false,
      preserveInterleavedReasoning: false
    })

    await expect(compacting).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.mocked(host.setSessionStatus).mock.calls).toEqual([
      ['s1', 'generating'],
      ['s1', 'idle'],
      ['s1', 'generating']
    ])
    expect(runtimeSharedState.runtimeState.get('s1')?.status).toBe('generating')
  })

  it('aborts manual compaction preparation when clear resets the session', async () => {
    const preparation = deferred<ManualCompactionRequest>()
    vi.mocked(host.buildManualCompactionRequest).mockReturnValue(preparation.promise)

    const compacting = service.compactSession('s1')
    await vi.waitFor(() => expect(host.buildManualCompactionRequest).toHaveBeenCalled())
    const signal = vi.mocked(host.buildManualCompactionRequest).mock.calls[0][2]

    service.resetMemoryExtractionCursor('s1')
    preparation.resolve({
      sessionId: 's1',
      providerId: 'openai',
      modelId: 'gpt-4',
      systemPrompt: 'system',
      contextLength: 32000,
      reserveTokens: 4096,
      supportsVision: false,
      preserveInterleavedReasoning: false
    })

    await expect(compacting).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal?.aborted).toBe(true)
    expect(compactionService.prepareForManualCompaction).not.toHaveBeenCalled()
  })

  it('drops a late manual apply result after destroy invalidates its epoch', async () => {
    const applying = deferred<{
      succeeded: true
      summaryState: typeof summaryState
    }>()
    compactionService.prepareForManualCompaction.mockResolvedValue(intent())
    compactionService.applyCompaction.mockReturnValue(applying.promise)

    const compacting = service.compactSession('s1')
    await vi.waitFor(() => expect(compactionService.applyCompaction).toHaveBeenCalled())
    const signal = compactionService.applyCompaction.mock.calls[0][1] as AbortSignal

    service.destroySession('s1')
    applying.resolve({
      succeeded: true,
      summaryState: {
        summaryText: 'late summary',
        summaryCursorOrderSeq: 5,
        summaryUpdatedAt: 400
      }
    })

    await expect(compacting).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal.aborted).toBe(true)
    expect(messageStore.updateCompactionMessage).not.toHaveBeenCalled()
    expect(messageStore.deleteMessage).toHaveBeenCalledWith('compaction-message')
  })

  it('injects memory, writes a view anchor, and deduplicates access per message', async () => {
    memoryPort.buildInjection.mockResolvedValue({
      payload: {
        selfModel: null,
        working: null,
        memories: [{ id: 'm1', kind: 'semantic', content: 'redis fact' }]
      },
      manifest: {
        policyVersion: 1,
        selected: [{ id: 'm1', kind: 'semantic', score: 1 }],
        dropped: [],
        tokenBudget: 1200,
        estimatedTokens: 20,
        queryHash: 'query-hash'
      }
    })

    const first = await service.appendMemoryInjection('s1', 'base', 'redis', 'message-1')
    await service.appendMemoryInjection('s1', 'base', 'redis', 'message-1')
    await service.appendMemoryInjection('s1', 'base', 'redis', null)

    expect(first).toContain('## Relevant Memories')
    expect(first).toContain('redis fact')
    expect(memoryPort.recordInjectionAccess.mock.calls).toEqual([
      ['deepchat', ['m1']],
      ['deepchat', ['m1']]
    ])
    expect(sqlitePresenter.deepchatTapeEntriesTable.appendAnchor).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', name: 'memory/view_assembled' })
    )
  })

  it('does not account for or anchor an injection that finishes after cancellation', async () => {
    const injection = deferred<any>()
    const controller = new AbortController()
    memoryPort.buildInjection.mockReturnValue(injection.promise)

    const injecting = service.appendMemoryInjection(
      's1',
      'base',
      'redis',
      'message-1',
      controller.signal
    )
    await vi.waitFor(() => expect(memoryPort.buildInjection).toHaveBeenCalled())
    controller.abort()
    injection.resolve({
      payload: {
        selfModel: null,
        working: null,
        memories: [{ id: 'm1', kind: 'semantic', content: 'late fact' }]
      },
      manifest: {
        policyVersion: 1,
        selected: [{ id: 'm1', kind: 'semantic', score: 1 }],
        dropped: [],
        tokenBudget: 1200,
        estimatedTokens: 10,
        queryHash: 'query-hash'
      }
    })

    await expect(injecting).rejects.toMatchObject({ name: 'AbortError' })
    expect(memoryPort.recordInjectionAccess).not.toHaveBeenCalled()
    expect(sqlitePresenter.deepchatTapeEntriesTable.appendAnchor).not.toHaveBeenCalled()
  })

  it('clears injection dedupe state when the session is destroyed', async () => {
    memoryPort.buildInjection.mockResolvedValue({
      payload: {
        selfModel: null,
        working: null,
        memories: [{ id: 'm1', kind: 'semantic', content: 'fact' }]
      },
      manifest: {
        policyVersion: 1,
        selected: [{ id: 'm1', kind: 'semantic', score: 1 }],
        dropped: [],
        tokenBudget: 1200,
        estimatedTokens: 10,
        queryHash: 'query-hash'
      }
    })

    await service.appendMemoryInjection('s1', 'base', 'query', 'message-1')
    service.destroySession('s1')
    await service.appendMemoryInjection('s1', 'base', 'query', 'message-1')

    expect(memoryPort.recordInjectionAccess).toHaveBeenCalledTimes(2)
  })

  it('admits fallback extraction through the public queue and commits its lineage', async () => {
    messageStore.getNextOrderSeq.mockReturnValue(2)
    sqlitePresenter.deepchatMemoryIngestionProjectionTable.readCurrentRange.mockReturnValue({
      current: true,
      maxEntryId: 11,
      rows: [
        {
          session_id: 's1',
          message_id: 'assistant-1',
          order_seq: 1,
          entry_id: 11,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: 'Inspected package metadata with a tool.' }
          ]),
          status: 'sent',
          had_tool_use: 1
        }
      ]
    })
    memoryPort.extractAndStore.mockResolvedValue({ ok: true, createdIds: ['memory-1'] })

    service.triggerMemoryExtractionFallback('s1')

    await vi.waitFor(() => expect(memoryPort.extractAndStore).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(memoryPort.observeExtractionQueue).toHaveBeenLastCalledWith(0, null)
    )

    expect(memoryPort.observeExtractionQueue).toHaveBeenNthCalledWith(1, 1, expect.any(Number))
    expect(
      sqlitePresenter.deepchatMemoryIngestionProjectionTable.readCurrentRange
    ).toHaveBeenCalledWith('s1', 0, 1)
    expect(memoryPort.extractAndStore).toHaveBeenCalledWith({
      agentId: 'deepchat',
      spanText: 'Assistant: Inspected package metadata with a tool.',
      model: { providerId: 'openai', modelId: 'gpt-4' },
      sourceSession: 's1',
      sourceEntryIds: [11]
    })
    expect(sqlitePresenter.deepchatSessionsTable.updateMemoryCursorOrderSeq).toHaveBeenCalledWith(
      's1',
      1
    )
    expect(sqlitePresenter.deepchatTapeEntriesTable.appendAnchor).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        name: 'memory/extract',
        state: expect.objectContaining({
          memoryIds: ['memory-1'],
          reason: 'fallback',
          sourceEntryIds: [11],
          coveredThroughOrderSeq: 1,
          cursorCommitOrderSeq: 1
        })
      })
    )
  })

  it('commits only successful extraction chunks and records their lineage', async () => {
    memoryPort.extractAndStore.mockResolvedValue({ ok: true, createdIds: ['memory-1'] })
    const epoch = (service as any).ensureMemoryExtractionEpoch('s1') as number
    const chunk = {
      text: 'User: remember redis',
      sourceEntryIds: [11],
      cursorCommitOrderSeq: 2,
      coveredThroughOrderSeq: 2,
      fragments: [{ orderSeq: 2, entryId: 11, fragmentIndex: 0, isFinalFragment: true }]
    }

    await (service as any).runMemoryExtractionChunks(
      's1',
      { chunks: [chunk], reason: 'fallback' },
      epoch
    )

    expect(sqlitePresenter.deepchatSessionsTable.updateMemoryCursorOrderSeq).toHaveBeenCalledWith(
      's1',
      2
    )
    expect(sqlitePresenter.deepchatTapeEntriesTable.appendAnchor).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        name: 'memory/extract',
        state: expect.objectContaining({
          memoryIds: ['memory-1'],
          sourceEntryIds: [11],
          coveredThroughOrderSeq: 2
        })
      })
    )
  })

  it('drops an in-flight extraction commit after the epoch is invalidated', async () => {
    const extraction = deferred<{ ok: true; createdIds: string[] }>()
    memoryPort.extractAndStore.mockReturnValue(extraction.promise)
    const epoch = (service as any).ensureMemoryExtractionEpoch('s1') as number
    const running = (service as any).runMemoryExtractionChunks(
      's1',
      {
        chunks: [
          {
            text: 'User: remember redis',
            sourceEntryIds: [11],
            cursorCommitOrderSeq: 2,
            coveredThroughOrderSeq: 2,
            fragments: []
          }
        ],
        reason: 'fallback'
      },
      epoch
    ) as Promise<void>
    await vi.waitFor(() => expect(memoryPort.extractAndStore).toHaveBeenCalled())

    service.resetMemoryExtractionCursor('s1')
    sqlitePresenter.deepchatSessionsTable.updateMemoryCursorOrderSeq.mockClear()
    extraction.resolve({ ok: true, createdIds: ['late-memory'] })
    await running

    expect(sqlitePresenter.deepchatSessionsTable.updateMemoryCursorOrderSeq).not.toHaveBeenCalled()
    expect(sqlitePresenter.deepchatTapeEntriesTable.appendAnchor).not.toHaveBeenCalled()
  })

  it('rewinds invalidated memory and summary state at their respective boundaries', () => {
    memoryCursor = 8
    summaryState = {
      summaryText: 'summary',
      summaryCursorOrderSeq: 6,
      summaryUpdatedAt: 100
    }

    service.invalidateMemoryExtractionFromOrderSeq('s1', 4)
    service.invalidateSummaryIfNeeded('s1', 4)

    expect(sqlitePresenter.deepchatSessionsTable.rewindMemoryCursorOrderSeq).toHaveBeenCalledWith(
      's1',
      3
    )
    expect(sessionStore.resetSummaryState).toHaveBeenCalledWith('s1')
    expect(publishDeepchatEvent).toHaveBeenCalledWith(
      'sessions.compaction.changed',
      expect.objectContaining({ sessionId: 's1', status: 'idle' })
    )
  })
})
