/**
 * Agentic Event Emitter Implementation
 * Implements the AgenticEventEmitter interface
 * Provides type-safe methods for emitting unified agentic events
 */

import type { AgenticEventEmitter } from './types.js'
import type { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import type { PermissionRequestPayload } from '@shared/types/presenters/agentic.presenter.d'

/**
 * Internal: AgenticPresenter reference for emitting events
 * This avoids circular dependency between AgenticPresenter and AgenticEventEmitterImpl
 */
export interface AgenticEventEmitterHost {
  emitAgenticEvent(
    eventType: AgenticEventType,
    sessionId: string,
    payload: Record<string, unknown>
  ): void
}

/**
 * Agentic Event Emitter Implementation
 *
 * Delegates to AgenticPresenter for actual event emission
 * Provides a clean interface for agent presenters to emit unified events
 */
export class AgenticEventEmitterImpl implements AgenticEventEmitter {
  constructor(
    private readonly sessionId: string,
    private readonly agentic: AgenticEventEmitterHost
  ) {}

  // ==========================================================================
  // Message flow events
  // ==========================================================================

  messageDelta(messageId: string, content: string, isComplete: boolean): void {
    this.agentic.emitAgenticEvent('agentic.message.delta' as AgenticEventType, this.sessionId, {
      messageId,
      content,
      isComplete
    })
  }

  messageEnd(messageId: string): void {
    this.agentic.emitAgenticEvent('agentic.message.end' as AgenticEventType, this.sessionId, {
      messageId
    })
  }

  messageBlock(messageId: string, blockType: string, content: unknown): void {
    this.agentic.emitAgenticEvent('agentic.message.block' as AgenticEventType, this.sessionId, {
      messageId,
      blockType,
      content
    })
  }

  // ==========================================================================
  // Tool call events
  // ==========================================================================

  toolStart(toolId: string, toolName: string, toolArguments: Record<string, unknown>): void {
    this.agentic.emitAgenticEvent('agentic.tool.start' as AgenticEventType, this.sessionId, {
      toolId,
      toolName,
      arguments: toolArguments
    })
  }

  toolRunning(toolId: string, status?: string): void {
    this.agentic.emitAgenticEvent('agentic.tool.running' as AgenticEventType, this.sessionId, {
      toolId,
      status
    })
  }

  toolEnd(toolId: string, result?: unknown, error?: Error): void {
    this.agentic.emitAgenticEvent('agentic.tool.end' as AgenticEventType, this.sessionId, {
      toolId,
      result,
      error
    })
  }

  // ==========================================================================
  // Tool permission lifecycle (DeepChat agents)
  // ==========================================================================

  toolPermissionRequired(
    toolId: string,
    toolName: string,
    request: PermissionRequestPayload
  ): void {
    this.agentic.emitAgenticEvent(
      'agentic.tool.permission-required' as AgenticEventType,
      this.sessionId,
      { toolId, toolName, request }
    )
  }

  toolPermissionGranted(toolId: string): void {
    this.agentic.emitAgenticEvent(
      'agentic.tool.permission-granted' as AgenticEventType,
      this.sessionId,
      { toolId }
    )
  }

  toolPermissionDenied(toolId: string): void {
    this.agentic.emitAgenticEvent(
      'agentic.tool.permission-denied' as AgenticEventType,
      this.sessionId,
      { toolId }
    )
  }

  // ==========================================================================
  // Session lifecycle events (for internal use by presenters)
  // ==========================================================================

  sessionReady(sessionId: string, messageCount?: number): void {
    this.agentic.emitAgenticEvent('agentic.session.ready' as AgenticEventType, sessionId, {
      sessionId,
      messageCount
    })
  }

  sessionUpdated(info: import('./types.js').SessionInfo): void {
    this.agentic.emitAgenticEvent('agentic.session.updated' as AgenticEventType, this.sessionId, {
      sessionInfo: info
    })
  }

  // ==========================================================================
  // Status events
  // ==========================================================================

  statusChanged(status: 'idle' | 'generating' | 'paused' | 'error', error?: Error): void {
    this.agentic.emitAgenticEvent('agentic.status.changed' as AgenticEventType, this.sessionId, {
      status,
      error
    })
  }
}
