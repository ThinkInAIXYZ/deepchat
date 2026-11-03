import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type { DeepChatExecutionContract } from '@shared/types/execution-contract'
import type {
  DeepChatTapeViewTaskType,
  DeepChatTapeViewPolicy,
  DeepChatTapeViewTokenBudget,
  DeepChatTapeViewContextBuilderVersion,
  DeepChatTapeViewSyntheticContribution,
  DeepChatTapeViewPinnedFirstUser,
  DeepChatTapeSkillContext
} from '@shared/types/tape-view-manifest'
import {
  buildExcludedRefs,
  buildIncludedRefs,
  buildRequestRefs,
  buildSyntheticContributionRefs,
  createTapeViewManifest,
  type TapeViewContextSelection
} from '../domain/viewManifest'
import type { TapeViewManifestReader } from '../ports/capabilities'

export interface ProviderViewManifestInput {
  sessionId: string
  messageId: string
  requestSeq: number
  taskType: DeepChatTapeViewTaskType
  policy: DeepChatTapeViewPolicy
  policyVersion?: number | null
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  tokenBudget: Omit<DeepChatTapeViewTokenBudget, 'estimatedPromptTokens'>
  providerId: string
  modelId: string
  selection?: TapeViewContextSelection
  summaryCursorOrderSeq: number
  supportsVision: boolean
  supportsAudioInput: boolean
  traceDebugEnabled: boolean
  contextBuilderVersion: DeepChatTapeViewContextBuilderVersion
  syntheticContributions?: DeepChatTapeViewSyntheticContribution[]
  pinnedFirstUser?: DeepChatTapeViewPinnedFirstUser
  executionContract?: DeepChatExecutionContract
  runId?: string
  tapeIncarnationId?: string
  skillContexts?: DeepChatTapeSkillContext[]
  requireDurableManifest?: boolean
}

export function createProviderViewManifest(
  tape: Pick<TapeViewManifestReader, 'getViewManifestSourceMaps'>,
  params: ProviderViewManifestInput
) {
  const sourceMaps = tape.getViewManifestSourceMaps(params.sessionId, params.messageId)
  const selection = params.selection
    ? {
        ...params.selection,
        ...(params.syntheticContributions !== undefined
          ? { syntheticContributions: params.syntheticContributions }
          : {})
      }
    : undefined
  return createTapeViewManifest({
    sessionId: params.sessionId,
    messageId: params.messageId,
    requestSeq: params.requestSeq,
    taskType: params.taskType,
    policy: params.policy,
    policyVersion: params.policyVersion ?? null,
    contextBuilderVersion: params.contextBuilderVersion,
    messages: params.messages,
    tools: params.tools,
    latestEntryId: sourceMaps.latestEntryId,
    anchorEntryIds: sourceMaps.reconstructionAnchorEntryIds,
    reconstructionAnchorEntryId: sourceMaps.reconstructionAnchorEntryId,
    included: selection
      ? buildIncludedRefs(selection, sourceMaps)
      : [
          ...buildRequestRefs(params.messages, sourceMaps, params.pinnedFirstUser),
          ...buildSyntheticContributionRefs(params.syntheticContributions ?? [])
        ],
    excluded: selection ? buildExcludedRefs(selection, sourceMaps) : [],
    summaryCursor: selection?.summaryCursor,
    tokenBudget: params.tokenBudget,
    providerId: params.providerId,
    modelId: params.modelId,
    summaryCursorOrderSeq: params.summaryCursorOrderSeq,
    supportsVision: params.supportsVision,
    supportsAudioInput: params.supportsAudioInput,
    traceDebugEnabled: params.traceDebugEnabled,
    ...(params.executionContract ? { executionContract: params.executionContract } : {}),
    ...(params.runId !== undefined ? { runId: params.runId } : {}),
    ...(params.tapeIncarnationId !== undefined
      ? { tapeIncarnationId: params.tapeIncarnationId }
      : {}),
    ...(params.skillContexts?.length ? { skillContexts: params.skillContexts } : {}),
    ...(params.requireDurableManifest !== undefined
      ? { requireDurableManifest: params.requireDurableManifest }
      : {})
  })
}
