import type { AgentManager } from '@/agent/manager/agentManager'
import type { IConfigPresenter } from '@shared/presenter'

export async function resolveAssistantModelSelection(
  dependencies: {
    agentManager: Pick<AgentManager, 'resolveBackend'>
    configPresenter: Pick<IConfigPresenter, 'resolveDeepChatAgentConfig'>
  },
  agentId: string,
  fallbackProviderId: string,
  fallbackModelId: string
): Promise<{ providerId: string; modelId: string }> {
  const fallback = { providerId: fallbackProviderId, modelId: fallbackModelId }
  let isDeepChatAgent: boolean
  try {
    isDeepChatAgent = dependencies.agentManager.resolveBackend(agentId).kind === 'deepchat'
  } catch {
    return fallback
  }

  if (isDeepChatAgent) {
    const config =
      typeof dependencies.configPresenter.resolveDeepChatAgentConfig === 'function'
        ? await dependencies.configPresenter.resolveDeepChatAgentConfig(agentId)
        : null
    const providerId = config?.assistantModel?.providerId?.trim()
    const modelId = config?.assistantModel?.modelId?.trim()
    if (providerId && modelId) {
      return { providerId, modelId }
    }
  }

  return fallback
}
