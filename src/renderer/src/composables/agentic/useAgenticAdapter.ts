/**
 * useAgenticAdapter - Unified Message Execution & Agent Discovery
 *
 * Provides a unified interface for:
 * - Message execution (send, continue, cancel, retry, regenerate)
 * - Agent discovery (list registered agents)
 *
 * Replaces useChatAdapter and useExecutionAdapter with agent-agnostic interface.
 *
 * @example
 * ```ts
 * const adapter = useAgenticAdapter()
 *
 * // Send a message
 * await adapter.sendMessage(sessionId, { text: 'Hello' })
 *
 * // Get registered agents
 * const agents = adapter.getRegisteredAgents()
 * ```
 */

import { usePresenter } from '@/composables/usePresenter'
import type { MessageContent, SessionConfig } from '@shared/types/presenters/agentic.presenter.d'

export interface AgentInfo {
  agentId: string
  name: string
  description?: string
}

/**
 * Session-related operations that a component can perform
 */
export interface AgenticAdapter {
  // === Agent Discovery ===

  /**
   * Get all registered agents
   * @returns Array of agent info objects
   */
  getRegisteredAgents(): AgentInfo[]

  // === Session Lifecycle ===

  /**
   * Create a new session for the specified agent
   * @param agentId - The agent ID to create a session for
   * @param config - Session configuration
   * @returns The created session ID
   */
  createSession(agentId: string, config: SessionConfig): Promise<string>

  /**
   * Get session information
   * @param sessionId - The session ID
   * @returns Session information or null if not found
   */
  getSession(
    sessionId: string
  ): Promise<
    ReturnType<typeof import('./useAgenticSession').useAgenticSession>['sessionInfo']['value']
  >

  /**
   * Load an existing session
   * @param sessionId - The session ID to load
   * @param context - Load context (activate, maxHistory, includeSystemMessages)
   */
  loadSession(
    sessionId: string,
    context: { activate: boolean; maxHistory?: number; includeSystemMessages?: boolean }
  ): Promise<void>

  /**
   * Close a session
   * @param sessionId - The session ID to close
   */
  closeSession(sessionId: string): Promise<void>

  // === Message Execution ===

  /**
   * Send a message to the agent
   * @param sessionId - The session ID
   * @param content - Message content (text, images, files)
   * @param selectedVariants - Optional variant selection
   */
  sendMessage(
    sessionId: string,
    content: MessageContent,
    selectedVariants?: Record<string, string>
  ): Promise<void>

  /**
   * Continue agent loop from a message
   * @param sessionId - The session ID
   * @param messageId - The message ID to continue from
   * @param selectedVariants - Optional variant selection
   */
  continueLoop(
    sessionId: string,
    messageId: string,
    selectedVariants?: Record<string, string>
  ): Promise<void>

  /**
   * Cancel ongoing generation
   * @param sessionId - The session ID
   * @param messageId - The message ID to cancel
   */
  cancelLoop(sessionId: string, messageId: string): Promise<void>

  /**
   * Retry a failed message
   * @param sessionId - The session ID
   * @param messageId - The message ID to retry
   * @param selectedVariants - Optional variant selection
   */
  retryMessage(
    sessionId: string,
    messageId: string,
    selectedVariants?: Record<string, string>
  ): Promise<void>

  /**
   * Regenerate from user message
   * @param sessionId - The session ID
   * @param userMessageId - The user message ID to regenerate from
   * @param selectedVariants - Optional variant selection
   */
  regenerateFromUserMessage(
    sessionId: string,
    userMessageId: string,
    selectedVariants?: Record<string, string>
  ): Promise<void>

  // === Session Configuration ===

  /**
   * Set the model for a session
   * @param sessionId - The session ID
   * @param modelId - The model ID to set
   */
  setModel(sessionId: string, modelId: string): Promise<void>

  /**
   * Set the mode for a session
   * @param sessionId - The session ID
   * @param modeId - The mode ID to set
   */
  setMode(sessionId: string, modeId: string): Promise<void>
}

/**
 * Implementation of AgenticAdapter
 */
class AgenticAdapterImpl implements AgenticAdapter {
  private agenticP = usePresenter('agenticPresenter')
  private agentP = usePresenter('agentPresenter')

  getRegisteredAgents(): AgentInfo[] {
    // TODO: Implement agent discovery via AgenticPresenter
    // For now, return a placeholder implementation
    // This will be implemented when AgenticPresenter.getRegisteredAgents() is available
    return []
  }

  async createSession(agentId: string, config: SessionConfig): Promise<string> {
    return await this.agenticP.createSession(agentId, config)
  }

  async getSession(sessionId: string) {
    return await this.agenticP.getSession(sessionId)
  }

  async loadSession(
    sessionId: string,
    context: { activate: boolean; maxHistory?: number; includeSystemMessages?: boolean }
  ): Promise<void> {
    return await this.agenticP.loadSession(sessionId, context)
  }

  async closeSession(sessionId: string): Promise<void> {
    return await this.agenticP.closeSession(sessionId)
  }

  async sendMessage(
    sessionId: string,
    content: MessageContent,
    selectedVariants?: Record<string, string>
  ): Promise<void> {
    // Note: The current AgenticPresenter.sendMessage interface differs slightly
    // This bridges the new interface to the existing one
    // TODO: Update AgenticPresenter to support selectedVariants in sendMessage
    if (content.text) {
      await this.agentP.sendMessage(sessionId, content.text, undefined, selectedVariants)
    }
  }

  async continueLoop(
    _sessionId: string,
    messageId: string,
    selectedVariants?: Record<string, string>
  ): Promise<void> {
    await this.agentP.continueLoop(_sessionId, messageId, selectedVariants)
  }

  async cancelLoop(_sessionId: string, messageId: string): Promise<void> {
    await this.agentP.cancelLoop(messageId)
  }

  async retryMessage(
    _sessionId: string,
    messageId: string,
    selectedVariants?: Record<string, string>
  ): Promise<void> {
    await this.agentP.retryMessage(messageId, selectedVariants)
  }

  async regenerateFromUserMessage(
    sessionId: string,
    userMessageId: string,
    selectedVariants?: Record<string, string>
  ): Promise<void> {
    await this.agentP.regenerateFromUserMessage(sessionId, userMessageId, selectedVariants)
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    return await this.agenticP.setModel(sessionId, modelId)
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    return await this.agenticP.setMode(sessionId, modeId)
  }
}

let adapterInstance: AgenticAdapterImpl | null = null

export function useAgenticAdapter(): AgenticAdapter {
  if (!adapterInstance) {
    adapterInstance = new AgenticAdapterImpl()
  }
  return adapterInstance
}

export type UseAgenticAdapterReturn = ReturnType<typeof useAgenticAdapter>
