import type { ProviderRoundStopReason } from '@shared/types/core/llm-events'
import type { DeepChatTapeEntryRow } from './entry'
import { parseTapeJsonObject } from './effectiveSemantics'

export const TAPE_PROVIDER_ATTEMPT_EVENT_NAME = 'provider/attempt_completed'
export const TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION = 1

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
  requestSeq: number
  providerId: string
  modelId: string
  status: TapeProviderAttemptStatus
  stopReason: ProviderRoundStopReason | null
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  } | null
}

export interface TapeProviderAttemptEvent {
  schemaVersion: typeof TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION
  messageId: string
  requestSeq: number
  providerId: string
  modelId: string
  status: TapeProviderAttemptStatus
  stopReason: ProviderRoundStopReason | null
  usage: TapeProviderAttemptUsage | null
  cacheHitRate: number | null
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

export function buildTapeProviderAttemptEvent(
  input: TapeProviderAttemptInput
): TapeProviderAttemptEvent {
  const usage = normalizeUsage(input.usage)
  return {
    schemaVersion: TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION,
    messageId: input.messageId,
    requestSeq: input.requestSeq,
    providerId: input.providerId,
    modelId: input.modelId,
    status: input.status,
    stopReason: input.stopReason,
    usage,
    cacheHitRate: calculateCacheHitRate(usage)
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

export function parseTapeProviderAttemptEvent(
  row: DeepChatTapeEntryRow
): TapeProviderAttemptEvent | null {
  if (row.kind !== 'event' || row.name !== TAPE_PROVIDER_ATTEMPT_EVENT_NAME) return null

  const payload = parseTapeJsonObject(row.payload_json)
  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : null
  if (!data || data.schemaVersion !== TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION) return null

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

  return {
    schemaVersion: TAPE_PROVIDER_ATTEMPT_SCHEMA_VERSION,
    messageId: data.messageId,
    requestSeq: data.requestSeq as number,
    providerId: data.providerId,
    modelId: data.modelId,
    status: data.status as TapeProviderAttemptStatus,
    stopReason: stopReason as ProviderRoundStopReason | null,
    usage,
    cacheHitRate
  }
}

export function toTapeProviderAttemptCacheMetrics(
  attempt: TapeProviderAttemptEvent
): TapeProviderAttemptCacheMetrics {
  return {
    lastTokenCacheHitRate: attempt.usage ? attempt.cacheHitRate : null,
    lastCacheReadTokens: attempt.usage?.cacheReadTokens ?? null,
    lastCacheWriteTokens: attempt.usage?.cacheWriteTokens ?? null
  }
}
