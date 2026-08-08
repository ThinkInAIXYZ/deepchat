import {
  DatabaseCtor,
  DeepChatExecutionJournalStore,
  DeepChatTapeEntriesTable,
  SessionTape,
  createTapeService,
  createTapeTableMock,
  describe,
  expect,
  it,
  itIfSqlite
} from '../session/data/tapeTestHarness'
import {
  EXECUTION_JOURNAL_EVENT_NAMES,
  ExecutionJournalCorruptionError,
  buildExecutionJournalMeta,
  buildExecutionOperationProvenanceKey,
  buildToolOutcomeData,
  classifyExecutionJournalRows,
  type ExecutionOperationIdentity
} from '@/tape/domain/executionJournal'
import {
  ExecutionJournalService,
  type ExecutionJournalCommitFailpoint
} from '@/tape/application/executionJournalService'
import { buildEffectiveTapeView, searchEffectiveTapeRows } from '@/tape/domain/effectiveView'
import { MainDatabase } from '@/data/mainDatabase'
import { SessionDatabase } from '@/session/data/database'
import { UNTERMINATED_EXECUTION_JOURNAL_EVENTS_SQL } from '@/tape/infrastructure/sqlite/tapeEntryStore'

const RUN_IDS = {
  notDispatched: '11111111-1111-4111-8111-111111111111',
  completed: '22222222-2222-4222-8222-222222222222',
  indeterminate: '33333333-3333-4333-8333-333333333333',
  corruption: '44444444-4444-4444-8444-444444444444'
} as const

function operation(runId: string, providerToolCallId = 'call_0'): ExecutionOperationIdentity {
  return { runId, requestSeq: 1, providerToolCallId }
}

function classifyAllJournalRows(entries: ReturnType<typeof createTapeTableMock>['entries']) {
  return classifyExecutionJournalRows(
    entries.filter((entry) => EXECUTION_JOURNAL_EVENT_NAMES.some((name) => entry.name === name))
  )
}

function commitStarted(
  service: ReturnType<typeof createTapeService>,
  runId: string,
  messageId = 'assistant-1'
) {
  return service.commitRunStarted({
    sessionId: 'session-1',
    runId,
    messageId,
    runKind: 'loop',
    createdAt: 100
  })
}

function commitDispatch(
  service: ReturnType<typeof createTapeService>,
  runId: string,
  normalizedArguments: Record<string, unknown> = { path: '/tmp/file' }
) {
  return service.commitDispatch({
    sessionId: 'session-1',
    messageId: 'assistant-1',
    operation: operation(runId),
    toolName: 'write',
    toolSource: 'agent',
    normalizedArguments,
    target: { serverName: 'agent-filesystem', originalName: 'write' },
    createdAt: 110
  })
}

describe('Execution Journal domain and strict persistence', () => {
  it('treats an identical fact as idempotent and rejects a conflicting payload', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)

    expect(commitStarted(service, RUN_IDS.completed)).toMatchObject({ created: true })
    expect(
      service.commitRunStarted({
        sessionId: 'session-1',
        runId: RUN_IDS.completed,
        messageId: 'assistant-1',
        runKind: 'loop',
        createdAt: 999
      })
    ).toMatchObject({ created: false })
    expect(entries.filter((entry) => entry.name === 'execution/run_started')).toHaveLength(1)

    expect(() =>
      service.commitRunStarted({
        sessionId: 'session-1',
        runId: RUN_IDS.completed,
        messageId: 'different-message',
        runKind: 'loop'
      })
    ).toThrow(ExecutionJournalCorruptionError)
    expect(entries.filter((entry) => entry.name === 'execution/run_started')).toHaveLength(1)
  })

  it('requires native causal prerequisites in the same Tape', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)

    expect(() => commitDispatch(service, RUN_IDS.completed)).toThrow(
      /prerequisite execution\/run_started is missing/
    )

    commitStarted(service, RUN_IDS.completed)
    expect(() =>
      service.commitToolOutcome({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(RUN_IDS.completed),
        responseText: 'done',
        isError: false
      })
    ).toThrow(/prerequisite execution\/dispatch_committed is missing/)
  })

  it('detects an argument conflict without persisting raw arguments', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed, { token: 'secret-value', count: 1 })

    const dispatchRow = entries.find((entry) => entry.name === 'execution/dispatch_committed')!
    expect(dispatchRow.payload_json).not.toContain('secret-value')
    expect(dispatchRow.payload_json).toContain('argumentsHash')
    expect(() =>
      commitDispatch(service, RUN_IDS.completed, { token: 'different-value', count: 1 })
    ).toThrow(ExecutionJournalCorruptionError)
  })

  it('persists only an outcome fingerprint and error bit', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    const responseText = `secret-result:${'x'.repeat(256_001)}`

    service.commitToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed),
      responseText,
      isError: false
    })

    const outcome = entries.find((entry) => entry.name === 'execution/tool_outcome')!
    const data = JSON.parse(outcome.payload_json).data
    expect(outcome.payload_json).not.toContain('secret-result')
    expect(data).not.toHaveProperty('responseText')
    expect(data).not.toHaveProperty('offloadPath')
    expect(data).toEqual(
      expect.objectContaining({
        responseHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        isError: false
      })
    )
  })

  it('uses the response hash to distinguish idempotent and conflicting outcomes', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    const input = {
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed),
      responseText: 'done',
      isError: false
    }

    expect(service.commitToolOutcome(input)).toMatchObject({ created: true })
    expect(service.commitToolOutcome(input)).toMatchObject({ created: false })
    expect(() =>
      service.commitToolOutcome({
        ...input,
        responseText: 'different'
      })
    ).toThrow(ExecutionJournalCorruptionError)
    expect(entries.filter((entry) => entry.name === 'execution/tool_outcome')).toHaveLength(1)
  })

  it('propagates persistence failures and rolls back the journal fact', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    table.appendExecutionJournalEvent.mockImplementationOnce(() => {
      throw new Error('disk write failed')
    })

    expect(() => commitDispatch(service, RUN_IDS.completed)).toThrow(
      /Failed to persist execution\/dispatch_committed/
    )
    expect(entries.some((entry) => entry.name === 'execution/dispatch_committed')).toBe(false)
  })

  it('rejects journal commits owned by an active host transaction', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)

    expect(() =>
      table.runInTransaction(() =>
        service.commitRunStarted({
          sessionId: 'session-1',
          runId: RUN_IDS.completed,
          messageId: 'assistant-1',
          runKind: 'loop'
        })
      )
    ).toThrow(/inside an active host transaction/)
    expect(entries.some((entry) => entry.name === 'execution/run_started')).toBe(false)
  })

  it('reaches commit failpoints outside the storage transaction', () => {
    const { table } = createTapeTableMock()
    const timeline: string[] = []
    table.runInTransaction.mockImplementation((operation: () => unknown) => {
      timeline.push('transaction:begin')
      const result = operation()
      timeline.push('transaction:committed')
      return result
    })
    const failpoint: ExecutionJournalCommitFailpoint = {
      reach: ({ phase }) => timeline.push(`failpoint:${phase}`)
    }
    const service = new ExecutionJournalService(() => table, failpoint)

    service.commitRunStarted({
      sessionId: 'session-1',
      runId: RUN_IDS.completed,
      messageId: 'assistant-1',
      runKind: 'loop'
    })

    expect(timeline).toEqual([
      'failpoint:before',
      'transaction:begin',
      'transaction:committed',
      'failpoint:after'
    ])
  })

  it('rejects non-JSON arguments and invalid timestamps before append', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() => commitDispatch(service, RUN_IDS.completed, circular)).toThrow(
      /must be JSON serializable/
    )
    expect(() => commitDispatch(service, RUN_IDS.completed, { optional: undefined })).toThrow(
      /must be JSON serializable/
    )
    expect(() =>
      service.commitRunTerminal({
        sessionId: 'session-1',
        runId: RUN_IDS.completed,
        messageId: 'assistant-1',
        outcome: 'error',
        stopReason: 'test',
        createdAt: -1
      })
    ).toThrow(/createdAt must be a non-negative safe integer/)
    expect(entries.filter((entry) => entry.name?.startsWith('execution/'))).toHaveLength(1)
  })

  it('stores only a hash of terminal error details', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    const errorMessage = `authorization secret-value ${'x'.repeat(8_192)}`

    service.commitRunTerminal({
      sessionId: 'session-1',
      runId: RUN_IDS.completed,
      messageId: 'assistant-1',
      outcome: 'error',
      stopReason: 'provider_error',
      errorMessage
    })

    const terminal = entries.find((entry) => entry.name === 'execution/run_terminal')!
    expect(terminal.payload_json).not.toContain('secret-value')
    expect(terminal.payload_json).not.toContain(errorMessage)
    expect(terminal.payload_json).toContain('errorHash')
    expect(classifyAllJournalRows(entries)).toContainEqual(
      expect.objectContaining({
        runId: RUN_IDS.completed,
        classification: 'not_dispatched',
        terminalOutcome: 'error'
      })
    )
  })

  it('keeps journal facts out of default Context Tape views and search', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    table.appendEvent({
      sessionId: 'session-1',
      name: 'context/example',
      data: { marker: 'context-search-marker' }
    })
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    service.commitToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed),
      responseText: 'journal-search-marker',
      isError: false
    })

    const defaultNames = buildEffectiveTapeView(entries).rows.map((row) => row.name)
    expect(defaultNames).toContain('context/example')
    expect(
      defaultNames.some((rowName) => EXECUTION_JOURNAL_EVENT_NAMES.some((name) => name === rowName))
    ).toBe(false)
    expect(searchEffectiveTapeRows(entries, 'context-search-marker')).toHaveLength(1)
    expect(searchEffectiveTapeRows(entries, 'journal-search-marker')).toEqual([])
    expect(
      buildEffectiveTapeView(entries, { includeAuditEvents: true }).rows.filter((row) =>
        EXECUTION_JOURNAL_EVENT_NAMES.some((name) => name === row.name)
      )
    ).toHaveLength(3)
  })

  itIfSqlite('keeps journal facts out of linked SQL search and context', () => {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatExecutionJournalStore(db)
      table.createTable()
      table.ensureBootstrapAnchor('linked-session')
      const contextEntry = table.appendEvent({
        sessionId: 'linked-session',
        name: 'context/before',
        data: { marker: 'linked-context-marker' }
      })
      for (const name of EXECUTION_JOURNAL_EVENT_NAMES) {
        table.appendExecutionJournalEvent({
          sessionId: 'linked-session',
          name,
          data: { marker: 'linked-journal-marker' }
        })
      }
      table.appendEvent({
        sessionId: 'linked-session',
        name: 'context/after',
        data: { marker: 'linked-context-marker' }
      })
      const source = {
        sessionId: 'linked-session',
        maxEntryId: table.getMaxEntryId('linked-session')
      }

      expect(table.searchEffectiveSourcesAtHeads([source], 'linked-journal-marker')).toEqual([])
      expect(table.searchEffectiveSourcesAtHeads([source], 'linked-context-marker')).toHaveLength(2)

      const contextNames = table
        .getEffectiveContextRowsAtHead(source, [contextEntry.entry_id], {
          before: 0,
          after: 10,
          limit: 20
        })
        .map((row) => row.name)
      expect(contextNames).toContain('context/before')
      expect(contextNames).toContain('context/after')
      expect(
        contextNames.some((name) => EXECUTION_JOURNAL_EVENT_NAMES.some((event) => event === name))
      ).toBe(false)
    } finally {
      db.close()
    }
  })

  it('rejects new operation facts after a Run terminal while preserving idempotent retries', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    const pendingOperation = operation(RUN_IDS.completed, 'call_1')
    service.commitDispatch({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: pendingOperation,
      toolName: 'write',
      toolSource: 'agent',
      normalizedArguments: { pending: true },
      target: { serverName: 'agent-filesystem' }
    })
    service.commitToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed),
      responseText: 'done',
      isError: false
    })
    service.commitRunTerminal({
      sessionId: 'session-1',
      runId: RUN_IDS.completed,
      messageId: 'assistant-1',
      outcome: 'aborted',
      stopReason: 'test_abort'
    })

    expect(commitDispatch(service, RUN_IDS.completed)).toMatchObject({ created: false })
    expect(() =>
      service.commitToolOutcome({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: pendingOperation,
        responseText: 'late',
        isError: false
      })
    ).toThrow(/after run_terminal/)
    expect(() =>
      service.commitDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(RUN_IDS.completed, 'call_2'),
        toolName: 'write',
        toolSource: 'agent',
        normalizedArguments: {},
        target: { serverName: 'agent-filesystem' }
      })
    ).toThrow(/after run_terminal/)
  })

  it('preserves prototype-shaped argument keys in the canonical dispatch hash', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)

    commitDispatch(service, RUN_IDS.completed, JSON.parse('{"__proto__":{"allowed":true}}'))

    expect(() => commitDispatch(service, RUN_IDS.completed, {})).toThrow(
      ExecutionJournalCorruptionError
    )
  })

  it('rejects unsupported nested identity and target fields', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)

    expect(() =>
      service.commitDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: { ...operation(RUN_IDS.completed), invocationId: 'unsupported' } as never,
        toolName: 'write',
        toolSource: 'agent',
        normalizedArguments: {},
        target: { serverName: 'agent-filesystem' }
      })
    ).toThrow(/operation has unsupported or missing fields/)
    expect(() =>
      service.commitDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(RUN_IDS.completed),
        toolName: 'write',
        toolSource: 'agent',
        normalizedArguments: {},
        target: { serverName: 'agent-filesystem', endpoint: 'unsupported' } as never
      })
    ).toThrow(/target has unsupported or missing fields/)
  })

  it('classifies native facts into all four recovery states', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)

    commitStarted(service, RUN_IDS.notDispatched)

    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    service.commitToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed),
      responseText: 'done',
      isError: false,
      createdAt: 120
    })

    commitStarted(service, RUN_IDS.indeterminate)
    commitDispatch(service, RUN_IDS.indeterminate)

    const orphanOperation = operation(RUN_IDS.corruption)
    const orphanData = buildToolOutcomeData({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: orphanOperation,
      responseText: 'orphan',
      isError: true
    })
    table.appendExecutionJournalEvent({
      sessionId: 'session-1',
      name: 'execution/tool_outcome',
      source: { type: 'runtime_event', id: RUN_IDS.corruption, seq: 1 },
      provenanceKey: buildExecutionOperationProvenanceKey(orphanOperation, 'outcome'),
      data: orphanData,
      meta: buildExecutionJournalMeta()
    })

    expect(classifyAllJournalRows(entries)).toEqual([
      expect.objectContaining({
        runId: RUN_IDS.notDispatched,
        classification: 'not_dispatched',
        dispatchCount: 0,
        outcomeCount: 0
      }),
      expect.objectContaining({
        runId: RUN_IDS.completed,
        classification: 'completed',
        dispatchCount: 1,
        outcomeCount: 1
      }),
      expect.objectContaining({
        runId: RUN_IDS.indeterminate,
        classification: 'indeterminate',
        dispatchCount: 1,
        outcomeCount: 0
      }),
      expect.objectContaining({
        runId: RUN_IDS.corruption,
        classification: 'corruption',
        reasons: expect.arrayContaining(['missing_run_started', 'outcome_without_dispatch'])
      })
    ])
  })

  it('treats an invalid outcome hash as corruption', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    service.commitToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed),
      responseText: 'done',
      isError: false
    })
    const outcome = entries.find((entry) => entry.name === 'execution/tool_outcome')!
    const payload = JSON.parse(outcome.payload_json)
    payload.data.responseHash = 'not-a-sha-256'
    outcome.payload_json = JSON.stringify(payload)

    expect(
      classifyExecutionJournalRows(
        entries.filter((entry) => EXECUTION_JOURNAL_EVENT_NAMES.includes(entry.name))
      )
    ).toContainEqual(
      expect.objectContaining({ runId: RUN_IDS.completed, classification: 'corruption' })
    )
  })

  it('treats unsupported fields and facts appended after a terminal as corruption', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    service.commitRunTerminal({
      sessionId: 'session-1',
      runId: RUN_IDS.completed,
      messageId: 'assistant-1',
      outcome: 'completed',
      stopReason: 'end_turn'
    })

    const started = entries.find((entry) => entry.name === 'execution/run_started')!
    const startedPayload = JSON.parse(started.payload_json)
    startedPayload.data.unsupported = true
    started.payload_json = JSON.stringify(startedPayload)

    const lateDispatch = buildExecutionOperationProvenanceKey(
      operation(RUN_IDS.completed),
      'dispatch'
    )
    table.appendExecutionJournalEvent({
      sessionId: 'session-1',
      name: 'execution/dispatch_committed',
      source: { type: 'runtime_event', id: RUN_IDS.completed, seq: 1 },
      provenanceKey: lateDispatch,
      data: {
        protocolVersion: 1,
        operation: operation(RUN_IDS.completed),
        messageId: 'assistant-1',
        toolName: 'write',
        toolSource: 'agent',
        argumentsHash: '0'.repeat(64),
        target: { serverName: 'agent-filesystem' }
      },
      meta: buildExecutionJournalMeta()
    })

    expect(classifyAllJournalRows(entries)).toContainEqual(
      expect.objectContaining({
        runId: RUN_IDS.completed,
        classification: 'corruption',
        reasons: expect.arrayContaining(['fact_after_run_terminal'])
      })
    )
  })

  it('treats a Run UUID reused across Sessions as corruption', () => {
    const first = createTapeTableMock()
    const firstService = createTapeService(first.table)
    commitStarted(firstService, RUN_IDS.completed)

    const second = createTapeTableMock()
    const secondService = createTapeService(second.table)
    secondService.commitRunStarted({
      sessionId: 'session-2',
      runId: RUN_IDS.completed,
      messageId: 'assistant-2',
      runKind: 'loop'
    })

    const rows = [...first.entries, ...second.entries].filter((entry) =>
      EXECUTION_JOURNAL_EVENT_NAMES.includes(entry.name)
    )
    expect(classifyExecutionJournalRows(rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'session-1',
          classification: 'corruption',
          reasons: expect.arrayContaining(['run_identity_reused_across_sessions'])
        }),
        expect.objectContaining({
          sessionId: 'session-2',
          classification: 'corruption',
          reasons: expect.arrayContaining(['run_identity_reused_across_sessions'])
        })
      ])
    )
  })
})

itIfSqlite('loads only unterminated Runs through the dedicated SQLite index', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const table = new DeepChatExecutionJournalStore(db)
    table.createTable()
    const service = new ExecutionJournalService(() => table)

    table.appendEvent({ sessionId: 'session-1', name: 'context/example', data: { value: 1 } })
    service.commitRunStarted({
      sessionId: 'session-1',
      runId: RUN_IDS.completed,
      messageId: 'assistant-1',
      runKind: 'loop'
    })
    service.commitRunTerminal({
      sessionId: 'session-1',
      runId: RUN_IDS.completed,
      messageId: 'assistant-1',
      outcome: 'completed',
      stopReason: 'end_turn'
    })
    service.commitRunStarted({
      sessionId: 'session-1',
      runId: RUN_IDS.indeterminate,
      messageId: 'assistant-2',
      runKind: 'loop'
    })
    service.commitDispatch({
      sessionId: 'session-1',
      messageId: 'assistant-2',
      operation: operation(RUN_IDS.indeterminate),
      toolName: 'write',
      toolSource: 'agent',
      normalizedArguments: {},
      target: { serverName: 'agent-filesystem' }
    })

    expect([...table.listUnterminatedRunEvents()].map((row) => row.name)).toEqual([
      'execution/run_started',
      'execution/dispatch_committed'
    ])
    expect(service.classifyRecoveryCandidates()).toEqual([
      expect.objectContaining({
        runId: RUN_IDS.indeterminate,
        classification: 'indeterminate'
      })
    ])
    const indexes = db.prepare("PRAGMA index_list('deepchat_tape_entries')").all() as Array<{
      name: string
    }>
    expect(indexes.map((index) => index.name)).toContain('idx_deepchat_tape_entries_execution_run')
    const queryPlan = db
      .prepare(`EXPLAIN QUERY PLAN ${UNTERMINATED_EXECUTION_JOURNAL_EVENTS_SQL}`)
      .all() as Array<{ detail: string }>
    const planDetails = queryPlan.map((step) => step.detail).join('\n')
    expect(planDetails).toMatch(
      /SEARCH started USING (?:COVERING )?INDEX idx_deepchat_tape_entries_execution_run/
    )
    expect(planDetails).toMatch(
      /SEARCH terminal USING (?:COVERING )?INDEX idx_deepchat_tape_entries_execution_run/
    )
    expect(planDetails).toMatch(
      /SEARCH journal USING (?:COVERING )?INDEX idx_deepchat_tape_entries_(?:execution_run|session_source)/
    )
  } finally {
    db.close()
  }
})

itIfSqlite('resolves the current Journal store after the application database reopens', () => {
  const connection = new MainDatabase(':memory:')
  try {
    const tape = new SessionTape(new SessionDatabase(connection))
    expect(
      tape.commitRunStarted({
        sessionId: 'session-1',
        runId: RUN_IDS.completed,
        messageId: 'assistant-1',
        runKind: 'loop'
      })
    ).toMatchObject({ created: true })

    connection.reopen()

    expect(
      tape.commitRunStarted({
        sessionId: 'session-1',
        runId: RUN_IDS.indeterminate,
        messageId: 'assistant-2',
        runKind: 'loop'
      })
    ).toMatchObject({ created: true })
  } finally {
    connection.close()
  }
})

itIfSqlite('reserves execution event names for the strict writer', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const table = new DeepChatTapeEntriesTable(db)
    table.createTable()
    expect('appendExecutionJournalEvent' in table).toBe(false)
    expect('listUnterminatedRunEvents' in table).toBe(false)

    expect(() =>
      table.appendEvent({
        sessionId: 'session-1',
        name: 'execution/run_started',
        data: { reconstructed: true }
      })
    ).toThrow('reserved for the strict Execution Journal writer')
    expect(() =>
      table.append({
        sessionId: 'session-1',
        kind: 'event',
        name: 'execution/tool_outcome',
        payload: { name: 'execution/tool_outcome', data: { reconstructed: true } }
      })
    ).toThrow('reserved for the strict Execution Journal writer')
    expect(table.getBySession('session-1')).toEqual([])
  } finally {
    db.close()
  }
})

itIfSqlite('rejects Journal commits owned by an active host transaction', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const table = new DeepChatExecutionJournalStore(db)
    table.createTable()
    const service = new ExecutionJournalService(() => table)

    db.transaction(() => {
      expect(() =>
        service.commitRunStarted({
          sessionId: 'session-1',
          runId: RUN_IDS.completed,
          messageId: 'assistant-1',
          runKind: 'loop'
        })
      ).toThrow('inside an active host transaction')
    })()

    expect(table.getBySession('session-1')).toEqual([])
  } finally {
    db.close()
  }
})
