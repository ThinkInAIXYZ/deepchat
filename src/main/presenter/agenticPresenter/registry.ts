/**
 * Agentic Presenter - Agent Registry
 * Manages agent_id → Presenter mapping with prefix matching support
 */

import type { IAgentPresenter } from './types.js'

/**
 * Agent Registry
 * Maintains the mapping of agent_id to presenter instances
 * Supports exact match and prefix matching (e.g., 'acp.*')
 */
export class AgentRegistry {
  private agents = new Map<string, IAgentPresenter>()

  /**
   * Register an agent presenter
   * @param presenter - The agent presenter to register
   */
  register(presenter: IAgentPresenter): void {
    this.agents.set(presenter.agentId, presenter)
  }

  /**
   * Get presenter by exact agent_id match
   * @param agentId - The agent ID to look up
   * @returns The presenter or undefined if not found
   */
  get(agentId: string): IAgentPresenter | undefined {
    return this.agents.get(agentId)
  }

  /**
   * Get presenter by agent_id with prefix matching
   * Supports wildcard patterns like 'acp.*' for prefix matching
   * @param agentId - The agent ID to look up
   * @returns The presenter or undefined if not found
   */
  getByPrefix(agentId: string): IAgentPresenter | undefined {
    // Try exact match first
    const exactMatch = this.agents.get(agentId)
    if (exactMatch) {
      return exactMatch
    }

    // Try prefix match for wildcards (e.g., 'acp.*' matches 'acp.anthropic.claude')
    for (const [registeredId, presenter] of this.agents) {
      if (registeredId.endsWith('*')) {
        const prefix = registeredId.slice(0, -1)
        if (agentId.startsWith(prefix)) {
          return presenter
        }
      }
    }

    return undefined
  }

  /**
   * Check if an agent is registered
   * @param agentId - The agent ID to check
   * @returns True if the agent is registered
   */
  has(agentId: string): boolean {
    return this.get(agentId) !== undefined || this.getByPrefix(agentId) !== undefined
  }

  /**
   * Get all registered agent IDs
   * @returns Array of registered agent IDs
   */
  getRegisteredIds(): string[] {
    return Array.from(this.agents.keys())
  }

  /**
   * Clear all registered agents
   * Useful for testing
   */
  clear(): void {
    this.agents.clear()
  }
}
