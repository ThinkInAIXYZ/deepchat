import type { ChatMessageRecord, SendMessageInput } from '@shared/types/agent-interface'
import type { DeepChatMessageStore } from './messageStore'
import {
  buildContextWithMetadata,
  buildResumeContextWithMetadata,
  type ContextBuildOptions,
  type ContextBuildResult
} from './contextBuilder'

export const LEGACY_TAPE_VIEW_POLICY_ID = 'legacy_context_v1' as const
export const LEGACY_TAPE_VIEW_POLICY_VERSION = 1 as const
export const DEFAULT_TAPE_VIEW_POLICY_ID = LEGACY_TAPE_VIEW_POLICY_ID

export type TapeViewPolicyId = typeof LEGACY_TAPE_VIEW_POLICY_ID
export type TapeViewPolicySelectionReason =
  | 'default'
  | 'requested'
  | 'fallback_default'
  | 'injected'

export interface TapeChatViewPolicyInput {
  sessionId: string
  newUserContent: string | SendMessageInput
  systemPrompt: string
  contextLength: number
  reserveTokens: number
  messageStore: DeepChatMessageStore
  supportsVision: boolean
  historyRecords: ChatMessageRecord[]
  options?: Omit<ContextBuildOptions, 'historyRecords'>
}

export interface TapeResumeViewPolicyInput {
  sessionId: string
  assistantMessageId: string
  systemPrompt: string
  contextLength: number
  reserveTokens: number
  messageStore: DeepChatMessageStore
  supportsVision: boolean
  historyRecords: ChatMessageRecord[]
  options?: Omit<ContextBuildOptions, 'historyRecords'>
}

export interface TapeViewPolicy {
  id: TapeViewPolicyId
  version: typeof LEGACY_TAPE_VIEW_POLICY_VERSION
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

const BUILTIN_TAPE_VIEW_POLICIES: Record<TapeViewPolicyId, TapeViewPolicy> = {
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
