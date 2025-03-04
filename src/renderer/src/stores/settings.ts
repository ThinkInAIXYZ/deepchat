import { defineStore } from 'pinia'
import { ref, onMounted, toRaw, computed } from 'vue'
import type { LLM_PROVIDER, RENDERER_MODEL_META } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import { useI18n } from 'vue-i18n'
import { SearchEngineTemplate } from '@shared/chat'
import { CONFIG_EVENTS, UPDATE_EVENTS } from '@/events'

export const useSettingsStore = defineStore('settings', () => {
  const configP = usePresenter('configPresenter')
  const llmP = usePresenter('llmproviderPresenter')
  const upgradeP = usePresenter('upgradePresenter')
  const threadP = usePresenter('threadPresenter')
  const { locale } = useI18n()
  const providers = ref<LLM_PROVIDER[]>([])
  const theme = ref<string>('system')
  const language = ref<string>('system')
  const enabledModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const allProviderModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const customModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const hasUpdate = ref(false)
  const updateInfo = ref<{
    version: string
    releaseDate: string
    releaseNotes: string | undefined
  } | null>(null)
  const isChecking = ref(false)
  const searchEngines = ref<SearchEngineTemplate[]>([])
  const activeSearchEngine = ref<string>('google')

  // 搜索助手模型相关
  const searchAssistantModelRef = ref<RENDERER_MODEL_META | null>(null)
  const searchAssistantProviderRef = ref<string>('')

  // 搜索助手模型计算属性
  const searchAssistantModel = computed(() => searchAssistantModelRef.value)

  // 模型匹配字符串数组，按优先级排序
  const searchAssistantModelPriorities = [
    'gpt-3.5',
    'Qwen2.5-32B',
    'Qwen2.5-14B',
    'Qwen2.5-7B',
    '14B',
    '7B',
    '32B',
    'deepseek-chat'
  ]

  // 查找符合优先级的模型
  const findPriorityModel = (): { model: RENDERER_MODEL_META; providerId: string } | null => {
    if (!enabledModels.value || enabledModels.value.length === 0) {
      return null
    }

    for (const priorityKey of searchAssistantModelPriorities) {
      for (const providerModels of enabledModels.value) {
        for (const model of providerModels.models) {
          if (
            model.id.toLowerCase().includes(priorityKey.toLowerCase()) ||
            model.name.toLowerCase().includes(priorityKey.toLowerCase())
          ) {
            return {
              model,
              providerId: providerModels.providerId
            }
          }
        }
      }
    }

    // 如果没有找到匹配优先级的模型，返回第一个可用的模型
    if (enabledModels.value[0]?.models.length > 0) {
      return {
        model: enabledModels.value[0].models[0],
        providerId: enabledModels.value[0].providerId
      }
    }

    return null
  }

  // 设置搜索助手模型
  const setSearchAssistantModel = async (model: RENDERER_MODEL_META, providerId: string) => {
    const _model = toRaw(model)
    searchAssistantModelRef.value = _model
    searchAssistantProviderRef.value = providerId

    await configP.setSetting('searchAssistantModel', {
      model: _model,
      providerId
    })

    // 通知更新搜索助手模型
    threadP.setSearchAssistantModel(_model, providerId)
  }

  // 初始化或更新搜索助手模型
  const initOrUpdateSearchAssistantModel = async () => {
    // 尝试从配置中加载搜索助手模型
    let savedModel = await configP.getSetting<{ model: RENDERER_MODEL_META; providerId: string }>(
      'searchAssistantModel'
    )
    savedModel = toRaw(savedModel)
    if (savedModel) {
      // 检查保存的模型是否仍然可用
      const provider = enabledModels.value.find((p) => p.providerId === savedModel.providerId)
      const modelExists = provider?.models.some((m) => m.id === savedModel.model.id)

      if (modelExists) {
        searchAssistantModelRef.value = savedModel.model
        searchAssistantProviderRef.value = savedModel.providerId
        // 通知线程处理器更新搜索助手模型
        threadP.setSearchAssistantModel(savedModel.model, savedModel.providerId)
        return
      }
    }

    // 如果没有保存的模型或模型不再可用，查找符合优先级的模型
    let priorityModel = findPriorityModel()
    priorityModel = toRaw(priorityModel)
    if (priorityModel) {
      searchAssistantModelRef.value = priorityModel.model
      searchAssistantProviderRef.value = priorityModel.providerId

      await configP.setSetting('searchAssistantModel', {
        model: toRaw(priorityModel.model),
        providerId: priorityModel.providerId
      })

      // 通知线程处理器更新搜索助手模型
      threadP.setSearchAssistantModel(toRaw(priorityModel.model), priorityModel.providerId)
    }
  }

  // 初始化配置
  const initSettings = async () => {
    providers.value = await configP.getProviders()
    theme.value = (await configP.getSetting<string>('theme')) || 'system'
    language.value = (await configP.getSetting<string>('language')) || 'system'

    // 初始化搜索引擎配置
    searchEngines.value = await threadP.getSearchEngines()
    const savedEngine = await configP.getSetting<string>('searchEngine')
    if (savedEngine && searchEngines.value.find((e) => e.name === savedEngine)) {
      activeSearchEngine.value = savedEngine
      threadP.setActiveSearchEngine(savedEngine)
    } else {
      activeSearchEngine.value = searchEngines.value[0]?.name || 'google'
      threadP.setActiveSearchEngine(activeSearchEngine.value)
    }

    // 设置当前语言
    locale.value = await configP.getLanguage()

    await refreshAllModels()

    // 初始化搜索助手模型
    await initOrUpdateSearchAssistantModel()
  }

  // 刷新所有模型列表
  const refreshAllModels = async () => {
    const activeProviders = providers.value.filter((p) => p.enable)
    allProviderModels.value = []
    enabledModels.value = []
    customModels.value = []
    for (const provider of activeProviders) {
      try {
        // 获取在线模型
        let models = await configP.getProviderModels(provider.id)
        if (!models || models.length === 0) {
          const modelMetas = await llmP.getModelList(provider.id)
          if (modelMetas) {
            models = modelMetas.map((meta) => ({
              id: meta.id,
              name: meta.name,
              contextLength: meta.contextLength || 4096,
              maxTokens: meta.maxTokens || 2048,
              provider: provider.id,
              group: meta.group,
              enabled: false,
              isCustom: meta.isCustom,
              providerId: provider.id
            }))
          }
        }

        // 获取模型状态并合并
        const modelsWithStatus = await Promise.all(
          models.map(async (model) => {
            // 获取模型状态
            const enabled = await configP.getModelStatus(provider.id, model.id)
            return {
              ...model,
              enabled
            }
          })
        )

        // 获取自定义模型
        const customModelsList = await llmP.getCustomModels(provider.id)
        // 获取自定义模型状态并合并
        const customModelsWithStatus = await Promise.all(
          customModelsList.map(async (model) => {
            // 获取模型状态
            const enabled = await configP.getModelStatus(provider.id, model.id)

            return {
              ...model,
              enabled,
              isCustom: true
            } as RENDERER_MODEL_META
          })
        )

        const existingIndex = customModels.value.findIndex(
          (item) => item.providerId === provider.id
        )
        if (existingIndex !== -1) {
          customModels.value[existingIndex].models = customModelsWithStatus
        } else {
          customModels.value.push({
            providerId: provider.id,
            models: customModelsWithStatus
          })
        }

        // 合并在线和自定义模型
        const allModels = [
          ...modelsWithStatus,
          ...customModelsWithStatus.map((model) => ({
            ...model,
            isCustom: true
          }))
        ]
        const findAllProviderModelIndex = allProviderModels.value.findIndex(
          (item) => item.providerId === provider.id
        )
        if (findAllProviderModelIndex !== -1) {
          allProviderModels.value[findAllProviderModelIndex].models = allModels
        } else {
          allProviderModels.value.push({
            providerId: provider.id,
            models: allModels
          })
        }

        const existingEnabledIndex = enabledModels.value.findIndex(
          (item) => item.providerId === provider.id
        )
        const enabledModelsData = {
          providerId: provider.id,
          models: allModels.filter((model) => model.enabled !== false)
        }
        if (provider.id === 'ollama') {
          // ollama 管理由 ollama 接管
          enabledModelsData.models = allModels
        }
        if (existingEnabledIndex !== -1) {
          enabledModels.value[existingEnabledIndex].models = enabledModelsData.models
        } else {
          enabledModels.value.push(enabledModelsData)
        }
      } catch (error) {
        console.error(`Failed to fetch models for provider ${provider.id}:`, error)
      }
    }

    // 刷新模型列表后，检查并更新搜索助手模型
    if (searchAssistantModelRef.value) {
      const provider = enabledModels.value.find(
        (p) => p.providerId === searchAssistantProviderRef.value
      )
      const modelExists = provider?.models.some((m) => m.id === searchAssistantModelRef.value?.id)

      if (!modelExists) {
        // 如果当前搜索助手模型不再可用，重新选择
        await initOrUpdateSearchAssistantModel()
      }
    } else {
      // 如果还没有设置搜索助手模型，设置一个
      await initOrUpdateSearchAssistantModel()
    }
  }

  // 搜索模型
  const searchModels = (query: string) => {
    const filteredModels = enabledModels.value
      .map((group) => {
        const filteredGroupModels = group.models.filter((model) => model.id.includes(query))
        return {
          providerId: group.providerId,
          models: filteredGroupModels
        }
      })
      .filter((group) => group.models.length > 0) // 只保留有模型的组

    enabledModels.value = filteredModels
  }

  // 更新 provider
  const updateProvider = async (id: string, provider: LLM_PROVIDER) => {
    await configP.setProviderById(id, provider)
    providers.value = await configP.getProviders()
    // 如果 provider 的启用状态发生变化，刷新模型列表
    if (provider.enable !== providers.value.find((p) => p.id === id)?.enable) {
      await refreshAllModels()
    }
  }

  // 更新主题
  const updateTheme = async (newTheme: string) => {
    await configP.setSetting('theme', newTheme)
    theme.value = newTheme
  }

  // 更新语言
  const updateLanguage = async (newLanguage: string) => {
    await configP.setSetting('language', newLanguage)
    language.value = newLanguage

    // 更新当前语言
    locale.value = await configP.getLanguage()
  }

  // 监听 provider 设置变化
  const setupProviderListener = () => {
    // 监听配置变更事件
    window.electron.ipcRenderer.on(CONFIG_EVENTS.PROVIDER_CHANGED, async () => {
      providers.value = await configP.getProviders()
      await refreshAllModels()
    })
    // 监听模型列表更新事件
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.MODEL_LIST_CHANGED,
      async (_event, providerId: string) => {
        // 只刷新指定的provider模型，而不是所有模型
        if (providerId) {
          await refreshProviderModels(providerId)
        } else {
          // 兼容旧代码，如果没有提供providerId，则刷新所有模型
          await refreshAllModels()
        }
      }
    )
    // 监听配置中的模型列表变更事件
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.MODEL_LIST_CHANGED,
      async (_event, providerId: string) => {
        // 只刷新指定的provider模型，而不是所有模型
        if (providerId) {
          await refreshProviderModels(providerId)
        } else {
          // 兼容旧代码，如果没有提供providerId，则刷新所有模型
          await refreshAllModels()
        }
      }
    )

    // 处理模型启用状态变更事件
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.MODEL_STATUS_CHANGED,
      async (_event, msg: { providerId: string; modelId: string; enabled: boolean }) => {
        // 只更新模型启用状态，而不是刷新所有模型
        updateLocalModelStatus(msg.providerId, msg.modelId, msg.enabled)
      }
    )
  }

  // 更新本地模型状态，不触发后端请求
  const updateLocalModelStatus = (providerId: string, modelId: string, enabled: boolean) => {
    // 更新allProviderModels中的模型状态
    const providerIndex = allProviderModels.value.findIndex((p) => p.providerId === providerId)
    if (providerIndex !== -1) {
      const models = allProviderModels.value[providerIndex].models
      const modelIndex = models.findIndex((m) => m.id === modelId)
      if (modelIndex !== -1) {
        models[modelIndex].enabled = enabled
      }
    }

    // 更新enabledModels中的模型状态
    const enabledProviderIndex = enabledModels.value.findIndex((p) => p.providerId === providerId)
    if (enabledProviderIndex !== -1) {
      const models = enabledModels.value[enabledProviderIndex].models
      if (enabled) {
        // 如果启用，确保模型在列表中
        const modelIndex = models.findIndex((m) => m.id === modelId)
        if (modelIndex === -1) {
          // 模型不在启用列表中，从allProviderModels查找并添加
          const provider = allProviderModels.value.find((p) => p.providerId === providerId)
          const model = provider?.models.find((m) => m.id === modelId)
          if (model) {
            models.push({ ...model, enabled: true })
          }
        }
      } else {
        // 如果禁用，从列表中移除
        const modelIndex = models.findIndex((m) => m.id === modelId)
        if (modelIndex !== -1) {
          models.splice(modelIndex, 1)
        }
      }
    }

    // 更新customModels中的模型状态
    const customProviderIndex = customModels.value.findIndex((p) => p.providerId === providerId)
    if (customProviderIndex !== -1) {
      const models = customModels.value[customProviderIndex].models
      const modelIndex = models.findIndex((m) => m.id === modelId)
      if (modelIndex !== -1) {
        models[modelIndex].enabled = enabled
      }
    }
  }

  // 更新模型状态
  const updateModelStatus = async (providerId: string, modelId: string, enabled: boolean) => {
    try {
      await llmP.updateModelStatus(providerId, modelId, enabled)
      // 注意：这里不再调用refreshAllModels，因为会通过model-status-changed事件更新本地状态
    } catch (error) {
      console.error('Failed to update model status:', error)
    }
  }

  const checkProvider = async (providerId: string) => {
    return await llmP.check(providerId)
  }

  // 添加自定义模型
  const addCustomModel = async (
    providerId: string,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ) => {
    try {
      const newModel = await llmP.addCustomModel(providerId, model)
      await configP.addCustomModel(providerId, newModel)
      await refreshAllModels()
      return newModel
    } catch (error) {
      console.error('Failed to add custom model:', error)
      throw error
    }
  }

  // 删除自定义模型
  const removeCustomModel = async (providerId: string, modelId: string) => {
    try {
      const success = await llmP.removeCustomModel(providerId, modelId)
      if (success) {
        await refreshAllModels()
      }
      return success
    } catch (error) {
      console.error('Failed to remove custom model:', error)
      throw error
    }
  }

  // 更新自定义模型
  const updateCustomModel = async (
    providerId: string,
    modelId: string,
    updates: Partial<RENDERER_MODEL_META> & { enabled?: boolean }
  ) => {
    try {
      // 不包含启用状态的常规更新
      const success = await llmP.updateCustomModel(providerId, modelId, updates)
      if (success) {
        await refreshAllModels()
      }
      return success
    } catch (error) {
      console.error('Failed to update custom model:', error)
      throw error
    }
  }

  // 检查更新
  const checkUpdate = async () => {
    if (isChecking.value) return
    isChecking.value = true
    try {
      await upgradeP.checkUpdate()
      const status = upgradeP.getUpdateStatus()
      hasUpdate.value = status.status === 'available' || status.status === 'downloaded'
      if (hasUpdate.value && status.updateInfo) {
        updateInfo.value = {
          version: status.updateInfo.version,
          releaseDate: status.updateInfo.releaseDate,
          releaseNotes: status.updateInfo.releaseNotes
        }
      }
    } catch (error) {
      console.error('Failed to check update:', error)
    } finally {
      isChecking.value = false
    }
  }

  // 开始下载更新
  const startUpdate = async () => {
    try {
      return await upgradeP.startDownloadUpdate()
    } catch (error) {
      console.error('Failed to start update:', error)
      return false
    }
  }

  // 重启并安装更新
  const restartAndUpdate = async () => {
    try {
      return await upgradeP.restartToUpdate()
    } catch (error) {
      console.error('Failed to restart and update:', error)
      return false
    }
  }

  // 监听更新状态
  const setupUpdateListener = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.electron.ipcRenderer.on(UPDATE_EVENTS.STATUS_CHANGED, (_, event: any) => {
      const { status, info, error } = event
      hasUpdate.value = status === 'available' || status === 'downloaded'
      console.log(UPDATE_EVENTS.STATUS_CHANGED, status, info, error)
      // 根据不同状态更新UI
      switch (status) {
        case 'available':
          if (info) {
            updateInfo.value = {
              version: info.version,
              releaseDate: info.releaseDate,
              releaseNotes: info.releaseNotes
            }
          }
          break
        case 'downloaded':
          if (info) {
            updateInfo.value = {
              version: info.version,
              releaseDate: info.releaseDate,
              releaseNotes: info.releaseNotes
            }
          }
          restartAndUpdate()
          break
        case 'not-available':
          updateInfo.value = null
          break
        case 'error':
          updateInfo.value = null
          console.error('Update error:', error)
          break
      }
    })

    // 监听更新进度
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.electron.ipcRenderer.on(UPDATE_EVENTS.PROGRESS, (_, progressData: any) => {
      console.log(UPDATE_EVENTS.PROGRESS, progressData)
      // 这里可以添加进度处理逻辑，如果需要显示进度条
    })

    // 监听更新错误
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.electron.ipcRenderer.on(UPDATE_EVENTS.ERROR, (_, errorData: any) => {
      console.error(UPDATE_EVENTS.ERROR, errorData.error)
      hasUpdate.value = false
      updateInfo.value = null
    })

    // 监听更新即将重启
    window.electron.ipcRenderer.on(UPDATE_EVENTS.WILL_RESTART, () => {
      console.log('Application will restart to install update')
    })
  }

  // 原子化的配置更新方法
  const updateProviderConfig = async (
    providerId: string,
    updates: Partial<LLM_PROVIDER>
  ): Promise<void> => {
    const currentProvider = providers.value.find((p) => p.id === providerId)
    if (!currentProvider) {
      throw new Error(`Provider ${providerId} not found`)
    }

    const updatedProvider = {
      ...currentProvider,
      ...updates
    }

    await configP.setProviderById(providerId, updatedProvider)

    // 只在特定字段变化时刷新providers
    const needRefreshProviders = ['name', 'enable'].some((key) => key in updates)
    if (needRefreshProviders) {
      providers.value = await configP.getProviders()
    } else {
      // 只更新当前provider
      const index = providers.value.findIndex((p) => p.id === providerId)
      if (index !== -1) {
        providers.value[index] = updatedProvider
      }
    }

    // 只在特定条件下刷新模型列表
    const needRefreshModels = ['enable', 'apiKey', 'baseUrl'].some((key) => key in updates)
    if (needRefreshModels && updatedProvider.enable) {
      await refreshAllModels()
    }
  }

  // 更新provider的API配置
  const updateProviderApi = async (
    providerId: string,
    apiKey?: string,
    baseUrl?: string
  ): Promise<void> => {
    const updates: Partial<LLM_PROVIDER> = {}
    if (apiKey !== undefined) updates.apiKey = apiKey
    if (baseUrl !== undefined) updates.baseUrl = baseUrl
    await updateProviderConfig(providerId, updates)
  }

  // 更新provider的启用状态
  const updateProviderStatus = async (providerId: string, enable: boolean): Promise<void> => {
    await updateProviderConfig(providerId, { enable })
  }

  // 优化刷新模型列表的逻辑
  const refreshProviderModels = async (providerId: string): Promise<void> => {
    const provider = providers.value.find((p) => p.id === providerId)
    if (!provider || !provider.enable) return

    try {
      // 获取在线模型
      let models = await configP.getProviderModels(providerId)
      if (!models || models.length === 0) {
        const modelMetas = await llmP.getModelList(providerId)
        if (modelMetas) {
          models = modelMetas.map((meta) => ({
            id: meta.id,
            name: meta.name,
            contextLength: meta.contextLength || 4096,
            maxTokens: meta.maxTokens || 2048,
            provider: providerId,
            group: meta.group,
            isCustom: meta.isCustom || false,
            providerId
          }))
        }
      }

      // 获取模型状态并合并
      const modelsWithStatus = await Promise.all(
        models.map(async (model) => {
          // 获取模型状态
          const enabled = await configP.getModelStatus(providerId, model.id)

          return {
            ...model,
            enabled,
            providerId,
            isCustom: model.isCustom || false
          }
        })
      )

      // 更新模型列表
      const existingIndex = allProviderModels.value.findIndex(
        (item) => item.providerId === providerId
      )
      if (existingIndex !== -1) {
        allProviderModels.value[existingIndex].models = modelsWithStatus
      } else {
        allProviderModels.value.push({
          providerId,
          models: modelsWithStatus
        })
      }

      // 更新已启用的模型列表
      const enabledIndex = enabledModels.value.findIndex((item) => item.providerId === providerId)
      if (enabledIndex !== -1) {
        enabledModels.value[enabledIndex].models = modelsWithStatus.filter(
          (model) => model.enabled !== false
        )
      } else {
        enabledModels.value.push({
          providerId,
          models: modelsWithStatus.filter((model) => model.enabled !== false)
        })
      }

      // 同时更新自定义模型
      const customModelsList = await llmP.getCustomModels(providerId)
      if (customModelsList && customModelsList.length > 0) {
        // 获取自定义模型状态并合并
        const customModelsWithStatus = await Promise.all(
          customModelsList.map(async (model) => {
            // 获取模型状态
            const enabled = await configP.getModelStatus(providerId, model.id)

            return {
              ...model,
              enabled,
              providerId,
              isCustom: true
            }
          })
        )

        const customIndex = customModels.value.findIndex((item) => item.providerId === providerId)
        if (customIndex !== -1) {
          customModels.value[customIndex].models = customModelsWithStatus
        } else {
          customModels.value.push({
            providerId,
            models: customModelsWithStatus
          })
        }
      }
    } catch (error) {
      console.error(`Failed to fetch models for provider ${providerId}:`, error)
    }
  }
  const setSearchEngine = async (engineName: string) => {
    if (searchEngines.value.find((e) => e.name === engineName)) {
      activeSearchEngine.value = engineName
      await configP.setSetting('searchEngine', engineName)
      threadP.setActiveSearchEngine(engineName)
    }
  }

  // 添加自定义Provider
  const addCustomProvider = async (provider: LLM_PROVIDER): Promise<void> => {
    try {
      const currentProviders = await configP.getProviders()
      const newProivider = {
        ...toRaw(provider),
        custom: true
      }
      const newProviders = [...currentProviders, newProivider]
      await configP.setProviders(newProviders)
      providers.value = newProviders

      // 如果新provider启用了，刷新模型列表
      if (provider.enable) {
        await refreshAllModels()
      }
      providers.value = await configP.getProviders()
    } catch (error) {
      console.error('Failed to add custom provider:', error)
      throw error
    }
  }

  // 删除Provider
  const removeProvider = async (providerId: string): Promise<void> => {
    try {
      const currentProviders = await configP.getProviders()
      const filteredProviders = currentProviders.filter((p) => p.id !== providerId)
      await configP.setProviders(filteredProviders)
      providers.value = filteredProviders
      await refreshAllModels()
    } catch (error) {
      console.error('Failed to remove provider:', error)
      throw error
    }
  }
  const enableAllModels = async (providerId: string): Promise<void> => {
    try {
      // 获取提供商的所有模型
      const providerModelsData = allProviderModels.value.find((p) => p.providerId === providerId)
      if (!providerModelsData || providerModelsData.models.length === 0) {
        console.warn(`No models found for provider ${providerId}`)
        return
      }

      // 对每个模型执行启用操作
      for (const model of providerModelsData.models) {
        if (!model.enabled) {
          await llmP.updateModelStatus(providerId, model.id, true)
          // 注意：不需要调用refreshAllModels，因为model-status-changed事件会更新UI
        }
      }
    } catch (error) {
      console.error(`Failed to enable all models for provider ${providerId}:`, error)
      throw error
    }
  }
  // 禁用指定提供商下的所有模型
  const disableAllModels = async (providerId: string): Promise<void> => {
    try {
      // 获取提供商的所有模型
      const providerModelsData = allProviderModels.value.find((p) => p.providerId === providerId)
      if (!providerModelsData || providerModelsData.models.length === 0) {
        console.warn(`No models found for provider ${providerId}`)
        return
      }

      // 获取自定义模型
      const customModelsData = customModels.value.find((p) => p.providerId === providerId)

      // 对每个模型执行禁用操作
      const standardModels = providerModelsData.models
      for (const model of standardModels) {
        if (model.enabled) {
          await llmP.updateModelStatus(providerId, model.id, false)
          // 注意：不需要调用refreshAllModels，因为model-status-changed事件会更新UI
        }
      }

      // 处理自定义模型
      if (customModelsData) {
        for (const model of customModelsData.models) {
          if (model.enabled) {
            await llmP.updateModelStatus(providerId, model.id, false)
            // 注意：不需要调用refreshAllModels，因为model-status-changed事件会更新UI
          }
        }
      }
    } catch (error) {
      console.error(`Failed to disable all models for provider ${providerId}:`, error)
      throw error
    }
  }

  const cleanAllMessages = async (conversationId: string) => {
    await threadP.clearAllMessages(conversationId)
  }

  // 在 store 创建时初始化
  onMounted(() => {
    initSettings()
    setupProviderListener()
    setupUpdateListener()
  })

  return {
    providers,
    theme,
    language,
    enabledModels,
    allProviderModels,
    customModels,
    updateProvider,
    updateTheme,
    updateLanguage,
    initSettings,
    searchModels,
    refreshAllModels,
    updateModelStatus,
    checkProvider,
    addCustomModel,
    removeCustomModel,
    updateCustomModel,
    hasUpdate,
    updateInfo,
    isChecking,
    checkUpdate,
    startUpdate,
    restartAndUpdate,
    updateProviderConfig,
    updateProviderApi,
    updateProviderStatus,
    refreshProviderModels,
    setSearchEngine,
    searchEngines,
    activeSearchEngine,
    addCustomProvider,
    removeProvider,
    disableAllModels,
    enableAllModels,
    searchAssistantModel,
    setSearchAssistantModel,
    initOrUpdateSearchAssistantModel,
    cleanAllMessages
  }
})
