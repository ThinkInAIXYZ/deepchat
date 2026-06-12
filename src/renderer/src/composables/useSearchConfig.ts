import { computed, type Ref } from 'vue'

interface SearchDefaults {
  forced?: boolean
  strategy?: 'turbo' | 'max'
}

interface UseSearchConfigOptions {
  supportsSearch: Ref<boolean | null>
  searchDefaults: Ref<SearchDefaults | null>
}

export function useSearchConfig(options: UseSearchConfigOptions) {
  const showSearchConfig = computed(() => options.supportsSearch.value === true)
  const hasForcedSearchOption = computed(
    () => showSearchConfig.value && typeof options.searchDefaults.value?.forced === 'boolean'
  )
  const hasSearchStrategyOption = computed(
    () => showSearchConfig.value && typeof options.searchDefaults.value?.strategy === 'string'
  )

  return {
    showSearchConfig,
    hasForcedSearchOption,
    hasSearchStrategyOption
  }
}
