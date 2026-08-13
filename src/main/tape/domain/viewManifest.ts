import type { ChatMessage } from '@shared/types/core/chat-message'
import { stripToolExecutionContract, type MCPToolDefinition } from '@shared/types/core/mcp'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { DeepChatExecutionContract } from '@shared/types/execution-contract'
import type {
  DeepChatTapeViewEntryRef,
  DeepChatTapeViewExcludedRange,
  DeepChatTapeViewExcludedRef,
  DeepChatTapeViewManifest,
  DeepChatTapeViewManifestIntegrity,
  DeepChatTapeViewManifestLegacy,
  DeepChatTapeViewPolicy,
  DeepChatTapeViewManifestV5,
  DeepChatTapeViewManifestV6,
  DeepChatTapeViewManifestV7,
  DeepChatTapeSkillContext,
  DeepChatTapeSkillContextV7,
  DeepChatTapeViewSyntheticContribution,
  DeepChatTapeViewTaskType,
  DeepChatTapeViewTokenBudget
} from '@shared/types/tape-view-manifest'
import { validateSchema6SkillContexts, validateSchema7SkillContexts } from './skillContext'
import { estimateMessagesTokens } from '@shared/utils/messageTokens'
import { hashJson, hashJsonData } from './canonicalJson'
import {
  buildProviderMessagesHash,
  buildProviderVisibleToolDefinitionsHash,
  isDeepChatExecutionContract
} from './executionContract'

export { hashJson, stableJsonStringify } from './canonicalJson'

export type ContextSummaryCursorMetadata = {
  summaryCursorOrderSeq: number
  preCursorOrderSeqMin: number | null
  preCursorOrderSeqMax: number | null
  preCursorCount: number
}

export function isCompactionRecord(record: ChatMessageRecord): boolean {
  try {
    const metadata = JSON.parse(record.metadata) as { messageType?: string }
    return metadata.messageType === 'compaction'
  } catch {
    return false
  }
}

/** Stable event name persisted for deterministic view reconstruction. */
export const TAPE_VIEW_MANIFEST_EVENT_NAME = 'view/assembled'
export const TAPE_VIEW_CONTEXT_BUILDER_VERSION = 'cache-aware-v1' as const

export type TapeViewManifestLookupMaps = {
  entryIdByMessageId?: Map<string, number>
  toolCallEntryIdByToolId?: Map<string, number>
  toolResultEntryIdByToolId?: Map<string, number>
}

export type TapeViewManifestBuildInput = {
  sessionId: string
  messageId: string
  requestSeq: number
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  contextBuilderVersion?: DeepChatTapeViewManifest['contextBuilderVersion']
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  latestEntryId: number
  anchorEntryIds: number[]
  reconstructionAnchorEntryId?: number | null
  included: DeepChatTapeViewEntryRef[]
  excluded: DeepChatTapeViewExcludedRef[]
  summaryCursor?: ContextSummaryCursorMetadata
  tokenBudget: Omit<DeepChatTapeViewTokenBudget, 'estimatedPromptTokens'>
  providerId: string
  modelId: string
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  executionContract?: DeepChatExecutionContract
  runId?: string
  tapeIncarnationId?: string
  skillContexts?: DeepChatTapeSkillContext[] | DeepChatTapeSkillContextV7[]
  requireDurableManifest?: boolean
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
  summaryCursor?: ContextSummaryCursorMetadata
  includesSystemPrompt: boolean
  newUserMessageId?: string | null
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
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

const TAPE_VIEW_MANIFEST_LEGACY_HASH_VERSION = 2
/** Current hash version for contract-bearing ViewManifest values. */
export const TAPE_VIEW_MANIFEST_HASH_VERSION = 3
export const TAPE_VIEW_MANIFEST_SKILL_HASH_VERSION = 4
export const TAPE_VIEW_MANIFEST_EXECUTABLE_SKILL_HASH_VERSION = 5

function buildManifestHashable(manifest: DeepChatTapeViewManifest): Record<string, unknown> {
  const hashable: Record<string, unknown> = { ...manifest }
  delete hashable.assembledAt
  delete hashable.viewId
  hashable.hashes = {
    promptHash: manifest.hashes.promptHash,
    toolDefinitionsHash: manifest.hashes.toolDefinitionsHash
  }
  return hashable
}

function buildManifestHashV2(manifest: DeepChatTapeViewManifest): string {
  return hashJson(buildManifestHashable(manifest))
}

function buildManifestHashV3(manifest: DeepChatTapeViewManifest): string {
  return hashJsonData(buildManifestHashable(manifest))
}

function executionContractMatchesManifest(
  manifest: DeepChatTapeViewManifestV5 | DeepChatTapeViewManifestV6 | DeepChatTapeViewManifestV7
): boolean {
  const contract = manifest.executionContract
  return (
    isDeepChatExecutionContract(contract) &&
    contract.request.sessionId === manifest.sessionId &&
    contract.request.messageId === manifest.messageId &&
    contract.request.requestSeq === manifest.requestSeq &&
    (manifest.schemaVersion === 5 || contract.request.runId === manifest.runId) &&
    contract.provenance.providerId === manifest.meta.providerId &&
    contract.provenance.modelId === manifest.meta.modelId &&
    contract.provenance.promptHash === manifest.hashes.promptHash &&
    contract.provenance.providerVisibleToolDefinitionsHash === manifest.hashes.toolDefinitionsHash
  )
}

function isDeeplyFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen)
}

function requireExecutionContractMatchesInput(
  input: TapeViewManifestBuildInput,
  promptHash: string,
  toolDefinitionsHash: string
): DeepChatExecutionContract {
  const contract = input.executionContract
  if (!isDeepChatExecutionContract(contract)) {
    throw new TypeError('Execution contract is missing, malformed, or has an invalid hash.')
  }
  if (!isDeeplyFrozen(contract)) {
    throw new TypeError('Execution contract must be immutable before View construction.')
  }
  if (
    contract.request.sessionId !== input.sessionId ||
    contract.request.messageId !== input.messageId ||
    contract.request.requestSeq !== input.requestSeq ||
    (input.runId !== undefined && contract.request.runId !== input.runId)
  ) {
    throw new TypeError('Execution contract request identity does not match the View request.')
  }
  if (
    contract.provenance.providerId !== input.providerId ||
    contract.provenance.modelId !== input.modelId
  ) {
    throw new TypeError('Execution contract provider identity does not match the View request.')
  }
  if (contract.provenance.promptHash !== promptHash) {
    throw new TypeError('Execution contract provider-message hash does not match the View payload.')
  }
  if (contract.provenance.providerVisibleToolDefinitionsHash !== toolDefinitionsHash) {
    throw new TypeError('Execution contract tool-definition hash does not match the View payload.')
  }
  return contract
}

function finalizeManifest<T extends DeepChatTapeViewManifest>(draft: T): T {
  const manifestHash =
    draft.hashVersion === TAPE_VIEW_MANIFEST_HASH_VERSION ||
    draft.hashVersion === TAPE_VIEW_MANIFEST_SKILL_HASH_VERSION ||
    draft.hashVersion === TAPE_VIEW_MANIFEST_EXECUTABLE_SKILL_HASH_VERSION
      ? buildManifestHashV3(draft)
      : buildManifestHashV2(draft)
  return {
    ...draft,
    viewId: `view_${manifestHash.slice(0, 16)}`,
    hashes: { ...draft.hashes, manifestHash }
  } as T
}

function buildExcludedRanges(
  summaryCursor?: ContextSummaryCursorMetadata
): DeepChatTapeViewExcludedRange[] {
  if (
    !summaryCursor ||
    summaryCursor.preCursorCount === 0 ||
    summaryCursor.preCursorOrderSeqMin === null ||
    summaryCursor.preCursorOrderSeqMax === null
  ) {
    return []
  }
  return [
    {
      fromOrderSeq: summaryCursor.preCursorOrderSeqMin,
      toOrderSeq: summaryCursor.preCursorOrderSeqMax,
      count: summaryCursor.preCursorCount,
      reason: 'before_summary_cursor'
    }
  ]
}

export function verifyTapeViewManifestHash(
  manifest: DeepChatTapeViewManifest
): DeepChatTapeViewManifestIntegrity {
  if (manifest.hashVersion === TAPE_VIEW_MANIFEST_LEGACY_HASH_VERSION) {
    if (manifest.schemaVersion < 1 || manifest.schemaVersion > 4) return 'invalid'
    return buildManifestHashV2(manifest) === manifest.hashes.manifestHash ? 'valid' : 'invalid'
  }
  if (manifest.hashVersion === TAPE_VIEW_MANIFEST_HASH_VERSION) {
    if (manifest.schemaVersion !== 5 || !executionContractMatchesManifest(manifest))
      return 'invalid'
    const manifestHash = buildManifestHashV3(manifest)
    return manifestHash === manifest.hashes.manifestHash &&
      manifest.viewId === `view_${manifestHash.slice(0, 16)}`
      ? 'valid'
      : 'invalid'
  }
  if (manifest.hashVersion === TAPE_VIEW_MANIFEST_SKILL_HASH_VERSION) {
    if (manifest.schemaVersion !== 6) return 'invalid'
    if (manifest.executionContract && !executionContractMatchesManifest(manifest)) return 'invalid'
    const manifestHash = buildManifestHashV3(manifest)
    return manifestHash === manifest.hashes.manifestHash &&
      manifest.viewId === `view_${manifestHash.slice(0, 16)}`
      ? 'valid'
      : 'invalid'
  }
  if (manifest.hashVersion === TAPE_VIEW_MANIFEST_EXECUTABLE_SKILL_HASH_VERSION) {
    if (manifest.schemaVersion !== 7) return 'invalid'
    if (manifest.executionContract && !executionContractMatchesManifest(manifest)) return 'invalid'
    const manifestHash = buildManifestHashV3(manifest)
    return manifestHash === manifest.hashes.manifestHash &&
      manifest.viewId === `view_${manifestHash.slice(0, 16)}`
      ? 'valid'
      : 'invalid'
  }
  return 'unverified'
}

export function createTapeViewManifest(
  input: TapeViewManifestBuildInput
): DeepChatTapeViewManifest {
  const assembledAt = input.assembledAt ?? Date.now()
  const excludedRanges = buildExcludedRanges(input.summaryCursor)
  const common = {
    viewId: '',
    sessionId: input.sessionId,
    messageId: input.messageId,
    requestSeq: input.requestSeq,
    taskType: input.taskType,
    policy: input.policy,
    policyVersion: input.policyVersion ?? null,
    contextBuilderVersion:
      input.contextBuilderVersion ??
      (input.policy === 'cache_aware_context_v1' ? 'cache-aware-v1' : 'legacy-v1'),
    latestEntryId: input.latestEntryId,
    anchorEntryIds: [...input.anchorEntryIds],
    ...(input.reconstructionAnchorEntryId !== undefined
      ? { reconstructionAnchorEntryId: input.reconstructionAnchorEntryId }
      : {}),
    included: input.included.map((entry) => ({
      ...entry,
      ...(entry.sourceEntryIds ? { sourceEntryIds: [...entry.sourceEntryIds] } : {})
    })),
    excluded: input.excluded.map((entry) => ({ ...entry })),
    ...(excludedRanges.length > 0 ? { excludedRanges } : {}),
    tokenBudget: {
      ...input.tokenBudget,
      estimatedPromptTokens: estimateMessagesTokens(input.messages)
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

  if (input.skillContexts?.length || input.requireDurableManifest) {
    if (!input.skillContexts?.length)
      throw new TypeError('A durable Skill manifest requires Skill contexts.')
    if (!input.runId?.trim() || !input.tapeIncarnationId?.trim()) {
      throw new TypeError('Skill-bearing ViewManifest requires run and Tape incarnation identity.')
    }
    const promptHash = buildProviderMessagesHash(input.messages)
    const toolDefinitionsHash = buildProviderVisibleToolDefinitionsHash(input.tools)
    const executionContract =
      input.executionContract === undefined
        ? undefined
        : requireExecutionContractMatchesInput(input, promptHash, toolDefinitionsHash)
    const usesExecutableRuntimeContext = input.skillContexts.some(
      (context) => context.activationScope === 'runtime_view' && 'executionRef' in context
    )
    if (usesExecutableRuntimeContext) {
      const draft: DeepChatTapeViewManifestV7 = {
        schemaVersion: 7,
        hashVersion: TAPE_VIEW_MANIFEST_EXECUTABLE_SKILL_HASH_VERSION,
        ...common,
        runId: input.runId,
        tapeIncarnationId: input.tapeIncarnationId,
        skillContexts: structuredClone(validateSchema7SkillContexts(input.skillContexts)),
        hashes: { promptHash, toolDefinitionsHash, manifestHash: '' },
        ...(executionContract ? { executionContract } : {})
      }
      return finalizeManifest(draft)
    }
    const draft: DeepChatTapeViewManifestV6 = {
      schemaVersion: 6,
      hashVersion: TAPE_VIEW_MANIFEST_SKILL_HASH_VERSION,
      ...common,
      runId: input.runId,
      tapeIncarnationId: input.tapeIncarnationId,
      skillContexts: structuredClone(validateSchema6SkillContexts(input.skillContexts)),
      hashes: { promptHash, toolDefinitionsHash, manifestHash: '' },
      ...(executionContract ? { executionContract } : {})
    }
    return finalizeManifest(draft)
  }

  if (input.executionContract !== undefined) {
    const promptHash = buildProviderMessagesHash(input.messages)
    const toolDefinitionsHash = buildProviderVisibleToolDefinitionsHash(input.tools)
    const executionContract = requireExecutionContractMatchesInput(
      input,
      promptHash,
      toolDefinitionsHash
    )
    const draft: DeepChatTapeViewManifestV5 = {
      schemaVersion: 5,
      hashVersion: TAPE_VIEW_MANIFEST_HASH_VERSION,
      ...common,
      hashes: { promptHash, toolDefinitionsHash, manifestHash: '' },
      executionContract
    }
    return finalizeManifest(draft)
  }

  const draft: DeepChatTapeViewManifestLegacy = {
    schemaVersion: 4,
    hashVersion: TAPE_VIEW_MANIFEST_LEGACY_HASH_VERSION,
    ...common,
    hashes: {
      promptHash: hashJson(input.messages),
      toolDefinitionsHash: hashJson(input.tools.map(stripToolExecutionContract)),
      manifestHash: ''
    }
  }
  return finalizeManifest(draft)
}

export function buildIncludedRefs(
  selection: TapeViewContextSelection,
  sourceMaps: TapeViewManifestLookupMaps = {}
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

  refs.push(
    ...buildSyntheticContributionRefs(
      (selection.syntheticContributions ?? []).filter(
        (contribution) =>
          contribution.reason !== 'memory_context' && contribution.reason !== 'directive_context'
      )
    )
  )

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

  refs.push(
    ...buildSyntheticContributionRefs(
      (selection.syntheticContributions ?? []).filter(
        (contribution) =>
          contribution.reason === 'memory_context' || contribution.reason === 'directive_context'
      )
    )
  )

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

export function buildSyntheticContributionRefs(
  contributions: readonly DeepChatTapeViewSyntheticContribution[]
): DeepChatTapeViewEntryRef[] {
  return contributions.map((contribution) => ({
    entryId: null,
    messageId: null,
    orderSeq: null,
    role: contribution.role,
    source: 'synthetic',
    reason: contribution.reason,
    ...(contribution.sourceEntryIds?.length
      ? { sourceEntryIds: [...contribution.sourceEntryIds] }
      : {}),
    contentHash: contribution.contentHash
  }))
}

export function buildExcludedRefs(
  selection: TapeViewContextSelection,
  sourceMaps: TapeViewManifestLookupMaps = {}
): DeepChatTapeViewExcludedRef[] {
  return selection.excludedRecords.map((item) => ({
    entryId: sourceMaps.entryIdByMessageId?.get(item.record.id) ?? null,
    messageId: item.record.id,
    orderSeq: item.record.orderSeq,
    reason: item.reason
  }))
}

export function buildRequestRefs(
  messages: ChatMessage[],
  sourceMaps: TapeViewManifestLookupMaps = {}
): DeepChatTapeViewEntryRef[] {
  const lastToolCallIndex = new Map<string, number>()
  const lastToolResultIndex = new Map<string, number>()
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      for (const toolCall of message.tool_calls) {
        lastToolCallIndex.set(toolCall.id, index)
      }
    } else if (message.role === 'tool' && message.tool_call_id) {
      lastToolResultIndex.set(message.tool_call_id, index)
    }
  })

  const refs: DeepChatTapeViewEntryRef[] = []
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      for (const toolCall of message.tool_calls) {
        const entryId =
          lastToolCallIndex.get(toolCall.id) === index
            ? (sourceMaps.toolCallEntryIdByToolId?.get(toolCall.id) ?? null)
            : null
        refs.push({
          entryId,
          messageId: null,
          orderSeq: null,
          role: 'assistant',
          source: entryId === null ? 'synthetic' : 'tape',
          reason: 'tool_loop_message'
        })
      }
      return
    }

    if (message.role === 'tool' && message.tool_call_id) {
      const entryId =
        lastToolResultIndex.get(message.tool_call_id) === index
          ? (sourceMaps.toolResultEntryIdByToolId?.get(message.tool_call_id) ?? null)
          : null
      refs.push({
        entryId,
        messageId: null,
        orderSeq: null,
        role: 'tool',
        source: entryId === null ? 'synthetic' : 'tape',
        reason: 'tool_loop_message'
      })
      return
    }

    refs.push({
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
    })
  })

  return refs
}
