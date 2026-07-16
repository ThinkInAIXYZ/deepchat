import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ChatMessageRecord } from '@shared/types/agent-interface'
import { isContextHistoryRecord, type ContextBuildMetadata } from './contextBuilder'
import {
  resolveTapeViewPolicy,
  type TapeChatViewPolicyInput,
  type TapeResumeViewPolicyInput,
  type TapeViewPolicy,
  type TapeViewPolicyId,
  type TapeViewPolicySelection,
  type TapeViewPolicySelectionReason
} from './tapeViewPolicy'

export const TAPE_VIEW_ASSEMBLER_VERSION = 'tape-view-assembler-v1' as const
export const TAPE_VIEW_HISTORY_SOURCE = 'tape_effective_view' as const

export interface TapeViewAssemblerResult {
  messages: ChatMessage[]
  metadata: ContextBuildMetadata
  assemblerVersion: typeof TAPE_VIEW_ASSEMBLER_VERSION
  historySource: typeof TAPE_VIEW_HISTORY_SOURCE
  historyRecords: ChatMessageRecord[]
  policyId: TapeViewPolicyId
  policyVersion: TapeViewPolicy['version']
  policySelectionReason: TapeViewPolicySelectionReason
}

export interface TapeChatViewAssemblerInput extends TapeChatViewPolicyInput {
  policy?: TapeViewPolicy
  requestedPolicyId?: string | null
}

export interface TapeResumeViewAssemblerInput extends TapeResumeViewPolicyInput {
  policy?: TapeViewPolicy
  requestedPolicyId?: string | null
}

export function getTapeContextHistoryRecords(records: ChatMessageRecord[]): ChatMessageRecord[] {
  return records.filter(isContextHistoryRecord)
}

function withAssemblerMetadata(
  result: { messages: ChatMessage[]; metadata: ContextBuildMetadata },
  historyRecords: ChatMessageRecord[],
  selection: TapeViewPolicySelection
): TapeViewAssemblerResult {
  return {
    ...result,
    assemblerVersion: TAPE_VIEW_ASSEMBLER_VERSION,
    historySource: TAPE_VIEW_HISTORY_SOURCE,
    historyRecords,
    policyId: selection.policy.id,
    policyVersion: selection.policy.version,
    policySelectionReason: selection.reason
  }
}

function resolveAssemblerPolicy(input: {
  policy?: TapeViewPolicy
  requestedPolicyId?: string | null
}): TapeViewPolicySelection {
  if (input.policy) {
    return {
      policy: input.policy,
      requestedPolicyId: input.requestedPolicyId ?? null,
      reason: 'injected'
    }
  }

  return resolveTapeViewPolicy({ requestedPolicyId: input.requestedPolicyId })
}

export function buildTapeChatView(input: TapeChatViewAssemblerInput): TapeViewAssemblerResult {
  const selection = resolveAssemblerPolicy(input)
  const result = selection.policy.buildChat(input)

  return withAssemblerMetadata(result, input.historyRecords, selection)
}

export function buildTapeResumeView(input: TapeResumeViewAssemblerInput): TapeViewAssemblerResult {
  const selection = resolveAssemblerPolicy(input)
  const result = selection.policy.buildResume(input)

  return withAssemblerMetadata(result, input.historyRecords, selection)
}
