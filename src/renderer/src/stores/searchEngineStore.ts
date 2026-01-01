import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { SearchEngineTemplate } from '@shared/chat'
import { CONFIG_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import type { EntryKey, UseQueryReturn } from '@pinia/colada'

export const useSearchEngineStore = defineStore('searchEngine', () => {
  const configP = usePresenter('configPresenter')
  const threadP = usePresenter('agentPresenter')

  const searchEngineListKey: EntryKey = ['search', 'engines'] as const
  const customSearchEngineKey: EntryKey = ['search', 'customEngines'] as const

  const baseSearchEngines = useIpcQuery({
    presenter: 'agentPresenter',
    method: 'getSearchEngines',
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
  let listenerRegistered = false

  const refreshSearchEngines = async () => {
    try {
      await Promise.all([baseSearchEngines.refetch(), customSearchEngines.refetch()])
      const activeEngine = await threadP.getActiveSearchEngine()
      activeSearchEngine.value = activeEngine
    } catch (error) {
      console.error('刷新搜索引擎列表失败', error)
    }
  }

  const ensureActiveSearchEngine = async () => {
    const preferredEngineId = (await configP.getSetting<string>('searchEngine')) || 'google'
    const matchedEngine = searchEngines.value.find((item) => item.id === preferredEngineId)
    const fallbackEngine = searchEngines.value[0]
    const targetEngine = matchedEngine || fallbackEngine || null
    activeSearchEngine.value = targetEngine

    const targetId = targetEngine?.id ?? preferredEngineId
    if (!targetId) return

    try {
      await threadP.setActiveSearchEngine(targetId)
    } catch (error) {
      console.error('设置活跃搜索引擎失败:', error)
    }
  }

  const invalidateSearchEngineKeys = (): EntryKey[] => [searchEngineListKey, customSearchEngineKey]

  const setSearchEngineMutation = useIpcMutation({
    presenter: 'agentPresenter',
    method: 'setSearchEngine',
    invalidateQueries: () => invalidateSearchEngineKeys()
  })

  const setSearchEngine = async (engineId: string) => {
    try {
      let success = await setSearchEngineMutation.mutateAsync([engineId])

      if (!success) {
        console.log('第一次设置搜索引擎失败，尝试刷新搜索引擎列表后重试')
        await refreshSearchEngines()
        success = await setSearchEngineMutation.mutateAsync([engineId])
      }

      if (success) {
        const engine = searchEngines.value.find((item) => item.id === engineId) || null
        activeSearchEngine.value = engine
        await configP.setSetting('searchEngine', engineId)
      } else {
        console.error('设置搜索引擎失败，engineId:', engineId)
      }

      return success
    } catch (error) {
      console.error('设置搜索引擎失败', error)
      throw error
    }
  }

  const setupSearchEnginesListener = () => {
    if (listenerRegistered) {
      return
    }
    listenerRegistered = true

    window.electron.ipcRenderer.on(CONFIG_EVENTS.SEARCH_ENGINES_UPDATED, async () => {
      try {
        await refreshSearchEngines()
        const currentActiveEngineId = await configP.getSetting<string>('searchEngine')
        if (currentActiveEngineId) {
          const engine = searchEngines.value.find((item) => item.id === currentActiveEngineId)
          if (engine) {
            activeSearchEngine.value = engine
            await threadP.setActiveSearchEngine(currentActiveEngineId)
          }
        }
      } catch (error) {
        console.error('更新自定义搜索引擎失败:', error)
      }
    })
  }

  const initialize = async () => {
    await refreshSearchEngines()
    await ensureActiveSearchEngine()
    setupSearchEnginesListener()
  }

  const testSearchEngine = async (query = '天气'): Promise<boolean> => {
    try {
      return await threadP.testSearchEngine(query)
    } catch (error) {
      console.error('测试搜索引擎失败', error)
      return false
    }
  }

  return {
    searchEngines,
    activeSearchEngine,
    initialize,
    setSearchEngine,
    refreshSearchEngines,
    testSearchEngine,
    setupSearchEnginesListener
  }
})
