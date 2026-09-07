import type { AgentManager } from '@/agent/manager/agentManager'
import type { AgentSettingsPort } from '@/agent/settings'

export async function resolveAssistantModelSelection(
  dependencies: {
    agentManager: Pick<AgentManager, 'resolveBackend'>
    agentSettings: Pick<AgentSettingsPort, 'resolveDeepChatAgentConfig'>
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
    const config = await dependencies.agentSettings.resolveDeepChatAgentConfig(agentId)
    const providerId = config?.assistantModel?.providerId?.trim()
    const modelId = config?.assistantModel?.modelId?.trim()
    if (providerId && modelId) {
      return { providerId, modelId }
    }
  }

  return fallback
}
