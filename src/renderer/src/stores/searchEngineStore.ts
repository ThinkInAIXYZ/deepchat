import { defineStore } from 'pinia'
import { ref } from 'vue'
import { SearchEngineTemplate } from '@shared/chat'
import { CONFIG_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'

export const useSearchEngineStore = defineStore('searchEngine', () => {
  const configP = usePresenter('configPresenter')
  const threadP = usePresenter('threadPresenter')
  const searchEngines = ref<SearchEngineTemplate[]>([])
  const activeSearchEngine = ref<SearchEngineTemplate | null>(null)
  let listenerRegistered = false

  const mergeCustomSearchEngines = async (engines: SearchEngineTemplate[]) => {
    const filteredEngines = engines.filter((engine) => !engine.isCustom)

    try {
      const customEngines = (await configP.getCustomSearchEngines()) ?? []
      if (customEngines.length > 0) {
        filteredEngines.push(...customEngines)
      }
    } catch (error) {
      console.error('加载自定义搜索引擎失败:', error)
    }

    searchEngines.value = filteredEngines
  }

  const refreshSearchEngines = async () => {
    try {
      const engines = await threadP.getSearchEngines()
      await mergeCustomSearchEngines(engines)
      const activeEngine = await threadP.getActiveSearchEngine()
      activeSearchEngine.value = activeEngine
    } catch (error) {
      console.error('刷新搜索引擎列表失败', error)
    }
  }

  const ensureActiveSearchEngine = async () => {
    const preferredEngineId = (await configP.getSetting<string>('searchEngine')) || 'google'

    const engine = searchEngines.value.find((item) => item.id === preferredEngineId)
    activeSearchEngine.value = engine || searchEngines.value[0] || null

    const targetId = engine?.id ?? searchEngines.value[0]?.id ?? preferredEngineId
    if (targetId) {
      try {
        await threadP.setActiveSearchEngine(targetId)
      } catch (error) {
        console.error('设置活跃搜索引擎失败:', error)
      }
    }
  }

  const setupSearchEnginesListener = () => {
    if (listenerRegistered) {
      return
    }
    listenerRegistered = true

    window.electron.ipcRenderer.on(CONFIG_EVENTS.SEARCH_ENGINES_UPDATED, async () => {
      try {
        const engines = await threadP.getSearchEngines()
        await mergeCustomSearchEngines(engines)
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

  const setSearchEngine = async (engineId: string) => {
    try {
      let success = await threadP.setSearchEngine(engineId)

      if (!success) {
        console.log('第一次设置搜索引擎失败，尝试刷新搜索引擎列表后重试')
        await refreshSearchEngines()
        success = await threadP.setSearchEngine(engineId)
      }

      if (success) {
        let engine = searchEngines.value.find((item) => item.id === engineId)
        if (!engine) {
          try {
            const customEngines = await configP.getCustomSearchEngines()
            engine = customEngines?.find((item) => item.id === engineId) ?? null
          } catch (error) {
            console.warn('获取自定义搜索引擎失败:', error)
          }
        }

        activeSearchEngine.value = engine || null
        await configP.setSetting('searchEngine', engineId)
      } else {
        console.error('设置搜索引擎失败，engineId:', engineId)
      }
    } catch (error) {
      console.error('设置搜索引擎失败', error)
    }
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
