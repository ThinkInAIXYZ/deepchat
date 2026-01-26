/**
 * useAgenticSession - Reactive Session Info Composable
 *
 * Provides reactive access to SessionInfo for a given sessionId.
 * Listens to AgenticEventType.SESSION_UPDATED events to keep data fresh.
 *
 * @example
 * ```ts
 * const sessionInfo = useAgenticSession(sessionId)
 * console.log(sessionInfo.value?.status, sessionInfo.value?.currentModelId)
 * ```
 */

import { computed, ref, watch, onUnmounted } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import type { SessionInfo } from '@shared/types/presenters/agentic.presenter.d'
import { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'

export function useAgenticSession(sessionId: string | undefined | null) {
  const agenticP = usePresenter('agenticPresenter')

  // Local state for session info
  const sessionInfo = ref<SessionInfo | null>(null)
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  // Fetch session info from presenter
  const fetchSessionInfo = async () => {
    if (!sessionId) {
      sessionInfo.value = null
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const info = await agenticP.getSession(sessionId)
      sessionInfo.value = info
    } catch (e) {
      error.value = e as Error
      console.error(`[useAgenticSession] Failed to fetch session info for ${sessionId}:`, e)
    } finally {
      isLoading.value = false
    }
  }

  // Watch for sessionId changes
  watch(
    () => sessionId,
    (newSessionId) => {
      if (newSessionId) {
        fetchSessionInfo()
      } else {
        sessionInfo.value = null
      }
    },
    { immediate: true }
  )

  // Listen to SESSION_UPDATED events
  const handleSessionUpdated = (_event: unknown, payload: { sessionId: string }) => {
    if (payload.sessionId === sessionId) {
      fetchSessionInfo()
    }
  }

  // Register event listener
  window.electron.ipcRenderer.on(AgenticEventType.SESSION_UPDATED, handleSessionUpdated)

  // Cleanup on unmount
  onUnmounted(() => {
    window.electron.ipcRenderer.removeAllListeners(AgenticEventType.SESSION_UPDATED)
  })

  // Computed properties for common use cases
  const status = computed(() => sessionInfo.value?.status ?? null)
  const agentId = computed(() => sessionInfo.value?.agentId ?? null)
  const workspace = computed(() => sessionInfo.value?.workspace ?? null)
  const availableModes = computed(() => sessionInfo.value?.availableModes ?? [])
  const availableModels = computed(() => sessionInfo.value?.availableModels ?? [])
  const availableCommands = computed(() => sessionInfo.value?.availableCommands ?? [])
  const currentModeId = computed(() => sessionInfo.value?.currentModeId)
  const currentModelId = computed(() => sessionInfo.value?.currentModelId)
  const capabilities = computed(() => sessionInfo.value?.capabilities)

  const isIdle = computed(() => sessionInfo.value?.status === 'idle')
  const isGenerating = computed(() => sessionInfo.value?.status === 'generating')
  const isPaused = computed(() => sessionInfo.value?.status === 'paused')
  const hasError = computed(() => sessionInfo.value?.status === 'error')

  const supportsVision = computed(() => sessionInfo.value?.capabilities.supportsVision ?? false)
  const supportsTools = computed(() => sessionInfo.value?.capabilities.supportsTools ?? false)
  const supportsModes = computed(() => sessionInfo.value?.capabilities.supportsModes ?? false)
  const supportsCommands = computed(() => sessionInfo.value?.capabilities.supportsCommands ?? false)

  return {
    // State
    sessionInfo,
    isLoading,
    error,

    // Computed properties
    status,
    agentId,
    workspace,
    availableModes,
    availableModels,
    availableCommands,
    currentModeId,
    currentModelId,
    capabilities,

    // Status helpers
    isIdle,
    isGenerating,
    isPaused,
    hasError,

    // Capability helpers
    supportsVision,
    supportsTools,
    supportsModes,
    supportsCommands,

    // Methods
    refresh: fetchSessionInfo
  }
}

export type UseAgenticSessionReturn = ReturnType<typeof useAgenticSession>
