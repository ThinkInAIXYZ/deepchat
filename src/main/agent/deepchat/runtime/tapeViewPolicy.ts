import type { ChatMessageRecord, SendMessageInput } from '@shared/types/agent-interface'
import type { SessionTranscript } from '@/session/data/transcript'
import type { DeepChatTapeViewContextBuilderVersion } from '@shared/types/tape-view-manifest'
import {
  buildCacheAwareContextWithMetadata,
  buildCacheAwareResumeContextWithMetadata,
  buildContextWithMetadata,
  buildResumeContextWithMetadata,
  type ContextBuildOptions,
  type ContextBuildResult
} from './contextBuilder'
import {
  createEmptyContextRuntimeContributions,
  type ContextRuntimeContributions
} from './contextContributions'

export const CACHE_AWARE_TAPE_VIEW_POLICY_V1_ID = 'cache_aware_context_v1' as const
export const CACHE_AWARE_TAPE_VIEW_POLICY_V2_ID = 'cache_aware_context_v2' as const
export const CACHE_AWARE_TAPE_VIEW_POLICY_ID = CACHE_AWARE_TAPE_VIEW_POLICY_V2_ID
export const CACHE_AWARE_TAPE_VIEW_POLICY_VERSION = 1 as const
export const LEGACY_TAPE_VIEW_POLICY_ID = 'legacy_context_v1' as const
export const LEGACY_TAPE_VIEW_POLICY_VERSION = 1 as const
export const DEFAULT_TAPE_VIEW_POLICY_ID = CACHE_AWARE_TAPE_VIEW_POLICY_ID

export type TapeViewPolicyId =
  | typeof CACHE_AWARE_TAPE_VIEW_POLICY_V2_ID
  | typeof CACHE_AWARE_TAPE_VIEW_POLICY_V1_ID
  | typeof LEGACY_TAPE_VIEW_POLICY_ID
export type TapeViewPolicySelectionReason =
  | 'default'
  | 'requested'
  | 'fallback_default'
  | 'injected'

export interface TapeChatViewPolicyInput {
  sessionId: string
  newUserContent: SendMessageInput
  systemPrompt: string
  contextLength: number
  reserveTokens: number
  messageStore: SessionTranscript
  supportsVision: boolean
  historyRecords: ChatMessageRecord[]
  contextContributions?: ContextRuntimeContributions
  options?: Omit<ContextBuildOptions, 'historyRecords'>
}

export interface TapeResumeViewPolicyInput {
  sessionId: string
  assistantMessageId: string
  systemPrompt: string
  contextLength: number
  reserveTokens: number
  messageStore: SessionTranscript
  supportsVision: boolean
  historyRecords: ChatMessageRecord[]
  contextContributions?: ContextRuntimeContributions
  options?: Omit<ContextBuildOptions, 'historyRecords'>
}

export interface TapeViewPolicy {
  id: TapeViewPolicyId
  version: 1
  contextBuilderVersion: DeepChatTapeViewContextBuilderVersion
  buildChat(input: TapeChatViewPolicyInput): ContextBuildResult
  buildResume(input: TapeResumeViewPolicyInput): ContextBuildResult
}

export interface TapeViewPolicySelectionInput {
  requestedPolicyId?: string | null
}

export interface TapeViewPolicySelection {
  policy: TapeViewPolicy
  requestedPolicyId: string | null
  reason: TapeViewPolicySelectionReason
}

export const legacyTapeViewPolicy: TapeViewPolicy = {
  id: LEGACY_TAPE_VIEW_POLICY_ID,
  version: LEGACY_TAPE_VIEW_POLICY_VERSION,
  contextBuilderVersion: 'legacy-v1',
  buildChat(input) {
    return buildContextWithMetadata(
      input.sessionId,
      input.newUserContent,
      input.systemPrompt,
      input.contextLength,
      input.reserveTokens,
      input.messageStore,
      input.supportsVision,
      {
        ...input.options,
        historyRecords: input.historyRecords
      }
    )
  },
  buildResume(input) {
    return buildResumeContextWithMetadata(
      input.sessionId,
      input.assistantMessageId,
      input.systemPrompt,
      input.contextLength,
      input.reserveTokens,
      input.messageStore,
      input.supportsVision,
      {
        ...input.options,
        historyRecords: input.historyRecords
      }
    )
  }
}

export const cacheAwareTapeViewPolicyV1: TapeViewPolicy = {
  id: CACHE_AWARE_TAPE_VIEW_POLICY_V1_ID,
  version: CACHE_AWARE_TAPE_VIEW_POLICY_VERSION,
  contextBuilderVersion: 'cache-aware-v1',
  buildChat(input) {
    return buildCacheAwareContextWithMetadata(
      input.sessionId,
      input.newUserContent,
      input.systemPrompt,
      input.contextLength,
      input.reserveTokens,
      input.messageStore,
      input.supportsVision,
      {
        ...input.options,
        historyRecords: input.historyRecords,
        pinFirstUser: false,
        contextContributions:
          input.contextContributions ?? createEmptyContextRuntimeContributions()
      }
    )
  },
  buildResume(input) {
    return buildCacheAwareResumeContextWithMetadata(
      input.sessionId,
      input.assistantMessageId,
      input.systemPrompt,
      input.contextLength,
      input.reserveTokens,
      input.messageStore,
      input.supportsVision,
      {
        ...input.options,
        historyRecords: input.historyRecords,
        pinFirstUser: false,
        contextContributions:
          input.contextContributions ?? createEmptyContextRuntimeContributions()
      }
    )
  }
}

export const cacheAwareTapeViewPolicyV2: TapeViewPolicy = {
  id: CACHE_AWARE_TAPE_VIEW_POLICY_V2_ID,
  version: CACHE_AWARE_TAPE_VIEW_POLICY_VERSION,
  contextBuilderVersion: 'cache-aware-v2',
  buildChat(input) {
    return buildCacheAwareContextWithMetadata(
      input.sessionId,
      input.newUserContent,
      input.systemPrompt,
      input.contextLength,
      input.reserveTokens,
      input.messageStore,
      input.supportsVision,
      {
        ...input.options,
        historyRecords: input.historyRecords,
        pinFirstUser: true,
        contextContributions:
          input.contextContributions ?? createEmptyContextRuntimeContributions()
      }
    )
  },
  buildResume(input) {
    return buildCacheAwareResumeContextWithMetadata(
      input.sessionId,
      input.assistantMessageId,
      input.systemPrompt,
      input.contextLength,
      input.reserveTokens,
      input.messageStore,
      input.supportsVision,
      {
        ...input.options,
        historyRecords: input.historyRecords,
        pinFirstUser: true,
        contextContributions:
          input.contextContributions ?? createEmptyContextRuntimeContributions()
      }
    )
  }
}

export const cacheAwareTapeViewPolicy = cacheAwareTapeViewPolicyV2

const BUILTIN_TAPE_VIEW_POLICIES: Record<TapeViewPolicyId, TapeViewPolicy> = {
  [CACHE_AWARE_TAPE_VIEW_POLICY_V2_ID]: cacheAwareTapeViewPolicyV2,
  [CACHE_AWARE_TAPE_VIEW_POLICY_V1_ID]: cacheAwareTapeViewPolicyV1,
  [LEGACY_TAPE_VIEW_POLICY_ID]: legacyTapeViewPolicy
}

export function listTapeViewPolicies(): TapeViewPolicy[] {
  return Object.values(BUILTIN_TAPE_VIEW_POLICIES)
}

export function getTapeViewPolicy(policyId: string | null | undefined): TapeViewPolicy | null {
  if (!policyId) {
    return null
  }

  const normalizedPolicyId = policyId.trim()
  if (!normalizedPolicyId) {
    return null
  }

  return BUILTIN_TAPE_VIEW_POLICIES[normalizedPolicyId as TapeViewPolicyId] ?? null
}

export function resolveTapeViewPolicy(
  input: TapeViewPolicySelectionInput = {}
): TapeViewPolicySelection {
  const requestedPolicyId =
    typeof input.requestedPolicyId === 'string' && input.requestedPolicyId.trim()
      ? input.requestedPolicyId.trim()
      : null

  if (requestedPolicyId) {
    const requestedPolicy = getTapeViewPolicy(requestedPolicyId)
    if (requestedPolicy) {
      return {
        policy: requestedPolicy,
        requestedPolicyId,
        reason: 'requested'
      }
    }

    return {
      policy: BUILTIN_TAPE_VIEW_POLICIES[DEFAULT_TAPE_VIEW_POLICY_ID],
      requestedPolicyId,
      reason: 'fallback_default'
    }
  }

  return {
    policy: BUILTIN_TAPE_VIEW_POLICIES[DEFAULT_TAPE_VIEW_POLICY_ID],
    requestedPolicyId: null,
    reason: 'default'
  }
}
