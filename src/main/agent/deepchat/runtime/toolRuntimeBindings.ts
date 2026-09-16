import type { ChatMessage } from '@shared/types/core/chat-message'
import type { ProviderExecutionPort } from '@shared/types/provider'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'

import type { SessionScopeRegistry } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import type { ToolResultPort } from '@/agent/deepchat/loop/ports'

import type { RunLifecycleCoordinator } from './runLifecycleCoordinator'
import type { SessionIdentityService } from './sessionIdentityService'
import { normalizeToolResultContent } from './toolAdapters'
import { reviewAutoApproveToolPermission } from './toolPermissionReviewer'
import type { ToolPermissionReviewRequest, ToolPermissionReviewResult } from './types'
import {type AgentSettingsPort} from '@/agent/deepchat/contracts/agentSettings'
import {type ProviderModelResolutionPort} from '@/agent/deepchat/contracts/providerModelResolution'
import {type SessionSettingsStorePort} from '@/agent/deepchat/contracts/sessionSettingsStore'
import type { VisionTargetResolverPort } from '@/agent/deepchat/contracts/visionTarget'

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
  visionTargetResolver: VisionTargetResolverPort
  agentSettings: Pick<
    AgentSettingsPort,
    'resolveDeepChatAgentConfig' | 'agentSupportsCapability'
  >
  providerRuntime: Pick<
    ProviderExecutionPort,
    'executeWithRateLimit' | 'generateCompletionStandalone'
  >
  registry: SessionScopeRegistry
  sessionStore: Pick<SessionSettingsStorePort, 'get'>
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
        visionTargetResolver: deps.visionTargetResolver,
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
