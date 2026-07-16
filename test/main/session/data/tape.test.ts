import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { buildContext } from '@/agent/deepchat/runtime/contextBuilder'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { SessionTape } from '@/session/data/tape'
import { buildEffectiveTapeView, searchEffectiveTapeRows } from '@/session/data/tapeEffectiveView'
import {
  createTapeViewManifest,
  type TapeViewManifestBuildInput
} from '@/session/data/tapeViewManifest'
import {
  appendMessageRecordToTape,
  appendMessageReplacementToTape,
  appendMessageRetractionToTape,
  appendToolFactsToTape
} from '@/session/data/tapeFacts'
import { buildRequestRefs } from '@/session/data/tapeViewManifest'
import { DeepChatTapeEntriesTable } from '@/session/data/tables/deepchatTapeEntries'
import {
  DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION,
  DeepChatTapeSearchProjectionTable
} from '@/session/data/tables/deepchatTapeSearchProjection'
import { DeepChatMemoryIngestionProjectionTable } from '@/memory/data/tables/deepchatMemoryIngestionProjection'
import { DeepChatMessagesTable } from '@/session/data/tables/deepchatMessages'
import { DeepChatMessageTracesTable } from '@/session/data/tables/deepchatMessageTraces'
import { DeepChatSessionsTable } from '@/session/data/tables/deepchatSessions'
import { NewSessionsTable } from '@/session/data/tables/newSessions'
import type { ChatMessageRecord } from '@shared/types/agent-interface'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const Database = sqliteModule?.default
const DatabaseCtor = Database!
const sqliteSkipReason = 'skipped: better-sqlite3-multiple-ciphers is unavailable'
const requireNativeSqlite = process.env.DEEPCHAT_REQUIRE_NATIVE_SQLITE === '1'

let sqliteAvailable = false
if (Database) {
  try {
    const smokeDb = new Database(':memory:')
    smokeDb.close()
    sqliteAvailable = true
  } catch {
    sqliteAvailable = false
  }
}

const itIfSqlite = sqliteAvailable
  ? it
  : requireNativeSqlite
    ? (name: string, _test: () => unknown, timeout?: number) =>
        it(
          name,
          () => {
            throw new Error(sqliteSkipReason)
          },
          timeout
        )
    : it.skip

function createTapeTableMock() {
  const entries: any[] = []
  let tapeIncarnationSequence = 0
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
        meta: { tapeIncarnationId: `test-tape-${++tapeIncarnationSequence}` },
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
    runInTransaction: vi.fn((operation: () => unknown) => {
      const snapshot = entries.map((entry) => ({ ...entry }))
      try {
        return operation()
      } catch (error) {
        entries.splice(0, entries.length, ...snapshot)
        throw error
      }
    }),
    getBySession: vi.fn((sessionId: string) =>
      entries.filter((entry) => entry.session_id === sessionId)
    ),
    getSubagentLineageEvents: vi.fn((sessionId: string) =>
      entries.filter(
        (entry) =>
          entry.session_id === sessionId &&
          entry.kind === 'event' &&
          (entry.name === 'subagent/tape_linked' || entry.name === 'fork/merge')
      )
    ),
    getFirstEntriesBySessions: vi.fn((sessionIds: string[]) =>
      [...new Set(sessionIds)]
        .flatMap((sessionId) => {
          const first = entries
            .filter((entry) => entry.session_id === sessionId)
            .sort((left, right) => left.entry_id - right.entry_id)[0]
          return first ? [first] : []
        })
        .sort((left, right) => left.session_id.localeCompare(right.session_id))
    ),
    getBySessionUpToEntryId: vi.fn((sessionId: string, maxEntryId: number) =>
      entries.filter((entry) => entry.session_id === sessionId && entry.entry_id <= maxEntryId)
    ),
    getMaxEntryId: vi.fn((sessionId: string) =>
      Math.max(
        0,
        ...entries.filter((entry) => entry.session_id === sessionId).map((entry) => entry.entry_id)
      )
    ),
    getMaxEntryIdsBySessions: vi.fn(
      (sessionIds: string[]) =>
        new Map(
          sessionIds.map((sessionId) => [
            sessionId,
            Math.max(
              0,
              ...entries
                .filter((entry) => entry.session_id === sessionId)
                .map((entry) => entry.entry_id)
            )
          ])
        )
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
    searchEffectiveSourcesAtHeads: vi.fn((sources: any[], query: string, options: any = {}) =>
      sources
        .flatMap((source) =>
          searchEffectiveTapeRows(
            entries.filter(
              (entry) =>
                entry.session_id === source.sessionId && entry.entry_id <= source.maxEntryId
            ),
            query,
            { ...options, limit: 100 }
          )
        )
        .sort(
          (left, right) =>
            right.created_at - left.created_at ||
            left.session_id.localeCompare(right.session_id) ||
            right.entry_id - left.entry_id
        )
        .slice(0, Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 100))
    ),
    getEffectiveContextRowsAtHead: vi.fn(
      (
        source: any,
        entryIds: number[],
        options: { before: number; after: number; limit: number }
      ) => {
        const effectiveRows = buildEffectiveTapeView(
          entries.filter(
            (entry) => entry.session_id === source.sessionId && entry.entry_id <= source.maxEntryId
          ),
          { includePending: false }
        ).rows
        const indexesByEntryId = new Map(
          effectiveRows.map((entry, index) => [entry.entry_id, index])
        )
        const indexes: number[] = []
        for (const entryId of entryIds) {
          const index = indexesByEntryId.get(entryId)
          if (index !== undefined) indexes.push(index)
        }
        for (const entryId of entryIds) {
          const index = indexesByEntryId.get(entryId)
          if (index === undefined) continue
          for (
            let cursor = Math.max(0, index - options.before);
            cursor <= Math.min(effectiveRows.length - 1, index + options.after);
            cursor += 1
          ) {
            if (cursor !== index) indexes.push(cursor)
          }
        }
        return [...new Set(indexes)].slice(0, options.limit).map((index) => effectiveRows[index])
      }
    ),
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

function createTraceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trace-1',
    message_id: 'a1',
    session_id: 's1',
    provider_id: 'openai',
    model_id: 'gpt-4o',
    request_seq: 1,
    endpoint: 'https://api.openai.test/v1/chat/completions',
    headers_json: '{"authorization":"[redacted]"}',
    body_json: '{"messages":[{"role":"user","content":"hello"}]}',
    truncated: 0,
    created_at: 300,
    ...overrides
  }
}

function createMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    session_id: 's1',
    order_seq: 2,
    role: 'assistant',
    content: '[{"type":"content","content":"done","status":"success"}]',
    status: 'sent',
    is_context_edge: 0,
    metadata: '{"totalTokens":10}',
    created_at: 200,
    updated_at: 300,
    ...overrides
  }
}

function createObservationManifest(
  overrides: Partial<Parameters<typeof createTapeViewManifest>[0]> = {}
) {
  return createTapeViewManifest({
    sessionId: 's1',
    messageId: 'a1',
    requestSeq: 1,
    taskType: 'chat',
    policy: 'legacy_context_v1',
    policyVersion: 1,
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    latestEntryId: 0,
    anchorEntryIds: [],
    included: [],
    excluded: [],
    tokenBudget: {
      contextLength: 1000,
      requestedMaxTokens: 100,
      effectiveMaxTokens: 100,
      reserveTokens: 100,
      toolReserveTokens: 0
    },
    providerId: 'openai',
    modelId: 'gpt-4o',
    summaryCursorOrderSeq: 1,
    supportsVision: true,
    supportsAudioInput: false,
    traceDebugEnabled: true,
    assembledAt: 200,
    ...overrides
  })
}

function createTapeService(
  table: unknown,
  traceRows: Array<Record<string, unknown>> = [],
  messageRows: Array<Record<string, unknown>> = []
) {
  return new SessionTape({
    deepchatTapeEntriesTable: table,
    deepchatTapeSearchProjectionTable: {
      deleteBySession: vi.fn(),
      getByEntryIds: vi.fn().mockReturnValue([])
    },
    deepchatMessageTracesTable: {
      listByMessageId: vi.fn((messageId: string) =>
        traceRows.filter((row) => row.message_id === messageId)
      )
    },
    deepchatMessagesTable: {
      get: vi.fn((messageId: string) => messageRows.find((row) => row.id === messageId))
    },
    deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
  } as any)
}

function createLinkedTapeService(
  table: unknown,
  sessions: Array<{
    id: string
    session_kind: 'regular' | 'subagent'
    parent_session_id: string | null
  }>,
  projectionTable?: unknown
) {
  const sessionById = new Map(sessions.map((session) => [session.id, session]))
  return {
    service: new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      newSessionsTable: {
        get: vi.fn((sessionId: string) => sessionById.get(sessionId)),
        getMany: vi.fn((sessionIds: string[]) =>
          sessionIds.flatMap((sessionId) => {
            const session = sessionById.get(sessionId)
            return session ? [session] : []
          })
        )
      },
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any),
    sessionById
  }
}

function createSubagentLinkInput(parentSessionId: string, childSessionId: string) {
  return {
    parentSessionId,
    childSessionId,
    runId: `run-${childSessionId}`,
    taskId: `task-${childSessionId}`,
    slotId: 'reviewer',
    taskTitle: `Review ${childSessionId}`,
    outcome: 'completed' as const,
    resultSummary: 'Done'
  }
}

function appendObservationIsolationFacts(table: unknown) {
  const original = createRecord({ id: 'u1', orderSeq: 1, createdAt: 100, updatedAt: 100 })
  const edited = createRecord({
    id: 'u1',
    orderSeq: 1,
    content: JSON.stringify({
      text: 'edited',
      files: [],
      links: [],
      search: false,
      think: false
    }),
    createdAt: 100,
    updatedAt: 150
  })
  const retracted = createRecord({ id: 'u2', orderSeq: 2, createdAt: 160, updatedAt: 160 })
  const pending = createRecord({
    id: 'a1',
    orderSeq: 3,
    role: 'assistant',
    status: 'pending',
    content: JSON.stringify([
      {
        type: 'tool_call',
        status: 'pending',
        timestamp: 200,
        tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}' }
      }
    ]),
    createdAt: 200,
    updatedAt: 200
  })
  const final = createRecord({
    id: 'a1',
    orderSeq: 3,
    role: 'assistant',
    status: 'sent',
    content: JSON.stringify([
      {
        type: 'tool_call',
        status: 'success',
        timestamp: 300,
        tool_call: {
          id: 'tc1',
          name: 'search',
          params: '{"q":"x"}',
          response: 'tape-result-secret'
        }
      }
    ]),
    metadata: '{"totalTokens":12}',
    createdAt: 200,
    updatedAt: 300
  })

  appendMessageRecordToTape(table as any, original, 'live')
  appendMessageReplacementToTape(table as any, edited, 'test_edit')
  appendMessageRecordToTape(table as any, retracted, 'live')
  appendMessageRetractionToTape(table as any, retracted, 'test_delete')
  appendMessageRecordToTape(table as any, pending, 'live')
  appendMessageRecordToTape(table as any, final, 'live')

  return { edited, final }
}

function stripObservationPayloadOptIns<T>(value: T): T {
  const copy = structuredClone(value) as any
  const stripEntryPayloads = (entries: any[] | undefined) => {
    for (const entry of entries ?? []) {
      delete entry.payload
      delete entry.meta
    }
  }

  if (copy.request?.state === 'manifest_bound') {
    stripEntryPayloads(copy.request.replay.entries)
    delete copy.request.replay.hashes.sliceHash
    if (copy.request.replay.trace) {
      delete copy.request.replay.trace.headersJson
      delete copy.request.replay.trace.bodyJson
    }
  } else if (copy.request?.trace) {
    delete copy.request.trace.headersJson
    delete copy.request.trace.bodyJson
  }
  stripEntryPayloads(copy.output?.entries)
  return copy
}

function createSpies(names: string[]) {
  return Object.fromEntries(names.map((name) => [name, vi.fn()])) as Record<
    string,
    ReturnType<typeof vi.fn>
  >
}

function trackMemoryPropertyAccess<T extends object>(target: T) {
  const memoryPropertyAccess = vi.fn()
  return {
    memoryPropertyAccess,
    presenter: new Proxy(target, {
      get(value, property, receiver) {
        if (typeof property === 'string' && /memory/i.test(property)) {
          memoryPropertyAccess(property)
        }
        return Reflect.get(value, property, receiver)
      }
    })
  }
}

function readObservationMatrix(service: SessionTape) {
  return {
    defaultObservation: service.readCausalObservationSlice('s1', 'a1'),
    repeatedObservation: service.readCausalObservationSlice('s1', 'a1'),
    explicitObservation: service.readCausalObservationSlice('s1', 'a1', { requestSeq: 1 }),
    optInObservation: service.readCausalObservationSlice('s1', 'a1', {
      includeTapePayloads: true,
      includeTracePayload: true
    }),
    traceOnlyObservation: service.readCausalObservationSlice('s1', 'a-trace')
  }
}

describe('SessionTape', () => {
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
    const service = new SessionTape({
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

  it('appends live tool facts through the stable recorder port idempotently', async () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const input = {
      sessionId: toAppSessionId('s1'),
      messageId: 'a1',
      orderSeq: 2,
      blockIndex: 0,
      block: {
        type: 'tool_call' as const,
        status: 'success' as const,
        timestamp: 120,
        tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}', response: 'result' }
      },
      provenance: { source: 'tool_call' as const, sourceId: 'a1:tc1', sequence: 0 }
    }

    const first = await service.appendToolFact(input)
    const second = await service.appendToolFact(input)

    expect(second).toEqual(first)
    expect(entries.filter((entry) => entry.kind === 'tool_call')).toHaveLength(1)
    expect(JSON.parse(entries.find((entry) => entry.kind === 'tool_call').meta_json)).toEqual({
      source: 'live',
      role: 'assistant',
      status: 'success',
      reason: 'tool_loop'
    })
  })

  it('reports info, search, and handoff within one session scope', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
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
    service.handoff('s1', 'phase_done', { summary: '  done  ' })
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

  it('projects fallback tape search into compact results and bounded context', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'Run the dev server', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    table.append({
      sessionId: 's1',
      kind: 'tool_result',
      name: 'shell',
      source: { type: 'tool_result', id: 'm1:tc1', seq: 0 },
      payload: {
        messageId: 'm1',
        orderSeq: 2,
        toolCallId: 'tc1',
        command: 'pnpm run dev',
        exitStatus: 1,
        response: 'Command failed with EADDRINUSE in /tmp/deepchat.log'
      },
      meta: { source: 'live', status: 'error' },
      createdAt: 110
    })

    const hits = service.search('s1', 'pnpm run dev', { limit: 5 })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      kind: 'tool_result',
      summary: expect.stringContaining('EADDRINUSE'),
      refs: {
        toolCallId: 'tc1',
        commands: expect.arrayContaining(['pnpm run dev']),
        filePaths: expect.arrayContaining(['/tmp/deepchat.log']),
        errorCodes: expect.arrayContaining(['EADDRINUSE']),
        exitStatus: 1
      }
    })
    expect(hits[0]).not.toHaveProperty('payload')
    expect(hits[0]).not.toHaveProperty('meta')

    const context = service.getContext('s1', [hits[0].entryId], {
      before: 0,
      after: 0,
      maxBytesPerEntry: 12,
      maxTotalBytes: 12
    })
    expect(context.matchedEntryIds).toEqual([hits[0].entryId])
    expect(context.entries[0]).toMatchObject({
      entryId: hits[0].entryId,
      evidence: { truncated: true }
    })
    expect(context.entries[0].evidence.bytes).toBeLessThanOrEqual(12)
    expect(context.entries[0]).not.toHaveProperty('payload')
    expect(context.entries[0]).not.toHaveProperty('meta')

    const exhaustedContext = service.getContext('s1', [hits[0].entryId], {
      before: 0,
      after: 0,
      maxTotalBytes: 0
    })
    expect(exhaustedContext.entries).toEqual([])
    expect(exhaustedContext.matchedEntryIds).toEqual([])
  })

  it('projects user message attachment metadata into search text and refs', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      isCurrent: vi.fn().mockReturnValue(false),
      getSessionMeta: vi.fn().mockReturnValue(null),
      getProjectedEntryIds: vi.fn().mockReturnValue([]),
      appendSession: vi.fn(),
      replaceSession: vi.fn(),
      search: vi.fn().mockReturnValue([])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm-file', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm-file',
          content: JSON.stringify({
            text: 'Please review the attachment',
            files: [
              {
                name: 'a.md',
                path: '/tmp/a.md',
                content: 'raw attachment body should not be projected',
                metadata: { fileName: 'workspace-a.md' }
              }
            ],
            links: []
          }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })

    service.search('s1', '/tmp/a.md', { limit: 5 })

    expect(projectionTable.replaceSession).toHaveBeenCalledTimes(1)
    const projectedRows = projectionTable.replaceSession.mock.calls[0][1]
    expect(projectedRows[0]).toMatchObject({
      entryId: 1,
      refs: {
        filePaths: expect.arrayContaining(['/tmp/a.md']),
        fileNames: expect.arrayContaining(['a.md', 'workspace-a.md'])
      }
    })
    expect(projectedRows[0].searchText).toContain('/tmp/a.md')
    expect(projectedRows[0].searchText).toContain('a.md')
    expect(projectedRows[0].searchText).toContain('workspace-a.md')
    expect(projectedRows[0].searchText).not.toContain('raw attachment body should not be projected')
  })

  it('preserves relative file paths in projected refs', () => {
    const { table } = createTapeTableMock()
    let projectedRows: any[] = []
    const projectionTable = {
      isCurrent: vi.fn().mockReturnValue(false),
      getSessionMeta: vi.fn().mockReturnValue(null),
      getProjectedEntryIds: vi.fn().mockReturnValue([]),
      appendSession: vi.fn(),
      replaceSession: vi.fn((_sessionId: string, rows: any[]) => {
        projectedRows = rows
      }),
      search: vi.fn().mockReturnValue([])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm-relative', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm-relative',
          content: JSON.stringify({
            text: 'Touched src/main/index.ts, ./lib/util.ts, ../shared/types.ts, test/main/foo/bar.ts, /usr/local/bin/deploy, and https://example.com/not-a-file',
            files: [],
            links: []
          }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })

    service.search('s1', 'src/main/index.ts', { limit: 5 })

    expect(projectionTable.replaceSession).toHaveBeenCalledTimes(1)
    const filePaths = projectedRows[0].refs.filePaths
    expect(filePaths).toEqual(
      expect.arrayContaining([
        'src/main/index.ts',
        './lib/util.ts',
        '../shared/types.ts',
        'test/main/foo/bar.ts',
        '/usr/local/bin/deploy'
      ])
    )
    expect(filePaths).not.toContain('/main/index.ts')
    expect(filePaths).not.toContain('/lib/util.ts')
    expect(filePaths).not.toContain('/main/foo/bar.ts')
    expect(filePaths).not.toContain('example.com/not-a-file')
  })

  it('rebuilds old tape projection versions before attachment path search', () => {
    const { table } = createTapeTableMock()
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm-file', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm-file',
          content: JSON.stringify({
            text: 'Please review the migrated attachment',
            files: [
              {
                name: 'legacy.md',
                path: '/tmp/legacy.md',
                content: 'raw migrated body must stay out of projection',
                metadata: { fileName: 'legacy-workspace.md' }
              }
            ],
            links: []
          }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    let storedVersion = 1
    let storedMaxEntryId = 1
    let projectedRows: any[] = [
      {
        sessionId: 's1',
        entryId: 1,
        kind: 'message',
        name: 'message/user',
        sourceType: 'message',
        sourceId: 'm-file',
        sourceSeq: 0,
        searchText: 'message/user Please review the migrated attachment',
        summaryText: 'user: Please review the migrated attachment',
        refs: { messageId: 'm-file' },
        createdAt: 100
      }
    ]
    const projectionTable = {
      isCurrent: vi.fn((_sessionId: string, maxEntryId: number) => {
        return (
          storedVersion === DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION &&
          storedMaxEntryId === maxEntryId
        )
      }),
      getSessionMeta: vi.fn(() => ({
        projectionVersion: storedVersion,
        maxEntryId: storedMaxEntryId
      })),
      getProjectedEntryIds: vi.fn().mockReturnValue([1]),
      appendSession: vi.fn(),
      replaceSession: vi.fn((_sessionId: string, rows: any[], maxEntryId: number) => {
        projectedRows = rows
        storedVersion = DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION
        storedMaxEntryId = maxEntryId
      }),
      search: vi.fn((_sessionId: string, query: string) => {
        return projectedRows
          .filter((row) => row.searchText.includes(query))
          .map((row) => ({
            session_id: row.sessionId,
            entry_id: row.entryId,
            kind: row.kind,
            name: row.name,
            source_type: row.sourceType,
            source_id: row.sourceId,
            source_seq: row.sourceSeq,
            search_text: row.searchText,
            summary_text: row.summaryText,
            refs_json: JSON.stringify(row.refs),
            created_at: row.createdAt,
            score: 1
          }))
      })
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const hits = service.search('s1', '/tmp/legacy.md', { limit: 5 })

    expect(projectionTable.replaceSession).toHaveBeenCalledTimes(1)
    expect(projectionTable.appendSession).not.toHaveBeenCalled()
    expect(hits).toHaveLength(1)
    expect(hits[0].refs).toMatchObject({
      filePaths: expect.arrayContaining(['/tmp/legacy.md']),
      fileNames: expect.arrayContaining(['legacy.md', 'legacy-workspace.md'])
    })
    expect(projectedRows[0].searchText).not.toContain(
      'raw migrated body must stay out of projection'
    )
  })

  it('prioritizes requested tape context entries before window entries under byte caps', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'before-1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'before-1',
          content: JSON.stringify({
            text: 'before entry consumes the tiny byte budget first',
            files: [],
            links: []
          }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'before-2', seq: 0 },
      payload: {
        record: createRecord({
          id: 'before-2',
          content: JSON.stringify({
            text: 'second before entry also appears earlier',
            files: [],
            links: []
          }),
          createdAt: 110,
          updatedAt: 110
        })
      },
      meta: { source: 'live', orderSeq: 2, role: 'user' },
      createdAt: 110
    })
    const target = table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'target', seq: 0 },
      payload: {
        record: createRecord({
          id: 'target',
          content: JSON.stringify({
            text: 'target-ok consumes the available budget',
            files: [],
            links: []
          }),
          createdAt: 120,
          updatedAt: 120
        })
      },
      meta: { source: 'live', orderSeq: 3, role: 'user' },
      createdAt: 120
    })

    const context = service.getContext('s1', [target.entry_id], {
      before: 2,
      after: 0,
      limit: 3,
      maxBytesPerEntry: 18,
      maxTotalBytes: 18
    })

    expect(context.matchedEntryIds).toEqual([target.entry_id])
    expect(context.entries.map((entry) => entry.entryId)).toEqual([target.entry_id])
    expect(context.entries[0].evidence.text).toContain('target-ok')
  })

  it('binds tape projection LIKE fallback params for single and multi-term queries', () => {
    const all = vi.fn().mockReturnValue([])
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: (...params: unknown[]) => all(sql, params),
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn()
      }))
    }
    const projectionTable = new DeepChatTapeSearchProjectionTable(db as any)
    ;(projectionTable as any).recoverSessionFts = vi.fn()

    projectionTable.search('s1', 'Redis', { limit: 5 })
    expect(all).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM deepchat_tape_search_projection'),
      ['s1', '%Redis%', '%Redis%', '%Redis%', 5]
    )

    projectionTable.search('s1', 'Redis TTL', { limit: 5 })
    expect(all).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM deepchat_tape_search_projection'),
      [
        's1',
        '%Redis TTL%',
        '%Redis TTL%',
        '%Redis TTL%',
        '%Redis%',
        '%Redis%',
        '%Redis%',
        '%TTL%',
        '%TTL%',
        '%TTL%',
        5
      ]
    )

    const oversizedQuery = Array.from({ length: 257 }, (_, index) => `term-${index}`).join(' ')
    projectionTable.search('s1', oversizedQuery, { limit: 5 })
    expect(all).toHaveBeenLastCalledWith(
      expect.stringContaining('FROM deepchat_tape_search_projection'),
      ['s1', `%${oversizedQuery}%`, `%${oversizedQuery}%`, `%${oversizedQuery}%`, 5]
    )
  })

  it('uses current tape projection without loading full session rows', () => {
    const { table } = createTapeTableMock()
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'Redis compact marker', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    table.getBySession.mockClear()
    const projectionTable = {
      isCurrent: vi.fn().mockReturnValue(true),
      getSessionMeta: vi.fn(),
      getProjectedEntryIds: vi.fn(),
      appendSession: vi.fn(),
      replaceSession: vi.fn(),
      search: vi.fn().mockReturnValue([
        {
          session_id: 's1',
          entry_id: 1,
          kind: 'message',
          name: 'message/user',
          source_type: 'message',
          source_id: 'm1',
          source_seq: 0,
          search_text: 'Redis compact marker',
          summary_text: 'Redis compact marker',
          refs_json: '{"messageId":"m1"}',
          created_at: 100,
          score: -2
        }
      ])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const hits = service.search('s1', 'Redis compact', { limit: 5 })

    expect(table.getMaxEntryId).toHaveBeenCalledWith('s1')
    expect(table.getBySession).not.toHaveBeenCalled()
    expect(projectionTable.search).toHaveBeenCalledWith(
      's1',
      'Redis compact',
      expect.objectContaining({ limit: 5 })
    )
    expect(projectionTable.appendSession).not.toHaveBeenCalled()
    expect(projectionTable.replaceSession).not.toHaveBeenCalled()
    expect(hits[0]).toMatchObject({
      entryId: 1,
      kind: 'message',
      summary: 'Redis compact marker',
      refs: { messageId: 'm1' },
      score: -2
    })
    expect(hits[0]).not.toHaveProperty('payload')
    expect(hits[0]).not.toHaveProperty('meta')
  })

  it('falls back to effective tape search when projection search throws', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      isCurrent: vi.fn().mockReturnValue(true),
      search: vi.fn(() => {
        throw new Error('projection failed')
      })
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'Redis fallback marker', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })

    const hits = service.search('s1', 'Redis fallback', { limit: 5 })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      kind: 'message',
      summary: expect.stringContaining('Redis fallback')
    })
    expect(hits[0]).not.toHaveProperty('payload')
    expect(hits[0]).not.toHaveProperty('meta')
  })

  it('appends tape projection rows when the previous projection is an effective prefix', () => {
    const { table } = createTapeTableMock()
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'first redis', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm2', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm2',
          content: JSON.stringify({ text: 'second vue', files: [], links: [] }),
          createdAt: 110,
          updatedAt: 110
        })
      },
      meta: { source: 'live', orderSeq: 2, role: 'user' },
      createdAt: 110
    })
    const projectionTable = {
      isCurrent: vi.fn((_sessionId: string, maxEntryId: number) => maxEntryId === 1),
      getSessionMeta: vi.fn().mockReturnValue({ projectionVersion: 1, maxEntryId: 1 }),
      getProjectedEntryIds: vi.fn().mockReturnValue([1]),
      appendSession: vi.fn(),
      replaceSession: vi.fn(),
      search: vi.fn().mockReturnValue([])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.search('s1', 'vue', { limit: 5 })

    expect(projectionTable.appendSession).toHaveBeenCalledTimes(1)
    expect(projectionTable.appendSession.mock.calls[0][1].map((row: any) => row.entryId)).toEqual([
      2
    ])
    expect(projectionTable.replaceSession).not.toHaveBeenCalled()
  })

  it('rebuilds tape projection when projected entry ids are not an effective prefix', () => {
    const { table } = createTapeTableMock()
    table.append({
      sessionId: 's1',
      kind: 'message',
      name: 'message/user',
      source: { type: 'message', id: 'm1', seq: 0 },
      payload: {
        record: createRecord({
          id: 'm1',
          content: JSON.stringify({ text: 'redis', files: [], links: [] }),
          createdAt: 100,
          updatedAt: 100
        })
      },
      meta: { source: 'live', orderSeq: 1, role: 'user' },
      createdAt: 100
    })
    const projectionTable = {
      isCurrent: vi.fn((_sessionId: string, maxEntryId: number) => maxEntryId === 0),
      getSessionMeta: vi.fn().mockReturnValue({ projectionVersion: 1, maxEntryId: 0 }),
      getProjectedEntryIds: vi.fn().mockReturnValue([99]),
      appendSession: vi.fn(),
      replaceSession: vi.fn(),
      search: vi.fn().mockReturnValue([])
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    service.search('s1', 'redis', { limit: 5 })

    expect(projectionTable.replaceSession).toHaveBeenCalledTimes(1)
    expect(projectionTable.appendSession).not.toHaveBeenCalled()
  })

  it('does not run LIKE fallback when FTS fills the tape projection search limit', () => {
    const all = vi.fn((sql: string, _params: unknown[]) =>
      sql.includes('deepchat_tape_search_fts')
        ? [
            {
              session_id: 's1',
              entry_id: 1,
              kind: 'message',
              name: 'message/user',
              source_type: 'message',
              source_id: 'm1',
              source_seq: 0,
              search_text: 'Redis TTL',
              summary_text: 'Redis TTL',
              refs_json: '{}',
              created_at: 100,
              score: -1
            }
          ]
        : []
    )
    const db = {
      exec: vi.fn(() => {
        throw new Error('unexpected FTS ensure')
      }),
      prepare: vi.fn((sql: string) => ({
        all: (...params: unknown[]) => all(sql, params),
        get: (..._params: unknown[]) => {
          if (
            sql.includes('deepchat_tape_search_projection_meta') ||
            sql.includes('deepchat_tape_search_fts_meta')
          ) {
            return { projection_version: 1, max_entry_id: 1 }
          }
          return undefined
        },
        run: vi.fn()
      })),
      transaction: vi.fn((callback: () => void) => callback)
    }
    const projectionTable = new DeepChatTapeSearchProjectionTable(db as any)
    ;(projectionTable as any).ftsReady = true

    const hits = projectionTable.search('s1', 'Redis', { limit: 1 })

    expect(hits).toHaveLength(1)
    expect(db.exec).not.toHaveBeenCalled()
    const ftsCall = all.mock.calls.find(([sql]) => String(sql).includes('deepchat_tape_search_fts'))
    expect(String(ftsCall?.[0])).toContain('deepchat_tape_search_fts.session_id = ?')
    expect((ftsCall?.[1] as unknown[]).filter((param) => param === 's1')).toHaveLength(2)
    expect(
      vi.mocked(db.prepare).mock.calls.some(([sql]) => String(sql).includes('NULL AS score'))
    ).toBe(false)
  })

  it('queries memory view manifests by agent without expanding session ids', () => {
    const all = vi.fn().mockReturnValue([])
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: (...params: unknown[]) => all(sql, params)
      }))
    }
    const table = new DeepChatTapeEntriesTable(db as any)

    table.listMemoryViewManifestAnchorsByAgent('agent-a', {
      sessionId: 's-1',
      messageId: 'msg-1',
      limit: 7
    })

    expect(all).toHaveBeenCalledWith(
      expect.stringContaining('INNER JOIN new_sessions AS sessions'),
      ['agent-a', 's-1', 'msg-1', 7]
    )
    const sql = String(all.mock.calls[0][0])
    expect(sql).not.toContain(' IN (')
    expect(sql).toContain('sessions.agent_id = ?')
    expect(sql).toContain('tape.session_id = ?')
    expect(sql).toContain("json_extract(tape.meta_json, '$.messageId') = ?")
  })

  it('keeps linked raw search candidate-bounded instead of materializing complete Tapes', () => {
    const all = vi.fn().mockReturnValue([])
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: (...params: unknown[]) => all(sql, params)
      }))
    }
    const table = new DeepChatTapeEntriesTable(db as any)

    table.searchEffectiveSourcesAtHeads(
      [
        { sessionId: 'child-b', maxEntryId: 20 },
        { sessionId: 'child-a', maxEntryId: 10 }
      ],
      'needle',
      { limit: 5 }
    )

    const sql = String(all.mock.calls[0][0])
    const params = all.mock.calls[0][1]
    expect(sql).toContain('FROM deepchat_tape_entries AS candidate')
    expect(sql).toContain('candidate.entry_id <= source.max_entry_id')
    expect(sql).toContain('FROM deepchat_tape_entries AS later_message')
    expect(sql).toContain(
      "typeof(json_extract(later_message.payload_json, '$.record.content')) = 'text'"
    )
    expect(sql).not.toContain('bounded_rows AS')
    expect(params[0]).toBe(
      JSON.stringify([
        { sessionId: 'child-a', maxEntryId: 10 },
        { sessionId: 'child-b', maxEntryId: 20 }
      ])
    )
    expect(params.at(-1)).toBe(5)
  })

  it('reads exact linked projections without invoking FTS recovery or writes', () => {
    const run = vi.fn()
    const exec = vi.fn()
    const reads: Array<{ sql: string; params: unknown[] }> = []
    const prepare = vi.fn((sql: string) => ({
      all: (...params: unknown[]) => {
        reads.push({ sql, params })
        if (sql.includes('deepchat_tape_search_projection_meta AS meta')) {
          return [{ session_id: 'child', max_entry_id: 2 }]
        }
        if (sql.includes('SELECT projection.*, NULL AS score')) {
          return [
            {
              session_id: 'child',
              entry_id: 2,
              kind: 'event',
              name: 'child/result',
              source_type: null,
              source_id: null,
              source_seq: null,
              search_text: 'projection needle',
              summary_text: 'projection needle',
              refs_json: '{}',
              created_at: 100,
              score: null
            }
          ]
        }
        return []
      },
      run
    }))
    const projectionTable = new DeepChatTapeSearchProjectionTable({ prepare, exec } as any)

    const result = projectionTable.searchSourcesReadOnly(
      [{ sessionId: 'child', maxEntryId: 2 }],
      'projection needle',
      { limit: 5 }
    )

    expect(result).toMatchObject({
      coveredSources: [{ sessionId: 'child', maxEntryId: 2 }],
      rows: [{ session_id: 'child', entry_id: 2 }]
    })
    expect(exec).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(prepare.mock.calls.map(([sql]) => String(sql)).join('\n')).not.toContain(
      'deepchat_tape_search_fts_meta'
    )
    expect(
      reads.find((read) => read.sql.includes('SELECT projection.*, NULL AS score'))?.params.at(-1)
    ).toBe(5)
  })

  it('returns no ranked rows when linked projection coverage is only partial', () => {
    const reads: string[] = []
    const prepare = vi.fn((sql: string) => ({
      all: () => {
        reads.push(sql)
        if (sql.includes('deepchat_tape_search_projection_meta AS meta')) {
          return [{ session_id: 'child-a', max_entry_id: 2 }]
        }
        return []
      }
    }))
    const projectionTable = new DeepChatTapeSearchProjectionTable({
      prepare,
      exec: vi.fn()
    } as any)

    const result = projectionTable.searchSourcesReadOnly(
      [
        { sessionId: 'child-a', maxEntryId: 2 },
        { sessionId: 'child-b', maxEntryId: 3 }
      ],
      'projection needle',
      { limit: 5 }
    )

    expect(result).toEqual({
      coveredSources: [{ sessionId: 'child-a', maxEntryId: 2 }],
      rows: []
    })
    expect(
      reads.some((sql) => sql.includes('FROM deepchat_tape_search_projection AS projection'))
    ).toBe(false)
    expect(reads.some((sql) => sql.includes('FROM deepchat_tape_search_fts'))).toBe(false)
  })

  it('uses one LIKE ranking when linked FTS freshness is only partial', () => {
    const reads: Array<{ sql: string; params: unknown[] }> = []
    const prepare = vi.fn((sql: string) => ({
      all: (...params: unknown[]) => {
        reads.push({ sql, params })
        if (sql.includes('deepchat_tape_search_projection_meta AS meta')) {
          return [
            { session_id: 'child-a', max_entry_id: 2 },
            { session_id: 'child-b', max_entry_id: 3 }
          ]
        }
        if (sql.includes('deepchat_tape_search_fts_meta AS meta')) {
          return [{ session_id: 'child-a', max_entry_id: 2 }]
        }
        if (sql.includes('SELECT projection.*, NULL AS score')) {
          return [
            {
              session_id: 'child-b',
              entry_id: 3,
              kind: 'event',
              name: 'child/result',
              source_type: null,
              source_id: null,
              source_seq: null,
              search_text: 'projection needle',
              summary_text: 'projection needle',
              refs_json: '{}',
              created_at: 200,
              score: null
            }
          ]
        }
        return []
      }
    }))
    const projectionTable = new DeepChatTapeSearchProjectionTable({
      prepare,
      exec: vi.fn()
    } as any)
    ;(projectionTable as any).ftsReady = true

    const sources = [
      { sessionId: 'child-a', maxEntryId: 2 },
      { sessionId: 'child-b', maxEntryId: 3 }
    ]
    const result = projectionTable.searchSourcesReadOnly(sources, 'projection needle', { limit: 5 })

    expect(result.rows).toMatchObject([{ session_id: 'child-b', entry_id: 3, score: null }])
    expect(reads.some(({ sql }) => sql.includes('bm25(deepchat_tape_search_fts)'))).toBe(false)
    expect(
      reads.find(({ sql }) => sql.includes('SELECT projection.*, NULL AS score'))?.params[0]
    ).toBe(JSON.stringify(sources))
  })

  itIfSqlite(
    `keeps projected and raw linked multi-term search aligned${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new DeepChatTapeEntriesTable(db)
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        table.createTable()
        projectionTable.createTable()
        table.ensureBootstrapAnchor('child')
        const entry = table.appendEvent({
          sessionId: 'child',
          name: 'child/result',
          data: { text: 'alpha separated by several words before beta' },
          createdAt: 100
        })
        const sources = [{ sessionId: 'child', maxEntryId: entry.entry_id }]
        projectionTable.replaceSession(
          'child',
          [
            {
              sessionId: 'child',
              entryId: entry.entry_id,
              kind: 'event',
              name: 'child/result',
              sourceType: null,
              sourceId: null,
              sourceSeq: null,
              searchText: 'alpha separated by several words before beta',
              summaryText: 'alpha separated by several words before beta',
              refs: {},
              createdAt: 100
            }
          ],
          entry.entry_id
        )

        const projected = projectionTable.searchSourcesReadOnly(sources, 'alpha beta', { limit: 5 })
        const raw = table.searchEffectiveSourcesAtHeads(sources, 'alpha beta', { limit: 5 })

        expect(projected.coveredSources).toEqual(sources)
        expect(raw.map((row) => [row.session_id, row.entry_id])).toEqual(
          projected.rows.map((row) => [row.session_id, row.entry_id])
        )
        expect(raw).toHaveLength(1)
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `queries effective linked sources and context at frozen heads${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new DeepChatTapeEntriesTable(db)
        table.createTable()
        table.ensureBootstrapAnchor('child-a')
        table.ensureBootstrapAnchor('child-b')
        table.appendEvent({
          sessionId: 'child-a',
          name: 'child/result',
          data: { text: 'native linked needle A' },
          createdAt: 100
        })
        table.appendEvent({
          sessionId: 'child-b',
          name: 'child/result',
          data: { text: 'native linked needle B' },
          createdAt: 200
        })
        table.appendEvent({
          sessionId: 'child-a',
          name: 'child/late',
          data: { text: 'native linked needle late' },
          createdAt: 300
        })

        const sources = [
          { sessionId: 'child-a', maxEntryId: 2 },
          { sessionId: 'child-b', maxEntryId: 2 }
        ]
        expect(
          table.searchEffectiveSourcesAtHeads(sources, 'native linked needle', { limit: 1 })
        ).toMatchObject([{ session_id: 'child-b', entry_id: 2 }])
        expect(
          table
            .searchEffectiveSourcesAtHeads(sources, 'native linked needle', { limit: 10 })
            .map((row) => [row.session_id, row.entry_id])
        ).toEqual([
          ['child-b', 2],
          ['child-a', 2]
        ])
        expect(
          table
            .getEffectiveContextRowsAtHead({ sessionId: 'child-a', maxEntryId: 2 }, [2], {
              before: 1,
              after: 5,
              limit: 10
            })
            .map((row) => row.entry_id)
        ).toEqual([2, 1])

        table.ensureBootstrapAnchor('child-message')
        const original = createRecord({
          id: 'linked-message',
          sessionId: 'child-message',
          content: JSON.stringify({ text: 'old linked marker', files: [], links: [] })
        })
        const replacement = {
          ...original,
          content: JSON.stringify({ text: 'new linked marker', files: [], links: [] }),
          updatedAt: 200
        }
        appendMessageRecordToTape(table, original, 'live')
        appendMessageReplacementToTape(table, replacement, 'native_edit')
        const replacementHead = table.getMaxEntryId('child-message')
        expect(
          table.searchEffectiveSourcesAtHeads(
            [{ sessionId: 'child-message', maxEntryId: replacementHead }],
            'old linked marker'
          )
        ).toEqual([])
        const replacementHits = table.searchEffectiveSourcesAtHeads(
          [{ sessionId: 'child-message', maxEntryId: replacementHead }],
          'new linked marker'
        )
        expect(replacementHits).toHaveLength(1)
        expect(
          table
            .getEffectiveContextRowsAtHead(
              { sessionId: 'child-message', maxEntryId: replacementHead },
              [replacementHits[0].entry_id],
              { before: 0, after: 0, limit: 5 }
            )
            .map((row) => row.entry_id)
        ).toEqual([replacementHits[0].entry_id])

        table.append({
          sessionId: 'child-message',
          kind: 'message',
          name: 'message/user',
          source: { type: 'message', id: original.id, seq: 0 },
          provenanceKey: null,
          payload: {
            record: {
              id: original.id,
              sessionId: original.sessionId,
              orderSeq: original.orderSeq,
              role: original.role,
              status: 'sent'
            }
          },
          meta: { source: 'malformed_import' }
        })
        expect(
          table.searchEffectiveSourcesAtHeads(
            [
              {
                sessionId: 'child-message',
                maxEntryId: table.getMaxEntryId('child-message')
              }
            ],
            'new linked marker'
          )
        ).toMatchObject([{ entry_id: replacementHits[0].entry_id }])

        appendMessageRetractionToTape(table, replacement, 'native_delete')
        expect(
          table.searchEffectiveSourcesAtHeads(
            [
              {
                sessionId: 'child-message',
                maxEntryId: table.getMaxEntryId('child-message')
              }
            ],
            'new linked marker'
          )
        ).toEqual([])
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `searches exact frozen projections without repairing a later child tail${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        projectionTable.replaceSession(
          'child',
          [
            {
              sessionId: 'child',
              entryId: 2,
              kind: 'event',
              name: 'child/result',
              sourceType: null,
              sourceId: null,
              sourceSeq: null,
              searchText: 'native frozen projection needle',
              summaryText: 'native frozen projection needle',
              refs: {},
              createdAt: 100
            }
          ],
          2
        )
        const before = db
          .prepare(
            `SELECT projection_version, max_entry_id, updated_at
             FROM deepchat_tape_search_projection_meta
             WHERE session_id = ?`
          )
          .get('child')

        const result = projectionTable.searchSourcesReadOnly(
          [{ sessionId: 'child', maxEntryId: 2 }],
          'native frozen projection needle',
          { limit: 5 }
        )

        expect(result.coveredSources).toEqual([{ sessionId: 'child', maxEntryId: 2 }])
        expect(result.rows).toMatchObject([{ session_id: 'child', entry_id: 2 }])
        expect(
          projectionTable.searchSourcesReadOnly(
            [{ sessionId: 'child', maxEntryId: 3 }],
            'native frozen projection needle',
            { limit: 5 }
          )
        ).toEqual({ rows: [], coveredSources: [] })
        expect(
          db
            .prepare(
              `SELECT projection_version, max_entry_id, updated_at
               FROM deepchat_tape_search_projection_meta
               WHERE session_id = ?`
            )
            .get('child')
        ).toEqual(before)
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `filters stale FTS rows through the base projection after restart${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 2,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'current',
              sourceSeq: 0,
              searchText: 'current Redis marker',
              summaryText: 'current Redis marker',
              refs: { messageId: 'current' },
              createdAt: 200
            }
          ],
          2
        )
        db.prepare(
          `INSERT INTO deepchat_tape_search_fts (
             search_text,
             name,
             session_id,
             entry_id,
             kind,
             source_type,
             source_id,
             source_seq,
             summary_text,
             refs_json,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'stale removed marker',
          'message/user',
          's1',
          1,
          'message',
          'message',
          'old',
          0,
          'stale removed marker',
          '{"messageId":"old"}',
          100
        )

        const restartedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        restartedProjectionTable.createTable()

        expect(restartedProjectionTable.isCurrent('s1', 2)).toBe(true)
        expect(restartedProjectionTable.search('s1', 'stale removed marker', { limit: 5 })).toEqual(
          []
        )
        expect(
          restartedProjectionTable.search('s1', 'current Redis marker', { limit: 5 })[0]
        ).toMatchObject({
          entry_id: 2,
          refs_json: '{"messageId":"current"}'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `recovers same-entry stale FTS after a base-only projection write and restart${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'm1',
              sourceSeq: 0,
              searchText: 'old durable marker',
              summaryText: 'old durable marker',
              refs: { messageId: 'm1' },
              createdAt: 100
            }
          ],
          1
        )

        projectionTable.disableFtsForTesting()
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'm1',
              sourceSeq: 0,
              searchText: 'new durable marker',
              summaryText: 'new durable marker',
              refs: { messageId: 'm1' },
              createdAt: 100
            }
          ],
          1
        )
        db.prepare(
          `INSERT INTO deepchat_tape_search_fts (
             search_text,
             name,
             session_id,
             entry_id,
             kind,
             source_type,
             source_id,
             source_seq,
             summary_text,
             refs_json,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'old durable marker',
          'message/user',
          's1',
          1,
          'message',
          'message',
          'm1',
          0,
          'old durable marker',
          '{"messageId":"m1"}',
          100
        )

        const restartedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        restartedProjectionTable.createTable()

        expect(restartedProjectionTable.isCurrent('s1', 1)).toBe(true)
        expect(restartedProjectionTable.search('s1', 'old durable marker', { limit: 5 })).toEqual(
          []
        )
        expect(
          restartedProjectionTable.search('s1', 'new durable marker', { limit: 5 })[0]
        ).toMatchObject({
          entry_id: 1,
          search_text: 'new durable marker'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `rebuilds FTS during append when previous FTS meta is missing after restart${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.disableFtsForTesting()
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'old',
              sourceSeq: 0,
              searchText: 'old append marker',
              summaryText: 'old append marker',
              refs: { messageId: 'old' },
              createdAt: 100
            }
          ],
          1
        )

        const restartedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        restartedProjectionTable.createTable()
        restartedProjectionTable.appendSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 2,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'new',
              sourceSeq: 0,
              searchText: 'new append marker',
              summaryText: 'new append marker',
              refs: { messageId: 'new' },
              createdAt: 200
            }
          ],
          2
        )

        expect(restartedProjectionTable.isCurrent('s1', 2)).toBe(true)
        expect(
          restartedProjectionTable.search('s1', 'old append marker', { limit: 1 })[0]
        ).toMatchObject({
          entry_id: 1,
          refs_json: '{"messageId":"old"}'
        })
        expect(
          restartedProjectionTable.search('s1', 'new append marker', { limit: 1 })[0]
        ).toMatchObject({
          entry_id: 2,
          refs_json: '{"messageId":"new"}'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `rebuilds migrated tape FTS when freshness meta is excluded${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'old',
              sourceSeq: 0,
              searchText: 'old migrated marker',
              summaryText: 'old migrated marker',
              refs: { messageId: 'old' },
              createdAt: 100
            }
          ],
          1
        )
        db.prepare('DELETE FROM deepchat_tape_search_fts WHERE session_id = ?').run('s1')
        db.prepare('DELETE FROM deepchat_tape_search_fts_meta WHERE session_id = ?').run('s1')

        const migratedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        migratedProjectionTable.createTable()
        migratedProjectionTable.appendSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 2,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'new',
              sourceSeq: 0,
              searchText: 'new migrated marker',
              summaryText: 'new migrated marker',
              refs: { messageId: 'new' },
              createdAt: 200
            }
          ],
          2
        )

        expect(migratedProjectionTable.isCurrent('s1', 2)).toBe(true)
        expect(
          migratedProjectionTable.search('s1', 'old migrated marker', { limit: 1 })[0]
        ).toMatchObject({
          entry_id: 1,
          refs_json: '{"messageId":"old"}'
        })
        expect(
          migratedProjectionTable.search('s1', 'new migrated marker', { limit: 1 })[0]
        ).toMatchObject({
          entry_id: 2,
          refs_json: '{"messageId":"new"}'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `keeps common-term FTS searches scoped and bounded on large session sets${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }

        for (let index = 0; index < 180; index += 1) {
          const sessionId = `s-${index}`
          const rows = Array.from({ length: 8 }, (_, offset) => ({
            sessionId,
            entryId: offset + 1,
            kind: 'message' as const,
            name: 'message/user',
            sourceType: 'message' as const,
            sourceId: `m-${index}-${offset}`,
            sourceSeq: offset,
            searchText: `sharedcommon marker session-${index} row-${offset}`,
            summaryText: `sharedcommon marker session-${index} row-${offset}`,
            refs: { messageId: `m-${index}-${offset}` },
            createdAt: index * 10 + offset
          }))
          projectionTable.replaceSession(sessionId, rows, rows.length)
        }

        const planRows = db
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT projection.session_id,
                    projection.entry_id,
                    projection.kind,
                    projection.name,
                    projection.source_type,
                    projection.source_id,
                    projection.source_seq,
                    projection.search_text,
                    projection.summary_text,
                    projection.refs_json,
                    projection.created_at,
                    bm25(deepchat_tape_search_fts) AS score
               FROM deepchat_tape_search_fts
               INNER JOIN deepchat_tape_search_projection AS projection
                 ON projection.session_id = deepchat_tape_search_fts.session_id
                AND projection.entry_id = CAST(deepchat_tape_search_fts.entry_id AS INTEGER)
                AND projection.search_text = deepchat_tape_search_fts.search_text
              WHERE deepchat_tape_search_fts MATCH ?
                AND deepchat_tape_search_fts.session_id = ?
                AND projection.session_id = ?
              ORDER BY score ASC, projection.entry_id DESC
              LIMIT ?`
          )
          .all('"sharedcommon"', 's-42', 's-42', 5) as Array<{ detail: string }>
        const plan = planRows.map((row) => row.detail).join('\n')

        expect(plan).toMatch(/VIRTUAL TABLE INDEX/i)
        expect(plan).toMatch(/SEARCH projection USING (?:COVERING )?INDEX/i)
        expect(plan).not.toMatch(/\bSCAN projection\b/i)

        const startedAt = performance.now()
        const hits = projectionTable.search('s-42', 'sharedcommon', { limit: 5 })
        const elapsedMs = performance.now() - startedAt

        expect(hits).toHaveLength(5)
        expect(hits.every((hit) => hit.session_id === 's-42')).toBe(true)
        expect(elapsedMs).toBeLessThan(1500)
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `does not trust same-entry stale FTS text even when stale FTS meta is current${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.replaceSession(
          's1',
          [
            {
              sessionId: 's1',
              entryId: 1,
              kind: 'message',
              name: 'message/user',
              sourceType: 'message',
              sourceId: 'm1',
              sourceSeq: 0,
              searchText: 'new guarded marker',
              summaryText: 'new guarded marker',
              refs: { messageId: 'm1' },
              createdAt: 100
            }
          ],
          1
        )
        db.prepare('DELETE FROM deepchat_tape_search_fts WHERE session_id = ?').run('s1')
        db.prepare(
          `INSERT INTO deepchat_tape_search_fts (
             search_text,
             name,
             session_id,
             entry_id,
             kind,
             source_type,
             source_id,
             source_seq,
             summary_text,
             refs_json,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'old guarded marker',
          'message/user',
          's1',
          1,
          'message',
          'message',
          'm1',
          0,
          'old guarded marker',
          '{"messageId":"m1"}',
          100
        )

        const restartedProjectionTable = new DeepChatTapeSearchProjectionTable(db)
        restartedProjectionTable.createTable()

        expect(restartedProjectionTable.isCurrent('s1', 1)).toBe(true)
        expect(restartedProjectionTable.search('s1', 'old guarded marker', { limit: 5 })).toEqual(
          []
        )
        expect(
          restartedProjectionTable.search('s1', 'new guarded marker', { limit: 5 })[0]
        ).toMatchObject({
          entry_id: 1,
          search_text: 'new guarded marker'
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `does not mark a tape projection current when FTS DML fails${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        projectionTable.createTable()
        if (!projectionTable.hasFtsReadyForTesting()) {
          return
        }
        projectionTable.dropFtsForTesting()
        ;(projectionTable as any).ftsReady = true

        expect(() =>
          projectionTable.replaceSession(
            's1',
            [
              {
                sessionId: 's1',
                entryId: 1,
                kind: 'message',
                name: 'message/user',
                sourceType: 'message',
                sourceId: 'm1',
                sourceSeq: 0,
                searchText: 'Redis TTL',
                summaryText: 'Redis TTL',
                refs: { messageId: 'm1' },
                createdAt: 100
              }
            ],
            1
          )
        ).toThrow()
        expect(projectionTable.isCurrent('s1', 1)).toBe(false)
        expect(projectionTable.getProjectedEntryIds('s1')).toEqual([])
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `filters memory view manifests by message in SQLite before limit${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new DeepChatTapeEntriesTable(db)
        table.createTable()
        table.appendEvent({
          sessionId: 's1',
          name: 'view/assembled',
          data: { ignored: true },
          meta: { messageId: 'msg-old' },
          createdAt: 999
        })
        for (let index = 0; index < 505; index += 1) {
          table.appendAnchor({
            sessionId: 's1',
            name: 'memory/view_assembled',
            state: {
              policyVersion: 1,
              tokenBudget: 1000,
              estimatedTokens: index,
              selected: [`m-${index}`],
              dropped: [],
              queryHash: `hash-${index}`
            },
            meta: { messageId: `msg-${index}` },
            createdAt: index
          })
        }

        const rows = table.listMemoryViewManifestAnchorsBySessions(['s1'], {
          limit: 1,
          messageId: 'msg-0'
        })

        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          kind: 'anchor',
          name: 'memory/view_assembled',
          created_at: 0
        })
        expect(JSON.parse(rows[0].meta_json)).toEqual({ messageId: 'msg-0' })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `queries memory view manifests for large agents without expanding session parameters${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const sessionTable = new NewSessionsTable(db)
        const tapeTable = new DeepChatTapeEntriesTable(db)
        sessionTable.createTable()
        tapeTable.createTable()
        for (let index = 0; index < 1200; index += 1) {
          const sessionId = `s-${index}`
          db.prepare(
            `INSERT INTO new_sessions (
               id,
               agent_id,
               title,
               project_dir,
               is_pinned,
               is_draft,
               active_skills,
               disabled_agent_tools,
               subagent_enabled,
               session_kind,
               parent_session_id,
               subagent_meta_json,
               created_at,
               updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            sessionId,
            'agent-a',
            `Session ${index}`,
            null,
            0,
            0,
            '[]',
            '[]',
            index % 2 === 0 ? 0 : 1,
            index % 2 === 0 ? 'regular' : 'subagent',
            null,
            null,
            index,
            index
          )
          tapeTable.appendAnchor({
            sessionId,
            name: 'memory/view_assembled',
            state: {
              policyVersion: 1,
              tokenBudget: 1000,
              estimatedTokens: index,
              selected: [`m-${index}`],
              dropped: [],
              queryHash: `hash-${index}`
            },
            meta: { messageId: `msg-${index}` },
            createdAt: index
          })
        }
        db.prepare(
          `INSERT INTO new_sessions (
             id,
             agent_id,
             title,
             project_dir,
             is_pinned,
             is_draft,
             active_skills,
             disabled_agent_tools,
             subagent_enabled,
             session_kind,
             parent_session_id,
             subagent_meta_json,
             created_at,
             updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'other-session',
          'other-agent',
          'Other',
          null,
          0,
          0,
          '[]',
          '[]',
          0,
          'regular',
          null,
          null,
          9999,
          9999
        )
        tapeTable.appendAnchor({
          sessionId: 'other-session',
          name: 'memory/view_assembled',
          state: {
            policyVersion: 1,
            tokenBudget: 1000,
            estimatedTokens: 9999,
            selected: ['other'],
            dropped: [],
            queryHash: 'other'
          },
          meta: { messageId: 'msg-0' },
          createdAt: 9999
        })

        const rows = tapeTable.listMemoryViewManifestAnchorsByAgent('agent-a', {
          messageId: 'msg-0',
          limit: 1
        })

        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          session_id: 's-0',
          kind: 'anchor',
          name: 'memory/view_assembled',
          created_at: 0
        })
      } finally {
        db.close()
      }
    }
  )

  itIfSqlite(
    `searches a SQLite tape projection and expands compact context without raw payloads${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const table = new DeepChatTapeEntriesTable(db)
        const projectionTable = new DeepChatTapeSearchProjectionTable(db)
        table.createTable()
        projectionTable.createTable()
        const service = new SessionTape({
          deepchatTapeEntriesTable: table,
          deepchatTapeSearchProjectionTable: projectionTable,
          deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
        } as any)

        table.append({
          sessionId: 's1',
          kind: 'message',
          name: 'message/user',
          source: { type: 'message', id: 'u1', seq: 0 },
          payload: {
            record: createRecord({
              id: 'u1',
              content: JSON.stringify({
                text: 'Check Redis TTL with /usr/local/bin/deploy --flag and error 42.',
                files: [],
                links: []
              }),
              createdAt: 100,
              updatedAt: 100
            })
          },
          meta: { source: 'live', orderSeq: 1, role: 'user' },
          createdAt: 100
        })
        table.append({
          sessionId: 's1',
          kind: 'tool_result',
          name: 'shell',
          source: { type: 'tool_result', id: 'u1:tc1', seq: 0 },
          payload: {
            messageId: 'u1',
            orderSeq: 2,
            toolCallId: 'tc1',
            exitStatus: 42,
            response: 'Exit code 42 in /tmp/deploy.log'
          },
          meta: { source: 'live', status: 'error' },
          createdAt: 110
        })

        const pathHits = service.search('s1', '/usr/local/bin/deploy', { limit: 5 })
        expect(pathHits).toHaveLength(1)
        expect(pathHits[0]).toMatchObject({
          kind: 'message',
          summary: expect.stringContaining('Redis TTL'),
          refs: {
            messageId: 'u1',
            role: 'user',
            filePaths: expect.arrayContaining(['/usr/local/bin/deploy'])
          }
        })
        expect(pathHits[0]).not.toHaveProperty('payload')
        expect(pathHits[0]).not.toHaveProperty('meta')
        expect(service.search('s1', 'Redis TTL', { limit: 5 }).map((hit) => hit.entryId)).toContain(
          pathHits[0].entryId
        )
        const errorHits = service.search('s1', '42', { kinds: ['tool_result'], limit: 5 })
        expect(errorHits[0]).toMatchObject({
          refs: {
            toolCallId: 'tc1',
            exitStatus: 42
          }
        })
        expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(true)

        table.append({
          sessionId: 's1',
          kind: 'message',
          name: 'message/user',
          source: { type: 'message', id: 'u2', seq: 0 },
          payload: {
            record: createRecord({
              id: 'u2',
              orderSeq: 3,
              content: JSON.stringify({ text: 'zoxide marker 简洁', files: [], links: [] }),
              createdAt: 120,
              updatedAt: 120
            })
          },
          meta: { source: 'live', orderSeq: 3, role: 'user' },
          createdAt: 120
        })
        expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(false)
        const rebuiltHits = service.search('s1', '简洁', { limit: 5 })
        expect(rebuiltHits.map((hit) => hit.refs?.messageId)).toContain('u2')
        expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(true)
        if (projectionTable.hasFtsReadyForTesting()) {
          projectionTable.dropFtsForTesting()
          ;(projectionTable as any).ftsReady = true
          table.append({
            sessionId: 's1',
            kind: 'message',
            name: 'message/user',
            source: { type: 'message', id: 'u3', seq: 0 },
            payload: {
              record: createRecord({
                id: 'u3',
                orderSeq: 4,
                content: JSON.stringify({
                  text: 'fts recovery marker',
                  files: [],
                  links: []
                }),
                createdAt: 130,
                updatedAt: 130
              })
            },
            meta: { source: 'live', orderSeq: 4, role: 'user' },
            createdAt: 130
          })
          const recoveryHits = service.search('s1', 'fts recovery marker', { limit: 5 })
          expect(recoveryHits.map((hit) => hit.refs?.messageId)).toContain('u3')
          expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(false)
          expect(projectionTable.hasFtsReadyForTesting()).toBe(false)

          const restoredHits = service.search('s1', 'fts recovery marker', { limit: 5 })
          expect(restoredHits.map((hit) => hit.refs?.messageId)).toContain('u3')
          expect(projectionTable.isCurrent('s1', table.getMaxEntryId('s1'))).toBe(true)
          expect(projectionTable.hasFtsReadyForTesting()).toBe(true)
        }

        const context = service.getContext('s1', [pathHits[0].entryId], {
          before: 0,
          after: 1,
          limit: 2,
          maxBytesPerEntry: 24,
          maxTotalBytes: 24
        })
        expect(context.matchedEntryIds).toEqual([pathHits[0].entryId])
        expect(context.entries[0]).toMatchObject({
          entryId: pathHits[0].entryId,
          summary: expect.stringContaining('Redis TTL'),
          evidence: {
            truncated: true
          }
        })
        expect(context.entries[0].evidence.bytes).toBeLessThanOrEqual(24)
        expect(context.entries[0]).not.toHaveProperty('payload')
        expect(context.entries[0]).not.toHaveProperty('meta')
        const limitedContext = service.getContext(
          's1',
          [pathHits[0].entryId, errorHits[0].entryId],
          {
            before: 0,
            after: 0,
            limit: 1
          }
        )
        expect(limitedContext.entries.map((entry) => entry.entryId)).toEqual([pathHits[0].entryId])
        expect(limitedContext.matchedEntryIds).toEqual([pathHits[0].entryId])
      } finally {
        db.close()
      }
    }
  )

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
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const legacyContext = buildContext(
      's1',
      { text: 'next', files: [] },
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
      { text: 'next', files: [] },
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

  it('rejects handoff anchors without a non-empty summary before writing Tape state', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    expect(() => service.handoff('s1', 'phase_done', { summary: '   ' })).toThrow(
      'Tape handoff requires a non-empty summary.'
    )
    expect(() => service.handoff('s1', 'phase_done', { reason: 'phase complete' } as any)).toThrow(
      'Tape handoff requires a non-empty summary.'
    )

    expect(table.ensureBootstrapAnchor).not.toHaveBeenCalled()
    expect(table.appendAnchor).not.toHaveBeenCalled()
    expect(entries).toEqual([])
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
    const service = new SessionTape({
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

  it('stores and lists view manifests as idempotent tape events', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: [
        {
          entryId: sourceMaps.entryIdByMessageId.get('u1') ?? null,
          messageId: 'u1',
          orderSeq: 1,
          role: 'user',
          source: 'tape',
          reason: 'selected_history'
        }
      ],
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    })

    const first = service.appendViewManifest(manifest)
    const second = service.appendViewManifest(manifest)

    expect(second.entry_id).toBe(first.entry_id)
    expect(entries.filter((entry) => entry.name === 'view/assembled')).toHaveLength(1)
    expect(JSON.parse(first.meta_json)).toMatchObject({
      policy: 'legacy_context_v1',
      policyVersion: 1
    })
    expect(service.listViewManifestsByMessage('s1', 'a1')).toMatchObject([
      {
        sessionId: 's1',
        messageId: 'a1',
        requestSeq: 1,
        entryId: first.entry_id,
        manifest: {
          hashes: {
            manifestHash: manifest.hashes.manifestHash
          },
          policy: 'legacy_context_v1',
          policyVersion: 1,
          included: [
            {
              messageId: 'u1',
              entryId: sourceMaps.entryIdByMessageId.get('u1')
            }
          ]
        }
      }
    ])
  })

  it('indexes effective tool facts so tool-loop manifests reference real entries', () => {
    const { table } = createTapeTableMock()
    const assistantRecord = createRecord({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: JSON.stringify([
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 120,
          tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}', response: 'result' }
        }
      ])
    })
    appendToolFactsToTape(table as any, assistantRecord, 'live', 'tool_loop')

    const service = createTapeService(table)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    expect(sourceMaps.toolCallEntryIdByToolId.get('tc1')).toBeGreaterThan(0)
    expect(sourceMaps.toolResultEntryIdByToolId.get('tc1')).toBeGreaterThan(0)

    const refs = buildRequestRefs(
      [
        { role: 'system', content: 'system' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'tc1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }
          ]
        },
        { role: 'tool', content: 'result', tool_call_id: 'tc1' }
      ],
      sourceMaps
    )
    expect(refs).toMatchObject([
      { role: 'system', source: 'synthetic' },
      {
        role: 'assistant',
        source: 'tape',
        reason: 'tool_loop_message',
        entryId: sourceMaps.toolCallEntryIdByToolId.get('tc1')
      },
      {
        role: 'tool',
        source: 'tape',
        reason: 'tool_loop_message',
        entryId: sourceMaps.toolResultEntryIdByToolId.get('tc1')
      }
    ])
  })

  it('scopes tool source maps to the in-flight message so reused tool ids do not collide', () => {
    const { table } = createTapeTableMock()
    const blocks = (response: string) =>
      JSON.stringify([
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 120,
          tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}', response }
        }
      ])
    appendToolFactsToTape(
      table as any,
      createRecord({ id: 'a1', orderSeq: 2, role: 'assistant', content: blocks('first') }),
      'live',
      'tool_loop'
    )
    appendToolFactsToTape(
      table as any,
      createRecord({ id: 'a2', orderSeq: 4, role: 'assistant', content: blocks('second') }),
      'live',
      'tool_loop'
    )

    const service = createTapeService(table)
    const scopedToA1 = service.getViewManifestSourceMaps('s1', 'a1')
    const scopedToA2 = service.getViewManifestSourceMaps('s1', 'a2')

    expect(scopedToA1.toolCallEntryIdByToolId.get('tc1')).toBeLessThan(
      scopedToA2.toolCallEntryIdByToolId.get('tc1')!
    )
    expect(scopedToA1.toolResultEntryIdByToolId.get('tc1')).not.toBe(
      scopedToA2.toolResultEntryIdByToolId.get('tc1')
    )
  })

  it('exports tool_call and tool_result entries in a tool-loop replay slice', () => {
    const { table } = createTapeTableMock()
    const assistantRecord = createRecord({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: JSON.stringify([
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 120,
          tool_call: { id: 'tc1', name: 'search', params: '{"q":"x"}', response: 'result' }
        }
      ])
    })
    appendToolFactsToTape(table as any, assistantRecord, 'live', 'tool_loop')

    const service = createTapeService(table)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const messages = [
      { role: 'system' as const, content: 'system' },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          { id: 'tc1', type: 'function' as const, function: { name: 'search', arguments: '{}' } }
        ]
      },
      { role: 'tool' as const, content: 'result', tool_call_id: 'tc1' }
    ]
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 2,
      taskType: 'tool_loop',
      policy: 'tool_loop_shadow',
      policyVersion: 1,
      messages,
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: buildRequestRefs(messages, sourceMaps),
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    })
    service.appendViewManifest(manifest)

    const slice = service.exportReplaySlice('s1', 'a1', { requestSeq: 2 })
    const kinds = slice?.entries.map((entry) => entry.kind) ?? []
    expect(kinds).toContain('tool_call')
    expect(kinds).toContain('tool_result')
  })

  it('filters malformed view manifest rows when listing by message', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: {
        type: 'runtime_event',
        id: 'a1',
        seq: 1
      },
      data: {
        manifest: {
          schemaVersion: 1,
          sessionId: 's1',
          messageId: 'a1',
          requestSeq: 1,
          included: 'not-an-array'
        }
      }
    })

    expect(service.listViewManifestsByMessage('s1', 'a1')).toEqual([])
  })

  it('normalizes legacy manifests without hashVersion to hashVersion 1', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }
    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: [],
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    })
    const legacyManifest: Record<string, unknown> = { ...manifest }
    delete legacyManifest.hashVersion

    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 99 },
      data: { manifest: legacyManifest }
    })

    const [record] = service.listViewManifestsByMessage('s1', 'a1')
    expect(record.manifest.hashVersion).toBe(1)
  })

  it('filters manifests whose hashVersion is not a number', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }
    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: [],
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    })

    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 99 },
      data: { manifest: { ...manifest, hashVersion: '2' } }
    })

    expect(service.listViewManifestsByMessage('s1', 'a1')).toEqual([])
  })

  it('annotates read records with hash integrity without dropping tampered manifests', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }
    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const baseInput = {
      sessionId: 's1',
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: [],
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    }
    const validManifest = createTapeViewManifest({ ...baseInput, messageId: 'a1', requestSeq: 1 })
    service.appendViewManifest(validManifest)

    const tamperedManifest = createTapeViewManifest({
      ...baseInput,
      messageId: 'a2',
      requestSeq: 1
    })
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a2', seq: 99 },
      data: { manifest: { ...tamperedManifest, latestEntryId: tamperedManifest.latestEntryId + 1 } }
    })

    const [validRecord] = service.listViewManifestsByMessage('s1', 'a1')
    const [tamperedRecord] = service.listViewManifestsByMessage('s1', 'a2')
    expect(validRecord.integrity).toBe('valid')
    expect(tamperedRecord).toBeDefined()
    expect(tamperedRecord.integrity).toBe('invalid')
  })

  it('binds reconstruction lineage to the latest reconstruction anchor including handoffs', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      source: { type: 'summary', id: 's1', seq: 1 },
      state: {}
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/phase_done',
      source: { type: 'handoff', id: 's1', seq: 2 },
      state: {}
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'fork/merge',
      source: { type: 'fork', id: 'child', seq: 3 },
      state: {}
    })

    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const entryIdByName = (name: string) =>
      table.getBySession('s1').find((entry: any) => entry.name === name)?.entry_id

    expect(sourceMaps.anchorEntryIds).toHaveLength(4)
    expect(sourceMaps.reconstructionAnchorEntryId).toBe(entryIdByName('handoff/phase_done'))
    expect(sourceMaps.reconstructionAnchorEntryIds).toEqual([
      sourceMaps.reconstructionAnchorEntryId
    ])
    expect(sourceMaps.reconstructionAnchorEntryIds).not.toContain(
      entryIdByName('compaction/manual')
    )
    expect(sourceMaps.reconstructionAnchorEntryIds).not.toContain(entryIdByName('fork/merge'))
  })

  it('keeps memory anchors off the reconstruction lineage', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      source: { type: 'summary', id: 's1', seq: 1 },
      state: {}
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'memory/extract',
      source: { type: 'runtime_event', id: 's1', seq: 2 },
      state: { memoryIds: ['m1'], count: 1, reason: 'episodic' }
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'memory/reflect',
      source: { type: 'runtime_event', id: 's1', seq: 3 },
      state: { reflectionIds: ['r1'], sourceMemoryIds: ['m1'], count: 1 }
    })

    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const entryIdByName = (name: string) =>
      table.getBySession('s1').find((entry: any) => entry.name === name)?.entry_id

    // Memory anchors are recorded on the tape for observability...
    expect(sourceMaps.anchorEntryIds).toContain(entryIdByName('memory/extract'))
    expect(sourceMaps.anchorEntryIds).toContain(entryIdByName('memory/reflect'))
    // ...but never own the reconstruction cursor; only the summary anchor does.
    expect(sourceMaps.reconstructionAnchorEntryId).toBe(entryIdByName('compaction/manual'))
    expect(sourceMaps.reconstructionAnchorEntryIds).not.toContain(entryIdByName('memory/extract'))
    expect(sourceMaps.reconstructionAnchorEntryIds).not.toContain(entryIdByName('memory/reflect'))
  })

  it('bounds replay slices to the selected view instead of pre-cursor history', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.reconstructionAnchorEntryIds,
      included: [
        {
          entryId: sourceMaps.entryIdByMessageId.get('u1') ?? null,
          messageId: 'u1',
          orderSeq: 1,
          role: 'user',
          source: 'tape',
          reason: 'selected_history'
        }
      ],
      excluded: [],
      summaryCursor: {
        summaryCursorOrderSeq: 100,
        preCursorOrderSeqMin: 1,
        preCursorOrderSeqMax: 99,
        preCursorCount: 99
      },
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 100,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false,
      assembledAt: 200
    })
    service.appendViewManifest(manifest)

    const slice = service.exportReplaySlice('s1', 'a1')

    expect(slice?.refs.excludedEntryIds).toEqual([])
    expect(slice?.refs.anchorEntryIds).toEqual(sourceMaps.reconstructionAnchorEntryIds)
    expect(slice?.refs.anchorEntryIds).toHaveLength(1)
    expect(slice?.manifestRecord.manifest.excludedRanges).toEqual([
      { fromOrderSeq: 1, toOrderSeq: 99, count: 99, reason: 'before_summary_cursor' }
    ])
    expect(slice?.entries).toHaveLength(3)
  })

  it('exports replay slices with metadata-only payloads by default', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [createTraceRow()])
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const manifest = createTapeViewManifest({
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: [
        {
          entryId: sourceMaps.entryIdByMessageId.get('u1') ?? null,
          messageId: 'u1',
          orderSeq: 1,
          role: 'user',
          source: 'tape',
          reason: 'selected_history'
        }
      ],
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: true,
      assembledAt: 200
    })
    const manifestEntry = service.appendViewManifest(manifest)

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000)
    const slice = service.exportReplaySlice('s1', 'a1')
    const secondSlice = service.exportReplaySlice('s1', 'a1')
    nowSpy.mockRestore()

    expect(slice).toMatchObject({
      schemaVersion: 1,
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      mode: 'trace_bound',
      refs: {
        manifestEntryId: manifestEntry.entry_id,
        includedEntryIds: [sourceMaps.entryIdByMessageId.get('u1')],
        anchorEntryIds: sourceMaps.anchorEntryIds
      },
      hashes: {
        manifestHash: manifest.hashes.manifestHash
      }
    })
    expect(slice?.hashes.sliceHash).toHaveLength(64)
    expect(secondSlice?.hashes.sliceHash).toBe(slice?.hashes.sliceHash)
    expect(secondSlice?.createdAt).toBe(2000)
    expect(slice?.trace?.bodyHash).toHaveLength(64)
    expect(slice?.trace?.bodyJson).toBeUndefined()
    expect(slice?.entries.some((entry) => entry.entryId === manifestEntry.entry_id)).toBe(true)
    expect(
      slice?.entries.every((entry) => entry.payload === undefined && entry.meta === undefined)
    ).toBe(true)
  })

  it('exports explicit replay request sequences with opt-in payloads', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [
      createTraceRow({ id: 'trace-1', request_seq: 1 }),
      createTraceRow({
        id: 'trace-2',
        request_seq: 2,
        body_json: '{"messages":[{"role":"tool","content":"done"}]}'
      })
    ])
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const baseManifestInput: TapeViewManifestBuildInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: [
        {
          entryId: sourceMaps.entryIdByMessageId.get('u1') ?? null,
          messageId: 'u1',
          orderSeq: 1,
          role: 'user',
          source: 'tape',
          reason: 'selected_history'
        }
      ],
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: true,
      assembledAt: 200
    }
    const firstManifest = createTapeViewManifest(baseManifestInput)
    const secondManifest = createTapeViewManifest({
      ...baseManifestInput,
      requestSeq: 2,
      taskType: 'tool_loop',
      policy: 'tool_loop_shadow',
      policyVersion: null,
      assembledAt: 250
    })
    service.appendViewManifest(firstManifest)
    service.appendViewManifest(secondManifest)

    const latest = service.exportReplaySlice('s1', 'a1')
    const first = service.exportReplaySlice('s1', 'a1', {
      requestSeq: 1,
      includeTapePayloads: true,
      includeTracePayload: true
    })

    expect(latest?.requestSeq).toBe(2)
    expect(first?.requestSeq).toBe(1)
    expect(first?.trace?.bodyJson).toContain('"hello"')
    expect(first?.entries.some((entry) => entry.payload?.record)).toBe(true)
    expect(first?.entries.some((entry) => entry.meta?.source === 'backfill')).toBe(true)
  })

  it('binds each replay slice to its own request seq, ignoring sentinel gap traces', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [
      createTraceRow({
        id: 'trace-req-1',
        request_seq: 1,
        body_json: '{"messages":[{"role":"user","content":"first-request"}]}'
      }),
      createTraceRow({
        id: 'trace-gap',
        request_seq: 0,
        endpoint: 'deepchat://interleaved-reasoning-gap',
        body_json: '{"providerId":"openai"}'
      }),
      createTraceRow({
        id: 'trace-req-2',
        request_seq: 2,
        body_json: '{"messages":[{"role":"tool","content":"second-request"}]}'
      })
    ])
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([createRecord({ id: 'u1', orderSeq: 1 })])
    }

    service.ensureSessionTapeReady('s1', messageStore as any)
    const sourceMaps = service.getViewManifestSourceMaps('s1')
    const baseManifestInput = {
      sessionId: 's1',
      messageId: 'a1',
      requestSeq: 1,
      taskType: 'chat' as const,
      policy: 'legacy_context_v1' as const,
      policyVersion: 1,
      messages: [{ role: 'user' as const, content: 'hello' }],
      tools: [],
      latestEntryId: sourceMaps.latestEntryId,
      anchorEntryIds: sourceMaps.anchorEntryIds,
      included: [
        {
          entryId: sourceMaps.entryIdByMessageId.get('u1') ?? null,
          messageId: 'u1',
          orderSeq: 1,
          role: 'user' as const,
          source: 'tape' as const,
          reason: 'selected_history' as const
        }
      ],
      excluded: [],
      tokenBudget: {
        contextLength: 1000,
        requestedMaxTokens: 100,
        effectiveMaxTokens: 100,
        reserveTokens: 100,
        toolReserveTokens: 0
      },
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: true,
      assembledAt: 200
    }
    service.appendViewManifest(createTapeViewManifest(baseManifestInput))
    service.appendViewManifest(
      createTapeViewManifest({
        ...baseManifestInput,
        requestSeq: 2,
        taskType: 'tool_loop',
        policy: 'tool_loop_shadow',
        policyVersion: null,
        assembledAt: 250
      })
    )

    const first = service.exportReplaySlice('s1', 'a1', {
      requestSeq: 1,
      includeTracePayload: true
    })
    const second = service.exportReplaySlice('s1', 'a1', {
      requestSeq: 2,
      includeTracePayload: true
    })

    expect(first?.trace?.bodyJson).toContain('first-request')
    expect(second?.trace?.bodyJson).toContain('second-request')
  })

  it('returns null when exporting a replay slice without a manifest', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [createTraceRow()])

    expect(service.exportReplaySlice('s1', 'a1')).toBeNull()
  })

  it('rejects non-positive replay request sequences', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [createTraceRow()])

    expect(() => service.exportReplaySlice('s1', 'a1', { requestSeq: 0 })).toThrow(
      'requestSeq must be a positive integer.'
    )
  })

  it('joins an exact manifest and trace into a causal observation slice', () => {
    const { table } = createTapeTableMock()
    const assistant = createRecord({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: '[{"type":"content","content":"done","status":"success"}]',
      status: 'sent',
      metadata: '{"totalTokens":10}',
      createdAt: 200,
      updatedAt: 300
    })
    appendMessageRecordToTape(table as any, assistant, 'live')
    const service = createTapeService(
      table,
      [createTraceRow(), createTraceRow({ id: 'other-session', session_id: 's2', request_seq: 9 })],
      [createMessageRow()]
    )
    service.appendViewManifest(createObservationManifest())

    const slice = service.readCausalObservationSlice('s1', 'a1', {
      currentRuntimeStatus: 'idle'
    })

    expect(slice).toMatchObject({
      schemaVersion: 1,
      sessionId: 's1',
      messageId: 'a1',
      request: {
        state: 'manifest_bound',
        requestSeq: 1,
        replay: {
          requestSeq: 1,
          mode: 'trace_bound',
          trace: { id: 'trace-1', requestSeq: 1 }
        }
      },
      output: {
        correlation: 'message_only',
        terminalMessage: {
          status: 'sent',
          orderSeq: 2,
          createdAt: 200,
          updatedAt: 300
        }
      },
      runtime: { scope: 'current_only', status: 'idle', eventHistory: 'not_persisted' }
    })
    expect(slice.output.entries.map((entry) => entry.kind)).toContain('message')
    expect(slice.output.terminalMessage?.contentHash).toHaveLength(64)
    expect(slice.output.terminalMessage?.metadataHash).toHaveLength(64)
  })

  it('prefers an explicit causal request sequence and otherwise selects the latest raw sequence', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    service.appendViewManifest(createObservationManifest({ requestSeq: 1, assembledAt: 100 }))
    service.appendViewManifest(
      createObservationManifest({
        requestSeq: 2,
        taskType: 'tool_loop',
        policy: 'tool_loop_shadow',
        policyVersion: null,
        assembledAt: 200
      })
    )

    expect(service.readCausalObservationSlice('s1', 'a1').request).toMatchObject({
      state: 'manifest_bound',
      requestSeq: 2
    })
    expect(service.readCausalObservationSlice('s1', 'a1', { requestSeq: 1 }).request).toMatchObject(
      { state: 'manifest_bound', requestSeq: 1 }
    )
  })

  it('does not fall back to an older manifest when a later traced request has no manifest', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [
      createTraceRow({ id: 'trace-1', request_seq: 1 }),
      createTraceRow({ id: 'trace-2', request_seq: 2 })
    ])
    service.appendViewManifest(createObservationManifest({ requestSeq: 1 }))

    expect(service.readCausalObservationSlice('s1', 'a1').request).toMatchObject({
      state: 'manifest_missing',
      requestSeq: 2,
      trace: { id: 'trace-2', requestSeq: 2 }
    })
  })

  it('returns a trace-only request without manufacturing a view manifest', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table, [createTraceRow({ request_seq: 4 })])

    const request = service.readCausalObservationSlice('s1', 'a1').request

    expect(request).toMatchObject({
      state: 'manifest_missing',
      requestSeq: 4,
      trace: { requestSeq: 4 }
    })
    expect(
      request.state === 'manifest_missing' ? request.trace?.bodyJson : undefined
    ).toBeUndefined()
  })

  it('distinguishes malformed manifests from hash-invalid but readable manifests', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'bad', seq: 2 },
      data: { manifest: { schemaVersion: 99, requestSeq: 2 } }
    })
    const tamperedManifest = createObservationManifest({ messageId: 'a1', requestSeq: 1 })
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 1 },
      data: { manifest: { ...tamperedManifest, latestEntryId: 1 } }
    })

    expect(service.readCausalObservationSlice('s1', 'bad').request).toEqual({
      state: 'manifest_malformed',
      requestSeq: 2,
      trace: null
    })
    const invalid = service.readCausalObservationSlice('s1', 'a1').request
    expect(invalid.state).toBe('manifest_bound')
    expect(invalid.state === 'manifest_bound' ? invalid.replay.integrity : undefined).toBe(
      'invalid'
    )
  })

  it('ignores request sequence zero interleaved-reasoning sentinels', () => {
    const { table } = createTapeTableMock()
    table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'a1', seq: 0 },
      data: { manifest: { schemaVersion: 99, requestSeq: 0 } }
    })
    const service = createTapeService(table, [
      createTraceRow({
        id: 'trace-gap',
        request_seq: 0,
        endpoint: 'deepchat://interleaved-reasoning-gap'
      })
    ])

    expect(service.readCausalObservationSlice('s1', 'a1').request).toEqual({
      state: 'request_unavailable',
      requestSeq: null,
      trace: null
    })
  })

  it('keeps multi-round assistant and tool output correlated at message scope only', () => {
    const { table } = createTapeTableMock()
    const assistant = createRecord({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: JSON.stringify([
        {
          type: 'tool_call',
          status: 'success',
          timestamp: 220,
          tool_call: {
            id: 'tc1',
            name: 'search',
            params: '{"q":"x"}',
            response: 'result'
          }
        }
      ]),
      status: 'sent',
      createdAt: 200,
      updatedAt: 300
    })
    appendMessageRecordToTape(table as any, assistant, 'live')
    const service = createTapeService(table, [], [createMessageRow({ content: assistant.content })])
    service.appendViewManifest(createObservationManifest({ requestSeq: 1 }))
    service.appendViewManifest(
      createObservationManifest({
        requestSeq: 2,
        taskType: 'tool_loop',
        policy: 'tool_loop_shadow',
        policyVersion: null
      })
    )

    const firstOutput = service.readCausalObservationSlice('s1', 'a1', { requestSeq: 1 }).output
    const latestOutput = service.readCausalObservationSlice('s1', 'a1').output

    expect(latestOutput.correlation).toBe('message_only')
    expect(latestOutput.entries.map((entry) => entry.kind)).toEqual([
      'message',
      'tool_call',
      'tool_result'
    ])
    expect(latestOutput.entries.map((entry) => entry.entryId)).toEqual(
      firstOutput.entries.map((entry) => entry.entryId)
    )
  })

  it('does not infer a completed event from a paused pending assistant message', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(
      table,
      [],
      [createMessageRow({ status: 'pending', content: '[{"type":"action","status":"pending"}]' })]
    )

    const slice = service.readCausalObservationSlice('s1', 'a1', {
      currentRuntimeStatus: 'generating'
    })

    expect(slice.output.entries).toEqual([])
    expect(slice.output.terminalMessage).toBeNull()
    expect(slice.runtime).toEqual({
      scope: 'current_only',
      status: 'generating',
      eventHistory: 'not_persisted'
    })
    expect(JSON.stringify(slice)).not.toContain('completed')
  })

  it('reads an old message without bootstrapping or backfilling Tape', () => {
    const { table, entries } = createTapeTableMock()
    const messageInsert = vi.fn()
    const traceInsert = vi.fn()
    const projectionApply = vi.fn()
    const projectionReplace = vi.fn()
    const cursorWrite = vi.fn()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatMessageTracesTable: {
        listByMessageId: vi.fn().mockReturnValue([]),
        insert: traceInsert
      },
      deepchatMessagesTable: {
        get: vi.fn().mockReturnValue(createMessageRow()),
        insert: messageInsert
      },
      deepchatMemoryIngestionProjectionTable: {
        applyAppendedEntry: projectionApply,
        replaceSession: projectionReplace
      },
      deepchatSessionsTable: {
        getSummaryState: vi.fn().mockReturnValue(null),
        updateMemoryCursorOrderSeq: cursorWrite
      }
    } as any)

    const slice = service.readCausalObservationSlice('s1', 'a1')

    expect(slice.request).toEqual({
      state: 'request_unavailable',
      requestSeq: null,
      trace: null
    })
    expect(slice.output.terminalMessage?.status).toBe('sent')
    expect(slice.runtime).toEqual({
      scope: 'unavailable',
      status: null,
      eventHistory: 'not_persisted'
    })
    expect(entries).toEqual([])
    expect(table.ensureBootstrapAnchor).not.toHaveBeenCalled()
    expect(table.append).not.toHaveBeenCalled()
    expect(table.appendEvent).not.toHaveBeenCalled()
    expect(messageInsert).not.toHaveBeenCalled()
    expect(traceInsert).not.toHaveBeenCalled()
    expect(projectionApply).not.toHaveBeenCalled()
    expect(projectionReplace).not.toHaveBeenCalled()
    expect(cursorWrite).not.toHaveBeenCalled()
  })

  it('keeps causal observations metadata-only by default and reuses replay payload opt-ins', () => {
    const { table } = createTapeTableMock()
    const assistant = createRecord({
      id: 'a1',
      orderSeq: 2,
      role: 'assistant',
      content: 'tape-secret-output',
      status: 'sent',
      metadata: '{"secret":"tape-metadata"}',
      createdAt: 200,
      updatedAt: 300
    })
    appendMessageRecordToTape(table as any, assistant, 'live')
    const service = createTapeService(
      table,
      [
        createTraceRow({
          headers_json: '{"authorization":"secret-header"}',
          body_json: '{"prompt":"secret-request"}'
        })
      ],
      [
        createMessageRow({
          content: 'projection-only-content-secret',
          metadata: '{"secret":"projection-only-metadata"}',
          blocks_json: '["projection-only-blocks"]',
          error: 'projection-only-error'
        })
      ]
    )
    service.appendViewManifest(createObservationManifest())

    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const metadataOnly = service.readCausalObservationSlice('s1', 'a1')
    const withPayloads = service.readCausalObservationSlice('s1', 'a1', {
      includeTapePayloads: true,
      includeTracePayload: true
    })
    now.mockRestore()

    expect(JSON.stringify(metadataOnly)).not.toContain('tape-secret-output')
    expect(JSON.stringify(metadataOnly)).not.toContain('tape-metadata')
    expect(JSON.stringify(metadataOnly)).not.toContain('secret-header')
    expect(JSON.stringify(metadataOnly)).not.toContain('secret-request')
    expect(JSON.stringify(metadataOnly)).not.toContain('projection-only')
    expect(withPayloads.output.entries.some((entry) => entry.payload?.record)).toBe(true)
    expect(withPayloads.request.state).toBe('manifest_bound')
    expect(
      withPayloads.request.state === 'manifest_bound'
        ? withPayloads.request.replay.trace?.headersJson
        : undefined
    ).toContain('secret-header')
    expect(JSON.stringify(withPayloads)).toContain('tape-secret-output')
    expect(JSON.stringify(withPayloads)).not.toContain('projection-only')
    expect(metadataOnly.output.terminalMessage).not.toHaveProperty('content')
    expect(metadataOnly.output.terminalMessage).not.toHaveProperty('metadata')
    expect(metadataOnly.output.terminalMessage).not.toHaveProperty('blocks')
    expect(metadataOnly.output.terminalMessage).not.toHaveProperty('error')
    expect(stripObservationPayloadOptIns(withPayloads)).toEqual(
      stripObservationPayloadOptIns(metadataOnly)
    )
  })

  it('keeps storage and Memory seams unchanged across every causal observation read mode', () => {
    const { table, entries } = createTapeTableMock()
    const { final } = appendObservationIsolationFacts(table)
    const traceRows = [
      createTraceRow({ id: 'trace-1', request_seq: 1 }),
      createTraceRow({ id: 'trace-2', request_seq: 2 }),
      createTraceRow({ id: 'trace-only', message_id: 'a-trace', request_seq: 7 })
    ]
    const messageRows = [createMessageRow({ order_seq: 3 })]
    const projectionState = {
      meta: { session_id: 's1', projection_version: 1, max_entry_id: entries.length },
      range: [{ session_id: 's1', message_id: 'a1', order_seq: 3, entry_id: entries.length }]
    }
    const memoryCursorOrderSeq = 3
    const memoryProjectionWrites = createSpies([
      'applyAppendedEntry',
      'replaceSession',
      'invalidateSession'
    ])
    const memoryProjectionTable = {
      ...memoryProjectionWrites,
      readCurrentRange: vi.fn(() => structuredClone(projectionState.range)),
      getSessionMeta: vi.fn(() => structuredClone(projectionState.meta))
    }
    const cursorWrites = createSpies(['updateMemoryCursorOrderSeq', 'rewindMemoryCursorOrderSeq'])
    const sessionTable = {
      ...cursorWrites,
      getSummaryState: vi.fn().mockReturnValue(null),
      getMemoryCursorOrderSeq: vi.fn(() => memoryCursorOrderSeq)
    }
    const messageWrites = createSpies([
      'insert',
      'updateContent',
      'updateStatus',
      'updateContentAndStatus'
    ])
    const messageTable = {
      ...messageWrites,
      get: vi.fn((messageId: string) => messageRows.find((row) => row.id === messageId))
    }
    const traceWrites = createSpies(['insert', 'deleteByMessageId', 'deleteBySessionId'])
    const traceTable = {
      ...traceWrites,
      listByMessageId: vi.fn((messageId: string) =>
        traceRows.filter((row) => row.message_id === messageId)
      )
    }
    const { presenter, memoryPropertyAccess } = trackMemoryPropertyAccess({
      deepchatTapeEntriesTable: table,
      deepchatMessageTracesTable: traceTable,
      deepchatMessagesTable: messageTable,
      deepchatSessionsTable: sessionTable,
      deepchatMemoryIngestionProjectionTable: memoryProjectionTable
    })
    const service = new SessionTape(presenter as any)
    service.appendViewManifest(createObservationManifest({ requestSeq: 1, assembledAt: 210 }))
    service.appendViewManifest(
      createObservationManifest({
        requestSeq: 2,
        taskType: 'tool_loop',
        policy: 'tool_loop_shadow',
        policyVersion: null,
        assembledAt: 310
      })
    )

    for (const write of [
      table.ensureBootstrapAnchor,
      table.append,
      table.appendAnchor,
      table.appendEvent,
      table.deleteBySession
    ]) {
      write.mockClear()
    }
    const captureState = () => ({
      tapeRows: structuredClone(entries),
      maxEntryId: table.getMaxEntryId('s1'),
      entryOrder: entries.map((entry) => entry.entry_id),
      maxMessageOrder: Math.max(0, ...service.getMessageRecords('s1').map((row) => row.orderSeq)),
      messageRows: structuredClone(messageRows),
      traceRows: structuredClone(traceRows),
      viewManifestRows: structuredClone(
        entries.filter((entry) => entry.kind === 'event' && entry.name === 'view/assembled')
      ),
      effectiveView: service.getMessageRecords('s1'),
      replay: service.exportReplaySlice('s1', 'a1', { requestSeq: 2 }),
      replayHash: service.exportReplaySlice('s1', 'a1', { requestSeq: 2 })?.hashes.sliceHash,
      projectionMeta: memoryProjectionTable.getSessionMeta(),
      projectionRange: memoryProjectionTable.readCurrentRange(),
      memoryCursorOrderSeq: sessionTable.getMemoryCursorOrderSeq()
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)

    try {
      const before = captureState()
      const { defaultObservation, repeatedObservation, explicitObservation, traceOnlyObservation } =
        readObservationMatrix(service)
      const after = captureState()

      expect(after).toEqual(before)
      expect(repeatedObservation).toEqual(defaultObservation)
      expect(defaultObservation.request).toMatchObject({
        state: 'manifest_bound',
        requestSeq: 2
      })
      expect(explicitObservation.request).toMatchObject({
        state: 'manifest_bound',
        requestSeq: 1
      })
      expect(traceOnlyObservation.request).toMatchObject({
        state: 'manifest_missing',
        requestSeq: 7,
        trace: { id: 'trace-only' }
      })
      expect(defaultObservation.output).toMatchObject({
        correlation: 'message_only',
        entries: [{ kind: 'message' }, { kind: 'tool_call' }, { kind: 'tool_result' }]
      })
      expect(before.effectiveView.map((record) => record.id)).toEqual(['u1', 'a1'])
      expect(JSON.parse(before.effectiveView[0].content).text).toBe('edited')
      expect(before.effectiveView[1]).toMatchObject({ status: 'sent', content: final.content })
    } finally {
      now.mockRestore()
    }

    for (const write of [
      table.ensureBootstrapAnchor,
      table.append,
      table.appendAnchor,
      table.appendEvent,
      table.deleteBySession,
      ...Object.values(messageWrites),
      ...Object.values(traceWrites),
      ...Object.values(memoryProjectionWrites),
      ...Object.values(cursorWrites),
      memoryPropertyAccess
    ]) {
      expect(write).not.toHaveBeenCalled()
    }
  })

  itIfSqlite(
    `preserves real Tape, message, trace, Memory projection and schema state while observing${sqliteAvailable ? '' : ` (${sqliteSkipReason})`}`,
    () => {
      const db = new DatabaseCtor(':memory:')
      try {
        const memoryProjectionTable = new DeepChatMemoryIngestionProjectionTable(db)
        const tapeTable = new DeepChatTapeEntriesTable(db, memoryProjectionTable)
        const messageTable = new DeepChatMessagesTable(db)
        const traceTable = new DeepChatMessageTracesTable(db)
        const sessionTable = new DeepChatSessionsTable(db)
        memoryProjectionTable.createTable()
        tapeTable.createTable()
        messageTable.createTable()
        traceTable.createTable()
        sessionTable.createTable()
        sessionTable.create('s1', 'openai', 'gpt-4o', 'full_access')
        sessionTable.updateMemoryCursorOrderSeq('s1', 3)

        appendObservationIsolationFacts(tapeTable)
        messageTable.insert({
          id: 'a1',
          sessionId: 's1',
          orderSeq: 3,
          role: 'assistant',
          content: 'projection-only-content-secret',
          status: 'sent',
          metadata: '{"secret":"projection-only-metadata"}',
          createdAt: 200,
          updatedAt: 300
        })
        for (const trace of [
          { id: 'trace-1', messageId: 'a1', requestSeq: 1 },
          { id: 'trace-2', messageId: 'a1', requestSeq: 2 },
          { id: 'trace-only', messageId: 'a-trace', requestSeq: 7 }
        ]) {
          traceTable.insert({
            ...trace,
            sessionId: 's1',
            providerId: 'openai',
            modelId: 'gpt-4o',
            endpoint: 'https://api.openai.test/v1/chat/completions',
            headersJson: `{"authorization":"${trace.id}-header"}`,
            bodyJson: `{"prompt":"${trace.id}-body"}`,
            truncated: false,
            createdAt: 300 + trace.requestSeq
          })
        }

        const service = new SessionTape({
          deepchatTapeEntriesTable: tapeTable,
          deepchatMessagesTable: messageTable,
          deepchatMessageTracesTable: traceTable,
          deepchatSessionsTable: sessionTable,
          deepchatMemoryIngestionProjectionTable: memoryProjectionTable
        } as any)
        service.appendViewManifest(createObservationManifest({ requestSeq: 1, assembledAt: 210 }))
        service.appendViewManifest(
          createObservationManifest({
            requestSeq: 2,
            taskType: 'tool_loop',
            policy: 'tool_loop_shadow',
            policyVersion: null,
            assembledAt: 310
          })
        )
        const effectiveRecords = service.getMessageRecords('s1')
        const sourceMaps = service.getViewManifestSourceMaps('s1')
        memoryProjectionTable.replaceSession(
          's1',
          effectiveRecords
            .filter(
              (record): record is ChatMessageRecord & { status: 'sent' | 'error' } =>
                record.status === 'sent' || record.status === 'error'
            )
            .map((record) => ({
              sessionId: 's1',
              messageId: record.id,
              orderSeq: record.orderSeq,
              entryId: sourceMaps.entryIdByMessageId.get(record.id)!,
              role: record.role,
              content: record.content,
              status: record.status,
              hadToolUse: record.id === 'a1'
            })),
          tapeTable.getMaxEntryId('s1')
        )

        const captureState = () => {
          const tapeRows = tapeTable.getBySession('s1')
          return {
            tapeRows,
            maxEntryId: tapeTable.getMaxEntryId('s1'),
            entryOrder: tapeRows.map((row) => row.entry_id),
            messageRow: messageTable.get('a1'),
            traceRows: db
              .prepare(
                `SELECT *
                 FROM deepchat_message_traces
                 ORDER BY session_id, message_id, request_seq, id`
              )
              .all(),
            viewManifestRows: tapeRows.filter(
              (row) => row.kind === 'event' && row.name === 'view/assembled'
            ),
            effectiveView: service.getMessageRecords('s1'),
            replay: service.exportReplaySlice('s1', 'a1', { requestSeq: 2 }),
            replayHash: service.exportReplaySlice('s1', 'a1', { requestSeq: 2 })?.hashes.sliceHash,
            projectionMeta: memoryProjectionTable.getSessionMeta('s1'),
            projectionRange: memoryProjectionTable.readCurrentRange('s1', 0, 10),
            memoryCursorOrderSeq: sessionTable.getMemoryCursorOrderSeq('s1'),
            schema: db
              .prepare(
                `SELECT type, name, tbl_name, sql
                 FROM sqlite_master
                 WHERE name NOT LIKE 'sqlite_%'
                 ORDER BY type, name, tbl_name`
              )
              .all()
          }
        }
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)

        try {
          const before = captureState()
          readObservationMatrix(service)
          const after = captureState()

          expect(after).toEqual(before)
        } finally {
          now.mockRestore()
        }
      } finally {
        db.close()
      }
    }
  )

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
    const service = new SessionTape({
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
    const service = new SessionTape({
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
    expect(entries.filter((entry) => entry.kind === 'tool_result')).toHaveLength(1)
    const finalToolResult = entries.filter((entry) => entry.kind === 'tool_result').at(-1)!
    expect(JSON.parse(finalToolResult.payload_json).response).toBe('final result')
    expect(service.info('s1').lastTokenUsage).toBe(7)
    expect(service.search('s1', 'pending result', { kinds: ['tool_result'] })).toEqual([])
    expect(service.search('s1', 'final result', { kinds: ['tool_result'] })).toHaveLength(1)
  })

  it('keeps fork writes isolated until merge and discards fork entries on discard', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const fork = service.createFork('s1', 'fork-1')
    service.appendForkMessageRecord(fork, createRecord({ id: 'fu1', sessionId: 'ignored' }))

    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'message/user')
    ).toBe(false)

    const mergedCount = service.mergeFork('s1', 'fork-1')

    expect(mergedCount).toBe(1)
    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'message/user')
    ).toBe(true)
    expect(entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/merge')).toBe(
      true
    )
    expect(entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/start')).toBe(
      false
    )

    const discardFork = service.createFork('s1', 'fork-2')
    service.appendForkMessageRecord(discardFork, createRecord({ id: 'fu2', sessionId: 'ignored' }))
    service.discardFork('s1', 'fork-2')

    expect(entries.some((entry) => entry.session_id === discardFork.forkSessionId)).toBe(false)
    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/discard')
    ).toBe(true)
  })

  it('records exact fork heads and keeps retries bounded to the first merge', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('parent')
    table.appendEvent({ sessionId: 'parent', name: 'parent/tail', data: { value: 1 } })
    const fork = service.createFork('parent', 'bounded')
    table.appendEvent({ sessionId: 'parent', name: 'parent/later', data: { value: 2 } })
    const retriedFork = service.createFork('parent', 'bounded')
    service.appendForkMessageRecord(fork, createRecord({ id: 'first', sessionId: 'ignored' }))

    const forkStart = entries.find(
      (entry) => entry.session_id === fork.forkSessionId && entry.name === 'fork/start'
    )
    expect(fork.parentHeadEntryId).toBe(2)
    expect(retriedFork.parentHeadEntryId).toBe(2)
    expect(JSON.parse(forkStart.payload_json).state.parentHeadEntryId).toBe(2)

    const getBoundedEntries = table.getBySessionUpToEntryId.getMockImplementation()!
    table.getBySessionUpToEntryId.mockImplementationOnce(
      (sessionId: string, maxEntryId: number) => {
        table.appendEvent({
          sessionId: fork.forkSessionId,
          name: 'fork/late-tail',
          data: { value: 2 }
        })
        return getBoundedEntries(sessionId, maxEntryId)
      }
    )

    expect(service.mergeFork('parent', 'bounded')).toBe(1)
    expect(service.mergeFork('parent', 'bounded')).toBe(1)

    const parentEntries = entries.filter((entry) => entry.session_id === 'parent')
    expect(parentEntries.filter((entry) => entry.source_type === 'fork')).toHaveLength(2)
    expect(parentEntries.some((entry) => entry.name === 'fork/late-tail')).toBe(false)
    const receipt = parentEntries.find((entry) => entry.name === 'fork/merge')!
    expect(JSON.parse(receipt.payload_json).data).toMatchObject({
      forkHeadEntryId: 3,
      mergedCount: 1
    })
  })

  it('rolls back mocked fork merge writes when a copied entry fails', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const fork = service.createFork('parent', 'mock-atomic')
    service.appendForkMessageRecord(
      fork,
      createRecord({ id: 'first', orderSeq: 1, sessionId: 'ignored' })
    )
    service.appendForkMessageRecord(
      fork,
      createRecord({ id: 'second', orderSeq: 2, sessionId: 'ignored' })
    )

    const append = table.append.getMockImplementation()!
    let copiedEntryCount = 0
    table.append.mockImplementation((input: any) => {
      if (input.sessionId === 'parent' && input.source?.type === 'fork') {
        copiedEntryCount += 1
        if (copiedEntryCount === 2) {
          throw new Error('injected merge failure')
        }
      }
      return append(input)
    })

    expect(() => service.mergeFork('parent', 'mock-atomic')).toThrow('injected merge failure')
    expect(
      entries.filter(
        (entry) =>
          entry.session_id === 'parent' &&
          (entry.source_type === 'fork' || entry.name === 'fork/merge')
      )
    ).toEqual([])
  })

  it('rolls back copied fork entries when the merge receipt fails', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const fork = service.createFork('parent', 'receipt-failure')
    service.appendForkMessageRecord(fork, createRecord({ id: 'first', sessionId: 'ignored' }))

    const appendEvent = table.appendEvent.getMockImplementation()!
    table.appendEvent.mockImplementation((input: any) => {
      if (input.sessionId === 'parent' && input.name === 'fork/merge') {
        throw new Error('injected receipt failure')
      }
      return appendEvent(input)
    })

    expect(() => service.mergeFork('parent', 'receipt-failure')).toThrow('injected receipt failure')
    expect(
      entries.filter(
        (entry) =>
          entry.session_id === 'parent' &&
          (entry.source_type === 'fork' || entry.name === 'fork/merge')
      )
    ).toEqual([])
  })

  it('commits one idempotent receipt for an empty fork', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    service.createFork('parent', 'empty')

    expect(service.mergeFork('parent', 'empty')).toBe(0)
    expect(service.mergeFork('parent', 'empty')).toBe(0)
    const parentEntries = entries.filter((entry) => entry.session_id === 'parent')
    expect(parentEntries).toHaveLength(1)
    expect(parentEntries[0].name).toBe('fork/merge')
    expect(JSON.parse(parentEntries[0].payload_json).data).toMatchObject({
      forkHeadEntryId: 2,
      mergedCount: 0
    })
  })

  it('rejects missing and discarded forks without committing an empty merge receipt', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    expect(() => service.mergeFork('parent', 'missing')).toThrow(
      'Fork missing does not exist or has been discarded.'
    )

    service.createFork('parent', 'discarded')
    service.discardFork('parent', 'discarded')
    expect(() => service.mergeFork('parent', 'discarded')).toThrow(
      'Fork discarded does not exist or has been discarded.'
    )
    expect(
      entries.filter((entry) => entry.session_id === 'parent' && entry.name === 'fork/merge')
    ).toEqual([])
  })

  it('returns an existing merge receipt after the merged fork Tape is cleaned up', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const fork = service.createFork('parent', 'cleanup-after-merge')
    service.appendForkMessageRecord(fork, createRecord({ id: 'merged', sessionId: 'ignored' }))

    expect(service.mergeFork('parent', 'cleanup-after-merge')).toBe(1)
    table.deleteBySession(fork.forkSessionId)
    expect(service.mergeFork('parent', 'cleanup-after-merge')).toBe(1)
  })

  it('merges a legacy fork start that predates the parent head field', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    const fork = service.createFork('parent', 'legacy-start')
    const start = entries.find(
      (entry) => entry.session_id === fork.forkSessionId && entry.name === 'fork/start'
    )!
    const payload = JSON.parse(start.payload_json)
    delete payload.state.parentHeadEntryId
    start.payload_json = JSON.stringify(payload)
    service.appendForkMessageRecord(fork, createRecord({ id: 'legacy', sessionId: 'ignored' }))

    expect(service.mergeFork('parent', 'legacy-start')).toBe(1)
  })

  it('accepts a valid legacy fork merge receipt without a frozen head', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/merge',
      source: { type: 'fork', id: 'legacy-receipt', seq: 0 },
      provenanceKey: 'fork:parent:legacy-receipt:merge:event',
      data: {
        forkId: 'legacy-receipt',
        forkSessionId: 'parent::fork::legacy-receipt',
        mergedCount: 2
      }
    })

    expect(service.mergeFork('parent', 'legacy-receipt')).toBe(2)
  })

  it('rejects a malformed stored fork merge receipt instead of reporting an empty merge', () => {
    const { table } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/merge',
      source: { type: 'fork', id: 'malformed-receipt', seq: 0 },
      provenanceKey: 'fork:parent:malformed-receipt:merge:event',
      data: {
        forkId: 'malformed-receipt',
        forkSessionId: 'parent::fork::malformed-receipt',
        mergedCount: 'two'
      }
    })

    expect(() => service.mergeFork('parent', 'malformed-receipt')).toThrow(
      'Stored fork merge receipt is malformed'
    )
  })

  itIfSqlite('rolls back copied fork entries and the receipt when merge fails', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatTapeEntriesTable(db)
    table.createTable()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('parent')
    const fork = service.createFork('parent', 'atomic')
    service.appendForkMessageRecord(
      fork,
      createRecord({ id: 'first', orderSeq: 1, sessionId: 'ignored' })
    )
    service.appendForkMessageRecord(
      fork,
      createRecord({ id: 'second', orderSeq: 2, sessionId: 'ignored' })
    )

    const append = table.append.bind(table)
    let copiedEntryCount = 0
    const appendSpy = vi.spyOn(table, 'append').mockImplementation((input) => {
      if (input.sessionId === 'parent' && input.source?.type === 'fork') {
        copiedEntryCount += 1
        if (copiedEntryCount === 2) {
          throw new Error('injected merge failure')
        }
      }
      return append(input)
    })

    expect(() => service.mergeFork('parent', 'atomic')).toThrow('injected merge failure')
    expect(
      table
        .getBySession('parent')
        .filter((entry) => entry.source_type === 'fork' || entry.name === 'fork/merge')
    ).toEqual([])

    appendSpy.mockRestore()
    expect(service.mergeFork('parent', 'atomic')).toBe(2)
    expect(service.mergeFork('parent', 'atomic')).toBe(2)
    expect(
      table.getBySession('parent').filter((entry) => entry.source_type === 'fork')
    ).toHaveLength(3)

    db.close()
  })

  itIfSqlite('rejects missing and discarded forks in SQLite', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      table.createTable()
      const service = new SessionTape({
        deepchatTapeEntriesTable: table,
        deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
      } as any)

      expect(() => service.mergeFork('parent', 'missing-native')).toThrow(
        'Fork missing-native does not exist or has been discarded.'
      )
      service.createFork('parent', 'discarded-native')
      service.discardFork('parent', 'discarded-native')
      expect(() => service.mergeFork('parent', 'discarded-native')).toThrow(
        'Fork discarded-native does not exist or has been discarded.'
      )
      expect(table.getBySession('parent').some((entry) => entry.name === 'fork/merge')).toBe(false)
    } finally {
      db.close()
    }
  })

  it('cleans fork search projection on discard without blocking the discard event', () => {
    const { table, entries } = createTapeTableMock()
    const projectionTable = {
      deleteBySession: vi.fn(() => {
        throw new Error('projection cleanup failed')
      })
    }
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatTapeSearchProjectionTable: projectionTable,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    const fork = service.createFork('s1', 'fork-cleanup')
    service.appendForkMessageRecord(fork, createRecord({ id: 'fu-cleanup', sessionId: 'ignored' }))
    service.discardFork('s1', 'fork-cleanup')

    expect(table.deleteBySession).toHaveBeenCalledWith(fork.forkSessionId)
    expect(projectionTable.deleteBySession).toHaveBeenCalledWith(fork.forkSessionId)
    expect(entries.some((entry) => entry.session_id === fork.forkSessionId)).toBe(false)
    expect(
      entries.some((entry) => entry.session_id === 's1' && entry.name === 'fork/discard')
    ).toBe(true)
  })

  it('links a frozen subagent Tape without copying child entries and retries idempotently', () => {
    const { table, entries } = createTapeTableMock()
    const service = new SessionTape({
      deepchatTapeEntriesTable: table,
      deepchatSessionsTable: { getSummaryState: vi.fn().mockReturnValue(null) }
    } as any)

    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({ sessionId: 'child', name: 'child/result', data: { text: 'done' } })
    const input = {
      parentSessionId: 'parent',
      childSessionId: 'child',
      runId: 'run-1',
      taskId: 'task-1',
      slotId: 'reviewer',
      taskTitle: 'Review',
      outcome: 'completed' as const,
      resultSummary: 'Done'
    }
    const first = service.linkSubagentTape(input)
    table.appendEvent({ sessionId: 'child', name: 'child/late', data: { text: 'late' } })
    const retry = service.linkSubagentTape(input)
    const normalizedRetry = service.linkSubagentTape({
      ...input,
      slotId: ' reviewer ',
      taskTitle: '  Review  ',
      resultSummary: '  Done  '
    })

    expect(first).toEqual({
      linkEntry: { sessionId: 'parent', entryId: 2 },
      childSessionId: 'child',
      childHeadEntryId: 2,
      childEntryCount: 2,
      outcome: 'completed'
    })
    expect(retry).toEqual(first)
    expect(normalizedRetry).toEqual(first)
    const links = entries.filter(
      (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
    )
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      source_type: 'subagent',
      source_id: 'child',
      source_seq: 2
    })
    expect(JSON.parse(links[0].payload_json).data).toMatchObject({
      linkVersion: 2,
      childTapeIdentity: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    expect(
      entries.some((entry) => entry.session_id === 'parent' && entry.name === 'child/result')
    ).toBe(false)
    expect(() => service.linkSubagentTape({ ...input, outcome: 'error' })).toThrow(
      'Subagent Tape link conflicts with finalized task run-1/task-1.'
    )
    expect(() => service.linkSubagentTape({ ...input, slotId: 'writer' })).toThrow(
      'Subagent Tape link conflicts with finalized task run-1/task-1.'
    )
    expect(() => service.linkSubagentTape({ ...input, taskTitle: 'Write' })).toThrow(
      'Subagent Tape link conflicts with finalized task run-1/task-1.'
    )
    expect(() => service.linkSubagentTape({ ...input, resultSummary: 'Changed' })).toThrow(
      'Subagent Tape link conflicts with finalized task run-1/task-1.'
    )

    table.ensureBootstrapAnchor('child-2')
    expect(
      service.linkSubagentTape({
        ...input,
        childSessionId: 'child-2',
        outcome: 'error'
      })
    ).toMatchObject({
      childSessionId: 'child-2',
      outcome: 'error'
    })
    expect(
      entries.filter(
        (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
      )
    ).toHaveLength(2)
  })

  it('rejects a stored subagent link whose task identity no longer matches its provenance', () => {
    const { table, entries } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    const input = createSubagentLinkInput('parent', 'child')
    service.linkSubagentTape(input)

    const link = entries.find(
      (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
    )
    if (!link) {
      throw new Error('Expected subagent Tape link fixture.')
    }
    const payload = JSON.parse(link.payload_json) as {
      data?: Record<string, unknown>
    }
    link.payload_json = JSON.stringify({
      ...payload,
      data: { ...payload.data, runId: 'different-run' }
    })

    expect(() => service.linkSubagentTape(input)).toThrow(
      /Stored subagent Tape link receipt is malformed/
    )
    expect(() => service.getContext('parent', [1], { sourceSessionId: 'child' })).toThrowError(
      /not an authorized direct child/
    )
  })

  it('keeps a version-one link readable while its original unmarked Tape remains present', () => {
    const { table, entries } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/result',
      data: { text: 'version one compatibility marker' }
    })
    const input = createSubagentLinkInput('parent', 'child')
    const receipt = service.linkSubagentTape(input)
    const link = entries.find(
      (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
    )!
    const payload = JSON.parse(link.payload_json)
    payload.data.linkVersion = 1
    delete payload.data.childTapeIdentity
    link.payload_json = JSON.stringify(payload)
    entries.find((entry) => entry.session_id === 'child' && entry.entry_id === 1)!.meta_json = '{}'

    expect(service.linkSubagentTape(input)).toEqual(receipt)
    expect(
      service.search('parent', 'version one compatibility marker', {
        scope: 'linked_subagents'
      })
    ).toMatchObject([{ sessionId: 'child', entryId: 2 }])
  })

  it('fails closed when a version-one link points at malformed incarnation metadata', () => {
    const { table, entries } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/result',
      data: { text: 'malformed incarnation metadata marker' }
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    const link = entries.find(
      (entry) => entry.session_id === 'parent' && entry.name === 'subagent/tape_linked'
    )!
    const payload = JSON.parse(link.payload_json)
    payload.data.linkVersion = 1
    delete payload.data.childTapeIdentity
    link.payload_json = JSON.stringify(payload)
    entries.find((entry) => entry.session_id === 'child' && entry.entry_id === 1)!.meta_json = '{'

    expect(() =>
      service.search('parent', 'malformed incarnation metadata marker', {
        scope: 'linked_subagents'
      })
    ).toThrowError(/Linked Tape child is unavailable/)
  })

  it('searches direct linked children at frozen heads with one global limit', () => {
    const { table } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child-a', session_kind: 'subagent', parent_session_id: 'parent' },
      { id: 'child-b', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child-a')
    table.ensureBootstrapAnchor('child-b')
    table.appendEvent({
      sessionId: 'parent',
      name: 'parent/note',
      data: { text: 'shared needle from parent' },
      createdAt: 150
    })
    table.appendEvent({
      sessionId: 'child-a',
      name: 'child/result',
      data: { text: 'shared needle from A' },
      createdAt: 100
    })
    table.appendEvent({
      sessionId: 'child-b',
      name: 'child/result',
      data: { text: 'shared needle from B' },
      createdAt: 200
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child-a'))
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child-b'))
    table.appendEvent({
      sessionId: 'child-a',
      name: 'child/late',
      data: { text: 'shared needle after cutoff' },
      createdAt: 300
    })

    table.ensureBootstrapAnchor.mockClear()
    table.append.mockClear()
    const limited = service.search('parent', 'shared needle', {
      scope: 'linked_subagents',
      limit: 1
    })
    const all = service.search('parent', 'shared needle', {
      scope: 'linked_subagents',
      limit: 10
    })
    const combined = service.search('parent', 'shared needle', {
      scope: 'current_and_linked',
      limit: 10
    })

    expect(limited).toMatchObject([{ sessionId: 'child-b', entryId: 2 }])
    expect(all.map((result) => [result.sessionId, result.entryId])).toEqual([
      ['child-b', 2],
      ['child-a', 2]
    ])
    expect(combined.map((result) => [result.sessionId, result.entryId])).toEqual([
      ['child-b', 2],
      ['parent', 2],
      ['child-a', 2]
    ])
    expect(table.searchEffectiveSourcesAtHeads).toHaveBeenCalledWith(
      [
        { sessionId: 'child-a', maxEntryId: 2 },
        { sessionId: 'child-b', maxEntryId: 2 }
      ],
      'shared needle',
      expect.objectContaining({ limit: 1 })
    )
    expect(table.ensureBootstrapAnchor).not.toHaveBeenCalled()
    expect(table.append).not.toHaveBeenCalled()
  })

  it('falls back all linked sources together when projection coverage is partial', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      searchSourcesReadOnly: vi.fn(() => ({
        coveredSources: [{ sessionId: 'child-a', maxEntryId: 2 }],
        rows: [
          {
            session_id: 'child-a',
            entry_id: 2,
            kind: 'event',
            name: 'child/result',
            source_type: null,
            source_id: null,
            source_seq: null,
            search_text: 'shared partial needle',
            summary_text: 'shared partial needle from A',
            refs_json: '{}',
            created_at: 100,
            score: -100
          }
        ]
      }))
    }
    const { service } = createLinkedTapeService(
      table,
      [
        { id: 'parent', session_kind: 'regular', parent_session_id: null },
        { id: 'child-a', session_kind: 'subagent', parent_session_id: 'parent' },
        { id: 'child-b', session_kind: 'subagent', parent_session_id: 'parent' }
      ],
      projectionTable
    )
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child-a')
    table.ensureBootstrapAnchor('child-b')
    table.appendEvent({
      sessionId: 'child-a',
      name: 'child/result',
      data: { text: 'shared partial needle from A' },
      createdAt: 100
    })
    table.appendEvent({
      sessionId: 'child-b',
      name: 'child/result',
      data: { text: 'shared partial needle from B' },
      createdAt: 200
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child-a'))
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child-b'))
    table.searchEffectiveSourcesAtHeads.mockClear()

    const hits = service.search('parent', 'shared partial needle', {
      scope: 'linked_subagents',
      limit: 1
    })

    expect(hits).toMatchObject([{ sessionId: 'child-b', entryId: 2 }])
    expect(table.searchEffectiveSourcesAtHeads).toHaveBeenCalledWith(
      [
        { sessionId: 'child-a', maxEntryId: 2 },
        { sessionId: 'child-b', maxEntryId: 2 }
      ],
      'shared partial needle',
      expect.objectContaining({ limit: 1 })
    )
  })

  it('uses an exact frozen projection read-only after the child appends a late tail', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      searchSourcesReadOnly: vi.fn((sources: any[]) => ({
        coveredSources: sources,
        rows: [
          {
            session_id: 'child',
            entry_id: 2,
            kind: 'event',
            name: 'child/result',
            source_type: null,
            source_id: null,
            source_seq: null,
            search_text: 'frozen projection needle',
            summary_text: 'frozen projection needle',
            refs_json: '{}',
            created_at: 100,
            score: -1
          }
        ]
      })),
      replaceSession: vi.fn(),
      appendSession: vi.fn(),
      getByEntryIds: vi.fn().mockReturnValue([])
    }
    const { service } = createLinkedTapeService(
      table,
      [
        { id: 'parent', session_kind: 'regular', parent_session_id: null },
        { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
      ],
      projectionTable
    )
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/result',
      data: { text: 'frozen projection needle' },
      createdAt: 100
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    table.appendEvent({
      sessionId: 'child',
      name: 'child/late',
      data: { text: 'frozen projection needle late' },
      createdAt: 200
    })
    table.searchEffectiveSourcesAtHeads.mockClear()

    const hits = service.search('parent', 'frozen projection needle', {
      scope: 'linked_subagents'
    })

    expect(projectionTable.searchSourcesReadOnly).toHaveBeenCalledWith(
      [{ sessionId: 'child', maxEntryId: 2 }],
      'frozen projection needle',
      expect.any(Object)
    )
    expect(hits).toMatchObject([{ sessionId: 'child', entryId: 2 }])
    expect(table.searchEffectiveSourcesAtHeads).not.toHaveBeenCalled()
    expect(projectionTable.replaceSession).not.toHaveBeenCalled()
    expect(projectionTable.appendSession).not.toHaveBeenCalled()
  })

  it('deduplicates repeated child links at the newest finalized snapshot', () => {
    const { table } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/first',
      data: { text: 'first snapshot marker' }
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    table.appendEvent({
      sessionId: 'child',
      name: 'child/second',
      data: { text: 'second snapshot marker' }
    })
    service.linkSubagentTape({
      ...createSubagentLinkInput('parent', 'child'),
      runId: 'run-child-second',
      taskId: 'task-child-second'
    })

    expect(
      service.search('parent', 'second snapshot marker', { scope: 'linked_subagents' })
    ).toMatchObject([{ sessionId: 'child', entryId: 3 }])
    expect(table.searchEffectiveSourcesAtHeads).toHaveBeenCalledWith(
      [{ sessionId: 'child', maxEntryId: 3 }],
      'second snapshot marker',
      expect.any(Object)
    )
  })

  it('expands linked context within one source and never crosses the frozen head', () => {
    const { table } = createTapeTableMock()
    const projectionTable = {
      getByEntryIds: vi.fn(() => [
        {
          session_id: 'child',
          entry_id: 2,
          kind: 'event',
          name: 'child/target',
          source_type: null,
          source_id: null,
          source_seq: null,
          search_text: 'stale projection text',
          summary_text: 'stale projection summary',
          refs_json: '{"stale":true}',
          created_at: 100
        }
      ])
    }
    const { service } = createLinkedTapeService(
      table,
      [
        { id: 'parent', session_kind: 'regular', parent_session_id: null },
        { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
      ],
      projectionTable
    )
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/target',
      data: { text: 'target evidence' },
      createdAt: 100
    })
    table.appendEvent({
      sessionId: 'child',
      name: 'child/neighbor',
      data: { text: 'neighbor evidence' },
      createdAt: 110
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    table.appendEvent({
      sessionId: 'child',
      name: 'child/late',
      data: { text: 'late evidence' },
      createdAt: 120
    })
    table.append.mockClear()

    const context = service.getContext('parent', [2], {
      sourceSessionId: 'child',
      before: 0,
      after: 5
    })

    expect(context).toMatchObject({
      sessionId: 'parent',
      sourceSessionId: 'child',
      requestedEntryIds: [2],
      matchedEntryIds: [2]
    })
    expect(context.entries.map((entry) => entry.entryId)).toEqual([2, 3])
    expect(context.entries[0].summary).toContain('target evidence')
    expect(context.entries[0].summary).not.toContain('stale projection')
    expect(table.getEffectiveContextRowsAtHead).toHaveBeenCalledWith(
      { sessionId: 'child', maxEntryId: 3 },
      [2],
      expect.objectContaining({ before: 0, after: 5 })
    )
    expect(projectionTable.getByEntryIds).not.toHaveBeenCalled()
    expect(table.append).not.toHaveBeenCalled()
  })

  it('rejects sibling and unlinked source ids even when a forged link event exists', () => {
    const { table } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'other-parent', session_kind: 'regular', parent_session_id: null },
      { id: 'sibling', session_kind: 'subagent', parent_session_id: 'other-parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('sibling')
    service.linkSubagentTape(createSubagentLinkInput('parent', 'sibling'))

    let error: unknown
    try {
      service.getContext('parent', [1], { sourceSessionId: 'sibling' })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({
      code: 'linked_tape_unauthorized',
      parentSessionId: 'parent',
      sourceSessionId: 'sibling'
    })
  })

  it('reports a finalized linked Tape as unavailable after its durable session is deleted', () => {
    const { table } = createTapeTableMock()
    const { service, sessionById } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))
    sessionById.delete('child')

    let error: unknown
    try {
      service.search('parent', 'anything', { scope: 'linked_subagents' })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({
      code: 'linked_tape_unavailable',
      parentSessionId: 'parent',
      sourceSessionId: 'child'
    })
  })

  it('rejects a rebuilt child Tape until a new incarnation is explicitly linked', () => {
    const { table } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/original',
      data: { text: 'original incarnation marker' }
    })
    service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))

    table.deleteBySession('child')
    table.ensureBootstrapAnchor('child')
    table.appendEvent({
      sessionId: 'child',
      name: 'child/rebuilt',
      data: { text: 'rebuilt incarnation marker' }
    })
    expect(
      service.search('child', 'rebuilt incarnation marker', { scope: 'current' })
    ).toHaveLength(1)
    expect(() =>
      service.search('parent', 'rebuilt incarnation marker', { scope: 'linked_subagents' })
    ).toThrowError(/Linked Tape child is unavailable/)

    service.linkSubagentTape({
      ...createSubagentLinkInput('parent', 'child'),
      runId: 'run-rebuilt-child',
      taskId: 'task-rebuilt-child'
    })
    expect(
      service.search('parent', 'rebuilt incarnation marker', { scope: 'linked_subagents' })
    ).toMatchObject([{ sessionId: 'child', entryId: 2 }])
  })

  itIfSqlite('detects linked Tape replacement after entry ids are reused in SQLite', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatTapeEntriesTable(db)
      table.createTable()
      const { service } = createLinkedTapeService(table, [
        { id: 'parent', session_kind: 'regular', parent_session_id: null },
        { id: 'child', session_kind: 'subagent', parent_session_id: 'parent' }
      ])
      table.ensureBootstrapAnchor('parent')
      table.ensureBootstrapAnchor('child')
      table.appendEvent({
        sessionId: 'child',
        name: 'child/original',
        data: { text: 'native original incarnation' }
      })
      service.linkSubagentTape(createSubagentLinkInput('parent', 'child'))

      table.deleteBySession('child')
      table.ensureBootstrapAnchor('child')
      table.appendEvent({
        sessionId: 'child',
        name: 'child/rebuilt',
        data: { text: 'native rebuilt incarnation' }
      })

      expect(() =>
        service.search('parent', 'native rebuilt incarnation', { scope: 'linked_subagents' })
      ).toThrowError(/Linked Tape child is unavailable/)
    } finally {
      db.close()
    }
  })

  it('reads legacy external merge links and keeps legacy discard audit-only', () => {
    const { table, entries } = createTapeTableMock()
    const { service } = createLinkedTapeService(table, [
      { id: 'parent', session_kind: 'regular', parent_session_id: null },
      { id: 'legacy-child', session_kind: 'subagent', parent_session_id: 'parent' },
      { id: 'malformed-child', session_kind: 'subagent', parent_session_id: 'parent' },
      { id: 'discarded-child', session_kind: 'subagent', parent_session_id: 'parent' }
    ])
    table.ensureBootstrapAnchor('parent')
    table.ensureBootstrapAnchor('legacy-child')
    table.ensureBootstrapAnchor('malformed-child')
    table.ensureBootstrapAnchor('discarded-child')
    const legacyBootstrap = entries.find(
      (entry) => entry.session_id === 'legacy-child' && entry.entry_id === 1
    )!
    legacyBootstrap.meta_json = '{}'
    table.appendEvent({
      sessionId: 'legacy-child',
      name: 'child/result',
      data: { text: 'legacy link needle' }
    })
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/merge',
      source: { type: 'fork', id: 'legacy-child', seq: 0 },
      provenanceKey: 'fork:parent:legacy-child:external-merge:event',
      data: {
        forkId: 'legacy-child',
        forkSessionId: 'legacy-child',
        referencedEntryCount: 2,
        status: 'completed'
      }
    })
    table.appendEvent({
      sessionId: 'malformed-child',
      name: 'child/result',
      data: { text: 'malformed legacy link needle' }
    })
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/merge',
      source: { type: 'fork', id: 'malformed-child', seq: 1 },
      provenanceKey: 'fork:parent:malformed-child:external-merge:event',
      data: {
        forkId: 'malformed-child',
        forkSessionId: 'malformed-child',
        referencedEntryCount: 2,
        status: 'completed'
      }
    })
    table.appendEvent({
      sessionId: 'parent',
      name: 'fork/discard',
      source: { type: 'fork', id: 'discarded-child', seq: 0 },
      provenanceKey: 'fork:parent:discarded-child:external-discard:event',
      data: {
        forkId: 'discarded-child',
        forkSessionId: 'discarded-child',
        status: 'cancelled'
      }
    })

    expect(
      service.search('parent', 'legacy link needle', { scope: 'linked_subagents' })
    ).toMatchObject([{ sessionId: 'legacy-child', entryId: 2 }])
    expect(
      service.search('parent', 'malformed legacy link needle', { scope: 'linked_subagents' })
    ).toEqual([])
    let error: unknown
    try {
      service.getContext('parent', [1], { sourceSessionId: 'discarded-child' })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'linked_tape_unauthorized' })
  })

  it('uses effective message facts after replacement and retraction events', () => {
    const { table, entries } = createTapeTableMock()
    const original = createRecord({ id: 'u1', orderSeq: 1 })
    const messageStore = {
      getMessages: vi.fn().mockReturnValue([original])
    }
    const service = new SessionTape({
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
