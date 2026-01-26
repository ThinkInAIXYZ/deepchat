/**
 * useSessionConfig - SessionInfo-Driven Configuration
 *
 * Provides configuration management based on SessionInfo.
 * Replaces useChatConfig with SessionInfo-driven configuration.
 *
 * @example
 * ```ts
 * const {
 *   modelId,
 *   modeId,
 *   workspace,
 *   availableModels,
 *   availableModes,
 *   setModel,
 *   setMode
 * } = useSessionConfig(sessionId)
 * ```
 */

import { computed } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useAgenticSession } from './useAgenticSession'

export function useSessionConfig(sessionId: string | undefined | null) {
  const agenticP = usePresenter('agenticPresenter')
  const { sessionInfo } = useAgenticSession(sessionId)

  // Computed properties from session info
  const modelId = computed(() => sessionInfo.value?.currentModelId ?? null)
  const modeId = computed(() => sessionInfo.value?.currentModeId ?? null)
  const workspace = computed(() => sessionInfo.value?.workspace ?? null)
  const agentId = computed(() => sessionInfo.value?.agentId ?? null)
  const status = computed(() => sessionInfo.value?.status ?? null)

  const availableModels = computed(() => sessionInfo.value?.availableModels ?? [])
  const availableModes = computed(() => sessionInfo.value?.availableModes ?? [])
  const capabilities = computed(() => sessionInfo.value?.capabilities)

  // Actions
  const setModel = async (newModelId: string): Promise<void> => {
    if (!sessionId) {
      throw new Error('Cannot set model: no active session')
    }

    try {
      await agenticP.setModel(sessionId, newModelId)
    } catch (error) {
      console.error('[useSessionConfig] Failed to set model:', error)
      throw error
    }
  }

  const setMode = async (newModeId: string): Promise<void> => {
    if (!sessionId) {
      throw new Error('Cannot set mode: no active session')
    }

    try {
      await agenticP.setMode(sessionId, newModeId)
    } catch (error) {
      console.error('[useSessionConfig] Failed to set mode:', error)
      throw error
    }
  }

  // Computed helpers
  const hasModels = computed(() => availableModels.value.length > 0)
  const hasModes = computed(() => availableModes.value.length > 0)
  const supportsVision = computed(() => sessionInfo.value?.capabilities.supportsVision ?? false)
  const supportsTools = computed(() => sessionInfo.value?.capabilities.supportsTools ?? false)
  const supportsModes = computed(() => sessionInfo.value?.capabilities.supportsModes ?? false)

  const currentModel = computed(() => {
    if (!modelId.value) return null
    return availableModels.value.find((m) => m.id === modelId.value) ?? null
  })

  const currentMode = computed(() => {
    if (!modeId.value) return null
    return availableModes.value.find((m) => m.id === modeId.value) ?? null
  })

  const isIdle = computed(() => sessionInfo.value?.status === 'idle')
  const isGenerating = computed(() => sessionInfo.value?.status === 'generating')
  const isPaused = computed(() => sessionInfo.value?.status === 'paused')
  const hasError = computed(() => sessionInfo.value?.status === 'error')

  return {
    // State
    sessionInfo,
    modelId,
    modeId,
    workspace,
    agentId,
    status,

    // Available options
    availableModels,
    availableModes,
    capabilities,

    // Current selection
    currentModel,
    currentMode,

    // Helpers
    hasModels,
    hasModes,
    supportsVision,
    supportsTools,
    supportsModes,

    // Status helpers
    isIdle,
    isGenerating,
    isPaused,
    hasError,

    // Actions
    setModel,
    setMode
  }
}

export type UseSessionConfigReturn = ReturnType<typeof useSessionConfig>
