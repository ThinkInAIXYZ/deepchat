import { computed, effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageActions } from '@/features/chat-page/composables/useMessageActions'
import { createDeferred } from '../../../utils/deferred'

function createHarness() {
  const sessionId = ref('s1')
  const isReadOnly = ref(false)
  const isBlocking = ref(false)
  const messageStore = { clearStreamingState: vi.fn() }
  const sessionStore = { fetchSessions: vi.fn(), selectSession: vi.fn() }
  const sessionClient = {
    retryMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editUserMessage: vi.fn().mockResolvedValue(undefined),
    forkSession: vi.fn().mockResolvedValue({ id: 'forked' })
  }
  const beginPlanTurn = vi.fn()
  const clearPlanSnapshotForDeletedMessage = vi.fn()
  const loadMessagesForSession = vi.fn().mockResolvedValue({ id: 'loaded' })
  const applyRestoredSessionSummary = vi.fn()
  const restoreRequestId = ref(0)
  const canWriteSessionView = vi.fn(
    (id: string, requestId: number) =>
      id === sessionId.value && requestId === restoreRequestId.value
  )
  const openModelPicker = vi.fn()
  const scope = effectScope()
  let actions!: ReturnType<typeof useMessageActions>

  scope.run(() => {
    actions = useMessageActions({
      sessionId: () => sessionId.value,
      isReadOnlySession: computed(() => isReadOnly.value),
      hasBlockingInteraction: () => isBlocking.value,
      messageStore: messageStore as any,
      sessionStore: sessionStore as any,
      sessionClient,
      beginPlanTurn,
      clearPlanSnapshotForDeletedMessage,
      loadMessagesForSession,
      applyRestoredSessionSummary,
      currentRestoreRequestId: () => restoreRequestId.value,
      canWriteSessionView,
      openModelPicker
    })
  })

  return {
    actions,
    sessionId,
    isReadOnly,
    isBlocking,
    messageStore,
    sessionStore,
    sessionClient,
    beginPlanTurn,
    clearPlanSnapshotForDeletedMessage,
    loadMessagesForSession,
    applyRestoredSessionSummary,
    restoreRequestId,
    canWriteSessionView,
    openModelPicker,
    stop: () => scope.stop()
  }
}

describe('useMessageActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retries only an actionable message and refreshes after a retry failure', async () => {
    const harness = createHarness()

    await harness.actions.onMessageRetry('message-1')

    expect(harness.beginPlanTurn).toHaveBeenCalledWith('s1')
    expect(harness.messageStore.clearStreamingState).toHaveBeenCalledTimes(1)
    expect(harness.sessionClient.retryMessage).toHaveBeenCalledWith('s1', 'message-1')

    harness.isBlocking.value = true
    await harness.actions.onMessageRetry('blocked')
    expect(harness.sessionClient.retryMessage).toHaveBeenCalledTimes(1)

    harness.isBlocking.value = false
    const error = new Error('retry failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.sessionClient.retryMessage.mockRejectedValueOnce(error)
    await harness.actions.onMessageRetry('message-2')

    expect(consoleError).toHaveBeenCalledWith('[ChatPage] retry message failed:', error)
    expect(harness.loadMessagesForSession).toHaveBeenLastCalledWith('s1')
    expect(harness.applyRestoredSessionSummary).toHaveBeenLastCalledWith({ id: 'loaded' })
    consoleError.mockRestore()
    harness.stop()
  })

  it('keeps history intact when retry preflight blocks and supports explicit degradation', async () => {
    const harness = createHarness()
    const attachmentPreparation = {
      status: 'needs_user_action' as const,
      issues: [{ attachmentIndex: 0, reason: 'ocr_empty' as const }],
      suggestedActions: [
        'retry' as const,
        'send_without_image_content' as const,
        'switch_to_vision_model' as const
      ]
    }
    harness.sessionClient.retryMessage
      .mockResolvedValueOnce({ accepted: false, attachmentPreparation })
      .mockResolvedValueOnce({ accepted: true })

    await harness.actions.onMessageRetry('message-ocr')

    expect(harness.actions.retryAttachmentPreparationSummary.value).toEqual(attachmentPreparation)
    expect(harness.beginPlanTurn).not.toHaveBeenCalled()
    expect(harness.loadMessagesForSession).not.toHaveBeenCalled()

    await harness.actions.retryBlockedMessageWithoutImageContent()

    expect(harness.sessionClient.retryMessage).toHaveBeenLastCalledWith('s1', 'message-ocr', {
      attachmentFallbackPolicy: 'send_without_image_content'
    })
    expect(harness.actions.retryAttachmentPreparationSummary.value).toBeNull()
    expect(harness.beginPlanTurn).toHaveBeenCalledWith('s1')
    harness.stop()
  })

  it('clears a blocked retry before opening the model picker or changing sessions', async () => {
    const harness = createHarness()
    harness.sessionClient.retryMessage.mockResolvedValueOnce({
      accepted: false,
      attachmentPreparation: {
        status: 'needs_user_action',
        issues: [],
        suggestedActions: ['switch_to_vision_model']
      }
    })

    await harness.actions.onMessageRetry('message-ocr')
    harness.actions.switchRetryToVisionModel()

    expect(harness.openModelPicker).toHaveBeenCalledTimes(1)
    expect(harness.actions.retryAttachmentPreparationSummary.value).toBeNull()

    harness.sessionClient.retryMessage.mockResolvedValueOnce({ accepted: false })
    await harness.actions.onMessageRetry('message-next')
    harness.actions.clearForSessionChange()
    expect(harness.actions.retryAttachmentPreparationSummary.value).toBeNull()
    harness.stop()
  })

  it('does not surface a stale retry decision after switching sessions', async () => {
    const harness = createHarness()
    let resolveRetry!: (value: {
      accepted: false
      attachmentPreparation: {
        status: 'needs_user_action'
        issues: []
        suggestedActions: ['retry']
      }
    }) => void
    harness.sessionClient.retryMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve
        })
    )

    const retry = harness.actions.onMessageRetry('message-s1')
    await vi.waitFor(() => expect(harness.sessionClient.retryMessage).toHaveBeenCalledTimes(1))
    expect(harness.actions.isRetryingAttachments.value).toBe(true)

    harness.sessionId.value = 's2'
    harness.actions.clearForSessionChange()
    expect(harness.actions.isRetryingAttachments.value).toBe(false)

    resolveRetry({
      accepted: false,
      attachmentPreparation: {
        status: 'needs_user_action',
        issues: [],
        suggestedActions: ['retry']
      }
    })
    await retry

    expect(harness.actions.retryAttachmentPreparationSummary.value).toBeNull()
    harness.stop()
  })

  it('does not restore a stale session after retry or delete completes', async () => {
    const harness = createHarness()
    const retry = createDeferred<unknown>()
    const deleteRequest = createDeferred<unknown>()
    const restore = createDeferred<unknown>()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    harness.sessionClient.retryMessage.mockReturnValueOnce(retry.promise)
    harness.sessionClient.deleteMessage.mockReturnValueOnce(deleteRequest.promise)
    harness.loadMessagesForSession.mockReturnValueOnce(restore.promise)

    const retryAction = harness.actions.onMessageRetry('message-1')
    retry.reject?.(new Error('retry failed'))
    await vi.waitFor(() => expect(harness.loadMessagesForSession).toHaveBeenCalledWith('s1'))
    harness.sessionId.value = 's2'
    harness.restoreRequestId.value += 1
    restore.resolve({ id: 'stale' })
    await retryAction
    expect(harness.applyRestoredSessionSummary).not.toHaveBeenCalled()

    await harness.actions.onMessageDelete('message-2')
    const deleteAction = harness.actions.confirmMessageDelete()
    harness.sessionId.value = 's1'
    harness.restoreRequestId.value += 1
    deleteRequest.resolve(undefined)
    await deleteAction
    expect(harness.loadMessagesForSession).toHaveBeenCalledTimes(1)
    // Plan snapshots are keyed by session id, so the cleanup still runs for the
    // deleted message even though the stale view restore is skipped.
    expect(harness.clearPlanSnapshotForDeletedMessage).toHaveBeenCalledWith('s2', 'message-2')
    consoleError.mockRestore()
    harness.stop()
  })

  it('preserves delete-confirmation, current-session refresh, and read-only behavior', async () => {
    const harness = createHarness()

    await harness.actions.onMessageDelete('message-1')
    expect(harness.actions.showDeleteMessageDialog.value).toBe(true)
    expect(harness.sessionClient.deleteMessage).not.toHaveBeenCalled()

    await harness.actions.confirmMessageDelete()
    expect(harness.sessionClient.deleteMessage).toHaveBeenCalledWith('s1', 'message-1')
    expect(harness.clearPlanSnapshotForDeletedMessage).toHaveBeenCalledWith('s1', 'message-1')
    expect(harness.applyRestoredSessionSummary).toHaveBeenCalledWith({ id: 'loaded' })

    await harness.actions.onMessageDelete('message-2')
    harness.isReadOnly.value = true
    await harness.actions.confirmMessageDelete()
    expect(harness.actions.showDeleteMessageDialog.value).toBe(true)
    expect(harness.sessionClient.deleteMessage).toHaveBeenCalledTimes(1)

    harness.isReadOnly.value = false
    harness.actions.clearForSessionChange()
    expect(harness.actions.showDeleteMessageDialog.value).toBe(false)
    harness.stop()
  })

  it('keeps an edited message retry bound to its original session', async () => {
    const harness = createHarness()
    let resolveEdit!: () => void
    harness.sessionClient.editUserMessage.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveEdit = resolve))
    )

    const edit = harness.actions.onMessageEditSave({ messageId: 'message-1', text: 'updated' })
    await vi.waitFor(() => expect(harness.sessionClient.editUserMessage).toHaveBeenCalledTimes(1))
    harness.sessionId.value = 's2'
    resolveEdit()
    await edit

    expect(harness.sessionClient.editUserMessage).toHaveBeenCalledWith('s1', 'message-1', 'updated')
    expect(harness.sessionClient.retryMessage).toHaveBeenCalledWith('s1', 'message-1')
    expect(harness.beginPlanTurn).toHaveBeenCalledWith('s1')
    harness.stop()
  })

  it('edits then retries, forks in order, and continues without an interaction gate', async () => {
    const harness = createHarness()

    await harness.actions.onMessageEditSave({ messageId: 'message-1', text: '  updated  ' })
    expect(harness.sessionClient.editUserMessage).toHaveBeenCalledWith('s1', 'message-1', 'updated')
    expect(harness.sessionClient.retryMessage).toHaveBeenCalledWith('s1', 'message-1')

    await harness.actions.onMessageFork('message-2')
    expect(harness.sessionClient.forkSession).toHaveBeenCalledWith('s1', 'message-2')
    expect(harness.sessionStore.fetchSessions).toHaveBeenCalledBefore(
      harness.sessionStore.selectSession
    )
    expect(harness.sessionStore.selectSession).toHaveBeenCalledWith('forked')

    harness.isBlocking.value = true
    await harness.actions.onMessageContinue('ignored-conversation', 'message-3')
    expect(harness.sessionClient.retryMessage).toHaveBeenLastCalledWith('s1', 'message-3')
    harness.stop()
  })
})
