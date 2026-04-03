import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { AgentRegistry } from './agentRegistry'

export class NewMessageManager {
  private agentRegistry: AgentRegistry

  constructor(agentRegistry: AgentRegistry) {
    this.agentRegistry = agentRegistry
  }

  async getMessage(messageId: string): Promise<ChatMessageRecord | null> {
    // For getMessage, we need to find which agent owns this message.
    // In v0, there's only deepchat, so we resolve directly.
    const agents = this.agentRegistry.getAll()
    for (const agentMeta of agents) {
      const agent = this.agentRegistry.resolve(agentMeta.id)
      const msg = await agent.getMessage(messageId)
      if (msg) return msg
    }
    return null
  }
}
