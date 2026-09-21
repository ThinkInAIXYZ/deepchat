import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ProviderExecutionPort } from '@shared/types/provider'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { AgentSettingsPort } from '@/agent/settings'
import type { ProviderModelResolutionPort } from '@/provider/settings'
import type { SessionScopeRegistry } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { ToolResultPort } from '@/agent/deepchat/loop/ports'
import type { SessionSettingsStore } from '@/session/data/settings'
import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import type { SessionIdentityService } from './sessionIdentityService'
import logger from '@shared/logger'
import { normalizeToolResultContent } from './toolAdapters'
import { reviewAutoApproveToolPermission } from './toolPermissionReviewer'
import { pruneClosedToolResultsForContext } from './jevToolResultPruning'
import type { ToolPermissionReviewRequest, ToolPermissionReviewResult } from './types'

export type ToolPermissionReviewer = (
  request: ToolPermissionReviewRequest,
  context: {
    providerId: string
    modelId: string
    messages: ChatMessage[]
    signal: AbortSignal
  }
) => Promise<ToolPermissionReviewResult>

export type ClosedToolResultPruner = (input: {
  sessionId: string
  messages: ChatMessage[]
  protectedToolCallIds: ReadonlySet<string>
  signal: AbortSignal
}) => Promise<ChatMessage[]>

export interface ToolRuntimeBindingDependencies {
  providerSettings: ProviderModelResolutionPort
  agentSettings: Pick<
    AgentSettingsPort,
    'resolveDeepChatAgentConfig' | 'agentSupportsCapability'
  >
  providerRuntime: Pick<
    ProviderExecutionPort,
    'executeWithRateLimit' | 'generateCompletionStandalone' | 'runJudgment'
  >
  registry: SessionScopeRegistry
  sessionStore: Pick<SessionSettingsStore, 'get'>
  identity: Pick<SessionIdentityService, 'getAgentId'>
  runLifecycle: Pick<RunLifecycleCoordinator, 'getAbortSignal'>
}

export function createToolResultNormalizer(
  deps: ToolRuntimeBindingDependencies
): ToolResultPort['normalize'] {
  return async (tool) =>
    await normalizeToolResultContent(
      {
        providerSettings: deps.providerSettings,
        agentSettings: deps.agentSettings,
        providerRuntime: deps.providerRuntime,
        getAbortSignal: (sessionId) => deps.runLifecycle.getAbortSignal(sessionId),
        getSessionModel: (sessionId) => {
          const state = deps.registry.getHydratedScope(toAppSessionId(sessionId))?.state()
          const persisted = deps.sessionStore.get(sessionId)
          return {
            providerId: state?.providerId ?? persisted?.provider_id,
            modelId: state?.modelId ?? persisted?.model_id,
            agentId: deps.identity.getAgentId(sessionId)
          }
        }
      },
      {
        sessionId: tool.sessionId,
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        toolArgs: tool.toolArgs,
        content: tool.content,
        isError: tool.isError,
        ownerPluginId: tool.ownerPluginId,
        abortSignal: tool.signal
      }
    )
}

export function createToolPermissionReviewer(
  deps: ToolRuntimeBindingDependencies
): ToolPermissionReviewer {
  return async (request, context) =>
    await reviewAutoApproveToolPermission(
      {
        providerSettings: deps.providerSettings,
        agentSettings: deps.agentSettings,
        providerRuntime: deps.providerRuntime,
        getSessionAgentId: (sessionId) => deps.identity.getAgentId(sessionId)
      },
      request,
      context
    )
}

/**
 * Jev-judged pruning of closed tool results, as a port the context coordinator can call.
 *
 * Returns the messages unchanged whenever the feature is not configured, the state cannot be fitted,
 * there is too little at stake to justify a request, or the judgment fails. Every one of those paths
 * points away from deleting, because the only way this can do harm is by dropping something the agent
 * still needed — and unlike a failed permission review, that harm is silent: the model does not know
 * what it cannot see.
 *
 * Every decision is logged with its probability and its reduction ratio. That is the falsifier for
 * the assumption the feature runs on: `keepThreshold` is carried over from `fast-jev-compaction` and
 * has never been calibrated against this app's own data, so the prune-then-recall rate is what says
 * whether it is anywhere near right.
 */
export function createClosedToolResultPruner(
  deps: ToolRuntimeBindingDependencies
): ClosedToolResultPruner {
  return async ({ sessionId, messages, protectedToolCallIds, signal }) => {
    const agentId = deps.identity.getAgentId(sessionId) ?? 'deepchat'
    const config = await deps.agentSettings.resolveDeepChatAgentConfig(agentId)

    // Selecting a judgment model is the switch. Unset means today's behaviour, unchanged. The same
    // field drives permission review, but only in `auto` permission mode; pruning has no such
    // precondition, which is why it activates on configuration alone.
    const providerId = config.judgmentModel?.providerId?.trim()
    const modelId = config.judgmentModel?.modelId?.trim()
    if (!providerId || !modelId) return messages

    const outcome = await pruneClosedToolResultsForContext({
      messages,
      protectedToolCallIds,
      ask: async ({ state, questions }) => {
        await deps.providerRuntime.executeWithRateLimit(providerId, { signal })
        const result = await deps.providerRuntime.runJudgment(
          providerId,
          modelId,
          { state, questions },
          { signal }
        )
        return result.answers
      }
    })

    if (!outcome.attempted) {
      logger.info('[DeepChatAgent] tool result pruning skipped:', {
        sessionId,
        skipReason: outcome.skipReason
      })
      return outcome.messages
    }

    logger.info('[DeepChatAgent] tool result pruning decision:', {
      sessionId,
      shape: outcome.shape,
      stateTokens: outcome.stateTokens,
      reductionRatio: outcome.reductionRatio,
      kept: outcome.decisions.filter((decision) => decision.kept).length,
      pruned: outcome.decisions.filter((decision) => !decision.kept).length,
      freedChars: outcome.decisions.reduce(
        (total, decision) => (decision.kept ? total : total + decision.originalChars),
        0
      ),
      // Per-result detail, so a wrong judgment can be traced to the result it was made about rather
      // than only counted. This is also the input to the prune-then-recall rate.
      decisions: outcome.decisions.map((decision) => ({
        toolCallId: decision.toolCallId,
        toolName: decision.toolName,
        keepProbability: decision.keepProbability,
        kept: decision.kept,
        originalChars: decision.originalChars
      }))
    })

    return outcome.messages
  }
}
