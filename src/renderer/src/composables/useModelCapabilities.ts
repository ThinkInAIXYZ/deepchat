// === Vue Core ===
import { ref, watch, type Ref } from 'vue'

import { createModelClient } from '@api/ModelClient'

// === Interfaces ===
export interface ModelCapabilities {
  supportsReasoning: boolean | null
  budgetRange: {
    min?: number
    max?: number
    default?: number
  } | null
  supportsSearch: boolean | null
  searchDefaults: {
    default?: boolean
    forced?: boolean
    strategy?: 'turbo' | 'max'
  } | null
}

export interface UseModelCapabilitiesOptions {
  providerId: Ref<string | undefined>
  modelId: Ref<string | undefined>
}

/**
 * Composable for fetching and managing model capabilities
 * Handles reasoning support, thinking budget ranges, and search capabilities
 */
export function useModelCapabilities(options: UseModelCapabilitiesOptions) {
  const { providerId, modelId } = options
  const modelClient = createModelClient()

  // === Local State ===
  const capabilitySupportsReasoning = ref<boolean | null>(null)
  const capabilityBudgetRange = ref<{
    min?: number
    max?: number
    default?: number
  } | null>(null)
  const capabilitySupportsSearch = ref<boolean | null>(null)
  const capabilitySearchDefaults = ref<{
    default?: boolean
    forced?: boolean
    strategy?: 'turbo' | 'max'
  } | null>(null)
  const isLoading = ref(false)
  let requestId = 0

  // === Internal Methods ===
  const resetCapabilities = () => {
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsSearch.value = null
    capabilitySearchDefaults.value = null
  }

  const fetchCapabilities = async () => {
    const currentRequestId = ++requestId
    const currentProviderId = providerId.value
    const currentModelId = modelId.value

    if (!currentProviderId || !currentModelId) {
      resetCapabilities()
      isLoading.value = false
      return
    }

    isLoading.value = true
    try {
      const [sr, br, ss, sd] = await Promise.all([
        modelClient.supportsReasoningCapability(currentProviderId, currentModelId),
        modelClient.getThinkingBudgetRange(currentProviderId, currentModelId),
        modelClient.supportsSearchCapability(currentProviderId, currentModelId),
        modelClient.getSearchDefaults(currentProviderId, currentModelId)
      ])

      if (currentRequestId !== requestId) return

      capabilitySupportsReasoning.value = typeof sr === 'boolean' ? sr : null
      capabilityBudgetRange.value = br || {}
      capabilitySupportsSearch.value = typeof ss === 'boolean' ? ss : null
      capabilitySearchDefaults.value = sd || {}
    } catch (error) {
      if (currentRequestId !== requestId) return

      resetCapabilities()
      console.error(error)
    } finally {
      if (currentRequestId === requestId) {
        isLoading.value = false
      }
    }
  }

  // === Watchers ===
  watch(() => [providerId.value, modelId.value], fetchCapabilities, { immediate: true })

  // === Return Public API ===
  return {
    // Read-only state
    supportsReasoning: capabilitySupportsReasoning,
    budgetRange: capabilityBudgetRange,
    supportsSearch: capabilitySupportsSearch,
    searchDefaults: capabilitySearchDefaults,
    isLoading,
    // Methods
    refresh: fetchCapabilities
  }
}
