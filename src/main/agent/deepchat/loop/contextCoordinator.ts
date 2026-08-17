import {
  MAX_CONTEXT_RECOVERY_SEQUENCES_PER_RUN,
  advanceRequestSequence,
  beginContextRecoverySequence,
  bindActiveRequestContract,
  bindActiveRequestView,
  bindActiveRequestToolSurface,
  enterPhysicalAttempt,
  resetContextRecoverySequence,
  resolveSkillContextsForRequest,
  type LoopRun,
  type LoopRunPromptUsageAnchor
} from './loopRun'
import type { ChatMessage } from '@shared/types/core/chat-message'
import {
  createStreamEvent,
  type ErrorStreamEvent,
  type LLMCoreStreamEvent,
  type ProviderRoundStopReason,
  type UsageStreamEvent
} from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { ModelConfig } from '@shared/types/provider'
import type { DeepChatExecutionContract } from '@shared/types/execution-contract'
import { isDeepStrictEqual } from 'node:util'
import type {
  DeepChatProviderAttemptIdentity,
  DeepChatProviderAttemptOrigin,
  DeepChatProviderContextPressureObservation,
  DeepChatProviderFailureClassification,
  DeepChatProviderRequestOrigin,
  DeepChatProviderRetryDecision
} from '@shared/types/provider-attempt'
import type {
  DeepChatTapeSkillContext,
  DeepChatTapeViewContextBuilderVersion,
  DeepChatTapeViewPolicy,
  DeepChatTapeViewSyntheticContribution,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'
import {
  getContextSyntheticContributions,
  type ContextCheckpoint,
  type ContextRuntimeContributions
} from '@/agent/deepchat/runtime/contextContributions'
import { estimateMessagesTokens } from '@/agent/deepchat/runtime/contextBuilder'
import {
  buildEffectiveGenerationConfigHash,
  buildProviderMessagesHash,
  buildProviderVisibleToolDefinitionsHash
} from '@/tape/domain/executionContract'
import { compactClosedToolResultsForContext } from '@/agent/deepchat/runtime/toolOutputGuard'
import {
  classifyProviderFailure,
  emitProviderRetryLifecycleEvent,
  MAX_TRANSIENT_RETRIES_PER_LOGICAL_ROUND,
  resolveProviderRetryDelay,
  waitForProviderRetry,
  type ProviderFailureAssessment,
  type ProviderRetryObserver
} from './providerRetryPolicy'
import {
  assertIssuedToolSurfaceSnapshot,
  type ToolSurfaceActivationEvidence,
  type ToolSurfaceSnapshot
} from '@/agent/deepchat/runtime/toolSurface'
import {
  assertProgrammaticToolCapabilityViewPrepared,
  markProgrammaticToolCapabilityProvenanceCommitted,
  type ProgrammaticToolCapabilityV1
} from '@/agent/deepchat/runtime/programmaticToolSurface'

export interface ContextAssembly<TContributions, TView> {
  assembleContributions(): Promise<TContributions>
  buildView(contributions: TContributions): TView
  assertCurrent(): void
}

export interface PreparedContext<TContributions, TView> {
  contributions: TContributions
  view: TView
}

export type OptionalCompactionResult<TSummary> =
  | { applied: false }
  | { applied: true; summary: TSummary }

export interface ContextPressureRecovery<TSummary> {
  requestMessages: ChatMessage[]
  baseSystemPrompt?: string
  requestedMaxTokens: number
  toolReserveTokens: number
  minimumProtectedTailCount: number
  contextContributions: ContextRuntimeContributions
  prepareCompaction(systemPrompt: string): Promise<OptionalCompactionResult<TSummary>>
  assembleCheckpoint(summary: TSummary): Promise<ContextCheckpoint>
  getSummaryCursorOrderSeq(summary: TSummary): number
  fit(input: {
    messages: ChatMessage[]
    reserveTokens: number
    minimumProtectedTailCount: number
    pinnedFirstUserContentHash?: string
  }): ChatMessage[]
  rebuildAfterCompaction(input: { summary: TSummary; requestMessages: ChatMessage[] }): {
    messages: ChatMessage[]
    pinnedFirstUserContentHash?: string
  }
  measure(messages: ChatMessage[]): number
  assertCurrent(): void
}

export interface ContextPressureRecoveryResult {
  messages: ChatMessage[]
  summaryCursorOrderSeq?: number
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
}

export interface RequestContextPreflight {
  messages: ChatMessage[]
  contextLength: number
  inputTokens: number
  toolReserveTokens: number
  requestedMaxTokens: number
  effectiveMaxTokens: number
  usableContextLength: number
  remainingOutputTokens: number
  totalRequestTokens: number
  fitsWithinContext: boolean
  shrunkByContextPressure: boolean
  requiresContextPressureRecovery: boolean
}

export interface ProviderAttemptBudgetPort {
  estimateToolReserveTokens(tools: MCPToolDefinition[]): number
  getEffectiveContextLength(requestedMaxTokens: number): number
  preflight(input: {
    messages: ChatMessage[]
    tools: MCPToolDefinition[]
    requestedMaxTokens: number
    promptTokenEstimate?: number
  }): RequestContextPreflight
  fitStrictRetry(input: {
    messages: ChatMessage[]
    reserveTokens: number
    requestedMaxTokens: number
  }): ChatMessage[]
  getStrictRetryMaxTokens(maxTokens: number): number
  getStrictRetryExtraReserve(): number
  buildOverflowError(preflight: RequestContextPreflight): Error
  buildOverflowAfterRecoveryError(
    preflight: RequestContextPreflight,
    facts?: ProviderContextOverflowFacts,
    disposition?: ProviderContextOverflowDisposition
  ): Error
}

export type ProviderContextOverflowDisposition =
  | 'provider_rejected_retry'
  | 'retry_projection_unchanged'
  | 'retry_projection_cannot_fit'

export interface ProviderContextOverflowFacts {
  matched: boolean
  actualTokens?: number
  limitTokens?: number
  limitScope?: 'context' | 'prompt'
  scope?: 'prompt' | 'input' | 'request' | 'messages' | 'unknown'
  confidence: 'none' | 'qualitative' | 'explicit'
}

export interface ProviderAttemptRecoveryPort {
  recover(input: {
    requestMessages: ChatMessage[]
    requestedMaxTokens: number
    tools: MCPToolDefinition[]
  }): Promise<ContextPressureRecoveryResult>
}

export interface ProviderAttemptManifestContext<TSelection> {
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  selection: TSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  contextBuilderVersion: DeepChatTapeViewContextBuilderVersion
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
}

export interface ProviderAttemptManifestInput<TSelection> {
  requestSeq: number
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  tokenBudget: Omit<DeepChatTapeViewTokenBudget, 'estimatedPromptTokens'>
  selection?: TSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  contextBuilderVersion: DeepChatTapeViewContextBuilderVersion
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
  executionContract?: DeepChatExecutionContract
  runId?: string
  tapeIncarnationId?: string
  skillContexts?: DeepChatTapeSkillContext[]
  requireDurableManifest?: boolean
  /** Exact immutable snapshot whose tool definitions are sent by this provider request. */
  toolSurfaceSnapshot: ToolSurfaceSnapshot | null
  /** Process-live authority projected synchronously into this View; never reconstructed from Tape. */
  programmaticToolCapability: ProgrammaticToolCapabilityV1 | null
}

export interface ProviderAttemptManifestPort<TSelection> {
  resolvePolicy(input: {
    recoveredFromContextPressure: boolean
    isInitialViewRequest: boolean
    viewPolicy?: DeepChatTapeViewPolicy
    viewPolicyVersion?: number | null
  }): { policy: DeepChatTapeViewPolicy; policyVersion: number | null }
  append(input: ProviderAttemptManifestInput<TSelection>): {
    manifestHash: string
    tapeIncarnationId?: string
  } | void
  onAppendError(error: unknown, context: ProviderAttemptManifestFailureContext): void
}

export interface ProviderAttemptManifestFailureContext {
  readonly requestSeq: number
  readonly failurePolicy: 'fail-open' | 'fail-closed'
  readonly toolSurfaceApplicable: boolean
  readonly verified: false
}

export interface ProviderAttemptExecutionContractBuildInput {
  requestSeq: number
  messages: ChatMessage[]
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  tools: MCPToolDefinition[]
  contextBuilderVersion: DeepChatTapeViewContextBuilderVersion
}

export interface ProviderAttemptExecutionContractPort {
  build(input: ProviderAttemptExecutionContractBuildInput): DeepChatExecutionContract
  onBuildError(error: unknown): void
}

export interface ProviderAttemptSkillAuthority {
  readonly sessionId: string
  readonly messageId: string
  readonly runId: string
  readonly requestSeq: number
  readonly manifestHash: string
  readonly tapeIncarnationId: string
  readonly skillContexts: readonly DeepChatTapeSkillContext[]
}

export interface ProviderAttemptAuthorityPort {
  assertCurrent(input: {
    authority: ProviderAttemptSkillAuthority
    messages: readonly ChatMessage[]
    tools: readonly MCPToolDefinition[]
  }): void
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}

export interface ProviderAttemptToolSurfacePort {
  build(input: {
    requestSeq: number
    tools: readonly MCPToolDefinition[]
    deferActivationCandidates?: boolean
  }): ToolSurfaceSnapshot
  buildProgrammaticCapability?(snapshot: ToolSurfaceSnapshot): ProgrammaticToolCapabilityV1
  /** Commits only the prepared in-memory Run ordering; it must not perform I/O or cancel the Run. */
  admit(input: { requestSeq: number; snapshot: ToolSurfaceSnapshot }): void
  releaseActivationCandidates(candidates: readonly ToolSurfaceActivationEvidence[]): void
}

export interface ProviderRateGatePort {
  beforeWait(): void
  wait(signal: AbortSignal): Promise<void>
  clearWaiting(): void
}

export interface ProviderAttemptStreamInput {
  identity: DeepChatProviderAttemptIdentity
  requestOrigin: DeepChatProviderRequestOrigin
  attemptOrigin: DeepChatProviderAttemptOrigin
  messages: ChatMessage[]
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  tools: MCPToolDefinition[]
  executionContract: DeepChatExecutionContract | null
  toolSurfaceSnapshot: ToolSurfaceSnapshot | null
  signal: AbortSignal
}

export interface ProviderAttemptStreamPort {
  stream(input: ProviderAttemptStreamInput): AsyncGenerator<LLMCoreStreamEvent>
  beforeStream(): void
}

export interface ProviderAttemptUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface ProviderAttemptOutcomeInput {
  logicalRound: number
  requestSeq: number
  physicalAttempt: number
  requestOrigin: DeepChatProviderRequestOrigin
  attemptOrigin: DeepChatProviderAttemptOrigin
  status: 'completed' | 'context_overflow' | 'aborted' | 'error'
  stopReason: ProviderRoundStopReason | null
  failureClassification: DeepChatProviderFailureClassification | null
  retryDecision: DeepChatProviderRetryDecision
  httpStatus: number | null
  errorCode: string | null
  retryDelayMs: number | null
  usage: ProviderAttemptUsage | null
  contextPressure: DeepChatProviderContextPressureObservation | null
}

export interface ProviderAttemptOutcomePort {
  append(input: ProviderAttemptOutcomeInput): void
  onAppendError(error: unknown): void
}

function checkedTokenCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Provider usage ${field} must be a non-negative safe integer.`)
  }
  return value
}

function checkedTokenSum(left: number, right: number, field: string): number {
  const total = checkedTokenCount(left, field) + checkedTokenCount(right, field)
  if (!Number.isSafeInteger(total)) {
    throw new RangeError(`Provider usage ${field} exceeds the safe integer range.`)
  }
  return total
}

function providerAttemptUsageFromEvent(event: UsageStreamEvent): ProviderAttemptUsage {
  return {
    inputTokens: checkedTokenCount(event.usage.prompt_tokens, 'prompt_tokens'),
    outputTokens: checkedTokenCount(event.usage.completion_tokens, 'completion_tokens'),
    totalTokens: checkedTokenCount(event.usage.total_tokens, 'total_tokens'),
    ...(event.usage.cached_tokens !== undefined
      ? { cacheReadTokens: checkedTokenCount(event.usage.cached_tokens, 'cached_tokens') }
      : {}),
    ...(event.usage.cache_write_tokens !== undefined
      ? {
          cacheWriteTokens: checkedTokenCount(event.usage.cache_write_tokens, 'cache_write_tokens')
        }
      : {})
  }
}

function detectProviderContextPressure(input: {
  bypassContextBudget: boolean
  contextWindowTokens: number
  status: ProviderAttemptOutcomeInput['status']
  stopReason: ProviderRoundStopReason | null
  usage: ProviderAttemptUsage | null
}): DeepChatProviderContextPressureObservation | null {
  if (
    input.bypassContextBudget ||
    input.status !== 'completed' ||
    !input.usage ||
    !Number.isSafeInteger(input.contextWindowTokens) ||
    input.contextWindowTokens <= 0
  ) {
    return null
  }

  if (input.stopReason === 'complete' && input.usage.inputTokens > input.contextWindowTokens) {
    return {
      kind: 'successful_prompt_overflow',
      contextWindowTokens: input.contextWindowTokens,
      thresholdTokens: input.contextWindowTokens
    }
  }

  const thresholdTokens = Math.max(1, Math.ceil(input.contextWindowTokens * 0.99))
  if (
    input.stopReason === 'max_tokens' &&
    input.usage.outputTokens === 0 &&
    input.usage.inputTokens >= thresholdTokens
  ) {
    return {
      kind: 'zero_output_length_at_limit',
      contextWindowTokens: input.contextWindowTokens,
      thresholdTokens
    }
  }

  return null
}

function aggregateProviderAttemptUsage(
  aggregate: ProviderAttemptUsage | null,
  attempt: ProviderAttemptUsage | null
): ProviderAttemptUsage | null {
  if (!attempt) return aggregate
  if (!aggregate) return { ...attempt }

  const cacheReadTokens =
    aggregate.cacheReadTokens === undefined && attempt.cacheReadTokens === undefined
      ? undefined
      : checkedTokenSum(
          aggregate.cacheReadTokens ?? 0,
          attempt.cacheReadTokens ?? 0,
          'cached_tokens'
        )
  const cacheWriteTokens =
    aggregate.cacheWriteTokens === undefined && attempt.cacheWriteTokens === undefined
      ? undefined
      : checkedTokenSum(
          aggregate.cacheWriteTokens ?? 0,
          attempt.cacheWriteTokens ?? 0,
          'cache_write_tokens'
        )
  return {
    inputTokens: checkedTokenSum(aggregate.inputTokens, attempt.inputTokens, 'prompt_tokens'),
    outputTokens: checkedTokenSum(
      aggregate.outputTokens,
      attempt.outputTokens,
      'completion_tokens'
    ),
    totalTokens: checkedTokenSum(aggregate.totalTokens, attempt.totalTokens, 'total_tokens'),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {})
  }
}

function createAggregatedUsageEvent(usage: ProviderAttemptUsage): UsageStreamEvent {
  return createStreamEvent.usage({
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    ...(usage.cacheReadTokens !== undefined ? { cached_tokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cache_write_tokens: usage.cacheWriteTokens } : {})
  })
}

function isProviderControlEvent(
  event: LLMCoreStreamEvent
): event is ErrorStreamEvent | UsageStreamEvent | Extract<LLMCoreStreamEvent, { type: 'stop' }> {
  return event.type === 'error' || event.type === 'usage' || event.type === 'stop'
}

const PREMATURE_PROVIDER_STREAM_ERROR = 'Provider stream ended without a terminal stop event.'
const CONTEXT_OVERFLOW_AFTER_OUTPUT_ERROR =
  'The provider reported a context overflow after response output began. DeepChat preserved the partial output and did not retry.'

interface ProviderAttemptObservation {
  outputCommitted: boolean
  contextOverflowObserved: boolean
  providerThrew: boolean
  providerError: unknown
  errorEvent: ErrorStreamEvent | null
  stopEvent: Extract<LLMCoreStreamEvent, { type: 'stop' }> | null
  stopReason: ProviderRoundStopReason | null
  prematureEof: boolean
  usage: ProviderAttemptUsage | null
  contextOverflowFacts: ProviderContextOverflowFacts | null
}

function createProviderAttemptObservation(): ProviderAttemptObservation {
  return {
    outputCommitted: false,
    contextOverflowObserved: false,
    providerThrew: false,
    providerError: undefined,
    errorEvent: null,
    stopEvent: null,
    stopReason: null,
    prematureEof: false,
    usage: null,
    contextOverflowFacts: null
  }
}

interface ProviderAttemptAssessment {
  failureAssessment: ProviderFailureAssessment | null
  failureClassification: DeepChatProviderFailureClassification | null
  status: ProviderAttemptOutcomeInput['status']
  stopReason: ProviderRoundStopReason | null
}

function assessProviderAttemptObservation(input: {
  observation: ProviderAttemptObservation
  signalAborted: boolean
  forceFailure?: boolean
}): ProviderAttemptAssessment {
  const { observation } = input
  const hasFailure =
    input.forceFailure === true ||
    input.signalAborted ||
    observation.providerThrew ||
    observation.errorEvent !== null ||
    observation.stopReason === 'error'
  const failureAssessment = hasFailure
    ? classifyProviderFailure({
        signalAborted: input.signalAborted,
        contextOverflow: observation.contextOverflowObserved,
        ...(observation.providerThrew ? { error: observation.providerError } : {}),
        ...(observation.errorEvent ? { errorEvent: observation.errorEvent } : {}),
        prematureEof: observation.prematureEof
      })
    : null
  const failureClassification = failureAssessment?.classification ?? null
  const status: ProviderAttemptOutcomeInput['status'] =
    failureClassification === 'aborted'
      ? 'aborted'
      : failureClassification === 'context_overflow'
        ? 'context_overflow'
        : hasFailure
          ? 'error'
          : 'completed'
  const stopReason =
    (failureClassification === 'aborted' || observation.providerThrew) &&
    observation.stopReason !== 'error'
      ? null
      : observation.stopReason

  return { failureAssessment, failureClassification, status, stopReason }
}

async function* observeProviderAttempt(input: {
  provider: ProviderAttemptStreamPort
  streamInput: ProviderAttemptStreamInput
  observation: ProviderAttemptObservation
  bypassContextBudget: boolean
  isContextOverflowEvent(event: LLMCoreStreamEvent): boolean
  isContextOverflowError(error: unknown): boolean
  inspectContextOverflow?: (value: unknown) => ProviderContextOverflowFacts
  onContextOverflowFacts?: (facts: ProviderContextOverflowFacts) => void
}): AsyncGenerator<LLMCoreStreamEvent, void, void> {
  const { observation } = input
  try {
    for await (const event of input.provider.stream(input.streamInput)) {
      if (!input.bypassContextBudget && input.isContextOverflowEvent(event)) {
        observation.contextOverflowObserved = true
        const facts = input.inspectContextOverflow?.(event)
        if (facts?.matched) {
          observation.contextOverflowFacts = facts
          input.onContextOverflowFacts?.(facts)
        }
      }
      if (event.type === 'usage') {
        observation.usage = providerAttemptUsageFromEvent(event)
      } else if (event.type === 'error') {
        observation.errorEvent = event
        observation.stopReason = 'error'
      } else if (event.type === 'stop') {
        observation.stopEvent = event
        if (observation.stopReason !== 'error') {
          observation.stopReason = event.stop_reason
        }
      }

      if (!isProviderControlEvent(event)) {
        observation.outputCommitted = true
        yield event
      }
    }
  } catch (error) {
    observation.providerThrew = true
    observation.providerError = error
    if (!input.bypassContextBudget && input.isContextOverflowError(error)) {
      observation.contextOverflowObserved = true
      const facts = input.inspectContextOverflow?.(error)
      if (facts?.matched) {
        observation.contextOverflowFacts = facts
        input.onContextOverflowFacts?.(facts)
      }
    }
  }

  observation.prematureEof =
    !observation.providerThrew && observation.errorEvent === null && observation.stopEvent === null
  if (observation.prematureEof) {
    observation.errorEvent = createStreamEvent.error(PREMATURE_PROVIDER_STREAM_ERROR, {
      code: 'premature_eof',
      retryable: true
    })
    observation.stopReason = 'error'
  }
}

export interface ProviderAttemptInput<TSelection> {
  run: LoopRun<unknown>
  requestMessages: ChatMessage[]
  providerId: string
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  tools: MCPToolDefinition[]
  allowTransientRetry: boolean
  bypassContextBudget: boolean
  fallbackContextLength: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  viewContext?: ProviderAttemptManifestContext<TSelection>
  budget: ProviderAttemptBudgetPort
  recovery: ProviderAttemptRecoveryPort
  manifest: ProviderAttemptManifestPort<TSelection>
  authority: ProviderAttemptAuthorityPort
  executionContract?: ProviderAttemptExecutionContractPort
  toolSurface?: ProviderAttemptToolSurfacePort
  strictViewContract?: boolean
  requireDurableManifest?: boolean
  rateGate: ProviderRateGatePort
  provider: ProviderAttemptStreamPort
  outcome: ProviderAttemptOutcomePort
  retryObserver?: ProviderRetryObserver
  isContextOverflowEvent(event: LLMCoreStreamEvent): boolean
  isContextOverflowError(error: unknown): boolean
  inspectContextOverflow?(value: unknown): ProviderContextOverflowFacts
  onContextOverflowFacts?(facts: ProviderContextOverflowFacts): void
  createAbortError(): Error
}

function buildPromptUsageEnvelope(input: {
  providerId: string
  modelId: string
  effectiveContextLength: number
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  tools: MCPToolDefinition[]
}): Pick<
  LoopRunPromptUsageAnchor,
  | 'providerId'
  | 'modelId'
  | 'effectiveContextLength'
  | 'generationConfigHash'
  | 'toolDefinitionsHash'
> | null {
  if (!Number.isSafeInteger(input.effectiveContextLength) || input.effectiveContextLength <= 0) {
    return null
  }
  try {
    return {
      providerId: input.providerId,
      modelId: input.modelId,
      effectiveContextLength: input.effectiveContextLength,
      generationConfigHash: buildEffectiveGenerationConfigHash({
        modelConfig: input.modelConfig,
        temperature: input.temperature,
        maxTokens: input.maxTokens
      }),
      toolDefinitionsHash: buildProviderVisibleToolDefinitionsHash(input.tools)
    }
  } catch {
    return null
  }
}

function projectPromptTokensFromUsageAnchor(input: {
  run: LoopRun<unknown>
  providerId: string
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  tools: MCPToolDefinition[]
  messages: ChatMessage[]
  budget: ProviderAttemptBudgetPort
}): number | null {
  const anchor = input.run.promptUsageAnchor
  if (!anchor) return null
  if (input.messages.length < anchor.messageCount) {
    input.run.promptUsageAnchor = null
    return null
  }
  let effectiveContextLength: number
  try {
    effectiveContextLength = input.budget.getEffectiveContextLength(input.maxTokens)
  } catch {
    input.run.promptUsageAnchor = null
    return null
  }
  const envelope = buildPromptUsageEnvelope({
    ...input,
    effectiveContextLength
  })
  if (
    !envelope ||
    envelope.providerId !== anchor.providerId ||
    envelope.modelId !== anchor.modelId ||
    envelope.effectiveContextLength !== anchor.effectiveContextLength ||
    envelope.generationConfigHash !== anchor.generationConfigHash ||
    envelope.toolDefinitionsHash !== anchor.toolDefinitionsHash
  ) {
    input.run.promptUsageAnchor = null
    return null
  }
  try {
    const anchoredPrefix = input.messages.slice(0, anchor.messageCount)
    if (buildProviderMessagesHash(anchoredPrefix) !== anchor.messagesHash) {
      input.run.promptUsageAnchor = null
      return null
    }
    const projected =
      anchor.promptTokens + estimateMessagesTokens(input.messages.slice(anchor.messageCount))
    if (Number.isSafeInteger(projected) && projected >= 0) return projected
    input.run.promptUsageAnchor = null
    return null
  } catch {
    input.run.promptUsageAnchor = null
    return null
  }
}

function updatePromptUsageAnchor(input: {
  run: LoopRun<unknown>
  usage: ProviderAttemptUsage | null
  providerId: string
  modelId: string
  modelConfig: ModelConfig
  temperature: number
  maxTokens: number
  tools: MCPToolDefinition[]
  messages: ChatMessage[]
  continuationMessages: ChatMessage[]
  budget: ProviderAttemptBudgetPort
}): void {
  if (
    !input.usage ||
    input.usage.inputTokens <= 0 ||
    (input.usage.cacheReadTokens !== undefined &&
      input.usage.cacheReadTokens > input.usage.inputTokens) ||
    input.messages.length === 0 ||
    input.messages.length !== input.continuationMessages.length ||
    !input.messages.every((message, index) => message === input.continuationMessages[index])
  ) {
    return
  }
  let effectiveContextLength: number
  try {
    effectiveContextLength = input.budget.getEffectiveContextLength(input.maxTokens)
  } catch {
    input.run.promptUsageAnchor = null
    return
  }
  const envelope = buildPromptUsageEnvelope({ ...input, effectiveContextLength })
  if (!envelope) {
    input.run.promptUsageAnchor = null
    return
  }
  try {
    const messagesHash = buildProviderMessagesHash(input.messages)
    input.run.promptUsageAnchor = {
      ...envelope,
      messageCount: input.messages.length,
      messagesHash,
      promptTokens: input.usage.inputTokens,
      cacheReadTokens: input.usage.cacheReadTokens ?? null
    }
  } catch {
    input.run.promptUsageAnchor = null
  }
}

export class DeepChatContextCoordinator {
  async assemble<TContributions, TView>(
    input: ContextAssembly<TContributions, TView>
  ): Promise<PreparedContext<TContributions, TView>> {
    const contributions = await input.assembleContributions()
    input.assertCurrent()
    return {
      contributions,
      view: input.buildView(contributions)
    }
  }

  async recoverFromPressure<TSummary>(
    input: ContextPressureRecovery<TSummary>
  ): Promise<ContextPressureRecoveryResult> {
    input.assertCurrent()
    const systemPromptBase =
      input.baseSystemPrompt ?? this.getLeadingSystemPrompt(input.requestMessages) ?? ''
    const compaction = await input.prepareCompaction(systemPromptBase)
    input.assertCurrent()
    if (!compaction.applied) {
      return { messages: input.requestMessages }
    }

    const checkpoint = await input.assembleCheckpoint(compaction.summary)
    input.assertCurrent()
    const previousCheckpoint = input.contextContributions.checkpoint
    const previousMemoryIncluded = input.contextContributions.memoryIncluded
    const previousDirectivesIncluded = input.contextContributions.directivesIncluded
    input.contextContributions.checkpoint = checkpoint
    let fittedMessages: ChatMessage[]
    try {
      const rebuilt = input.rebuildAfterCompaction({
        summary: compaction.summary,
        requestMessages: input.requestMessages
      })
      fittedMessages = input.fit({
        messages: rebuilt.messages,
        reserveTokens: input.requestedMaxTokens + input.toolReserveTokens,
        minimumProtectedTailCount: input.minimumProtectedTailCount,
        pinnedFirstUserContentHash: rebuilt.pinnedFirstUserContentHash
      })
    } catch (error) {
      input.contextContributions.checkpoint = previousCheckpoint
      input.contextContributions.memoryIncluded = previousMemoryIncluded
      input.contextContributions.directivesIncluded = previousDirectivesIncluded
      throw error
    }
    if (input.measure(fittedMessages) >= input.measure(input.requestMessages)) {
      input.contextContributions.checkpoint = previousCheckpoint
      input.contextContributions.memoryIncluded = previousMemoryIncluded
      input.contextContributions.directivesIncluded = previousDirectivesIncluded
      return { messages: input.requestMessages }
    }

    return {
      messages: fittedMessages,
      summaryCursorOrderSeq: input.getSummaryCursorOrderSeq(compaction.summary),
      syntheticContributions: getContextSyntheticContributions(input.contextContributions)
    }
  }

  async *streamProviderAttempts<TSelection>(
    input: ProviderAttemptInput<TSelection>
  ): AsyncGenerator<LLMCoreStreamEvent> {
    let preflightSemanticRecoveryAttempted = false
    let providerSemanticRecoveryAttempted = false
    let providerContextOverflowRecoveryApplied = false
    let strictProviderOverflowRetryPending = false
    let nextToolResultCompactionStage: 'preserve_latest' | 'include_latest' | 'complete' =
      'preserve_latest'
    let nextRequestOrigin: DeepChatProviderRequestOrigin =
      input.run.requestSeq === input.run.initialRequestSeq
        ? (input.viewContext?.taskType ?? 'tool_loop')
        : 'tool_loop'
    let manifestSummaryCursorOrderSeq = input.viewContext?.summaryCursorOrderSeq ?? 1
    let manifestSyntheticContributions = input.viewContext?.syntheticContributions
    const legacyRequestToolReserveTokens = input.budget.estimateToolReserveTokens(input.tools)
    const compactNextToolResultStage = (
      messages: ChatMessage[],
      protectedToolCallIds: ReadonlySet<string>
    ): ChatMessage[] => {
      if (nextToolResultCompactionStage === 'complete') return messages

      if (nextToolResultCompactionStage === 'preserve_latest') {
        nextToolResultCompactionStage = 'include_latest'
        const compacted = compactClosedToolResultsForContext(messages, protectedToolCallIds, {
          preserveMostRecentClosedUnit: true
        })
        if (compacted !== messages) return compacted
      }

      nextToolResultCompactionStage = 'complete'
      return compactClosedToolResultsForContext(messages, protectedToolCallIds, {
        preserveMostRecentClosedUnit: false
      })
    }

    const prepareProviderRequest = async (options: {
      requestOrigin: DeepChatProviderRequestOrigin
      strictProviderOverflowRetry?: boolean
    }): Promise<{
      providerMessages: ChatMessage[]
      providerMaxTokens: number
      contextWindowTokens: number
      requestSeq: number
      executionContract: DeepChatExecutionContract | null
      skillAuthority: ProviderAttemptSkillAuthority | null
      toolSurfaceSnapshot: ToolSurfaceSnapshot | null
      tools: MCPToolDefinition[]
    }> => {
      const anticipatedRequestSeq = input.run.requestSeq + 1
      if (!Number.isSafeInteger(anticipatedRequestSeq) || anticipatedRequestSeq <= 0) {
        throw new Error('Provider request sequence is exhausted.')
      }
      const buildToolSurfaceView = (
        deferActivationCandidates = false
      ): {
        snapshot: ToolSurfaceSnapshot
        programmaticCapability: ProgrammaticToolCapabilityV1 | null
      } | null => {
        if (!input.toolSurface) return null
        input.run.abortController.signal.throwIfAborted()
        const builtSnapshot: unknown = input.toolSurface.build({
          requestSeq: anticipatedRequestSeq,
          tools: input.tools,
          ...(deferActivationCandidates ? { deferActivationCandidates: true } : {})
        })
        assertIssuedToolSurfaceSnapshot(builtSnapshot)
        if (
          builtSnapshot.request.sessionId !== input.run.sessionId ||
          builtSnapshot.request.messageId !== input.run.messageId ||
          builtSnapshot.request.runId !== input.run.runId ||
          builtSnapshot.request.requestSeq !== anticipatedRequestSeq
        ) {
          throw new Error('Tool Surface identity does not match the provider View being assembled.')
        }
        let programmaticCapability: ProgrammaticToolCapabilityV1 | null = null
        if (builtSnapshot.adapterMode === 'cli-programmatic') {
          if (!input.toolSurface.buildProgrammaticCapability) {
            throw new Error('CLI Programmatic provider View lost its capability builder.')
          }
          programmaticCapability = input.toolSurface.buildProgrammaticCapability(builtSnapshot)
          assertProgrammaticToolCapabilityViewPrepared(programmaticCapability, builtSnapshot)
        }
        return { snapshot: builtSnapshot, programmaticCapability }
      }
      const initialToolSurfaceView = buildToolSurfaceView()
      let toolSurfaceSnapshot = initialToolSurfaceView?.snapshot ?? null
      let programmaticToolCapability = initialToolSurfaceView?.programmaticCapability ?? null
      // Snapshot definitions are deeply frozen. The cast is confined to legacy ports whose
      // mutable array signatures predate Tool Surface Views; every consumer receives this value.
      let requestTools = toolSurfaceSnapshot
        ? (toolSurfaceSnapshot.toolDefinitions as MCPToolDefinition[])
        : input.tools
      let effectiveRequestToolReserveTokens = toolSurfaceSnapshot
        ? input.budget.estimateToolReserveTokens(requestTools)
        : legacyRequestToolReserveTokens
      let providerMessages = input.requestMessages
      let providerMaxTokens = input.maxTokens
      let manifestContextLength = input.modelConfig.contextLength ?? input.fallbackContextLength
      let manifestRequestedMaxTokens = input.maxTokens
      let manifestReserveTokens = input.maxTokens
      let strictExtraReserveTokens = 0
      let recoveredFromContextPressure =
        providerContextOverflowRecoveryApplied || options.strictProviderOverflowRetry === true

      if (!input.bypassContextBudget) {
        let requestedMaxTokens = input.maxTokens
        if (options.strictProviderOverflowRetry) {
          input.run.providerRecovery.strictProviderOverflowRetryUsed = true
          requestedMaxTokens = input.budget.getStrictRetryMaxTokens(input.maxTokens)
          strictExtraReserveTokens = input.budget.getStrictRetryExtraReserve()
          input.requestMessages.splice(
            0,
            input.requestMessages.length,
            ...input.budget.fitStrictRetry({
              messages: input.requestMessages,
              requestedMaxTokens,
              reserveTokens:
                requestedMaxTokens + effectiveRequestToolReserveTokens + strictExtraReserveTokens
            })
          )
        }

        const promptTokenEstimate = projectPromptTokensFromUsageAnchor({
          run: input.run,
          providerId: input.providerId,
          modelId: input.modelId,
          modelConfig: input.modelConfig,
          temperature: input.temperature,
          maxTokens: requestedMaxTokens,
          tools: requestTools,
          messages: input.requestMessages,
          budget: input.budget
        })
        let requestPreflight = input.budget.preflight({
          messages: input.requestMessages,
          tools: requestTools,
          requestedMaxTokens,
          ...(promptTokenEstimate === null ? {} : { promptTokenEstimate })
        })
        if (
          !options.strictProviderOverflowRetry &&
          (requestPreflight.requiresContextPressureRecovery || !requestPreflight.fitsWithinContext)
        ) {
          recoveredFromContextPressure = true
          if (
            !input.run.providerRecovery.contextOverflowHandoffAttempted &&
            beginContextRecoverySequence(input.run)
          ) {
            const protectedToolCallIds = new Set(
              input.run.resources.runtimeSkillContexts.map((binding) => binding.toolCallId)
            )
            const compactToolResults = (): void => {
              const pressureCandidate = this.withActiveTurnFrom(
                input.requestMessages,
                requestPreflight.messages
              )
              const compactedToolResults = compactNextToolResultStage(
                pressureCandidate,
                protectedToolCallIds
              )
              if (compactedToolResults === pressureCandidate) return
              input.requestMessages.splice(0, input.requestMessages.length, ...compactedToolResults)
              requestPreflight = input.budget.preflight({
                messages: input.requestMessages,
                tools: requestTools,
                requestedMaxTokens
              })
            }
            compactToolResults()
            if (
              requestPreflight.requiresContextPressureRecovery ||
              !requestPreflight.fitsWithinContext
            ) {
              compactToolResults()
            }
            if (
              requestPreflight.requiresContextPressureRecovery ||
              !requestPreflight.fitsWithinContext
            ) {
              preflightSemanticRecoveryAttempted = true
              const recovered = await input.recovery.recover({
                requestMessages: this.withActiveTurnFrom(
                  input.requestMessages,
                  requestPreflight.messages
                ),
                requestedMaxTokens: requestPreflight.requestedMaxTokens,
                tools: requestTools
              })
              if (recovered.summaryCursorOrderSeq !== undefined) {
                manifestSummaryCursorOrderSeq = recovered.summaryCursorOrderSeq
              }
              if (recovered.syntheticContributions) {
                manifestSyntheticContributions = recovered.syntheticContributions
              }
              input.requestMessages.splice(0, input.requestMessages.length, ...recovered.messages)
              const recoveredToolSurfaceView = buildToolSurfaceView(true)
              toolSurfaceSnapshot = recoveredToolSurfaceView?.snapshot ?? null
              programmaticToolCapability = recoveredToolSurfaceView?.programmaticCapability ?? null
              requestTools = toolSurfaceSnapshot
                ? (toolSurfaceSnapshot.toolDefinitions as MCPToolDefinition[])
                : input.tools
              effectiveRequestToolReserveTokens = toolSurfaceSnapshot
                ? input.budget.estimateToolReserveTokens(requestTools)
                : legacyRequestToolReserveTokens
              requestPreflight = input.budget.preflight({
                messages: input.requestMessages,
                tools: requestTools,
                requestedMaxTokens
              })
            }
            input.requestMessages.splice(
              0,
              input.requestMessages.length,
              ...requestPreflight.messages
            )
          }
        }
        if (!requestPreflight.fitsWithinContext) {
          throw input.budget.buildOverflowError(requestPreflight)
        }
        providerMessages = requestPreflight.messages
        providerMaxTokens = requestPreflight.effectiveMaxTokens
        manifestContextLength = requestPreflight.contextLength
        manifestRequestedMaxTokens = requestPreflight.requestedMaxTokens
        manifestReserveTokens = requestPreflight.requestedMaxTokens + strictExtraReserveTokens
      }
      if (providerMessages.length === 0) {
        throw new Error('Request was not sent because the prompt became empty.')
      }

      input.run.abortController.signal.throwIfAborted()
      if (input.run.requestSeq !== anticipatedRequestSeq - 1) {
        throw new Error('Provider request sequence changed during View assembly.')
      }
      const requestSeq = advanceRequestSequence(input.run)
      if (requestSeq !== anticipatedRequestSeq) {
        throw new Error('Provider request sequence changed during View assembly.')
      }
      const isInitialViewRequest =
        (options.requestOrigin === 'chat' || options.requestOrigin === 'resume') &&
        requestSeq === input.run.initialRequestSeq + 1 &&
        Boolean(input.viewContext)
      const manifestPolicy = input.manifest.resolvePolicy({
        recoveredFromContextPressure,
        isInitialViewRequest,
        viewPolicy: input.viewContext?.policy,
        viewPolicyVersion: input.viewContext?.policyVersion
      })
      const contextBuilderVersion = input.viewContext?.contextBuilderVersion ?? 'legacy-v1'
      let executionContract: DeepChatExecutionContract | null = null
      if (input.strictViewContract && !input.executionContract) {
        throw new Error('Strict provider View requires an ExecutionContract builder.')
      }
      if (input.executionContract) {
        try {
          const builtExecutionContract = input.executionContract.build({
            requestSeq,
            messages: providerMessages,
            modelId: input.modelId,
            modelConfig: input.modelConfig,
            temperature: input.temperature,
            maxTokens: providerMaxTokens,
            tools: requestTools,
            contextBuilderVersion
          })
          if (!builtExecutionContract) {
            throw new Error('ExecutionContract builder did not return a contract.')
          }
          executionContract = builtExecutionContract
        } catch (error) {
          try {
            input.executionContract.onBuildError(error)
          } catch {}
          if (input.strictViewContract) throw error
        }
      }

      const skillContexts = resolveSkillContextsForRequest(input.run, providerMessages)
      const requiresDurableSkillManifest = skillContexts.length > 0
      const tapeIncarnationId = input.run.resources.tapeIncarnationId
      if (requiresDurableSkillManifest && !tapeIncarnationId) {
        throw new Error('Skill-bearing provider request lost its Session Tape incarnation.')
      }
      const reportManifestError = (error: unknown): void => {
        try {
          input.manifest.onAppendError(error, {
            requestSeq,
            failurePolicy:
              input.strictViewContract ||
              input.requireDurableManifest ||
              requiresDurableSkillManifest
                ? 'fail-closed'
                : 'fail-open',
            toolSurfaceApplicable: toolSurfaceSnapshot !== null,
            verified: false
          })
        } catch {}
      }
      let requestView: { manifestHash: string; tapeIncarnationId?: string } | null = null
      let providerViewProvenanceCommitted = false
      try {
        requestView =
          input.manifest.append({
            requestSeq,
            taskType: isInitialViewRequest ? input.viewContext!.taskType : 'tool_loop',
            policy: manifestPolicy.policy,
            policyVersion: manifestPolicy.policyVersion,
            messages: providerMessages,
            tools: requestTools,
            tokenBudget: {
              contextLength: manifestContextLength,
              requestedMaxTokens: manifestRequestedMaxTokens,
              effectiveMaxTokens: providerMaxTokens,
              reserveTokens: manifestReserveTokens,
              toolReserveTokens: effectiveRequestToolReserveTokens
            },
            selection:
              isInitialViewRequest && !recoveredFromContextPressure
                ? input.viewContext!.selection
                : undefined,
            summaryCursorOrderSeq: manifestSummaryCursorOrderSeq,
            supportsVision: input.viewContext?.supportsVision ?? input.supportsVision,
            supportsAudioInput: input.viewContext?.supportsAudioInput ?? input.supportsAudioInput,
            traceDebugEnabled: input.viewContext?.traceDebugEnabled ?? input.traceDebugEnabled,
            contextBuilderVersion,
            syntheticContributions: manifestSyntheticContributions,
            ...(executionContract ? { executionContract } : {}),
            ...(requiresDurableSkillManifest
              ? {
                  runId: input.run.runId,
                  tapeIncarnationId,
                  skillContexts,
                  requireDurableManifest: true
                }
              : {}),
            toolSurfaceSnapshot,
            programmaticToolCapability
          }) ?? null
        if (programmaticToolCapability && toolSurfaceSnapshot) {
          markProgrammaticToolCapabilityProvenanceCommitted(
            programmaticToolCapability,
            toolSurfaceSnapshot
          )
        }
        providerViewProvenanceCommitted = true
      } catch (error) {
        if (
          input.strictViewContract ||
          input.requireDurableManifest ||
          requiresDurableSkillManifest
        ) {
          reportManifestError(error)
          throw error
        }
        if (executionContract) {
          executionContract = null
          const reason = error instanceof Error ? error.message : String(error)
          reportManifestError(
            new Error(
              `ExecutionContract disabled for request ${requestSeq} because durable provider View provenance could not be confirmed: ${reason}`,
              { cause: error }
            )
          )
        } else {
          reportManifestError(error)
        }
      }
      bindActiveRequestContract(input.run, requestSeq, executionContract)
      if (
        requiresDurableSkillManifest &&
        (!requestView || requestView.tapeIncarnationId !== tapeIncarnationId)
      ) {
        throw new Error('Provider request lost its exact Skill ViewManifest identity.')
      }
      if (requestView) {
        bindActiveRequestView(input.run, { requestSeq, ...requestView })
      }
      if (toolSurfaceSnapshot) {
        bindActiveRequestToolSurface(
          input.run,
          requestSeq,
          toolSurfaceSnapshot,
          input.toolSurface!.releaseActivationCandidates,
          providerViewProvenanceCommitted ? programmaticToolCapability : null
        )
      }

      const skillAuthority = requiresDurableSkillManifest
        ? Object.freeze({
            sessionId: input.run.sessionId,
            messageId: input.run.messageId,
            runId: input.run.runId,
            requestSeq,
            manifestHash: requestView!.manifestHash,
            tapeIncarnationId: requestView!.tapeIncarnationId!,
            skillContexts: deepFreeze(structuredClone(skillContexts))
          })
        : null

      return {
        providerMessages,
        providerMaxTokens,
        contextWindowTokens: manifestContextLength,
        requestSeq,
        executionContract,
        skillAuthority,
        toolSurfaceSnapshot,
        tools: requestTools
      }
    }

    const recoverProviderContextOverflow = async (
      providerMessages: ChatMessage[],
      providerMaxTokens: number,
      tools: MCPToolDefinition[]
    ): Promise<void> => {
      if (!beginContextRecoverySequence(input.run)) {
        throw buildProviderOverflowRetryFailure(providerMessages, providerMaxTokens, tools)
      }
      const recoveryCandidate = this.withActiveTurnFrom(input.requestMessages, providerMessages)
      const protectedToolCallIds = new Set(
        input.run.resources.runtimeSkillContexts.map((binding) => binding.toolCallId)
      )
      const compactedToolResults = compactNextToolResultStage(
        recoveryCandidate,
        protectedToolCallIds
      )
      if (compactedToolResults !== recoveryCandidate) {
        providerContextOverflowRecoveryApplied = true
        strictProviderOverflowRetryPending = false
        input.requestMessages.splice(0, input.requestMessages.length, ...compactedToolResults)
        return
      }
      providerSemanticRecoveryAttempted = true
      const recovered = await input.recovery.recover({
        requestMessages: recoveryCandidate,
        requestedMaxTokens: providerMaxTokens,
        tools
      })
      if (recovered.summaryCursorOrderSeq !== undefined) {
        manifestSummaryCursorOrderSeq = recovered.summaryCursorOrderSeq
      }
      if (recovered.syntheticContributions) {
        manifestSyntheticContributions = recovered.syntheticContributions
      }
      providerContextOverflowRecoveryApplied = true
      strictProviderOverflowRetryPending = recovered.summaryCursorOrderSeq === undefined
      input.requestMessages.splice(0, input.requestMessages.length, ...recovered.messages)
    }

    const projectContextOverflowRetry = (
      strictProviderOverflowRetry: boolean,
      tools: MCPToolDefinition[]
    ): RequestContextPreflight => {
      let candidateMessages = input.requestMessages
      let candidateMaxTokens = input.maxTokens
      if (strictProviderOverflowRetry) {
        candidateMaxTokens = input.budget.getStrictRetryMaxTokens(input.maxTokens)
        const toolReserveTokens = input.budget.estimateToolReserveTokens(tools)
        candidateMessages = input.budget.fitStrictRetry({
          messages: candidateMessages,
          requestedMaxTokens: candidateMaxTokens,
          reserveTokens:
            candidateMaxTokens + toolReserveTokens + input.budget.getStrictRetryExtraReserve()
        })
      }
      return input.budget.preflight({
        messages: candidateMessages,
        tools,
        requestedMaxTokens: candidateMaxTokens
      })
    }

    const buildProviderOverflowRetryFailure = (
      providerMessages: ChatMessage[],
      providerMaxTokens: number,
      tools: MCPToolDefinition[],
      facts?: ProviderContextOverflowFacts,
      disposition: ProviderContextOverflowDisposition = 'provider_rejected_retry'
    ): Error => {
      const retryPreflight = input.budget.preflight({
        messages: providerMessages,
        tools,
        requestedMaxTokens: providerMaxTokens
      })
      const resolvedDisposition = retryPreflight.fitsWithinContext
        ? disposition
        : 'retry_projection_cannot_fit'
      return retryPreflight.fitsWithinContext || facts?.matched
        ? input.budget.buildOverflowAfterRecoveryError(retryPreflight, facts, resolvedDisposition)
        : input.budget.buildOverflowError(retryPreflight)
    }

    let aggregateUsage: ProviderAttemptUsage | null = null
    let usageProjected = false
    let transientRetriesUsed = 0

    const appendOutcome = (outcome: ProviderAttemptOutcomeInput): void => {
      try {
        input.outcome.append(outcome)
      } catch (error) {
        try {
          input.outcome.onAppendError(error)
        } catch {}
      }
    }

    try {
      providerRequestLoop: for (;;) {
        const strictProviderOverflowRetry = strictProviderOverflowRetryPending
        strictProviderOverflowRetryPending = false
        const requestOrigin = nextRequestOrigin
        const {
          providerMessages,
          providerMaxTokens,
          contextWindowTokens,
          requestSeq,
          executionContract,
          skillAuthority,
          toolSurfaceSnapshot,
          tools
        } = await prepareProviderRequest({
          requestOrigin,
          strictProviderOverflowRetry
        })
        let toolSurfaceAdmitted = toolSurfaceSnapshot === null
        let pendingRetry: { retryNumber: number; delayMs: number } | null = null

        for (;;) {
          if (pendingRetry) {
            await waitForProviderRetry(pendingRetry.delayMs, input.run.abortController.signal)
          }

          input.rateGate.beforeWait()
          try {
            await input.rateGate.wait(input.run.abortController.signal)
          } finally {
            input.rateGate.clearWaiting()
          }
          if (input.run.abortController.signal.aborted) {
            throw input.createAbortError()
          }

          if (!toolSurfaceAdmitted) {
            if (!input.toolSurface || !toolSurfaceSnapshot) {
              throw new Error('Provider View lost its Tool Surface admission port.')
            }
            input.toolSurface.admit({ requestSeq, snapshot: toolSurfaceSnapshot })
            toolSurfaceAdmitted = true
          }
          if (input.run.abortController.signal.aborted) {
            throw input.createAbortError()
          }

          input.provider.beforeStream()
          if (skillAuthority) {
            const activeRequestView = input.run.activeRequestView
            if (
              !activeRequestView ||
              activeRequestView.requestSeq !== skillAuthority.requestSeq ||
              activeRequestView.manifestHash !== skillAuthority.manifestHash ||
              activeRequestView.tapeIncarnationId !== skillAuthority.tapeIncarnationId
            ) {
              throw new Error('Provider request lost its exact Skill authority binding.')
            }
            input.authority.assertCurrent({
              authority: skillAuthority,
              messages: providerMessages,
              tools
            })
          }
          const physicalAttempt = enterPhysicalAttempt(input.run)
          const attemptOrigin: DeepChatProviderAttemptOrigin =
            physicalAttempt === 1 ? 'initial' : 'transient_retry'
          const identity: DeepChatProviderAttemptIdentity = {
            logicalRound: input.run.logicalRound,
            requestSeq,
            physicalAttempt
          }
          const startedRetryNumber = pendingRetry?.retryNumber ?? null
          pendingRetry = null
          if (startedRetryNumber !== null) {
            emitProviderRetryLifecycleEvent(input.retryObserver, {
              type: 'retry_started',
              attempt: { ...identity },
              retryNumber: startedRetryNumber
            })
          }

          const observation = createProviderAttemptObservation()
          let outcomeAppended = false
          try {
            yield* observeProviderAttempt({
              provider: input.provider,
              streamInput: {
                identity: { ...identity },
                requestOrigin,
                attemptOrigin,
                messages: providerMessages,
                modelId: input.modelId,
                modelConfig: input.modelConfig,
                temperature: input.temperature,
                maxTokens: providerMaxTokens,
                tools,
                executionContract,
                toolSurfaceSnapshot,
                signal: input.run.abortController.signal
              },
              observation,
              bypassContextBudget: input.bypassContextBudget,
              isContextOverflowEvent: input.isContextOverflowEvent,
              isContextOverflowError: input.isContextOverflowError,
              inspectContextOverflow: input.inspectContextOverflow,
              onContextOverflowFacts: input.onContextOverflowFacts
            })

            const assessment = assessProviderAttemptObservation({
              observation,
              signalAborted: input.run.abortController.signal.aborted
            })
            const { failureAssessment, failureClassification, status } = assessment
            let retryDecision: DeepChatProviderRetryDecision = 'none'
            let retryPlan: { delayMs: number } | null = null
            let contextRecoveryAction: 'recover' | 'strict_retry' | 'fail' | null = null

            if (failureClassification === 'context_overflow') {
              if (observation.outputCommitted) {
                retryDecision = 'output_committed'
              } else if (
                input.run.providerRecovery.strictProviderOverflowRetryUsed ||
                providerSemanticRecoveryAttempted
              ) {
                retryDecision = 'context_recovery_exhausted'
                contextRecoveryAction = 'fail'
              } else if (preflightSemanticRecoveryAttempted) {
                if (strictProviderOverflowRetryPending) {
                  retryDecision = 'context_recovery_exhausted'
                  contextRecoveryAction = 'fail'
                } else {
                  retryDecision = 'context_recovery_scheduled'
                  contextRecoveryAction = 'strict_retry'
                }
              } else if (
                input.run.providerRecovery.contextRecoverySequencesUsed >=
                MAX_CONTEXT_RECOVERY_SEQUENCES_PER_RUN
              ) {
                retryDecision = 'context_recovery_exhausted'
                contextRecoveryAction = 'fail'
              } else {
                retryDecision = 'context_recovery_scheduled'
                contextRecoveryAction = 'recover'
              }
            } else if (failureClassification === 'transient') {
              if (!input.allowTransientRetry) {
                retryDecision = 'not_retryable'
              } else if (observation.outputCommitted) {
                retryDecision = 'output_committed'
              } else if (transientRetriesUsed >= MAX_TRANSIENT_RETRIES_PER_LOGICAL_ROUND) {
                retryDecision = 'retry_budget_exhausted'
              } else {
                const delay = resolveProviderRetryDelay({
                  metadata: failureAssessment?.metadata,
                  retryIndex: transientRetriesUsed
                })
                if (delay.kind === 'reject') {
                  retryDecision = 'retry_after_exceeds_limit'
                } else {
                  retryDecision = 'retry_scheduled'
                  retryPlan = { delayMs: delay.delayMs }
                }
              }
            } else if (failureClassification !== null) {
              retryDecision =
                observation.outputCommitted && failureClassification === 'aborted'
                  ? 'output_committed'
                  : 'not_retryable'
            }

            appendOutcome({
              logicalRound: identity.logicalRound,
              requestSeq,
              physicalAttempt,
              requestOrigin,
              attemptOrigin,
              status,
              stopReason: assessment.stopReason,
              failureClassification,
              retryDecision,
              httpStatus: failureAssessment?.metadata?.statusCode ?? null,
              errorCode: failureAssessment?.metadata?.code ?? null,
              retryDelayMs: retryPlan?.delayMs ?? null,
              usage: observation.usage,
              contextPressure: detectProviderContextPressure({
                bypassContextBudget: input.bypassContextBudget,
                contextWindowTokens,
                status,
                stopReason: assessment.stopReason,
                usage: observation.usage
              })
            })
            outcomeAppended = true
            if (startedRetryNumber !== null) {
              emitProviderRetryLifecycleEvent(input.retryObserver, {
                type: 'retry_finished',
                attempt: { ...identity },
                retryNumber: startedRetryNumber,
                status,
                failureClassification,
                retryDecision
              })
            }
            aggregateUsage = aggregateProviderAttemptUsage(aggregateUsage, observation.usage)

            if (status === 'completed') {
              updatePromptUsageAnchor({
                run: input.run,
                usage: observation.usage,
                providerId: input.providerId,
                modelId: input.modelId,
                modelConfig: input.modelConfig,
                temperature: input.temperature,
                maxTokens: input.maxTokens,
                tools,
                messages: providerMessages,
                continuationMessages: input.requestMessages,
                budget: input.budget
              })
              resetContextRecoverySequence(input.run)
            }

            if (retryPlan) {
              transientRetriesUsed += 1
              const nextAttempt: DeepChatProviderAttemptIdentity = {
                logicalRound: identity.logicalRound,
                requestSeq,
                physicalAttempt: physicalAttempt + 1
              }
              emitProviderRetryLifecycleEvent(input.retryObserver, {
                type: 'retry_scheduled',
                failedAttempt: { ...identity },
                nextAttempt: { ...nextAttempt },
                retryNumber: transientRetriesUsed,
                delayMs: retryPlan.delayMs
              })
              pendingRetry = { retryNumber: transientRetriesUsed, delayMs: retryPlan.delayMs }
              continue
            }

            if (contextRecoveryAction) {
              if (contextRecoveryAction === 'fail') {
                throw buildProviderOverflowRetryFailure(
                  providerMessages,
                  providerMaxTokens,
                  tools,
                  observation.contextOverflowFacts ?? undefined
                )
              }
              const failedProviderMessages = providerMessages.slice()
              if (contextRecoveryAction === 'strict_retry') {
                strictProviderOverflowRetryPending = true
              } else {
                await recoverProviderContextOverflow(providerMessages, providerMaxTokens, tools)
              }
              const retryProjection = projectContextOverflowRetry(
                strictProviderOverflowRetryPending,
                tools
              )
              if (!retryProjection.fitsWithinContext) {
                throw input.budget.buildOverflowAfterRecoveryError(
                  retryProjection,
                  observation.contextOverflowFacts ?? undefined,
                  'retry_projection_cannot_fit'
                )
              }
              const messagesChanged = !isDeepStrictEqual(
                retryProjection.messages,
                failedProviderMessages
              )
              const facts = observation.contextOverflowFacts
              const outputReductionCanRecoverTotalContext =
                facts?.matched === true &&
                facts.confidence === 'explicit' &&
                facts.limitScope === 'context' &&
                Number.isSafeInteger(facts.limitTokens) &&
                retryProjection.effectiveMaxTokens < providerMaxTokens
              if (!messagesChanged && !outputReductionCanRecoverTotalContext) {
                throw buildProviderOverflowRetryFailure(
                  providerMessages,
                  providerMaxTokens,
                  tools,
                  facts ?? undefined,
                  'retry_projection_unchanged'
                )
              }
              input.requestMessages.splice(
                0,
                input.requestMessages.length,
                ...retryProjection.messages
              )
              nextRequestOrigin = 'context_recovery'
              continue providerRequestLoop
            }

            if (failureClassification === 'aborted') {
              throw input.run.abortController.signal.reason ?? input.createAbortError()
            }

            if (aggregateUsage) {
              usageProjected = true
              yield createAggregatedUsageEvent(aggregateUsage)
            }
            if (observation.errorEvent) {
              yield failureClassification === 'context_overflow' && observation.outputCommitted
                ? createStreamEvent.error(CONTEXT_OVERFLOW_AFTER_OUTPUT_ERROR, {
                    code: 'context_overflow_after_output',
                    retryable: false
                  })
                : observation.errorEvent
            }
            if (observation.stopEvent) {
              yield observation.stopEvent
            }
            if (observation.providerThrew) {
              if (failureClassification === 'context_overflow' && observation.outputCommitted) {
                throw new Error(CONTEXT_OVERFLOW_AFTER_OUTPUT_ERROR, {
                  cause: observation.providerError
                })
              }
              throw observation.providerError
            }
            return
          } finally {
            // Closing the async iterator at a semantic yield bypasses normal attempt settlement.
            if (!outcomeAppended) {
              const assessment = assessProviderAttemptObservation({
                observation,
                signalAborted: input.run.abortController.signal.aborted,
                forceFailure: true
              })
              const retryDecision: DeepChatProviderRetryDecision = observation.outputCommitted
                ? 'output_committed'
                : 'not_retryable'
              appendOutcome({
                logicalRound: identity.logicalRound,
                requestSeq,
                physicalAttempt,
                requestOrigin,
                attemptOrigin,
                status: assessment.status,
                stopReason: assessment.stopReason,
                failureClassification: assessment.failureClassification,
                retryDecision,
                httpStatus: assessment.failureAssessment?.metadata?.statusCode ?? null,
                errorCode: assessment.failureAssessment?.metadata?.code ?? null,
                retryDelayMs: null,
                usage: observation.usage,
                contextPressure: detectProviderContextPressure({
                  bypassContextBudget: input.bypassContextBudget,
                  contextWindowTokens,
                  status: assessment.status,
                  stopReason: assessment.stopReason,
                  usage: observation.usage
                })
              })
              if (startedRetryNumber !== null) {
                emitProviderRetryLifecycleEvent(input.retryObserver, {
                  type: 'retry_finished',
                  attempt: { ...identity },
                  retryNumber: startedRetryNumber,
                  status: assessment.status,
                  failureClassification: assessment.failureClassification,
                  retryDecision
                })
              }
            }
          }
        }
      }
    } catch (error) {
      if (aggregateUsage && !usageProjected) {
        usageProjected = true
        yield createAggregatedUsageEvent(aggregateUsage)
      }
      throw error
    } finally {
      input.rateGate.clearWaiting()
    }
  }

  private withActiveTurnFrom(
    historySource: ChatMessage[],
    activeTurnSource: ChatMessage[]
  ): ChatMessage[] {
    const historyActiveTurnStart = historySource.findLastIndex((message) => message.role === 'user')
    const activeTurnStart = activeTurnSource.findLastIndex((message) => message.role === 'user')
    if (historyActiveTurnStart < 0 || activeTurnStart < 0) {
      return historySource
    }
    return [
      ...historySource.slice(0, historyActiveTurnStart),
      ...activeTurnSource.slice(activeTurnStart)
    ]
  }

  private getLeadingSystemPrompt(messages: ChatMessage[]): string | null {
    const first = messages[0]
    return first?.role === 'system' && typeof first.content === 'string' ? first.content : null
  }
}
