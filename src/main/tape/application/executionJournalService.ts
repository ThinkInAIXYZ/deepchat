import {
  EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION,
  EXECUTION_JOURNAL_PROTOCOL_VERSION,
  ExecutionJournalCorruptionError,
  ExecutionJournalError,
  buildAnyExecutionOperationKey,
  buildDispatchData,
  buildExecutionJournalMeta,
  buildExecutionOperationKey,
  buildExecutionOperationProvenanceKey,
  buildExecutionRunProvenanceKey,
  buildNestedDispatchData,
  buildNestedExecutionJournalMeta,
  buildNestedExecutionOperationProvenanceKey,
  buildNestedToolOutcomeData,
  buildRunStartedData,
  buildRunTerminalData,
  buildToolOutcomeData,
  classifyExecutionJournalRows,
  getNestedExecutionParentOperation,
  isExecutionJournalError,
  parseExecutionJournalFact,
  type CommitExecutionDispatchInput,
  type CommitExecutionRunStartedInput,
  type CommitExecutionRunTerminalInput,
  type CommitExecutionToolOutcomeInput,
  type CommitNestedExecutionDispatchInput,
  type CommitNestedExecutionToolOutcomeInput,
  type ExecutionDispatchFact,
  type ExecutionJournalCommitReceipt,
  type ExecutionJournalEventName,
  type ExecutionJournalProtocolVersion,
  type ExecutionRecoveryReport,
  type ExecutionToolOutcomeFact,
  type NestedExecutionDispatchFact,
  type NestedExecutionToolOutcomeFact
} from '../domain/executionJournal'
import type { DeepChatTapeEntryRow, TapeEventAppendInput } from '../domain/entry'
import { canonicalJsonStringifyData } from '../domain/canonicalJson'
import type {
  ExecutionJournalAuditReader,
  ExecutionJournalRecoveryReader,
  ExecutionJournalWriter,
  NestedExecutionJournalWriter
} from '../ports/capabilities'
import type { ExecutionJournalPersistenceStore } from '../ports/storage'
import {
  DEEPCHAT_NESTED_EXECUTION_AUDIT_OPERATION_LIMIT,
  type DeepChatNestedExecutionAudit,
  type DeepChatNestedExecutionAuditOperation
} from '@shared/types/execution-journal-audit'

export type ExecutionJournalCommitPhase = 'before' | 'after'

export interface ExecutionJournalCommitFailpoint {
  reach(input: { eventName: ExecutionJournalEventName; phase: ExecutionJournalCommitPhase }): void
}

type StrictEventInput = Omit<TapeEventAppendInput, 'name'> & {
  name: ExecutionJournalEventName
  source: NonNullable<TapeEventAppendInput['source']>
  provenanceKey: string
  protocolVersion: ExecutionJournalProtocolVersion
}

type ExecutionOperationFact =
  | ExecutionDispatchFact
  | ExecutionToolOutcomeFact
  | NestedExecutionDispatchFact
  | NestedExecutionToolOutcomeFact

function canonicalJsonEquals(raw: string, expected: unknown): boolean {
  try {
    return canonicalJsonStringifyData(JSON.parse(raw)) === canonicalJsonStringifyData(expected)
  } catch {
    return false
  }
}

function rowMatchesStrictEvent(row: DeepChatTapeEntryRow, input: StrictEventInput): boolean {
  return (
    row.session_id === input.sessionId &&
    row.kind === 'event' &&
    row.name === input.name &&
    row.source_type === input.source.type &&
    row.source_id === input.source.id &&
    row.source_seq === (input.source.seq ?? null) &&
    row.provenance_key === input.provenanceKey &&
    canonicalJsonEquals(row.payload_json, { name: input.name, data: input.data }) &&
    canonicalJsonEquals(row.meta_json, input.meta ?? {})
  )
}

export class ExecutionJournalService
  implements
    ExecutionJournalWriter,
    NestedExecutionJournalWriter,
    ExecutionJournalRecoveryReader,
    ExecutionJournalAuditReader
{
  constructor(
    private readonly getStore: () => ExecutionJournalPersistenceStore,
    private readonly commitFailpoint?: ExecutionJournalCommitFailpoint
  ) {}

  commitRunStarted(input: CommitExecutionRunStartedInput): ExecutionJournalCommitReceipt {
    const data = buildRunStartedData(input)
    return this.commitStrictEvent({
      sessionId: input.sessionId,
      name: 'execution/run_started',
      data,
      source: { type: 'runtime_event', id: data.runId, seq: 0 },
      provenanceKey: buildExecutionRunProvenanceKey(data.runId, 'started'),
      meta: buildExecutionJournalMeta(),
      protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION,
      createdAt: input.createdAt
    })
  }

  commitDispatch(input: CommitExecutionDispatchInput): ExecutionJournalCommitReceipt {
    const data = buildDispatchData(input)
    return this.commitStrictEvent(
      {
        sessionId: input.sessionId,
        name: 'execution/dispatch_committed',
        data,
        source: {
          type: 'runtime_event',
          id: data.operation.runId,
          seq: data.operation.requestSeq
        },
        provenanceKey: buildExecutionOperationProvenanceKey(data.operation, 'dispatch'),
        meta: buildExecutionJournalMeta(),
        protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION,
        createdAt: input.createdAt
      },
      (table) =>
        this.requireFact(
          table,
          input.sessionId,
          buildExecutionRunProvenanceKey(data.operation.runId, 'started'),
          'execution/run_started',
          data.messageId
        ),
      (table) => this.requireRunOpen(table, input.sessionId, data.operation.runId)
    )
  }

  commitToolOutcome(input: CommitExecutionToolOutcomeInput): ExecutionJournalCommitReceipt {
    const data = buildToolOutcomeData(input)
    return this.commitStrictEvent(
      {
        sessionId: input.sessionId,
        name: 'execution/tool_outcome',
        data,
        source: {
          type: 'runtime_event',
          id: data.operation.runId,
          seq: data.operation.requestSeq
        },
        provenanceKey: buildExecutionOperationProvenanceKey(data.operation, 'outcome'),
        meta: buildExecutionJournalMeta(),
        protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION,
        createdAt: input.createdAt
      },
      (table) => {
        this.requireFact(
          table,
          input.sessionId,
          buildExecutionOperationProvenanceKey(data.operation, 'dispatch'),
          'execution/dispatch_committed',
          data.messageId
        )
        this.requireNestedOperationsSettledForParent(
          table,
          input.sessionId,
          data.messageId,
          data.operation
        )
      },
      (table) => {
        this.requireRunOpen(table, input.sessionId, data.operation.runId)
      }
    )
  }

  commitNestedDispatch(input: CommitNestedExecutionDispatchInput): ExecutionJournalCommitReceipt {
    const data = buildNestedDispatchData(input)
    const parent = getNestedExecutionParentOperation(data.operation)
    return this.commitStrictEvent(
      {
        sessionId: input.sessionId,
        name: 'execution/dispatch_committed',
        data,
        source: {
          type: 'runtime_event',
          id: data.operation.runId,
          seq: data.operation.requestSeq
        },
        provenanceKey: buildNestedExecutionOperationProvenanceKey(data.operation, 'dispatch'),
        meta: buildNestedExecutionJournalMeta(),
        protocolVersion: EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION,
        createdAt: input.createdAt
      },
      (table) => {
        this.requireFact(
          table,
          input.sessionId,
          buildExecutionRunProvenanceKey(data.operation.runId, 'started'),
          'execution/run_started',
          data.messageId
        )
        this.requireFact(
          table,
          input.sessionId,
          buildExecutionOperationProvenanceKey(parent, 'dispatch'),
          'execution/dispatch_committed',
          data.messageId
        )
      },
      (table) => {
        this.requireRunOpen(table, input.sessionId, data.operation.runId)
        this.requireParentOperationOpen(table, input.sessionId, parent)
      }
    )
  }

  commitNestedToolOutcome(
    input: CommitNestedExecutionToolOutcomeInput
  ): ExecutionJournalCommitReceipt {
    const data = buildNestedToolOutcomeData(input)
    const parent = getNestedExecutionParentOperation(data.operation)
    return this.commitStrictEvent(
      {
        sessionId: input.sessionId,
        name: 'execution/tool_outcome',
        data,
        source: {
          type: 'runtime_event',
          id: data.operation.runId,
          seq: data.operation.requestSeq
        },
        provenanceKey: buildNestedExecutionOperationProvenanceKey(data.operation, 'outcome'),
        meta: buildNestedExecutionJournalMeta(),
        protocolVersion: EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION,
        createdAt: input.createdAt
      },
      (table) =>
        this.requireFact(
          table,
          input.sessionId,
          buildNestedExecutionOperationProvenanceKey(data.operation, 'dispatch'),
          'execution/dispatch_committed',
          data.messageId
        ),
      (table) => {
        this.requireRunOpen(table, input.sessionId, data.operation.runId)
        this.requireParentOperationOpen(table, input.sessionId, parent)
      }
    )
  }

  commitRunTerminal(input: CommitExecutionRunTerminalInput): ExecutionJournalCommitReceipt {
    const data = buildRunTerminalData(input)
    return this.commitStrictEvent(
      {
        sessionId: input.sessionId,
        name: 'execution/run_terminal',
        data,
        source: { type: 'runtime_event', id: data.runId, seq: 0 },
        provenanceKey: buildExecutionRunProvenanceKey(data.runId, 'terminal'),
        meta: buildExecutionJournalMeta(),
        protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION,
        createdAt: input.createdAt
      },
      (table) => {
        this.requireFact(
          table,
          input.sessionId,
          buildExecutionRunProvenanceKey(data.runId, 'started'),
          'execution/run_started',
          data.messageId
        )
        this.requireNestedOperationsSettledForRun(
          table,
          input.sessionId,
          data.messageId,
          data.runId
        )
      }
    )
  }

  classifyRecoveryCandidates(): ExecutionRecoveryReport[] {
    return classifyExecutionJournalRows(this.getStore().listUnterminatedRunEvents())
  }

  listNestedExecutionAuditForMessage(
    sessionId: string,
    messageId: string
  ): DeepChatNestedExecutionAudit {
    const rows = this.getStore().listNestedOperationEventsForMessage(
      sessionId,
      messageId,
      DEEPCHAT_NESTED_EXECUTION_AUDIT_OPERATION_LIMIT + 1
    )
    const operations = new Map<
      string,
      {
        dispatch?: NestedExecutionDispatchFact
        outcome?: NestedExecutionToolOutcomeFact
      }
    >()

    for (const row of rows) {
      let fact: ExecutionOperationFact
      try {
        const parsed = parseExecutionJournalFact(row)
        if (
          parsed.protocolVersion !== EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION ||
          (parsed.type !== 'execution/dispatch_committed' &&
            parsed.type !== 'execution/tool_outcome') ||
          parsed.messageId !== messageId
        ) {
          throw new ExecutionJournalCorruptionError(
            'Nested Execution Journal audit query returned a conflicting fact.'
          )
        }
        fact = parsed
      } catch (error) {
        if (error instanceof ExecutionJournalCorruptionError) throw error
        throw new ExecutionJournalCorruptionError(
          'Nested Execution Journal audit query returned a malformed fact.',
          { cause: error }
        )
      }
      const key = buildAnyExecutionOperationKey(fact.operation)
      const state = operations.get(key) ?? {}
      if (fact.type === 'execution/dispatch_committed') {
        if (state.dispatch) {
          throw new ExecutionJournalCorruptionError(
            'Nested Execution Journal audit contains a duplicate dispatch.'
          )
        }
        state.dispatch = fact
      } else {
        if (state.outcome) {
          throw new ExecutionJournalCorruptionError(
            'Nested Execution Journal audit contains a duplicate outcome.'
          )
        }
        state.outcome = fact
      }
      operations.set(key, state)
    }

    const ordered = [...operations.values()].sort(
      (left, right) =>
        (left.dispatch?.entryId ?? left.outcome?.entryId ?? 0) -
        (right.dispatch?.entryId ?? right.outcome?.entryId ?? 0)
    )
    const truncated = ordered.length > DEEPCHAT_NESTED_EXECUTION_AUDIT_OPERATION_LIMIT
    const projected: DeepChatNestedExecutionAuditOperation[] = []
    for (const [index, state] of ordered.entries()) {
      const dispatch = state.dispatch
      const outcome = state.outcome
      if (!dispatch || (outcome && dispatch.entryId >= outcome.entryId)) {
        throw new ExecutionJournalCorruptionError(
          'Nested Execution Journal audit contains invalid dispatch/outcome causality.'
        )
      }
      if (index >= DEEPCHAT_NESTED_EXECUTION_AUDIT_OPERATION_LIMIT) continue
      projected.push({
        runId: dispatch.operation.runId,
        requestSeq: dispatch.operation.requestSeq,
        providerToolCallId: dispatch.operation.providerToolCallId,
        childOrdinal: dispatch.operation.childOrdinal,
        toolName: dispatch.toolName,
        toolSource: dispatch.toolSource,
        target: dispatch.target,
        argumentsHash: dispatch.argumentsHash,
        definitionHash: dispatch.definitionHash,
        capabilityHash: dispatch.capabilityHash,
        status: !outcome ? 'indeterminate' : outcome.isError ? 'error' : 'success',
        dispatchEntryId: dispatch.entryId,
        dispatchCreatedAt: dispatch.createdAt,
        outcomeEntryId: outcome?.entryId ?? null,
        outcomeCreatedAt: outcome?.createdAt ?? null,
        responseHash: outcome?.responseHash ?? null,
        isError: outcome?.isError ?? null
      })
    }

    return {
      schemaVersion: 1,
      state: 'available',
      operations: projected,
      truncated
    }
  }

  listMessageIdsWithNestedExecutionAudit(
    sessionId: string,
    messageIds: readonly string[]
  ): readonly string[] {
    return this.getStore().listMessageIdsWithNestedOperationEvents(sessionId, messageIds)
  }

  hasAnyCommittedDispatchForMessageToolCall(
    sessionId: string,
    messageId: string,
    providerToolCallId: string
  ): boolean {
    const normalizedSessionId = sessionId.trim()
    const normalizedMessageId = messageId.trim()
    const normalizedToolCallId = providerToolCallId.trim()
    if (!normalizedSessionId || !normalizedMessageId || !normalizedToolCallId) {
      throw new ExecutionJournalError(
        'Deferred dispatch recovery identity is invalid.',
        'invalid_fact'
      )
    }
    const rows = this.getStore().listDispatchEventsForRecoveryIdentity(
      normalizedSessionId,
      normalizedMessageId,
      normalizedToolCallId
    )
    let matchingDispatches = 0
    for (const row of rows) {
      const fact = parseExecutionJournalFact(row)
      if (fact.type !== 'execution/dispatch_committed' || fact.sessionId !== normalizedSessionId) {
        throw new ExecutionJournalCorruptionError(
          'Deferred dispatch recovery found a conflicting dispatch fact.'
        )
      }
      if (fact.protocolVersion === EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION) continue
      if (
        fact.messageId === normalizedMessageId &&
        fact.operation.providerToolCallId === normalizedToolCallId
      ) {
        matchingDispatches += 1
      }
    }
    return matchingDispatches > 0
  }

  private commitStrictEvent(
    input: StrictEventInput,
    requirePrerequisite?: (table: ExecutionJournalPersistenceStore) => void,
    validateNewFact?: (table: ExecutionJournalPersistenceStore) => void
  ): ExecutionJournalCommitReceipt {
    const table = this.getStore()
    this.commitFailpoint?.reach({ eventName: input.name, phase: 'before' })
    let receipt: ExecutionJournalCommitReceipt
    try {
      if (table.isInTransaction()) {
        throw new ExecutionJournalError(
          `Cannot persist ${input.name} inside an active host transaction.`,
          'persistence_failed'
        )
      }
      receipt = table.runInTransaction(() => {
        table.ensureBootstrapAnchor(input.sessionId)
        requirePrerequisite?.(table)
        const existing = table.getByProvenanceKey(input.sessionId, input.provenanceKey)
        if (existing) {
          return this.resolveExisting(existing, input)
        }
        validateNewFact?.(table)

        const row = table.appendExecutionJournalEvent({ ...input, idempotent: false })
        if (!rowMatchesStrictEvent(row, input)) {
          throw new ExecutionJournalCorruptionError(
            `Execution Journal append returned a conflicting ${input.name} row.`
          )
        }
        return { sessionId: row.session_id, entryId: row.entry_id, created: true }
      })
    } catch (error) {
      if (isExecutionJournalError(error)) throw error
      throw new ExecutionJournalError(
        `Failed to persist ${input.name} for session ${input.sessionId} (protocol v${input.protocolVersion}).`,
        'persistence_failed',
        { cause: error }
      )
    }
    this.commitFailpoint?.reach({ eventName: input.name, phase: 'after' })
    return receipt
  }

  private requireFact(
    table: ExecutionJournalPersistenceStore,
    sessionId: string,
    provenanceKey: string,
    expectedType: ExecutionJournalEventName,
    expectedMessageId: string
  ): void {
    const row = table.getByProvenanceKey(sessionId, provenanceKey)
    if (!row) {
      throw new ExecutionJournalCorruptionError(
        `Execution Journal prerequisite ${expectedType} is missing in session ${sessionId}.`
      )
    }
    try {
      const fact = parseExecutionJournalFact(row)
      if (fact.type !== expectedType || fact.messageId !== expectedMessageId) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal prerequisite ${expectedType} has conflicting identity in session ${sessionId}.`
        )
      }
    } catch (error) {
      if (error instanceof ExecutionJournalCorruptionError) throw error
      throw new ExecutionJournalCorruptionError(
        `Execution Journal prerequisite ${expectedType} is malformed in session ${sessionId}.`,
        { cause: error }
      )
    }
  }

  private requireRunOpen(
    table: ExecutionJournalPersistenceStore,
    sessionId: string,
    runId: string
  ): void {
    const terminal = table.getByProvenanceKey(
      sessionId,
      buildExecutionRunProvenanceKey(runId, 'terminal')
    )
    if (terminal) {
      throw new ExecutionJournalCorruptionError(
        `Execution Journal cannot append an operation fact after run_terminal in session ${sessionId}.`
      )
    }
  }

  private requireParentOperationOpen(
    table: ExecutionJournalPersistenceStore,
    sessionId: string,
    parent: ExecutionDispatchFact['operation']
  ): void {
    const outcome = table.getByProvenanceKey(
      sessionId,
      buildExecutionOperationProvenanceKey(parent, 'outcome')
    )
    if (outcome) {
      throw new ExecutionJournalCorruptionError(
        `Execution Journal cannot append a nested operation after its parent outcome in session ${sessionId}.`
      )
    }
  }

  private readOperationFacts(rows: DeepChatTapeEntryRow[]): ExecutionOperationFact[] {
    return rows.map((row) => {
      try {
        const fact = parseExecutionJournalFact(row)
        if (
          fact.type !== 'execution/dispatch_committed' &&
          fact.type !== 'execution/tool_outcome'
        ) {
          throw new ExecutionJournalCorruptionError(
            'Execution Journal operation query returned a non-operation fact.'
          )
        }
        return fact
      } catch (error) {
        if (error instanceof ExecutionJournalCorruptionError) throw error
        throw new ExecutionJournalCorruptionError(
          'Execution Journal operation query returned a malformed fact.',
          { cause: error }
        )
      }
    })
  }

  private requireNestedOperationsSettledForParent(
    table: ExecutionJournalPersistenceStore,
    sessionId: string,
    messageId: string,
    parent: ExecutionDispatchFact['operation']
  ): void {
    const facts = this.readOperationFacts(
      table.listNestedOperationEventsForParent(
        sessionId,
        parent.runId,
        parent.requestSeq,
        parent.providerToolCallId,
        buildExecutionOperationKey(parent)
      )
    )
    const dispatches = new Map<string, NestedExecutionDispatchFact>()
    const outcomes = new Map<string, NestedExecutionToolOutcomeFact>()
    for (const fact of facts) {
      if (fact.messageId !== messageId) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal operation message identity conflicts in session ${sessionId}.`
        )
      }
      if (
        fact.protocolVersion !== EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION ||
        fact.operation.providerToolCallId !== parent.providerToolCallId
      ) {
        continue
      }
      const key = buildAnyExecutionOperationKey(fact.operation)
      if (fact.type === 'execution/dispatch_committed') dispatches.set(key, fact)
      else outcomes.set(key, fact)
    }
    for (const operationKey of outcomes.keys()) {
      if (!dispatches.has(operationKey)) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal nested outcome is missing its dispatch in session ${sessionId}.`
        )
      }
    }
    for (const operationKey of dispatches.keys()) {
      const dispatch = dispatches.get(operationKey)!
      const outcome = outcomes.get(operationKey)
      if (!outcome) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal cannot settle a parent with an unsettled nested operation in session ${sessionId}.`
        )
      }
      if (dispatch.entryId >= outcome.entryId) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal cannot settle a parent with reordered nested causality in session ${sessionId}.`
        )
      }
    }
  }

  private requireNestedOperationsSettledForRun(
    table: ExecutionJournalPersistenceStore,
    sessionId: string,
    messageId: string,
    runId: string
  ): void {
    const facts = this.readOperationFacts(table.listNestedOperationEventsForRun(sessionId, runId))
    const terminalRow = table.getByProvenanceKey(
      sessionId,
      buildExecutionRunProvenanceKey(runId, 'terminal')
    )
    let terminalEntryId: number | undefined
    if (terminalRow) {
      try {
        const terminal = parseExecutionJournalFact(terminalRow)
        if (
          terminal.type !== 'execution/run_terminal' ||
          terminal.messageId !== messageId ||
          terminal.runId !== runId
        ) {
          throw new ExecutionJournalCorruptionError(
            `Execution Journal terminal has conflicting identity in session ${sessionId}.`
          )
        }
        terminalEntryId = terminal.entryId
      } catch (error) {
        if (error instanceof ExecutionJournalCorruptionError) throw error
        throw new ExecutionJournalCorruptionError(
          `Execution Journal terminal is malformed in session ${sessionId}.`,
          { cause: error }
        )
      }
    }
    const nestedDispatches = new Map<string, NestedExecutionDispatchFact>()
    const nestedOutcomes = new Map<string, NestedExecutionToolOutcomeFact>()
    for (const fact of facts) {
      if (fact.messageId !== messageId) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal operation message identity conflicts in session ${sessionId}.`
        )
      }
      const key = buildAnyExecutionOperationKey(fact.operation)
      if (fact.protocolVersion !== EXECUTION_JOURNAL_NESTED_PROTOCOL_VERSION) continue
      if (fact.type === 'execution/dispatch_committed') nestedDispatches.set(key, fact)
      else nestedOutcomes.set(key, fact)
    }
    for (const [operationKey, nestedDispatch] of nestedDispatches) {
      const nestedOutcome = nestedOutcomes.get(operationKey)
      const parent = getNestedExecutionParentOperation(nestedDispatch.operation)
      const parentDispatchRow = table.getByProvenanceKey(
        sessionId,
        buildExecutionOperationProvenanceKey(parent, 'dispatch')
      )
      const parentOutcomeRow = table.getByProvenanceKey(
        sessionId,
        buildExecutionOperationProvenanceKey(parent, 'outcome')
      )
      if (!nestedOutcome || !parentDispatchRow || !parentOutcomeRow) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal cannot terminalize a Run with unsettled nested causality in session ${sessionId}.`
        )
      }
      const parentDispatch = this.readOperationFacts([parentDispatchRow])[0]
      const parentOutcome = this.readOperationFacts([parentOutcomeRow])[0]
      if (
        parentDispatch.protocolVersion !== EXECUTION_JOURNAL_PROTOCOL_VERSION ||
        parentDispatch.type !== 'execution/dispatch_committed' ||
        parentOutcome.protocolVersion !== EXECUTION_JOURNAL_PROTOCOL_VERSION ||
        parentOutcome.type !== 'execution/tool_outcome' ||
        parentDispatch.entryId >= nestedDispatch.entryId ||
        nestedDispatch.entryId >= nestedOutcome.entryId ||
        nestedOutcome.entryId >= parentOutcome.entryId ||
        (terminalEntryId !== undefined && parentOutcome.entryId >= terminalEntryId)
      ) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal cannot terminalize a Run with unsettled nested causality in session ${sessionId}.`
        )
      }
    }
    for (const operationKey of nestedOutcomes.keys()) {
      if (!nestedDispatches.has(operationKey)) {
        throw new ExecutionJournalCorruptionError(
          `Execution Journal cannot terminalize a Run with an orphan nested outcome in session ${sessionId}.`
        )
      }
    }
  }

  private resolveExisting(
    row: DeepChatTapeEntryRow,
    input: StrictEventInput
  ): ExecutionJournalCommitReceipt {
    if (!rowMatchesStrictEvent(row, input)) {
      throw new ExecutionJournalCorruptionError(
        `Execution Journal identity collision for ${input.name} in session ${input.sessionId}.`
      )
    }
    return { sessionId: row.session_id, entryId: row.entry_id, created: false }
  }
}
