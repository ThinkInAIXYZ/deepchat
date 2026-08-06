import type { AgentType } from '@shared/types/agent-interface'
import type { OrchestrationCapability } from '@shared/orchestration/policy'
import type { AgentSettingsPort } from '@/agent/settings'
import type { AgentToolSessionPort } from '@/tool/runtimePorts'

export interface OrchestrationCapabilityResolverOptions {
  sessions: Pick<AgentToolSessionPort, 'resolveConversationSessionInfo'>
  agents: Pick<AgentSettingsPort, 'getAgentType' | 'resolveDeepChatAgentConfig'>
}

export class OrchestrationCapabilityResolver {
  constructor(private readonly options: OrchestrationCapabilityResolverOptions) {}

  async resolveSession(sessionId: string): Promise<OrchestrationCapability> {
    const session = await this.options.sessions.resolveConversationSessionInfo(sessionId)
    if (!session) {
      return { available: false, reason: 'session_unavailable' }
    }
    if (session.agentType !== 'deepchat') {
      return { available: false, reason: 'deepchat_agent_required' }
    }
    if (session.sessionKind !== 'regular') {
      return { available: false, reason: 'regular_parent_required' }
    }

    return await this.resolveAgent(session.agentId)
  }

  async resolveDraft(agentId: string): Promise<OrchestrationCapability> {
    let agentType: AgentType | null
    try {
      agentType = await this.options.agents.getAgentType(agentId)
    } catch {
      return { available: false, reason: 'agent_policy_unavailable' }
    }
    if (!agentType) {
      return { available: false, reason: 'agent_unavailable' }
    }
    if (agentType !== 'deepchat') {
      return { available: false, reason: 'deepchat_agent_required' }
    }

    return await this.resolveAgent(agentId)
  }

  private async resolveAgent(agentId: string): Promise<OrchestrationCapability> {
    try {
      const config = await this.options.agents.resolveDeepChatAgentConfig(agentId)
      return config.subagentEnabled === true
        ? { available: true }
        : { available: false, reason: 'subagents_disabled' }
    } catch {
      return { available: false, reason: 'agent_policy_unavailable' }
    }
  }
}
