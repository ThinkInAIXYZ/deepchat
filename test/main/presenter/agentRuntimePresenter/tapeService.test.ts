import { describe, expect, it, vi } from 'vitest'
import { buildContext } from '@/presenter/agentRuntimePresenter/contextBuilder'
import { DeepChatTapeService } from '@/presenter/agentRuntimePresenter/tapeService'
import {
  appendMessageReplacementToTape,
  appendMessageRetractionToTape
} from '@/presenter/agentRuntimePresenter/tapeFacts'
import type { ChatMessageRecord } from '@shared/types/agent-interface'

function createTapeTableMock() {
  const entries: any[] = []
  const table = {
    ensureBootstrapAnchor: vi.fn((sessionId: string) => {
      if (
        entries.some((entry) => entry.session_id === sessionId && entry.name === 'session/start')
      ) {
        return
      }
      table.appendAnchor({
        sessionId,
        name: 'session/start',
        source: { type: 'session', id: sessionId, seq: 0 },
        state: { owner: 'human' },
        idempotent: true
      })
    }),
    append: vi.fn((input: any) => {
      const provenanceKey =
        input.provenanceKey !== undefined
          ? input.provenanceKey
          : input.source
            ? [
                input.source.type,
                input.source.id,
                input.source.seq ?? 0,
                input.kind,
                input.name ?? ''
              ].join(':')
            : null
      const existing = input.idempotent
        ? entries.find(
            (entry) =>
              entry.session_id === input.sessionId && entry.provenance_key === provenanceKey
          )
        : null
      if (existing) {
        return existing
      }
      const row = {
        session_id: input.sessionId,
        entry_id:
          Math.max(
            0,
            ...entries
              .filter((entry) => entry.session_id === input.sessionId)
              .map((entry) => entry.entry_id)
          ) + 1,
        kind: input.kind,
        name: input.name ?? null,
        source_type: input.source?.type ?? null,
        source_id: input.source?.id ?? null,
        source_seq: input.source?.seq ?? null,
        provenance_key: provenanceKey,
        payload_json: JSON.stringify(input.payload ?? {}),
        meta_json: JSON.stringify(input.meta ?? {}),
        created_at: input.createdAt ?? Date.now()
      }
      entries.push(row)
      return row
    }),
    appendAnchor: vi.fn((input: any) =>
      table.append({
        ...input,
        kind: 'anchor',
        payload: { name: input.name, state: input.state }
      })
    ),
    appendEvent: vi.fn((input: any) =>
      table.append({
        ...input,
        kind: 'event',
        payload: { name: input.name, data: input.data }
      })
    ),
    getBySession: vi.fn((sessionId: string) =>
      entries.filter((entry) => entry.session_id === sessionId)
    ),
    getLatestAnchor: vi.fn(
      (sessionId: string) =>
        entries
          .filter((entry) => entry.session_id === sessionId && entry.kind === 'anchor')
          .sort((left, right) => right.entry_id - left.entry_id)[0]
    ),
    getAnchors: vi.fn((sessionId: string, limit: number = 20) =>
      entries
        .filter((entry) => entry.session_id === sessionId && entry.kind === 'anchor')
        .sort((left, right) => right.entry_id - left.entry_id)
        .slice(0, Math.min(Math.max(Math.floor(limit), 1), 100))
        .reverse()
    ),
    getLatestSummaryAnchor: vi.fn(
      (sessionId: string) =>
        entries
          .filter(
            (entry) =>
              entry.session_id === sessionId &&
              entry.kind === 'anchor' &&
              ['compaction/migrated_summary', 'compaction/manual', 'summary/reset'].includes(
                entry.name
              )
          )
          .sort((left, right) => right.entry_id - left.entry_id)[0]
    ),
    getByProvenanceKey: vi.fn((sessionId: string, provenanceKey: string) =>
      entries.find(
        (entry) => entry.session_id === sessionId && entry.provenance_key === provenanceKey
      )
    ),
    countBySession: vi.fn(
      (sessionId: string) => entries.filter((entry) => entry.session_id === sessionId).length
    ),
    countAnchorsBySession: vi.fn(
      (sessionId: string) =>
        entries.filter((entry) => entry.session_id === sessionId && entry.kind === 'anchor').length
    ),
    countEntriesAfter: vi.fn(
      (sessionId: string, entryId: number) =>
        entries.filter((entry) => entry.session_id === sessionId && entry.entry_id > entryId).length
    ),
    search: vi.fn((sessionId: string, query: string, options: any = {}) => {
      const normalizedQuery = query.trim()
      if (!normalizedQuery) {
        return []
      }
      const limit = Number.isFinite(options.limit) ? Math.floor(options.limit) : 20
      return entries
        .filter((entry) => entry.session_id === sessionId)
        .filter(
          (entry) =>
            entry.payload_json.includes(normalizedQuery) ||
            entry.meta_json.includes(normalizedQuery) ||
            entry.name?.includes(normalizedQuery)
        )
        .filter((entry) => !options.kinds?.length || options.kinds.includes(entry.kind))
        .filter(
          (entry) =>
            !Number.isFinite(options.startCreatedAt) || entry.created_at >= options.startCreatedAt
        )
        .filter(
          (entry) =>
            !Number.isFinite(options.endCreatedAt) || entry.created_at <= options.endCreatedAt
        )
        .sort((left, right) => right.entry_id - left.entry_id)
        .slice(0, Math.min(Math.max(limit, 1), 100))
    }),
    deleteBySession: vi.fn((sessionId: string) => {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index].session_id === sessionId) {
          entries.splice(index, 1)
        }
      }
    })
  }
  return { table, entries }
}

function createRecord(overrides: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: 'm1',
    sessionId: 's1',
    orderSeq: 1,
    role: 'user',
    content: JSON.stringify({ text: 'hello', files: [], links: [], search: false, think: false }),
    status: 'sent',
    isContextEdge: 0,
    metadata: '{}',
    traceCount: 0,
    createdAt: 100,
    updatedAt: 100,
    ...overrides
  }
}

describe('DeepChatTapeService', () => {
  it('backfills message and tool facts idempotently before returning tape records', () => {
    const { table, entries } = createTapeTableMock()
    const assistantBlocks = [
      {
        type: 'tool_call',
        status: 'success',
        timestamp: 120,
        tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}', response: 'result' }
      }
    ]
    const records = [
      createRecord({ id: 'u1', orderSeq: 1 }),
      createRecord({
        id: 'a1',
        orderSeq: 2,
        role: 'assistant',
        content: JSON.stringify(assistantBlocks),
        createdAt: 120,
        updatedAt: 120
      })
    ]
    const messageStore = {
      getMessages: vi.fn().mockReturnValue(records)
    }
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const first = service.ensureSessionTapeReady('s1', messageStore as any)
    const second = service.ensureSessionTapeReady('s1', messageStore as any)

    expect(first.historyRecords.map((record) => record.id)).toEqual(['u1', 'a1'])
    expect(second.historyRecords.map((record) => record.id)).toEqual(['u1', 'a1'])
    expect(entries.filter((entry) => entry.kind === 'message')).toHaveLength(2)
    expect(entries.filter((entry) => entry.kind === 'tool_call')).toHaveLength(1)
    expect(entries.filter((entry) => entry.kind === 'tool_result')).toHaveLength(1)
    expect(entries.filter((entry) => entry.name === 'migration/backfill')).toHaveLength(1)
  })

  it('reports info, search, and handoff within one session scope', () => {
    const { table, entries } = createTapeTableMock()
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([
        createRecord({ id: 'u1' }),
        createRecord({
          id: 'a1',
          orderSeq: 2,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: 'answer', status: 'success', timestamp: 101 }
          ]),
          metadata: JSON.stringify({ totalTokens: 9 }),
          createdAt: 101,
          updatedAt: 101
        })
      ])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    service.handoff('s1', 'phase_done', { summary: 'done' })
    const handoffAnchor = entries.find((entry) => entry.name === 'handoff/phase_done')

    expect(service.info('s1')).toMatchObject({
      sessionId: 's1',
      anchors: 2,
      lastAnchor: 'handoff/phase_done',
      lastTokenUsage: 9,
      migrationState: 'ready'
    })
    expect(JSON.parse(handoffAnchor.payload_json).state).toMatchObject({
      summary: 'done',
      cursorOrderSeq: 3,
      range: {
        fromOrderSeq: 1,
        toOrderSeq: 2
      },
      sourceMessageIds: ['u1', 'a1']
    })
    expect(service.search('s1', 'hello')).toHaveLength(1)
    expect(
      service.search('s1', 'hello', { kinds: ['message'], start: '1970-01-01T00:00:00.000Z' })
    ).toHaveLength(1)
    expect(service.search('s1', 'hello', { kinds: ['anchor'] })).toHaveLength(0)
    expect(service.search('s1', 'hello', { end: '99' })).toHaveLength(0)
    expect(() => service.search('s1', 'hello', { start: 'not-a-date' })).toThrow(
      'start must be an ISO date/time or millisecond timestamp.'
    )
    expect(service.anchors('s1')).toMatchObject([
      { sessionId: 's1', name: 'session/start' },
      { sessionId: 's1', name: 'handoff/phase_done' }
    ])
    expect(service.anchors('s1', { limit: 1 })).toMatchObject([
      { sessionId: 's1', name: 'handoff/phase_done' }
    ])
    expect(service.search('s2', 'hello')).toHaveLength(0)
  })

  it('keeps legacy context builder output stable after tape backfill projection', () => {
    const { table } = createTapeTableMock()
    const records = [
      createRecord({ id: 'u1', orderSeq: 1 }),
      createRecord({
        id: 'a1',
        orderSeq: 2,
        role: 'assistant',
        content: JSON.stringify([
          { type: 'content', content: 'Tool finished', status: 'success', timestamp: 120 },
          {
            type: 'tool_call',
            status: 'success',
            timestamp: 121,
            tool_call: {
              id: 'tc1',
              name: 'example_tool',
              params: '{"foo":"bar"}',
              response: 'All good'
            }
          }
        ]),
        createdAt: 120,
        updatedAt: 121
      })
    ]
    const legacyMessageStore = {
      getMessages: vi.fn().mockReturnValue(records)
    }
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const legacyContext = buildContext(
      's1',
      'next',
      'System',
      10000,
      4096,
      legacyMessageStore as any
    )
    const tapeReady = service.ensureSessionTapeReady('s1', legacyMessageStore as any)
    const tapeOnlyStore = {
      getMessages: vi.fn(() => {
        throw new Error('buildContext must use provided tape history records')
      })
    }
    const tapeContext = buildContext(
      's1',
      'next',
      'System',
      10000,
      4096,
      tapeOnlyStore as any,
      false,
      {
        historyRecords: tapeReady.historyRecords
      }
    )

    expect(tapeContext).toEqual(legacyContext)
    expect(tapeOnlyStore.getMessages).not.toHaveBeenCalled()
  })

  it('enriches handoff anchors without requiring a summary field', () => {
    const { table, entries } = createTapeTableMock()
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([
        createRecord({ id: 'u1', orderSeq: 1 }),
        createRecord({
          id: 'a1',
          orderSeq: 2,
          role: 'assistant',
          content: JSON.stringify([
            { type: 'content', content: 'answer', status: 'success', timestamp: 101 }
          ]),
          createdAt: 101,
          updatedAt: 101
        })
      ])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    service.handoff('s1', 'phase_done', {
      reason: 'phase complete',
      nextSteps: ['verify parity']
    })

    const handoffAnchor = entries.find((entry) => entry.name === 'handoff/phase_done')
    const state = JSON.parse(handoffAnchor.payload_json).state
    expect(state).toMatchObject({
      reason: 'phase complete',
      nextSteps: ['verify parity'],
      cursorOrderSeq: 3,
      range: {
        fromOrderSeq: 1,
        toOrderSeq: 2
      },
      sourceMessageIds: ['u1', 'a1']
    })
    expect(state.summary).toBeUndefined()
  })

  it('migrates legacy session summary into a tape anchor during backfill', () => {
    const { table, entries } = createTapeTableMock()
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([
        createRecord({ id: 'u1', orderSeq: 1 }),
        createRecord({
          id: 'a1',
          orderSeq: 2,
          role: 'assistant',
          content: JSON.stringify([{ type: 'content', content: 'answer', status: 'success' }])
        })
      ])
    }
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: {
        getSummaryState: vi.fn().mockReturnValue({
          summary_text: 'legacy compacted state',
          summary_cursor_order_seq: 3,
          summary_updated_at: 200
        })
      }
    } as any)

    service.ensureSessionTapeReady('s1', messageStore as any)

    const summaryAnchor = entries.find((entry) => entry.name === 'compaction/migrated_summary')
    expect(summaryAnchor).toMatchObject({
      kind: 'anchor',
      source_type: 'summary',
      source_id: 'legacy-summary',
      created_at: 200
    })
    expect(JSON.parse(summaryAnchor.payload_json).state).toMatchObject({
      summary: 'legacy compacted state',
      cursorOrderSeq: 3,
      sourceMessageIds: ['u1', 'a1']
    })
  })

  it('keeps pending message records for resume but hides pending tool facts from search', () => {
    const { table } = createTapeTableMock()
    const pendingBlocks = [
      {
        type: 'tool_call',
        status: 'pending',
        timestamp: 100,
        tool_call: {
          id: 'tc1',
          name: 'search',
          params: '{"q":"x"}',
          response: 'pending result'
        }
      }
    ]
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([
        createRecord({
          id: 'a1',
          orderSeq: 1,
          role: 'assistant',
          status: 'pending',
          content: JSON.stringify(pendingBlocks),
          updatedAt: 100
        })
      ])
    }
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.ensureSessionTapeReady('s1', messageStore as any)

    expect(service.getMessageRecords('s1')).toMatchObject([{ id: 'a1', status: 'pending' }])
    expect(service.search('s1', 'pending result', { kinds: ['tool_result'] })).toEqual([])
  })

  it('lets final assistant facts supersede earlier pending tape facts', () => {
    const { table, entries } = createTapeTableMock()
    const pendingBlocks = [
      {
        type: 'tool_call',
        status: 'pending',
        timestamp: 100,
        tool_call: {
          id: 'tc1',
          name: 'search',
          params: '{"q":"x"}',
          response: 'pending result'
        }
      }
    ]
    const finalBlocks = [
      {
        type: 'tool_call',
        status: 'success',
        timestamp: 200,
        tool_call: {
          id: 'tc1',
          name: 'search',
          params: '{"q":"x"}',
          response: 'final result'
        }
      }
    ]
    const messageStore = {
      getMessages: vi
        .fn()
        .mockReturnValueOnce([
          createRecord({
            id: 'a1',
            orderSeq: 1,
            role: 'assistant',
            status: 'pending',
            content: JSON.stringify(pendingBlocks),
            metadata: JSON.stringify({ totalTokens: 1 }),
            updatedAt: 100
          })
        ])
        .mockReturnValue([
          createRecord({
            id: 'a1',
            orderSeq: 1,
            role: 'assistant',
            status: 'sent',
            content: JSON.stringify(finalBlocks),
            metadata: JSON.stringify({ totalTokens: 7 }),
            updatedAt: 200
          })
        ])
    }
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.ensureSessionTapeReady('s1', messageStore as any)
    service.ensureSessionTapeReady('s1', messageStore as any)

    expect(service.getMessageRecords('s1')).toMatchObject([
      {
        id: 'a1',
        status: 'sent'
      }
    ])
    const effectiveRecord = service.getMessageRecords('s1')[0]!
    expect(JSON.parse(effectiveRecord.content)[0].tool_call.response).toBe('final result')
    expect(
      entries.filter((entry) => entry.kind === 'message' && entry.name === 'message/assistant')
    ).toHaveLength(2)
    expect(entries.filter((entry) => entry.kind === 'tool_result')).toHaveLength(2)
    const finalToolResult = entries.filter((entry) => entry.kind === 'tool_result').at(-1)!
    expect(JSON.parse(finalToolResult.payload_json).response).toBe('final result')
    expect(service.info('s1').lastTokenUsage).toBe(7)
    expect(service.search('s1', 'pending result', { kinds: ['tool_result'] })).toEqual([])
    expect(service.search('s1', 'final result', { kinds: ['tool_result'] })).toHaveLength(1)
  })

  it('keeps fork writes isolated until merge and discards fork entries on discard', () => {
    const { table, entries } = createTapeTableMock()
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const fork = service.createFork('s1', 'fork-1')
    service.appendForkMessageRecord(fork, createRecord({ id: 'fu1', sessionId: 'ignored' }))

    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'message/user')
    ).toBe(false)

    const mergedCount = service.mergeFork('s1', 'fork-1')

    expect(mergedCount).toBeGreaterThan(0)
    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'message/user')
    ).toBe(true)
    expect(entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/merge')).toBe(
      true
    )

    const discardFork = service.createFork('s1', 'fork-2')
    service.appendForkMessageRecord(discardFork, createRecord({ id: 'fu2', sessionId: 'ignored' }))
    service.discardFork('s1', 'fork-2')

    expect(entries.some((entry) => entry.session_id === discardFork.forkSessionId)).toBe(false)
    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/discard')
    ).toBe(true)
  })

  it('records external subagent tape fork merge and discard without copying child entries', () => {
    const { table, entries } = createTapeTableMock()
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    service.recordExternalForkMerge('parent', 'child', 'child', {
      runId: 'run-1',
      taskId: 'task-1',
      status: 'completed'
    })
    service.recordExternalForkDiscard('parent', 'child-2', 'child-2', {
      runId: 'run-2',
      taskId: 'task-2',
      status: 'cancelled'
    })

    expect(
      entries.filter((entry) => entry.session_id === 'parent' && entry.name === 'fork/merge')
    ).toHaveLength(1)
    expect(
      entries.filter((entry) => entry.session_id === 'parent' && entry.name === 'fork/discard')
    ).toHaveLength(1)
    expect(
      entries.some((entry) => entry.session_id === 'parent' && entry.name === 'message/user')
    ).toBe(false)
    expect(entries.some((entry) => entry.session_id === 'child')).toBe(true)
  })

  it('uses effective message facts after replacement and retraction events', () => {
    const { table, entries } = createTapeTableMock()
    const original = createRecord({ id: 'u1', orderSeq: 1 })
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([original])
    }
    const service = new DeepChatTapeService({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.ensureSessionTapeReady('s1', messageStore as any)
    appendMessageReplacementToTape(
      table as any,
      createRecord({
        id: 'u1',
        orderSeq: 1,
        content: JSON.stringify({
          text: 'edited',
          files: [],
          links: [],
          search: false,
          think: false
        }),
        updatedAt: 300
      }),
      'test_edit'
    )

    expect(JSON.parse(service.getMessageRecords('s1')[0].content).text).toBe('edited')
    expect(service.search('s1', 'hello', { kinds: ['message'] })).toEqual([])
    expect(service.search('s1', 'edited', { kinds: ['message'] })).toHaveLength(1)
    expect(entries.filter((entry) => entry.kind === 'message')).toHaveLength(2)

    appendMessageRetractionToTape(table as any, service.getMessageRecords('s1')[0], 'test_delete')

    expect(service.getMessageRecords('s1')).toEqual([])
    expect(service.search('s1', 'edited', { kinds: ['message'] })).toEqual([])
  })

  it('appends non-idempotent retractions without generated provenance keys', () => {
    const { table, entries } = createTapeTableMock()
    const record = createRecord({ id: 'u1' })

    appendMessageRetractionToTape(table as any, record, 'first_delete')
    appendMessageRetractionToTape(table as any, record, 'second_delete')

    const retractions = entries.filter((entry) => entry.name === 'message/retracted')
    expect(retractions).toHaveLength(2)
    expect(retractions.map((entry) => entry.provenance_key)).toEqual([null, null])
  })
})
