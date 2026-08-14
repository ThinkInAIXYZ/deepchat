import type {
  AgentCliProgrammaticOperationIdentity,
  ArmedAgentCliProgrammaticToken,
  PreparedAgentCliProgrammaticGrant
} from './agentTokenAuthority'
import { canonicalJsonStringifyData, hashJsonData } from '@/tape/domain/canonicalJson'
import {
  ExecutionJournalCorruptionError,
  MAX_EXECUTION_JOURNAL_TOOL_NAME_CHARACTERS,
  buildExecutionToolResponseHash,
  type ExecutionJournalCommitReceipt,
  type ExecutionResolvedTarget,
  type ExecutionToolSource,
  type NestedExecutionOperationIdentity
} from '@/tape/domain/executionJournal'
import type {
  ExecutionJournalWriter,
  NestedExecutionJournalWriter
} from '@/tape/ports/capabilities'
import type { ToolDispatchCommitInput } from '@shared/types/core/mcp'

export const PROGRAMMATIC_PARENT_SETTLEMENT_SCHEMA_VERSION = 1 as const

const SHA_256_PATTERN = /^[0-9a-f]{64}$/
const MAX_TOOL_IDENTITY_CHARACTERS = 1_024

export type ProgrammaticParentOperationState =
  | 'prepared'
  | 'armed'
  | 'settlement-issued'
  | 'settled'
  | 'revoked'
  | 'fatal'

export type ProgrammaticChildReservation = Readonly<{
  childOrdinal: number
  toolName: string
  toolSource: ExecutionToolSource
  target: ExecutionResolvedTarget
  definitionHash: string
  argumentTemplate: Readonly<Record<string, unknown>>
}>

export type ProgrammaticParentSettlementReceipt = Readonly<{
  schemaVersion: typeof PROGRAMMATIC_PARENT_SETTLEMENT_SCHEMA_VERSION
  operation: Readonly<{
    sessionId: string
    messageId: string
    runId: string
    requestSeq: number
    providerToolCallId: string
  }>
  outerDispatchEntryId: number
  capabilityHash: string
  responseHash: string
  isError: boolean
  startedChildren: number
  settledChildren: number
}>

export type ProgrammaticCompletedInvocationResult = Readonly<{
  responseText: string
  isError: boolean
}>

export class ProgrammaticParentOperationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_state'
      | 'invalid_plan'
      | 'identity_mismatch'
      | 'quota_exceeded'
      | 'unsettled_child'
  ) {
    super(message)
    this.name = 'ProgrammaticParentOperationError'
  }
}

type ProgrammaticExecutionJournal = Pick<ExecutionJournalWriter, 'commitToolOutcome'> &
  NestedExecutionJournalWriter

type NormalizedProgrammaticChildReservation = Readonly<{
  childOrdinal: number
  toolName: string
  toolSource: ExecutionToolSource
  target: ExecutionResolvedTarget
  definitionHash: string
  argumentTemplateHash: string
  argumentTemplateBytes: number
}>

type ReservedChildState = {
  reservation: NormalizedProgrammaticChildReservation
  normalizedArguments: Readonly<Record<string, unknown>> | null
  state: 'reserved' | 'materialized' | 'dispatched' | 'settled'
}

function normalizeIdentityString(
  value: unknown,
  name: string,
  maximum = MAX_TOOL_IDENTITY_CHARACTERS
): string {
  if (typeof value !== 'string') {
    throw new ProgrammaticParentOperationError(
      `${name} must contain 1 to ${maximum} characters`,
      'invalid_plan'
    )
  }
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximum || normalized.includes('\0')) {
    throw new ProgrammaticParentOperationError(
      `${name} must contain 1 to ${maximum} characters`,
      'invalid_plan'
    )
  }
  return normalized
}

function cloneCanonicalRecord(
  value: unknown,
  name: string
): Readonly<{
  value: Readonly<Record<string, unknown>>
  bytes: number
  hash: string
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProgrammaticParentOperationError(
      `Programmatic child ${name} must be a JSON object`,
      'invalid_plan'
    )
  }
  try {
    const canonical = canonicalJsonStringifyData(value)
    const normalized = JSON.parse(canonical) as Record<string, unknown>
    return {
      value: normalized,
      bytes: Buffer.byteLength(canonical, 'utf8'),
      hash: hashJsonData(normalized)
    }
  } catch {
    throw new ProgrammaticParentOperationError(
      `Programmatic child ${name} must be JSON serializable`,
      'invalid_plan'
    )
  }
}

function normalizeReservation(
  value: ProgrammaticChildReservation,
  expectedOrdinal: number
): NormalizedProgrammaticChildReservation {
  if (!value || typeof value !== 'object' || value.childOrdinal !== expectedOrdinal) {
    throw new ProgrammaticParentOperationError(
      'Programmatic child ordinals must be contiguous canonical plan indexes',
      'invalid_plan'
    )
  }
  if (value.toolSource !== 'agent' && value.toolSource !== 'mcp') {
    throw new ProgrammaticParentOperationError(
      'Programmatic child tool source is invalid',
      'invalid_plan'
    )
  }
  if (typeof value.definitionHash !== 'string' || !SHA_256_PATTERN.test(value.definitionHash)) {
    throw new ProgrammaticParentOperationError(
      'Programmatic child definition hash is invalid',
      'invalid_plan'
    )
  }
  const definitionHash = value.definitionHash
  const target = Object.freeze({
    serverName: normalizeIdentityString(value.target?.serverName, 'target.serverName'),
    ...(value.target?.originalName === undefined
      ? {}
      : {
          originalName: normalizeIdentityString(value.target.originalName, 'target.originalName')
        }),
    ...(value.target?.ownerPluginId === undefined
      ? {}
      : {
          ownerPluginId: normalizeIdentityString(value.target.ownerPluginId, 'target.ownerPluginId')
        })
  })
  const argumentTemplate = cloneCanonicalRecord(value.argumentTemplate, 'argument template')
  return Object.freeze({
    childOrdinal: expectedOrdinal,
    toolName: normalizeIdentityString(
      value.toolName,
      'toolName',
      MAX_EXECUTION_JOURNAL_TOOL_NAME_CHARACTERS
    ),
    toolSource: value.toolSource,
    target,
    definitionHash,
    argumentTemplateHash: argumentTemplate.hash,
    argumentTemplateBytes: argumentTemplate.bytes
  })
}

export class ProgrammaticToolParentController {
  private stateValue: ProgrammaticParentOperationState = 'prepared'
  private outerDispatchEntryId: number | null = null
  private children: ReadonlyMap<number, ReservedChildState> | null = null
  private nextChildOrdinal = 0
  private materializedInputBytes = 0
  private childOutputBytes = 0
  private childFailed = false
  private completedInvocationResult: ProgrammaticCompletedInvocationResult | null = null
  private completedInvocationResultClaimed = false
  private settlementReceipt: ProgrammaticParentSettlementReceipt | null = null

  constructor(
    private readonly preparedGrant: PreparedAgentCliProgrammaticGrant,
    private readonly executionJournal: ProgrammaticExecutionJournal
  ) {}

  get state(): ProgrammaticParentOperationState {
    return this.stateValue
  }

  get operation(): AgentCliProgrammaticOperationIdentity {
    return this.preparedGrant.binding.operation
  }

  get binding(): PreparedAgentCliProgrammaticGrant['binding'] {
    return this.preparedGrant.binding
  }

  get outerDispatchReceiptEntryId(): number | null {
    return this.outerDispatchEntryId
  }

  armOuterDispatch(
    receipt: ExecutionJournalCommitReceipt & {
      operation: AgentCliProgrammaticOperationIdentity
    }
  ): ArmedAgentCliProgrammaticToken {
    this.requireState('prepared')
    const operation = this.preparedGrant.binding.operation
    if (
      receipt.created !== true ||
      receipt.sessionId !== operation.sessionId ||
      !Number.isSafeInteger(receipt.entryId) ||
      receipt.entryId <= 0 ||
      receipt.operation.sessionId !== operation.sessionId ||
      receipt.operation.messageId !== operation.messageId ||
      receipt.operation.runId !== operation.runId ||
      receipt.operation.requestSeq !== operation.requestSeq ||
      receipt.operation.providerToolCallId !== operation.providerToolCallId
    ) {
      this.markFatal()
      throw new ProgrammaticParentOperationError(
        'Programmatic grant requires its newly committed outer dispatch receipt',
        'identity_mismatch'
      )
    }
    this.outerDispatchEntryId = receipt.entryId
    try {
      const armed = this.preparedGrant.arm({
        ...receipt,
        preparedTokenId: this.preparedGrant.tokenId,
        operation: receipt.operation
      })
      this.stateValue = 'armed'
      return armed
    } catch (error) {
      // The outer T1 is already durable, but no bearer token has escaped and no child can have
      // started. Preserve a deterministic pre-child failure state so the owner can commit T2.
      this.preparedGrant.revoke()
      this.stateValue = 'armed'
      throw error
    }
  }

  cancelBeforeOuterDispatch(): void {
    this.requireState('prepared')
    this.preparedGrant.revoke()
    this.stateValue = 'revoked'
  }

  /** Releases bearer/process authority without inventing a durable outcome for an armed parent. */
  releaseProcessAuthority(): void {
    this.preparedGrant.revoke()
  }

  failBeforeChildPlan(): void {
    this.requireState('armed')
    if (this.children) {
      throw new ProgrammaticParentOperationError(
        'Programmatic child plan is already reserved',
        'invalid_state'
      )
    }
    const verb = this.preparedGrant.binding.command.verb
    if (verb !== 'call' && verb !== 'batch') {
      throw new ProgrammaticParentOperationError(
        'This Programmatic operation does not require a child plan',
        'invalid_state'
      )
    }
    this.children = new Map()
    this.childFailed = true
    this.preparedGrant.revoke()
  }

  resolveProcessFailureResult(
    fallback: ProgrammaticCompletedInvocationResult
  ): ProgrammaticCompletedInvocationResult {
    this.requireState('armed')
    if (this.completedInvocationResult) {
      return this.takeCompletedInvocationResult()
    }

    const verb = this.preparedGrant.binding.command.verb
    if (verb === 'search' || verb === 'describe') {
      this.failBeforeDiscoveryResult()
    } else if (!this.children) {
      this.failBeforeChildPlan()
    } else {
      const hasUnknownChild = [...this.children.values()].some(
        (child) => child.state === 'dispatched'
      )
      if (hasUnknownChild) {
        throw new ProgrammaticParentOperationError(
          'Programmatic process failed with an unsettled child outcome',
          'unsettled_child'
        )
      }
      this.childFailed = true
      this.preparedGrant.revoke()
    }

    if (fallback.isError !== true) {
      this.markFatal()
      throw new ProgrammaticParentOperationError(
        'Programmatic process failure requires an outer error result',
        'identity_mismatch'
      )
    }
    this.requireOutputWithinQuota(
      fallback.responseText,
      0,
      'Programmatic process failure result exceeds the output quota'
    )
    return Object.freeze({ responseText: fallback.responseText, isError: true })
  }

  failBeforeDiscoveryResult(): void {
    this.requireState('armed')
    const verb = this.preparedGrant.binding.command.verb
    if (verb !== 'search' && verb !== 'describe') {
      throw new ProgrammaticParentOperationError(
        'This Programmatic operation is not a discovery request',
        'invalid_state'
      )
    }
    if (this.completedInvocationResult) {
      throw new ProgrammaticParentOperationError(
        'Programmatic discovery already has an authoritative result',
        'invalid_state'
      )
    }
    this.childFailed = true
    this.preparedGrant.revoke()
  }

  completeDiscoveryInvocation(input: ProgrammaticCompletedInvocationResult): void {
    this.requireState('armed')
    const verb = this.preparedGrant.binding.command.verb
    if (verb !== 'search' && verb !== 'describe') {
      throw new ProgrammaticParentOperationError(
        'Only Programmatic discovery can complete without a child plan',
        'invalid_state'
      )
    }
    this.completeInvocation(input, 'Programmatic discovery')
  }

  completeToolInvocation(input: ProgrammaticCompletedInvocationResult): void {
    this.requireState('armed')
    const verb = this.preparedGrant.binding.command.verb
    if (verb !== 'call' && verb !== 'batch') {
      throw new ProgrammaticParentOperationError(
        'Only Programmatic tool execution can complete a child plan',
        'invalid_state'
      )
    }
    if (!this.children) {
      throw new ProgrammaticParentOperationError(
        'Programmatic tool execution has no reserved child plan',
        'invalid_state'
      )
    }
    const childStates = [...this.children.values()]
    const startedChildren = childStates.filter(
      (child) => child.state === 'dispatched' || child.state === 'settled'
    ).length
    const settledChildren = childStates.filter((child) => child.state === 'settled').length
    if (
      startedChildren !== settledChildren ||
      (!this.childFailed && this.nextChildOrdinal !== childStates.length)
    ) {
      throw new ProgrammaticParentOperationError(
        'Programmatic tool execution cannot complete with unsettled children',
        'unsettled_child'
      )
    }
    if (this.childFailed !== input.isError) {
      this.markFatal()
      throw new ProgrammaticParentOperationError(
        'Programmatic tool result does not match the child plan outcome',
        'identity_mismatch'
      )
    }
    this.completeInvocation(input, 'Programmatic tool')
  }

  takeCompletedInvocationResult(): ProgrammaticCompletedInvocationResult {
    this.requireState('armed')
    if (!this.completedInvocationResult || this.completedInvocationResultClaimed) {
      throw new ProgrammaticParentOperationError(
        'Programmatic invocation has no unclaimed authoritative result',
        'invalid_state'
      )
    }
    this.completedInvocationResultClaimed = true
    return this.completedInvocationResult
  }

  reserveChildren(plan: readonly ProgrammaticChildReservation[]): void {
    this.requireState('armed')
    if (this.children) {
      throw new ProgrammaticParentOperationError(
        'Programmatic child plan is already reserved',
        'invalid_state'
      )
    }
    try {
      const { command, quotas } = this.preparedGrant.binding
      if (command.verb !== 'call' && command.verb !== 'batch') {
        throw new ProgrammaticParentOperationError(
          'This Programmatic operation cannot reserve tool children',
          'invalid_plan'
        )
      }
      if (!Array.isArray(plan) || plan.length === 0) {
        throw new ProgrammaticParentOperationError(
          'Programmatic child plan must not be empty',
          'invalid_plan'
        )
      }
      if (command.verb === 'call' && plan.length !== 1) {
        throw new ProgrammaticParentOperationError(
          'Programmatic call must reserve exactly one child',
          'invalid_plan'
        )
      }
      if (plan.length > quotas.maxChildren || plan.length > quotas.maxBatchSteps) {
        throw new ProgrammaticParentOperationError(
          'Programmatic child plan exceeds its operation quota',
          'quota_exceeded'
        )
      }
      const children = new Map<number, ReservedChildState>()
      let aggregateInputBytes = 0
      for (let index = 0; index < plan.length; index += 1) {
        const reservation = normalizeReservation(plan[index], index)
        aggregateInputBytes += reservation.argumentTemplateBytes
        if (aggregateInputBytes > quotas.maxInputBytes) {
          throw new ProgrammaticParentOperationError(
            'Programmatic child plan exceeds its aggregate input quota',
            'quota_exceeded'
          )
        }
        children.set(index, { reservation, normalizedArguments: null, state: 'reserved' })
      }
      this.children = children
    } catch (error) {
      this.children = new Map()
      this.childFailed = true
      this.preparedGrant.revoke()
      throw error
    }
  }

  materializeChild(input: {
    childOrdinal: number
    argumentTemplate: Readonly<Record<string, unknown>>
    normalizedArguments: Record<string, unknown>
  }): void {
    this.requireState('armed')
    if (input.childOrdinal !== this.nextChildOrdinal || this.childFailed) {
      throw new ProgrammaticParentOperationError(
        'Programmatic children must materialize sequentially and stop after a child error',
        'invalid_state'
      )
    }
    const child = this.requireChild(input.childOrdinal, 'reserved')
    let argumentTemplate: ReturnType<typeof cloneCanonicalRecord>
    let normalizedArguments: ReturnType<typeof cloneCanonicalRecord>
    try {
      argumentTemplate = cloneCanonicalRecord(input.argumentTemplate, 'argument template')
      normalizedArguments = cloneCanonicalRecord(input.normalizedArguments, 'normalized arguments')
    } catch (error) {
      this.childFailed = true
      throw error
    }
    if (argumentTemplate.hash !== child.reservation.argumentTemplateHash) {
      this.childFailed = true
      throw new ProgrammaticParentOperationError(
        'Programmatic child argument template changed after plan reservation',
        'identity_mismatch'
      )
    }
    const aggregateInputBytes = this.materializedInputBytes + normalizedArguments.bytes
    if (aggregateInputBytes > this.preparedGrant.binding.quotas.maxInputBytes) {
      this.childFailed = true
      throw new ProgrammaticParentOperationError(
        'Programmatic materialized arguments exceed the aggregate input quota',
        'quota_exceeded'
      )
    }
    child.normalizedArguments = normalizedArguments.value
    child.state = 'materialized'
    this.materializedInputBytes = aggregateInputBytes
  }

  commitChildDispatch(
    childOrdinal: number,
    input: ToolDispatchCommitInput
  ): ExecutionJournalCommitReceipt {
    this.requireState('armed')
    if (childOrdinal !== this.nextChildOrdinal || this.childFailed) {
      throw new ProgrammaticParentOperationError(
        'Programmatic children must dispatch sequentially and stop after a child error',
        'invalid_state'
      )
    }
    const child = this.requireChild(childOrdinal, 'materialized')
    const normalizedArguments = child.normalizedArguments
    if (!normalizedArguments) {
      throw new ProgrammaticParentOperationError(
        'Programmatic child materialized arguments are unavailable',
        'invalid_state'
      )
    }
    let dispatchedArguments: ReturnType<typeof cloneCanonicalRecord>
    let dispatchedTarget: ExecutionResolvedTarget
    try {
      dispatchedArguments = cloneCanonicalRecord(
        input.normalizedArguments,
        'dispatched normalized arguments'
      )
      dispatchedTarget = Object.freeze({
        serverName: normalizeIdentityString(input.target?.serverName, 'dispatch.target.serverName'),
        ...(input.target?.originalName === undefined
          ? {}
          : {
              originalName: normalizeIdentityString(
                input.target.originalName,
                'dispatch.target.originalName'
              )
            }),
        ...(input.target?.ownerPluginId === undefined
          ? {}
          : {
              ownerPluginId: normalizeIdentityString(
                input.target.ownerPluginId,
                'dispatch.target.ownerPluginId'
              )
            })
      })
    } catch (error) {
      this.markFatal()
      throw error
    }
    if (
      input.toolName !== child.reservation.toolName ||
      input.toolSource !== child.reservation.toolSource ||
      dispatchedTarget.serverName !== child.reservation.target.serverName ||
      dispatchedTarget.originalName !== child.reservation.target.originalName ||
      (child.reservation.target.ownerPluginId !== undefined &&
        dispatchedTarget.ownerPluginId !== child.reservation.target.ownerPluginId) ||
      dispatchedArguments.hash !== hashJsonData(normalizedArguments)
    ) {
      this.markFatal()
      throw new ProgrammaticParentOperationError(
        'Programmatic child dispatch does not match its reserved real target and arguments',
        'identity_mismatch'
      )
    }
    const operation = this.buildNestedOperation(childOrdinal)
    return this.runJournalMutation(() => {
      const receipt = this.executionJournal.commitNestedDispatch({
        sessionId: this.preparedGrant.binding.operation.sessionId,
        messageId: this.preparedGrant.binding.operation.messageId,
        operation,
        toolName: child.reservation.toolName,
        toolSource: child.reservation.toolSource,
        normalizedArguments,
        // Plugin ownership is resolved by the live MCP dispatch boundary. Preserve that actual
        // target identity in Tape even when it was not representable in the frozen catalog entry.
        target: dispatchedTarget,
        definitionHash: child.reservation.definitionHash,
        capabilityHash: this.preparedGrant.binding.capabilityHash
      })
      if (!receipt.created) {
        throw new ExecutionJournalCorruptionError(
          'Programmatic child dispatch identity was already committed.'
        )
      }
      child.normalizedArguments = null
      child.state = 'dispatched'
      return receipt
    })
  }

  commitChildOutcome(input: {
    childOrdinal: number
    responseText: string
    isError: boolean
  }): ExecutionJournalCommitReceipt {
    this.requireState('armed')
    const child = this.requireChild(input.childOrdinal, 'dispatched')
    const outputBytes = this.requireOutputWithinQuota(
      input.responseText,
      this.childOutputBytes,
      'Programmatic child outputs exceed the aggregate output quota'
    )
    return this.runJournalMutation(() => {
      const receipt = this.executionJournal.commitNestedToolOutcome({
        sessionId: this.preparedGrant.binding.operation.sessionId,
        messageId: this.preparedGrant.binding.operation.messageId,
        operation: this.buildNestedOperation(input.childOrdinal),
        responseText: input.responseText,
        isError: input.isError
      })
      if (!receipt.created) {
        throw new ExecutionJournalCorruptionError(
          'Programmatic child outcome identity was already committed.'
        )
      }
      child.state = 'settled'
      this.childOutputBytes += outputBytes
      this.childFailed = input.isError
      this.nextChildOrdinal += 1
      return receipt
    })
  }

  stopBeforeChild(childOrdinal: number): void {
    this.requireState('armed')
    if (childOrdinal !== this.nextChildOrdinal) {
      throw new ProgrammaticParentOperationError(
        'Programmatic preflight refusal does not match the next child',
        'invalid_state'
      )
    }
    const child = this.children?.get(childOrdinal)
    if (!child || (child.state !== 'reserved' && child.state !== 'materialized')) {
      throw new ProgrammaticParentOperationError(
        `Programmatic child ${childOrdinal} cannot stop before dispatch`,
        'invalid_state'
      )
    }
    if (this.childFailed) return
    this.childFailed = true
  }

  issueSettlementReceipt(input: {
    responseText: string
    isError: boolean
  }): ProgrammaticParentSettlementReceipt {
    this.requireState('armed')
    this.requireOutputWithinQuota(
      input.responseText,
      0,
      'Programmatic outer result exceeds the output quota'
    )
    const verb = this.preparedGrant.binding.command.verb
    if (this.completedInvocationResult) {
      if (
        !this.completedInvocationResultClaimed ||
        this.completedInvocationResult.responseText !== input.responseText ||
        this.completedInvocationResult.isError !== input.isError
      ) {
        this.markFatal()
        throw new ProgrammaticParentOperationError(
          'Programmatic outer result does not match its authoritative invocation result',
          'identity_mismatch'
        )
      }
    } else if (!this.childFailed) {
      throw new ProgrammaticParentOperationError(
        `Programmatic ${verb} cannot settle before an authoritative result`,
        'invalid_state'
      )
    }
    if ((verb === 'call' || verb === 'batch') && !this.children) {
      throw new ProgrammaticParentOperationError(
        'Programmatic tool execution requires a reserved child plan',
        'invalid_state'
      )
    }
    const childStates = [...(this.children?.values() ?? [])]
    const startedChildren = childStates.filter(
      (child) => child.state === 'dispatched' || child.state === 'settled'
    ).length
    const settledChildren = childStates.filter((child) => child.state === 'settled').length
    if (startedChildren !== settledChildren) {
      throw new ProgrammaticParentOperationError(
        'Programmatic parent cannot settle while a child outcome is unknown',
        'unsettled_child'
      )
    }
    if (!this.childFailed && this.nextChildOrdinal !== childStates.length) {
      throw new ProgrammaticParentOperationError(
        'Programmatic parent cannot settle before every planned child completes',
        'unsettled_child'
      )
    }
    if (typeof input.isError !== 'boolean') {
      throw new ProgrammaticParentOperationError(
        'Programmatic outer result error state is invalid',
        'identity_mismatch'
      )
    }
    if (this.childFailed && !input.isError) {
      throw new ProgrammaticParentOperationError(
        'Programmatic stopped child execution requires an outer error result',
        'identity_mismatch'
      )
    }
    const outerDispatchEntryId = this.requireOuterDispatchEntryId()
    const operation = this.preparedGrant.binding.operation
    const receipt = Object.freeze({
      schemaVersion: PROGRAMMATIC_PARENT_SETTLEMENT_SCHEMA_VERSION,
      operation,
      outerDispatchEntryId,
      capabilityHash: this.preparedGrant.binding.capabilityHash,
      responseHash: buildExecutionToolResponseHash(input.responseText),
      isError: input.isError,
      startedChildren,
      settledChildren
    })
    this.settlementReceipt = receipt
    this.stateValue = 'settlement-issued'
    return receipt
  }

  commitOuterOutcome(
    receipt: ProgrammaticParentSettlementReceipt,
    input: { responseText: string; isError: boolean }
  ): ExecutionJournalCommitReceipt {
    this.requireState('settlement-issued')
    if (
      receipt !== this.settlementReceipt ||
      receipt.responseHash !== buildExecutionToolResponseHash(input.responseText) ||
      receipt.isError !== input.isError
    ) {
      this.markFatal()
      throw new ProgrammaticParentOperationError(
        'Programmatic outer result does not match its process-live settlement receipt',
        'identity_mismatch'
      )
    }
    return this.runJournalMutation(() => {
      const operation = this.preparedGrant.binding.operation
      const outcome = this.executionJournal.commitToolOutcome({
        sessionId: operation.sessionId,
        messageId: operation.messageId,
        operation: {
          runId: operation.runId,
          requestSeq: operation.requestSeq,
          providerToolCallId: operation.providerToolCallId
        },
        responseText: input.responseText,
        isError: input.isError
      })
      if (!outcome.created) {
        throw new ExecutionJournalCorruptionError(
          'Programmatic outer outcome identity was already committed.'
        )
      }
      this.preparedGrant.revoke()
      this.stateValue = 'settled'
      return outcome
    })
  }

  assertRunTerminalAllowed(): void {
    if (this.stateValue === 'settled' || this.stateValue === 'revoked') return
    throw new ProgrammaticParentOperationError(
      'Programmatic parent operation has not settled its outer outcome',
      'unsettled_child'
    )
  }

  private buildNestedOperation(childOrdinal: number): NestedExecutionOperationIdentity {
    const operation = this.preparedGrant.binding.operation
    return {
      kind: 'nested',
      runId: operation.runId,
      requestSeq: operation.requestSeq,
      providerToolCallId: operation.providerToolCallId,
      childOrdinal
    }
  }

  private requireChild(
    childOrdinal: number,
    expectedState: ReservedChildState['state']
  ): ReservedChildState {
    if (!Number.isSafeInteger(childOrdinal) || childOrdinal < 0) {
      throw new ProgrammaticParentOperationError(
        'Programmatic child ordinal is invalid',
        'invalid_plan'
      )
    }
    const child = this.children?.get(childOrdinal)
    if (!child || child.state !== expectedState) {
      throw new ProgrammaticParentOperationError(
        `Programmatic child ${childOrdinal} is not ${expectedState}`,
        'invalid_state'
      )
    }
    return child
  }

  private requireOuterDispatchEntryId(): number {
    if (!this.outerDispatchEntryId) {
      throw new ProgrammaticParentOperationError(
        'Programmatic parent has no committed outer dispatch',
        'invalid_state'
      )
    }
    return this.outerDispatchEntryId
  }

  private completeInvocation(input: ProgrammaticCompletedInvocationResult, label: string): void {
    if (this.completedInvocationResult) {
      this.markFatal()
      throw new ProgrammaticParentOperationError(
        `${label} produced more than one authoritative result`,
        'identity_mismatch'
      )
    }
    if (typeof input.isError !== 'boolean') {
      this.markFatal()
      throw new ProgrammaticParentOperationError(
        `${label} result error state is invalid`,
        'identity_mismatch'
      )
    }
    this.requireOutputWithinQuota(input.responseText, 0, `${label} result exceeds the output quota`)
    this.completedInvocationResult = Object.freeze({
      responseText: input.responseText,
      isError: input.isError
    })
  }

  private requireOutputWithinQuota(value: unknown, accumulated: number, message: string): number {
    if (typeof value !== 'string') {
      this.markFatal()
      throw new ProgrammaticParentOperationError(
        'Programmatic output must be a string',
        'identity_mismatch'
      )
    }
    const bytes = Buffer.byteLength(value, 'utf8')
    if (bytes > this.preparedGrant.binding.quotas.maxOutputBytes - accumulated) {
      this.markFatal()
      throw new ProgrammaticParentOperationError(message, 'quota_exceeded')
    }
    return bytes
  }

  private requireState(expected: ProgrammaticParentOperationState): void {
    if (this.stateValue !== expected) {
      throw new ProgrammaticParentOperationError(
        `Programmatic parent operation is ${this.stateValue}, expected ${expected}`,
        'invalid_state'
      )
    }
  }

  private runJournalMutation<T>(operation: () => T): T {
    try {
      return operation()
    } catch (error) {
      this.markFatal()
      throw error
    }
  }

  private markFatal(): void {
    this.preparedGrant.revoke()
    this.stateValue = 'fatal'
  }
}
