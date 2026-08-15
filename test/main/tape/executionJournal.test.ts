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
  EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION,
  EXECUTION_JOURNAL_EVENT_NAMES,
  MAX_EXECUTION_JOURNAL_NESTED_CHILDREN,
  CommittedToolOutcomeProjectionError,
  ExecutionJournalCorruptionError,
  buildExecutionOperationKey,
  buildExecutionJournalMeta,
  buildExecutionOperationProvenanceKey,
  buildExecutionRunProvenanceKey,
  buildNestedDispatchData,
  buildNestedExecutionJournalMeta,
  buildNestedExecutionOperationProvenanceKey,
  buildRunTerminalData,
  buildToolOutcomeData,
  classifyExecutionJournalRows,
  parseExecutionJournalFact,
  type NestedExecutionOperationIdentity,
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

function nestedOperation(
  runId: string,
  childOrdinal: number,
  providerToolCallId = 'call_0'
): NestedExecutionOperationIdentity {
  return { kind: 'nested', runId, requestSeq: 1, providerToolCallId, childOrdinal }
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

function commitNestedDispatch(
  table: ReturnType<typeof createTapeTableMock>['table'],
  runId: string,
  childOrdinal: number,
  normalizedArguments: Record<string, unknown> = { query: 'hello' }
) {
  return new ExecutionJournalService(() => table).commitNestedDispatch({
    sessionId: 'session-1',
    messageId: 'assistant-1',
    operation: nestedOperation(runId, childOrdinal),
    toolName: 'search',
    toolSource: 'mcp',
    normalizedArguments,
    target: { serverName: 'search-server', originalName: 'search' },
    definitionHash: '1'.repeat(64),
    capabilityHash: '2'.repeat(64),
    createdAt: 115
  })
}

describe('Execution Journal domain and strict persistence', () => {
  it('preserves provider projection errors and identifies nested child projections', () => {
    const providerError = new CommittedToolOutcomeProjectionError(operation(RUN_IDS.completed), {
      cause: new Error('provider projection failed')
    })
    expect(providerError.message).toBe(
      'Tool outcome was committed for operation {"providerToolCallId":"call_0","requestSeq":1,"runId":"22222222-2222-4222-8222-222222222222"}, but its projection failed.'
    )
    expect(providerError).toMatchObject({
      name: 'CommittedToolOutcomeProjectionError',
      code: 'projection_failed',
      cause: expect.objectContaining({ message: 'provider projection failed' })
    })

    const nestedError = new CommittedToolOutcomeProjectionError(
      nestedOperation(RUN_IDS.completed, 3),
      { cause: new Error('nested projection failed') }
    )
    expect(nestedError.message).toContain('"kind":"nested"')
    expect(nestedError.message).toContain('"childOrdinal":3')
    expect(nestedError).toMatchObject({
      name: 'CommittedToolOutcomeProjectionError',
      code: 'projection_failed',
      cause: expect.objectContaining({ message: 'nested projection failed' })
    })
  })

  it('preserves the historical provider operation hash and provenance recipe', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const providerOperation = operation(RUN_IDS.completed)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)

    expect(buildExecutionOperationKey(providerOperation)).toBe(
      'd1cab8bbe6ac156d881c16de78004630a6ea27330bc13a5df5267ca6db2045d9'
    )
    expect(buildExecutionOperationProvenanceKey(providerOperation, 'dispatch')).toBe(
      'execution:v1:operation:d1cab8bbe6ac156d881c16de78004630a6ea27330bc13a5df5267ca6db2045d9:dispatch'
    )
    expect(
      buildNestedExecutionOperationProvenanceKey(nestedOperation(RUN_IDS.completed, 0), 'dispatch')
    ).toBe(
      'execution:v2:parent:d1cab8bbe6ac156d881c16de78004630a6ea27330bc13a5df5267ca6db2045d9:operation:8884a0b78e1d9d67dda1eebeb044a7cbf7b48465656532eace06c4e6c1ce40fd:dispatch'
    )
    const dispatch = entries.find((entry) => entry.name === 'execution/dispatch_committed')!
    expect(dispatch.payload_json).toBe(
      '{"name":"execution/dispatch_committed","data":{"protocolVersion":1,"operation":{"runId":"22222222-2222-4222-8222-222222222222","requestSeq":1,"providerToolCallId":"call_0"},"messageId":"assistant-1","toolName":"write","toolSource":"agent","argumentsHash":"04f797c908085c44ced0a5a66a713836879515ba437b2ec21abdbe5eb2cb5dae","target":{"serverName":"agent-filesystem","originalName":"write"}}}'
    )
    expect(dispatch.meta_json).toBe('{"factFamily":"execution_journal","protocolVersion":1}')
    expect('commitNestedDispatch' in service).toBe(false)
  })

  it('persists sibling nested operations under distinct v2 identities without raw payloads', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)

    expect(commitNestedDispatch(table, RUN_IDS.completed, 0)).toMatchObject({ created: true })
    expect(commitNestedDispatch(table, RUN_IDS.completed, 1)).toMatchObject({ created: true })

    const nestedRows = entries.filter((entry) => {
      if (entry.name !== 'execution/dispatch_committed') return false
      return (
        JSON.parse(entry.meta_json).protocolVersion === EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION
      )
    })
    expect(nestedRows).toHaveLength(2)
    expect(new Set(nestedRows.map((entry) => entry.provenance_key))).toHaveLength(2)
    expect(nestedRows.every((entry) => entry.provenance_key.startsWith('execution:v2:'))).toBe(true)
    expect(nestedRows.every((entry) => !entry.payload_json.includes('hello'))).toBe(true)
    expect(nestedRows.map(parseExecutionJournalFact)).toEqual([
      expect.objectContaining({
        protocolVersion: 2,
        operation: expect.objectContaining({ kind: 'nested', childOrdinal: 0 }),
        definitionHash: '1'.repeat(64),
        capabilityHash: '2'.repeat(64)
      }),
      expect.objectContaining({
        protocolVersion: 2,
        operation: expect.objectContaining({ kind: 'nested', childOrdinal: 1 })
      })
    ])
  })

  it('treats a reused nested identity with different canonical payload as corruption', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    expect(commitNestedDispatch(table, RUN_IDS.completed, 0)).toMatchObject({ created: true })
    expect(commitNestedDispatch(table, RUN_IDS.completed, 0)).toMatchObject({ created: false })

    expect(() => commitNestedDispatch(table, RUN_IDS.completed, 0, { query: 'different' })).toThrow(
      ExecutionJournalCorruptionError
    )
  })

  it('uses a new provider operation identity for an explicit model retry', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    const nestedService = new ExecutionJournalService(() => table)
    commitStarted(service, RUN_IDS.completed)

    for (const providerToolCallId of ['call_0', 'call_1']) {
      service.commitDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(RUN_IDS.completed, providerToolCallId),
        toolName: 'exec',
        toolSource: 'agent',
        normalizedArguments: { command: 'deepchat tool call' },
        target: { serverName: 'agent-filesystem', originalName: 'exec' }
      })
      nestedService.commitNestedDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: nestedOperation(RUN_IDS.completed, 0, providerToolCallId),
        toolName: 'search',
        toolSource: 'mcp',
        normalizedArguments: { query: 'hello' },
        target: { serverName: 'search-server', originalName: 'search' },
        definitionHash: '1'.repeat(64),
        capabilityHash: '2'.repeat(64)
      })
      nestedService.commitNestedToolOutcome({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: nestedOperation(RUN_IDS.completed, 0, providerToolCallId),
        responseText: 'child result',
        isError: false
      })
      service.commitToolOutcome({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(RUN_IDS.completed, providerToolCallId),
        responseText: 'outer result',
        isError: false
      })
    }

    const nestedDispatches = entries.filter(
      (entry) =>
        entry.name === 'execution/dispatch_committed' &&
        JSON.parse(entry.meta_json).protocolVersion === EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION
    )
    expect(nestedDispatches).toHaveLength(2)
    expect(new Set(nestedDispatches.map((entry) => entry.provenance_key))).toHaveLength(2)
    expect(nestedDispatches.map(parseExecutionJournalFact)).toEqual([
      expect.objectContaining({
        operation: expect.objectContaining({ providerToolCallId: 'call_0', childOrdinal: 0 })
      }),
      expect.objectContaining({
        operation: expect.objectContaining({ providerToolCallId: 'call_1', childOrdinal: 0 })
      })
    ])
  })

  it('bounds nested child ordinals and rejects v2 fields in the v1 identity parser', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)

    for (const childOrdinal of [
      -1,
      MAX_EXECUTION_JOURNAL_NESTED_CHILDREN,
      Number.MAX_SAFE_INTEGER
    ]) {
      expect(() => commitNestedDispatch(table, RUN_IDS.completed, childOrdinal)).toThrow(
        /childOrdinal/
      )
    }
    expect(() =>
      service.commitDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: nestedOperation(RUN_IDS.completed, 0),
        toolName: 'search',
        toolSource: 'mcp',
        normalizedArguments: {},
        target: { serverName: 'search-server' }
      })
    ).toThrow(/operation has unsupported or missing fields/)
  })

  it('enforces parent T1 and nested settlement before parent T2 and Run terminal', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)

    expect(() => commitNestedDispatch(table, RUN_IDS.completed, 0)).toThrow(
      /prerequisite execution\/dispatch_committed is missing/
    )

    commitDispatch(service, RUN_IDS.completed)
    commitNestedDispatch(table, RUN_IDS.completed, 0)
    expect(() =>
      service.commitToolOutcome({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(RUN_IDS.completed),
        responseText: 'outer done',
        isError: false
      })
    ).toThrow(/unsettled nested operation/)
    expect(() =>
      service.commitRunTerminal({
        sessionId: 'session-1',
        runId: RUN_IDS.completed,
        messageId: 'assistant-1',
        outcome: 'completed',
        stopReason: 'complete'
      })
    ).toThrow(/unsettled nested causality/)

    new ExecutionJournalService(() => table).commitNestedToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: nestedOperation(RUN_IDS.completed, 0),
      responseText: 'child done',
      isError: false
    })
    expect(() =>
      service.commitRunTerminal({
        sessionId: 'session-1',
        runId: RUN_IDS.completed,
        messageId: 'assistant-1',
        outcome: 'completed',
        stopReason: 'complete'
      })
    ).toThrow(/unsettled nested causality/)

    service.commitToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed),
      responseText: 'outer done',
      isError: false
    })
    expect(
      service.commitRunTerminal({
        sessionId: 'session-1',
        runId: RUN_IDS.completed,
        messageId: 'assistant-1',
        outcome: 'completed',
        stopReason: 'complete'
      })
    ).toMatchObject({ created: true })
  })

  it('rejects new nested facts after the parent outcome while preserving idempotent receipts', () => {
    const { table } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    commitNestedDispatch(table, RUN_IDS.completed, 0)
    const nestedService = new ExecutionJournalService(() => table)
    const nestedOutcome = {
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: nestedOperation(RUN_IDS.completed, 0),
      responseText: 'child done',
      isError: false
    }
    nestedService.commitNestedToolOutcome(nestedOutcome)
    service.commitToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed),
      responseText: 'outer done',
      isError: false
    })

    expect(commitNestedDispatch(table, RUN_IDS.completed, 0)).toMatchObject({ created: false })
    expect(nestedService.commitNestedToolOutcome(nestedOutcome)).toMatchObject({ created: false })
    expect(() => commitNestedDispatch(table, RUN_IDS.completed, 1)).toThrow(/parent outcome/)
    expect(() =>
      nestedService.commitNestedToolOutcome({ ...nestedOutcome, responseText: 'conflicting child' })
    ).toThrow(ExecutionJournalCorruptionError)
  })

  it('fails parent settlement closed when nested source identity fields are corrupt', () => {
    for (const corrupt of [
      (row: Record<string, unknown>) => (row.source_type = 'invalid'),
      (row: Record<string, unknown>) => (row.source_id = RUN_IDS.corruption),
      (row: Record<string, unknown>) => (row.source_seq = 999)
    ]) {
      const { table, entries } = createTapeTableMock()
      const service = createTapeService(table)
      commitStarted(service, RUN_IDS.completed)
      commitDispatch(service, RUN_IDS.completed)
      commitNestedDispatch(table, RUN_IDS.completed, 0)
      const nestedRow = entries.find(
        (entry) =>
          entry.name === 'execution/dispatch_committed' &&
          JSON.parse(entry.meta_json).protocolVersion === 2
      )!
      corrupt(nestedRow)

      expect(() =>
        service.commitToolOutcome({
          sessionId: 'session-1',
          messageId: 'assistant-1',
          operation: operation(RUN_IDS.completed),
          responseText: 'outer done',
          isError: false
        })
      ).toThrow(ExecutionJournalCorruptionError)
      expect(() =>
        service.commitRunTerminal({
          sessionId: 'session-1',
          runId: RUN_IDS.completed,
          messageId: 'assistant-1',
          outcome: 'error',
          stopReason: 'journal_failure'
        })
      ).toThrow(ExecutionJournalCorruptionError)
    }
  })

  it('finds a nested fact by parent provenance when row and payload Run IDs are corrupt', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    commitNestedDispatch(table, RUN_IDS.completed, 0)
    const nestedRow = entries.find(
      (entry) =>
        entry.name === 'execution/dispatch_committed' &&
        JSON.parse(entry.meta_json).protocolVersion === 2
    )!
    nestedRow.source_id = RUN_IDS.corruption
    const payload = JSON.parse(nestedRow.payload_json)
    payload.data.operation.runId = RUN_IDS.corruption
    nestedRow.payload_json = JSON.stringify(payload)

    expect(() =>
      service.commitRunTerminal({
        sessionId: 'session-1',
        runId: RUN_IDS.completed,
        messageId: 'assistant-1',
        outcome: 'error',
        stopReason: 'journal_failure'
      })
    ).toThrow(ExecutionJournalCorruptionError)
    const reports = service.classifyRecoveryCandidates()
    expect(reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: RUN_IDS.completed,
          classification: 'corruption'
        })
      ])
    )
    expect(reports.some((report) => report.runId === RUN_IDS.corruption)).toBe(false)
  })

  it('finds a nested fact by source identity when provenance and payload parent IDs are corrupt', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    commitNestedDispatch(table, RUN_IDS.completed, 0)
    const nestedRow = entries.find(
      (entry) =>
        entry.name === 'execution/dispatch_committed' &&
        JSON.parse(entry.meta_json).protocolVersion === 2
    )!
    nestedRow.provenance_key = 'corrupt-provenance'
    const payload = JSON.parse(nestedRow.payload_json)
    payload.data.operation.providerToolCallId = 'corrupt-parent'
    nestedRow.payload_json = JSON.stringify(payload)

    expect(() =>
      service.commitToolOutcome({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(RUN_IDS.completed),
        responseText: 'outer done',
        isError: false
      })
    ).toThrow(ExecutionJournalCorruptionError)
  })

  it('rejects outer T2 when persisted child T2 precedes child T1', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.completed)
    commitDispatch(service, RUN_IDS.completed)
    commitNestedDispatch(table, RUN_IDS.completed, 0)
    new ExecutionJournalService(() => table).commitNestedToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: nestedOperation(RUN_IDS.completed, 0),
      responseText: 'child done',
      isError: false
    })
    const nestedRows = entries.filter(
      (entry) =>
        JSON.parse(entry.meta_json).protocolVersion === 2 &&
        (entry.name === 'execution/dispatch_committed' || entry.name === 'execution/tool_outcome')
    )
    const dispatch = nestedRows.find((entry) => entry.name === 'execution/dispatch_committed')!
    const outcome = nestedRows.find((entry) => entry.name === 'execution/tool_outcome')!
    outcome.entry_id = dispatch.entry_id - 1

    expect(() =>
      service.commitToolOutcome({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(RUN_IDS.completed),
        responseText: 'outer done',
        isError: false
      })
    ).toThrow(/reordered nested causality/)
  })

  it('classifies nested T1 without T2 as an indeterminate real operation', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.indeterminate)
    commitDispatch(service, RUN_IDS.indeterminate)
    commitNestedDispatch(table, RUN_IDS.indeterminate, 0)

    expect(classifyAllJournalRows(entries)).toContainEqual(
      expect.objectContaining({
        runId: RUN_IDS.indeterminate,
        classification: 'indeterminate',
        dispatchCount: 2,
        outcomeCount: 0,
        reasons: []
      })
    )
  })

  it('classifies a terminal persisted over an unsettled nested child as corruption', () => {
    const { table, entries } = createTapeTableMock()
    const service = createTapeService(table)
    commitStarted(service, RUN_IDS.corruption)
    commitDispatch(service, RUN_IDS.corruption)
    commitNestedDispatch(table, RUN_IDS.corruption, 0)
    const terminalData = buildRunTerminalData({
      sessionId: 'session-1',
      runId: RUN_IDS.corruption,
      messageId: 'assistant-1',
      outcome: 'error',
      stopReason: 'injected_terminal'
    })
    table.appendExecutionJournalEvent({
      sessionId: 'session-1',
      name: 'execution/run_terminal',
      source: { type: 'runtime_event', id: RUN_IDS.corruption, seq: 0 },
      provenanceKey: buildExecutionRunProvenanceKey(RUN_IDS.corruption, 'terminal'),
      data: terminalData,
      meta: buildExecutionJournalMeta()
    })

    expect(classifyAllJournalRows(entries)).toContainEqual(
      expect.objectContaining({
        runId: RUN_IDS.corruption,
        classification: 'corruption',
        reasons: expect.arrayContaining(['terminal_with_unsettled_nested'])
      })
    )
  })

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

  it('uses only the nested parent lookup for an ordinary provider outcome', () => {
    const { table } = createTapeTableMock()
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

    expect(table.listNestedOperationEventsForParent).toHaveBeenCalledOnce()
    expect(table.listNestedOperationEventsForRun).not.toHaveBeenCalled()
  })

  it('projects bounded nested audit without raw arguments or response text', () => {
    const { table } = createTapeTableMock()
    const service = new ExecutionJournalService(() => table)
    commitStarted(createTapeService(table), RUN_IDS.completed)
    commitDispatch(createTapeService(table), RUN_IDS.completed)
    commitNestedDispatch(table, RUN_IDS.completed, 0, { query: 'private query' })
    service.commitNestedToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: nestedOperation(RUN_IDS.completed, 0),
      responseText: 'private response',
      isError: false,
      createdAt: 120
    })
    commitNestedDispatch(table, RUN_IDS.completed, 1, { query: 'uncertain query' })

    const audit = service.listNestedExecutionAuditForMessage('session-1', 'assistant-1')

    expect(audit).toEqual({
      schemaVersion: 1,
      state: 'available',
      truncated: false,
      operations: [
        expect.objectContaining({
          childOrdinal: 0,
          toolName: 'search',
          status: 'success',
          responseHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          isError: false
        }),
        expect.objectContaining({
          childOrdinal: 1,
          toolName: 'search',
          status: 'indeterminate',
          outcomeEntryId: null,
          responseHash: null,
          isError: null
        })
      ]
    })
    expect(JSON.stringify(audit)).not.toContain('private query')
    expect(JSON.stringify(audit)).not.toContain('private response')
    expect(table.listNestedOperationEventsForMessage).toHaveBeenCalledWith(
      'session-1',
      'assistant-1',
      257
    )
  })

  it('fails nested audit closed for an outcome without its dispatch', () => {
    const { table, entries } = createTapeTableMock()
    const service = new ExecutionJournalService(() => table)
    commitStarted(createTapeService(table), RUN_IDS.completed)
    commitDispatch(createTapeService(table), RUN_IDS.completed)
    commitNestedDispatch(table, RUN_IDS.completed, 0)
    service.commitNestedToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: nestedOperation(RUN_IDS.completed, 0),
      responseText: 'done',
      isError: false
    })
    const dispatchIndex = entries.findIndex((entry) => {
      if (entry.name !== 'execution/dispatch_committed') return false
      const data = JSON.parse(entry.payload_json).data
      return data.protocolVersion === 2
    })
    entries.splice(dispatchIndex, 1)

    expect(() => service.listNestedExecutionAuditForMessage('session-1', 'assistant-1')).toThrow(
      ExecutionJournalCorruptionError
    )
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

itIfSqlite('finds an exact deferred dispatch even after its Run terminal commits', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const table = new DeepChatExecutionJournalStore(db)
    table.createTable()
    const service = new ExecutionJournalService(() => table)
    service.commitRunStarted({
      sessionId: 'session-1',
      runId: RUN_IDS.completed,
      messageId: 'assistant-1',
      runKind: 'deferred_tool'
    })
    service.commitDispatch({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed, 'deferred-call-1'),
      toolName: 'write',
      toolSource: 'agent',
      normalizedArguments: { path: '/tmp/file' },
      target: { serverName: 'agent-filesystem', originalName: 'write' }
    })
    service.commitToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed, 'deferred-call-1'),
      responseText: 'done',
      isError: false
    })
    service.commitRunTerminal({
      sessionId: 'session-1',
      runId: RUN_IDS.completed,
      messageId: 'assistant-1',
      outcome: 'completed',
      stopReason: 'complete'
    })

    expect(
      service.hasAnyCommittedDispatchForMessageToolCall(
        'session-1',
        'assistant-1',
        'deferred-call-1'
      )
    ).toBe(true)
    expect(
      service.hasAnyCommittedDispatchForMessageToolCall(
        'session-1',
        'assistant-1',
        'never-dispatched'
      )
    ).toBe(false)
    expect(
      service.hasAnyCommittedDispatchForMessageToolCall(
        'session-1',
        'another-message',
        'deferred-call-1'
      )
    ).toBe(false)
  } finally {
    db.close()
  }
})

itIfSqlite('does not treat a nested child as a spent deferred provider operation', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const table = new DeepChatExecutionJournalStore(db)
    table.createTable()
    table.ensureBootstrapAnchor('session-1')
    const child = nestedOperation(RUN_IDS.indeterminate, 0, 'deferred-call-1')
    const data = buildNestedDispatchData({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: child,
      toolName: 'search',
      toolSource: 'mcp',
      normalizedArguments: { query: 'hello' },
      target: { serverName: 'search-server', originalName: 'search' },
      definitionHash: '1'.repeat(64),
      capabilityHash: '2'.repeat(64)
    })
    table.appendExecutionJournalEvent({
      sessionId: 'session-1',
      name: 'execution/dispatch_committed',
      source: { type: 'runtime_event', id: child.runId, seq: child.requestSeq },
      provenanceKey: buildNestedExecutionOperationProvenanceKey(child, 'dispatch'),
      data,
      meta: buildNestedExecutionJournalMeta()
    })
    const service = new ExecutionJournalService(() => table)

    expect(
      service.hasAnyCommittedDispatchForMessageToolCall(
        'session-1',
        'assistant-1',
        'deferred-call-1'
      )
    ).toBe(false)
  } finally {
    db.close()
  }
})

itIfSqlite('fails deferred recovery closed for a malformed dispatch fact', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const table = new DeepChatExecutionJournalStore(db)
    table.createTable()
    const service = new ExecutionJournalService(() => table)
    service.commitRunStarted({
      sessionId: 'session-1',
      runId: RUN_IDS.indeterminate,
      messageId: 'assistant-1',
      runKind: 'deferred_tool'
    })
    service.commitDispatch({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.indeterminate, 'deferred-call-1'),
      toolName: 'write',
      toolSource: 'agent',
      normalizedArguments: { path: '/tmp/file' },
      target: { serverName: 'agent-filesystem', originalName: 'write' }
    })
    db.prepare(
      `UPDATE deepchat_tape_entries
       SET payload_json = '{'
       WHERE session_id = ? AND name = 'execution/dispatch_committed'`
    ).run('session-1')

    expect(() =>
      service.hasAnyCommittedDispatchForMessageToolCall(
        'session-1',
        'assistant-1',
        'deferred-call-1'
      )
    ).toThrow()
  } finally {
    db.close()
  }
})

itIfSqlite('conservatively fences the same provider tool-call ID across deferred Runs', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const table = new DeepChatExecutionJournalStore(db)
    table.createTable()
    const service = new ExecutionJournalService(() => table)
    for (const runId of [RUN_IDS.completed, RUN_IDS.indeterminate]) {
      service.commitRunStarted({
        sessionId: 'session-1',
        runId,
        messageId: 'assistant-1',
        runKind: 'deferred_tool'
      })
      service.commitDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(runId, 'deferred-call-1'),
        toolName: 'write',
        toolSource: 'agent',
        normalizedArguments: { path: '/tmp/file' },
        target: { serverName: 'agent-filesystem', originalName: 'write' }
      })
    }

    expect(
      service.hasAnyCommittedDispatchForMessageToolCall(
        'session-1',
        'assistant-1',
        'deferred-call-1'
      )
    ).toBe(true)
  } finally {
    db.close()
  }
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
    expect(planDetails).toMatch(
      /SEARCH nested USING INDEX idx_deepchat_tape_entries_execution_operation_payload/
    )
  } finally {
    db.close()
  }
})

itIfSqlite('loads complete nested audit pairs through the message index', () => {
  const db = new DatabaseCtor(':memory:')
  try {
    const table = new DeepChatExecutionJournalStore(db)
    table.createTable()
    const service = new ExecutionJournalService(() => table)
    service.commitRunStarted({
      sessionId: 'session-1',
      runId: RUN_IDS.completed,
      messageId: 'assistant-1',
      runKind: 'loop'
    })
    service.commitDispatch({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: operation(RUN_IDS.completed),
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call' },
      target: { serverName: 'agent-cli', originalName: 'exec' }
    })
    service.commitNestedDispatch({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: nestedOperation(RUN_IDS.completed, 0),
      toolName: 'search',
      toolSource: 'mcp',
      normalizedArguments: { query: 'hello' },
      target: { serverName: 'search-server', originalName: 'search' },
      definitionHash: '1'.repeat(64),
      capabilityHash: '2'.repeat(64)
    })
    service.commitNestedToolOutcome({
      sessionId: 'session-1',
      messageId: 'assistant-1',
      operation: nestedOperation(RUN_IDS.completed, 0),
      responseText: 'done',
      isError: false
    })

    expect(table.listNestedOperationEventsForMessage('session-1', 'assistant-1', 1)).toHaveLength(2)
    expect(
      service.listMessageIdsWithNestedExecutionAudit('session-1', [
        'assistant-1',
        'assistant-missing'
      ])
    ).toEqual(['assistant-1'])
    expect(service.listNestedExecutionAuditForMessage('session-1', 'assistant-1')).toMatchObject({
      state: 'available',
      operations: [{ childOrdinal: 0, status: 'success' }]
    })
    const indexes = db.prepare("PRAGMA index_list('deepchat_tape_entries')").all() as Array<{
      name: string
    }>
    expect(indexes.map((index) => index.name)).toContain(
      'idx_deepchat_tape_entries_execution_message_payload'
    )

    db.prepare(
      `UPDATE deepchat_tape_entries
       SET payload_json = json_set(payload_json, '$.data.messageId', 'assistant-other')
       WHERE provenance_key LIKE 'execution:v2:%:outcome'`
    ).run()
    expect(() => service.listNestedExecutionAuditForMessage('session-1', 'assistant-1')).toThrow(
      ExecutionJournalCorruptionError
    )
    db.prepare(
      `UPDATE deepchat_tape_entries
       SET payload_json = json_set(payload_json, '$.data.messageId', 'assistant-1')
       WHERE provenance_key LIKE 'execution:v2:%:outcome'`
    ).run()
    db.prepare(
      `UPDATE deepchat_tape_entries
       SET payload_json = json_set(payload_json, '$.data.protocolVersion', 1)
       WHERE provenance_key LIKE 'execution:v2:%:dispatch'`
    ).run()
    expect(() => service.listNestedExecutionAuditForMessage('session-1', 'assistant-1')).toThrow(
      ExecutionJournalCorruptionError
    )
  } finally {
    db.close()
  }
})

itIfSqlite('keeps malformed nested facts visible to startup recovery', () => {
  const corruptions: Array<(row: Record<string, unknown>) => void> = [
    (row) => (row.source_type = 'invalid'),
    (row) => (row.source_id = RUN_IDS.corruption),
    (row) => (row.source_seq = 999),
    (row) => {
      const payload = JSON.parse(row.payload_json as string)
      payload.data.operation.runId = RUN_IDS.corruption
      row.payload_json = JSON.stringify(payload)
    },
    (row) => {
      row.source_id = RUN_IDS.corruption
      const payload = JSON.parse(row.payload_json as string)
      payload.data.operation.runId = RUN_IDS.corruption
      row.payload_json = JSON.stringify(payload)
    },
    (row) => {
      row.provenance_key = 'corrupt-provenance'
      const payload = JSON.parse(row.payload_json as string)
      payload.data.operation.providerToolCallId = 'corrupt-parent'
      row.payload_json = JSON.stringify(payload)
    }
  ]

  for (const corrupt of corruptions) {
    const db = new DatabaseCtor(':memory:')
    try {
      const table = new DeepChatExecutionJournalStore(db)
      table.createTable()
      const service = new ExecutionJournalService(() => table)
      service.commitRunStarted({
        sessionId: 'session-1',
        runId: RUN_IDS.indeterminate,
        messageId: 'assistant-1',
        runKind: 'loop'
      })
      service.commitDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: operation(RUN_IDS.indeterminate),
        toolName: 'write',
        toolSource: 'agent',
        normalizedArguments: {},
        target: { serverName: 'agent-filesystem' }
      })
      new ExecutionJournalService(() => table).commitNestedDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: nestedOperation(RUN_IDS.indeterminate, 0),
        toolName: 'search',
        toolSource: 'mcp',
        normalizedArguments: { query: 'hello' },
        target: { serverName: 'search-server', originalName: 'search' },
        definitionHash: '1'.repeat(64),
        capabilityHash: '2'.repeat(64)
      })
      const row = db
        .prepare(
          `SELECT * FROM deepchat_tape_entries
           WHERE session_id = ?
             AND name = 'execution/dispatch_committed'
             AND json_extract(meta_json, '$.protocolVersion') = 2`
        )
        .get('session-1') as Record<string, unknown>
      corrupt(row)
      db.prepare(
        `UPDATE deepchat_tape_entries
         SET source_type = ?, source_id = ?, source_seq = ?, provenance_key = ?, payload_json = ?
         WHERE session_id = ? AND entry_id = ?`
      ).run(
        row.source_type,
        row.source_id,
        row.source_seq,
        row.provenance_key,
        row.payload_json,
        row.session_id,
        row.entry_id
      )

      expect(
        table
          .listNestedOperationEventsForParent(
            'session-1',
            RUN_IDS.indeterminate,
            1,
            'call_0',
            buildExecutionOperationKey(operation(RUN_IDS.indeterminate))
          )
          .map((candidate) => candidate.entry_id)
      ).toContain(row.entry_id)
      const reports = service.classifyRecoveryCandidates()
      expect(reports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runId: RUN_IDS.indeterminate,
            classification: 'corruption'
          })
        ])
      )
      expect(reports.some((report) => report.runId === RUN_IDS.corruption)).toBe(false)
    } finally {
      db.close()
    }
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
