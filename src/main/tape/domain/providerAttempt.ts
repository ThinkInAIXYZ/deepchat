import type { ProviderRoundStopReason } from '@shared/types/core/llm-events'
import type {
  DeepChatProviderAttemptOrigin,
  DeepChatProviderContextPressureKind,
  DeepChatProviderContextPressureObservation,
  DeepChatProviderFailureClassification,
  DeepChatProviderRequestOrigin,
  DeepChatProviderRetryDecision
} from '@shared/types/provider-attempt'
import type { DeepChatTapeEntryRow } from './entry'
import { parseTapeJsonObject } from './effectiveSemantics'

export const TAPE_PROVIDER_ATTEMPT_EVENT_NAME = 'provider/attempt_completed'
export type TapeProviderAttemptEventName = typeof TAPE_PROVIDER_ATTEMPT_EVENT_NAME
export const TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION = 3
const TAPE_PROVIDER_ATTEMPT_PREVIOUS_SCHEMA_VERSION = 2
const TAPE_PROVIDER_ATTEMPT_LEGACY_SCHEMA_VERSION = 1

export type TapeProviderAttemptStatus = 'completed' | 'context_overflow' | 'aborted' | 'error'

export interface TapeProviderAttemptUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

export interface TapeProviderAttemptInput {
  sessionId: string
  messageId: string
  logicalRound: number
  requestSeq: number
  physicalAttempt: number
  requestOrigin: DeepChatProviderRequestOrigin
  attemptOrigin: DeepChatProviderAttemptOrigin
  providerId: string
  modelId: string
  status: TapeProviderAttemptStatus
  stopReason: ProviderRoundStopReason | null
  failureClassification: DeepChatProviderFailureClassification | null
  retryDecision: DeepChatProviderRetryDecision
  httpStatus: number | null
  errorCode: string | null
  retryDelayMs: number | null
  contextPressure?: DeepChatProviderContextPressureObservation | null
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  } | null
}

interface TapeProviderAttemptEventBase {
  messageId: string
  requestSeq: number
  providerId: string
  modelId: string
  status: TapeProviderAttemptStatus
  stopReason: ProviderRoundStopReason | null
  usage: TapeProviderAttemptUsage | null
  cacheHitRate: number | null
}

export interface TapeProviderAttemptEventV1 extends TapeProviderAttemptEventBase {
  schemaVersion: typeof TAPE_PROVIDER_ATTEMPT_LEGACY_SCHEMA_VERSION
  contextPressure: null
}

interface TapeProviderAttemptDetailedEventBase extends TapeProviderAttemptEventBase {
  logicalRound: number
  physicalAttempt: number
  requestOrigin: DeepChatProviderRequestOrigin
  attemptOrigin: DeepChatProviderAttemptOrigin
  failureClassification: DeepChatProviderFailureClassification | null
  retryDecision: DeepChatProviderRetryDecision
  httpStatus: number | null
  errorCode: string | null
  retryDelayMs: number | null
}

export interface TapeProviderAttemptEventV2 extends TapeProviderAttemptDetailedEventBase {
  schemaVersion: typeof TAPE_PROVIDER_ATTEMPT_PREVIOUS_SCHEMA_VERSION
  contextPressure: null
}

export interface TapeProviderAttemptEvent extends TapeProviderAttemptDetailedEventBase {
  schemaVersion: typeof TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION
  contextPressure: DeepChatProviderContextPressureObservation | null
}

export type TapeProviderAttemptReadEvent =
  | TapeProviderAttemptEventV1
  | TapeProviderAttemptEventV2
  | TapeProviderAttemptEvent

export interface TapeProviderContextPressureRecord {
  readonly entryId: number
  readonly attempt: TapeProviderAttemptEvent & {
    readonly contextPressure: DeepChatProviderContextPressureObservation
  }
}

export interface TapeProviderAttemptRecord {
  readonly entryId: number
  readonly createdAt: number
  readonly attempt: TapeProviderAttemptReadEvent
}

export interface TapeProviderAttemptCacheMetrics {
  lastTokenCacheHitRate: number | null
  lastCacheReadTokens: number | null
  lastCacheWriteTokens: number | null
}

const PROVIDER_ATTEMPT_STATUSES = new Set<TapeProviderAttemptStatus>([
  'completed',
  'context_overflow',
  'aborted',
  'error'
])
const PROVIDER_STOP_REASONS = new Set<ProviderRoundStopReason>([
  'tool_use',
  'max_tokens',
  'max_turn_requests',
  'error',
  'complete'
])
const PROVIDER_REQUEST_ORIGINS = new Set<DeepChatProviderRequestOrigin>([
  'chat',
  'resume',
  'tool_loop',
  'context_recovery'
])
const PROVIDER_ATTEMPT_ORIGINS = new Set<DeepChatProviderAttemptOrigin>([
  'initial',
  'transient_retry'
])
const PROVIDER_FAILURE_CLASSIFICATIONS = new Set<DeepChatProviderFailureClassification>([
  'aborted',
  'context_overflow',
  'permanent',
  'transient',
  'unknown'
])
const PROVIDER_RETRY_DECISIONS = new Set<DeepChatProviderRetryDecision>([
  'none',
  'retry_scheduled',
  'context_recovery_scheduled',
  'context_recovery_exhausted',
  'not_retryable',
  'retry_budget_exhausted',
  'output_committed',
  'retry_after_exceeds_limit'
])
const PROVIDER_CONTEXT_PRESSURE_KINDS = new Set<DeepChatProviderContextPressureKind>([
  'successful_prompt_overflow',
  'zero_output_length_at_limit'
])

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function normalizeOptionalTokenCount(value: unknown): number | null {
  return isNonNegativeSafeInteger(value) ? value : null
}

function normalizeUsage(input: TapeProviderAttemptInput['usage']): TapeProviderAttemptUsage | null {
  if (
    !input ||
    !isNonNegativeSafeInteger(input.inputTokens) ||
    !isNonNegativeSafeInteger(input.outputTokens) ||
    !isNonNegativeSafeInteger(input.totalTokens)
  ) {
    return null
  }

  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
    cacheReadTokens: normalizeOptionalTokenCount(input.cacheReadTokens),
    cacheWriteTokens: normalizeOptionalTokenCount(input.cacheWriteTokens)
  }
}

function calculateCacheHitRate(usage: TapeProviderAttemptUsage | null): number | null {
  if (
    !usage ||
    usage.inputTokens <= 0 ||
    usage.cacheReadTokens === null ||
    usage.cacheReadTokens > usage.inputTokens
  ) {
    return null
  }
  return usage.cacheReadTokens / usage.inputTokens
}

function normalizeContextPressure(
  value: unknown,
  outcome: {
    status: TapeProviderAttemptStatus
    stopReason: ProviderRoundStopReason | null
    usage: TapeProviderAttemptUsage | null
  }
): DeepChatProviderContextPressureObservation | null | undefined {
  if (value === null) return null
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const observation = value as Record<string, unknown>
  if (
    typeof observation.kind !== 'string' ||
    !PROVIDER_CONTEXT_PRESSURE_KINDS.has(observation.kind as DeepChatProviderContextPressureKind) ||
    !Number.isSafeInteger(observation.contextWindowTokens) ||
    (observation.contextWindowTokens as number) <= 0 ||
    !Number.isSafeInteger(observation.thresholdTokens) ||
    (observation.thresholdTokens as number) <= 0 ||
    outcome.status !== 'completed' ||
    !outcome.usage
  ) {
    return undefined
  }

  const contextWindowTokens = observation.contextWindowTokens as number
  const thresholdTokens = observation.thresholdTokens as number
  const kind = observation.kind as DeepChatProviderContextPressureKind
  if (
    thresholdTokens > contextWindowTokens ||
    (kind === 'successful_prompt_overflow' &&
      (outcome.stopReason !== 'complete' ||
        thresholdTokens !== contextWindowTokens ||
        outcome.usage.inputTokens <= thresholdTokens)) ||
    (kind === 'zero_output_length_at_limit' &&
      (outcome.stopReason !== 'max_tokens' ||
        outcome.usage.outputTokens !== 0 ||
        outcome.usage.inputTokens < thresholdTokens))
  ) {
    return undefined
  }

  return { kind, contextWindowTokens, thresholdTokens }
}

export function buildTapeProviderAttemptEvent(
  input: TapeProviderAttemptInput
): TapeProviderAttemptEvent {
  const usage = normalizeUsage(input.usage)
  const contextPressure =
    normalizeContextPressure(input.contextPressure, {
      status: input.status,
      stopReason: input.stopReason,
      usage
    }) ?? null
  return {
    schemaVersion: TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION,
    messageId: input.messageId,
    logicalRound: input.logicalRound,
    requestSeq: input.requestSeq,
    physicalAttempt: input.physicalAttempt,
    requestOrigin: input.requestOrigin,
    attemptOrigin: input.attemptOrigin,
    providerId: input.providerId,
    modelId: input.modelId,
    status: input.status,
    stopReason: input.stopReason,
    failureClassification: input.failureClassification,
    retryDecision: input.retryDecision,
    httpStatus: input.httpStatus,
    errorCode: input.errorCode,
    retryDelayMs: input.retryDelayMs,
    usage,
    cacheHitRate: calculateCacheHitRate(usage),
    contextPressure
  }
}

function parseNullableTokenCount(value: unknown): number | null | undefined {
  if (value === null) return null
  return isNonNegativeSafeInteger(value) ? value : undefined
}

function parseUsage(value: unknown): TapeProviderAttemptUsage | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const usage = value as Record<string, unknown>
  const cacheReadTokens = parseNullableTokenCount(usage.cacheReadTokens)
  const cacheWriteTokens = parseNullableTokenCount(usage.cacheWriteTokens)
  if (
    !isNonNegativeSafeInteger(usage.inputTokens) ||
    !isNonNegativeSafeInteger(usage.outputTokens) ||
    !isNonNegativeSafeInteger(usage.totalTokens) ||
    cacheReadTokens === undefined ||
    cacheWriteTokens === undefined
  ) {
    return undefined
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens,
    cacheWriteTokens
  }
}

function isValidAttemptOrigin(
  physicalAttempt: number,
  attemptOrigin: DeepChatProviderAttemptOrigin
): boolean {
  return physicalAttempt === 1 ? attemptOrigin === 'initial' : attemptOrigin === 'transient_retry'
}

function isValidAttemptOutcome(input: {
  status: TapeProviderAttemptStatus
  failureClassification: DeepChatProviderFailureClassification | null
  retryDecision: DeepChatProviderRetryDecision
}): boolean {
  if (input.status === 'completed') {
    return input.failureClassification === null && input.retryDecision === 'none'
  }
  if (input.status === 'context_overflow') {
    return (
      input.failureClassification === 'context_overflow' &&
      (input.retryDecision === 'context_recovery_scheduled' ||
        input.retryDecision === 'context_recovery_exhausted' ||
        input.retryDecision === 'not_retryable' ||
        input.retryDecision === 'output_committed')
    )
  }
  if (input.status === 'aborted') {
    return (
      input.failureClassification === 'aborted' &&
      (input.retryDecision === 'not_retryable' || input.retryDecision === 'output_committed')
    )
  }
  if (
    input.failureClassification === null ||
    input.failureClassification === 'aborted' ||
    input.failureClassification === 'context_overflow'
  ) {
    return false
  }
  if (
    input.retryDecision === 'retry_scheduled' ||
    input.retryDecision === 'retry_budget_exhausted' ||
    input.retryDecision === 'retry_after_exceeds_limit'
  ) {
    return input.failureClassification === 'transient'
  }
  return input.retryDecision === 'not_retryable' || input.retryDecision === 'output_committed'
}

export function parseTapeProviderAttemptEvent(
  row: DeepChatTapeEntryRow
): TapeProviderAttemptReadEvent | null {
  if (row.kind !== 'event' || row.name !== TAPE_PROVIDER_ATTEMPT_EVENT_NAME) return null

  const payload = parseTapeJsonObject(row.payload_json)
  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : null
  if (
    !data ||
    (data.schemaVersion !== TAPE_PROVIDER_ATTEMPT_LEGACY_SCHEMA_VERSION &&
      data.schemaVersion !== TAPE_PROVIDER_ATTEMPT_PREVIOUS_SCHEMA_VERSION &&
      data.schemaVersion !== TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION)
  ) {
    return null
  }

  const usage = parseUsage(data.usage)
  const cacheHitRate = data.cacheHitRate
  const stopReason = data.stopReason
  if (
    typeof data.messageId !== 'string' ||
    data.messageId.length === 0 ||
    !Number.isSafeInteger(data.requestSeq) ||
    (data.requestSeq as number) <= 0 ||
    typeof data.providerId !== 'string' ||
    data.providerId.length === 0 ||
    typeof data.modelId !== 'string' ||
    data.modelId.length === 0 ||
    typeof data.status !== 'string' ||
    !PROVIDER_ATTEMPT_STATUSES.has(data.status as TapeProviderAttemptStatus) ||
    (stopReason !== null &&
      (typeof stopReason !== 'string' ||
        !PROVIDER_STOP_REASONS.has(stopReason as ProviderRoundStopReason))) ||
    usage === undefined ||
    (cacheHitRate !== null &&
      (typeof cacheHitRate !== 'number' ||
        !Number.isFinite(cacheHitRate) ||
        cacheHitRate < 0 ||
        cacheHitRate > 1)) ||
    (usage === null && cacheHitRate !== null) ||
    (usage !== undefined && cacheHitRate !== calculateCacheHitRate(usage))
  ) {
    return null
  }

  const base: TapeProviderAttemptEventBase = {
    messageId: data.messageId,
    requestSeq: data.requestSeq as number,
    providerId: data.providerId,
    modelId: data.modelId,
    status: data.status as TapeProviderAttemptStatus,
    stopReason: stopReason as ProviderRoundStopReason | null,
    usage,
    cacheHitRate
  }

  if (data.schemaVersion === TAPE_PROVIDER_ATTEMPT_LEGACY_SCHEMA_VERSION) {
    return {
      schemaVersion: TAPE_PROVIDER_ATTEMPT_LEGACY_SCHEMA_VERSION,
      ...base,
      contextPressure: null
    }
  }

  const failureClassification = data.failureClassification
  const httpStatus = data.httpStatus
  const errorCode = data.errorCode
  const retryDelayMs = data.retryDelayMs
  const physicalAttempt = data.physicalAttempt
  const attemptOrigin = data.attemptOrigin
  const retryDecision = data.retryDecision
  if (
    !Number.isSafeInteger(data.logicalRound) ||
    (data.logicalRound as number) <= 0 ||
    !Number.isSafeInteger(physicalAttempt) ||
    (physicalAttempt as number) <= 0 ||
    typeof data.requestOrigin !== 'string' ||
    !PROVIDER_REQUEST_ORIGINS.has(data.requestOrigin as DeepChatProviderRequestOrigin) ||
    typeof attemptOrigin !== 'string' ||
    !PROVIDER_ATTEMPT_ORIGINS.has(attemptOrigin as DeepChatProviderAttemptOrigin) ||
    (failureClassification !== null &&
      (typeof failureClassification !== 'string' ||
        !PROVIDER_FAILURE_CLASSIFICATIONS.has(
          failureClassification as DeepChatProviderFailureClassification
        ))) ||
    typeof retryDecision !== 'string' ||
    !PROVIDER_RETRY_DECISIONS.has(retryDecision as DeepChatProviderRetryDecision) ||
    (httpStatus !== null &&
      (!Number.isSafeInteger(httpStatus) ||
        (httpStatus as number) < 100 ||
        (httpStatus as number) > 599)) ||
    (errorCode !== null && (typeof errorCode !== 'string' || errorCode.length === 0)) ||
    (retryDelayMs !== null && !isNonNegativeSafeInteger(retryDelayMs))
  ) {
    return null
  }

  const typedAttemptOrigin = attemptOrigin as DeepChatProviderAttemptOrigin
  const typedFailureClassification =
    failureClassification as DeepChatProviderFailureClassification | null
  const typedRetryDecision = retryDecision as DeepChatProviderRetryDecision
  if (
    !isValidAttemptOrigin(physicalAttempt as number, typedAttemptOrigin) ||
    !isValidAttemptOutcome({
      status: base.status,
      failureClassification: typedFailureClassification,
      retryDecision: typedRetryDecision
    })
  ) {
    return null
  }

  const detailed = {
    ...base,
    logicalRound: data.logicalRound as number,
    physicalAttempt: physicalAttempt as number,
    requestOrigin: data.requestOrigin as DeepChatProviderRequestOrigin,
    attemptOrigin: typedAttemptOrigin,
    failureClassification: typedFailureClassification,
    retryDecision: typedRetryDecision,
    httpStatus: httpStatus as number | null,
    errorCode: errorCode as string | null,
    retryDelayMs: retryDelayMs as number | null
  }
  if (data.schemaVersion === TAPE_PROVIDER_ATTEMPT_PREVIOUS_SCHEMA_VERSION) {
    return {
      schemaVersion: TAPE_PROVIDER_ATTEMPT_PREVIOUS_SCHEMA_VERSION,
      ...detailed,
      contextPressure: null
    }
  }

  const contextPressure = normalizeContextPressure(data.contextPressure, {
    status: base.status,
    stopReason: base.stopReason,
    usage: base.usage
  })

  return {
    schemaVersion: TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION,
    ...detailed,
    contextPressure: contextPressure ?? null
  }
}

export function toTapeProviderAttemptCacheMetrics(
  attempt: TapeProviderAttemptReadEvent
): TapeProviderAttemptCacheMetrics {
  return {
    lastTokenCacheHitRate: attempt.usage ? attempt.cacheHitRate : null,
    lastCacheReadTokens: attempt.usage?.cacheReadTokens ?? null,
    lastCacheWriteTokens: attempt.usage?.cacheWriteTokens ?? null
  }
}
