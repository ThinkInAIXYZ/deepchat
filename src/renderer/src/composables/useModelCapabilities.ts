// === Vue Core ===
import { ref, watch, type Ref } from 'vue'
import { usePresenter } from '@/composables/usePresenter'

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
  supportsSearch: boolean | null
  searchDefaults: {
    default?: boolean
    forced?: boolean
    strategy?: 'turbo' | 'max'
  } | null
  supportsReasoningEffort: boolean | null
  reasoningEffortDefault?: 'minimal' | 'low' | 'medium' | 'high'
  supportsVerbosity: boolean | null
  verbosityDefault?: 'low' | 'medium' | 'high'
}

export interface UseModelCapabilitiesOptions {
  providerId: Ref<string | undefined>
  modelId: Ref<string | undefined>
  configPresenter?: ConfigPresenter
}

/**
 * Composable for fetching and managing model capabilities
 * Handles reasoning support, thinking budget ranges, and search capabilities
 */
export function useModelCapabilities(options: UseModelCapabilitiesOptions) {
  const { providerId, modelId } = options
  const configPresenter = options.configPresenter ?? usePresenter('configPresenter')

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
  const capabilitySupportsReasoningEffort = ref<boolean | null>(null)
  const capabilityReasoningEffortDefault = ref<'minimal' | 'low' | 'medium' | 'high' | undefined>(
    undefined
  )
  const capabilitySupportsVerbosity = ref<boolean | null>(null)
  const capabilityVerbosityDefault = ref<'low' | 'medium' | 'high' | undefined>(undefined)
  const isLoading = ref(false)

  // === Internal Methods ===
  const resetCapabilities = () => {
    capabilitySupportsReasoning.value = null
    capabilityBudgetRange.value = null
    capabilitySupportsSearch.value = null
    capabilitySearchDefaults.value = null
    capabilitySupportsReasoningEffort.value = null
    capabilityReasoningEffortDefault.value = undefined
    capabilitySupportsVerbosity.value = null
    capabilityVerbosityDefault.value = undefined
  }

  const fetchCapabilities = async () => {
    if (!providerId.value || !modelId.value) {
      resetCapabilities()
      return
    }

    isLoading.value = true
    try {
      const [sr, br, ss, sd, se, ed, sv, vd] = await Promise.all([
        configPresenter.supportsReasoningCapability?.(providerId.value, modelId.value),
        configPresenter.getThinkingBudgetRange?.(providerId.value, modelId.value),
        configPresenter.supportsSearchCapability?.(providerId.value, modelId.value),
        configPresenter.getSearchDefaults?.(providerId.value, modelId.value),
        configPresenter.supportsReasoningEffortCapability?.(providerId.value, modelId.value),
        configPresenter.getReasoningEffortDefault?.(providerId.value, modelId.value),
        configPresenter.supportsVerbosityCapability?.(providerId.value, modelId.value),
        configPresenter.getVerbosityDefault?.(providerId.value, modelId.value)
      ])

      capabilitySupportsReasoning.value = typeof sr === 'boolean' ? sr : null
      capabilityBudgetRange.value = br || {}
      capabilitySupportsSearch.value = typeof ss === 'boolean' ? ss : null
      capabilitySearchDefaults.value = sd || null
      capabilitySupportsReasoningEffort.value = typeof se === 'boolean' ? se : null
      capabilityReasoningEffortDefault.value = ed
      capabilitySupportsVerbosity.value = typeof sv === 'boolean' ? sv : null
      capabilityVerbosityDefault.value = vd
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
    supportsSearch: capabilitySupportsSearch,
    searchDefaults: capabilitySearchDefaults,
    supportsReasoningEffort: capabilitySupportsReasoningEffort,
    reasoningEffortDefault: capabilityReasoningEffortDefault,
    supportsVerbosity: capabilitySupportsVerbosity,
    verbosityDefault: capabilityVerbosityDefault,
    isLoading,
    // Methods
    refresh: fetchCapabilities
  }
}
