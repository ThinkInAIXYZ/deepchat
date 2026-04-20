import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { SessionClient } from '@api/SessionClient'
import type { PendingSessionInputRecord, SendMessageInput } from '@shared/types/agent-interface'

const MAX_PENDING_INPUTS = 5

export const usePendingInputStore = defineStore('pendingInput', () => {
  const sessionClient = new SessionClient()

  const currentSessionId = ref<string | null>(null)
  const items = ref<PendingSessionInputRecord[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const steerItems = computed(() => items.value.filter((item) => item.mode === 'steer'))
  const queueItems = computed(() =>
    items.value
      .filter((item) => item.mode === 'queue')
      .sort((left, right) => (left.queueOrder ?? 0) - (right.queueOrder ?? 0))
  )
  const activeCount = computed(() => items.value.length)
  const isAtCapacity = computed(() => activeCount.value >= MAX_PENDING_INPUTS)

  async function loadPendingInputs(sessionId: string): Promise<void> {
    const requestedId = sessionId
    currentSessionId.value = requestedId
    loading.value = true
    error.value = null
    try {
      const loadedItems = await sessionClient.listPendingInputs(requestedId)
      if (requestedId !== currentSessionId.value) {
        return
      }
      items.value = loadedItems
    } catch (e) {
      if (requestedId !== currentSessionId.value) {
        return
      }
      error.value = `Failed to load pending inputs: ${e}`
    } finally {
      if (requestedId === currentSessionId.value) {
        loading.value = false
      }
    }
  }

  async function queueInput(sessionId: string, input: string | SendMessageInput): Promise<void> {
    error.value = null
    try {
      await sessionClient.queuePendingInput(sessionId, input)
      if (currentSessionId.value === sessionId) {
        await loadPendingInputs(sessionId)
      }
    } catch (e) {
      error.value = `Failed to queue message: ${e}`
      throw e
    }
  }

  async function updateQueueInput(
    sessionId: string,
    itemId: string,
    input: string | SendMessageInput
  ): Promise<void> {
    error.value = null
    try {
      const updated = await sessionClient.updateQueuedInput(sessionId, itemId, input)
      items.value = items.value.map((item) => (item.id === updated.id ? updated : item))
      if (currentSessionId.value === sessionId) {
        await loadPendingInputs(sessionId)
      }
    } catch (e) {
      error.value = `Failed to update queued message: ${e}`
      throw e
    }
  }

  async function moveQueueInput(sessionId: string, itemId: string, toIndex: number): Promise<void> {
    error.value = null
    try {
      items.value = await sessionClient.moveQueuedInput(sessionId, itemId, toIndex)
    } catch (e) {
      error.value = `Failed to reorder queued message: ${e}`
      throw e
    }
  }

  async function convertToSteer(sessionId: string, itemId: string): Promise<void> {
    error.value = null
    try {
      const updated = await sessionClient.convertPendingInputToSteer(sessionId, itemId)
      items.value = items.value.map((item) => (item.id === updated.id ? updated : item))
      if (currentSessionId.value === sessionId) {
        await loadPendingInputs(sessionId)
      }
    } catch (e) {
      error.value = `Failed to convert queued message to steer: ${e}`
      throw e
    }
  }

  async function deleteInput(sessionId: string, itemId: string): Promise<void> {
    error.value = null
    try {
      await sessionClient.deletePendingInput(sessionId, itemId)
      items.value = items.value.filter((item) => item.id !== itemId)
    } catch (e) {
      error.value = `Failed to delete queued message: ${e}`
      throw e
    }
  }

  async function resumeQueue(sessionId: string): Promise<void> {
    error.value = null
    try {
      await sessionClient.resumePendingQueue(sessionId)
      if (currentSessionId.value === sessionId) {
        await loadPendingInputs(sessionId)
      }
    } catch (e) {
      error.value = `Failed to resume queue: ${e}`
      throw e
    }
  }

  function clear(): void {
    currentSessionId.value = null
    items.value = []
    loading.value = false
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
    loading,
    error,
    steerItems,
    queueItems,
    activeCount,
    isAtCapacity,
    loadPendingInputs,
    queueInput,
    updateQueueInput,
    moveQueueInput,
    convertToSteer,
    deleteInput,
    resumeQueue,
    clear
  }
})
