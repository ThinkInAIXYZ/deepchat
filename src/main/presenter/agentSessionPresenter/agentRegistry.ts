import type { IAgentImplementation, Agent } from '@shared/types/agent-interface'

export class AgentRegistry {
  private agents: Map<string, { meta: Agent; impl: IAgentImplementation }> = new Map()

  register(meta: Agent, implementation: IAgentImplementation): void {
    this.agents.set(meta.id, { meta, impl: implementation })
  }

  resolve(agentId: string): IAgentImplementation {
    const entry = this.agents.get(agentId)
    if (!entry) throw new Error(`Agent not found: ${agentId}`)
    return entry.impl
  }

  getAll(): Agent[] {
    return Array.from(this.agents.values()).map((e) => e.meta)
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId)
  }
}
