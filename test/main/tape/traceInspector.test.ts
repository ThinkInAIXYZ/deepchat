import { describe, expect, it } from 'vitest'
import type { DeepChatTapeEntryRow } from '@/tape/domain/entry'
import { hashString } from '@/tape/domain/replay'
import {
  buildTapeProviderAttemptEvent,
  TAPE_PROVIDER_ATTEMPT_EVENT_NAME
} from '@/tape/domain/providerAttempt'
import {
  getTapeInspectorTraceBinding,
  projectTapeInspectorDetail,
  projectTapeInspectorFact
} from '@/tape/application/traceInspectorProjection'
import { TapeTraceInspectorService } from '@/tape/application/traceInspectorService'
import { DeepChatTapeEntriesTable } from '@/tape/infrastructure/sqlite/tapeEntryStore'
import { DeepChatMessageTracesTable } from '@/session/data/tables/deepchatMessageTraces'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const Database = sqliteModule?.default
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
})

const itIfSqlite = Database ? it : it.skip

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

  itIfSqlite('returns metadata-only evidence pages and counts only exact attempt bindings', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const traces = new DeepChatMessageTracesTable(db)
      traces.createTable()
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

      const page = traces.listInspectorMetadata({ sessionId: 'session-1', limit: 10 })
      expect(page.rows).toHaveLength(2)
      expect(JSON.stringify(page.rows)).not.toContain('endpoint')
      expect(JSON.stringify(page.rows)).not.toContain('headers')
      expect(JSON.stringify(page.rows)).not.toContain('body')
      const firstPage = traces.listInspectorMetadata({ sessionId: 'session-1', limit: 1 })
      expect(firstPage).toMatchObject({ rows: [{ id: 'trace-attempt-1' }], hasMore: true })
      expect(
        traces.listInspectorMetadata({
          sessionId: 'session-1',
          cursor: { createdAt: 200, traceId: 'trace-attempt-1' },
          limit: 1
        })
      ).toMatchObject({ rows: [{ id: 'trace-legacy' }], hasMore: false })
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
