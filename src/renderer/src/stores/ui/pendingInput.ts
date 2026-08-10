import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { createSessionClient } from '@api/SessionClient'
import type { PendingSessionInputRecord, SendMessageInput } from '@shared/types/agent-interface'

const MAX_PENDING_INPUTS = 5

export const usePendingInputStore = defineStore('pendingInput', () => {
  const sessionClient = createSessionClient()

  const currentSessionId = ref<string | null>(null)
  const items = ref<PendingSessionInputRecord[]>([])
  const resumeAvailable = ref(false)
  const loading = ref(false)
  const resumingSessionId = ref<string | null>(null)
  const retryingItemId = ref<string | null>(null)
  const error = ref<string | null>(null)
  let latestLoadRequestId = 0

  const queueItems = computed(() =>
    items.value
      .filter((item) => item.mode === 'queue')
      .sort((left, right) => (left.queueOrder ?? 0) - (right.queueOrder ?? 0))
  )
  const activeCount = computed(() => queueItems.value.length)
  const isAtCapacity = computed(() => activeCount.value >= MAX_PENDING_INPUTS)
  const resumingQueue = computed(() => resumingSessionId.value !== null)

  async function loadPendingInputs(sessionId: string): Promise<void> {
    const requestedId = sessionId
    const requestId = ++latestLoadRequestId
    if (currentSessionId.value !== requestedId) {
      items.value = []
      resumeAvailable.value = false
    }
    currentSessionId.value = requestedId
    loading.value = true
    error.value = null
    try {
      const result = await sessionClient.listPendingInputs(requestedId)
      if (requestId !== latestLoadRequestId || requestedId !== currentSessionId.value) {
        return
      }
      items.value = result.items
      resumeAvailable.value = result.resumeAvailable
    } catch (e) {
      if (requestId !== latestLoadRequestId || requestedId !== currentSessionId.value) {
        return
      }
      error.value = `Failed to load pending inputs: ${e}`
    } finally {
      if (requestId === latestLoadRequestId && requestedId === currentSessionId.value) {
        loading.value = false
      }
    }
  }

  async function runSessionScopedMutation(
    sessionId: string,
    operation: () => Promise<unknown>,
    failureMessage: string
  ): Promise<void> {
    if (currentSessionId.value === sessionId) {
      error.value = null
    }
    try {
      await operation()
      if (currentSessionId.value === sessionId) {
        await loadPendingInputs(sessionId)
      }
    } catch (e) {
      if (currentSessionId.value === sessionId) {
        error.value = `${failureMessage}: ${e}`
      }
      throw e
    }
  }

  async function queueInput(sessionId: string, input: string | SendMessageInput): Promise<void> {
    return runSessionScopedMutation(
      sessionId,
      () => sessionClient.queuePendingInput(sessionId, input),
      'Failed to queue message'
    )
  }

  async function resumeQueue(sessionId: string): Promise<boolean> {
    if (resumingSessionId.value !== null) {
      return false
    }
    resumingSessionId.value = sessionId
    let started = false
    try {
      await runSessionScopedMutation(
        sessionId,
        async () => {
          const result = await sessionClient.resumePendingQueue(sessionId)
          started = result.started
        },
        'Failed to resume queued messages'
      )
      return started
    } finally {
      if (resumingSessionId.value === sessionId) {
        resumingSessionId.value = null
      }
    }
  }

  async function retryQueueInput(
    sessionId: string,
    itemId: string
  ): Promise<{ accepted: boolean; started: boolean }> {
    if (retryingItemId.value !== null) {
      return { accepted: false, started: false }
    }
    retryingItemId.value = itemId
    let result = { accepted: false, started: false }
    try {
      await runSessionScopedMutation(
        sessionId,
        async () => {
          result = await sessionClient.retryPendingQueueInput(sessionId, itemId)
        },
        'Failed to retry queued message'
      )
      return result
    } finally {
      if (retryingItemId.value === itemId) {
        retryingItemId.value = null
      }
    }
  }

  async function updateQueueInput(
    sessionId: string,
    itemId: string,
    input: string | SendMessageInput
  ): Promise<void> {
    return runSessionScopedMutation(
      sessionId,
      () => sessionClient.updateQueuedInput(sessionId, itemId, input),
      'Failed to update queued message'
    )
  }

  async function moveQueueInput(sessionId: string, itemId: string, toIndex: number): Promise<void> {
    return runSessionScopedMutation(
      sessionId,
      () => sessionClient.moveQueuedInput(sessionId, itemId, toIndex),
      'Failed to reorder queued message'
    )
  }

  async function steerPendingInput(sessionId: string, itemId: string): Promise<void> {
    return runSessionScopedMutation(
      sessionId,
      () => sessionClient.steerPendingInput(sessionId, itemId),
      'Failed to steer queued message'
    )
  }

  async function deleteInput(sessionId: string, itemId: string): Promise<void> {
    return runSessionScopedMutation(
      sessionId,
      () => sessionClient.deletePendingInput(sessionId, itemId),
      'Failed to delete queued message'
    )
  }

  async function resolveBlockedInput(
    sessionId: string,
    itemId: string,
    action: 'retry' | 'send_without_image_content'
  ): Promise<void> {
    return runSessionScopedMutation(
      sessionId,
      () => sessionClient.resolveBlockedPendingInput(sessionId, itemId, action),
      'Failed to resolve blocked message'
    )
  }

  function clear(): void {
    latestLoadRequestId += 1
    currentSessionId.value = null
    items.value = []
    resumeAvailable.value = false
    loading.value = false
    resumingSessionId.value = null
    retryingItemId.value = null
    error.value = null
  }

  const pendingInputsHandler = (payload: { sessionId: string; version: number }) => {
    if (!payload.sessionId || payload.sessionId !== currentSessionId.value) {
      return
    }
    void loadPendingInputs(payload.sessionId)
  }

  const unsubscribePendingInputsUpdated = sessionClient.onPendingInputsChanged(pendingInputsHandler)
  onScopeDispose(unsubscribePendingInputsUpdated)

  return {
    currentSessionId,
    items,
    resumeAvailable,
    loading,
    resumingQueue,
    retryingItemId,
    error,
    queueItems,
    activeCount,
    isAtCapacity,
    loadPendingInputs,
    queueInput,
    resumeQueue,
    retryQueueInput,
    updateQueueInput,
    moveQueueInput,
    steerPendingInput,
    deleteInput,
    resolveBlockedInput,
    clear
  }
})
