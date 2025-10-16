// === Vue Core ===
import { computed, type ComputedRef, type Ref } from 'vue'

// === Interfaces ===
export interface SearchDefaults {
  default?: boolean
  forced?: boolean
  strategy?: 'turbo' | 'max'
}

export interface UseSearchConfigOptions {
  supportsSearch: Ref<boolean | null>
  searchDefaults: Ref<SearchDefaults | null>
}

export interface UseSearchConfigReturn {
  showSearchConfig: ComputedRef<boolean>
  hasForcedSearchOption: ComputedRef<boolean>
  hasSearchStrategyOption: ComputedRef<boolean>
}

/**
 * Composable for managing search configuration display logic
 * Determines which search options should be visible based on model capabilities
 */
export function useSearchConfig(options: UseSearchConfigOptions): UseSearchConfigReturn {
  const { supportsSearch, searchDefaults } = options

  // === Computed Properties ===

  /**
   * Determines if search configuration UI should be visible
   * Only show if model explicitly supports search capability
   */
  const showSearchConfig = computed(() => supportsSearch.value === true)

  /**
   * Checks if forced search option is available
   * Based on whether search defaults include forced configuration
   */
  const hasForcedSearchOption = computed(() => searchDefaults.value?.forced !== undefined)

  /**
   * Checks if search strategy option is available
   * Based on whether search defaults include strategy configuration
   */
  const hasSearchStrategyOption = computed(() => searchDefaults.value?.strategy !== undefined)

  // === Return Public API ===
  return {
    showSearchConfig,
    hasForcedSearchOption,
    hasSearchStrategyOption
  }
}
