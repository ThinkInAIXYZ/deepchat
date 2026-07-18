import { computed, ref, type ComputedRef } from 'vue'
import type { useMessageStore } from '@/stores/ui/message'
import type { useSessionStore } from '@/stores/ui/session'

type MessageStore = ReturnType<typeof useMessageStore>
type SessionStore = ReturnType<typeof useSessionStore>

type SessionClientLike = {
  retryMessage: (sessionId: string, messageId: string) => Promise<unknown>
  deleteMessage: (sessionId: string, messageId: string) => Promise<unknown>
  editUserMessage: (sessionId: string, messageId: string, text: string) => Promise<unknown>
  forkSession: (sessionId: string, messageId: string) => Promise<{ id: string }>
}

type UseMessageActionsOptions = {
  sessionId: () => string
  isReadOnlySession: ComputedRef<boolean>
  hasBlockingInteraction: () => boolean
  messageStore: MessageStore
  sessionStore: SessionStore
  sessionClient: SessionClientLike
  beginPlanTurn: (sessionId: string) => void
  clearPlanSnapshotForDeletedMessage: (sessionId: string, messageId: string) => void
  loadMessagesForSession: (sessionId: string) => Promise<unknown>
  applyRestoredSessionSummary: (session: unknown) => void
  isCurrentSession: (sessionId: string) => boolean
}

/**
 * Owns message-level user actions while preserving their existing retry,
 * confirmation, and refresh semantics. The page remains responsible for the
 * session-change lifecycle and calls clearForSessionChange at that boundary.
 */
export function useMessageActions(options: UseMessageActionsOptions) {
  const pendingDeleteMessageId = ref<string | null>(null)
  const showDeleteMessageDialog = computed(() => Boolean(pendingDeleteMessageId.value))

  async function refreshAfterRetryFailure(sessionId: string) {
    options.applyRestoredSessionSummary(await options.loadMessagesForSession(sessionId))
  }

  async function retryMessage(
    messageId: string,
    errorMessage: string,
    blocksInteraction: boolean,
    sessionId = options.sessionId()
  ) {
    if (options.isReadOnlySession.value || !messageId) return
    if (blocksInteraction && options.hasBlockingInteraction()) return

    try {
      options.beginPlanTurn(sessionId)
      options.messageStore.clearStreamingState()
      await options.sessionClient.retryMessage(sessionId, messageId)
    } catch (error) {
      console.error(errorMessage, error)
      await refreshAfterRetryFailure(sessionId)
    }
  }

  async function onMessageRetry(messageId: string, sessionId = options.sessionId()) {
    await retryMessage(messageId, '[ChatPage] retry message failed:', true, sessionId)
  }

  async function onMessageDelete(messageId: string) {
    if (options.isReadOnlySession.value || !messageId) return
    pendingDeleteMessageId.value = messageId
  }

  async function confirmMessageDelete() {
    const messageId = pendingDeleteMessageId.value
    if (!messageId || options.isReadOnlySession.value) return

    const sessionId = options.sessionId()
    pendingDeleteMessageId.value = null
    try {
      options.messageStore.clearStreamingState()
      await options.sessionClient.deleteMessage(sessionId, messageId)
      options.clearPlanSnapshotForDeletedMessage(sessionId, messageId)
      if (options.isCurrentSession(sessionId)) {
        options.applyRestoredSessionSummary(await options.loadMessagesForSession(sessionId))
      }
    } catch (error) {
      console.error('[ChatPage] delete message failed:', error)
    }
  }

  function cancelMessageDelete() {
    pendingDeleteMessageId.value = null
  }

  function onDeleteMessageDialogOpenChange(open: boolean) {
    if (!open) {
      cancelMessageDelete()
    }
  }

  async function onMessageEditSave(payload: { messageId: string; text: string }) {
    if (options.isReadOnlySession.value) return
    const messageId = payload?.messageId
    const text = payload?.text?.trim()
    if (!messageId || !text) return

    const sessionId = options.sessionId()
    try {
      await options.sessionClient.editUserMessage(sessionId, messageId, text)
      await onMessageRetry(messageId, sessionId)
    } catch (error) {
      console.error('[ChatPage] edit message failed:', error)
    }
  }

  async function onMessageFork(messageId: string) {
    if (options.isReadOnlySession.value || !messageId) return

    try {
      const forked = await options.sessionClient.forkSession(options.sessionId(), messageId)
      await options.sessionStore.fetchSessions()
      await options.sessionStore.selectSession(forked.id)
    } catch (error) {
      console.error('[ChatPage] fork session failed:', error)
    }
  }

  async function onMessageContinue(_conversationId: string, messageId: string) {
    await retryMessage(messageId, '[ChatPage] continue message failed:', false)
  }

  return {
    showDeleteMessageDialog,
    onMessageRetry,
    onMessageDelete,
    confirmMessageDelete,
    cancelMessageDelete,
    onDeleteMessageDialogOpenChange,
    onMessageEditSave,
    onMessageFork,
    onMessageContinue,
    clearForSessionChange: cancelMessageDelete
  }
}
