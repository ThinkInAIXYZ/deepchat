import type { DeepChatTapeEntryRow } from './entry'
import { hashJson, hashJsonData, stableJsonStringify } from './canonicalJson'

export const EXECUTION_JOURNAL_PROTOCOL_VERSION = 1 as const
export const EXECUTION_JOURNAL_FACT_FAMILY = 'execution_journal' as const
export const EXECUTION_JOURNAL_EVENT_NAMES = [
  'execution/run_started',
  'execution/dispatch_committed',
  'execution/tool_outcome',
  'execution/run_terminal'
] as const

export type ExecutionJournalEventName = (typeof EXECUTION_JOURNAL_EVENT_NAMES)[number]
export type ExecutionRunKind = 'loop' | 'deferred_tool'
export type ExecutionRunOutcome = 'completed' | 'paused' | 'aborted' | 'error'
export type ExecutionToolSource = 'agent' | 'mcp'
export type ExecutionRecoveryClassification =
  | 'not_dispatched'
  | 'completed'
  | 'indeterminate'
  | 'corruption'

const MAX_IDENTITY_CHARS = 1_024
const MAX_TOOL_NAME_CHARS = 512
const MAX_TARGET_FIELD_CHARS = 1_024
const MAX_STOP_REASON_CHARS = 1_024
const SHA_256_PATTERN = /^[0-9a-f]{64}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface ExecutionOperationIdentity {
  runId: string
  requestSeq: number
  providerToolCallId: string
}

export interface ExecutionResolvedTarget {
  serverName: string
  originalName?: string
  ownerPluginId?: string
}

export interface CommitExecutionRunStartedInput {
  sessionId: string
  runId: string
  messageId: string
  runKind: ExecutionRunKind
  createdAt?: number
}

export interface CommitExecutionDispatchInput {
  sessionId: string
  messageId: string
  operation: ExecutionOperationIdentity
  toolName: string
  toolSource: ExecutionToolSource
  normalizedArguments: Record<string, unknown>
  target: ExecutionResolvedTarget
  createdAt?: number
}

export interface CommitExecutionToolOutcomeInput {
  sessionId: string
  messageId: string
  operation: ExecutionOperationIdentity
  responseText: string
  isError: boolean
  createdAt?: number
}

export interface CommitExecutionRunTerminalInput {
  sessionId: string
  runId: string
  messageId: string
  outcome: ExecutionRunOutcome
  stopReason: string
  errorMessage?: string
  createdAt?: number
}

export interface ExecutionJournalCommitReceipt {
  sessionId: string
  entryId: number
  created: boolean
}

interface ExecutionFactBase<TName extends ExecutionJournalEventName> {
  protocolVersion: typeof EXECUTION_JOURNAL_PROTOCOL_VERSION
  type: TName
  sessionId: string
  runId: string
  messageId: string
  entryId: number
  createdAt: number
}

export interface ExecutionRunStartedFact extends ExecutionFactBase<'execution/run_started'> {
  runKind: ExecutionRunKind
}

export interface ExecutionDispatchFact extends ExecutionFactBase<'execution/dispatch_committed'> {
  operation: ExecutionOperationIdentity
  toolName: string
  toolSource: ExecutionToolSource
  argumentsHash: string
  target: ExecutionResolvedTarget
}

export interface ExecutionToolOutcomeFact extends ExecutionFactBase<'execution/tool_outcome'> {
  operation: ExecutionOperationIdentity
  responseHash: string
  isError: boolean
}

export interface ExecutionRunTerminalFact extends ExecutionFactBase<'execution/run_terminal'> {
  outcome: ExecutionRunOutcome
  stopReason: string
  errorHash?: string
}

export type ExecutionJournalFact =
  | ExecutionRunStartedFact
  | ExecutionDispatchFact
  | ExecutionToolOutcomeFact
  | ExecutionRunTerminalFact

export interface ExecutionRecoveryReport {
  sessionId: string
  runId: string
  messageId: string | null
  classification: ExecutionRecoveryClassification
  dispatchCount: number
  outcomeCount: number
  terminalOutcome: ExecutionRunOutcome | null
  reasons: string[]
}

export class ExecutionJournalError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_fact'
      | 'persistence_failed'
      | 'conflicting_fact'
      | 'duplicate_dispatch'
      | 'projection_failed',
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ExecutionJournalError'
  }
}

export class ExecutionJournalCorruptionError extends ExecutionJournalError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'conflicting_fact', options)
    this.name = 'ExecutionJournalCorruptionError'
  }
}

export class ExecutionJournalDuplicateDispatchError extends ExecutionJournalError {
  constructor(operation: ExecutionOperationIdentity) {
    super(
      `Execution dispatch was already committed for operation ${formatExecutionOperationIdentity(operation)}.`,
      'duplicate_dispatch'
    )
    this.name = 'ExecutionJournalDuplicateDispatchError'
  }
}

export class CommittedToolOutcomeProjectionError extends ExecutionJournalError {
  constructor(operation: ExecutionOperationIdentity, options?: ErrorOptions) {
    super(
      `Tool outcome was committed for operation ${formatExecutionOperationIdentity(operation)}, but its projection failed.`,
      'projection_failed',
      options
    )
    this.name = 'CommittedToolOutcomeProjectionError'
  }
}

export function isExecutionJournalReservedName(name: unknown): name is string {
  return typeof name === 'string' && name.startsWith('execution/')
}

export function isExecutionJournalError(error: unknown): error is ExecutionJournalError {
  return error instanceof ExecutionJournalError
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExecutionJournalError(`${label} must be an object.`, 'invalid_fact')
  }
  return value as Record<string, unknown>
}

function requireString(
  value: unknown,
  label: string,
  maxLength: number,
  options: { preserveWhitespace?: boolean } = {}
): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ExecutionJournalError(
      `${label} must be a non-empty string no longer than ${maxLength} characters.`,
      'invalid_fact'
    )
  }
  if (!options.preserveWhitespace && value !== value.trim()) {
    throw new ExecutionJournalError(`${label} must not contain outer whitespace.`, 'invalid_fact')
  }
  return value
}

function requireSessionId(value: unknown): string {
  return requireString(value, 'sessionId', MAX_IDENTITY_CHARS)
}

function requireMessageId(value: unknown): string {
  return requireString(value, 'messageId', MAX_IDENTITY_CHARS)
}

export function requireExecutionRunId(value: unknown): string {
  const runId = requireString(value, 'runId', MAX_IDENTITY_CHARS)
  if (!UUID_PATTERN.test(runId)) {
    throw new ExecutionJournalError('runId must be a UUID.', 'invalid_fact')
  }
  return runId.toLowerCase()
}

function requireRequestSeq(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ExecutionJournalError('requestSeq must be a positive safe integer.', 'invalid_fact')
  }
  return value as number
}

function requireOptionalCreatedAt(value: unknown): void {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ExecutionJournalError(
      'createdAt must be a non-negative safe integer.',
      'invalid_fact'
    )
  }
}

function hashJsonFactValue(value: unknown, label: string): string {
  try {
    return hashJsonData(value)
  } catch (error) {
    throw new ExecutionJournalError(`${label} must be JSON serializable.`, 'invalid_fact', {
      cause: error
    })
  }
}

export function normalizeExecutionOperationIdentity(
  value: ExecutionOperationIdentity
): ExecutionOperationIdentity {
  const record = requireRecord(value, 'operation')
  requireExactKeys(record, 'operation', ['runId', 'requestSeq', 'providerToolCallId'])
  return {
    runId: requireExecutionRunId(record.runId),
    requestSeq: requireRequestSeq(record.requestSeq),
    providerToolCallId: requireString(
      record.providerToolCallId,
      'providerToolCallId',
      MAX_IDENTITY_CHARS
    )
  }
}

function normalizeTarget(value: ExecutionResolvedTarget): ExecutionResolvedTarget {
  const record = requireRecord(value, 'target')
  requireExactKeys(record, 'target', [
    'serverName',
    ...(record.originalName === undefined ? [] : ['originalName']),
    ...(record.ownerPluginId === undefined ? [] : ['ownerPluginId'])
  ])
  return {
    serverName: requireString(record.serverName, 'target.serverName', MAX_TARGET_FIELD_CHARS),
    ...(record.originalName === undefined
      ? {}
      : {
          originalName: requireString(
            record.originalName,
            'target.originalName',
            MAX_TARGET_FIELD_CHARS
          )
        }),
    ...(record.ownerPluginId === undefined
      ? {}
      : {
          ownerPluginId: requireString(
            record.ownerPluginId,
            'target.ownerPluginId',
            MAX_TARGET_FIELD_CHARS
          )
        })
  }
}

function requireProtocolVersion(value: unknown): typeof EXECUTION_JOURNAL_PROTOCOL_VERSION {
  if (value !== EXECUTION_JOURNAL_PROTOCOL_VERSION) {
    throw new ExecutionJournalError(
      `Unsupported execution journal protocol version: ${String(value)}.`,
      'invalid_fact'
    )
  }
  return value
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA_256_PATTERN.test(value)) {
    throw new ExecutionJournalError(`${label} must be a lowercase SHA-256 hash.`, 'invalid_fact')
  }
  return value
}

function requireExactKeys(
  record: Record<string, unknown>,
  label: string,
  expectedKeys: readonly string[]
): void {
  const actualKeys = Object.keys(record).sort()
  const normalizedExpectedKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== normalizedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== normalizedExpectedKeys[index])
  ) {
    throw new ExecutionJournalError(`${label} has unsupported or missing fields.`, 'invalid_fact')
  }
}

function normalizeRunKind(value: unknown): ExecutionRunKind {
  if (value !== 'loop' && value !== 'deferred_tool') {
    throw new ExecutionJournalError('runKind is invalid.', 'invalid_fact')
  }
  return value
}

function normalizeRunOutcome(value: unknown): ExecutionRunOutcome {
  if (value !== 'completed' && value !== 'paused' && value !== 'aborted' && value !== 'error') {
    throw new ExecutionJournalError('run outcome is invalid.', 'invalid_fact')
  }
  return value
}

export function formatExecutionOperationIdentity(operation: ExecutionOperationIdentity): string {
  return stableJsonStringify(normalizeExecutionOperationIdentity(operation))
}

export function buildExecutionOperationKey(operation: ExecutionOperationIdentity): string {
  return hashJson(normalizeExecutionOperationIdentity(operation))
}

export function buildExecutionRunProvenanceKey(
  runId: string,
  fact: 'started' | 'terminal'
): string {
  return `execution:v${EXECUTION_JOURNAL_PROTOCOL_VERSION}:run:${hashJson({ runId: requireExecutionRunId(runId) })}:${fact}`
}

export function buildExecutionOperationProvenanceKey(
  operation: ExecutionOperationIdentity,
  fact: 'dispatch' | 'outcome'
): string {
  return `execution:v${EXECUTION_JOURNAL_PROTOCOL_VERSION}:operation:${buildExecutionOperationKey(operation)}:${fact}`
}

export function buildRunStartedData(input: CommitExecutionRunStartedInput) {
  requireSessionId(input.sessionId)
  requireOptionalCreatedAt(input.createdAt)
  return {
    protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION,
    runId: requireExecutionRunId(input.runId),
    messageId: requireMessageId(input.messageId),
    runKind: normalizeRunKind(input.runKind)
  }
}

export function buildDispatchData(input: CommitExecutionDispatchInput) {
  requireSessionId(input.sessionId)
  requireOptionalCreatedAt(input.createdAt)
  const normalizedArguments = requireRecord(input.normalizedArguments, 'normalizedArguments')
  return {
    protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION,
    operation: normalizeExecutionOperationIdentity(input.operation),
    messageId: requireMessageId(input.messageId),
    toolName: requireString(input.toolName, 'toolName', MAX_TOOL_NAME_CHARS),
    toolSource:
      input.toolSource === 'agent' || input.toolSource === 'mcp'
        ? input.toolSource
        : (() => {
            throw new ExecutionJournalError('toolSource is invalid.', 'invalid_fact')
          })(),
    argumentsHash: hashJsonFactValue(normalizedArguments, 'normalizedArguments'),
    target: normalizeTarget(input.target)
  }
}

export function buildToolOutcomeData(input: CommitExecutionToolOutcomeInput) {
  requireSessionId(input.sessionId)
  requireOptionalCreatedAt(input.createdAt)
  if (typeof input.responseText !== 'string') {
    throw new ExecutionJournalError('responseText must be a string.', 'invalid_fact')
  }
  if (typeof input.isError !== 'boolean') {
    throw new ExecutionJournalError('isError must be a boolean.', 'invalid_fact')
  }
  return {
    protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION,
    operation: normalizeExecutionOperationIdentity(input.operation),
    messageId: requireMessageId(input.messageId),
    responseHash: hashJson(input.responseText),
    isError: input.isError
  }
}

export function buildRunTerminalData(input: CommitExecutionRunTerminalInput) {
  requireSessionId(input.sessionId)
  requireOptionalCreatedAt(input.createdAt)
  if (input.errorMessage !== undefined && typeof input.errorMessage !== 'string') {
    throw new ExecutionJournalError('errorMessage must be a string.', 'invalid_fact')
  }
  return {
    protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION,
    runId: requireExecutionRunId(input.runId),
    messageId: requireMessageId(input.messageId),
    outcome: normalizeRunOutcome(input.outcome),
    stopReason: requireString(input.stopReason, 'stopReason', MAX_STOP_REASON_CHARS),
    ...(input.errorMessage === undefined ? {} : { errorHash: hashJson(input.errorMessage) })
  }
}

export function buildExecutionJournalMeta(): Record<string, unknown> {
  return {
    factFamily: EXECUTION_JOURNAL_FACT_FAMILY,
    protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION
  }
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  try {
    return requireRecord(JSON.parse(raw), label)
  } catch (error) {
    if (isExecutionJournalError(error)) throw error
    throw new ExecutionJournalError(`${label} is not valid JSON.`, 'invalid_fact', {
      cause: error
    })
  }
}

function parseCommonRow(row: DeepChatTapeEntryRow): {
  name: ExecutionJournalEventName
  data: Record<string, unknown>
  runId: string
} {
  if (
    row.kind !== 'event' ||
    !EXECUTION_JOURNAL_EVENT_NAMES.includes(row.name as ExecutionJournalEventName)
  ) {
    throw new ExecutionJournalError('Row is not an Execution Journal event.', 'invalid_fact')
  }
  const name = row.name as ExecutionJournalEventName
  const payload = parseJsonObject(row.payload_json, 'payload')
  const meta = parseJsonObject(row.meta_json, 'meta')
  requireExactKeys(payload, 'payload', ['name', 'data'])
  requireExactKeys(meta, 'meta', ['factFamily', 'protocolVersion'])
  if (payload.name !== name) {
    throw new ExecutionJournalError('Payload name does not match the row name.', 'invalid_fact')
  }
  if (
    meta.factFamily !== EXECUTION_JOURNAL_FACT_FAMILY ||
    requireProtocolVersion(meta.protocolVersion) !== EXECUTION_JOURNAL_PROTOCOL_VERSION
  ) {
    throw new ExecutionJournalError('Row is not a native Execution Journal fact.', 'invalid_fact')
  }
  if (row.source_type !== 'runtime_event') {
    throw new ExecutionJournalError('Execution Journal source type is invalid.', 'invalid_fact')
  }
  const data = requireRecord(payload.data, 'payload.data')
  requireProtocolVersion(data.protocolVersion)
  const runId = requireExecutionRunId(
    name === 'execution/dispatch_committed' || name === 'execution/tool_outcome'
      ? requireRecord(data.operation, 'operation').runId
      : data.runId
  )
  if (row.source_id !== runId) {
    throw new ExecutionJournalError(
      'Execution Journal source ID does not match runId.',
      'invalid_fact'
    )
  }
  return { name, data, runId }
}

export function parseExecutionJournalFact(row: DeepChatTapeEntryRow): ExecutionJournalFact {
  const common = parseCommonRow(row)
  const base = {
    protocolVersion: EXECUTION_JOURNAL_PROTOCOL_VERSION,
    sessionId: requireSessionId(row.session_id),
    runId: common.runId,
    entryId: row.entry_id,
    createdAt: row.created_at
  }
  if (!Number.isSafeInteger(base.entryId) || base.entryId <= 0) {
    throw new ExecutionJournalError('Execution Journal entry ID is invalid.', 'invalid_fact')
  }
  if (!Number.isSafeInteger(base.createdAt) || base.createdAt < 0) {
    throw new ExecutionJournalError('Execution Journal createdAt is invalid.', 'invalid_fact')
  }

  if (common.name === 'execution/run_started') {
    requireExactKeys(common.data, 'payload.data', [
      'protocolVersion',
      'runId',
      'messageId',
      'runKind'
    ])
    const data = buildRunStartedData({
      sessionId: row.session_id,
      runId: common.data.runId as string,
      messageId: common.data.messageId as string,
      runKind: common.data.runKind as ExecutionRunKind
    })
    if (
      row.source_seq !== 0 ||
      row.provenance_key !== buildExecutionRunProvenanceKey(data.runId, 'started')
    ) {
      throw new ExecutionJournalError('Run-start identity fields are inconsistent.', 'invalid_fact')
    }
    return { ...base, type: common.name, messageId: data.messageId, runKind: data.runKind }
  }

  if (common.name === 'execution/dispatch_committed') {
    requireExactKeys(common.data, 'payload.data', [
      'protocolVersion',
      'operation',
      'messageId',
      'toolName',
      'toolSource',
      'argumentsHash',
      'target'
    ])
    const operation = normalizeExecutionOperationIdentity(
      common.data.operation as ExecutionOperationIdentity
    )
    const toolName = requireString(common.data.toolName, 'toolName', MAX_TOOL_NAME_CHARS)
    const toolSource = common.data.toolSource
    if (toolSource !== 'agent' && toolSource !== 'mcp') {
      throw new ExecutionJournalError('toolSource is invalid.', 'invalid_fact')
    }
    const argumentsHash = requireHash(common.data.argumentsHash, 'argumentsHash')
    const target = normalizeTarget(common.data.target as ExecutionResolvedTarget)
    if (
      row.source_seq !== operation.requestSeq ||
      row.provenance_key !== buildExecutionOperationProvenanceKey(operation, 'dispatch')
    ) {
      throw new ExecutionJournalError('Dispatch identity fields are inconsistent.', 'invalid_fact')
    }
    return {
      ...base,
      type: common.name,
      messageId: requireMessageId(common.data.messageId),
      operation,
      toolName,
      toolSource,
      argumentsHash,
      target
    }
  }

  if (common.name === 'execution/tool_outcome') {
    requireExactKeys(common.data, 'payload.data', [
      'protocolVersion',
      'operation',
      'messageId',
      'responseHash',
      'isError'
    ])
    const operation = normalizeExecutionOperationIdentity(
      common.data.operation as ExecutionOperationIdentity
    )
    const responseHash = requireHash(common.data.responseHash, 'responseHash')
    if (typeof common.data.isError !== 'boolean') {
      throw new ExecutionJournalError('isError must be a boolean.', 'invalid_fact')
    }
    if (
      row.source_seq !== operation.requestSeq ||
      row.provenance_key !== buildExecutionOperationProvenanceKey(operation, 'outcome')
    ) {
      throw new ExecutionJournalError(
        'Tool-outcome identity fields are inconsistent.',
        'invalid_fact'
      )
    }
    return {
      ...base,
      type: common.name,
      messageId: requireMessageId(common.data.messageId),
      operation,
      responseHash,
      isError: common.data.isError
    }
  }

  requireExactKeys(common.data, 'payload.data', [
    'protocolVersion',
    'runId',
    'messageId',
    'outcome',
    'stopReason',
    ...(common.data.errorHash === undefined ? [] : ['errorHash'])
  ])
  const data = {
    runId: requireExecutionRunId(common.data.runId),
    messageId: requireMessageId(common.data.messageId),
    outcome: normalizeRunOutcome(common.data.outcome),
    stopReason: requireString(common.data.stopReason, 'stopReason', MAX_STOP_REASON_CHARS),
    ...(common.data.errorHash === undefined
      ? {}
      : { errorHash: requireHash(common.data.errorHash, 'errorHash') })
  }
  if (
    row.source_seq !== 0 ||
    row.provenance_key !== buildExecutionRunProvenanceKey(data.runId, 'terminal') ||
    common.data.errorHash !== data.errorHash
  ) {
    throw new ExecutionJournalError(
      'Run-terminal identity fields are inconsistent.',
      'invalid_fact'
    )
  }
  return {
    ...base,
    type: common.name,
    messageId: data.messageId,
    outcome: data.outcome,
    stopReason: data.stopReason,
    ...(data.errorHash === undefined ? {} : { errorHash: data.errorHash })
  }
}

type MutableRecoveryRun = {
  sessionId: string
  runId: string
  messageId: string | null
  starts: Array<Pick<ExecutionRunStartedFact, 'entryId'>>
  dispatches: Map<string, Pick<ExecutionDispatchFact, 'entryId'>>
  outcomes: Map<string, Pick<ExecutionToolOutcomeFact, 'entryId'>>
  terminals: Array<Pick<ExecutionRunTerminalFact, 'entryId' | 'outcome'>>
  reasons: Set<string>
}

function recoveryRunKey(sessionId: string, runId: string): string {
  return stableJsonStringify([sessionId, runId])
}

function createMutableRecoveryRun(sessionId: string, runId: string): MutableRecoveryRun {
  return {
    sessionId,
    runId,
    messageId: null,
    starts: [],
    dispatches: new Map(),
    outcomes: new Map(),
    terminals: [],
    reasons: new Set()
  }
}

export function classifyExecutionJournalRows(
  rows: Iterable<DeepChatTapeEntryRow>
): ExecutionRecoveryReport[] {
  const runs = new Map<string, MutableRecoveryRun>()
  const getRun = (sessionId: string, runId: string) => {
    const key = recoveryRunKey(sessionId, runId)
    let run = runs.get(key)
    if (!run) {
      run = createMutableRecoveryRun(sessionId, runId)
      runs.set(key, run)
    }
    return run
  }

  for (const row of rows) {
    try {
      const fact = parseExecutionJournalFact(row)
      const run = getRun(fact.sessionId, fact.runId)
      if (run.messageId === null) {
        run.messageId = fact.messageId
      } else if (run.messageId !== fact.messageId) {
        run.reasons.add('message_identity_mismatch')
      }
      if (fact.type === 'execution/run_started') {
        run.starts.push({ entryId: fact.entryId })
      } else if (fact.type === 'execution/dispatch_committed') {
        const operationKey = buildExecutionOperationKey(fact.operation)
        if (run.dispatches.has(operationKey)) {
          run.reasons.add('duplicate_dispatch')
        } else {
          run.dispatches.set(operationKey, { entryId: fact.entryId })
        }
      } else if (fact.type === 'execution/tool_outcome') {
        const operationKey = buildExecutionOperationKey(fact.operation)
        if (run.outcomes.has(operationKey)) {
          run.reasons.add('duplicate_outcome')
        } else {
          run.outcomes.set(operationKey, { entryId: fact.entryId })
        }
      } else {
        run.terminals.push({ entryId: fact.entryId, outcome: fact.outcome })
      }
    } catch (error) {
      const sessionId = row.session_id || '<invalid-session>'
      const runId = row.source_id || `<invalid-run:${row.entry_id}>`
      const run = getRun(sessionId, runId)
      run.reasons.add(
        `malformed_fact:${row.entry_id}:${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const runsByRunId = new Map<string, MutableRecoveryRun[]>()
  for (const run of runs.values()) {
    const matchingRuns = runsByRunId.get(run.runId) ?? []
    matchingRuns.push(run)
    runsByRunId.set(run.runId, matchingRuns)
  }
  for (const matchingRuns of runsByRunId.values()) {
    if (new Set(matchingRuns.map((run) => run.sessionId)).size > 1) {
      for (const run of matchingRuns) run.reasons.add('run_identity_reused_across_sessions')
    }
  }

  return [...runs.values()]
    .map((run): ExecutionRecoveryReport => {
      if (run.starts.length === 0) run.reasons.add('missing_run_started')
      if (run.starts.length > 1) run.reasons.add('duplicate_run_started')
      if (run.terminals.length > 1) run.reasons.add('duplicate_run_terminal')
      const startEntryId = run.starts[0]?.entryId
      if (startEntryId !== undefined) {
        const hasFactBeforeStart = [
          ...run.dispatches.values(),
          ...run.outcomes.values(),
          ...run.terminals
        ].some((fact) => fact.entryId <= startEntryId)
        if (hasFactBeforeStart) run.reasons.add('fact_before_run_started')
      }
      for (const operationKey of run.outcomes.keys()) {
        if (!run.dispatches.has(operationKey)) run.reasons.add('outcome_without_dispatch')
      }
      for (const [operationKey, outcome] of run.outcomes) {
        const dispatch = run.dispatches.get(operationKey)
        if (dispatch && outcome.entryId <= dispatch.entryId) {
          run.reasons.add('outcome_before_dispatch')
        }
      }
      const terminalEntryId = run.terminals[0]?.entryId
      if (
        terminalEntryId !== undefined &&
        [...run.dispatches.values(), ...run.outcomes.values()].some(
          (fact) => fact.entryId >= terminalEntryId
        )
      ) {
        run.reasons.add('fact_after_run_terminal')
      }

      const missingOutcome = [...run.dispatches.keys()].some(
        (operationKey) => !run.outcomes.has(operationKey)
      )
      const classification: ExecutionRecoveryClassification =
        run.reasons.size > 0
          ? 'corruption'
          : missingOutcome
            ? 'indeterminate'
            : run.dispatches.size === 0
              ? 'not_dispatched'
              : 'completed'

      return {
        sessionId: run.sessionId,
        runId: run.runId,
        messageId: run.messageId,
        classification,
        dispatchCount: run.dispatches.size,
        outcomeCount: run.outcomes.size,
        terminalOutcome: run.terminals[0]?.outcome ?? null,
        reasons: [...run.reasons].sort()
      }
    })
    .sort(
      (left, right) =>
        left.sessionId.localeCompare(right.sessionId) || left.runId.localeCompare(right.runId)
    )
}
