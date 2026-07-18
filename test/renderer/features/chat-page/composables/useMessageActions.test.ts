import { computed, effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageActions } from '@/features/chat-page/composables/useMessageActions'

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
  const isCurrentSession = vi.fn((id: string) => id === sessionId.value)
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
      isCurrentSession
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
    isCurrentSession,
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
