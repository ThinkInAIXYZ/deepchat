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
import { DeepChatExecutionJournalStore } from '@/tape/infrastructure/sqlite/tapeEntryStore'
import { EXECUTION_JOURNAL_EVENT_NAMES } from '@/tape/domain/executionJournal'
import { SqliteTapeLifecycleAdapter } from '@/tape/infrastructure/sqlite/tapeLifecycleAdapter'
import type { TapeTransactionRunner } from '@/tape/ports/storage'
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
  let inTransaction = false
  const parseJsonRecord = (value: string): Record<string, any> => {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  const providerOperationKeys = (sessionId: string, runId: string): string[] =>
    entries.flatMap((entry) => {
      if (
        entry.session_id !== sessionId ||
        entry.kind !== 'event' ||
        entry.name !== 'execution/dispatch_committed'
      ) {
        return []
      }
      const data = parseJsonRecord(entry.payload_json).data ?? {}
      if (
        entry.source_id !== runId &&
        !(data.protocolVersion === 1 && data.operation?.runId === runId)
      ) {
        return []
      }
      const match = /^execution:v1:operation:([0-9a-f]{64}):dispatch$/.exec(
        entry.provenance_key ?? ''
      )
      return match ? [match[1]] : []
    })
  const runInTransaction: TapeTransactionRunner['runInTransaction'] = <T>(
    operation: () => T
  ): T => {
    const snapshot = entries.map((entry) => ({ ...entry }))
    const previousTransactionState = inTransaction
    inTransaction = true
    try {
      return operation()
    } catch (error) {
      entries.splice(0, entries.length, ...snapshot)
      throw error
    } finally {
      inTransaction = previousTransactionState
    }
  }
  const runInTransactionMock = vi.fn((operation: () => unknown) =>
    runInTransaction(operation)
  ) as ReturnType<typeof vi.fn> & TapeTransactionRunner['runInTransaction']
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
        meta: {
          tapeIncarnationId: `00000000-0000-4000-8000-${String(++tapeIncarnationSequence).padStart(
            12,
            '0'
          )}`
        },
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
      const existing =
        input.idempotent && provenanceKey
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
    appendSkillMaterialization: vi.fn((input: any) =>
      table.append({
        sessionId: input.sessionId,
        kind: 'context',
        name: 'skill/materialized',
        source: { type: 'runtime_event', id: input.sourceId, seq: 0 },
        provenanceKey: input.provenanceKey,
        payload: input.payload,
        meta: { payloadHash: input.payloadHash },
        idempotent: true
      })
    ),
    appendExecutionJournalEvent: vi.fn((input: any) =>
      table.append({
        ...input,
        kind: 'event',
        payload: { name: input.name, data: input.data }
      })
    ),
    appendToolSurfaceEvent: vi.fn((input: any) =>
      table.append({
        ...input,
        kind: 'event',
        payload: { name: input.name, data: input.data }
      })
    ),
    listUnterminatedRunEvents: vi.fn(() => {
      const unterminatedRuns = entries
        .filter(
          (entry) =>
            entry.kind === 'event' &&
            entry.name === 'execution/run_started' &&
            entry.source_type === 'runtime_event' &&
            entry.source_id !== null &&
            !entries.some(
              (terminal) =>
                terminal.kind === 'event' &&
                terminal.name === 'execution/run_terminal' &&
                terminal.source_type === 'runtime_event' &&
                terminal.source_seq === 0 &&
                terminal.session_id === entry.session_id &&
                terminal.source_id === entry.source_id &&
                terminal.entry_id > entry.entry_id
            )
        )
        .map((entry) => ({ sessionId: entry.session_id, runId: entry.source_id! }))
      return unterminatedRuns.flatMap((run) =>
        entries.flatMap((entry) => {
          if (entry.session_id !== run.sessionId) return []
          const data = parseJsonRecord(entry.payload_json).data ?? {}
          const matchesSource =
            entry.kind === 'event' &&
            entry.source_type === 'runtime_event' &&
            entry.source_id === run.runId &&
            EXECUTION_JOURNAL_EVENT_NAMES.some((name) => entry.name === name)
          const matchesPayload =
            entry.kind === 'event' &&
            (entry.name === 'execution/dispatch_committed' ||
              entry.name === 'execution/tool_outcome') &&
            data.protocolVersion === 2 &&
            data.operation?.runId === run.runId
          const matchesParent = providerOperationKeys(run.sessionId, run.runId).some(
            (operationKey) =>
              entry.provenance_key?.startsWith(`execution:v2:parent:${operationKey}:`)
          )
          return matchesSource || matchesPayload || matchesParent
            ? [{ ...entry, recovery_run_id: run.runId }]
            : []
        })
      )
    }),
    listNestedOperationEventsForMessage: vi.fn(
      (sessionId: string, messageId: string, maximumOperations: number) => {
        const matching = entries.filter((entry) => {
          if (
            entry.session_id !== sessionId ||
            entry.kind !== 'event' ||
            (entry.name !== 'execution/dispatch_committed' &&
              entry.name !== 'execution/tool_outcome')
          ) {
            return false
          }
          const data = parseJsonRecord(entry.payload_json).data ?? {}
          return data.protocolVersion === 2 && data.messageId === messageId
        })
        const selected = new Set<string>()
        for (const entry of matching) {
          const operation = parseJsonRecord(entry.payload_json).data?.operation ?? {}
          selected.add(JSON.stringify(operation))
          if (selected.size >= maximumOperations) break
        }
        return matching.filter((entry) => {
          const operation = parseJsonRecord(entry.payload_json).data?.operation ?? {}
          return selected.has(JSON.stringify(operation))
        })
      }
    ),
    listMessageIdsWithNestedOperationEvents: vi.fn(
      (sessionId: string, messageIds: readonly string[]) => {
        const requested = new Set(messageIds)
        return [
          ...new Set(
            entries.flatMap((entry) => {
              if (
                entry.session_id !== sessionId ||
                entry.kind !== 'event' ||
                (entry.name !== 'execution/dispatch_committed' &&
                  entry.name !== 'execution/tool_outcome')
              ) {
                return []
              }
              const data = parseJsonRecord(entry.payload_json).data ?? {}
              return data.protocolVersion === 2 && requested.has(data.messageId)
                ? [data.messageId]
                : []
            })
          )
        ]
      }
    ),
    listNestedOperationEventsForRun: vi.fn((sessionId: string, runId: string) =>
      entries.filter((entry) => {
        if (
          entry.session_id !== sessionId ||
          entry.kind !== 'event' ||
          (entry.name !== 'execution/dispatch_committed' && entry.name !== 'execution/tool_outcome')
        ) {
          return false
        }
        const payload = parseJsonRecord(entry.payload_json)
        const meta = parseJsonRecord(entry.meta_json)
        const data = payload.data ?? {}
        const operation = data.operation ?? {}
        return (
          (data.protocolVersion === 2 && operation.runId === runId) ||
          (entry.source_id === runId &&
            (entry.provenance_key?.startsWith('execution:v2:') ||
              meta.protocolVersion === 2 ||
              data.protocolVersion === 2 ||
              operation.kind === 'nested')) ||
          providerOperationKeys(sessionId, runId).some((operationKey) =>
            entry.provenance_key?.startsWith(`execution:v2:parent:${operationKey}:`)
          )
        )
      })
    ),
    listNestedOperationEventsForParent: vi.fn(
      (
        sessionId: string,
        runId: string,
        requestSeq: number,
        providerToolCallId: string,
        parentOperationKey: string
      ) => {
        const parentPrefix = `execution:v2:parent:${parentOperationKey}:`
        return entries.filter((entry) => {
          if (entry.session_id !== sessionId) return false
          if (entry.provenance_key?.startsWith(parentPrefix)) return true
          if (
            entry.kind !== 'event' ||
            (entry.name !== 'execution/dispatch_committed' &&
              entry.name !== 'execution/tool_outcome')
          ) {
            return false
          }
          const data = parseJsonRecord(entry.payload_json).data ?? {}
          const meta = parseJsonRecord(entry.meta_json)
          const operation = data.operation ?? {}
          return (
            (data.protocolVersion === 2 &&
              operation.runId === runId &&
              operation.requestSeq === requestSeq &&
              operation.providerToolCallId === providerToolCallId) ||
            (entry.source_type === 'runtime_event' &&
              entry.source_id === runId &&
              entry.source_seq === requestSeq &&
              (entry.provenance_key?.startsWith('execution:v2:') ||
                meta.protocolVersion === 2 ||
                data.protocolVersion === 2 ||
                operation.kind === 'nested'))
          )
        })
      }
    ),
    runInTransaction: runInTransactionMock,
    isInTransaction: vi.fn(() => inTransaction),
    getBySession: vi.fn((sessionId: string) =>
      entries.filter((entry) => entry.session_id === sessionId)
    ),
    getByEntryId: vi.fn((sessionId: string, entryId: number) =>
      entries.find((entry) => entry.session_id === sessionId && entry.entry_id === entryId)
    ),
    getEventsBySource: vi.fn(
      (sessionId: string, name: string, sourceType: string, sourceId: string, sourceSeq: number) =>
        entries.filter(
          (entry) =>
            entry.session_id === sessionId &&
            entry.kind === 'event' &&
            entry.name === name &&
            entry.source_type === sourceType &&
            entry.source_id === sourceId &&
            entry.source_seq === sourceSeq
        )
    ),
    getEventsBySourceId: vi.fn(
      (sessionId: string, name: string, sourceType: string, sourceId: string) =>
        entries.filter(
          (entry) =>
            entry.session_id === sessionId &&
            entry.kind === 'event' &&
            entry.name === name &&
            entry.source_type === sourceType &&
            entry.source_id === sourceId
        )
    ),
    getBySessionExcludingContext: vi.fn((sessionId: string) =>
      entries.filter((entry) => entry.session_id === sessionId && entry.kind !== 'context')
    ),
    getByEntryIds: vi.fn((sessionId: string, entryIds: readonly number[]) => {
      const selected = new Set(entryIds)
      return entries.filter(
        (entry) => entry.session_id === sessionId && selected.has(entry.entry_id)
      )
    }),
    getMessageSourceEntries: vi.fn((sessionId: string, messageId: string) =>
      entries.filter(
        (entry) =>
          entry.session_id === sessionId &&
          entry.source_type === 'message' &&
          entry.source_id === messageId &&
          (entry.kind === 'message' ||
            (entry.kind === 'event' && entry.name === 'message/retracted'))
      )
    ),
    getViewManifestEventsByMessage: vi.fn((sessionId: string, messageId: string) =>
      entries.filter(
        (entry) =>
          entry.session_id === sessionId &&
          entry.kind === 'event' &&
          entry.name === 'view/assembled' &&
          entry.source_type === 'runtime_event' &&
          entry.source_id === messageId
      )
    ),
    getBootstrapIncarnation: vi.fn((sessionId: string) => {
      const row = entries.find(
        (entry) =>
          entry.session_id === sessionId &&
          entry.kind === 'anchor' &&
          entry.name === 'session/start'
      )
      if (!row) return undefined
      const value = JSON.parse(row.meta_json) as Record<string, unknown>
      return typeof value.tapeIncarnationId === 'string' ? value.tapeIncarnationId : undefined
    }),
    getMaxEventSourceSeq: vi.fn(
      (sessionId: string, name: string, sourceType: string, sourceId: string) =>
        Math.max(
          0,
          ...entries
            .filter(
              (entry) =>
                entry.session_id === sessionId &&
                entry.kind === 'event' &&
                entry.name === name &&
                entry.source_type === sourceType &&
                entry.source_id === sourceId &&
                Number.isSafeInteger(entry.source_seq)
            )
            .map((entry) => entry.source_seq)
        )
    ),
    listMemoryViewManifestAnchorsByAgent: vi.fn(
      (
        _agentId: string,
        _options?: { sessionId?: string; limit?: number; messageId?: string }
      ): any[] => {
        throw new Error('configure listMemoryViewManifestAnchorsByAgent for this test')
      }
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
    getBySessionUpToEntryIdExcludingContext: vi.fn((sessionId: string, maxEntryId: number) =>
      entries.filter(
        (entry) =>
          entry.session_id === sessionId && entry.entry_id <= maxEntryId && entry.kind !== 'context'
      )
    ),
    getMaxEntryId: vi.fn((sessionId: string) =>
      Math.max(
        0,
        ...entries.filter((entry) => entry.session_id === sessionId).map((entry) => entry.entry_id)
      )
    ),
    getMaxEntryIdExcludingContext: vi.fn((sessionId: string) =>
      Math.max(
        0,
        ...entries
          .filter((entry) => entry.session_id === sessionId && entry.kind !== 'context')
          .map((entry) => entry.entry_id)
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
        .filter((entry) => entry.session_id === sessionId && entry.kind !== 'context')
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
    logical_round: null,
    physical_attempt: null,
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
    deepchatExecutionJournalStore: table,
    tapeLifecycle: table,
    deepchatTapeSearchProjectionTable: {
      deleteBySession: vi.fn(),
      isCurrent: vi.fn(() => {
        throw new Error('projection unavailable')
      }),
      getByEntryIdsIfCurrent: vi.fn().mockReturnValue([])
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
      tapeLifecycle: table,
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
  appendMessageReplacementToTape(table as any, edited, {
    reason: 'test_edit',
    revisionKind: 'record'
  })
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

export {
  performance,
  describe,
  expect,
  it,
  vi,
  buildContext,
  toAppSessionId,
  SessionTape,
  buildEffectiveTapeView,
  searchEffectiveTapeRows,
  createTapeViewManifest,
  appendMessageRecordToTape,
  appendMessageReplacementToTape,
  appendMessageRetractionToTape,
  appendToolFactsToTape,
  buildRequestRefs,
  DeepChatExecutionJournalStore,
  DeepChatTapeEntriesTable,
  SqliteTapeLifecycleAdapter,
  DEEPCHAT_TAPE_SEARCH_PROJECTION_VERSION,
  DeepChatTapeSearchProjectionTable,
  DeepChatMemoryIngestionProjectionTable,
  DeepChatMessagesTable,
  DeepChatMessageTracesTable,
  DeepChatSessionsTable,
  NewSessionsTable,
  DatabaseCtor,
  sqliteAvailable,
  sqliteSkipReason,
  itIfSqlite,
  createTapeTableMock,
  createRecord,
  createTraceRow,
  createMessageRow,
  createObservationManifest,
  createTapeService,
  createLinkedTapeService,
  createSubagentLinkInput,
  appendObservationIsolationFacts,
  stripObservationPayloadOptIns,
  createSpies,
  trackMemoryPropertyAccess,
  readObservationMatrix
}
