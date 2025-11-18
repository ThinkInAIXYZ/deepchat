import { defineStore, storeToRefs } from 'pinia'
import { ref, onMounted, toRaw, computed } from 'vue'
import {
  type LLM_PROVIDER,
  type MODEL_META,
  type RENDERER_MODEL_META,
  type ModelConfig,
  type SystemPrompt
} from '@shared/presenter'
import type { ProviderChange, ProviderBatchUpdate } from '@shared/provider-operations'
import { ModelType } from '@shared/model'
import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS, OLLAMA_EVENTS, DEEPLINK_EVENTS, PROVIDER_DB_EVENTS } from '@/events'
import type { AWS_BEDROCK_PROVIDER, AwsBedrockCredential, OllamaModel } from '@shared/presenter'
import { useRouter } from 'vue-router'
import { useMcpStore } from '@/stores/mcp'
import { useUpgradeStore } from '@/stores/upgrade'
import { useThrottleFn } from '@vueuse/core'
import { useSearchEngineStore } from '@/stores/searchEngineStore'
import { useProviderStore } from '@/stores/providerStore'
import { useModelStore } from '@/stores/modelStore'
import { useOllamaStore } from '@/stores/ollamaStore'
import { useSearchAssistantStore } from '@/stores/searchAssistantStore'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useSystemPromptStore } from '@/stores/systemPromptStore'
import { useModelConfigStore } from '@/stores/modelConfigStore'

export const useSettingsStore = defineStore('settings', () => {
  const configP = usePresenter('configPresenter')
  const llmP = usePresenter('llmproviderPresenter')
  const threadP = usePresenter('threadPresenter')
  const router = useRouter()
  const upgradeStore = useUpgradeStore()
  const searchEngineStore = useSearchEngineStore()
  const { searchEngines, activeSearchEngine } = storeToRefs(searchEngineStore)
  const providerStore = useProviderStore()
  const { providers, defaultProviders, sortedProviders, providerOrder, providerTimestamps } =
    storeToRefs(providerStore)
  const modelStore = useModelStore()
  const ollamaStore = useOllamaStore()
  const searchAssistantStore = useSearchAssistantStore()
  const uiSettingsStore = useUiSettingsStore()
  const {
    fontSizeLevel,
    searchPreviewEnabled,
    contentProtectionEnabled,
    copyWithCotEnabled,
    notificationsEnabled,
    traceDebugEnabled,
    fontSizeClass
  } = storeToRefs(uiSettingsStore)
  const systemPromptStore = useSystemPromptStore()
  const modelConfigStore = useModelConfigStore()
  const providerModelQueries = new Map<
    string,
    ReturnType<typeof modelStore.getProviderModelsQuery>
  >()
  const customModelQueries = new Map<string, ReturnType<typeof modelStore.getCustomModelsQuery>>()

  const getProviderModelsQuery = (providerId: string) => {
    if (!providerModelQueries.has(providerId)) {
      providerModelQueries.set(providerId, modelStore.getProviderModelsQuery(providerId))
    }
    return providerModelQueries.get(providerId)!
  }

  const getCustomModelsQuery = (providerId: string) => {
    if (!customModelQueries.has(providerId)) {
      customModelQueries.set(providerId, modelStore.getCustomModelsQuery(providerId))
    }
    return customModelQueries.get(providerId)!
  }

  const enabledModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const allProviderModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const customModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const artifactsEffectEnabled = ref<boolean>(false) // 默认值与配置文件一致
  const {
    runningModels: ollamaRunningModels,
    localModels: ollamaLocalModels,
    pullingProgress: ollamaPullingModels
  } = storeToRefs(ollamaStore)

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

    const model = enabledModels.value
      .flatMap((provider) =>
        provider.models.map((m) => ({ ...m, providerId: provider.providerId }))
      )
      .find((m) => m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)

    if (model) {
      return {
        model: model,
        providerId: model.providerId
      }
    }

    return null
  }

  // 设置搜索助手模型
  const setSearchAssistantModel = async (model: RENDERER_MODEL_META, providerId: string) => {
    const _model = toRaw(model)
    searchAssistantModelRef.value = _model
    searchAssistantProviderRef.value = providerId
    await searchAssistantStore.setSearchAssistantModel(_model, providerId)
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
      // const provider = enabledModels.value.find((p) => p.providerId === savedModel.providerId)
      // const modelExists = provider?.models.some((m) => m.id === savedModel.model.id)

      // if (modelExists) {
      searchAssistantModelRef.value = savedModel.model
      searchAssistantProviderRef.value = savedModel.providerId
      // 通知线程处理器更新搜索助手模型
      threadP.setSearchAssistantModel(savedModel.model, savedModel.providerId)
      await searchAssistantStore.setSearchAssistantModel(savedModel.model, savedModel.providerId)
      return
      // }
    }

    // 如果没有保存的模型或模型不再可用，查找符合优先级的模型
    let priorityModel = findPriorityModel()
    priorityModel = toRaw(priorityModel)
    if (priorityModel) {
      searchAssistantModelRef.value = priorityModel.model
      searchAssistantProviderRef.value = priorityModel.providerId

      await configP.setSetting('searchAssistantModel', {
        model: {
          id: priorityModel.model.id,
          name: priorityModel.model.name,
          contextLength: priorityModel.model.contextLength,
          maxTokens: priorityModel.model.maxTokens,
          providerId: priorityModel.providerId,
          group: priorityModel.model.group,
          enabled: true,
          isCustom: priorityModel.model.isCustom,
          vision: priorityModel.model.vision || false,
          functionCall: priorityModel.model.functionCall || false,
          reasoning: priorityModel.model.reasoning || false,
          type: priorityModel.model.type || ModelType.Chat
        },
        providerId: priorityModel.providerId
      })

      // 通知线程处理器更新搜索助手模型
      const normalized = {
        id: priorityModel.model.id,
        name: priorityModel.model.name,
        contextLength: priorityModel.model.contextLength,
        maxTokens: priorityModel.model.maxTokens,
        providerId: priorityModel.providerId,
        group: priorityModel.model.group,
        enabled: true,
        isCustom: priorityModel.model.isCustom,
        vision: priorityModel.model.vision || false,
        functionCall: priorityModel.model.functionCall || false,
        reasoning: priorityModel.model.reasoning || false,
        type: priorityModel.model.type || ModelType.Chat
      }

      threadP.setSearchAssistantModel(normalized, toRaw(priorityModel.providerId))
      await searchAssistantStore.setSearchAssistantModel(normalized, priorityModel.providerId)
    }
  }

  // MCP 安装缓存
  const mcpInstallCache = ref<string | null>(null)

  // 清理 MCP 安装缓存
  const clearMcpInstallCache = () => {
    mcpInstallCache.value = null
  }

  // 监听 deeplink 事件
  window.electron.ipcRenderer.on(DEEPLINK_EVENTS.MCP_INSTALL, async (_, data) => {
    const { mcpConfig } = data
    if (!mcpConfig) {
      return
    }
    // 获取MCP存储
    const mcpStore = useMcpStore()

    // 检查MCP是否已启用，如果未启用则自动启用
    if (!mcpStore.mcpEnabled) {
      await mcpStore.setMcpEnabled(true)
    }
    // 检查当前路由，如果不在MCP设置页面，则跳转
    const currentRoute = router.currentRoute.value
    if (currentRoute.name !== 'settings') {
      await router.push({
        name: 'settings'
      })
      await router.push({
        name: 'settings-mcp'
      })
    } else {
      await router.replace({
        name: 'settings-mcp',
        query: {
          ...currentRoute.query
        }
      })
      // 如果已经在MCP设置页面，只更新子标签页
    }

    // 存储 MCP 配置数据到缓存
    if (data) {
      mcpInstallCache.value = mcpConfig
    }
  })

  const loadProviderTimestamps = async () => {
    await providerStore.loadProviderTimestamps()
  }

  const saveProviderTimestamps = async () => {
    await providerStore.saveProviderTimestamps()
  }

  // 初始化设置
  const initSettings = async () => {
    try {
      await uiSettingsStore.loadSettings()
      loggingEnabled.value = await configP.getLoggingEnabled()

      await providerStore.initialize()
      await providerStore.refreshProviders()
      await loadSavedOrder()
      await loadProviderTimestamps()

      await searchEngineStore.initialize()
      // 获取全部模型
      await refreshAllModels()

      // 设置 Ollama 事件监听器
      setupOllamaEventListeners()

      // 设置 artifacts 效果事件监听器
      // setupArtifactsEffectListener()

      // 仅对已经启用的 Ollama provider 刷新模型，避免未启用时触发本地服务调用
      const ollamaProviders = providers.value.filter((p) => p.apiType === 'ollama' && p.enable)
      for (const provider of ollamaProviders) {
        await refreshOllamaModels(provider.id)
      }
      // 初始化搜索助手模型
      await initOrUpdateSearchAssistantModel()
      // 设置配置类事件监听器（确保实时同步状态）

      // 设置 provider 相关事件监听
      setupProviderListener()
    } catch (error) {
      console.error('初始化设置失败:', error)
    }
  }

  const applyUserDefinedModelConfig = async (
    model: RENDERER_MODEL_META,
    providerId: string
  ): Promise<RENDERER_MODEL_META> => {
    const normalizedModel: RENDERER_MODEL_META = {
      ...model,
      vision: model.vision ?? false,
      functionCall: model.functionCall ?? false,
      reasoning: model.reasoning ?? false,
      enableSearch: model.enableSearch ?? false,
      type: model.type ?? ModelType.Chat
    }

    try {
      const config: ModelConfig | null = await modelConfigStore.getModelConfig(model.id, providerId)
      if (config?.isUserDefined) {
        const resolvedMaxTokens =
          config.maxTokens ?? config.maxCompletionTokens ?? normalizedModel.maxTokens

        return {
          ...normalizedModel,
          contextLength: config.contextLength ?? normalizedModel.contextLength,
          maxTokens: resolvedMaxTokens,
          vision: config.vision ?? normalizedModel.vision ?? false,
          functionCall: config.functionCall ?? normalizedModel.functionCall ?? false,
          reasoning: config.reasoning ?? normalizedModel.reasoning ?? false,
          enableSearch: config.enableSearch ?? normalizedModel.enableSearch ?? false,
          type: config.type ?? normalizedModel.type ?? ModelType.Chat
        }
      }
    } catch (error) {
      console.error(`读取模型配置失败: ${providerId}/${model.id}`, error)
    }

    return normalizedModel
  }

  // 刷新单个提供商的自定义模型
  const refreshCustomModels = async (providerId: string): Promise<void> => {
    try {
      const query = getCustomModelsQuery(providerId)
      await query.refetch()
      const customModelsList = query.data.value ?? []
      const safeCustomModelsList = customModelsList

      const modelIds = safeCustomModelsList.map((model) => model.id)
      const modelStatusMap =
        modelIds.length > 0 ? await configP.getBatchModelStatus(providerId, modelIds) : {}

      const customModelsWithStatus = await Promise.all(
        safeCustomModelsList.map(async (model) => {
          const baseModel: RENDERER_MODEL_META = {
            ...model,
            enabled: modelStatusMap[model.id] ?? true,
            providerId,
            isCustom: true,
            type: model.type || ModelType.Chat
          }
          return await applyUserDefinedModelConfig(baseModel, providerId)
        })
      )

      // 更新自定义模型列表
      const customIndex = customModels.value.findIndex((item) => item.providerId === providerId)
      if (customIndex !== -1) {
        customModels.value[customIndex].models = customModelsWithStatus
      } else {
        customModels.value.push({
          providerId,
          models: customModelsWithStatus
        })
      }

      // 更新全局模型列表中的自定义模型
      const allProviderIndex = allProviderModels.value.findIndex(
        (item) => item.providerId === providerId
      )
      if (allProviderIndex !== -1) {
        // 保留非自定义模型，添加新的自定义模型
        const currentModels = allProviderModels.value[allProviderIndex].models
        const standardModels = currentModels.filter((model) => !model.isCustom)
        allProviderModels.value[allProviderIndex].models = [
          ...standardModels,
          ...customModelsWithStatus
        ]
      }

      // 更新已启用的模型列表
      const enabledIndex = enabledModels.value.findIndex((item) => item.providerId === providerId)
      if (enabledIndex !== -1) {
        // 保留非自定义模型，添加新的已启用自定义模型
        const currentModels = enabledModels.value[enabledIndex].models
        const standardModels = currentModels.filter((model) => !model.isCustom)
        const enabledCustomModels = customModelsWithStatus.filter((model) => model.enabled)
        enabledModels.value[enabledIndex].models = [...standardModels, ...enabledCustomModels]
      } else {
        const enabledCustomModels = customModelsWithStatus.filter((model) => model.enabled)
        console.log('enabledCustomModels', enabledCustomModels, customModelsWithStatus)
        enabledModels.value.push({
          providerId,
          models: enabledCustomModels
        })
      }

      // 检查并更新搜索助手模型
      await checkAndUpdateSearchAssistantModel()
    } catch (error) {
      console.error(`刷新自定义模型失败: ${providerId}`, error)
    }
  }

  // 刷新单个提供商的标准模型
  const refreshStandardModels = async (providerId: string): Promise<void> => {
    try {
      // 优先使用聚合 Provider DB（统一由主进程映射）
      let models: RENDERER_MODEL_META[] = await configP.getDbProviderModels(providerId)

      const providerModelsQuery = getProviderModelsQuery(providerId)
      await providerModelsQuery.refetch()
      const storedModels = providerModelsQuery.data.value ?? []

      if (storedModels && storedModels.length > 0) {
        const dbModelMap = new Map(models.map((model) => [model.id, model]))
        const storedModelMap = new Map<string, RENDERER_MODEL_META>()

        const normalizeStoredModel = (
          model: MODEL_META,
          fallback?: RENDERER_MODEL_META
        ): RENDERER_MODEL_META => {
          return {
            id: model.id,
            name: model.name || fallback?.name || model.id,
            group: model.group || fallback?.group || 'default',
            providerId,
            enabled: false,
            isCustom: model.isCustom ?? fallback?.isCustom ?? false,
            contextLength: model.contextLength ?? fallback?.contextLength ?? 4096,
            maxTokens: model.maxTokens ?? fallback?.maxTokens ?? 2048,
            vision: model.vision ?? fallback?.vision ?? false,
            functionCall: model.functionCall ?? fallback?.functionCall ?? false,
            reasoning: model.reasoning ?? fallback?.reasoning ?? false,
            enableSearch: model.enableSearch ?? fallback?.enableSearch ?? false,
            type: model.type ?? fallback?.type ?? ModelType.Chat
          }
        }

        for (const storedModel of storedModels) {
          const normalized = normalizeStoredModel(storedModel, dbModelMap.get(storedModel.id))
          storedModelMap.set(storedModel.id, normalized)
        }

        const mergedModels: RENDERER_MODEL_META[] = []

        for (const model of models) {
          const override = storedModelMap.get(model.id)
          if (override) {
            storedModelMap.delete(model.id)
            mergedModels.push({ ...model, ...override, providerId })
          } else {
            mergedModels.push({ ...model, providerId })
          }
        }

        for (const model of storedModelMap.values()) {
          mergedModels.push(model)
        }

        models = mergedModels
      }

      // 若聚合 DB 为空且没有持久化模型，回退到 LLMProviderPresenter 的模型列表
      if (!models || models.length === 0) {
        try {
          const modelMetas = await llmP.getModelList(providerId)
          if (modelMetas) {
            models = modelMetas.map((meta) => ({
              id: meta.id,
              name: meta.name,
              contextLength: meta.contextLength || 4096,
              maxTokens: meta.maxTokens || 2048,
              provider: providerId,
              group: meta.group || 'default',
              enabled: false,
              isCustom: meta.isCustom || false,
              providerId,
              vision: meta.vision || false,
              functionCall: meta.functionCall || false,
              reasoning: meta.reasoning || false,
              type: meta.type || ModelType.Chat
            }))
          }
        } catch (error) {
          console.error(`Failed to fetch models for provider ${providerId}:`, error)
          models = []
        }
      }

      // 批量获取模型状态并合并
      const modelIds = models.map((model) => model.id)
      const modelStatusMap =
        modelIds.length > 0 ? await configP.getBatchModelStatus(providerId, modelIds) : {}

      const modelsWithStatus = await Promise.all(
        models.map(async (model) => {
          const baseModel: RENDERER_MODEL_META = {
            ...model,
            enabled: modelStatusMap[model.id] ?? true,
            providerId,
            isCustom: model.isCustom || false,
            vision: model.vision ?? false,
            functionCall: model.functionCall ?? false,
            reasoning: model.reasoning ?? false,
            enableSearch: model.enableSearch ?? false,
            type: model.type || ModelType.Chat
          }
          return await applyUserDefinedModelConfig(baseModel, providerId)
        })
      )

      // 更新全局模型列表中的标准模型
      const allProviderIndex = allProviderModels.value.findIndex(
        (item) => item.providerId === providerId
      )
      if (allProviderIndex !== -1) {
        // 保留自定义模型，更新标准模型
        const currentModels = allProviderModels.value[allProviderIndex].models
        const customModels = currentModels.filter((model) => model.isCustom)
        allProviderModels.value[allProviderIndex].models = [...modelsWithStatus, ...customModels]
      } else {
        // 提供商不存在，添加新条目
        allProviderModels.value.push({
          providerId,
          models: modelsWithStatus
        })
      }

      // 更新已启用的模型列表
      const enabledIndex = enabledModels.value.findIndex((item) => item.providerId === providerId)
      const enabledModelsData = modelsWithStatus.filter((model) => model.enabled)
      if (enabledIndex !== -1) {
        // 保留自定义模型，更新标准模型
        const currentModels = enabledModels.value[enabledIndex].models
        const customModels = currentModels.filter((model) => model.isCustom)
        enabledModels.value[enabledIndex].models = [...enabledModelsData, ...customModels]
      } else if (enabledModelsData.length > 0) {
        // 提供商不存在，添加新条目
        enabledModels.value.push({
          providerId,
          models: enabledModelsData
        })
      }

      // 检查并更新搜索助手模型
      await checkAndUpdateSearchAssistantModel()
    } catch (error) {
      console.error(`刷新标准模型失败: ${providerId}`, error)
    }
  }

  // 检查并更新搜索助手模型
  const checkAndUpdateSearchAssistantModel = async (): Promise<void> => {
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

  // 优化刷新模型列表的逻辑
  const refreshProviderModels = async (providerId: string): Promise<void> => {
    // 优先检查提供商是否启用
    const provider = providers.value.find((p) => p.id === providerId)
    if (!provider || !provider.enable) return

    // Ollama 提供商的特殊处理
    if (provider.apiType === 'ollama') {
      await refreshOllamaModels(providerId)
      refreshCustomModels(providerId)
      return
    }

    try {
      // 自定义模型直接从配置存储获取，不需要等待provider实例
      refreshCustomModels(providerId)

      // 标准模型需要provider实例，可能需要等待实例初始化
      refreshStandardModels(providerId)
    } catch (error) {
      console.error(`刷新模型失败: ${providerId}`, error)
      // 如果标准模型刷新失败，至少确保自定义模型可用
      refreshCustomModels(providerId)
    }
  }

  // 内部刷新所有模型列表的实现函数
  const _refreshAllModelsInternal = async () => {
    try {
      const activeProviders = providers.value.filter((p) => p.enable)
      allProviderModels.value = []
      enabledModels.value = []
      customModels.value = []
      // 依次刷新每个提供商的模型
      for (const provider of activeProviders) {
        await refreshProviderModels(provider.id)
      }

      // 检查并更新搜索助手模型
      await checkAndUpdateSearchAssistantModel()
    } catch (error) {
      console.error('刷新所有模型列表失败:', error)
    }
  }

  // 使用 throttle 包装的刷新函数，确保在频繁调用时最后一次调用能够成功执行
  // trailing: true 确保在节流周期结束后执行最后一次调用
  // leading: false 避免立即执行第一次调用
  const refreshAllModels = useThrottleFn(_refreshAllModelsInternal, 1000, true, true)

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
    // 删除 provider 的 websites 字段
    delete provider.websites
    await configP.setProviderById(id, provider)
    await providerStore.refreshProviders()
    // 如果 provider 的启用状态发生变化，刷新模型列表
    if (provider.enable !== providers.value.find((p) => p.id === id)?.enable) {
      await refreshAllModels()
    }
  }

  // 更新字体大小级别
  const updateFontSizeLevel = async (level: number) => {
    await uiSettingsStore.updateFontSizeLevel(level)
  }

  // 监听 provider 设置变化
  const setupProviderListener = () => {
    // 监听配置变更事件
    window.electron.ipcRenderer.on(CONFIG_EVENTS.PROVIDER_CHANGED, async () => {
      console.log('Provider changed - updating providers and order')
      await providerStore.refreshProviders()
      await refreshAllModels()
    })
    // 监听原子provider更新事件
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE,
      async (_event, change: ProviderChange) => {
        console.log(
          `Provider atomic update - operation: ${change.operation}, providerId: ${change.providerId}`
        )
        await providerStore.refreshProviders()
        if (change.operation === 'reorder') {
          // 重排序不需要刷新模型，只需要更新顺序
          return
        } else if (change.operation === 'remove') {
          // 删除provider时，清理相关模型数据
          enabledModels.value = enabledModels.value.filter(
            (p) => p.providerId !== change.providerId
          )
          allProviderModels.value = allProviderModels.value.filter(
            (p) => p.providerId !== change.providerId
          )
          clearOllamaProviderData(change.providerId)
        } else {
          const changedProvider = providers.value.find((p) => p.id === change.providerId)
          if (changedProvider?.apiType === 'ollama') {
            if (changedProvider.enable) {
              await refreshOllamaModels(change.providerId)
            } else {
              clearOllamaProviderData(change.providerId)
            }
            refreshCustomModels(change.providerId)
          } else {
            // add 或 update 操作，刷新该provider的模型
            await refreshProviderModels(change.providerId)
          }
        }
      }
    )
    // 监听批量provider更新事件
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.PROVIDER_BATCH_UPDATE,
      async (_event, batchUpdate: ProviderBatchUpdate) => {
        console.log('Provider batch update - changes:', batchUpdate.changes)
        await providerStore.refreshProviders()
        // 处理批量变更
        for (const change of batchUpdate.changes) {
          if (change.operation === 'remove') {
            enabledModels.value = enabledModels.value.filter(
              (p) => p.providerId !== change.providerId
            )
            allProviderModels.value = allProviderModels.value.filter(
              (p) => p.providerId !== change.providerId
            )
            clearOllamaProviderData(change.providerId)
          } else if (change.operation !== 'reorder') {
            const changedProvider = providers.value.find((p) => p.id === change.providerId)
            if (changedProvider?.apiType === 'ollama') {
              if (changedProvider.enable) {
                await refreshOllamaModels(change.providerId)
              } else {
                clearOllamaProviderData(change.providerId)
              }
              refreshCustomModels(change.providerId)
            } else {
              await refreshProviderModels(change.providerId)
            }
          }
        }
      }
    )

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

    // 处理模型启用状态变更事件
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.MODEL_STATUS_CHANGED,
      async (_event, msg: { providerId: string; modelId: string; enabled: boolean }) => {
        // 只更新模型启用状态，而不是刷新所有模型
        updateLocalModelStatus(msg.providerId, msg.modelId, msg.enabled)
      }
    )

    // 在setupProviderListener方法或其他初始化方法附近添加对artifacts效果变更的监听
    // setupArtifactsEffectListener()

    // 监听 Provider DB 事件，更新模型列表
    window.electron.ipcRenderer.on(PROVIDER_DB_EVENTS.UPDATED, async () => {
      await refreshAllModels()
    })
    window.electron.ipcRenderer.on(PROVIDER_DB_EVENTS.LOADED, async () => {
      await refreshAllModels()
    })
  }

  // 更新本地模型状态，不触发后端请求
  const updateLocalModelStatus = (providerId: string, modelId: string, enabled: boolean) => {
    const provider = allProviderModels.value.find((p) => p.providerId === providerId)
    const customProvider = customModels.value.find((p) => p.providerId === providerId)

    const providerModel = provider?.models.find((m) => m.id === modelId)
    if (providerModel) {
      providerModel.enabled = enabled
    }

    const customModel = customProvider?.models.find((m) => m.id === modelId)
    if (customModel) {
      customModel.enabled = enabled
    }

    let enabledProvider = enabledModels.value.find((p) => p.providerId === providerId)
    let updatedEnabledModels: { providerId: string; models: RENDERER_MODEL_META[] }[] | null = null

    if (!enabledProvider && enabled) {
      enabledProvider = {
        providerId,
        models: []
      }
      updatedEnabledModels = [...enabledModels.value, enabledProvider]
    }

    if (enabledProvider) {
      const models = enabledProvider.models
      const modelIndex = models.findIndex((m) => m.id === modelId)

      if (enabled) {
        const sourceModel = providerModel ?? customModel ?? models[modelIndex]
        if (sourceModel) {
          const normalizedModel: RENDERER_MODEL_META = {
            ...sourceModel,
            enabled: true,
            vision: sourceModel.vision ?? false,
            functionCall: sourceModel.functionCall ?? false,
            reasoning: sourceModel.reasoning ?? false,
            type: sourceModel.type ?? ModelType.Chat
          }

          if (modelIndex === -1) {
            models.push(normalizedModel)
          } else {
            models[modelIndex] = normalizedModel
          }
        }
      } else if (modelIndex !== -1) {
        models.splice(modelIndex, 1)
      }

      if (!enabled && enabledProvider.models.length === 0) {
        updatedEnabledModels = enabledModels.value.filter((p) => p.providerId !== providerId)
      }
    }

    if (!updatedEnabledModels) {
      updatedEnabledModels = [...enabledModels.value]
    }

    enabledModels.value = updatedEnabledModels
    console.log('enabledModels updated:', enabledModels.value)
  }

  const getLocalModelEnabledState = (providerId: string, modelId: string): boolean | null => {
    const provider = allProviderModels.value.find((p) => p.providerId === providerId)
    const providerModel = provider?.models.find((m) => m.id === modelId)
    if (providerModel) {
      return !!providerModel.enabled
    }

    const customProvider = customModels.value.find((p) => p.providerId === providerId)
    const customModel = customProvider?.models.find((m) => m.id === modelId)
    if (customModel) {
      return !!customModel.enabled
    }

    const enabledProvider = enabledModels.value.find((p) => p.providerId === providerId)
    if (enabledProvider) {
      return enabledProvider.models.some((model) => model.id === modelId)
    }

    return null
  }

  // 更新模型状态
  const updateModelStatus = async (providerId: string, modelId: string, enabled: boolean) => {
    const previousState = getLocalModelEnabledState(providerId, modelId)
    updateLocalModelStatus(providerId, modelId, enabled)

    const provider = providers.value.find((p) => p.id === providerId)
    if (provider?.apiType === 'ollama') {
      return
    }

    try {
      await llmP.updateModelStatus(providerId, modelId, enabled)
      // 调用成功后，刷新该 provider 的模型列表
      await refreshProviderModels(providerId)
    } catch (error) {
      console.error('Failed to update model status:', error)
      if (previousState !== null && previousState !== enabled) {
        updateLocalModelStatus(providerId, modelId, previousState)
      }
    }
  }

  const checkProvider = async (providerId: string, modelId?: string) => {
    return await llmP.check(providerId, modelId)
  }

  // 删除自定义模型
  const removeCustomModel = async (providerId: string, modelId: string) => {
    try {
      await configP.removeCustomModel(providerId, modelId)
      const success = await llmP.removeCustomModel(providerId, modelId)
      console.log('removeCustomModel', providerId, modelId, success)
      if (success) {
        refreshCustomModels(providerId) // 只刷新自定义模型
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
        refreshCustomModels(providerId) // 只刷新自定义模型
      }
      return success
    } catch (error) {
      console.error('Failed to update custom model:', error)
      throw error
    }
  }

  // 添加自定义模型
  const addCustomModel = async (
    providerId: string,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ) => {
    try {
      const newModel = await llmP.addCustomModel(providerId, model)
      await configP.addCustomModel(providerId, newModel)
      refreshCustomModels(providerId) // 只刷新自定义模型
      return newModel
    } catch (error) {
      console.error('Failed to add custom model:', error)
      throw error
    }
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
    delete updatedProvider.websites

    // 使用新的原子操作接口
    const requiresRebuild = await configP.updateProviderAtomic(providerId, updates)
    await providerStore.refreshProviders()

    // 只在需要重建实例且模型可能受影响时刷新模型列表
    const needRefreshModels =
      requiresRebuild && ['enable', 'apiKey', 'baseUrl'].some((key) => key in updates)
    if (needRefreshModels && updatedProvider.enable) {
      await refreshAllModels()
    }
  }

  // 更新 AWS Bedrock Provider 的配置
  const updateAwsBedrockProviderConfig = async (
    providerId: string,
    updates: Partial<AWS_BEDROCK_PROVIDER>
  ): Promise<void> => {
    await updateProviderConfig(providerId, updates)
    const currentProvider = providers.value.find((p) => p.id === providerId)!

    // 只在特定条件下刷新模型列表
    const needRefreshModels = ['accessKeyId', 'secretAccessKey', 'region'].some(
      (key) => key in updates
    )
    if (needRefreshModels && currentProvider.enable) {
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

  // 更新provider的认证配置
  const updateProviderAuth = async (
    providerId: string,
    authMode?: 'apikey' | 'oauth',
    oauthToken?: string
  ): Promise<void> => {
    const updates: Partial<LLM_PROVIDER> = {}
    if (authMode !== undefined) updates.authMode = authMode
    if (oauthToken !== undefined) updates.oauthToken = oauthToken
    await updateProviderConfig(providerId, updates)
  }

  // 更新provider的启用状态
  const updateProviderStatus = async (providerId: string, enable: boolean): Promise<void> => {
    const previousTimestamp = providerTimestamps.value[providerId]
    providerTimestamps.value[providerId] = Date.now()

    try {
      await saveProviderTimestamps()
      await updateProviderConfig(providerId, { enable })
      await providerStore.optimizeProviderOrder(providerId, enable)
    } catch (error) {
      if (previousTimestamp === undefined) {
        delete providerTimestamps.value[providerId]
      } else {
        providerTimestamps.value[providerId] = previousTimestamp
      }

      await saveProviderTimestamps()
      console.error('Failed to update provider status:', error)
      throw error
    }
  }

  // 添加自定义Provider
  const addCustomProvider = async (provider: LLM_PROVIDER): Promise<void> => {
    try {
      const newProvider = {
        ...toRaw(provider),
        custom: true
      }
      delete newProvider.websites

      // 使用新的原子操作接口
      await configP.addProviderAtomic(newProvider)

      // 更新本地状态
      await providerStore.refreshProviders()

      // 如果新provider启用了，刷新模型列表
      if (provider.enable) {
        await refreshAllModels()
      }
    } catch (error) {
      console.error('Failed to add custom provider:', error)
      throw error
    }
  }

  // 删除Provider
  const removeProvider = async (providerId: string): Promise<void> => {
    try {
      const removedProvider = providers.value.find((p) => p.id === providerId)
      // 使用新的原子操作接口
      await configP.removeProviderAtomic(providerId)

      // 更新本地状态
      await providerStore.refreshProviders()

      // 从保存的顺序中移除此 provider
      providerOrder.value = providerOrder.value.filter((id) => id !== providerId)
      await providerStore.saveProviderOrder()

      await refreshAllModels()

      if (removedProvider?.apiType === 'ollama') {
        clearOllamaProviderData(providerId)
      }
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
      refreshProviderModels(providerId)
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
      refreshProviderModels(providerId)
    } catch (error) {
      console.error(`Failed to disable all models for provider ${providerId}:`, error)
      throw error
    }
  }

  const cleanAllMessages = async (conversationId: string) => {
    await threadP.clearAllMessages(conversationId)
  }

  // Ollama 模型管理方法
  const getOllamaRunningModels = (providerId: string): OllamaModel[] =>
    ollamaRunningModels.value[providerId] || []

  const getOllamaLocalModels = (providerId: string): OllamaModel[] =>
    ollamaLocalModels.value[providerId] || []

  const getOllamaPullingModels = (providerId: string): Record<string, number> =>
    ollamaPullingModels.value[providerId] || {}

  const updateOllamaPullingProgress = (
    providerId: string,
    modelName: string,
    progress?: number
  ) => {
    ollamaStore.updatePullingProgress(providerId, modelName, progress)
  }

  const clearOllamaProviderData = (providerId: string) => {
    if (ollamaRunningModels.value[providerId]) {
      const nextRunning = { ...ollamaRunningModels.value }
      delete nextRunning[providerId]
      ollamaRunningModels.value = nextRunning
    }
    if (ollamaLocalModels.value[providerId]) {
      const nextLocal = { ...ollamaLocalModels.value }
      delete nextLocal[providerId]
      ollamaLocalModels.value = nextLocal
    }
    if (ollamaPullingModels.value[providerId]) {
      const nextPulling = { ...ollamaPullingModels.value }
      delete nextPulling[providerId]
      ollamaPullingModels.value = nextPulling
    }
  }

  const refreshOllamaModels = async (providerId: string): Promise<void> => {
    try {
      await ollamaStore.refreshOllamaModels(providerId)
      await syncOllamaModelsToGlobal(providerId)
    } catch (error) {
      console.error(`Failed to refresh Ollama models for provider ${providerId}:`, error)
    }
  }

  const syncOllamaModelsToGlobal = async (providerId: string): Promise<void> => {
    const ollamaProvider = providers.value.find((p) => p.id === providerId)
    if (!ollamaProvider) return

    const existingOllamaModels =
      allProviderModels.value.find((item) => item.providerId === providerId)?.models || []

    const existingModelMap = new Map<string, RENDERER_MODEL_META & { ollamaModel?: OllamaModel }>(
      existingOllamaModels.map((model) => [
        model.id,
        model as RENDERER_MODEL_META & { ollamaModel?: OllamaModel }
      ])
    )

    const localModels = getOllamaLocalModels(providerId)

    const ollamaModelsAsGlobal = await Promise.all(
      localModels.map(async (model) => {
        const existingModel = existingModelMap.get(model.name)
        const existingModelExtra = existingModel as
          | (RENDERER_MODEL_META & {
              temperature?: number
              reasoningEffort?: string
              verbosity?: string
              thinkingBudget?: number
              forcedSearch?: boolean
              searchStrategy?: string
            })
          | undefined
        const modelConfig = await configP.getModelConfig(model.name, providerId)

        const capabilitySources: string[] = []
        if (Array.isArray((model as any)?.capabilities)) {
          capabilitySources.push(...((model as any).capabilities as string[]))
        }
        if (
          existingModel?.ollamaModel &&
          Array.isArray((existingModel.ollamaModel as any)?.capabilities)
        ) {
          capabilitySources.push(...((existingModel.ollamaModel as any).capabilities as string[]))
        }
        const capabilitySet = new Set(capabilitySources)

        const contextLength =
          modelConfig?.contextLength ??
          existingModel?.contextLength ??
          (model as any)?.model_info?.context_length ??
          4096

        const maxTokens = modelConfig?.maxTokens ?? existingModel?.maxTokens ?? 2048

        const enabled = true

        const resolvedType =
          modelConfig?.type ??
          existingModel?.type ??
          (capabilitySet.has('embedding') ? ModelType.Embedding : ModelType.Chat)

        return {
          ...existingModel,
          id: model.name,
          name: model.name,
          contextLength,
          maxTokens,
          provider: providerId,
          group: existingModel?.group || 'local',
          enabled,
          isCustom: existingModel?.isCustom || false,
          providerId,
          vision: modelConfig?.vision ?? existingModel?.vision ?? capabilitySet.has('vision'),
          functionCall:
            modelConfig?.functionCall ?? existingModel?.functionCall ?? capabilitySet.has('tools'),
          reasoning:
            modelConfig?.reasoning ?? existingModel?.reasoning ?? capabilitySet.has('thinking'),
          enableSearch: modelConfig?.enableSearch ?? existingModel?.enableSearch ?? false,
          temperature: modelConfig?.temperature ?? existingModelExtra?.temperature,
          reasoningEffort: modelConfig?.reasoningEffort ?? existingModelExtra?.reasoningEffort,
          verbosity: modelConfig?.verbosity ?? existingModelExtra?.verbosity,
          thinkingBudget: modelConfig?.thinkingBudget ?? existingModelExtra?.thinkingBudget,
          forcedSearch: modelConfig?.forcedSearch ?? existingModelExtra?.forcedSearch,
          searchStrategy: modelConfig?.searchStrategy ?? existingModelExtra?.searchStrategy,
          type: resolvedType,
          ollamaModel: model
        } as RENDERER_MODEL_META & { ollamaModel: OllamaModel }
      })
    )

    const existingIndex = allProviderModels.value.findIndex(
      (item) => item.providerId === providerId
    )

    if (existingIndex !== -1) {
      allProviderModels.value[existingIndex].models = ollamaModelsAsGlobal
    } else {
      allProviderModels.value.push({
        providerId,
        models: ollamaModelsAsGlobal
      })
    }

    const enabledIndex = enabledModels.value.findIndex((item) => item.providerId === providerId)
    const enabledOllamaModels = ollamaModelsAsGlobal.filter((model) => model.enabled)

    if (enabledIndex !== -1) {
      if (enabledOllamaModels.length > 0) {
        enabledModels.value[enabledIndex].models = enabledOllamaModels
      } else {
        enabledModels.value.splice(enabledIndex, 1)
      }
    } else if (enabledOllamaModels.length > 0) {
      enabledModels.value.push({
        providerId,
        models: enabledOllamaModels
      })
    }

    enabledModels.value = [...enabledModels.value]

    await initOrUpdateSearchAssistantModel()
  }

  const pullOllamaModel = async (providerId: string, modelName: string): Promise<boolean> => {
    try {
      updateOllamaPullingProgress(providerId, modelName, 0)

      const success = await ollamaStore.pullOllamaModel(providerId, modelName)

      if (!success) {
        updateOllamaPullingProgress(providerId, modelName)
      }

      return success
    } catch (error) {
      console.error(`Failed to pull Ollama model ${modelName} for provider ${providerId}:`, error)
      updateOllamaPullingProgress(providerId, modelName)
      return false
    }
  }

  const handleOllamaModelPullEvent = (event: Record<string, unknown>) => {
    if (
      event?.eventId !== 'pullOllamaModels' ||
      !event?.modelName ||
      typeof event.providerId !== 'string'
    )
      return

    const providerId = event.providerId as string
    const modelName = event.modelName as string
    const status = event.status as string | undefined
    const total = event.total as number | undefined
    const completed = event.completed as number | undefined

    if (typeof completed === 'number' && typeof total === 'number' && total > 0 && completed >= 0) {
      const progress = Math.min(Math.round((completed / total) * 100), 100)
      updateOllamaPullingProgress(providerId, modelName, progress)
    } else if (status && status.includes('manifest')) {
      updateOllamaPullingProgress(providerId, modelName, 1)
    }

    if (status === 'success' || status === 'completed') {
      setTimeout(() => {
        updateOllamaPullingProgress(providerId, modelName)
        const shouldRefresh = providers.value.some(
          (provider) =>
            provider.id === providerId && provider.enable && provider.apiType === 'ollama'
        )
        if (shouldRefresh) {
          refreshOllamaModels(providerId)
        }
      }, 1000)
    }
  }

  const setupOllamaEventListeners = () => {
    window.electron?.ipcRenderer?.on(
      OLLAMA_EVENTS.PULL_MODEL_PROGRESS,
      (_event: unknown, data: Record<string, unknown>) => {
        handleOllamaModelPullEvent(data)
      }
    )
  }

  const removeOllamaEventListeners = () => {
    window.electron?.ipcRenderer?.removeAllListeners(OLLAMA_EVENTS.PULL_MODEL_PROGRESS)
  }

  const isOllamaModelRunning = (providerId: string, modelName: string): boolean => {
    return getOllamaRunningModels(providerId).some((m) => m.name === modelName)
  }

  const isOllamaModelLocal = (providerId: string, modelName: string): boolean => {
    return getOllamaLocalModels(providerId).some((m) => m.name === modelName)
  }

  // 在 store 创建时初始化
  onMounted(async () => {
    await initSettings()
    await setupProviderListener()
  })

  // 清理可能的事件监听器
  const cleanup = () => {
    removeOllamaEventListeners()
    // 清理搜索引擎事件监听器
    window.electron?.ipcRenderer?.removeAllListeners(CONFIG_EVENTS.SEARCH_ENGINES_UPDATED)
    // 清理provider相关事件监听器
    window.electron?.ipcRenderer?.removeAllListeners(CONFIG_EVENTS.PROVIDER_CHANGED)
    window.electron?.ipcRenderer?.removeAllListeners(CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE)
    window.electron?.ipcRenderer?.removeAllListeners(CONFIG_EVENTS.PROVIDER_BATCH_UPDATE)
  }

  // 添加设置notificationsEnabled的方法
  const setNotificationsEnabled = async (enabled: boolean) => {
    await uiSettingsStore.setNotificationsEnabled(enabled)
  }

  const getNotificationsEnabled = async (): Promise<boolean> => {
    return notificationsEnabled.value
  }

  const setSearchPreviewEnabled = async (enabled: boolean) => {
    await uiSettingsStore.setSearchPreviewEnabled(enabled)
  }

  const getSearchPreviewEnabled = async (): Promise<boolean> => {
    return searchPreviewEnabled.value
  }

  const setContentProtectionEnabled = async (enabled: boolean) => {
    await uiSettingsStore.setContentProtectionEnabled(enabled)
  }

  // 日志开关状态
  const loggingEnabled = ref<boolean>(false)

  // 设置日志开关状态
  const setLoggingEnabled = async (enabled: boolean) => {
    // 更新本地状态
    loggingEnabled.value = Boolean(enabled)

    // 调用ConfigPresenter设置值
    await configP.setLoggingEnabled(enabled)
  }

  ///////////////////////////////////////////////////////////////////////////////////////
  const setCopyWithCotEnabled = async (enabled: boolean) => {
    await uiSettingsStore.setCopyWithCotEnabled(enabled)
  }

  const getCopyWithCotEnabled = async (): Promise<boolean> => {
    return copyWithCotEnabled.value
  }

  ///////////////////////////////////////////////////////////////////////////////////////
  const setTraceDebugEnabled = async (enabled: boolean) => {
    await uiSettingsStore.setTraceDebugEnabled(enabled)
  }

  const getTraceDebugEnabled = async (): Promise<boolean> => {
    return traceDebugEnabled.value
  }

  ///////////////////////////////////////////////////////////////////////////////////////
  const findModelByIdOrName = (
    modelId: string
  ): { model: RENDERER_MODEL_META; providerId: string } | null => {
    if (!enabledModels.value || enabledModels.value.length === 0) {
      return null
    }
    // 完全匹配
    for (const providerModels of enabledModels.value) {
      for (const model of providerModels.models) {
        if (model.id === modelId || model.name === modelId) {
          return {
            model,
            providerId: providerModels.providerId
          }
        }
      }
    }

    // 模糊匹配
    for (const providerModels of enabledModels.value) {
      for (const model of providerModels.models) {
        if (
          model.id.toLowerCase().includes(modelId.toLowerCase()) ||
          model.name.toLowerCase().includes(modelId.toLowerCase())
        ) {
          return {
            model,
            providerId: providerModels.providerId
          }
        }
      }
    }

    return null
  }

  // 初始化或加载保存的顺序
  const loadSavedOrder = async () => {
    try {
      await providerStore.loadProviderOrder()
    } catch (error) {
      console.error('Failed to load saved provider order:', error)
    }
  }

  // 更新 provider 顺序 - 支持分区域拖拽
  const updateProvidersOrder = async (newProviders: LLM_PROVIDER[]) => {
    try {
      await providerStore.updateProvidersOrder(newProviders)
    } catch (error) {
      console.error('Failed to update provider order:', error)
      throw error
    }
  }

  const setAzureApiVersion = async (version: string) => {
    await configP.setSetting('azureApiVersion', version)
  }

  const getAzureApiVersion = async (): Promise<string> => {
    return (await configP.getSetting<string>('azureApiVersion')) || '2024-02-01'
  }
  const setGeminiSafety = async (
    key: string,
    value:
      | 'BLOCK_NONE'
      | 'BLOCK_ONLY_HIGH'
      | 'BLOCK_MEDIUM_AND_ABOVE'
      | 'BLOCK_LOW_AND_ABOVE'
      | 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
  ) => {
    await configP.setSetting(`geminiSafety_${key}`, value)
  }

  const getGeminiSafety = async (key: string): Promise<string> => {
    return (
      (await configP.getSetting<string>(`geminiSafety_${key}`)) ||
      'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
    )
  }

  // AWS Bedrock
  const setAwsBedrockCredential = async (credential: AwsBedrockCredential) => {
    await configP.setSetting('awsBedrockCredential', JSON.stringify({ credential }))
  }

  const getAwsBedrockCredential = async (): Promise<AwsBedrockCredential | undefined> => {
    return await configP.getSetting<AwsBedrockCredential | undefined>('awsBedrockCredential')
  }

  // 默认系统提示词相关方法
  const getDefaultSystemPrompt = async (): Promise<string> => {
    return await configP.getDefaultSystemPrompt()
  }

  const setDefaultSystemPrompt = async (prompt: string): Promise<void> => {
    await systemPromptStore.setDefaultSystemPrompt(prompt)
  }

  const resetToDefaultPrompt = async (): Promise<void> => {
    await systemPromptStore.resetToDefaultPrompt()
  }

  const clearSystemPrompt = async (): Promise<void> => {
    await systemPromptStore.clearSystemPrompt()
  }

  const getSystemPrompts = async () => {
    await systemPromptStore.loadPrompts()
    return systemPromptStore.prompts
  }

  const setSystemPrompts = async (prompts: SystemPrompt[]) => {
    await systemPromptStore.savePrompts(prompts)
  }

  const addSystemPrompt = async (prompt: SystemPrompt) => {
    await systemPromptStore.addSystemPrompt(prompt)
  }

  const updateSystemPrompt = async (promptId: string, updates: Partial<SystemPrompt>) => {
    await systemPromptStore.updateSystemPrompt(promptId, updates)
  }

  const deleteSystemPrompt = async (promptId: string) => {
    await systemPromptStore.deleteSystemPrompt(promptId)
  }

  const setDefaultSystemPromptId = async (promptId: string) => {
    await systemPromptStore.setDefaultSystemPromptId(promptId)
  }

  const getDefaultSystemPromptId = async () => {
    await systemPromptStore.loadPrompts()
    return systemPromptStore.defaultPromptId
  }

  const getModelConfig = async (modelId: string, providerId: string): Promise<any> => {
    return await modelConfigStore.getModelConfig(modelId, providerId)
  }

  const scheduleProviderRefresh = (providerId: string) => {
    refreshProviderModels(providerId).catch((error) => {
      console.error(`后台刷新模型失败: ${providerId}`, error)
    })
  }

  const setModelConfig = async (
    modelId: string,
    providerId: string,
    config: any
  ): Promise<void> => {
    await modelConfigStore.setModelConfig(modelId, providerId, config)
    scheduleProviderRefresh(providerId)
  }

  const resetModelConfig = async (modelId: string, providerId: string): Promise<void> => {
    await modelConfigStore.resetModelConfig(modelId, providerId)
    scheduleProviderRefresh(providerId)
  }

  return {
    providers,
    fontSizeLevel, // Expose font size level
    fontSizeClass, // Expose font size class
    enabledModels,
    allProviderModels,
    customModels,
    searchEngines,
    activeSearchEngine,
    artifactsEffectEnabled,
    searchPreviewEnabled,
    contentProtectionEnabled,
    copyWithCotEnabled,
    notificationsEnabled, // 暴露系统通知状态
    loggingEnabled,
    updateProvider,
    updateFontSizeLevel, // Expose update function
    initSettings,
    searchModels,
    refreshAllModels,
    updateModelStatus,
    checkProvider,
    addCustomModel,
    removeCustomModel,
    updateCustomModel,
    updateProviderConfig,
    updateProviderApi,
    updateProviderAuth,
    updateProviderStatus,
    updateAwsBedrockProviderConfig,
    refreshProviderModels,
    addCustomProvider,
    removeProvider,
    disableAllModels,
    enableAllModels,
    searchAssistantModel,
    setSearchAssistantModel,
    initOrUpdateSearchAssistantModel,
    cleanAllMessages,
    defaultProviders,
    getOllamaRunningModels,
    getOllamaLocalModels,
    getOllamaPullingModels,
    refreshOllamaModels,
    pullOllamaModel,
    isOllamaModelRunning,
    isOllamaModelLocal,
    clearOllamaProviderData,
    removeOllamaEventListeners,
    cleanup,
    getSearchPreviewEnabled,
    setSearchPreviewEnabled,
    setNotificationsEnabled, // 暴露设置系统通知的方法
    getNotificationsEnabled, // 暴露获取系统通知状态的方法
    setSearchEngine: searchEngineStore.setSearchEngine,
    setContentProtectionEnabled,
    setLoggingEnabled,
    getCopyWithCotEnabled,
    setCopyWithCotEnabled,
    traceDebugEnabled,
    getTraceDebugEnabled,
    setTraceDebugEnabled,
    testSearchEngine: searchEngineStore.testSearchEngine,
    refreshSearchEngines: searchEngineStore.refreshSearchEngines,
    setupSearchEnginesListener: searchEngineStore.setupSearchEnginesListener,
    findModelByIdOrName,
    mcpInstallCache,
    clearMcpInstallCache,
    isUpdating: upgradeStore.isUpdating,
    loadSavedOrder,
    updateProvidersOrder,
    sortedProviders,
    setAzureApiVersion,
    getAzureApiVersion,
    setGeminiSafety,
    getGeminiSafety,
    setAwsBedrockCredential,
    getAwsBedrockCredential,
    getDefaultSystemPrompt,
    setDefaultSystemPrompt,
    resetToDefaultPrompt,
    clearSystemPrompt,
    getSystemPrompts,
    setSystemPrompts,
    addSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt,
    setDefaultSystemPromptId,
    getDefaultSystemPromptId,
    setupProviderListener,
    getModelConfig,
    setModelConfig,
    resetModelConfig
  }
})
