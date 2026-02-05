import { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import type { SessionUpdatedEvent } from '@shared/types/presenters/agentic.presenter.d'

/**
 * ACP Events Adapter - Agentic Unified Layer
 * Provides type-safe subscription to agentic session update events
 * Replaces old ACP_WORKSPACE_EVENTS with unified AgenticEventType.SESSION_UPDATED
 */

type SessionUpdateHandler = (payload: SessionUpdatedEvent) => void

/**
 * Unified session update handler
 * The handler should check specific properties of sessionInfo to determine what was updated:
 * - sessionInfo.availableModes - Mode updates
 * - sessionInfo.availableModels - Model updates
 * - sessionInfo.availableCommands - Command updates
 */
function subscribeSessionUpdated(handler: SessionUpdateHandler) {
  const listener = (_: unknown, payload: SessionUpdatedEvent) => {
    if (!payload) return
    handler(payload)
  }
  window.electron.ipcRenderer.on(AgenticEventType.SESSION_UPDATED, listener)
  return () => {
    window.electron.ipcRenderer.removeListener(AgenticEventType.SESSION_UPDATED, listener)
  }
}

export function useAcpEventsAdapter() {
  /**
   * Subscribe to session updated events
   * This replaces the three separate ACP event subscriptions with a unified handler
   * The consumer should check the relevant sessionInfo properties
   */
  return {
    subscribeSessionUpdated
  }
}
