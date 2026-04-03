import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import { usePresenter } from '@/composables/usePresenter'
import { SESSION_EVENTS } from '@/events'
import type { PendingSessionInputRecord, SendMessageInput } from '@shared/types/agent-interface'

const MAX_PENDING_INPUTS = 5

export const usePendingInputStore = defineStore('pendingInput', () => {
  const agentSessionPresenter = usePresenter('agentSessionPresenter')

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
      const loadedItems = await agentSessionPresenter.listPendingInputs(requestedId)
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
      await agentSessionPresenter.queuePendingInput(sessionId, input)
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
      const updated = await agentSessionPresenter.updateQueuedInput(sessionId, itemId, input)
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
      items.value = await agentSessionPresenter.moveQueuedInput(sessionId, itemId, toIndex)
    } catch (e) {
      error.value = `Failed to reorder queued message: ${e}`
      throw e
    }
  }

  async function convertToSteer(sessionId: string, itemId: string): Promise<void> {
    error.value = null
    try {
      const updated = await agentSessionPresenter.convertPendingInputToSteer(sessionId, itemId)
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
      await agentSessionPresenter.deletePendingInput(sessionId, itemId)
      items.value = items.value.filter((item) => item.id !== itemId)
    } catch (e) {
      error.value = `Failed to delete queued message: ${e}`
      throw e
    }
  }

  async function resumeQueue(sessionId: string): Promise<void> {
    error.value = null
    try {
      await agentSessionPresenter.resumePendingQueue(sessionId)
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

  const pendingInputsHandler = (_: unknown, msg: { sessionId: string }) => {
    if (!msg?.sessionId || msg.sessionId !== currentSessionId.value) {
      return
    }
    void loadPendingInputs(msg.sessionId)
  }

  window.electron.ipcRenderer.on(SESSION_EVENTS.PENDING_INPUTS_UPDATED, pendingInputsHandler)
  onScopeDispose(() => {
    window.electron.ipcRenderer.removeListener(
      SESSION_EVENTS.PENDING_INPUTS_UPDATED,
      pendingInputsHandler
    )
  })

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
