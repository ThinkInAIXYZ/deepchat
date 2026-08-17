import { computed, ref, shallowReactive, type ComputedRef } from 'vue'
import type { useMessageStore } from '@/stores/ui/message'
import type { useSessionStore } from '@/stores/ui/session'
import type {
  AttachmentFallbackPolicy,
  AttachmentPreparationSummary
} from '@shared/types/agent-interface'
import type { RendererNotificationNotifier } from '@renderer-notifications/rendererNotificationPort'

type MessageStore = ReturnType<typeof useMessageStore>
type SessionStore = ReturnType<typeof useSessionStore>

type SessionClientLike = {
  retryMessage: (
    sessionId: string,
    messageId: string,
    options?: { attachmentFallbackPolicy?: AttachmentFallbackPolicy }
  ) => Promise<
    | {
        accepted?: boolean
        attachmentPreparation?: AttachmentPreparationSummary
      }
    | undefined
  >
  deleteMessage: (sessionId: string, messageId: string) => Promise<unknown>
  editUserMessage: (sessionId: string, messageId: string, text: string) => Promise<unknown>
  forkSession: (sessionId: string, messageId: string) => Promise<{ id: string }>
}

type ChatClientLike = {
  sendMessage: (sessionId: string, content: string) => Promise<{ accepted?: boolean } | undefined>
}

type UseMessageActionsOptions = {
  sessionId: () => string
  isReadOnlySession: ComputedRef<boolean>
  hasBlockingInteraction: () => boolean
  messageStore: MessageStore
  sessionStore: SessionStore
  sessionClient: SessionClientLike
  chatClient: ChatClientLike
  beginPlanTurn: (sessionId: string) => void
  clearPlanSnapshotForDeletedMessage: (sessionId: string, messageId: string) => void
  loadMessagesForSession: (sessionId: string) => Promise<unknown>
  applyRestoredSessionSummary: (session: unknown) => void
  currentRestoreRequestId: () => number
  canWriteSessionView: (sessionId: string, requestId: number) => boolean
  openModelPicker: () => void
  notify: RendererNotificationNotifier
  t: (key: string) => string
}

/**
 * Owns message-level user actions while preserving their existing retry,
 * confirmation, and refresh semantics. The page remains responsible for the
 * session-change lifecycle and calls clearForSessionChange at that boundary.
 */
export function useMessageActions(options: UseMessageActionsOptions) {
  const pendingDeleteMessageId = ref<string | null>(null)
  const blockedRetryAttempt = ref<{ sessionId: string; messageId: string } | null>(null)
  const retryAttachmentPreparationSummary = ref<AttachmentPreparationSummary | null>(null)
  const activeRetrySessionIds = shallowReactive(new Set<string>())
  const isRetryingAttachments = computed(() => activeRetrySessionIds.has(options.sessionId()))
  const showDeleteMessageDialog = computed(() => Boolean(pendingDeleteMessageId.value))

  async function refreshAfterRetryFailure(sessionId: string, requestId: number) {
    const restoredSession = await options.loadMessagesForSession(sessionId)
    if (!options.canWriteSessionView(sessionId, requestId)) return
    options.applyRestoredSessionSummary(restoredSession)
  }

  async function retryMessage(
    messageId: string,
    errorMessage: string,
    blocksInteraction: boolean,
    sessionId = options.sessionId(),
    attachmentFallbackPolicy?: AttachmentFallbackPolicy
  ) {
    if (options.isReadOnlySession.value || !messageId) return
    if (blocksInteraction && options.hasBlockingInteraction()) return
    if (activeRetrySessionIds.has(sessionId)) return

    const requestId = options.currentRestoreRequestId()
    try {
      activeRetrySessionIds.add(sessionId)
      options.messageStore.clearStreamingState()
      const result = attachmentFallbackPolicy
        ? await options.sessionClient.retryMessage(sessionId, messageId, {
            attachmentFallbackPolicy
          })
        : await options.sessionClient.retryMessage(sessionId, messageId)
      if (result?.accepted === false) {
        if (options.canWriteSessionView(sessionId, requestId)) {
          blockedRetryAttempt.value = { sessionId, messageId }
          retryAttachmentPreparationSummary.value =
            result.attachmentPreparation ?? fallbackPreparationSummary()
        }
        return
      }
      options.beginPlanTurn(sessionId)
      if (blockedRetryAttempt.value?.sessionId === sessionId) {
        blockedRetryAttempt.value = null
        retryAttachmentPreparationSummary.value = null
      }
    } catch (error) {
      console.error(errorMessage, error)
      if (!options.canWriteSessionView(sessionId, requestId)) return
      await refreshAfterRetryFailure(sessionId, requestId)
    } finally {
      activeRetrySessionIds.delete(sessionId)
    }
  }

  function fallbackPreparationSummary(): AttachmentPreparationSummary {
    return {
      status: 'needs_user_action',
      issues: [],
      suggestedActions: ['retry', 'send_without_image_content']
    }
  }

  async function onMessageRetry(messageId: string, sessionId = options.sessionId()) {
    await retryMessage(messageId, '[ChatPage] retry message failed:', true, sessionId)
  }

  async function retryBlockedMessage(): Promise<void> {
    const attempt = blockedRetryAttempt.value
    if (
      !attempt ||
      !options.canWriteSessionView(attempt.sessionId, options.currentRestoreRequestId())
    ) {
      cancelBlockedMessageRetry()
      return
    }
    await retryMessage(
      attempt.messageId,
      '[ChatPage] retry message failed:',
      true,
      attempt.sessionId
    )
  }

  async function retryBlockedMessageWithoutImageContent(): Promise<void> {
    const attempt = blockedRetryAttempt.value
    if (
      !attempt ||
      !options.canWriteSessionView(attempt.sessionId, options.currentRestoreRequestId())
    ) {
      cancelBlockedMessageRetry()
      return
    }
    await retryMessage(
      attempt.messageId,
      '[ChatPage] retry message without image content failed:',
      true,
      attempt.sessionId,
      'send_without_image_content'
    )
  }

  function cancelBlockedMessageRetry(): void {
    if (isRetryingAttachments.value) return
    blockedRetryAttempt.value = null
    retryAttachmentPreparationSummary.value = null
  }

  function switchRetryToVisionModel(): void {
    cancelBlockedMessageRetry()
    options.openModelPicker()
  }

  async function onMessageDelete(messageId: string) {
    if (options.isReadOnlySession.value || !messageId) return
    pendingDeleteMessageId.value = messageId
  }

  async function confirmMessageDelete() {
    const messageId = pendingDeleteMessageId.value
    if (!messageId || options.isReadOnlySession.value) return

    const sessionId = options.sessionId()
    const requestId = options.currentRestoreRequestId()
    pendingDeleteMessageId.value = null
    try {
      options.messageStore.clearStreamingState()
      await options.sessionClient.deleteMessage(sessionId, messageId)
      // Plan snapshots are stored per session id, not per view; clean up even
      // when the user switched sessions while the confirm dialog was open.
      options.clearPlanSnapshotForDeletedMessage(sessionId, messageId)
      if (!options.canWriteSessionView(sessionId, requestId)) return
      const restoredSession = await options.loadMessagesForSession(sessionId)
      if (!options.canWriteSessionView(sessionId, requestId)) return
      options.applyRestoredSessionSummary(restoredSession)
    } catch (error) {
      console.error('[ChatPage] delete message failed:', error)
      if (options.canWriteSessionView(sessionId, requestId)) {
        options.notify({
          kind: 'error',
          code: 'chat.message.deleteFailed',
          title: options.t('dialog.deleteMessage.title'),
          description: options.t('common.error.requestFailed')
        })
      }
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
    // Signature stays for the emit chain. Legacy needContinue actions now send a
    // follow-up turn instead of retrying and rewriting the historical run.
    if (options.isReadOnlySession.value || !messageId) return
    if (options.hasBlockingInteraction()) return
    const sessionId = options.sessionId()
    if (activeRetrySessionIds.has(sessionId)) return
    try {
      activeRetrySessionIds.add(sessionId)
      const result = await options.chatClient.sendMessage(
        sessionId,
        options.t('chat.guardStop.continueMessage')
      )
      if (result?.accepted === false) return
      options.beginPlanTurn(sessionId)
    } catch (error) {
      console.error('[ChatPage] continue message failed:', error)
    } finally {
      activeRetrySessionIds.delete(sessionId)
    }
  }

  function clearForSessionChange(): void {
    cancelMessageDelete()
    blockedRetryAttempt.value = null
    retryAttachmentPreparationSummary.value = null
  }

  return {
    showDeleteMessageDialog,
    retryAttachmentPreparationSummary,
    isRetryingAttachments,
    onMessageRetry,
    onMessageDelete,
    confirmMessageDelete,
    cancelMessageDelete,
    onDeleteMessageDialogOpenChange,
    onMessageEditSave,
    onMessageFork,
    onMessageContinue,
    retryBlockedMessage,
    retryBlockedMessageWithoutImageContent,
    cancelBlockedMessageRetry,
    switchRetryToVisionModel,
    clearForSessionChange
  }
}
