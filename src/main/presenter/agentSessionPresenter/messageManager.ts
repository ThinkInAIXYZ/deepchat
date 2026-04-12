import type { ChatMessageRecord } from '@shared/types/agent-interface'
import type { AgentRegistry } from './agentRegistry'
import type { NewSessionManager } from './sessionManager'

export class NewMessageManager {
  private agentRegistry: AgentRegistry
  private sessionManager?: Pick<NewSessionManager, 'get'>

  constructor(agentRegistry: AgentRegistry, sessionManager?: Pick<NewSessionManager, 'get'>) {
    this.agentRegistry = agentRegistry
    this.sessionManager = sessionManager
  }

  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    const agent = this.resolveAgentForSession(sessionId)
    return await agent.getMessages(sessionId)
  }

  async getMessageIds(sessionId: string): Promise<string[]> {
    const agent = this.resolveAgentForSession(sessionId)
    return await agent.getMessageIds(sessionId)
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

  private resolveAgentForSession(sessionId: string) {
    const session = this.sessionManager?.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return this.agentRegistry.resolve(session.agentId)
  }
}
