import { createHash } from 'crypto'
import type {
  DeepChatTapeViewExcludedRange,
  DeepChatTapeViewManifest
} from '@shared/types/tape-view-manifest'
import type { DeepChatTapeReplaySlice } from '@shared/types/tape-replay'
import { isDeepChatExecutionContract } from './executionContract'
import { hashJson } from './viewManifest'
import { validateSchema6SkillContexts, validateSchema7SkillContexts } from './skillContext'
import { isBoundedSkillTapeIdentity } from './skillIdentity'

const VIEW_POLICIES = new Set([
  'cache_aware_context_v1',
  'legacy_context_v1',
  'legacy_context_shadow',
  'resume_shadow',
  'tool_loop_shadow',
  'context_pressure_recovery_shadow'
])

const VIEW_ENTRY_REASONS = new Set([
  'system_prompt',
  'summary_checkpoint',
  'reconstruction_checkpoint',
  'memory_context',
  'directive_context',
  'selected_history',
  'new_user_input',
  'resume_target',
  'tool_loop_message'
])
const SCHEMA_V3_ENTRY_REASONS = new Set([
  'summary_checkpoint',
  'reconstruction_checkpoint',
  'memory_context'
])
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

const VIEW_EXCLUDED_REASONS = new Set([
  'before_summary_cursor',
  'compaction_indicator',
  'pending_not_context_history',
  'out_of_budget',
  'empty_after_formatting',
  'superseded',
  'retracted'
])

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function isViewEntryRef(
  value: unknown,
  schemaVersion: DeepChatTapeViewManifest['schemaVersion']
): value is DeepChatTapeViewManifest['included'][number] {
  if (!isRecordObject(value)) return false
  const reason = typeof value.reason === 'string' ? value.reason : null
  const hasSchemaV3Fields =
    value.sourceEntryIds !== undefined ||
    value.contentHash !== undefined ||
    (reason !== null && SCHEMA_V3_ENTRY_REASONS.has(reason))

  return (
    isNullableNumber(value.entryId) &&
    isNullableString(value.messageId) &&
    isNullableNumber(value.orderSeq) &&
    (value.role === 'system' ||
      value.role === 'user' ||
      value.role === 'assistant' ||
      value.role === 'tool' ||
      value.role === null) &&
    (value.source === 'tape' || value.source === 'synthetic') &&
    reason !== null &&
    VIEW_ENTRY_REASONS.has(reason) &&
    (schemaVersion >= 3 || !hasSchemaV3Fields) &&
    (reason !== 'directive_context' || schemaVersion >= 4) &&
    (value.sourceEntryIds === undefined ||
      (Array.isArray(value.sourceEntryIds) &&
        value.sourceEntryIds.every(
          (entryId) => typeof entryId === 'number' && isPositiveInteger(entryId)
        ))) &&
    (value.contentHash === undefined ||
      (typeof value.contentHash === 'string' && SHA256_HEX_PATTERN.test(value.contentHash)))
  )
}

function isViewExcludedRef(value: unknown): value is DeepChatTapeViewManifest['excluded'][number] {
  if (!isRecordObject(value)) return false

  return (
    isNullableNumber(value.entryId) &&
    isNullableString(value.messageId) &&
    isNullableNumber(value.orderSeq) &&
    typeof value.reason === 'string' &&
    VIEW_EXCLUDED_REASONS.has(value.reason)
  )
}

function isViewExcludedRange(value: unknown): value is DeepChatTapeViewExcludedRange {
  if (!isRecordObject(value)) return false

  return (
    typeof value.fromOrderSeq === 'number' &&
    typeof value.toOrderSeq === 'number' &&
    typeof value.count === 'number' &&
    typeof value.reason === 'string' &&
    VIEW_EXCLUDED_REASONS.has(value.reason)
  )
}

function hasNumberFields(value: unknown, fields: string[]): value is Record<string, number> {
  if (!isRecordObject(value)) return false
  return fields.every((field) => typeof value[field] === 'number')
}

function hasStringFields(value: unknown, fields: string[]): value is Record<string, string> {
  if (!isRecordObject(value)) return false
  return fields.every((field) => typeof value[field] === 'string')
}

function isViewManifestMeta(value: unknown): value is DeepChatTapeViewManifest['meta'] {
  if (!isRecordObject(value)) return false

  return (
    typeof value.providerId === 'string' &&
    typeof value.modelId === 'string' &&
    typeof value.summaryCursorOrderSeq === 'number' &&
    typeof value.supportsVision === 'boolean' &&
    typeof value.supportsAudioInput === 'boolean' &&
    typeof value.traceDebugEnabled === 'boolean'
  )
}

function hasExecutionContractForSchema(
  value: Record<string, unknown>,
  schemaVersion: DeepChatTapeViewManifest['schemaVersion']
): boolean {
  if (schemaVersion !== 5 && schemaVersion !== 6 && schemaVersion !== 7)
    return value.executionContract === undefined
  if ((schemaVersion === 6 || schemaVersion === 7) && value.executionContract === undefined)
    return true
  if (
    value.hashVersion !== (schemaVersion === 5 ? 3 : schemaVersion === 6 ? 4 : 5) ||
    !isDeepChatExecutionContract(value.executionContract) ||
    !isRecordObject(value.meta) ||
    !isRecordObject(value.hashes)
  ) {
    return false
  }

  const contract = value.executionContract
  return (
    contract.request.sessionId === value.sessionId &&
    contract.request.messageId === value.messageId &&
    contract.request.requestSeq === value.requestSeq &&
    (schemaVersion === 5 || contract.request.runId === value.runId) &&
    contract.provenance.providerId === value.meta.providerId &&
    contract.provenance.modelId === value.meta.modelId &&
    contract.provenance.promptHash === value.hashes.promptHash &&
    contract.provenance.providerVisibleToolDefinitionsHash === value.hashes.toolDefinitionsHash &&
    typeof value.hashes.manifestHash === 'string' &&
    value.viewId === `view_${value.hashes.manifestHash.slice(0, 16)}`
  )
}

export function isTapeViewManifest(
  value: unknown,
  sessionId: string
): value is DeepChatTapeViewManifest {
  if (!isRecordObject(value)) return false
  const schemaVersion =
    value.schemaVersion === 1 ||
    value.schemaVersion === 2 ||
    value.schemaVersion === 3 ||
    value.schemaVersion === 4 ||
    value.schemaVersion === 5 ||
    value.schemaVersion === 6 ||
    value.schemaVersion === 7
      ? value.schemaVersion
      : null
  if (schemaVersion === null) return false

  return (
    typeof value.hashVersion === 'number' &&
    value.sessionId === sessionId &&
    typeof value.viewId === 'string' &&
    typeof value.messageId === 'string' &&
    typeof value.requestSeq === 'number' &&
    (value.taskType === 'chat' || value.taskType === 'resume' || value.taskType === 'tool_loop') &&
    typeof value.policy === 'string' &&
    VIEW_POLICIES.has(value.policy) &&
    (value.policy !== 'cache_aware_context_v1' || schemaVersion >= 3) &&
    (typeof value.policyVersion === 'number' || value.policyVersion === null) &&
    (value.contextBuilderVersion === 'legacy-v1' ||
      (schemaVersion >= 3 && value.contextBuilderVersion === 'cache-aware-v1')) &&
    typeof value.latestEntryId === 'number' &&
    Array.isArray(value.anchorEntryIds) &&
    value.anchorEntryIds.every((entryId) => typeof entryId === 'number') &&
    (value.reconstructionAnchorEntryId === undefined ||
      isNullableNumber(value.reconstructionAnchorEntryId)) &&
    (value.excludedRanges === undefined ||
      (Array.isArray(value.excludedRanges) && value.excludedRanges.every(isViewExcludedRange))) &&
    Array.isArray(value.included) &&
    value.included.every((entry) => isViewEntryRef(entry, schemaVersion)) &&
    Array.isArray(value.excluded) &&
    value.excluded.every(isViewExcludedRef) &&
    hasNumberFields(value.tokenBudget, [
      'contextLength',
      'requestedMaxTokens',
      'effectiveMaxTokens',
      'reserveTokens',
      'toolReserveTokens',
      'estimatedPromptTokens'
    ]) &&
    hasStringFields(value.hashes, ['promptHash', 'toolDefinitionsHash', 'manifestHash']) &&
    isViewManifestMeta(value.meta) &&
    (schemaVersion < 6 ||
      (value.hashVersion === (schemaVersion === 6 ? 4 : 5) &&
        isBoundedSkillTapeIdentity(value.runId) &&
        isBoundedSkillTapeIdentity(value.tapeIncarnationId) &&
        (() => {
          try {
            if (schemaVersion === 6) validateSchema6SkillContexts(value.skillContexts)
            else validateSchema7SkillContexts(value.skillContexts)
            return true
          } catch {
            return false
          }
        })())) &&
    hasExecutionContractForSchema(value, schemaVersion) &&
    typeof value.assembledAt === 'number'
  )
}

export function normalizeStoredTapeViewManifest(
  value: unknown,
  sessionId: string
): DeepChatTapeViewManifest | null {
  const candidate =
    isRecordObject(value) && value.hashVersion === undefined ? { ...value, hashVersion: 1 } : value
  return isTapeViewManifest(candidate, sessionId) ? candidate : null
}

export function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

export function collectEntryIds(values: Array<number | null>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === 'number'))].sort(
    (left, right) => left - right
  )
}

export function withReplaySliceHash(
  slice: Omit<DeepChatTapeReplaySlice, 'hashes'> & {
    hashes: Omit<DeepChatTapeReplaySlice['hashes'], 'sliceHash'> & { sliceHash: '' }
  }
): DeepChatTapeReplaySlice {
  const sliceForHash = { ...slice } as Partial<DeepChatTapeReplaySlice>
  delete sliceForHash.createdAt
  delete sliceForHash.integrity
  return {
    ...slice,
    hashes: {
      ...slice.hashes,
      sliceHash: hashJson(sliceForHash)
    }
  }
}
