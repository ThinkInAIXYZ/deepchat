import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useSearchConfig } from '@/composables/useSearchConfig'

describe('useSearchConfig', () => {
  it('exposes search config flags based on model capabilities', () => {
    const supportsSearch = ref<boolean | null>(true)
    const searchDefaults = ref({ forced: true, strategy: 'turbo' as const })

    const api = useSearchConfig({ supportsSearch, searchDefaults })
    expect(api.showSearchConfig.value).toBe(true)
    expect(api.hasForcedSearchOption.value).toBe(true)
    expect(api.hasSearchStrategyOption.value).toBe(true)

    supportsSearch.value = false
    expect(api.showSearchConfig.value).toBe(false)

    searchDefaults.value = {}
    expect(api.hasForcedSearchOption.value).toBe(false)
    expect(api.hasSearchStrategyOption.value).toBe(false)
  })
})
