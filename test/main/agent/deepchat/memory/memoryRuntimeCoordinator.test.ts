import { describe, expect, it, vi } from 'vitest'

import { MemoryRuntimeCoordinator } from '@/agent/deepchat/memory/memoryRuntimeCoordinator'
import type { DeepChatMemorySessionHandle } from '@/agent/deepchat/instance/deepChatAgentInstance'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
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
  const handles = new Map<string, DeepChatMemorySessionHandle>()
  const port = {
    isEnabled: vi.fn(() => true),
    buildInjection: vi
      .fn<(agentId: string, query: string) => Promise<any>>()
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
    assertCurrentSessionHandle: vi.fn((handle: DeepChatMemorySessionHandle) => {
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

  return {
    coordinator,
    deps,
    handles,
    port,
    projection,
    runtimeStates,
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

describe('MemoryRuntimeCoordinator', () => {
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

  it('resolves epochs when queued tasks start and fences continuations by expected epoch', async () => {
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

    expect(observed).toEqual(['first', 0, 'next', 1])
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

    await coordinator.runExtractionChunks('s1', { chunks: [chunk], reason: 'fallback' }, epoch)
    expect(deps.updateMemoryCursorOrderSeq).not.toHaveBeenCalled()

    port.extractAndStore.mockResolvedValueOnce({ ok: true, createdIds: ['m1'] })
    await coordinator.runExtractionChunks('s1', { chunks: [chunk], reason: 'fallback' }, epoch)
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
      epoch
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
    const { coordinator, port } = createHarness()
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
        await coordinator.appendPrompt('s1', 'base prompt', 'redis', `message-${index}`)
      }
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(130)

      await coordinator.appendPrompt('s1', 'base prompt', 'redis', 'message-129')
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(130)

      await coordinator.appendPrompt('s1', 'base prompt', 'redis', 'message-0')
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(131)

      await coordinator.appendPrompt('s1', 'base prompt', 'redis', null)
      await coordinator.appendPrompt('s1', 'base prompt', 'redis', null)
      expect(port.recordInjectionAccess).toHaveBeenCalledTimes(133)
      expect(port.recordInjectionAccess).toHaveBeenLastCalledWith('agent-a', ['selected'])
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

  it('keeps stable instance handles and rejects a handle after replacement', () => {
    const { coordinator, handles, port } = createHarness()
    port.isEnabled.mockReturnValue(false)
    const sessionId = toAppSessionId('s1')
    const handle = Object.freeze({ sessionId })
    handles.set(sessionId, handle)

    expect(() =>
      coordinator.triggerExtractionFromCompaction(handle, { targetCursorOrderSeq: 2 } as any)
    ).not.toThrow()

    handles.set(sessionId, Object.freeze({ sessionId }))
    expect(() =>
      coordinator.triggerExtractionFromCompaction(handle, { targetCursorOrderSeq: 2 } as any)
    ).toThrow('DeepChat agent instance was replaced: s1')
  })
})
