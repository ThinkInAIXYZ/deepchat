export type DeepChatTapeViewTaskType = 'chat' | 'resume' | 'tool_loop'

export type DeepChatTapeViewPolicy =
  | 'legacy_context_v1'
  | 'legacy_context_shadow'
  | 'resume_shadow'
  | 'tool_loop_shadow'
  | 'context_pressure_recovery_shadow'

export type DeepChatTapeViewEntryRole = 'system' | 'user' | 'assistant' | 'tool' | null

export type DeepChatTapeViewEntrySource = 'tape' | 'synthetic'

export type DeepChatTapeViewEntryReason =
  | 'system_prompt'
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

export interface DeepChatTapeViewManifest {
  schemaVersion: 1 | 2
  hashVersion: number
  viewId: string
  sessionId: string
  messageId: string
  requestSeq: number
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion: number | null
  contextBuilderVersion: 'legacy-v1'
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
