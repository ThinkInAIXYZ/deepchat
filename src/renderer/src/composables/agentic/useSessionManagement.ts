/**
 * useSessionManagement - Session Lifecycle Management Composable
 *
 * Provides session CRUD operations via AgenticPresenter.
 * This is the new unified version that replaces the old useSessionManagement.
 *
 * @example
 * ```ts
 * const { createSession, loadSession, closeSession, setActiveSession } = useSessionManagement()
 * const sessionId = await createSession(agentId, { workspace, modelId })
 * ```
 */

import { ref } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { SessionConfig } from '@shared/types/presenters/agentic.presenter.d'

export function useSessionManagement() {
  const agenticP = usePresenter('agenticPresenter')

  // Local state for active session
  const activeSessionId = ref<string | null>(null)

  /**
   * Create a new session with the given agent and configuration
   * @param agentId Agent ID (e.g., 'anthropic:claude-sonnet' or 'acp-agent-id')
   * @param config Session configuration (workspace, modelId, modeId, etc.)
   * @returns The newly created session ID
   */
  async function createSession(agentId: string, config?: SessionConfig): Promise<string> {
    const sessionId = await agenticP.createSession(agentId, config ?? {})
    return sessionId
  }

  /**
   * Load an existing session
   * @param sessionId Session ID to load
   * @param context Optional loading context (tabId, etc.)
   */
  async function loadSession(sessionId: string, context?: { tabId?: number }): Promise<void> {
    await agenticP.loadSession(sessionId, context ?? {})
    activeSessionId.value = sessionId
  }

  /**
   * Close a session
   * - For DeepChat agents: persists session, clears from memory
   * - For ACP agents: terminates agent process, cleans up resources
   * @param sessionId Session ID to close
   */
  async function closeSession(sessionId: string): Promise<void> {
    await agenticP.closeSession(sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
    }
  }

  /**
   * Set the active session ID (local state only)
   * @param sessionId Session ID to set as active
   */
  function setActiveSession(sessionId: string | null): void {
    activeSessionId.value = sessionId
  }

  /**
   * Delete a session permanently
   * @param sessionId Session ID to delete
   */
  async function deleteSession(sessionId: string): Promise<void> {
    await agenticP.deleteSession(sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
    }
  }

  return {
    // State
    activeSessionId,

    // Session lifecycle methods
    createSession,
    loadSession,
    closeSession,
    deleteSession,
    setActiveSession
  }
}

export type UseSessionManagementReturn = ReturnType<typeof useSessionManagement>
