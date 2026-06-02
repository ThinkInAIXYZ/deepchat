// === Vue Core ===
import { ref, watch, type Ref } from 'vue'

import { createModelClient } from '@api/ModelClient'
import type { ReasoningPortrait } from '@shared/types/model-db'
import type { ThinkingBudgetRange } from './useThinkingBudget'

const normalizeBudgetRange = (
  budget: ReasoningPortrait['budget'] | ThinkingBudgetRange | null | undefined
): ThinkingBudgetRange | null => {
  if (!budget) return null

  const range: ThinkingBudgetRange = {}
  if (typeof budget.min === 'number') range.min = budget.min
  if (typeof budget.max === 'number') range.max = budget.max
  if (typeof budget.default === 'number') range.default = budget.default
  if (typeof budget.auto === 'number') range.auto = budget.auto
  if (typeof budget.off === 'number') range.off = budget.off
  if (typeof budget.unit === 'string') range.unit = budget.unit

  return Object.keys(range).length > 0 ? range : null
}

const mergeBudgetRanges = (
  base: ReasoningPortrait['budget'] | ThinkingBudgetRange | null | undefined,
  overlay: ReasoningPortrait['budget'] | ThinkingBudgetRange | null | undefined
): ThinkingBudgetRange | null => {
  const normalizedBase = normalizeBudgetRange(base) ?? {}
  const normalizedOverlay = normalizeBudgetRange(overlay) ?? {}
  const merged = {
    ...normalizedBase,
    ...normalizedOverlay
  }

  return Object.keys(merged).length > 0 ? merged : null
}

// === Interfaces ===
export interface ModelCapabilities {
  supportsReasoning: boolean | null
  budgetRange: ThinkingBudgetRange | null
  supportsSearch: boolean | null
  searchDefaults: {
    default?: boolean
    forced?: boolean
    strategy?: 'turbo' | 'max'
  } | null
  supportsTemperatureControl: boolean | null
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
  const capabilityBudgetRange = ref<ThinkingBudgetRange | null>(null)
  const capabilitySupportsSearch = ref<boolean | null>(null)
  const capabilitySupportsTemperatureControl = ref<boolean | null>(null)
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
    capabilitySupportsTemperatureControl.value = null
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
      const capabilities = await modelClient.getCapabilities(currentProviderId, currentModelId)

      if (currentRequestId !== requestId) return

      capabilitySupportsReasoning.value =
        typeof capabilities.supportsReasoning === 'boolean' ? capabilities.supportsReasoning : null
      capabilityBudgetRange.value = mergeBudgetRanges(
        capabilities.thinkingBudgetRange,
        capabilities.reasoningPortrait?.budget
      )
      capabilitySupportsSearch.value =
        typeof capabilities.supportsSearch === 'boolean' ? capabilities.supportsSearch : null
      capabilitySearchDefaults.value = capabilities.searchDefaults || {}
      capabilitySupportsTemperatureControl.value =
        typeof capabilities.supportsTemperatureControl === 'boolean'
          ? capabilities.supportsTemperatureControl
          : typeof capabilities.temperatureCapability === 'boolean'
            ? capabilities.temperatureCapability
            : null
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
    supportsTemperatureControl: capabilitySupportsTemperatureControl,
    isLoading,
    // Methods
    refresh: fetchCapabilities
  }
}
