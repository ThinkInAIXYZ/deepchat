// === Vue Core ===
import { ref, watch, type Ref } from 'vue'

// === Types ===
import type { IPresenter } from '@shared/presenter'

type ConfigPresenter = IPresenter['configPresenter']

// === Interfaces ===
export interface ModelCapabilities {
  supportsReasoning: boolean | null
  budgetRange: {
    min?: number
    max?: number
    default?: number
  } | null
}

export interface UseModelCapabilitiesOptions {
  providerId: Ref<string | undefined>
  modelId: Ref<string | undefined>
  configPresenter: ConfigPresenter
}

/**
 * Composable for fetching and managing model capabilities
 * Handles reasoning support, thinking budget ranges, and search capabilities
 */
export function useModelCapabilities(options: UseModelCapabilitiesOptions) {
  const { providerId, modelId, configPresenter } = options

  // === Local State ===
  const capabilitySupportsReasoning = ref<boolean | null>(null)
  const capabilityBudgetRange = ref<{
    min?: number
    max?: number
    default?: number
  } | null>(null)
  const isLoading = ref(false)

  // === Internal Methods ===
  const resetCapabilities = () => {
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
  }

  const fetchCapabilities = async () => {
    if (!providerId.value || !modelId.value) {
      resetCapabilities()
      return
    }

    isLoading.value = true
    try {
      const [sr, br] = await Promise.all([
        configPresenter.supportsReasoningCapability?.(providerId.value, modelId.value),
        configPresenter.getThinkingBudgetRange?.(providerId.value, modelId.value)
      ])

      capabilitySupportsReasoning.value = typeof sr === 'boolean' ? sr : null
      capabilityBudgetRange.value = br || {}
    } catch (error) {
      resetCapabilities()
      console.error(error)
    } finally {
      isLoading.value = false
    }
  }

  // === Watchers ===
  watch(() => [providerId.value, modelId.value], fetchCapabilities, { immediate: true })

  // === Return Public API ===
  return {
    // Read-only state
    supportsReasoning: capabilitySupportsReasoning,
    budgetRange: capabilityBudgetRange,
    isLoading,
    // Methods
    refresh: fetchCapabilities
  }
}
