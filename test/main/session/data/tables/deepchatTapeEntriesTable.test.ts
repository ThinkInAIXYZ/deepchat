import { describe, expect, it, vi } from 'vitest'
import {
  TAPE_TOOL_SURFACE_EVENT_NAME,
  TOOL_SURFACE_TAPE_EVENT_NAMES
} from '@/tape/domain/toolSurfaceFacts'
import { buildTapeProviderAttemptEvent } from '@/tape/domain/providerAttempt'
import { TapeProviderAttemptService } from '@/tape/application/providerAttemptService'

const sqliteModule = await import('better-sqlite3-multiple-ciphers').catch(() => null)
const tableModule = sqliteModule ? await import('@/session/data/tables/deepchatTapeEntries') : null
const lifecycleModule = sqliteModule
  ? await import('@/tape/infrastructure/sqlite/tapeLifecycleAdapter')
  : null

const Database = sqliteModule?.default
const DeepChatTapeEntriesTable = tableModule?.DeepChatTapeEntriesTable
const SqliteTapeLifecycleAdapter = lifecycleModule?.SqliteTapeLifecycleAdapter
const DatabaseCtor = Database!
const DeepChatTapeEntriesTableCtor = DeepChatTapeEntriesTable!
const SqliteTapeLifecycleAdapterCtor = SqliteTapeLifecycleAdapter!

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

const describeIfSqlite = sqliteAvailable ? describe : describe.skip

describeIfSqlite('DeepChatTapeEntriesTable', () => {
  function createTable() {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatTapeEntriesTableCtor(db)
    table.createTable()
    const lifecycle = new SqliteTapeLifecycleAdapterCtor(db)
    return { db, table, lifecycle }
  }

  it('keeps memory/persona anchors out of context reconstruction (C7, AC-7.3)', () => {
    const { db, table } = createTable()

    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      state: { summary: 'one', cursorOrderSeq: 3 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'memory/extract',
      state: { memoryIds: ['m1'], count: 1 },
      createdAt: 101
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'persona/evolve',
      state: { personaId: 'p1' },
      createdAt: 102
    })

    const anchor = table.getLatestReconstructionAnchor('s1')
    expect(anchor?.name).toBe('compaction/manual')

    db.close()
  })

  it('assigns monotonic entry ids per session', () => {
    const { db, table } = createTable()

    table.appendEvent({
      sessionId: 's1',
      name: 'run/start',
      data: { step: 1 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      state: { summary: 'one', cursorOrderSeq: 3 },
      createdAt: 101
    })
    table.appendEvent({
      sessionId: 's2',
      name: 'run/start',
      data: { step: 1 },
      createdAt: 102
    })

    expect(table.getBySession('s1').map((entry) => entry.entry_id)).toEqual([1, 2])
    expect(table.getBySession('s2').map((entry) => entry.entry_id)).toEqual([1])

    db.close()
  })

  it('reads the latest request evidence through indexed lookups', () => {
    const { db, table } = createTable()

    const firstManifest = table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'message-1', seq: 1 },
      data: { manifest: { requestSeq: 1 } },
      createdAt: 100
    })
    const latestManifest = table.appendEvent({
      sessionId: 's1',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'message-2', seq: 2 },
      data: { manifest: { requestSeq: 2 } },
      createdAt: 101
    })
    table.appendEvent({
      sessionId: 's2',
      name: 'view/assembled',
      source: { type: 'runtime_event', id: 'message-other', seq: 1 },
      data: { manifest: { requestSeq: 1 } },
      createdAt: 102
    })
    const firstAttempt = table.appendProviderAttemptEvent({
      sessionId: 's1',
      name: 'provider/attempt_completed',
      source: { type: 'runtime_event', id: 'message-2', seq: 2 },
      provenanceKey: 'provider-attempt:s1:message-2:2:1',
      data: { physicalAttempt: 1 },
      createdAt: 103
    })
    const finalAttempt = table.appendProviderAttemptEvent({
      sessionId: 's1',
      name: 'provider/attempt_completed',
      source: { type: 'runtime_event', id: 'message-2', seq: 2 },
      provenanceKey: 'provider-attempt:s1:message-2:2:2',
      data: { physicalAttempt: 2 },
      createdAt: 104
    })

    expect(firstManifest.entry_id).toBeLessThan(latestManifest.entry_id)
    expect(table.getLatestViewManifestEvent('s1')?.entry_id).toBe(latestManifest.entry_id)
    expect(firstAttempt.entry_id).toBeLessThan(finalAttempt.entry_id)
    expect(
      table.getLatestEventBySource(
        's1',
        'provider/attempt_completed',
        'runtime_event',
        'message-2',
        2
      )?.entry_id
    ).toBe(finalAttempt.entry_id)

    const viewPlan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'event'
           AND name = 'view/assembled'
           AND source_type = 'runtime_event'
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .all('s1') as Array<{ detail: string }>
    expect(
      viewPlan.some((row) => /\bSEARCH deepchat_tape_entries\b.*\bUSING INDEX\b/i.test(row.detail))
    ).toBe(true)
    expect(
      viewPlan.some((row) => /\bSCAN deepchat_tape_entries\b(?!.*USING INDEX)/i.test(row.detail))
    ).toBe(false)

    const attemptPlan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'event'
           AND name = ?
           AND source_type = ?
           AND source_id = ?
           AND source_seq = ?
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .all('s1', 'provider/attempt_completed', 'runtime_event', 'message-2', 2) as Array<{
      detail: string
    }>
    expect(
      attemptPlan.some((row) =>
        /\bSEARCH deepchat_tape_entries\b.*\bUSING INDEX\b/i.test(row.detail)
      )
    ).toBe(true)
    expect(
      attemptPlan.some((row) => /\bSCAN deepchat_tape_entries\b(?!.*USING INDEX)/i.test(row.detail))
    ).toBe(false)

    db.close()
  })

  it('reserves Tool Surface provenance names for the dedicated writer', () => {
    const { db, table } = createTable()

    for (const name of TOOL_SURFACE_TAPE_EVENT_NAMES) {
      expect(() =>
        table.appendEvent({
          sessionId: 's1',
          name,
          data: { marker: 'generic-writer' }
        })
      ).toThrow('reserved for its provenance writer')
    }
    expect(() =>
      table.append({
        sessionId: 's1',
        kind: 'event',
        name: TAPE_TOOL_SURFACE_EVENT_NAME,
        payload: { marker: 'generic-append' }
      })
    ).toThrow('reserved for its provenance writer')

    const compatible = table.appendEvent({
      sessionId: 's1',
      name: 'view/tool_catalog/future',
      data: { marker: 'compatible-near-prefix' }
    })
    expect(compatible.name).toBe('view/tool_catalog/future')

    const rows = TOOL_SURFACE_TAPE_EVENT_NAMES.map((name, index) => {
      const row = table.appendToolSurfaceEvent({
        sessionId: 's1',
        name,
        source: { type: 'runtime_event', id: `fact-${index}`, seq: index },
        provenanceKey: `tool-surface:${index}`,
        data: { marker: `dedicated-writer-${index}` },
        idempotent: true
      })
      expect(row).toMatchObject({
        kind: 'event',
        name,
        source_type: 'runtime_event',
        source_id: `fact-${index}`
      })
      return row
    })
    const headEntryId = rows.at(-1)!.entry_id
    expect(
      table.searchEffectiveSourcesAtHeads(
        [{ sessionId: 's1', maxEntryId: headEntryId }],
        'compatible-near-prefix'
      )
    ).toEqual([compatible])
    expect(
      table.searchEffectiveSourcesAtHeads(
        [{ sessionId: 's1', maxEntryId: headEntryId }],
        'dedicated-writer'
      )
    ).toEqual([])
    expect(
      table.getEffectiveContextRowsAtHead(
        { sessionId: 's1', maxEntryId: headEntryId },
        rows.map((row) => row.entry_id),
        { before: 0, after: 0, limit: 10 }
      )
    ).toEqual([])

    db.close()
  })

  it('reads the maximum event source sequence through the indexed source identity', () => {
    const { db, table } = createTable()

    for (const [sessionId, name, sourceId, sourceSeq] of [
      ['s1', 'provider/attempt_completed', 'a1', 2],
      ['s1', 'provider/attempt_completed', 'a1', 7],
      ['s1', 'view/assembled', 'a1', 9],
      ['s1', 'provider/attempt_completed', 'a2', 11],
      ['s2', 'provider/attempt_completed', 'a1', 13]
    ] as const) {
      const append =
        name === 'provider/attempt_completed'
          ? table.appendProviderAttemptEvent.bind(table)
          : table.appendEvent.bind(table)
      append({
        sessionId,
        name,
        source: { type: 'runtime_event', id: sourceId, seq: sourceSeq },
        data: {}
      })
    }

    expect(
      table.getMaxEventSourceSeq('s1', 'provider/attempt_completed', 'runtime_event', 'a1')
    ).toBe(7)
    expect(
      table.getMaxEventSourceSeq('s1', 'provider/attempt_completed', 'runtime_event', 'missing')
    ).toBe(0)

    db.close()
  })

  it('round-trips silent pressure through the authoritative writer and store', () => {
    const { db, table } = createTable()
    const service = new TapeProviderAttemptService({
      getEntryStore: () => table,
      getProviderAttemptStore: () => table
    })

    const written = service.appendProviderAttempt({
      sessionId: 's1',
      messageId: 'message-1',
      logicalRound: 1,
      requestSeq: 1,
      physicalAttempt: 1,
      requestOrigin: 'chat',
      attemptOrigin: 'initial',
      providerId: 'provider-1',
      modelId: 'model-1',
      status: 'completed',
      stopReason: 'max_tokens',
      failureClassification: null,
      retryDecision: 'none',
      httpStatus: null,
      errorCode: null,
      retryDelayMs: null,
      usage: { inputTokens: 990, outputTokens: 0, totalTokens: 990 },
      contextPressure: {
        kind: 'zero_output_length_at_limit',
        contextWindowTokens: 1_000,
        thresholdTokens: 990
      }
    })

    expect(service.getPendingProviderContextPressure('s1', 'provider-1', 'model-1')).toMatchObject({
      entryId: written.entry_id,
      attempt: {
        messageId: 'message-1',
        contextPressure: {
          kind: 'zero_output_length_at_limit',
          contextWindowTokens: 1_000,
          thresholdTokens: 990
        }
      }
    })

    db.close()
  })

  it('reads the latest matching provider pressure after a reconstruction anchor by index', () => {
    const { db, table } = createTable()
    const buildAttempt = (providerId: string, modelId: string) =>
      buildTapeProviderAttemptEvent({
        sessionId: 's1',
        messageId: `message-${providerId}-${modelId}`,
        logicalRound: 1,
        requestSeq: 1,
        physicalAttempt: 1,
        requestOrigin: 'chat',
        attemptOrigin: 'initial',
        providerId,
        modelId,
        status: 'completed',
        stopReason: 'complete',
        failureClassification: null,
        retryDecision: 'none',
        httpStatus: null,
        errorCode: null,
        retryDelayMs: null,
        usage: { inputTokens: 1_001, outputTokens: 1, totalTokens: 1_002 },
        contextPressure: {
          kind: 'successful_prompt_overflow',
          contextWindowTokens: 1_000,
          thresholdTokens: 1_000
        }
      })
    const appendAttempt = (data: object) =>
      table.appendProviderAttemptEvent({
        sessionId: 's1',
        name: 'provider/attempt_completed',
        data: { ...data }
      })

    const legacy = { ...buildAttempt('provider-1', 'model-1'), schemaVersion: 2 } as Record<
      string,
      unknown
    >
    delete legacy.contextPressure
    appendAttempt(legacy)
    const settled = appendAttempt(buildAttempt('provider-1', 'model-1'))
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/auto',
      state: { summary: 'settled old pressure', cursorOrderSeq: 3 }
    })
    appendAttempt({ ...buildAttempt('provider-1', 'model-1'), contextPressure: null })
    appendAttempt({
      ...buildAttempt('provider-1', 'model-1'),
      contextPressure: { kind: 'invalid', contextWindowTokens: 1_000, thresholdTokens: 1_000 }
    })
    appendAttempt(buildAttempt('provider-2', 'model-1'))
    appendAttempt(buildAttempt('provider-1', 'model-2'))
    const latest = appendAttempt(buildAttempt('provider-1', 'model-1'))

    expect(
      table.getLatestProviderContextPressureEvent('s1', 'provider-1', 'model-1', settled.entry_id)
    ).toMatchObject({ entry_id: latest.entry_id })
    expect(
      table.getLatestProviderContextPressureEvent('s1', 'provider-1', 'model-1', latest.entry_id)
    ).toBeUndefined()
    expect(
      table.getLatestProviderContextPressureEvent('s1', 'provider-3', 'model-1', 0)
    ).toBeUndefined()

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'event'
           AND name = 'provider/attempt_completed'
           AND (CASE WHEN json_valid(payload_json)
             THEN json_extract(payload_json, '$.data.schemaVersion') END) = 3
           AND (CASE WHEN json_valid(payload_json)
             THEN json_extract(payload_json, '$.data.providerId') END) = ?
           AND (CASE WHEN json_valid(payload_json)
             THEN json_extract(payload_json, '$.data.modelId') END) = ?
           AND (CASE WHEN json_valid(payload_json)
             THEN json_extract(payload_json, '$.data.contextPressure.kind') END)
             IN ('successful_prompt_overflow', 'zero_output_length_at_limit')
           AND entry_id > ?
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .all('s1', 'provider-1', 'model-1', settled.entry_id) as Array<{ detail: string }>
    expect(
      plan.some((row) => /idx_deepchat_tape_entries_provider_context_pressure/i.test(row.detail))
    ).toBe(true)

    db.close()
  })

  it('assigns a new Tape incarnation when a session Tape is rebuilt', () => {
    const { db, table, lifecycle } = createTable()
    table.ensureBootstrapAnchor('s1')
    table.ensureBootstrapAnchor('s2')

    const firstRows = table.getFirstEntriesBySessions(['s2', 'missing', 's1'])
    const firstIncarnation = JSON.parse(
      firstRows.find((row) => row.session_id === 's1')!.meta_json
    ).tapeIncarnationId
    const secondIncarnation = JSON.parse(
      firstRows.find((row) => row.session_id === 's2')!.meta_json
    ).tapeIncarnationId
    expect(firstIncarnation).toEqual(expect.any(String))
    expect(secondIncarnation).toEqual(expect.any(String))
    expect(secondIncarnation).not.toBe(firstIncarnation)

    lifecycle.deleteBySession('s1')
    table.ensureBootstrapAnchor('s1')
    const rebuiltIncarnation = JSON.parse(
      table.getFirstEntriesBySessions(['s1'])[0].meta_json
    ).tapeIncarnationId
    expect(rebuiltIncarnation).toEqual(expect.any(String))
    expect(rebuiltIncarnation).not.toBe(firstIncarnation)

    db.close()
  })

  it('deletes Tape and its mutation projection through the lifecycle adapter', () => {
    const db = new DatabaseCtor(':memory:')
    const projection = {
      applyAppendedEntry: vi.fn(() => true),
      invalidateSession: vi.fn(),
      deleteBySession: vi.fn()
    }
    const table = new DeepChatTapeEntriesTableCtor(db, projection)
    table.createTable()
    const lifecycle = new SqliteTapeLifecycleAdapterCtor(db, projection)
    table.ensureBootstrapAnchor('s1')

    lifecycle.deleteBySession('s1')

    expect(table.getBySession('s1')).toEqual([])
    expect(projection.deleteBySession).toHaveBeenCalledWith('s1')
    db.close()
  })

  it('rolls back Tape deletion when mutation projection cleanup fails', () => {
    const db = new DatabaseCtor(':memory:')
    const table = new DeepChatTapeEntriesTableCtor(db)
    table.createTable()
    table.ensureBootstrapAnchor('s1')
    const lifecycle = new SqliteTapeLifecycleAdapterCtor(db, {
      applyAppendedEntry: vi.fn(() => true),
      invalidateSession: vi.fn(),
      deleteBySession: vi.fn(() => {
        throw new Error('projection cleanup failed')
      })
    })

    expect(() => lifecycle.deleteBySession('s1')).toThrow('projection cleanup failed')
    expect(table.getBySession('s1')).toHaveLength(1)
    db.close()
  })

  it('tracks the latest summary-related anchor only within the requested session', () => {
    const { db, table } = createTable()

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      state: { summary: 'old', cursorOrderSeq: 3 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's2',
      name: 'compaction/manual',
      state: { summary: 'other', cursorOrderSeq: 8 },
      createdAt: 101
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'summary/reset',
      state: { cursorOrderSeq: 1, reason: 'summary_reset' },
      createdAt: 102
    })

    expect(table.getLatestSummaryAnchor('s1')).toMatchObject({
      session_id: 's1',
      name: 'summary/reset',
      entry_id: 3
    })
    expect(table.getLatestSummaryAnchor('s2')).toMatchObject({
      session_id: 's2',
      name: 'compaction/manual',
      entry_id: 1
    })

    db.close()
  })

  it('uses handoff anchors as reconstruction anchors without changing summary anchor lookup', () => {
    const { db, table } = createTable()

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/manual',
      state: { summary: 'old', cursorOrderSeq: 3 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/phase_done',
      state: { summary: 'handoff state', cursorOrderSeq: 8 },
      createdAt: 101
    })

    expect(table.getLatestSummaryAnchor('s1')).toMatchObject({
      name: 'compaction/manual',
      entry_id: 2
    })
    expect(table.getLatestReconstructionAnchor('s1')).toMatchObject({
      name: 'handoff/phase_done',
      entry_id: 3
    })

    db.close()
  })

  it('uses custom auto handoff anchors as reconstruction anchors', () => {
    const { db, table } = createTable()

    table.ensureBootstrapAnchor('s1')
    table.appendAnchor({
      sessionId: 's1',
      name: 'auto_handoff/custom',
      state: { summary: 'auto state', cursorOrderSeq: 8 },
      createdAt: 101
    })

    expect(table.getLatestReconstructionAnchor('s1')).toMatchObject({
      name: 'auto_handoff/custom',
      entry_id: 2
    })

    db.close()
  })

  it('resolves a committed compaction by attempt identity after a later handoff', () => {
    const { db, table } = createTable()

    table.ensureBootstrapAnchor('s1')
    const compactionAnchor = table.appendAnchor({
      sessionId: 's1',
      name: 'compaction/auto',
      state: {
        compactionAttemptId: 'attempt-1',
        summary: 'committed summary',
        cursorOrderSeq: 3
      },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/phase_done',
      state: { summary: 'later handoff', cursorOrderSeq: 8 },
      createdAt: 101
    })

    expect(table.getReconstructionAnchorByCompactionAttemptId('s1', 'attempt-1')).toMatchObject({
      name: 'compaction/auto',
      entry_id: compactionAnchor.entry_id
    })
    expect(table.getReconstructionAnchorByCompactionAttemptId('s1', 'missing')).toBeUndefined()
    expect(table.getReconstructionAnchorByCompactionAttemptId('s2', 'attempt-1')).toBeUndefined()

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT *
         FROM deepchat_tape_entries
         WHERE session_id = ?
           AND kind = 'anchor'
           AND (CASE WHEN json_valid(payload_json)
             THEN json_extract(payload_json, '$.state.compactionAttemptId') END) = ?
         ORDER BY entry_id DESC
         LIMIT 1`
      )
      .all('s1', 'attempt-1') as Array<{ detail: string }>
    expect(
      plan.some((row) => /idx_deepchat_tape_entries_compaction_attempt/i.test(row.detail))
    ).toBe(true)

    db.close()
  })

  it('lists recent anchors in chronological order after applying the limit', () => {
    const { db, table } = createTable()

    table.ensureBootstrapAnchor('s1')
    table.appendEvent({
      sessionId: 's1',
      name: 'run/ignored',
      data: { step: 1 },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/first',
      state: { summary: 'first' },
      createdAt: 101
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/second',
      state: { summary: 'second' },
      createdAt: 102
    })
    table.appendAnchor({
      sessionId: 's2',
      name: 'handoff/other',
      state: { summary: 'other' },
      createdAt: 103
    })

    expect(table.getAnchors('s1', 2).map((entry) => entry.name)).toEqual([
      'handoff/first',
      'handoff/second'
    ])

    db.close()
  })

  it('filters tape search by kind and created-at range', () => {
    const { db, table } = createTable()

    table.appendEvent({
      sessionId: 's1',
      name: 'run/auth',
      data: { text: 'auth event' },
      createdAt: 100
    })
    table.appendAnchor({
      sessionId: 's1',
      name: 'handoff/auth',
      state: { summary: 'auth anchor' },
      createdAt: 200
    })
    table.appendEvent({
      sessionId: 's2',
      name: 'run/auth',
      data: { text: 'auth other' },
      createdAt: 300
    })

    expect(
      table.search('s1', 'auth', {
        kinds: ['anchor'],
        startCreatedAt: 150
      })
    ).toMatchObject([{ session_id: 's1', kind: 'anchor', name: 'handoff/auth' }])
    expect(
      table.search('s1', 'auth', {
        endCreatedAt: 150
      })
    ).toMatchObject([{ session_id: 's1', kind: 'event', name: 'run/auth' }])

    db.close()
  })

  it('treats tape search query as literal text', () => {
    const { db, table } = createTable()

    table.appendEvent({
      sessionId: 's1',
      name: 'run/literal-percent',
      data: { text: '100% literal' },
      createdAt: 100
    })
    table.appendEvent({
      sessionId: 's1',
      name: 'run/literal-letter',
      data: { text: '100x literal' },
      createdAt: 101
    })

    expect(table.search('s1', '100%')).toMatchObject([
      { session_id: 's1', name: 'run/literal-percent' }
    ])

    db.close()
  })
})
