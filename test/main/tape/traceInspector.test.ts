import { describe, expect, it } from 'vitest'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import { hashString } from '@/tape/domain/replay'
import {
  buildTapeProviderAttemptProvenanceKey,
  buildTapeProviderAttemptEvent,
  TAPE_PROVIDER_ATTEMPT_EVENT_NAME
} from '@/tape/domain/providerAttempt'
import { TapeProviderAttemptService } from '@/tape/application/providerAttemptService'
import {
  buildDispatchData,
  buildExecutionJournalMeta,
  buildExecutionOperationProvenanceKey
} from '@/tape/domain/executionJournal'
import {
  getTapeInspectorTraceBinding,
  matchesTapeInspectorFilters,
  projectTapeInspectorDetail,
  projectTapeInspectorFact
} from '@/tape/application/traceInspectorProjection'
import { TapeTraceInspectorService } from '@/tape/application/traceInspectorService'
import {
  buildTapeInspectorRowsQuery,
  DeepChatExecutionJournalStore,
  DeepChatTapeEntriesTable
} from '@/tape/infrastructure/sqlite/tapeEntryStore'
import {
  DeepChatMessageTracesTable,
  TRACE_EVIDENCE_APPEND_INDEX_SCHEMA_VERSION
} from '@/session/data/tables/deepchatMessageTraces'
import type { TapeInspectorFactRecord, TapeInspectorSort } from '@shared/types/tape-inspector'
import { Database, nativeSqliteItIf } from '../nativeSqliteHarness'

const DatabaseCtor = Database!

function row(entryId: number, overrides: Partial<DeepChatTapeEntryRow> = {}): DeepChatTapeEntryRow {
  return {
    session_id: 'session-1',
    entry_id: entryId,
    kind: 'event',
    name: null,
    source_type: null,
    source_id: null,
    source_seq: null,
    provenance_key: null,
    payload_json: '{}',
    meta_json: '{}',
    created_at: entryId * 100,
    ...overrides
  }
}

describe('Tape Trace Inspector projection', () => {
  it('projects every physical row exactly once and fails unknown schemas closed', () => {
    const secret = 'context-body-must-not-cross-ipc'
    const rows: DeepChatTapeEntryRow[] = [
      row(1, { kind: 'event', name: 'future/event', payload_json: '{"private":"event"}' }),
      row(2, { kind: 'anchor', name: 'future/anchor', payload_json: '{"state":"private"}' }),
      row(3, { kind: 'message', name: null, payload_json: '{"record":{"content":"private"}}' }),
      row(4, {
        kind: 'tool_call',
        name: 'read_file',
        payload_json: '{"messageId":"m1","toolCall":{"id":"call-1"}}',
        meta_json: '{"status":"success"}'
      }),
      row(5, {
        kind: 'tool_result',
        name: 'read_file',
        payload_json: '{"messageId":"m1","toolCallId":"call-1","response":"private"}',
        meta_json: '{"status":"success"}'
      }),
      row(6, {
        kind: 'context',
        name: 'skill/materialized',
        payload_json: JSON.stringify({ effectiveContent: secret }),
        meta_json: '{"payloadHash":"stored-hash"}'
      })
    ]

    const records = rows.map(projectTapeInspectorFact)

    expect(records).toHaveLength(rows.length)
    expect(records.map((record) => record.entryId)).toEqual([1, 2, 3, 4, 5, 6])
    expect(records.map((record) => record.family)).toEqual([
      'other',
      'other',
      'other',
      'tool',
      'tool',
      'context'
    ])
    expect(JSON.stringify(records)).not.toContain(secret)
    expect(projectTapeInspectorDetail(rows[0])).toMatchObject({ disclosure: 'metadata_only' })
    expect(projectTapeInspectorDetail(rows[1])).toMatchObject({ disclosure: 'metadata_only' })
    expect(projectTapeInspectorDetail(rows[5])).toMatchObject({ disclosure: 'metadata_only' })
    expect(projectTapeInspectorFact(row(7, { name: 'x'.repeat(2_048) })).name).toBe(
      'x'.repeat(1_024)
    )
  })

  it('preserves exact provider-attempt identity and stored-string hashes', () => {
    const attempt = buildTapeProviderAttemptEvent({
      sessionId: 'session-1',
      messageId: 'message-1',
      logicalRound: 2,
      requestSeq: 3,
      physicalAttempt: 2,
      requestOrigin: 'tool_loop',
      attemptOrigin: 'transient_retry',
      providerId: 'provider-1',
      modelId: 'model-1',
      status: 'error',
      stopReason: 'error',
      failureClassification: 'transient',
      retryDecision: 'retry_scheduled',
      httpStatus: 503,
      errorCode: 'upstream_unavailable',
      retryDelayMs: 100,
      usage: null
    })
    const payloadJson = JSON.stringify({ name: TAPE_PROVIDER_ATTEMPT_EVENT_NAME, data: attempt })
    const attemptRow = row(7, {
      name: TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
      source_type: 'runtime_event',
      source_id: 'message-1',
      source_seq: 3,
      payload_json: payloadJson
    })

    const record = projectTapeInspectorFact(attemptRow)

    expect(record).toMatchObject({
      family: 'attempt',
      messageId: 'message-1',
      requestSeq: 3,
      logicalRound: 2,
      physicalAttempt: 2,
      facts: {
        status: 'error',
        retryDecision: 'retry_scheduled',
        errorCode: 'upstream_unavailable'
      },
      hashes: { payloadHash: hashString(payloadJson) }
    })
    expect(getTapeInspectorTraceBinding(record)).toEqual({
      scope: 'attempt',
      messageId: 'message-1',
      requestSeq: 3,
      physicalAttempt: 2
    })
  })

  it('keeps legacy provider attempts at request scope', () => {
    const legacyAttempt = {
      schemaVersion: 1,
      messageId: 'message-1',
      requestSeq: 3,
      providerId: 'provider-1',
      modelId: 'model-1',
      status: 'completed',
      stopReason: 'complete',
      usage: null,
      cacheHitRate: null
    }
    const record = projectTapeInspectorFact(
      row(8, {
        name: TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
        source_type: 'runtime_event',
        source_id: 'message-1',
        source_seq: 3,
        payload_json: JSON.stringify({
          name: TAPE_PROVIDER_ATTEMPT_EVENT_NAME,
          data: legacyAttempt
        })
      })
    )

    expect(record).toMatchObject({
      family: 'attempt',
      messageId: 'message-1',
      requestSeq: 3
    })
    expect(record.physicalAttempt).toBeUndefined()
    expect(getTapeInspectorTraceBinding(record)).toEqual({
      scope: 'request',
      messageId: 'message-1',
      requestSeq: 3
    })
  })

  it('filters explicit tool outcomes with the same status shown by the renderer', () => {
    const successfulOutcome: TapeInspectorFactRecord = {
      recordType: 'fact',
      key: 'entry:9',
      entryId: 9,
      family: 'journal',
      kind: 'event',
      name: 'execution/tool_outcome',
      createdAt: 900,
      facts: { isError: false }
    }
    const failedOutcome: TapeInspectorFactRecord = {
      ...successfulOutcome,
      key: 'entry:10',
      entryId: 10,
      facts: { isError: true }
    }

    expect(matchesTapeInspectorFilters(successfulOutcome, { factStatus: 'success' })).toBe(true)
    expect(matchesTapeInspectorFilters(successfulOutcome, { factStatus: 'error' })).toBe(false)
    expect(matchesTapeInspectorFilters(failedOutcome, { factStatus: 'error' })).toBe(true)
  })

  it('discloses only recognized anchor fields after exact schema validation', () => {
    const summary = 'private summary text'
    const validState = {
      summary,
      cursorOrderSeq: 9,
      range: { fromOrderSeq: 1, toOrderSeq: 8 },
      sourceMessageIds: ['message-1', 'message-2'],
      summaryableTurnCount: 4,
      retainedTurnCount: 2,
      retainedTokenEstimate: 120,
      retainedTokenTarget: 200,
      previousSummaryUpdatedAt: null
    }
    const validCompaction = row(8, {
      kind: 'anchor',
      name: 'compaction/manual',
      payload_json: JSON.stringify({ name: 'compaction/manual', state: validState })
    })
    const spoofedBootstrap = row(1, {
      kind: 'anchor',
      name: 'session/start',
      source_type: 'session',
      source_id: 'session-1',
      source_seq: 0,
      payload_json: JSON.stringify({
        name: 'session/start',
        state: { owner: 'human', secret: 'must-not-cross-ipc' }
      })
    })
    const futureCompactionSchema = row(9, {
      kind: 'anchor',
      name: 'compaction/manual',
      payload_json: JSON.stringify({
        name: 'compaction/manual',
        state: { ...validState, futureBody: 'must-not-cross-ipc' }
      })
    })

    const detail = projectTapeInspectorDetail(validCompaction)

    expect(detail).toMatchObject({
      disclosure: 'structured',
      data: {
        name: 'compaction/manual',
        state: {
          cursorOrderSeq: 9,
          sourceMessageCount: 2,
          summaryableTurnCount: 4
        }
      }
    })
    expect(JSON.stringify(detail)).not.toContain(summary)
    expect(projectTapeInspectorDetail(spoofedBootstrap)).toMatchObject({
      disclosure: 'metadata_only'
    })
    expect(projectTapeInspectorDetail(futureCompactionSchema)).toMatchObject({
      disclosure: 'metadata_only'
    })
    expect(JSON.stringify(projectTapeInspectorDetail(futureCompactionSchema))).not.toContain(
      'must-not-cross-ipc'
    )
  })

  it('projects recorded Memory manifests without inventing historical content', () => {
    const memoryView = row(10, {
      kind: 'anchor',
      name: 'memory/view_assembled',
      payload_json: JSON.stringify({
        name: 'memory/view_assembled',
        state: {
          policyVersion: 1,
          selected: [
            {
              id: 'memory-1',
              kind: 'semantic',
              score: 0.9,
              similarity: 0.8,
              sources: { vec: true, fts: false }
            }
          ],
          dropped: [{ id: 'memory-2', kind: 'reflection', reason: 'budget' }],
          tokenBudget: 800,
          estimatedTokens: 120,
          queryHash: 'query-hash',
          degradations: []
        }
      }),
      meta_json: JSON.stringify({ messageId: 'message-1' })
    })
    const directiveView = row(11, {
      kind: 'anchor',
      name: 'memory/directive_view_assembled',
      payload_json: JSON.stringify({
        name: 'memory/directive_view_assembled',
        state: {
          policyVersion: 1,
          selected: [{ id: 'directive-1', kind: 'instruction', source: 'explicit_user' }],
          dropped: [{ id: 'directive-2', kind: 'suppress_topic', reason: 'total_budget' }],
          tokenBudget: 256,
          totalTokenBudget: 800,
          itemTokenBudget: 128,
          estimatedTokens: 90
        }
      }),
      meta_json: JSON.stringify({ messageId: 'message-1' })
    })

    expect(projectTapeInspectorFact(memoryView)).toMatchObject({
      family: 'anchor',
      messageId: 'message-1',
      facts: {
        selectedCount: 1,
        droppedCount: 1,
        tokenBudget: 800,
        estimatedTokens: 120
      }
    })
    expect(projectTapeInspectorDetail(memoryView)).toMatchObject({
      disclosure: 'structured',
      data: {
        name: 'memory/view_assembled',
        manifest: {
          selected: [{ id: 'memory-1', kind: 'semantic' }],
          dropped: [{ id: 'memory-2', kind: 'reflection', reason: 'budget' }]
        }
      }
    })
    expect(projectTapeInspectorFact(directiveView)).toMatchObject({
      family: 'anchor',
      facts: { selectedCount: 1, droppedCount: 1, tokenBudget: 256 }
    })
    expect(projectTapeInspectorDetail(directiveView)).toMatchObject({
      disclosure: 'structured',
      data: {
        manifest: {
          selected: [{ id: 'directive-1', kind: 'instruction', source: 'explicit_user' }]
        }
      }
    })
    expect(JSON.stringify(projectTapeInspectorDetail(memoryView))).not.toContain(
      'historical memory body'
    )

    const futureSchema = row(12, {
      kind: 'anchor',
      name: 'memory/view_assembled',
      payload_json: JSON.stringify({
        name: 'memory/view_assembled',
        state: {
          policyVersion: 1,
          selected: [],
          dropped: [],
          tokenBudget: 800,
          estimatedTokens: 0,
          futureContent: 'must-not-cross-ipc'
        }
      })
    })
    expect(projectTapeInspectorDetail(futureSchema)).toMatchObject({
      disclosure: 'metadata_only'
    })
    expect(JSON.stringify(projectTapeInspectorDetail(futureSchema))).not.toContain(
      'must-not-cross-ipc'
    )

    const oversizedManifest = row(13, {
      kind: 'anchor',
      name: 'memory/view_assembled',
      payload_json: JSON.stringify({
        name: 'memory/view_assembled',
        state: {
          policyVersion: 1,
          selected: Array.from({ length: 257 }, (_, index) => ({
            id: `memory-${index}`,
            kind: 'semantic'
          })),
          dropped: [],
          tokenBudget: 800,
          estimatedTokens: 120
        }
      })
    })
    expect(projectTapeInspectorDetail(oversizedManifest)).toMatchObject({
      disclosure: 'metadata_only'
    })
  })

  it('shows bounded known tool payloads while masking stored API-key fields', () => {
    const toolCall = row(12, {
      kind: 'tool_call',
      name: 'search',
      payload_json: JSON.stringify({
        messageId: 'message-1',
        orderSeq: 7,
        toolCall: {
          id: 'tool-call-1',
          name: 'search',
          params: JSON.stringify({ query: 'Tape semantics', apiKey: 'secret-value' }),
          serverName: 'local-tools'
        }
      }),
      meta_json: JSON.stringify({ status: 'success' })
    })
    const toolResult = row(13, {
      kind: 'tool_result',
      name: 'search',
      payload_json: JSON.stringify({
        messageId: 'message-1',
        orderSeq: 8,
        toolCallId: 'tool-call-1',
        response: JSON.stringify({ result: 'recorded output', api_key: 'another-secret' })
      }),
      meta_json: JSON.stringify({ status: 'success' })
    })

    expect(projectTapeInspectorFact(toolCall)).toMatchObject({
      family: 'tool',
      messageId: 'message-1',
      providerToolCallId: 'tool-call-1',
      facts: { toolName: 'search', status: 'success' }
    })
    expect(projectTapeInspectorFact(toolResult)).toMatchObject({
      family: 'tool',
      facts: { contentPreview: expect.stringContaining('recorded output') }
    })
    const details = JSON.stringify([
      projectTapeInspectorDetail(toolCall),
      projectTapeInspectorDetail(toolResult)
    ])
    expect(details).toContain('Tape semantics')
    expect(details).toContain('recorded output')
    expect(details).not.toContain('secret-value')
    expect(details).not.toContain('another-secret')

    const unknownToolSchema = row(14, {
      kind: 'tool_result',
      name: 'search',
      payload_json: JSON.stringify({
        messageId: 'message-1',
        orderSeq: 9,
        toolCallId: 'tool-call-1',
        response: 'safe output',
        futureSecret: 'must-not-cross-ipc'
      })
    })
    expect(projectTapeInspectorDetail(unknownToolSchema)).toMatchObject({
      disclosure: 'metadata_only'
    })
    expect(JSON.stringify(projectTapeInspectorDetail(unknownToolSchema))).not.toContain(
      'must-not-cross-ipc'
    )

    const oversizedToolResult = row(15, {
      kind: 'tool_result',
      name: 'search',
      payload_json: JSON.stringify({
        messageId: 'message-1',
        orderSeq: 10,
        toolCallId: 'tool-call-1',
        response: `{"apiKey":"${'secret-value'.repeat(2_000)}"}`
      })
    })
    const oversizedDetail = projectTapeInspectorDetail(oversizedToolResult)
    expect(oversizedDetail).toMatchObject({ disclosure: 'structured' })
    expect(JSON.stringify(oversizedDetail)).toContain('***MASKED***')
    expect(JSON.stringify(oversizedDetail)).not.toContain('secret-value')
  })
})

const itIfSqlite = nativeSqliteItIf()

describe('Tape Trace Inspector storage contracts', () => {
  itIfSqlite('pages the Tape tail without crossing incarnation or evidence cursors', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const tape = new DeepChatTapeEntriesTable(db)
      const traces = new DeepChatMessageTracesTable(db)
      tape.createTable()
      traces.createTable()
      tape.ensureBootstrapAnchor('session-1')
      for (let index = 1; index <= 5; index += 1) {
        tape.appendEvent({
          sessionId: 'session-1',
          name: `test/fact_${index}`,
          data: { index },
          createdAt: index * 100
        })
      }
      const inspector = new TapeTraceInspectorService({
        getEntryStore: () => tape,
        getMessageTraceReader: () => traces
      })

      const tail = inspector.listPage({ sessionId: 'session-1', mode: 'tail', limit: 2 })
      expect(tail).toMatchObject({
        status: 'ok',
        snapshotMaxEntryId: 6,
        records: [{ entryId: 5 }, { entryId: 6 }],
        nextCursor: { sort: 'entryId', entryId: 5 }
      })
      if (tail.status !== 'ok' || !tail.nextCursor) throw new Error('Expected a tail page')
      expect(inspector.getHead('session-1')).toEqual({
        tapeIncarnationId: tail.tapeIncarnationId,
        maxEntryId: 6
      })

      const older = inspector.listPage({
        sessionId: 'session-1',
        expectedTapeIncarnationId: tail.tapeIncarnationId,
        mode: 'older',
        cursor: tail.nextCursor,
        limit: 2
      })
      expect(older).toMatchObject({
        status: 'ok',
        records: [{ entryId: 3 }, { entryId: 4 }],
        nextCursor: { sort: 'entryId', entryId: 3 }
      })
      const newer = inspector.listPage({
        sessionId: 'session-1',
        expectedTapeIncarnationId: tail.tapeIncarnationId,
        mode: 'newer',
        cursor: { sort: 'entryId', entryId: 4 },
        limit: 10
      })
      expect(newer).toMatchObject({
        status: 'ok',
        records: [{ entryId: 5 }, { entryId: 6 }],
        nextCursor: null
      })
      expect(
        inspector.listPage({
          sessionId: 'session-1',
          expectedTapeIncarnationId: tail.tapeIncarnationId,
          mode: 'tail',
          limit: 10,
          filters: { name: 'test/fact_4' }
        })
      ).toMatchObject({ status: 'ok', records: [{ entryId: 5 }], nextCursor: null })

      expect(
        inspector.listPage({
          sessionId: 'session-1',
          expectedTapeIncarnationId: 'stale-incarnation',
          mode: 'tail'
        })
      ).toMatchObject({ status: 'reset', snapshotMaxEntryId: 6 })
    } finally {
      db.close()
    }
  })

  itIfSqlite('resolves exact provider-attempt parents with one metadata-only batch', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const tape = new DeepChatTapeEntriesTable(db)
      const traces = new DeepChatMessageTracesTable(db)
      tape.createTable()
      traces.createTable()
      const attempts = new TapeProviderAttemptService({
        getEntryStore: () => tape,
        getProviderAttemptStore: () => tape
      })
      const appendAttempt = (physicalAttempt: number) =>
        attempts.appendProviderAttempt({
          sessionId: 'session-1',
          messageId: 'message-1',
          logicalRound: 1,
          requestSeq: 3,
          physicalAttempt,
          requestOrigin: 'initial',
          attemptOrigin: physicalAttempt === 0 ? 'initial' : 'transient_retry',
          providerId: 'provider-1',
          modelId: 'model-1',
          status: 'completed',
          stopReason: 'complete',
          failureClassification: null,
          retryDecision: 'none',
          httpStatus: 200,
          errorCode: null,
          retryDelayMs: null,
          usage: null
        })
      const attemptZero = appendAttempt(0)
      const attemptTwo = appendAttempt(2)
      const inspector = new TapeTraceInspectorService({
        getEntryStore: () => tape,
        getMessageTraceReader: () => traces
      })
      const head = inspector.getHead('session-1')
      if (!head) throw new Error('Expected a Tape head')

      const output = inspector.resolveEvidenceEntries({
        sessionId: 'session-1',
        expectedTapeIncarnationId: head.tapeIncarnationId,
        identities: [
          { messageId: 'message-1', requestSeq: 3, physicalAttempt: 0 },
          { messageId: 'message-1', requestSeq: 3, physicalAttempt: 1 },
          { messageId: 'message-1', requestSeq: 3, physicalAttempt: 2 },
          { messageId: 'message-1', requestSeq: 3, physicalAttempt: 0 }
        ]
      })

      expect(output).toEqual({
        status: 'ok',
        tapeIncarnationId: head.tapeIncarnationId,
        resolutions: [
          {
            messageId: 'message-1',
            requestSeq: 3,
            physicalAttempt: 0,
            entryId: attemptZero.entry_id
          },
          {
            messageId: 'message-1',
            requestSeq: 3,
            physicalAttempt: 1,
            entryId: null
          },
          {
            messageId: 'message-1',
            requestSeq: 3,
            physicalAttempt: 2,
            entryId: attemptTwo.entry_id
          }
        ]
      })
      const refs = tape.getEntryRefsByProvenanceKeys('session-1', [
        buildTapeProviderAttemptProvenanceKey({
          sessionId: 'session-1',
          messageId: 'message-1',
          requestSeq: 3,
          physicalAttempt: 0
        })
      ])
      expect(refs).toEqual([
        {
          entryId: attemptZero.entry_id,
          provenanceKey: attemptZero.provenance_key
        }
      ])
      expect(Object.keys(refs[0] ?? {}).sort()).toEqual(['entryId', 'provenanceKey'])
      const queryPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT entry_id, provenance_key
           FROM deepchat_tape_entries
           WHERE session_id = ? AND provenance_key IN (?, ?)`
        )
        .all('session-1', attemptZero.provenance_key, attemptTwo.provenance_key) as Array<{
        detail: string
      }>
      expect(queryPlan.map((step) => step.detail).join('\n')).toContain(
        'idx_deepchat_tape_entries_session_provenance'
      )
      expect(
        inspector.resolveEvidenceEntries({
          sessionId: 'session-1',
          expectedTapeIncarnationId: 'stale-incarnation',
          identities: []
        })
      ).toEqual({ status: 'reset', tapeIncarnationId: head.tapeIncarnationId })
      expect(
        inspector.resolveEvidenceEntries({
          sessionId: 'session-1',
          expectedTapeIncarnationId: head.tapeIncarnationId,
          identities: []
        })
      ).toEqual({
        status: 'ok',
        tapeIncarnationId: head.tapeIncarnationId,
        resolutions: []
      })
    } finally {
      db.close()
    }
  })

  itIfSqlite('exports a bounded chronological fact tail without opaque payloads', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const tape = new DeepChatTapeEntriesTable(db)
      const traces = new DeepChatMessageTracesTable(db)
      tape.createTable()
      traces.createTable()
      tape.ensureBootstrapAnchor('session-1')
      for (let index = 1; index <= 203; index += 1) {
        tape.appendEvent({
          sessionId: 'session-1',
          name: `test/fact_${index}`,
          data: { index },
          createdAt: index
        })
      }
      const insert = db.prepare(`
        INSERT INTO deepchat_tape_entries (
          session_id, entry_id, kind, name, payload_json, meta_json, created_at
        ) VALUES (?, ?, ?, ?, ?, '{}', ?)
      `)
      insert.run(
        'session-1',
        205,
        'event',
        'future/private_event',
        JSON.stringify({ name: 'future/private_event', data: { secret: 'opaque-event-body' } }),
        205
      )
      insert.run(
        'session-1',
        206,
        'context',
        'skill/materialized',
        JSON.stringify({ effectiveContent: 'opaque-context-body' }),
        206
      )
      insert.run(
        'session-1',
        207,
        'anchor',
        'compaction/manual',
        JSON.stringify({
          name: 'compaction/manual',
          state: { secret: 'opaque-anchor-body' }
        }),
        207
      )
      const inspector = new TapeTraceInspectorService({
        getEntryStore: () => tape,
        getMessageTraceReader: () => traces
      })
      const head = inspector.getHead('session-1')
      if (!head) throw new Error('Expected a Tape head')

      const exported = inspector.exportSupportFacts({
        sessionId: 'session-1',
        expectedTapeIncarnationId: head.tapeIncarnationId
      })

      expect(exported).toMatchObject({
        status: 'ok',
        snapshotMaxEntryId: 207,
        factsTruncated: true,
        detailDataTruncated: false
      })
      if (exported.status !== 'ok') throw new Error('Expected support facts')
      expect(exported.facts).toHaveLength(200)
      expect(exported.facts[0]?.record.entryId).toBe(8)
      expect(exported.facts.at(-1)?.record.entryId).toBe(207)
      expect(exported.facts.find((detail) => detail.record.entryId === 205)).toMatchObject({
        disclosure: 'metadata_only'
      })
      expect(exported.facts.find((detail) => detail.record.entryId === 206)).toMatchObject({
        disclosure: 'metadata_only',
        record: { family: 'context' }
      })
      expect(exported.facts.find((detail) => detail.record.entryId === 207)).toMatchObject({
        disclosure: 'metadata_only',
        record: { family: 'anchor' }
      })
      expect(JSON.stringify(exported)).not.toContain('opaque-event-body')
      expect(JSON.stringify(exported)).not.toContain('opaque-context-body')
      expect(JSON.stringify(exported)).not.toContain('opaque-anchor-body')
      expect(
        inspector.exportSupportFacts({
          sessionId: 'session-1',
          expectedTapeIncarnationId: 'stale-incarnation'
        })
      ).toEqual({
        status: 'reset',
        tapeIncarnationId: head.tapeIncarnationId,
        snapshotMaxEntryId: 207
      })
    } finally {
      db.close()
    }
  })

  itIfSqlite('caps structured detail data while retaining the newest facts', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const tape = new DeepChatExecutionJournalStore(db)
      const traces = new DeepChatMessageTracesTable(db)
      tape.createTable()
      traces.createTable()
      tape.ensureBootstrapAnchor('session-1')
      const runId = '00000000-0000-4000-8000-000000000001'
      for (let requestSeq = 1; requestSeq <= 200; requestSeq += 1) {
        const operation = {
          runId,
          requestSeq,
          providerToolCallId: `tool-${requestSeq}`
        }
        tape.appendExecutionJournalEvent({
          sessionId: 'session-1',
          name: 'execution/dispatch_committed',
          source: { type: 'runtime_event', id: runId, seq: requestSeq },
          provenanceKey: buildExecutionOperationProvenanceKey(operation, 'dispatch'),
          data: buildDispatchData({
            sessionId: 'session-1',
            messageId: `message-${requestSeq}`,
            operation,
            toolName: 't'.repeat(512),
            toolSource: 'mcp',
            normalizedArguments: { requestSeq },
            target: {
              serverName: 's'.repeat(1_024),
              originalName: 'o'.repeat(1_024),
              ownerPluginId: 'p'.repeat(1_024)
            }
          }),
          meta: buildExecutionJournalMeta()
        })
      }
      const inspector = new TapeTraceInspectorService({
        getEntryStore: () => tape,
        getMessageTraceReader: () => traces
      })
      const head = inspector.getHead('session-1')
      if (!head) throw new Error('Expected a Tape head')

      const exported = inspector.exportSupportFacts({
        sessionId: 'session-1',
        expectedTapeIncarnationId: head.tapeIncarnationId
      })

      expect(exported).toMatchObject({ status: 'ok', detailDataTruncated: true })
      if (exported.status !== 'ok') throw new Error('Expected support facts')
      expect(exported.facts).toHaveLength(200)
      expect(exported.facts[0]?.record.entryId).toBe(2)
      expect(exported.facts.at(-1)?.record.entryId).toBe(201)
      expect(exported.facts[0]?.data).toBeUndefined()
      expect(exported.facts[0]?.disclosure).toBe('structured')
      expect(exported.facts.at(-1)?.data).toBeDefined()
    } finally {
      db.close()
    }
  })

  itIfSqlite('uses stable composite keysets for global nullable-name sorting', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const tape = new DeepChatTapeEntriesTable(db)
      const traces = new DeepChatMessageTracesTable(db)
      tape.createTable()
      traces.createTable()
      tape.ensureBootstrapAnchor('session-1')
      const insert = db.prepare(`
        INSERT INTO deepchat_tape_entries (
          session_id, entry_id, kind, name, payload_json, meta_json, created_at
        ) VALUES (?, ?, ?, ?, '{}', '{}', ?)
      `)
      insert.run('session-1', 2, 'event', 'alpha', 300)
      insert.run('session-1', 3, 'message', null, 100)
      insert.run('session-1', 4, 'tool_result', 'alpha', 300)
      insert.run('session-1', 5, 'event', 'beta', 200)
      const inspector = new TapeTraceInspectorService({
        getEntryStore: () => tape,
        getMessageTraceReader: () => traces
      })

      const collectSortedEntryIds = (sort: TapeInspectorSort): number[] => {
        let output = inspector.listPage({
          sessionId: 'session-1',
          mode: 'tail',
          limit: 2,
          sort
        })
        if (output.status !== 'ok') throw new Error('Expected a sorted page')
        const incarnation = output.tapeIncarnationId
        const records: TapeInspectorFactRecord[] = [...output.records]
        while (output.nextCursor) {
          output = inspector.listPage({
            sessionId: 'session-1',
            expectedTapeIncarnationId: incarnation,
            mode: 'older',
            cursor: output.nextCursor,
            limit: 2,
            sort
          })
          if (output.status !== 'ok') throw new Error('Expected a sorted continuation')
          records.push(...output.records)
        }
        return records.map((record) => record.entryId)
      }

      expect(collectSortedEntryIds({ column: 'name', direction: 'asc' })).toEqual([3, 2, 4, 5, 1])
      expect(collectSortedEntryIds({ column: 'name', direction: 'desc' })).toEqual([1, 5, 4, 2, 3])
      expect(collectSortedEntryIds({ column: 'kind', direction: 'asc' })).toEqual([1, 2, 5, 3, 4])
      expect(collectSortedEntryIds({ column: 'kind', direction: 'desc' })).toEqual([4, 3, 5, 2, 1])
      expect(collectSortedEntryIds({ column: 'createdAt', direction: 'asc' })).toEqual([
        3, 5, 2, 4, 1
      ])
      expect(collectSortedEntryIds({ column: 'createdAt', direction: 'desc' })).toEqual([
        1, 4, 2, 5, 3
      ])

      const first = inspector.listPage({
        sessionId: 'session-1',
        mode: 'tail',
        limit: 2,
        sort: { column: 'name', direction: 'asc' }
      })
      expect(first).toMatchObject({
        status: 'ok',
        snapshotMaxEntryId: 5,
        records: [
          { entryId: 3, name: null },
          { entryId: 2, name: 'alpha' }
        ],
        nextCursor: {
          sort: 'name',
          direction: 'asc',
          nameHash: hashString(JSON.stringify('alpha')),
          entryId: 2,
          snapshotMaxEntryId: 5
        }
      })
      if (first.status !== 'ok' || first.nextCursor?.sort !== 'name') {
        throw new Error('Expected a sorted name page')
      }

      insert.run('session-1', 6, 'event', 'charlie', 600)
      const second = inspector.listPage({
        sessionId: 'session-1',
        expectedTapeIncarnationId: first.tapeIncarnationId,
        mode: 'older',
        cursor: first.nextCursor,
        limit: 10,
        sort: { column: 'name', direction: 'asc' }
      })
      expect(second).toMatchObject({
        status: 'ok',
        snapshotMaxEntryId: 5,
        records: [
          { entryId: 4, name: 'alpha' },
          { entryId: 5, name: 'beta' },
          { entryId: 1, name: 'session/start' }
        ],
        nextCursor: null
      })
      expect(second.status === 'ok' && second.records.some((record) => record.entryId === 6)).toBe(
        false
      )
      expect(() =>
        inspector.listPage({
          sessionId: 'session-1',
          expectedTapeIncarnationId: first.tapeIncarnationId,
          mode: 'older',
          cursor: first.nextCursor,
          sort: { column: 'kind', direction: 'asc' }
        })
      ).toThrow('cursor does not match')
      expect(() =>
        inspector.listPage({
          sessionId: 'session-1',
          expectedTapeIncarnationId: first.tapeIncarnationId,
          mode: 'older',
          cursor: { ...first.nextCursor, direction: 'desc' },
          sort: { column: 'name', direction: 'asc' }
        })
      ).toThrow('sort direction')
    } finally {
      db.close()
    }
  })

  itIfSqlite('continues name sorting by durable values when projected names are truncated', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const tape = new DeepChatTapeEntriesTable(db)
      const traces = new DeepChatMessageTracesTable(db)
      tape.createTable()
      traces.createTable()
      tape.ensureBootstrapAnchor('session-1')
      const prefix = 'a'.repeat(2_048)
      const insert = db.prepare(`
        INSERT INTO deepchat_tape_entries (
          session_id, entry_id, kind, name, payload_json, meta_json, created_at
        ) VALUES (?, ?, 'event', ?, '{}', '{}', ?)
      `)
      insert.run('session-1', 2, `${prefix}0`, 2)
      insert.run('session-1', 3, `${prefix}1`, 3)
      insert.run('session-1', 4, `${prefix}0`, 4)
      insert.run('session-1', 5, null, 5)
      const inspector = new TapeTraceInspectorService({
        getEntryStore: () => tape,
        getMessageTraceReader: () => traces
      })

      const collect = (direction: 'asc' | 'desc'): number[] => {
        let page = inspector.listPage({
          sessionId: 'session-1',
          mode: 'tail',
          limit: 1,
          sort: { column: 'name', direction }
        })
        if (page.status !== 'ok') throw new Error('Expected a sorted page')
        const incarnation = page.tapeIncarnationId
        const entryIds = page.records.map((record) => record.entryId)
        while (page.nextCursor) {
          expect(page.nextCursor).toMatchObject({
            sort: 'name',
            nameHash: expect.stringMatching(/^[0-9a-f]{64}$/u)
          })
          page = inspector.listPage({
            sessionId: 'session-1',
            expectedTapeIncarnationId: incarnation,
            mode: 'older',
            cursor: page.nextCursor,
            limit: 1,
            sort: { column: 'name', direction }
          })
          if (page.status !== 'ok') throw new Error('Expected a sorted continuation')
          entryIds.push(...page.records.map((record) => record.entryId))
        }
        return entryIds
      }

      expect(collect('asc')).toEqual([5, 2, 4, 3, 1])
      expect(collect('desc')).toEqual([1, 3, 4, 2, 5])
    } finally {
      db.close()
    }
  })

  itIfSqlite('fails malformed canonical bootstrap anchors closed', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const tape = new DeepChatTapeEntriesTable(db)
      const traces = new DeepChatMessageTracesTable(db)
      tape.createTable()
      traces.createTable()
      tape.ensureBootstrapAnchor('session-1')
      db.prepare(
        "UPDATE deepchat_tape_entries SET meta_json = '{not-json' WHERE session_id = ? AND entry_id = 1"
      ).run('session-1')
      const inspector = new TapeTraceInspectorService({
        getEntryStore: () => tape,
        getMessageTraceReader: () => traces
      })

      expect(inspector.getHead('session-1')).toBeNull()
      expect(() => inspector.listPage({ sessionId: 'session-1', mode: 'tail' })).toThrow(
        'bootstrap is missing or invalid'
      )
    } finally {
      db.close()
    }
  })

  itIfSqlite('keeps advertised sort queries indexed on a high-entry session', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const tape = new DeepChatTapeEntriesTable(db)
      const traces = new DeepChatMessageTracesTable(db)
      tape.createTable()
      traces.createTable()
      tape.ensureBootstrapAnchor('large-session')
      const insert = db.prepare(`
        INSERT INTO deepchat_tape_entries (
          session_id, entry_id, kind, name, payload_json, meta_json, created_at
        ) VALUES (?, ?, 'event', ?, '{}', '{}', ?)
      `)
      db.transaction(() => {
        for (let entryId = 2; entryId <= 10_001; entryId += 1) {
          insert.run(
            'large-session',
            entryId,
            `fixture/${String(entryId % 1_000).padStart(4, '0')}`,
            entryId % 500
          )
        }
      })()
      const inspector = new TapeTraceInspectorService({
        getEntryStore: () => tape,
        getMessageTraceReader: () => traces
      })

      const page = inspector.listPage({
        sessionId: 'large-session',
        mode: 'tail',
        limit: 100,
        sort: { column: 'createdAt', direction: 'asc' }
      })
      expect(page.status).toBe('ok')
      expect(page.status === 'ok' ? page.records : []).toHaveLength(100)

      const expectedIndexes = {
        name: 'idx_deepchat_tape_entries_session_name',
        kind: 'idx_deepchat_tape_entries_session_kind',
        createdAt: 'idx_deepchat_tape_entries_session_created'
      } as const
      for (const column of ['name', 'kind', 'createdAt'] as const) {
        const query = buildTapeInspectorRowsQuery({
          sessionId: 'large-session',
          mode: 'tail',
          sort: { column, direction: 'asc' },
          snapshotMaxEntryId: 10_001,
          limit: 100
        })
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params) as Array<{
          detail: string
        }>
        const details = plan.map((step) => step.detail).join('\n')
        expect(details).toContain(expectedIndexes[column])
        expect(details).not.toContain('USE TEMP B-TREE FOR ORDER BY')
      }
    } finally {
      db.close()
    }
  })

  itIfSqlite('returns metadata-only evidence pages and counts only exact attempt bindings', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const traces = new DeepChatMessageTracesTable(db)
      traces.createTable()
      db.exec('DROP INDEX idx_trace_session_append')
      db.exec(traces.getMigrationSQL(TRACE_EVIDENCE_APPEND_INDEX_SCHEMA_VERSION)!)
      traces.insert({
        id: 'trace-attempt-1',
        messageId: 'message-1',
        sessionId: 'session-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        requestSeq: 2,
        logicalRound: 1,
        physicalAttempt: 1,
        endpoint: 'https://private.example',
        headersJson: '{"authorization":"private"}',
        bodyJson: '{"secret":"private"}',
        truncated: false,
        createdAt: 200
      })
      traces.insert({
        id: 'trace-legacy',
        messageId: 'message-1',
        sessionId: 'session-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        requestSeq: 2,
        logicalRound: null,
        physicalAttempt: null,
        endpoint: 'https://private.example',
        headersJson: '{}',
        bodyJson: '{}',
        truncated: true,
        createdAt: 100
      })

      const page = traces.listInspectorMetadata({
        sessionId: 'session-1',
        mode: 'older',
        limit: 10
      })
      expect(page.rows).toHaveLength(2)
      expect(JSON.stringify(page.rows)).not.toContain('endpoint')
      expect(JSON.stringify(page.rows)).not.toContain('headers')
      expect(JSON.stringify(page.rows)).not.toContain('body')
      const firstPage = traces.listInspectorMetadata({
        sessionId: 'session-1',
        mode: 'older',
        limit: 1
      })
      expect(firstPage).toMatchObject({ rows: [{ id: 'trace-attempt-1' }], hasMore: true })
      expect(
        traces.listInspectorMetadata({
          sessionId: 'session-1',
          mode: 'older',
          cursor: { createdAt: 200, traceId: 'trace-attempt-1' },
          limit: 1
        })
      ).toMatchObject({ rows: [{ id: 'trace-legacy' }], hasMore: false })

      traces.insert({
        id: 'trace-z',
        messageId: 'message-1',
        sessionId: 'session-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        requestSeq: 3,
        endpoint: 'https://private.example',
        headersJson: '{}',
        bodyJson: '{}',
        truncated: false,
        createdAt: 300
      })
      traces.insert({
        id: 'trace-a',
        messageId: 'message-1',
        sessionId: 'session-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        requestSeq: 3,
        endpoint: 'https://private.example',
        headersJson: '{}',
        bodyJson: '{}',
        truncated: false,
        createdAt: 300
      })
      expect(
        traces.listInspectorMetadata({
          sessionId: 'session-1',
          mode: 'newer',
          cursor: { rowId: 2 },
          limit: 1
        })
      ).toMatchObject({
        rows: [{ id: 'trace-z' }],
        hasMore: true,
        appendCursorRowId: 3
      })
      expect(
        traces.listInspectorMetadata({
          sessionId: 'session-1',
          mode: 'newer',
          cursor: { rowId: 3 },
          limit: 1
        })
      ).toMatchObject({
        rows: [{ id: 'trace-a' }],
        hasMore: false,
        appendCursorRowId: 4
      })
      traces.insert({
        id: 'trace-other-message',
        messageId: 'message-2',
        sessionId: 'session-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        requestSeq: 1,
        endpoint: 'https://private.example',
        headersJson: '{}',
        bodyJson: '{}',
        truncated: false,
        createdAt: 400
      })
      expect(
        traces.listInspectorMetadata({
          sessionId: 'session-1',
          mode: 'newer',
          cursor: { rowId: 4 },
          messageId: 'message-without-new-evidence',
          limit: 1
        })
      ).toMatchObject({ rows: [], hasMore: false, appendCursorRowId: 5 })

      traces.deleteByMessageId('message-2')
      traces.insert({
        id: 'trace-after-tail-delete',
        messageId: 'message-1',
        sessionId: 'session-1',
        providerId: 'provider-1',
        modelId: 'model-1',
        requestSeq: 4,
        endpoint: 'https://private.example',
        headersJson: '{}',
        bodyJson: '{}',
        truncated: false,
        createdAt: 500
      })
      expect(
        traces.listInspectorMetadata({
          sessionId: 'session-1',
          mode: 'newer',
          cursor: { rowId: 5 },
          limit: 1
        })
      ).toMatchObject({
        rows: [{ id: 'trace-after-tail-delete', row_id: 6 }],
        hasMore: false,
        appendCursorRowId: 6
      })
      const appendPlan = db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id
           FROM deepchat_message_traces
           WHERE session_id = ? AND rowid > ?
           ORDER BY rowid ASC
           LIMIT ?`
        )
        .all('session-1', 3, 100) as Array<{ detail: string }>
      expect(appendPlan.map((step) => step.detail).join('\n')).toContain('idx_trace_session_append')
      expect(
        traces.countInspectorBindings('session-1', [
          { scope: 'request', messageId: 'message-1', requestSeq: 2 },
          { scope: 'attempt', messageId: 'message-1', requestSeq: 2, physicalAttempt: 1 },
          { scope: 'attempt', messageId: 'message-1', requestSeq: 2, physicalAttempt: null },
          { scope: 'attempt', messageId: 'message-1', requestSeq: 2, physicalAttempt: 0 }
        ])
      ).toEqual(
        expect.arrayContaining([
          { scope: 'request', messageId: 'message-1', requestSeq: 2, count: 2 },
          {
            scope: 'attempt',
            messageId: 'message-1',
            requestSeq: 2,
            physicalAttempt: null,
            count: 1
          },
          {
            scope: 'attempt',
            messageId: 'message-1',
            requestSeq: 2,
            physicalAttempt: 0,
            count: 0
          },
          {
            scope: 'attempt',
            messageId: 'message-1',
            requestSeq: 2,
            physicalAttempt: 1,
            count: 1
          }
        ])
      )
    } finally {
      db.close()
    }
  })
})
