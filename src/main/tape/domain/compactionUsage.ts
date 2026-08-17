import type { DeepChatTapeEntryRow } from './entry'
import { parseTapeJsonObject } from './effectiveSemantics'

export const TAPE_COMPACTION_MODEL_CALL_EVENT_NAME = 'compaction/model_call_completed'
export type TapeCompactionModelCallEventName = typeof TAPE_COMPACTION_MODEL_CALL_EVENT_NAME
export const TAPE_COMPACTION_MODEL_CALL_SCHEMA_VERSION = 2

export type TapeCompactionModelCallStatus = 'completed' | 'error' | 'aborted'

export interface TapeCompactionModelCallUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface TapeCompactionModelCallInput {
  sessionId: string
  compactionMessageId: string
  compactionAttemptId: string
  providerCallId: string
  providerId: string
  modelId: string
  status: TapeCompactionModelCallStatus
  usage: TapeCompactionModelCallUsage | null
  startedAt: number
  completedAt: number
}

export interface TapeCompactionModelCallEvent {
  schemaVersion: typeof TAPE_COMPACTION_MODEL_CALL_SCHEMA_VERSION
  compactionMessageId: string
  compactionAttemptId: string
  providerCallId: string
  callSeq: number
  providerId: string
  modelId: string
  status: TapeCompactionModelCallStatus
  usage: TapeCompactionModelCallUsage | null
  startedAt: number
  completedAt: number
}

export interface TapeCompactionModelCallReceipt {
  row: DeepChatTapeEntryRow
  event: TapeCompactionModelCallEvent
}

const STATUSES = new Set<TapeCompactionModelCallStatus>(['completed', 'error', 'aborted'])
const MAX_ID_CHARACTERS = 256

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= MAX_ID_CHARACTERS ? normalized : null
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function normalizeUsage(value: unknown): TapeCompactionModelCallUsage | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const usage = value as Record<string, unknown>
  const inputTokens = usage.inputTokens === null ? null : usage.inputTokens
  const outputTokens = usage.outputTokens === null ? null : usage.outputTokens
  const totalTokens = usage.totalTokens === null ? null : usage.totalTokens
  if (
    (inputTokens !== null && !isNonNegativeSafeInteger(inputTokens)) ||
    (outputTokens !== null && !isNonNegativeSafeInteger(outputTokens)) ||
    (totalTokens !== null && !isNonNegativeSafeInteger(totalTokens)) ||
    (inputTokens === null && outputTokens === null && totalTokens === null)
  ) {
    return undefined
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens
  }
}

export function buildTapeCompactionModelCallEvent(
  input: TapeCompactionModelCallInput,
  callSeq: number
): TapeCompactionModelCallEvent {
  const compactionMessageId = normalizeId(input.compactionMessageId)
  const compactionAttemptId = normalizeId(input.compactionAttemptId)
  const providerCallId = normalizeId(input.providerCallId)
  const providerId = normalizeId(input.providerId)
  const modelId = normalizeId(input.modelId)
  const usage = normalizeUsage(input.usage)
  if (
    !compactionMessageId ||
    !compactionAttemptId ||
    !providerCallId ||
    !providerId ||
    !modelId ||
    !STATUSES.has(input.status) ||
    !Number.isSafeInteger(callSeq) ||
    callSeq <= 0 ||
    !isNonNegativeSafeInteger(input.startedAt) ||
    !isNonNegativeSafeInteger(input.completedAt) ||
    input.completedAt < input.startedAt ||
    usage === undefined
  ) {
    throw new Error('Invalid compaction model call observation.')
  }
  return {
    schemaVersion: TAPE_COMPACTION_MODEL_CALL_SCHEMA_VERSION,
    compactionMessageId,
    compactionAttemptId,
    providerCallId,
    callSeq,
    providerId,
    modelId,
    status: input.status,
    usage,
    startedAt: input.startedAt,
    completedAt: input.completedAt
  }
}

export function parseTapeCompactionModelCallEvent(
  row: DeepChatTapeEntryRow
): TapeCompactionModelCallEvent | null {
  if (row.kind !== 'event' || row.name !== TAPE_COMPACTION_MODEL_CALL_EVENT_NAME) return null
  const payload = parseTapeJsonObject(row.payload_json)
  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : null
  if (!data || data.schemaVersion !== TAPE_COMPACTION_MODEL_CALL_SCHEMA_VERSION) return null

  const compactionMessageId = normalizeId(data.compactionMessageId)
  const compactionAttemptId = normalizeId(data.compactionAttemptId)
  const providerCallId = normalizeId(data.providerCallId)
  const providerId = normalizeId(data.providerId)
  const modelId = normalizeId(data.modelId)
  const usage = normalizeUsage(data.usage)
  if (
    !compactionMessageId ||
    !compactionAttemptId ||
    !providerCallId ||
    !providerId ||
    !modelId ||
    row.source_type !== 'runtime_event' ||
    row.source_id !== compactionAttemptId ||
    row.source_seq !== data.callSeq ||
    typeof data.status !== 'string' ||
    !STATUSES.has(data.status as TapeCompactionModelCallStatus) ||
    !Number.isSafeInteger(data.callSeq) ||
    (data.callSeq as number) <= 0 ||
    !isNonNegativeSafeInteger(data.startedAt) ||
    !isNonNegativeSafeInteger(data.completedAt) ||
    data.completedAt < data.startedAt ||
    usage === undefined
  ) {
    return null
  }
  return {
    schemaVersion: TAPE_COMPACTION_MODEL_CALL_SCHEMA_VERSION,
    compactionMessageId,
    compactionAttemptId,
    providerCallId,
    callSeq: data.callSeq as number,
    providerId,
    modelId,
    status: data.status as TapeCompactionModelCallStatus,
    usage,
    startedAt: data.startedAt,
    completedAt: data.completedAt
  }
}
