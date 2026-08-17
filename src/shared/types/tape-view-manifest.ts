import type { DeepChatExecutionContract } from './execution-contract'
import type { SkillSourceType } from './skillManagement'

export type DeepChatTapeViewTaskType = 'chat' | 'resume' | 'tool_loop'

export type DeepChatTapeViewPolicy =
  | 'cache_aware_context_v2'
  | 'cache_aware_context_v1'
  | 'legacy_context_v1'
  | 'legacy_context_shadow'
  | 'resume_shadow'
  | 'tool_loop_shadow'
  | 'context_pressure_recovery_shadow'

export type DeepChatTapeViewContextBuilderVersion =
  | 'legacy-v1'
  | 'cache-aware-v1'
  | 'cache-aware-v2'

export type DeepChatTapeViewEntryRole = 'system' | 'user' | 'assistant' | 'tool' | null

export type DeepChatTapeViewEntrySource = 'tape' | 'synthetic'

export type DeepChatTapeViewEntryReason =
  | 'system_prompt'
  | 'summary_checkpoint'
  | 'reconstruction_checkpoint'
  | 'memory_context'
  | 'directive_context'
  | 'pinned_first_user'
  | 'selected_history'
  | 'new_user_input'
  | 'resume_target'
  | 'tool_loop_message'

export type DeepChatTapeViewExcludedReason =
  | 'before_summary_cursor'
  | 'compaction_indicator'
  | 'pending_not_context_history'
  | 'out_of_budget'
  | 'empty_after_formatting'
  | 'superseded'
  | 'retracted'

export interface DeepChatTapeViewEntryRef {
  entryId: number | null
  messageId: string | null
  orderSeq: number | null
  role: DeepChatTapeViewEntryRole
  source: DeepChatTapeViewEntrySource
  reason: DeepChatTapeViewEntryReason
  sourceEntryIds?: number[]
  contentHash?: string
}

export interface DeepChatTapeViewSyntheticContribution {
  role: 'user'
  reason:
    | 'summary_checkpoint'
    | 'reconstruction_checkpoint'
    | 'memory_context'
    | 'directive_context'
  sourceEntryIds?: number[]
  contentHash: string
}

export interface DeepChatTapeViewPinnedFirstUser {
  messageId: string
  orderSeq: number
  sourceContentHash: string
  contentHash: string
}

export interface DeepChatTapeViewExcludedRef {
  entryId: number | null
  messageId: string | null
  orderSeq: number | null
  reason: DeepChatTapeViewExcludedReason
}

export interface DeepChatTapeViewExcludedRange {
  fromOrderSeq: number
  toOrderSeq: number
  count: number
  reason: DeepChatTapeViewExcludedReason
}

export interface DeepChatTapeViewTokenBudget {
  contextLength: number
  requestedMaxTokens: number
  effectiveMaxTokens: number
  reserveTokens: number
  toolReserveTokens: number
  estimatedPromptTokens: number
}

export interface DeepChatTapeViewHashes {
  promptHash: string
  toolDefinitionsHash: string
  manifestHash: string
}

export interface DeepChatTapeViewMeta {
  providerId: string
  modelId: string
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
}

interface DeepChatTapeViewManifestBase {
  viewId: string
  sessionId: string
  messageId: string
  requestSeq: number
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion: number | null
  contextBuilderVersion: DeepChatTapeViewContextBuilderVersion
  latestEntryId: number
  anchorEntryIds: number[]
  reconstructionAnchorEntryId?: number | null
  included: DeepChatTapeViewEntryRef[]
  excluded: DeepChatTapeViewExcludedRef[]
  excludedRanges?: DeepChatTapeViewExcludedRange[]
  tokenBudget: DeepChatTapeViewTokenBudget
  hashes: DeepChatTapeViewHashes
  meta: DeepChatTapeViewMeta
  assembledAt: number
}

export interface DeepChatTapeViewManifestLegacy extends DeepChatTapeViewManifestBase {
  schemaVersion: 1 | 2 | 3 | 4
  hashVersion: number
  executionContract?: never
}

export interface DeepChatTapeViewManifestV5 extends DeepChatTapeViewManifestBase {
  schemaVersion: 5
  hashVersion: 3
  executionContract: DeepChatExecutionContract
}

export type DeepChatTapeSkillActivationScope = 'message' | 'session' | 'runtime_view'
export type DeepChatTapeSkillDeduplicationSource = 'session' | 'message' | 'runtime_view'

export interface DeepChatTapeSkillMaterializationRef {
  kind: 'materialization'
  entryId: number
  tapeIncarnationId: string
  agentId: string
  sourceType: SkillSourceType
  sourceId: string
  skillName: string
  effectiveContentHash: string
}

export interface DeepChatTapeSkillToolResultRef {
  kind: 'tool_result'
  entryId: number
  contentHash: string
}

interface DeepChatTapeSkillContextBase {
  agentId: string
  sourceType: SkillSourceType
  sourceId: string
  skillName: string
  sourceEntryIds: number[]
  projectedContentHash: string
  projectionVersion: number
  deduplicationSource: DeepChatTapeSkillDeduplicationSource
}

export interface DeepChatTapeMaterializedSkillContext extends DeepChatTapeSkillContextBase {
  activationScope: 'message' | 'session'
  authoritativeRef: DeepChatTapeSkillMaterializationRef
  providerRole: 'user' | 'system'
}

export interface DeepChatTapeRuntimeViewSkillContext extends DeepChatTapeSkillContextBase {
  activationScope: 'runtime_view'
  authoritativeRef: DeepChatTapeSkillToolResultRef
  providerRole: 'tool'
}

export interface DeepChatTapeRuntimeViewSkillContextV7 extends DeepChatTapeRuntimeViewSkillContext {
  executionRef: DeepChatTapeSkillMaterializationRef
}

export type DeepChatTapeSkillContext =
  | DeepChatTapeMaterializedSkillContext
  | DeepChatTapeRuntimeViewSkillContext

export type DeepChatTapeSkillContextV7 =
  | DeepChatTapeMaterializedSkillContext
  | DeepChatTapeRuntimeViewSkillContextV7

export interface DeepChatTapeViewManifestV6 extends DeepChatTapeViewManifestBase {
  schemaVersion: 6
  hashVersion: 4
  runId: string
  tapeIncarnationId: string
  skillContexts: DeepChatTapeSkillContext[]
  executionContract?: DeepChatExecutionContract
}

export interface DeepChatTapeViewManifestV7 extends DeepChatTapeViewManifestBase {
  schemaVersion: 7
  hashVersion: 5
  runId: string
  tapeIncarnationId: string
  skillContexts: DeepChatTapeSkillContextV7[]
  executionContract?: DeepChatExecutionContract
}

export type DeepChatTapeViewManifest =
  | DeepChatTapeViewManifestLegacy
  | DeepChatTapeViewManifestV5
  | DeepChatTapeViewManifestV6
  | DeepChatTapeViewManifestV7

export type DeepChatTapeViewManifestIntegrity = 'valid' | 'invalid' | 'unverified'

export interface DeepChatTapeViewManifestRecord {
  sessionId: string
  messageId: string
  requestSeq: number
  entryId: number
  createdAt: number
  manifest: DeepChatTapeViewManifest
  integrity?: DeepChatTapeViewManifestIntegrity
}
