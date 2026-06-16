import { createHash } from 'crypto'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type {
  DeepChatTapeViewEntryRef,
  DeepChatTapeViewExcludedRef,
  DeepChatTapeViewManifest,
  DeepChatTapeViewPolicy,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'
import { estimateMessagesTokens } from './contextBuilder'
export { isCompactionRecord } from './contextBuilder'

export const TAPE_VIEW_MANIFEST_EVENT_NAME = 'view/assembled'
export const TAPE_VIEW_CONTEXT_BUILDER_VERSION = 'legacy-v1' as const

export type TapeViewManifestSourceMaps = {
  entryIdByMessageId?: Map<string, number>
}

export type TapeViewManifestBuildInput = {
  viewId?: string
  sessionId: string
  messageId: string
  requestSeq: number
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  latestEntryId: number
  anchorEntryIds: number[]
  included: DeepChatTapeViewEntryRef[]
  excluded: DeepChatTapeViewExcludedRef[]
  tokenBudget: Omit<DeepChatTapeViewTokenBudget, 'estimatedPromptTokens'>
  providerId: string
  modelId: string
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  assembledAt?: number
}

export type TapeViewManifestPolicyInput = {
  recoveredFromContextPressure: boolean
  isInitialViewRequest: boolean
  viewPolicy?: DeepChatTapeViewPolicy
  viewPolicyVersion?: number | null
}

export type TapeViewManifestPolicyResult = {
  policy: DeepChatTapeViewPolicy
  policyVersion: number | null
}

export type TapeViewContextSelection = {
  includedRecords: Array<{
    record: ChatMessageRecord
    reason: DeepChatTapeViewEntryRef['reason']
  }>
  excludedRecords: Array<{
    record: ChatMessageRecord
    reason: DeepChatTapeViewExcludedRef['reason']
  }>
  includesSystemPrompt: boolean
  newUserMessageId?: string | null
}

export function resolveTapeViewManifestPolicy(
  input: TapeViewManifestPolicyInput
): TapeViewManifestPolicyResult {
  if (input.recoveredFromContextPressure) {
    return {
      policy: 'context_pressure_recovery_shadow',
      policyVersion: null
    }
  }

  if (input.isInitialViewRequest && input.viewPolicy) {
    return {
      policy: input.viewPolicy,
      policyVersion: input.viewPolicyVersion ?? null
    }
  }

  return {
    policy: 'tool_loop_shadow',
    policyVersion: null
  }
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForStableJson)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const nested = record[key]
      if (nested !== undefined) {
        result[key] = normalizeForStableJson(nested)
      }
      return result
    }, {})
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value))
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex')
}

function buildViewId(input: TapeViewManifestBuildInput, assembledAt: number): string {
  return `view_${hashJson({
    sessionId: input.sessionId,
    messageId: input.messageId,
    requestSeq: input.requestSeq,
    policy: input.policy,
    assembledAt
  }).slice(0, 16)}`
}

function attachManifestHash(
  manifest: Omit<DeepChatTapeViewManifest, 'hashes'> & {
    hashes: Omit<DeepChatTapeViewManifest['hashes'], 'manifestHash'> & { manifestHash: '' }
  }
): DeepChatTapeViewManifest {
  const manifestForHash = {
    ...manifest,
    hashes: {
      ...manifest.hashes,
      manifestHash: ''
    }
  }
  return {
    ...manifest,
    hashes: {
      ...manifest.hashes,
      manifestHash: hashJson(manifestForHash)
    }
  }
}

export function createTapeViewManifest(
  input: TapeViewManifestBuildInput
): DeepChatTapeViewManifest {
  const assembledAt = input.assembledAt ?? Date.now()
  const viewId = input.viewId ?? buildViewId(input, assembledAt)
  const manifest: Omit<DeepChatTapeViewManifest, 'hashes'> & {
    hashes: Omit<DeepChatTapeViewManifest['hashes'], 'manifestHash'> & { manifestHash: '' }
  } = {
    schemaVersion: 1 as const,
    viewId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    requestSeq: input.requestSeq,
    taskType: input.taskType,
    policy: input.policy,
    policyVersion: input.policyVersion ?? null,
    contextBuilderVersion: TAPE_VIEW_CONTEXT_BUILDER_VERSION,
    latestEntryId: input.latestEntryId,
    anchorEntryIds: [...input.anchorEntryIds],
    included: input.included.map((entry) => ({ ...entry })),
    excluded: input.excluded.map((entry) => ({ ...entry })),
    tokenBudget: {
      ...input.tokenBudget,
      estimatedPromptTokens: estimateMessagesTokens(input.messages)
    },
    hashes: {
      promptHash: hashJson(input.messages),
      toolDefinitionsHash: hashJson(input.tools),
      manifestHash: ''
    },
    meta: {
      providerId: input.providerId,
      modelId: input.modelId,
      summaryCursorOrderSeq: input.summaryCursorOrderSeq,
      supportsVision: input.supportsVision,
      supportsAudioInput: input.supportsAudioInput,
      traceDebugEnabled: input.traceDebugEnabled
    },
    assembledAt
  }

  return attachManifestHash(manifest)
}

export function buildIncludedRefs(
  selection: TapeViewContextSelection,
  sourceMaps: TapeViewManifestSourceMaps = {}
): DeepChatTapeViewEntryRef[] {
  const refs: DeepChatTapeViewEntryRef[] = []

  if (selection.includesSystemPrompt) {
    refs.push({
      entryId: null,
      messageId: null,
      orderSeq: null,
      role: 'system',
      source: 'synthetic',
      reason: 'system_prompt'
    })
  }

  for (const item of selection.includedRecords) {
    refs.push({
      entryId: sourceMaps.entryIdByMessageId?.get(item.record.id) ?? null,
      messageId: item.record.id,
      orderSeq: item.record.orderSeq,
      role: item.record.role,
      source: sourceMaps.entryIdByMessageId?.has(item.record.id) ? 'tape' : 'synthetic',
      reason: item.reason
    })
  }

  if (selection.newUserMessageId) {
    refs.push({
      entryId: sourceMaps.entryIdByMessageId?.get(selection.newUserMessageId) ?? null,
      messageId: selection.newUserMessageId,
      orderSeq: null,
      role: 'user',
      source: sourceMaps.entryIdByMessageId?.has(selection.newUserMessageId) ? 'tape' : 'synthetic',
      reason: 'new_user_input'
    })
  }

  return refs
}

export function buildExcludedRefs(
  selection: TapeViewContextSelection,
  sourceMaps: TapeViewManifestSourceMaps = {}
): DeepChatTapeViewExcludedRef[] {
  return selection.excludedRecords.map((item) => ({
    entryId: sourceMaps.entryIdByMessageId?.get(item.record.id) ?? null,
    messageId: item.record.id,
    orderSeq: item.record.orderSeq,
    reason: item.reason
  }))
}

export function buildSyntheticRequestRefs(messages: ChatMessage[]): DeepChatTapeViewEntryRef[] {
  return messages.map((message) => ({
    entryId: null,
    messageId: null,
    orderSeq: null,
    role: message.role,
    source: 'synthetic',
    reason:
      message.role === 'system'
        ? 'system_prompt'
        : message.role === 'tool'
          ? 'tool_loop_message'
          : 'selected_history'
  }))
}
