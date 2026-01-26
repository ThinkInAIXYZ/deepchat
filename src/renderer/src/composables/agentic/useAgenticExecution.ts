/**
 * useAgenticExecution - Message Execution with State Management
 *
 * High-level composable that combines message execution via AgenticPresenter
 * with state management for generating sessions and working status.
 *
 * This replaces useExecutionAdapter with a cleaner, agent-agnostic interface.
 *
 * @example
 * ```ts
 * const execution = useAgenticExecution(options)
 * await execution.sendMessage(content)
 * ```
 */

import type { Ref } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { MessageContent } from '@shared/types/presenters/agentic.presenter.d'
import type { WorkingStatus } from '@/stores/chat'

export interface AgenticExecutionOptions {
  /** Ref to the active session ID */
  activeSessionId: Ref<string | null>
  /** Ref to generating session IDs */
  generatingSessionIds: Ref<Set<string>>
  /** Ref to sessions working status */
  sessionsWorkingStatus: Ref<Map<string, WorkingStatus>>
  /** Function to update session working status */
  updateSessionWorkingStatus: (sessionId: string, status: WorkingStatus) => void
  /** Function to get the current tab ID */
  getTabId: () => number
}

export function useAgenticExecution(options: AgenticExecutionOptions) {
  const agentP = usePresenter('agentPresenter')

  /**
   * Send a message to the active session
   * @param content Message content to send
   */
  async function sendMessage(content: MessageContent): Promise<void> {
    const sessionId = options.activeSessionId.value
    if (!sessionId) {
      throw new Error('No active session')
    }

    try {
      options.generatingSessionIds.value.add(sessionId)
      options.updateSessionWorkingStatus(sessionId, 'working')

      // Convert MessageContent to string format for agentP.sendMessage
      const contentStr = JSON.stringify(content)

      await agentP.sendMessage(sessionId, contentStr, options.getTabId())
    } catch (error) {
      console.error('[useAgenticExecution] Failed to send message:', error)
      options.generatingSessionIds.value.delete(sessionId)
      options.updateSessionWorkingStatus(sessionId, 'error')
      throw error
    }
  }

  /**
   * Continue the agent loop from a specific message
   * @param messageId Message ID to continue from
   */
  async function continueLoop(messageId: string): Promise<void> {
    const sessionId = options.activeSessionId.value
    if (!sessionId) {
      throw new Error('No active session')
    }

    try {
      options.generatingSessionIds.value.add(sessionId)
      options.updateSessionWorkingStatus(sessionId, 'working')

      await agentP.continueLoop(sessionId, messageId)
    } catch (error) {
      console.error('[useAgenticExecution] Failed to continue loop:', error)
      throw error
    }
  }

  /**
   * Cancel ongoing generation for the active session
   * @param messageId Optional message ID to cancel
   */
  async function cancelGeneration(messageId?: string): Promise<void> {
    const sessionId = options.activeSessionId.value
    if (!sessionId) {
      return
    }

    try {
      if (messageId) {
        await agentP.cancelLoop(messageId)
      }

      options.generatingSessionIds.value.delete(sessionId)
      options.updateSessionWorkingStatus(sessionId, 'completed')
    } catch (error) {
      console.error('[useAgenticExecution] Failed to cancel generation:', error)
    }
  }

  /**
   * Retry a failed message
   * @param messageId Message ID to retry
   */
  async function retryMessage(messageId: string): Promise<void> {
    const sessionId = options.activeSessionId.value
    if (!sessionId) {
      throw new Error('No active session')
    }

    try {
      options.generatingSessionIds.value.add(sessionId)
      options.updateSessionWorkingStatus(sessionId, 'working')

      await agentP.retryMessage(messageId)
    } catch (error) {
      console.error('[useAgenticExecution] Failed to retry message:', error)
      throw error
    }
  }

  /**
   * Regenerate response from a user message
   * @param userMessageId User message ID to regenerate from
   */
  async function regenerateFromUserMessage(userMessageId: string): Promise<void> {
    const sessionId = options.activeSessionId.value
    if (!sessionId) {
      throw new Error('No active session')
    }

    try {
      options.generatingSessionIds.value.add(sessionId)
      options.updateSessionWorkingStatus(sessionId, 'working')

      await agentP.regenerateFromUserMessage(sessionId, userMessageId)
    } catch (error) {
      console.error('[useAgenticExecution] Failed to regenerate:', error)
      throw error
    }
  }

  return {
    sendMessage,
    continueLoop,
    cancelGeneration,
    retryMessage,
    regenerateFromUserMessage
  }
}

export type UseAgenticExecutionReturn = ReturnType<typeof useAgenticExecution>
