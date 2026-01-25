/**
 * Agentic Presenter - Unified Entry Point
 * Provides a unified interface for interacting with different agent types (ACP and DeepChat)
 *
 * This is the main entry point for the Agentic Unified Layer.
 * It routes requests to the appropriate presenter based on agent_id.
 */

import { eventBus, SendTarget } from '@/eventbus'
import { AgentRegistry } from './registry.js'
import type {
  IAgentPresenter,
  SessionInfo,
  MessageContent,
  SessionConfig,
  LoadContext
} from './types.js'
import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'

/**
 * Agentic Presenter - Unified Interface for All Agent Types
 *
 * Responsibilities:
 * - Maintain agent_id → Presenter mapping via registry
 * - Route requests to appropriate presenter based on agent_id
 * - Track sessionId → Presenter mapping for direct operations
 * - Emit unified events in AgenticEventType format
 */
export class AgenticPresenter {
  private registry = new AgentRegistry()
  private sessionToPresenter = new Map<string, IAgentPresenter>()

  /**
   * Register an agent presenter
   * Called by each agent presenter during initialization
   * @param presenter - The agent presenter to register
   */
  registerAgent(presenter: IAgentPresenter): void {
    this.registry.register(presenter)
  }

  /**
   * Get presenter for a given agent_id
   * @param agentId - The agent ID to look up
   * @returns The presenter
   * @throws Error if no presenter found for the agent_id
   */
  private getPresenter(agentId: string): IAgentPresenter {
    const presenter = this.registry.getByPrefix(agentId)
    if (!presenter) {
      throw new Error(`No presenter found for agent_id: ${agentId}`)
    }
    return presenter
  }

  /**
   * Get presenter for a given session_id
   * @param sessionId - The session ID to look up
   * @returns The presenter
   * @throws Error if no session found
   */
  private getPresenterBySession(sessionId: string): IAgentPresenter {
    const presenter = this.sessionToPresenter.get(sessionId)
    if (!presenter) {
      throw new Error(`No presenter found for session_id: ${sessionId}`)
    }
    return presenter
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create a new session for the specified agent
   * @param agentId - The agent ID to create a session for
   * @param config - Session configuration
   * @returns The created session ID
   * @throws Error if agent not found or session creation fails
   */
  async createSession(agentId: string, config: SessionConfig): Promise<string> {
    try {
      const presenter = this.getPresenter(agentId)
      const sessionId = await presenter.createSession(config)

      // Track session → presenter mapping
      this.sessionToPresenter.set(sessionId, presenter)

      // Emit SESSION_CREATED event
      eventBus.sendToRenderer(
        'agentic.session.created' as AgenticEventType,
        SendTarget.ALL_WINDOWS,
        {
          sessionId,
          agentId: presenter.agentId,
          sessionInfo: await presenter.getSession(sessionId)
        }
      )

      return sessionId
    } catch (error) {
      // Emit ERROR event and re-throw
      this.emitError(agentId, error as Error, { method: 'createSession', agentId, config })
      throw error
    }
  }

  /**
   * Get session information
   * @param sessionId - The session ID
   * @returns Session information or null if not found
   * @throws Error if session not found or query fails
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    try {
      const presenter = this.getPresenterBySession(sessionId)
      return await presenter.getSession(sessionId)
    } catch (error) {
      this.emitError(sessionId, error as Error, { method: 'getSession', sessionId })
      throw error
    }
  }

  /**
   * Load an existing session
   * @param sessionId - The session ID to load
   * @param context - Load context
   * @throws Error if session not found or loading fails
   */
  async loadSession(sessionId: string, context: LoadContext): Promise<void> {
    try {
      const presenter = this.getPresenterBySession(sessionId)
      await presenter.loadSession(sessionId, context)
    } catch (error) {
      this.emitError(sessionId, error as Error, { method: 'loadSession', sessionId, context })
      throw error
    }
  }

  /**
   * Close a session
   * @param sessionId - The session ID to close
   * @throws Error if session not found or closing fails
   */
  async closeSession(sessionId: string): Promise<void> {
    try {
      const presenter = this.getPresenterBySession(sessionId)
      await presenter.closeSession(sessionId)

      // Remove from tracking
      this.sessionToPresenter.delete(sessionId)

      // Emit SESSION_CLOSED event
      eventBus.sendToRenderer(
        'agentic.session.closed' as AgenticEventType,
        SendTarget.ALL_WINDOWS,
        {
          sessionId
        }
      )
    } catch (error) {
      this.emitError(sessionId, error as Error, { method: 'closeSession', sessionId })
      throw error
    }
  }

  // ============================================================================
  // Messaging
  // ============================================================================

  /**
   * Send a message to the agent
   * @param sessionId - The session ID
   * @param content - Message content
   * @throws Error if session not found or sending fails
   */
  async sendMessage(sessionId: string, content: MessageContent): Promise<void> {
    try {
      const presenter = this.getPresenterBySession(sessionId)
      await presenter.sendMessage(sessionId, content)
    } catch (error) {
      this.emitError(sessionId, error as Error, { method: 'sendMessage', sessionId, content })
      throw error
    }
  }

  // ============================================================================
  // Control
  // ============================================================================

  /**
   * Cancel a message
   * @param sessionId - The session ID
   * @param messageId - The message ID to cancel
   * @throws Error if session not found or cancellation fails
   */
  async cancelMessage(sessionId: string, messageId: string): Promise<void> {
    try {
      const presenter = this.getPresenterBySession(sessionId)
      await presenter.cancelMessage(sessionId, messageId)
    } catch (error) {
      this.emitError(sessionId, error as Error, { method: 'cancelMessage', sessionId, messageId })
      throw error
    }
  }

  // ============================================================================
  // Model/Mode Selection
  // ============================================================================

  /**
   * Set the model for a session
   * @param sessionId - The session ID
   * @param modelId - The model ID to set
   * @throws Error if session not found or setting model fails
   */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    try {
      const presenter = this.getPresenterBySession(sessionId)
      await presenter.setModel(sessionId, modelId)
    } catch (error) {
      this.emitError(sessionId, error as Error, { method: 'setModel', sessionId, modelId })
      throw error
    }
  }

  /**
   * Set the mode (permission policy) for a session
   * @param sessionId - The session ID
   * @param modeId - The mode ID to set
   * @throws Error if session not found or setting mode fails
   */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    try {
      const presenter = this.getPresenterBySession(sessionId)
      await presenter.setMode(sessionId, modeId)
    } catch (error) {
      this.emitError(sessionId, error as Error, { method: 'setMode', sessionId, modeId })
      throw error
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Emit an error event to the renderer
   * @param sessionId - The session ID (or agentId for createSession)
   * @param error - The error to emit
   * @param context - Additional context about the error
   */
  private emitError(sessionId: string, error: Error, context?: Record<string, unknown>): void {
    eventBus.sendToRenderer('agentic.error' as AgenticEventType, SendTarget.ALL_WINDOWS, {
      sessionId,
      error,
      context
    })
  }
}

// Export singleton instance
export const agenticPresenter = new AgenticPresenter()

// Export types
export * from './types.js'
export * from './registry.js'
