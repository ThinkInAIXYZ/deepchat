import { computed, ref } from 'vue'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import type { EntryKey, UseQueryReturn } from '@pinia/colada'
import type { SearchEngineTemplate } from '@shared/chat'
import { useSearchEngineAdapter } from '@/composables/search/useSearchEngineAdapter'

export const useSearchEngineStoreService = () => {
  const searchAdapter = useSearchEngineAdapter()
  let listenersBound = false
  const isInitialized = ref(false)

  const searchEngineListKey: EntryKey = ['search', 'engines'] as const
  const customSearchEngineKey: EntryKey = ['search', 'customEngines'] as const

  const baseSearchEngines = useIpcQuery({
    presenter: 'searchPresenter',
    method: 'getEngines',
    key: () => searchEngineListKey,
    staleTime: 30_000
  }) as UseQueryReturn<SearchEngineTemplate[]>

  const customSearchEngines = useIpcQuery({
    presenter: 'configPresenter',
    method: 'getCustomSearchEngines',
    key: () => customSearchEngineKey,
    staleTime: 60_000
  }) as UseQueryReturn<SearchEngineTemplate[] | null>

  const searchEngines = computed(() => {
    const base = baseSearchEngines.data.value ?? []
    const custom = customSearchEngines.data.value ?? []
    const filtered = base.filter((engine) => !engine.isCustom)
    return [...filtered, ...custom]
  })

  const activeSearchEngine = ref<SearchEngineTemplate | null>(null)

  const refreshSearchEngines = async () => {
    try {
      await Promise.all([baseSearchEngines.refetch(), customSearchEngines.refetch()])
      const activeEngine = await searchAdapter.getActiveEngine()
      activeSearchEngine.value = activeEngine
    } catch (error) {
      console.error('Failed to refresh search engines:', error)
    }
  }

  const fetchCustomSearchEngines = async (): Promise<SearchEngineTemplate[]> => {
    try {
      return (await searchAdapter.getCustomSearchEngines()) ?? []
    } catch (error) {
      console.error('Failed to load custom search engines:', error)
      return []
    }
  }

  const persistCustomSearchEngines = async (engines: SearchEngineTemplate[]) => {
    await searchAdapter.setCustomSearchEngines(engines)
    await refreshSearchEngines()
  }

  const addCustomSearchEngine = async (engine: SearchEngineTemplate): Promise<boolean> => {
    try {
      const customEngines = await fetchCustomSearchEngines()
      customEngines.push(engine)
      await persistCustomSearchEngines(customEngines)
      return true
    } catch (error) {
      console.error('Failed to add custom search engine:', error)
      return false
    }
  }

  const deleteCustomSearchEngine = async (engineId: string): Promise<boolean> => {
    try {
      const customEngines = await fetchCustomSearchEngines()
      const filtered = customEngines.filter((engine) => engine.id !== engineId)
      if (filtered.length === customEngines.length) {
        return false
      }
      await persistCustomSearchEngines(filtered)
      return true
    } catch (error) {
      console.error('Failed to delete custom search engine:', error)
      return false
    }
  }

  const ensureActiveSearchEngine = async () => {
    const preferredEngineId = (await searchAdapter.getSetting<string>('searchEngine')) || 'google'
    const matchedEngine = searchEngines.value.find((item) => item.id === preferredEngineId)
    const fallbackEngine = searchEngines.value[0]
    const targetEngine = matchedEngine || fallbackEngine || null
    activeSearchEngine.value = targetEngine

    const targetId = targetEngine?.id ?? preferredEngineId
    if (!targetId) return

    try {
      await searchAdapter.setActiveEngine(targetId)
    } catch (error) {
      console.error('Failed to set active search engine:', error)
    }
  }

  const invalidateSearchEngineKeys = (): EntryKey[] => [searchEngineListKey, customSearchEngineKey]

  const setSearchEngineMutation = useIpcMutation({
    presenter: 'searchPresenter',
    method: 'setActiveEngine',
    invalidateQueries: () => invalidateSearchEngineKeys()
  })

  const setSearchEngine = async (engineId: string) => {
    try {
      let success = await setSearchEngineMutation.mutateAsync([engineId])

      if (!success) {
        console.log('Retrying search engine selection after refresh')
        await refreshSearchEngines()
        success = await setSearchEngineMutation.mutateAsync([engineId])
      }

      if (success) {
        const engine = searchEngines.value.find((item) => item.id === engineId) || null
        activeSearchEngine.value = engine
        await searchAdapter.setSetting('searchEngine', engineId)
      } else {
        console.error('Failed to set search engine:', engineId)
      }

      return success
    } catch (error) {
      console.error('Failed to set search engine:', error)
      throw error
    }
  }

  const bindEventListeners = () => {
    if (listenersBound) {
      return () => undefined
    }
    listenersBound = true

    const unsubscribe = searchAdapter.onSearchEnginesUpdated(async () => {
      try {
        await refreshSearchEngines()
        const currentActiveEngineId = await searchAdapter.getSetting<string>('searchEngine')
        if (currentActiveEngineId) {
          const engine = searchEngines.value.find((item) => item.id === currentActiveEngineId)
          if (engine) {
            activeSearchEngine.value = engine
            await searchAdapter.setActiveEngine(currentActiveEngineId)
          }
        }
      } catch (error) {
        console.error('Failed to update search engines:', error)
      }
    })

    return () => {
      unsubscribe()
      listenersBound = false
    }
  }

  const initialize = async () => {
    if (isInitialized.value) return
    isInitialized.value = true
    await refreshSearchEngines()
    await ensureActiveSearchEngine()
  }

  const testSearchEngine = async (query = 'weather'): Promise<boolean> => {
    try {
      return await searchAdapter.testEngine(query)
    } catch (error) {
      console.error('Failed to test search engine', error)
      return false
    }
  }

  return {
    searchEngines,
    activeSearchEngine,
    initialize,
    setSearchEngine,
    refreshSearchEngines,
    addCustomSearchEngine,
    deleteCustomSearchEngine,
    fetchCustomSearchEngines,
    testSearchEngine,
    bindEventListeners
  }
}
