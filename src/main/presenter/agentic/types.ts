/**
 * Agentic Presenter - Internal Types
 * Re-exports shared types and adds any internal types
 */

import type {
  IAgenticPresenter,
  SessionInfo,
  MessageContent,
  SessionConfig,
  LoadContext,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionClosedEvent,
  MessageDeltaEvent,
  MessageBlockEvent,
  MessageEndEvent,
  ToolStartEvent,
  ToolRunningEvent,
  ToolEndEvent,
  StatusChangedEvent,
  AgenticErrorEvent
} from '@shared/types/presenters/agentic.presenter.d'

import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'

// Re-export all shared types
export type {
  IAgenticPresenter,
  SessionInfo,
  MessageContent,
  SessionConfig,
  LoadContext,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionClosedEvent,
  MessageDeltaEvent,
  MessageBlockEvent,
  MessageEndEvent,
  ToolStartEvent,
  ToolRunningEvent,
  ToolEndEvent,
  StatusChangedEvent,
  AgenticErrorEvent
}

export { AgenticEventType }

/**
 * Internal: Agent presenter interface
 * Extends IAgenticPresenter with agentId for registration
 */
export interface IAgentPresenter {
  /** Unique identifier for this agent */
  readonly agentId: string

  // Session management
  createSession(config: SessionConfig): Promise<string>
  getSession(sessionId: string): SessionInfo | null
  loadSession(sessionId: string, context: LoadContext): Promise<void>
  closeSession(sessionId: string): Promise<void>

  // Messaging
  sendMessage(sessionId: string, content: MessageContent): Promise<void>

  // Control
  cancelMessage(sessionId: string, messageId: string): Promise<void>

  // Model/Mode selection
  setModel(sessionId: string, modelId: string): Promise<void>
  setMode(sessionId: string, modeId: string): Promise<void>
}
