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
import { normalizeToolResultContent } from './toolAdapters'
import { reviewAutoApproveToolPermission } from './toolPermissionReviewer'
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

export interface ToolRuntimeBindingDependencies {
  providerSettings: ProviderModelResolutionPort
  agentSettings: Pick<
    AgentSettingsPort,
    'resolveDeepChatAgentConfig' | 'agentSupportsCapability'
  >
  providerRuntime: Pick<
    ProviderExecutionPort,
    'executeWithRateLimit' | 'generateCompletionStandalone'
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
