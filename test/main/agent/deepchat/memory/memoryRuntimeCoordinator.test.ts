import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MEMORY_INJECTION_TIMEOUT_MS,
  MemoryRuntimeCoordinator
} from '@/agent/deepchat/memory/memoryRuntimeCoordinator'
import type { MemoryIngestionObserver } from '@/agent/deepchat/memory/memoryIngestionObserver'
import type {
  MemoryPromptContributor,
  MemorySessionHandle
} from '@/agent/deepchat/memory/memoryPromptContributor'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import logger from '@shared/logger'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { MemoryPresenter } from '@/presenter/memoryPresenter'
import {
  createFakeRepository,
  FakeAuditRepository,
  FakeVectorStore,
  textToVector
} from '../../../presenter/fakes/memoryFakes'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((next, nextReject) => {
    resolve = next
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function createRecord(id: string, orderSeq: number, text: string): ChatMessageRecord {
  return {
    id,
    sessionId: 's1',
    orderSeq,
    role: 'user',
    content: JSON.stringify({ text, files: [], links: [], search: false, think: false }),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: orderSeq,
    updatedAt: orderSeq
  }
}

function toTapeRow(record: ChatMessageRecord) {
  return {
    session_id: record.sessionId,
    entry_id: record.orderSeq,
    kind: 'message' as const,
    name: `message/${record.role}`,
    source_type: 'message' as const,
    source_id: record.id,
    source_seq: 0,
    provenance_key: `message:${record.id}`,
    payload_json: JSON.stringify({ record }),
    meta_json: '{}',
    created_at: record.createdAt
  }
}

function createHarness() {
  let cursor = 0
  let rows = [createRecord('u1', 1, 'Remember Redis.')]
  let tapeRows = rows.map(toTapeRow)
  const runtimeStates = new Map([['s1', { providerId: 'openai', modelId: 'gpt-4' }]])
  const handles = new Map<string, MemorySessionHandle>()
  const executionGenerations = new Map<string, number>()
  const isEnabled = vi.fn((_agentId: string) => true)
  const port = {
    isEnabled,
    captureExecutionToken: vi.fn((agentId: string) => ({
      agentId,
      generation: executionGenerations.get(agentId) ?? 0
    })),
    canContinueExecution: vi.fn(
      (token: { agentId: string; generation: number }) =>
        isEnabled(token.agentId) &&
        (executionGenerations.get(token.agentId) ?? 0) === token.generation
    ),
    buildInjection: vi
      .fn<(agentId: string, query: string, options?: { signal?: AbortSignal }) => Promise<any>>()
      .mockResolvedValue(null),
    recordInjectionAccess: vi.fn(),
    extractAndStore: vi.fn().mockResolvedValue({ ok: true, createdIds: [] }),
    observeExtractionQueue: vi.fn()
  }
  const projection = {
    readCurrentRange: vi.fn(() => ({ current: false, maxEntryId: tapeRows.length, rows: [] })),
    replaceSession: vi.fn(),
    invalidateSession: vi.fn()
  }
  const deps = {
    memoryPort: port as any,
    getSessionAgentId: vi.fn(() => 'agent-a'),
    getSessionRuntimeState: vi.fn((sessionId: string) => runtimeStates.get(sessionId)),
    hasSessionRuntimeState: vi.fn((sessionId: string) => runtimeStates.has(sessionId)),
    assertCurrentSessionHandle: vi.fn((handle: MemorySessionHandle) => {
      if (handles.get(handle.sessionId) !== handle) {
        throw new Error(`DeepChat agent instance was replaced: ${handle.sessionId}`)
      }
    }),
    getNextMessageOrderSeq: vi.fn(() => Math.max(0, ...rows.map((row) => row.orderSeq)) + 1),
    getMessagesUpToOrderSeq: vi.fn((_sessionId: string, orderSeq: number) =>
      rows.filter((row) => row.orderSeq <= orderSeq)
    ),
    getMemoryCursorOrderSeq: vi.fn(() => cursor),
    updateMemoryCursorOrderSeq: vi.fn((_sessionId: string, orderSeq: number) => {
      cursor = Math.max(cursor, orderSeq)
    }),
    rewindMemoryCursorOrderSeq: vi.fn((_sessionId: string, orderSeq: number) => {
      cursor = orderSeq
    }),
    getTapeRows: vi.fn(() => tapeRows),
    appendTapeAnchor: vi.fn(),
    getIngestionProjection: vi.fn(() => projection)
  }
  const coordinator = new MemoryRuntimeCoordinator(deps)
  const memorySession = Object.freeze({ sessionId: toAppSessionId('s1') })
  handles.set(memorySession.sessionId, memorySession)

  return {
    coordinator,
    deps,
    handles,
    port,
    projection,
    runtimeStates,
    memorySession,
    advanceExecution(agentId = 'agent-a') {
      executionGenerations.set(agentId, (executionGenerations.get(agentId) ?? 0) + 1)
    },
    get cursor() {
      return cursor
    },
    set cursor(value: number) {
      cursor = value
    },
    setRows(value: ChatMessageRecord[]) {
      rows = value
      tapeRows = rows.map(toTapeRow)
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MemoryRuntimeCoordinator', () => {
  it('contributes through the public port and returns the exact base prompt when unavailable', async () => {
    const { coordinator, deps, handles, memorySession, port } = createHarness()
    const contributor: MemoryPromptContributor = coordinator
    const basePrompt = 'base prompt\nwith exact spacing'
    const input = { session: memorySession, basePrompt, query: 'redis', messageId: 'message-1' }

    coordinator.setPort(undefined)
    await expect(contributor.contribute(input)).resolves.toBe(basePrompt)
    expect(deps.assertCurrentSessionHandle).not.toHaveBeenCalled()

    coordinator.setPort(port as any)
    port.isEnabled.mockReturnValue(false)
    await expect(contributor.contribute(input)).resolves.toBe(basePrompt)
    expect(port.buildInjection).not.toHaveBeenCalled()

    port.isEnabled.mockReturnValue(true)
    port.buildInjection.mockRejectedValueOnce(new Error('memory unavailable'))
    await expect(contributor.contribute(input)).resolves.toBe(basePrompt)

    port.buildInjection.mockClear()
    handles.set(memorySession.sessionId, Object.freeze({ sessionId: memorySession.sessionId }))
    await expect(contributor.contribute(input)).resolves.toBe(basePrompt)
    expect(port.buildInjection).not.toHaveBeenCalled()
  })

  it('rechecks enablement after build and before accounting and anchor writes', async () => {
    const { coordinator, deps, memorySession, port } = createHarness()
    const input = {
      session: memorySession,
      basePrompt: 'base prompt',
      query: 'redis',
      messageId: 'message-1'
    }
    port.buildInjection.mockResolvedValue({
      payload: {
        selfModel: null,
        working: null,
        memories: [{ id: 'selected', kind: 'semantic', content: 'Remember Redis.' }]
      },
      manifest: {
        policyVersion: 1,
        selected: [{ id: 'selected', kind: 'semantic' }],
        dropped: [],
        tokenBudget: 1_200,
        estimatedTokens: 20,
        queryHash: 'query-hash'
      }
    })

    port.isEnabled.mockReset().mockReturnValueOnce(true).mockReturnValueOnce(false)
    await expect(coordinator.contribute(input)).resolves.toBe(input.basePrompt)
    expect(port.recordInjectionAccess).not.toHaveBeenCalled()
    expect(deps.appendTapeAnchor).not.toHaveBeenCalled()

    port.isEnabled
      .mockReset()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
    const promptWithoutAccounting = await coordinator.contribute(input)
    expect(promptWithoutAccounting).toContain('Remember Redis.')
    expect(port.recordInjectionAccess).not.toHaveBeenCalled()
    expect(deps.appendTapeAnchor).not.toHaveBeenCalled()

    port.isEnabled
      .mockReset()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    const promptWithoutAnchor = await coordinator.contribute(input)
    expect(promptWithoutAnchor).toContain('Remember Redis.')
    expect(port.recordInjectionAccess).toHaveBeenCalledWith('agent-a', ['selected'])
    expect(deps.appendTapeAnchor).not.toHaveBeenCalled()
  })

  it('discards an injection admitted before an enabled ABA transition', async () => {
    const { advanceExecution, coordinator, deps, memorySession, port } = createHarness()
    const pendingInjection = deferred<any>()
    port.buildInjection.mockReturnValue(pendingInjection.promise)

    const contribution = coordinator.contribute({
      session: memorySession,
      basePrompt: 'base prompt',
      query: 'redis',
      messageId: 'message-1'
    })
    await tick()
    advanceExecution()
    advanceExecution()
    pendingInjection.resolve({
      payload: {
        selfModel: null,
        working: null,
        memories: [{ id: 'stale', kind: 'semantic', content: 'stale memory' }]
      },
      manifest: {
        policyVersion: 1,
        selected: [{ id: 'stale', kind: 'semantic' }],
        dropped: [],
        tokenBudget: 1_200,
        estimatedTokens: 10
      }
    })

    await expect(contribution).resolves.toBe('base prompt')
    expect(port.isEnabled).toHaveLastReturnedWith(true)
    expect(port.recordInjectionAccess).not.toHaveBeenCalled()
    expect(deps.appendTapeAnchor).not.toHaveBeenCalled()
  })

  it('accounts only final selected IDs and keeps assembled prompt on accounting and anchor failure', async () => {
    const { coordinator, deps, memorySession, port } = createHarness()
    port.buildInjection.mockResolvedValue({
      payload: {
        selfModel: null,
        working: null,
        memories: [
          { id: 'selected', kind: 'semantic', content: 'Remember Redis.' },
          { id: 'dropped', kind: 'semantic', content: `PRIVATE_${'x'.repeat(10_000)}` }
        ],
        tokenBudget: 80
      },
      manifest: {
        policyVersion: 1,
        selected: [],
        dropped: [],
        tokenBudget: 80,
        estimatedTokens: 0,
        queryHash: 'raw-internal-query-hash'
      }
    })
    port.recordInjectionAccess.mockImplementation(() => {
      throw new Error('accounting unavailable')
    })
    deps.appendTapeAnchor.mockImplementation(() => {
      throw new Error('anchor unavailable')
    })

    const prompt = await coordinator.contribute({
      session: memorySession,
      basePrompt: 'base prompt',
      query: 'redis',
      messageId: 'message-1'
    })

    expect(prompt).toContain('base prompt')
    expect(prompt).toContain('Remember Redis.')
    expect(prompt).not.toContain('PRIVATE_')
    expect(prompt).not.toContain('raw-internal-query-hash')
    expect(port.recordInjectionAccess).toHaveBeenCalledWith('agent-a', ['selected'])
    expect(deps.appendTapeAnchor).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        name: 'memory/view_assembled',
        state: expect.objectContaining({
          selected: [expect.objectContaining({ id: 'selected' })],
          dropped: [expect.objectContaining({ id: 'dropped', reason: 'budget' })]
        })
      })
    )
  })

  it('returns the base prompt at the injection deadline and discards late results', async () => {
    vi.useFakeTimers()
    const { coordinator, deps, memorySession, port } = createHarness()
    const lateInjection = deferred<any>()
    port.buildInjection.mockReturnValue(lateInjection.promise)
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const input = {
      session: memorySession,
      basePrompt: 'base prompt',
      query: 'redis',
      messageId: 'message-1'
    }

    const contribution = coordinator.contribute(input)
    let settled = false
    void contribution.finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(MEMORY_INJECTION_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await expect(contribution).resolves.toBe(input.basePrompt)
    expect(port.buildInjection.mock.calls[0][2]?.signal?.aborted).toBe(true)
    expect(port.recordInjectionAccess).not.toHaveBeenCalled()
    expect(deps.appendTapeAnchor).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('memory injection timed out'))

    lateInjection.resolve({
      payload: {
        selfModel: null,
        working: null,
        memories: [{ id: 'late', kind: 'semantic', content: 'late memory' }]
      },
      manifest: {
        policyVersion: 1,
        selected: [{ id: 'late', kind: 'semantic' }],
        dropped: [],
        tokenBudget: 1200,
        estimatedTokens: 10
      }
    })
    await Promise.resolve()
    expect(port.recordInjectionAccess).not.toHaveBeenCalled()
    expect(deps.appendTapeAnchor).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('observes a late injection rejection after the deadline', async () => {
    vi.useFakeTimers()
    const { coordinator, memorySession, port } = createHarness()
    const lateInjection = deferred<any>()
    port.buildInjection.mockReturnValue(lateInjection.promise)

    const contribution = coordinator.contribute({
      session: memorySession,
      basePrompt: 'base prompt',
      query: 'redis'
    })
    await vi.advanceTimersByTimeAsync(MEMORY_INJECTION_TIMEOUT_MS)
    await expect(contribution).resolves.toBe('base prompt')
    lateInjection.reject(new Error('late failure'))
    await Promise.resolve()
  })

  it('logs and anchors settled degradation without adding an empty memory section', async () => {
    const { coordinator, deps, memorySession, port } = createHarness()
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    port.buildInjection.mockResolvedValue({
      payload: { selfModel: null, working: null, memories: [], tokenBudget: 1200 },
      manifest: {
        policyVersion: 1,
        selected: [],
        dropped: [],
        tokenBudget: 1200,
        estimatedTokens: 0,
        degradations: ['storeTimeout']
      }
    })

    await expect(
      coordinator.contribute({
        session: memorySession,
        basePrompt: 'base prompt',
        query: 'redis',
        messageId: 'message-1'
      })
    ).resolves.toBe('base prompt')

    expect(port.recordInjectionAccess).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('causes=storeTimeout'))
    expect(deps.appendTapeAnchor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'memory/view_assembled',
        state: expect.objectContaining({ degradations: ['storeTimeout'] })
      })
    )
    info.mockRestore()
  })

  it('serializes one session while sibling sessions run and reports absolute queue state', async () => {
    const { coordinator, port } = createHarness()
    const first = deferred()
    const events: string[] = []

    coordinator.enqueueSessionExtraction('s1', async () => {
      events.push('s1-first-start')
      await first.promise
      events.push('s1-first-end')
    })
    coordinator.enqueueSessionExtraction('s1', async () => {
      events.push('s1-second')
    })
    coordinator.enqueueSessionExtraction('s2', async () => {
      events.push('s2')
    })

    await tick()
    expect(events).toEqual(['s1-first-start', 's2'])
    expect(port.observeExtractionQueue).toHaveBeenCalledWith(3, expect.any(Number))
    expect(JSON.stringify(port.observeExtractionQueue.mock.calls)).not.toContain('Remember Redis')

    first.resolve()
    await coordinator.waitForSession('s1')
    await coordinator.waitForSession('s2')

    expect(events).toEqual(['s1-first-start', 's2', 's1-first-end', 's1-second'])
    expect(port.observeExtractionQueue).toHaveBeenLastCalledWith(0, null)
  })

  it('drops a queued stale token and allows a fresh admission after re-enable', async () => {
    const { advanceExecution, coordinator } = createHarness()
    const first = deferred()
    const events: string[] = []

    coordinator.enqueueSessionExtraction('s1', async () => {
      events.push('first-start')
      await first.promise
      events.push('first-end')
    })
    coordinator.enqueueSessionExtraction('s1', async () => {
      events.push('stale')
    })
    await tick()

    advanceExecution()
    advanceExecution()
    coordinator.enqueueSessionExtraction('s1', async () => {
      events.push('fresh')
    })
    first.resolve()
    await coordinator.waitForSession('s1')

    expect(events).toEqual(['first-start', 'first-end', 'fresh'])
  })

  it('keeps the original execution token on queued chunk continuations', async () => {
    const { advanceExecution, coordinator, port } = createHarness()
    const blocker = deferred()
    coordinator.enqueueSessionExtraction('s1', async () => blocker.promise)
    await tick()

    const chunks = [1, 2, 3, 4, 5].map((orderSeq) => ({
      text: `User: memory ${orderSeq}`,
      sourceEntryIds: [orderSeq],
      cursorCommitOrderSeq: orderSeq,
      coveredThroughOrderSeq: orderSeq,
      fragments: [{ orderSeq, entryId: orderSeq, fragmentIndex: 0, isFinalFragment: true }]
    }))
    const executionToken = port.captureExecutionToken('agent-a')
    await coordinator.runExtractionChunks(
      's1',
      { chunks, reason: 'fallback' },
      coordinator.ensureSessionEpoch('s1'),
      executionToken
    )
    expect(port.extractAndStore).toHaveBeenCalledTimes(4)

    advanceExecution()
    advanceExecution()
    blocker.resolve()
    await coordinator.waitForSession('s1')

    expect(port.extractAndStore).toHaveBeenCalledTimes(4)
  })

  it('drops queued work when the session Agent identity changes', async () => {
    const { coordinator, deps } = createHarness()
    const blocker = deferred()
    const queued = vi.fn()
    coordinator.enqueueSessionExtraction('s1', async () => blocker.promise)
    coordinator.enqueueSessionExtraction('s1', async () => queued())
    await tick()

    deps.getSessionAgentId.mockReturnValue('agent-b')
    blocker.resolve()
    await coordinator.waitForSession('s1')

    expect(queued).not.toHaveBeenCalled()
  })

  it('binds ordinary and continuation session epochs at queue admission', async () => {
    const { coordinator } = createHarness()
    const first = deferred()
    const observed: Array<string | number> = []

    coordinator.enqueueSessionExtraction('s1', async (epoch) => {
      observed.push('first', epoch)
      await first.promise
    })
    coordinator.enqueueSessionExtraction('s1', async (epoch) => {
      observed.push('next', epoch)
    })
    coordinator.enqueueSessionExtraction(
      's1',
      async (epoch) => {
        observed.push('continuation', epoch)
      },
      0
    )

    await tick()
    expect(observed).toEqual(['first', 0])
    coordinator.bumpSessionEpoch('s1')
    first.resolve()
    await coordinator.waitForSession('s1')

    expect(observed).toEqual(['first', 0])
  })

  it('drains old-Agent persistence before a session Agent reassignment', async () => {
    const { coordinator, deps, port } = createHarness()
    const persistence = deferred<{ ok: true; createdIds: string[] }>()
    const chunk = {
      text: 'User: Remember Redis.',
      sourceEntryIds: [1],
      cursorCommitOrderSeq: 1,
      coveredThroughOrderSeq: 1,
      fragments: [{ orderSeq: 1, entryId: 1, fragmentIndex: 0, isFinalFragment: true }]
    }
    port.extractAndStore.mockImplementationOnce(() => persistence.promise)
    coordinator.enqueueSessionExtraction('s1', async (epoch, executionToken) => {
      await coordinator.runExtractionChunks(
        's1',
        { chunks: [chunk], reason: 'fallback' },
        epoch,
        executionToken
      )
    })
    await vi.waitFor(() => expect(port.extractAndStore).toHaveBeenCalledOnce())

    let drained = false
    const reassignment = coordinator.beginSessionAgentReassignment('s1').then(() => {
      drained = true
    })
    const blockedAdmission = vi.fn()
    coordinator.enqueueSessionExtraction('s1', async () => blockedAdmission())
    await tick()

    expect(drained).toBe(false)
    expect(blockedAdmission).not.toHaveBeenCalled()
    persistence.resolve({ ok: true, createdIds: ['late'] })
    await reassignment

    expect(deps.updateMemoryCursorOrderSeq).not.toHaveBeenCalled()
    expect(deps.appendTapeAnchor).not.toHaveBeenCalled()
    coordinator.finishSessionAgentReassignment('s1')

    const freshAdmission = vi.fn()
    coordinator.enqueueSessionExtraction('s1', async () => freshAdmission())
    await coordinator.waitForSession('s1')
    expect(freshAdmission).toHaveBeenCalledOnce()
  })

  it('clears destroyed-session queue diagnostics immediately', async () => {
    const { coordinator, port } = createHarness()
    const blocked = deferred()
    coordinator.enqueueSessionExtraction('s1', async () => blocked.promise)
    coordinator.enqueueSessionExtraction('s1', async () => undefined)

    coordinator.beginSessionDestroy('s1')

    expect(port.observeExtractionQueue).toHaveBeenLastCalledWith(0, null)
    blocked.resolve()
    await coordinator.waitForSession('s1')
  })

  it('commits cursor and anchors only for ok:true work in the current epoch', async () => {
    const { coordinator, deps, port } = createHarness()
    const chunk = {
      text: 'User: Remember Redis.',
      sourceEntryIds: [1],
      cursorCommitOrderSeq: 1,
      coveredThroughOrderSeq: 1,
      fragments: [{ orderSeq: 1, entryId: 1, fragmentIndex: 0, isFinalFragment: true }]
    }
    const epoch = coordinator.ensureSessionEpoch('s1')
    port.extractAndStore.mockResolvedValueOnce({ ok: false })

    const executionToken = port.captureExecutionToken('agent-a')
    await coordinator.runExtractionChunks(
      's1',
      { chunks: [chunk], reason: 'fallback' },
      epoch,
      executionToken
    )
    expect(deps.updateMemoryCursorOrderSeq).not.toHaveBeenCalled()

    port.extractAndStore.mockResolvedValueOnce({ ok: true, createdIds: ['m1'] })
    await coordinator.runExtractionChunks(
      's1',
      { chunks: [chunk], reason: 'fallback' },
      epoch,
      executionToken
    )
    expect(deps.updateMemoryCursorOrderSeq).toHaveBeenCalledWith('s1', 1)
    expect(deps.appendTapeAnchor).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', name: 'memory/extract' })
    )

    const pending = deferred<{ ok: true; createdIds: string[] }>()
    port.extractAndStore.mockImplementationOnce(() => pending.promise)
    const late = coordinator.runExtractionChunks(
      's1',
      {
        chunks: [{ ...chunk, coveredThroughOrderSeq: 2, cursorCommitOrderSeq: 2 }],
        reason: 'fallback'
      },
      epoch,
      executionToken
    )
    coordinator.resetExtractionCursor('s1')
    pending.resolve({ ok: true, createdIds: ['late'] })
    await late

    expect(deps.rewindMemoryCursorOrderSeq).toHaveBeenCalledWith('s1', 0)
    expect(deps.updateMemoryCursorOrderSeq).toHaveBeenCalledTimes(1)
  })

  it('cools projection failures and clears cooldown on session initialization', () => {
    const { coordinator, deps, projection } = createHarness()
    projection.readCurrentRange.mockImplementation(() => {
      throw new Error('projection unavailable')
    })

    const fallback = coordinator.buildExtractionWindow('s1', 0, 1)
    expect(fallback?.chunks.at(-1)?.cursorCommitOrderSeq).toBeNull()
    expect(coordinator.buildExtractionWindow('s1', 0, 1)).toBeNull()
    expect(projection.readCurrentRange).toHaveBeenCalledTimes(1)

    const epoch = coordinator.ensureSessionEpoch('s1')
    coordinator.invalidateFromOrderSeq('s1', 1)
    expect(coordinator.isSessionEpochCurrent('s1', epoch)).toBe(false)
    expect(coordinator.buildExtractionWindow('s1', 0, 1)).toBeNull()
    expect(projection.readCurrentRange).toHaveBeenCalledTimes(1)

    coordinator.initializeSession('s1')
    expect(coordinator.isSessionEpochCurrent('s1', epoch + 1)).toBe(true)
    expect(coordinator.buildExtractionWindow('s1', 0, 1)).not.toBeNull()
    expect(projection.readCurrentRange).toHaveBeenCalledTimes(2)
    expect(deps.getTapeRows).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a JSON string', JSON.stringify('  Remember Redis.  ')],
    ['non-JSON plain text', '  Remember Redis.  ']
  ])('reads the latest user query from %s content', (_format, content) => {
    const { coordinator, setRows } = createHarness()
    setRows([{ ...createRecord('u1', 1, ''), content }])

    expect(coordinator.getLatestUserQuery('s1')).toBe('Remember Redis.')
  })

  it('dedupes non-null injection access, keeps null access, expires turns and clears on destroy', () => {
    const { coordinator, port } = createHarness()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    try {
      coordinator.recordInjectionAccess('agent-a', 's1', [{ id: 'm1' }], 'message-1')
      coordinator.recordInjectionAccess('agent-a', 's1', [{ id: 'm1' }], 'message-1')
      coordinator.recordInjectionAccess('agent-a', 's1', [{ id: 'm1' }], null)
      coordinator.recordInjectionAccess('agent-a', 's1', [{ id: 'm1' }], null)
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(3)

      now.mockReturnValue(31 * 60 * 1_000)
      coordinator.recordInjectionAccess('agent-a', 's1', [{ id: 'm1' }], 'message-1')
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(4)

      coordinator.beginSessionDestroy('s1')
      coordinator.finishSessionDestroy('s1')
      coordinator.recordInjectionAccess('agent-a', 's1', [{ id: 'm1' }], 'message-1')
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(5)
    } finally {
      now.mockRestore()
    }
  })

  it('bounds prompt access dedupe to 128 non-null turns through the contribution seam', async () => {
    const { coordinator, memorySession, port } = createHarness()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    port.buildInjection.mockResolvedValue({
      payload: {
        selfModel: null,
        working: null,
        memories: [{ id: 'selected', kind: 'semantic', content: 'Remember Redis.' }]
      },
      manifest: {
        policyVersion: 1,
        selected: [{ id: 'selected', kind: 'semantic', score: 1 }],
        dropped: [],
        tokenBudget: 1_200,
        estimatedTokens: 20,
        queryHash: 'query-hash'
      }
    })

    try {
      for (let index = 0; index < 130; index += 1) {
        await coordinator.contribute({
          session: memorySession,
          basePrompt: 'base prompt',
          query: 'redis',
          messageId: `message-${index}`
        })
      }
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(130)

      await coordinator.contribute({
        session: memorySession,
        basePrompt: 'base prompt',
        query: 'redis',
        messageId: 'message-129'
      })
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(130)

      await coordinator.contribute({
        session: memorySession,
        basePrompt: 'base prompt',
        query: 'redis',
        messageId: 'message-0'
      })
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(131)

      await coordinator.contribute({
        session: memorySession,
        basePrompt: 'base prompt',
        query: 'redis',
        messageId: null
      })
      await coordinator.contribute({
        session: memorySession,
        basePrompt: 'base prompt',
        query: 'redis',
        messageId: null
      })
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(133)
      expect(port.recordInjectionAccess).toHaveBeenLastCalledWith('agent-a', ['selected'])

      now.mockReturnValue(31 * 60 * 1_000)
      await coordinator.contribute({
        session: memorySession,
        basePrompt: 'base prompt',
        query: 'redis',
        messageId: 'message-129'
      })
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(134)
    } finally {
      now.mockRestore()
    }
  })

  it('bounds projection failure cooldown to 256 sessions through the fallback seam', () => {
    const { coordinator, deps, projection } = createHarness()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    projection.readCurrentRange.mockImplementation(() => {
      throw new Error('projection unavailable')
    })

    try {
      for (let index = 0; index < 257; index += 1) {
        const fallback = coordinator.buildExtractionWindow(`session-${index}`, 0, 1)
        expect(fallback?.chunks.at(-1)?.cursorCommitOrderSeq).toBeNull()
      }
      expect(projection.readCurrentRange).toHaveBeenCalledTimes(257)
      expect(projection.invalidateSession).toHaveBeenCalledTimes(257)
      expect(deps.getTapeRows).toHaveBeenCalledTimes(257)

      expect(coordinator.buildExtractionWindow('session-256', 0, 1)).toBeNull()
      expect(projection.readCurrentRange).toHaveBeenCalledTimes(257)
      expect(deps.getTapeRows).toHaveBeenCalledTimes(257)

      const evictedOldest = coordinator.buildExtractionWindow('session-0', 0, 1)
      expect(evictedOldest?.chunks.at(-1)?.cursorCommitOrderSeq).toBeNull()
      expect(projection.readCurrentRange).toHaveBeenCalledTimes(258)
      expect(projection.invalidateSession).toHaveBeenCalledTimes(258)
      expect(deps.getTapeRows).toHaveBeenCalledTimes(258)
    } finally {
      now.mockRestore()
    }
  })

  it.each([
    ['initial', { kind: 'returned', status: 'completed' }, true],
    ['initial', { kind: 'returned', status: 'aborted' }, false],
    ['initial', { kind: 'returned', status: 'paused' }, false],
    ['initial', { kind: 'returned', status: 'error' }, false],
    [
      'initial',
      { kind: 'thrown', error: Object.assign(new Error('aborted'), { name: 'AbortError' }) },
      false
    ],
    ['initial', { kind: 'thrown', error: new Error('failed') }, false],
    ['resume', { kind: 'returned', status: 'completed' }, true],
    ['resume', { kind: 'returned', status: 'aborted' }, true],
    ['resume', { kind: 'returned', status: 'paused' }, false],
    ['resume', { kind: 'returned', status: 'error' }, false],
    [
      'resume',
      { kind: 'thrown', error: Object.assign(new Error('aborted'), { name: 'AbortError' }) },
      false
    ],
    ['resume', { kind: 'thrown', error: new Error('failed') }, false]
  ] as const)('preserves MEM-13 for %s %j', async (origin, outcome, expectedExtraction) => {
    const { coordinator, deps, memorySession, port, setRows } = createHarness()
    const observer: MemoryIngestionObserver = coordinator
    setRows(
      Array.from({ length: 6 }, (_, index) =>
        createRecord(`u${index + 1}`, index + 1, `memory ${index + 1}`)
      )
    )

    observer.afterTurnSettled({ session: memorySession, origin, outcome })

    expect(deps.getNextMessageOrderSeq).not.toHaveBeenCalled()
    expect(deps.getMemoryCursorOrderSeq).not.toHaveBeenCalled()
    await coordinator.waitForSession('s1')
    expect(port.extractAndStore).toHaveBeenCalledTimes(expectedExtraction ? 1 : 0)
  })

  it.each(['initial', 'context-pressure'] as const)(
    'captures the MEM-14 upper bound for %s only after normal apply return',
    async (origin) => {
      const { coordinator, deps, memorySession, port, setRows } = createHarness()
      const observer: MemoryIngestionObserver = coordinator
      setRows(
        Array.from({ length: 6 }, (_, index) =>
          createRecord(`u${index + 1}`, index + 1, `memory ${index + 1}`)
        )
      )

      observer.afterCompactionApplyReturned({
        session: memorySession,
        origin,
        targetCursorOrderSeq: 4
      })

      expect(deps.getMemoryCursorOrderSeq).not.toHaveBeenCalled()
      await coordinator.waitForSession('s1')
      expect(port.extractAndStore).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEntryIds: [1, 2, 3, 4] })
      )
      expect(deps.updateMemoryCursorOrderSeq).toHaveBeenCalledWith('s1', 4)
    }
  )

  it('starts consecutive jobs from the latest cursor without repeating source IDs', async () => {
    const { coordinator, memorySession, port, setRows } = createHarness()
    const observer: MemoryIngestionObserver = coordinator
    const first = deferred<{ ok: true; createdIds: string[] }>()
    port.extractAndStore
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ ok: true, createdIds: [] })
    const firstRows = Array.from({ length: 6 }, (_, index) =>
      createRecord(`u${index + 1}`, index + 1, `memory ${index + 1}`)
    )
    setRows(firstRows)

    observer.afterTurnSettled({
      session: memorySession,
      origin: 'initial',
      outcome: { kind: 'returned', status: 'completed' }
    })
    await tick()
    expect(port.extractAndStore).toHaveBeenCalledWith(
      expect.objectContaining({ sourceEntryIds: [1, 2, 3, 4, 5, 6] })
    )

    setRows([
      ...firstRows,
      ...Array.from({ length: 6 }, (_, index) =>
        createRecord(`u${index + 7}`, index + 7, `memory ${index + 7}`)
      )
    ])
    observer.afterTurnSettled({
      session: memorySession,
      origin: 'resume',
      outcome: { kind: 'returned', status: 'completed' }
    })
    first.resolve({ ok: true, createdIds: [] })
    await coordinator.waitForSession('s1')

    expect(port.extractAndStore).toHaveBeenCalledTimes(2)
    expect(port.extractAndStore).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceEntryIds: [7, 8, 9, 10, 11, 12] })
    )
  })

  it('fences new admission and drains queued and running jobs without late commits', async () => {
    const { coordinator, deps, memorySession, port, setRows } = createHarness()
    const observer: MemoryIngestionObserver = coordinator
    const running = deferred<{ ok: true; createdIds: string[] }>()
    port.extractAndStore.mockImplementationOnce(() => running.promise)
    setRows(
      Array.from({ length: 6 }, (_, index) =>
        createRecord(`u${index + 1}`, index + 1, `memory ${index + 1}`)
      )
    )
    const completed = () =>
      observer.afterTurnSettled({
        session: memorySession,
        origin: 'initial',
        outcome: { kind: 'returned', status: 'completed' }
      })

    completed()
    await tick()
    completed()
    let drained = false
    const drain = observer.drainAndFence().then((outcome) => {
      expect(outcome).toEqual({ timedOut: false, pendingSessions: [] })
      drained = true
    })
    completed()
    await tick()

    expect(drained).toBe(false)
    expect(port.extractAndStore).toHaveBeenCalledTimes(1)
    running.resolve({ ok: true, createdIds: ['late'] })
    await drain
    await coordinator.waitForSession('s1')

    expect(deps.updateMemoryCursorOrderSeq).not.toHaveBeenCalled()
    expect(deps.appendTapeAnchor).not.toHaveBeenCalled()
    expect(port.extractAndStore).toHaveBeenCalledTimes(1)
    await expect(observer.drainAndFence()).resolves.toEqual({
      timedOut: false,
      pendingSessions: []
    })
  })

  it('drains empty and failed chains and keeps ingestion fenced', async () => {
    const empty = createHarness()
    const emptyObserver: MemoryIngestionObserver = empty.coordinator

    await expect(emptyObserver.drainAndFence()).resolves.toEqual({
      timedOut: false,
      pendingSessions: []
    })
    emptyObserver.afterTurnSettled({
      session: empty.memorySession,
      origin: 'initial',
      outcome: { kind: 'returned', status: 'completed' }
    })
    await empty.coordinator.waitForSession('s1')
    expect(empty.port.extractAndStore).not.toHaveBeenCalled()

    const failed = createHarness()
    const failedObserver: MemoryIngestionObserver = failed.coordinator
    let rejectExtraction!: (error: unknown) => void
    failed.port.extractAndStore.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectExtraction = reject
        })
    )
    failed.setRows(
      Array.from({ length: 6 }, (_, index) =>
        createRecord(`u${index + 1}`, index + 1, `memory ${index + 1}`)
      )
    )
    failedObserver.afterTurnSettled({
      session: failed.memorySession,
      origin: 'initial',
      outcome: { kind: 'returned', status: 'completed' }
    })
    await tick()
    const drain = failedObserver.drainAndFence()
    rejectExtraction(new Error('failed'))
    await expect(drain).resolves.toEqual({ timedOut: false, pendingSessions: [] })

    expect(failed.port.extractAndStore).toHaveBeenCalledOnce()
  })

  it('finishes a safely fenced drain when provider work ignores cancellation', async () => {
    vi.useFakeTimers()
    try {
      const { coordinator, deps, memorySession, port, setRows } = createHarness()
      const observer: MemoryIngestionObserver = coordinator
      port.extractAndStore.mockImplementationOnce(() => new Promise(() => undefined))
      setRows(
        Array.from({ length: 6 }, (_, index) =>
          createRecord(`u${index + 1}`, index + 1, `memory ${index + 1}`)
        )
      )
      observer.afterTurnSettled({
        session: memorySession,
        origin: 'initial',
        outcome: { kind: 'returned', status: 'completed' }
      })
      await Promise.resolve()
      await Promise.resolve()

      const drain = observer.drainAndFence()
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(drain).resolves.toEqual({ timedOut: true, pendingSessions: ['s1'] })

      expect(port.extractAndStore).toHaveBeenCalledOnce()
      expect(deps.updateMemoryCursorOrderSeq).not.toHaveBeenCalled()
      expect(deps.appendTapeAnchor).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['resolve', 'reject'] as const)(
    'reports and clears a real Memory write chain after late provider %s',
    async (settlement) => {
      vi.useFakeTimers()
      try {
        const { coordinator, deps, memorySession, setRows } = createHarness()
        const provider = deferred<string>()
        const decisionStarted = deferred()
        const repository = createFakeRepository()
        const auditRepository = new FakeAuditRepository()
        const vectorStore = new FakeVectorStore()
        repository.insert({
          id: 'existing',
          agentId: 'agent-a',
          kind: 'semantic',
          content: 'existing memory preference',
          status: 'embedded'
        })
        const getEmbeddings = vi.fn(async (_providerId, _modelId, texts: string[]) =>
          texts.map((text) => textToVector(text))
        )
        const onMemoryChanged = vi.fn()
        const memoryPresenter = new MemoryPresenter({
          repository,
          auditRepository,
          resolveAgentConfig: () => ({
            memoryEnabled: true,
            memoryExtractionModel: { providerId: 'provider', modelId: 'model' }
          }),
          executeWithRateLimit: vi.fn(async () => undefined),
          getEmbeddings,
          getDimensions: async () => ({
            data: { dimensions: textToVector('').length, normalized: false }
          }),
          generateText: async (_providerId, _modelId, prompt) => {
            if (prompt.includes('KEEP or SKIP')) return 'KEEP'
            if (prompt.includes('JSON array')) {
              return '[{"kind":"semantic","content":"late memory preference","importance":0.9}]'
            }
            decisionStarted.resolve()
            return await provider.promise
          },
          createVectorStore: async () => vectorStore,
          resetVectorStore: async () => undefined,
          onMemoryChanged
        })
        const realExtractAndStore = memoryPresenter.extractAndStore.bind(memoryPresenter)
        vi.spyOn(memoryPresenter, 'extractAndStore').mockImplementation(async (input) => {
          // Keep the runtime port pending after the real write coordinator observes disposal. This
          // models an adapter/provider that ignores abort while retaining the real operation fence.
          const result = realExtractAndStore(input)
          await provider.promise
          return await result
        })
        const observeQueue = vi.spyOn(memoryPresenter, 'observeExtractionQueue')
        const insertRow = vi.spyOn(repository, 'insert')
        const updateRow = vi.spyOn(repository, 'updateUserContentAndInvalidateEmbedding')
        const supersedeRow = vi.spyOn(repository, 'markSupersededIfRevision')
        const insertAudit = vi.spyOn(auditRepository, 'insert')
        const upsertVector = vi.spyOn(vectorStore, 'upsert')
        coordinator.setPort(memoryPresenter)
        const observer: MemoryIngestionObserver = coordinator
        setRows(
          Array.from({ length: 6 }, (_, index) =>
            createRecord(`u${index + 1}`, index + 1, `memory ${index + 1}`)
          )
        )

        observer.afterTurnSettled({
          session: memorySession,
          origin: 'initial',
          outcome: { kind: 'returned', status: 'completed' }
        })
        await decisionStarted.promise
        const drain = observer.drainAndFence()
        let disposed = false
        await memoryPresenter.dispose().then(() => {
          disposed = true
        })
        expect(disposed).toBe(true)
        await vi.advanceTimersByTimeAsync(5_000)
        await expect(drain).resolves.toEqual({ timedOut: true, pendingSessions: ['s1'] })

        expect(insertRow).not.toHaveBeenCalled()
        expect(updateRow).not.toHaveBeenCalled()
        expect(supersedeRow).not.toHaveBeenCalled()
        expect(insertAudit).not.toHaveBeenCalled()
        expect(upsertVector).not.toHaveBeenCalled()
        expect(getEmbeddings).not.toHaveBeenCalled()
        expect(onMemoryChanged).not.toHaveBeenCalled()
        expect(repository.countByAgent('agent-a')).toBe(1)
        expect(deps.updateMemoryCursorOrderSeq).not.toHaveBeenCalled()
        expect(deps.appendTapeAnchor).not.toHaveBeenCalled()

        if (settlement === 'resolve') {
          provider.resolve(
            '[{"candidateIndex":0,"decision":"ADD","targetIndex":null,"mergedContent":null}]'
          )
        } else {
          provider.reject(new Error('late provider rejection'))
        }
        await coordinator.waitForSession('s1')

        expect(insertRow).not.toHaveBeenCalled()
        expect(insertAudit).not.toHaveBeenCalled()
        expect(upsertVector).not.toHaveBeenCalled()
        expect(onMemoryChanged).not.toHaveBeenCalled()
        expect(repository.countByAgent('agent-a')).toBe(1)
        expect(deps.updateMemoryCursorOrderSeq).not.toHaveBeenCalled()
        expect(deps.appendTapeAnchor).not.toHaveBeenCalled()
        expect(observeQueue).toHaveBeenLastCalledWith(0, null)
        await expect(observer.drainAndFence()).resolves.toEqual({
          timedOut: false,
          pendingSessions: []
        })
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('keeps stable instance handles and ignores a handle after replacement', () => {
    const { coordinator, handles, port } = createHarness()
    const observer: MemoryIngestionObserver = coordinator
    port.isEnabled.mockReturnValue(false)
    const sessionId = toAppSessionId('s1')
    const handle = Object.freeze({ sessionId })
    handles.set(sessionId, handle)

    expect(() =>
      observer.afterCompactionApplyReturned({
        session: handle,
        origin: 'initial',
        targetCursorOrderSeq: 2
      })
    ).not.toThrow()

    handles.set(sessionId, Object.freeze({ sessionId }))
    expect(() =>
      observer.afterCompactionApplyReturned({
        session: handle,
        origin: 'initial',
        targetCursorOrderSeq: 2
      })
    ).not.toThrow()
  })
})
