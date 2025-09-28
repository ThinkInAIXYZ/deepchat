import { defineStore } from 'pinia'
import { ref, onMounted, toRaw, computed } from 'vue'
import { type LLM_PROVIDER, type RENDERER_MODEL_META } from '@shared/presenter'
import type { ProviderChange, ProviderBatchUpdate } from '@shared/provider-operations'
import { ModelType } from '@shared/model'
import { usePresenter } from '@/composables/usePresenter'
import { SearchEngineTemplate } from '@shared/chat'
import { CONFIG_EVENTS, OLLAMA_EVENTS, DEEPLINK_EVENTS } from '@/events'
import type { AWS_BEDROCK_PROVIDER, AwsBedrockCredential, OllamaModel } from '@shared/presenter'
import { useRouter } from 'vue-router'
import { useMcpStore } from '@/stores/mcp'
import { useUpgradeStore } from '@/stores/upgrade'
import { useThrottleFn } from '@vueuse/core'

// 定义字体大小级别对应的 Tailwind 类
const FONT_SIZE_CLASSES = ['text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']
const DEFAULT_FONT_SIZE_LEVEL = 1 // 对应 'text-base'

export const useSettingsStore = defineStore('settings', () => {
  const configP = usePresenter('configPresenter')
  const llmP = usePresenter('llmproviderPresenter')
  const threadP = usePresenter('threadPresenter')
  const router = useRouter()
  const upgradeStore = useUpgradeStore()
  const providers = ref<LLM_PROVIDER[]>([])
  const providerOrder = ref<string[]>([])
  const enabledModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const allProviderModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const customModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const searchEngines = ref<SearchEngineTemplate[]>([])
  const activeSearchEngine = ref<SearchEngineTemplate | null>(null)
  const artifactsEffectEnabled = ref<boolean>(false) // 默认值与配置文件一致
  const searchPreviewEnabled = ref<boolean>(true) // 搜索预览是否启用，默认启用
  const contentProtectionEnabled = ref<boolean>(true) // 投屏保护是否启用，默认启用
  const copyWithCotEnabled = ref<boolean>(true)
  const notificationsEnabled = ref<boolean>(true) // 系统通知是否启用，默认启用
  const fontSizeLevel = ref<number>(DEFAULT_FONT_SIZE_LEVEL) // 字体大小级别，默认为 1
  // Ollama 相关状态
  const ollamaRunningModels = ref<OllamaModel[]>([])
  const ollamaLocalModels = ref<OllamaModel[]>([])
  const ollamaPullingModels = ref<Map<string, number>>(new Map()) // 模型名 -> 进度

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
  const defaultProviders = ref<LLM_PROVIDER[]>([])
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
      // const provider = enabledModels.value.find((p) => p.providerId === savedModel.providerId)
      // const modelExists = provider?.models.some((m) => m.id === savedModel.model.id)

      // if (modelExists) {
      searchAssistantModelRef.value = savedModel.model
      searchAssistantProviderRef.value = savedModel.providerId
      // 通知线程处理器更新搜索助手模型
      threadP.setSearchAssistantModel(savedModel.model, savedModel.providerId)
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
      threadP.setSearchAssistantModel(
        {
          id: priorityModel.model.id,
          name: priorityModel.model.name,
          contextLength: priorityModel.model.contextLength,
          maxTokens: priorityModel.model.maxTokens,
          providerId: priorityModel.providerId,
          group: priorityModel.model.group,
          isCustom: priorityModel.model.isCustom,
          vision: priorityModel.model.vision || false,
          functionCall: priorityModel.model.functionCall || false,
          reasoning: priorityModel.model.reasoning || false,
          type: priorityModel.model.type || ModelType.Chat
        },
        toRaw(priorityModel.providerId)
      )
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

  // 字体大小对应的 CSS 类
  const fontSizeClass = computed(
    () => FONT_SIZE_CLASSES[fontSizeLevel.value] || FONT_SIZE_CLASSES[DEFAULT_FONT_SIZE_LEVEL]
  )

  // 维护 provider 状态变更时间戳的映射
  const providerTimestamps = ref<Record<string, number>>({})

  const loadProviderTimestamps = async () => {
    try {
      const savedTimestamps = await configP.getSetting<Record<string, number>>('providerTimestamps')
      if (savedTimestamps) {
        providerTimestamps.value = savedTimestamps
      }
    } catch (error) {
      console.error('Failed to load provider timestamps:', error)
    }
  }

  const saveProviderTimestamps = async () => {
    try {
      await configP.setSetting('providerTimestamps', providerTimestamps.value)
    } catch (error) {
      console.error('Failed to save provider timestamps:', error)
    }
  }

  // 计算排序后的 providers
  const sortedProviders = computed(() => {
    const enabledProviders: LLM_PROVIDER[] = []
    const disabledProviders: LLM_PROVIDER[] = []

    providers.value.forEach((provider) => {
      if (provider.enable) {
        enabledProviders.push(provider)
      } else {
        disabledProviders.push(provider)
      }
    })

    // 排序函数：优先使用拖拽顺序，其次使用时间戳
    const sortProviders = (providerList: LLM_PROVIDER[], useAscendingTime: boolean) => {
      return providerList.sort((a, b) => {
        const aOrderIndex = providerOrder.value.indexOf(a.id)
        const bOrderIndex = providerOrder.value.indexOf(b.id)
        if (aOrderIndex !== -1 && bOrderIndex !== -1) {
          return aOrderIndex - bOrderIndex
        }
        if (aOrderIndex !== -1 && bOrderIndex === -1) {
          return -1
        }
        if (aOrderIndex === -1 && bOrderIndex !== -1) {
          return 1
        }
        const aTime = providerTimestamps.value[a.id] || 0
        const bTime = providerTimestamps.value[b.id] || 0
        return useAscendingTime ? aTime - bTime : bTime - aTime
      })
    }
    const sortedEnabled = sortProviders(enabledProviders, true)
    const sortedDisabled = sortProviders(disabledProviders, false)

    return [...sortedEnabled, ...sortedDisabled]
  })

  // 初始化设置
  const initSettings = async () => {
    try {
      loggingEnabled.value = await configP.getLoggingEnabled()
      copyWithCotEnabled.value = await configP.getCopyWithCotEnabled()

      // 获取全部 provider
      providers.value = await configP.getProviders()
      defaultProviders.value = await configP.getDefaultProviders()
      // 加载保存的 provider 顺序
      await loadSavedOrder()
      await loadProviderTimestamps()

      // 获取字体大小级别
      fontSizeLevel.value =
        (await configP.getSetting<number>('fontSizeLevel')) ?? DEFAULT_FONT_SIZE_LEVEL
      // 确保级别在有效范围内
      if (fontSizeLevel.value < 0 || fontSizeLevel.value >= FONT_SIZE_CLASSES.length) {
        fontSizeLevel.value = DEFAULT_FONT_SIZE_LEVEL
      }

      // 获取搜索预览设置
      searchPreviewEnabled.value = await configP.getSearchPreviewEnabled()

      // 获取投屏保护设置
      contentProtectionEnabled.value = await configP.getContentProtectionEnabled()

      // 获取系统通知设置
      notificationsEnabled.value =
        (await configP.getSetting<boolean>('notificationsEnabled')) ?? true

      // 获取搜索引擎
      searchEngines.value = await threadP.getSearchEngines()

      // 加载自定义搜索引擎并合并
      try {
        const customEngines = await configP.getCustomSearchEngines()
        if (customEngines && customEngines.length > 0) {
          // 移除已有的自定义搜索引擎（避免重复）
          searchEngines.value = searchEngines.value.filter((e) => !e.isCustom)
          // 添加自定义搜索引擎
          searchEngines.value.push(...customEngines)
        }
      } catch (error) {
        console.error('加载自定义搜索引擎失败:', error)
      }

      // 设置当前活跃的搜索引擎
      const activeEngineId = (await configP.getSetting<string>('searchEngine')) || 'google'
      const engine = searchEngines.value.find((e) => e.id === activeEngineId)
      if (engine) {
        activeSearchEngine.value = engine
      } else {
        // 如果找不到指定的引擎，使用第一个
        activeSearchEngine.value = searchEngines.value[0]
      }
      await threadP.setActiveSearchEngine(activeEngineId)
      // 获取全部模型
      await refreshAllModels()

      // 设置 Ollama 事件监听器
      setupOllamaEventListeners()

      // 设置 artifacts 效果事件监听器
      // setupArtifactsEffectListener()

      // 设置投屏保护事件监听器
      setupContentProtectionListener()

      // 设置拷贝事件监听器
      setupCopyWithCotEnabledListener()

      // 单独刷新一次 Ollama 模型，确保即使没有启用 Ollama provider 也能获取模型列表
      if (providers.value.some((p) => p.id === 'ollama')) {
        await refreshOllamaModels()
      }
      // 初始化搜索助手模型
      await initOrUpdateSearchAssistantModel()
      // 设置事件监听
      setupProviderListener()

      // 设置搜索引擎事件监听
      setupSearchEnginesListener()
    } catch (error) {
      console.error('初始化设置失败:', error)
    }
  }

  // 刷新单个提供商的自定义模型
  const refreshCustomModels = async (providerId: string): Promise<void> => {
    try {
      // 直接从配置存储获取自定义模型列表，不依赖provider实例
      const customModelsList = await configP.getCustomModels(providerId)

      // 如果customModelsList为null或undefined，使用空数组
      const safeCustomModelsList = customModelsList || []

      // 批量获取自定义模型状态并合并
      const modelIds = safeCustomModelsList.map((model) => model.id)
      const modelStatusMap =
        modelIds.length > 0 ? await configP.getBatchModelStatus(providerId, modelIds) : {}

      const customModelsWithStatus = safeCustomModelsList.map((model) => {
        return {
          ...model,
          enabled: modelStatusMap[model.id] ?? true,
          providerId,
          isCustom: true,
          type: model.type || ModelType.Chat
        } as RENDERER_MODEL_META
      })

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
      // 获取在线模型
      let models = await configP.getProviderModels(providerId)
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
              group: meta.group,
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
          // 如果获取失败，使用空数组继续
          models = []
          // 如果是 OpenAI provider，可能需要检查配置
          if (providerId === 'openai') {
            const provider = providers.value.find((p) => p.id === 'openai')
            if (provider) {
              // 禁用 provider
              await updateProviderStatus('openai', false)
              console.warn('Disabled OpenAI provider due to API error')
            }
          }
          return
        }
      }

      // 批量获取模型状态并合并
      const modelIds = models.map((model) => model.id)
      const modelStatusMap =
        modelIds.length > 0 ? await configP.getBatchModelStatus(providerId, modelIds) : {}

      const modelsWithStatus = models.map((model) => {
        return {
          ...model,
          enabled: modelStatusMap[model.id] ?? true,
          providerId,
          isCustom: model.isCustom || false
        }
      })

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
    if (providerId === 'ollama') {
      await refreshOllamaModels()
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
    providers.value = await configP.getProviders()
    // 如果 provider 的启用状态发生变化，刷新模型列表
    if (provider.enable !== providers.value.find((p) => p.id === id)?.enable) {
      await refreshAllModels()
    }
  }

  // 更新字体大小级别
  const updateFontSizeLevel = async (level: number) => {
    const validLevel = Math.max(0, Math.min(level, FONT_SIZE_CLASSES.length - 1))
    if (fontSizeLevel.value !== validLevel) {
      fontSizeLevel.value = validLevel
      await configP.setSetting('fontSizeLevel', validLevel)
    }
  }

  // 监听 provider 设置变化
  const setupProviderListener = () => {
    // 监听配置变更事件
    window.electron.ipcRenderer.on(CONFIG_EVENTS.PROVIDER_CHANGED, async () => {
      console.log('Provider changed - updating providers and order')
      providers.value = await configP.getProviders()
      await loadSavedOrder()
      await refreshAllModels()
    })
    // 监听原子provider更新事件
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.PROVIDER_ATOMIC_UPDATE,
      async (_event, change: ProviderChange) => {
        console.log(
          `Provider atomic update - operation: ${change.operation}, providerId: ${change.providerId}`
        )
        providers.value = await configP.getProviders()
        await loadSavedOrder()
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
        } else {
          // add 或 update 操作，刷新该provider的模型
          await refreshProviderModels(change.providerId)
        }
      }
    )
    // 监听批量provider更新事件
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.PROVIDER_BATCH_UPDATE,
      async (_event, batchUpdate: ProviderBatchUpdate) => {
        console.log('Provider batch update - changes:', batchUpdate.changes)
        providers.value = await configP.getProviders()
        await loadSavedOrder()
        // 处理批量变更
        for (const change of batchUpdate.changes) {
          if (change.operation === 'remove') {
            enabledModels.value = enabledModels.value.filter(
              (p) => p.providerId !== change.providerId
            )
            allProviderModels.value = allProviderModels.value.filter(
              (p) => p.providerId !== change.providerId
            )
          } else if (change.operation !== 'reorder') {
            await refreshProviderModels(change.providerId)
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

    // 添加对投屏保护变更的监听
    setupContentProtectionListener()

    // 设置拷贝事件监听器
    setupCopyWithCotEnabledListener()

    // 设置字体大小事件监听器
    setupFontSizeListener()
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
            models.push({
              ...model,
              enabled: true,
              vision: model.vision || false,
              functionCall: model.functionCall || false,
              reasoning: model.reasoning || false,
              type: model.type || ModelType.Chat
            })
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

    // 强制触发响应式更新
    enabledModels.value = [...enabledModels.value]
    console.log('enabledModels updated:', enabledModels.value)
  }

  // 更新模型状态
  const updateModelStatus = async (providerId: string, modelId: string, enabled: boolean) => {
    try {
      await llmP.updateModelStatus(providerId, modelId, enabled)
      // 调用成功后，刷新该 provider 的模型列表
      await refreshProviderModels(providerId)
    } catch (error) {
      console.error('Failed to update model status:', error)
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
    // 更新时间戳
    providerTimestamps.value[providerId] = Date.now()
    // 保存时间戳
    await saveProviderTimestamps()
    await updateProviderConfig(providerId, { enable })

    await optimizeProviderOrder(providerId, enable)
  }

  const optimizeProviderOrder = async (providerId: string, enable: boolean): Promise<void> => {
    try {
      const currentOrder = [...providerOrder.value]
      const providerIndex = currentOrder.indexOf(providerId)
      if (providerIndex === -1) return
      currentOrder.splice(providerIndex, 1)
      const allProviders = providers.value
      const enabledInOrder: string[] = []
      const disabledInOrder: string[] = []
      currentOrder.forEach((id) => {
        const provider = allProviders.find((p) => p.id === id)
        if (!provider || provider.id === providerId) return
        if (provider.enable) {
          enabledInOrder.push(id)
        } else {
          disabledInOrder.push(id)
        }
      })
      let newOrder: string[]
      if (enable) {
        newOrder = [...enabledInOrder, providerId, ...disabledInOrder]
      } else {
        newOrder = [...enabledInOrder, providerId, ...disabledInOrder]
      }
      const existingIds = providers.value.map((p) => p.id)
      const missingIds = existingIds.filter((id) => !newOrder.includes(id))
      const finalOrder = [...newOrder, ...missingIds]
      providerOrder.value = finalOrder
      await configP.setSetting('providerOrder', finalOrder)
    } catch (error) {
      console.error('Failed to optimize provider order:', error)
    }
  }

  const setSearchEngine = async (engineId: string) => {
    try {
      let success = await threadP.setSearchEngine(engineId)

      // 如果第一次设置失败，可能是后端搜索引擎列表还没更新，强制刷新后重试
      if (!success) {
        console.log('第一次设置搜索引擎失败，尝试刷新搜索引擎列表后重试')
        await refreshSearchEngines()
        success = await threadP.setSearchEngine(engineId)
      }

      if (success) {
        // 先尝试从当前列表中查找
        let engine = searchEngines.value.find((e) => e.id === engineId)

        // 如果找不到，可能是新添加的自定义引擎，从后端重新获取
        if (!engine) {
          try {
            const customEngines = await configP.getCustomSearchEngines()
            if (customEngines) {
              engine = customEngines.find((e) => e.id === engineId)
            }
          } catch (error) {
            console.warn('获取自定义搜索引擎失败:', error)
          }
        }

        activeSearchEngine.value = engine || null

        // 同时保存到配置中
        await configP.setSetting('searchEngine', engineId)
      } else {
        console.error('设置搜索引擎失败，engineId:', engineId)
      }
    } catch (error) {
      console.error('设置搜索引擎失败', error)
    }
  }

  /**
   * 刷新搜索引擎列表
   */
  const refreshSearchEngines = async () => {
    try {
      const engines = await threadP.getSearchEngines()
      const activeEngine = await threadP.getActiveSearchEngine()

      searchEngines.value = engines
      activeSearchEngine.value = activeEngine
    } catch (error) {
      console.error('刷新搜索引擎列表失败', error)
    }
  }

  /**
   * 测试当前选中的搜索引擎
   * @param query 测试搜索的关键词，默认为"天气"
   * @returns 测试是否成功
   */
  const testSearchEngine = async (query: string = '天气'): Promise<boolean> => {
    try {
      return await threadP.testSearchEngine(query)
    } catch (error) {
      console.error('测试搜索引擎失败', error)
      return false
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
      providers.value = await configP.getProviders()

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
      // 使用新的原子操作接口
      await configP.removeProviderAtomic(providerId)

      // 更新本地状态
      providers.value = await configP.getProviders()

      // 从保存的顺序中移除此 provider
      providerOrder.value = providerOrder.value.filter((id) => id !== providerId)
      await configP.setSetting('providerOrder', providerOrder.value)

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
  /**
   * 刷新 Ollama 模型列表
   */
  const refreshOllamaModels = async (): Promise<void> => {
    try {
      ollamaRunningModels.value = await llmP.listOllamaRunningModels()
      ollamaLocalModels.value = await llmP.listOllamaModels()

      // 更新到全局模型列表中
      await syncOllamaModelsToGlobal()
    } catch (error) {
      console.error('Failed to refresh Ollama models:', error)
    }
  }

  /**
   * 同步 Ollama 模型到全局模型列表
   */
  const syncOllamaModelsToGlobal = async (): Promise<void> => {
    // 找到 Ollama provider
    const ollamaProvider = providers.value.find((p) => p.id === 'ollama')
    if (!ollamaProvider) return

    // 获取现有的 Ollama 模型，以保留自定义设置
    const existingOllamaModels =
      allProviderModels.value.find((item) => item.providerId === 'ollama')?.models || []

    // 将 Ollama 本地模型转换为全局模型格式
    const ollamaModelsAsGlobal = ollamaLocalModels.value.map((model) => {
      // 检查是否已存在相同ID的模型，如果存在，保留其现有的配置
      const existingModel = existingOllamaModels.find((m) => m.id === model.name)

      return {
        id: model.name,
        name: model.name,
        contextLength: model.model_info.context_length || 4096, // 使用模型定义值或默认值
        maxTokens: existingModel?.maxTokens || 2048, // 使用现有值或默认值
        provider: 'ollama',
        group: existingModel?.group || 'local',
        enabled: true,
        isCustom: existingModel?.isCustom || false,
        providerId: 'ollama',
        vision: model.capabilities.indexOf('vision') > -1,
        functionCall: model.capabilities.indexOf('tools') > -1,
        reasoning: model.capabilities.indexOf('thinking') > -1,
        type: model.capabilities.indexOf('embedding') > -1 ? ModelType.Embedding : ModelType.Chat,
        // 保留现有的其他配置，但确保更新 Ollama 特有数据
        ...(existingModel ? { ...existingModel } : {}),
        ollamaModel: model
      } as RENDERER_MODEL_META & { ollamaModel: OllamaModel }
    })

    // 更新全局模型列表
    const existingIndex = allProviderModels.value.findIndex((item) => item.providerId === 'ollama')

    if (existingIndex !== -1) {
      // 只替换 Ollama 的模型，保留全局数据中的其他字段
      allProviderModels.value[existingIndex].models = ollamaModelsAsGlobal
    } else {
      allProviderModels.value.push({
        providerId: 'ollama',
        models: ollamaModelsAsGlobal
      })
    }

    // 更新已启用的模型列表
    const enabledIndex = enabledModels.value.findIndex((item) => item.providerId === 'ollama')
    const enabledOllamaModels = ollamaModelsAsGlobal.filter((model) => model.enabled)

    if (enabledIndex !== -1) {
      enabledModels.value[enabledIndex].models = enabledOllamaModels
    } else if (enabledOllamaModels.length > 0) {
      enabledModels.value.push({
        providerId: 'ollama',
        models: enabledOllamaModels
      })
    }

    // 触发搜索助手模型更新，确保如果有 Ollama 模型符合条件也能被用作搜索助手
    await initOrUpdateSearchAssistantModel()
  }

  /**
   * 拉取 Ollama 模型
   */
  const pullOllamaModel = async (modelName: string): Promise<boolean> => {
    try {
      // 初始化进度为0
      ollamaPullingModels.value.set(modelName, 0)

      // 开始拉取
      const success = await llmP.pullOllamaModels(modelName)

      if (!success) {
        // 如果拉取失败，删除进度记录
        ollamaPullingModels.value.delete(modelName)
      }

      return success
    } catch (error) {
      console.error(`Failed to pull Ollama model ${modelName}:`, error)
      ollamaPullingModels.value.delete(modelName)
      return false
    }
  }

  /**
   * 删除 Ollama 模型
   */
  const deleteOllamaModel = async (modelName: string): Promise<boolean> => {
    try {
      const success = await llmP.deleteOllamaModel(modelName)
      if (success) {
        await refreshOllamaModels()
      }
      return success
    } catch (error) {
      console.error(`Failed to delete Ollama model ${modelName}:`, error)
      return false
    }
  }

  /**
   * 处理 Ollama 模型拉取事件
   */
  const handleOllamaModelPullEvent = (event: Record<string, unknown>) => {
    if (event?.eventId !== 'pullOllamaModels' || !event?.modelName) return

    const modelName = event.modelName as string
    const status = event.status as string
    const total = event.total as number
    const completed = event.completed as number

    // 如果有 completed 和 total，计算进度
    if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
      const progress = Math.min(Math.round((completed / total) * 100), 100)
      ollamaPullingModels.value.set(modelName, progress)
    }
    // 如果只有 status 是 pulling manifest 或没有 total，设置为初始状态
    else if (status && status.includes('manifest')) {
      ollamaPullingModels.value.set(modelName, 1) // 设置为1%表示开始
    }

    // 如果拉取完成
    if (status === 'success' || status === 'completed') {
      setTimeout(() => {
        ollamaPullingModels.value.delete(modelName)
        refreshOllamaModels()
      }, 1000)
    }
  }

  /**
   * 设置 Ollama 拉取事件监听器
   */
  const setupOllamaEventListeners = () => {
    window.electron?.ipcRenderer?.on(
      OLLAMA_EVENTS.PULL_MODEL_PROGRESS,
      (_event: unknown, data: Record<string, unknown>) => {
        handleOllamaModelPullEvent(data)
      }
    )
  }

  /**
   * 移除 Ollama 事件监听器
   */
  const removeOllamaEventListeners = () => {
    window.electron?.ipcRenderer?.removeAllListeners(OLLAMA_EVENTS.PULL_MODEL_PROGRESS)
  }

  /**
   * 判断模型是否正在运行
   */
  const isOllamaModelRunning = (modelName: string): boolean => {
    return ollamaRunningModels.value.some((m) => m.name === modelName)
  }

  /**
   * 判断模型是否已存在于本地
   */
  const isOllamaModelLocal = (modelName: string): boolean => {
    return ollamaLocalModels.value.some((m) => m.name === modelName)
  }

  /**
   * 获取正在拉取的 Ollama 模型列表
   */
  const getOllamaPullingModels = () => {
    return ollamaPullingModels.value
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
    // 更新本地状态
    notificationsEnabled.value = Boolean(enabled)

    // 调用ConfigPresenter设置值，确保等待Promise完成
    await configP.setNotificationsEnabled(enabled)
  }

  // 获取系统通知设置
  const getNotificationsEnabled = async (): Promise<boolean> => {
    return await configP.getNotificationsEnabled()
  }

  // 添加设置searchPreviewEnabled的方法
  const setSearchPreviewEnabled = async (enabled: boolean) => {
    // 更新本地状态
    searchPreviewEnabled.value = Boolean(enabled)

    // 调用ConfigPresenter设置值，确保等待Promise完成
    await configP.setSearchPreviewEnabled(enabled)
  }

  // 搜索预览设置 - 直接从configPresenter获取
  const getSearchPreviewEnabled = async (): Promise<boolean> => {
    return await configP.getSearchPreviewEnabled()
  }

  // 添加监听搜索引擎更新的事件
  const setupSearchEnginesListener = () => {
    // 使用IPC监听事件
    window.electron.ipcRenderer.on(CONFIG_EVENTS.SEARCH_ENGINES_UPDATED, async () => {
      try {
        const customEngines = await configP.getCustomSearchEngines()
        // 移除已有的自定义搜索引擎（避免重复）
        searchEngines.value = searchEngines.value.filter((e) => !e.isCustom)
        // 添加自定义搜索引擎（如果存在的话）
        if (customEngines && customEngines.length > 0) {
          searchEngines.value.push(...customEngines)
        }

        // 刷新活跃搜索引擎状态，确保后端和前端状态同步
        const currentActiveEngineId = await configP.getSetting<string>('searchEngine')
        if (currentActiveEngineId) {
          const engine = searchEngines.value.find((e) => e.id === currentActiveEngineId)
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

  // 添加设置contentProtectionEnabled的方法
  const setContentProtectionEnabled = async (enabled: boolean) => {
    // 更新本地状态
    contentProtectionEnabled.value = Boolean(enabled)

    // 调用ConfigPresenter设置值，确保等待Promise完成
    await configP.setContentProtectionEnabled(enabled)
  }

  // 设置投屏保护监听器
  const setupContentProtectionListener = () => {
    // 监听投屏保护变更事件
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.CONTENT_PROTECTION_CHANGED,
      (_event, enabled: boolean) => {
        contentProtectionEnabled.value = enabled
      }
    )
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
    copyWithCotEnabled.value = Boolean(enabled)
    await configP.setCopyWithCotEnabled(enabled)
  }

  const getCopyWithCotEnabled = async (): Promise<boolean> => {
    return await configP.getCopyWithCotEnabled()
  }

  const setupCopyWithCotEnabledListener = () => {
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.COPY_WITH_COT_CHANGED,
      (_event, enabled: boolean) => {
        copyWithCotEnabled.value = enabled
      }
    )
  }

  const setupFontSizeListener = () => {
    window.electron.ipcRenderer.on(
      CONFIG_EVENTS.FONT_SIZE_CHANGED,
      (_event, newFontSizeLevel: number) => {
        fontSizeLevel.value = newFontSizeLevel
      }
    )
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
      // 从配置中获取保存的顺序
      const savedOrder = await configP.getSetting<string[]>('providerOrder')
      if (savedOrder && Array.isArray(savedOrder)) {
        providerOrder.value = savedOrder
      } else {
        // 如果没有保存的顺序，使用当前 providers 的顺序
        providerOrder.value = providers.value.map((provider) => provider.id)
      }
    } catch (error) {
      console.error('Failed to load saved provider order:', error)
      // 出错时使用当前 providers 的顺序
      providerOrder.value = providers.value.map((provider) => provider.id)
    }
  }

  // 更新 provider 顺序 - 支持分区域拖拽
  const updateProvidersOrder = async (newProviders: LLM_PROVIDER[]) => {
    try {
      const enabledProviders: LLM_PROVIDER[] = []
      const disabledProviders: LLM_PROVIDER[] = []
      newProviders.forEach((provider) => {
        if (provider.enable) {
          enabledProviders.push(provider)
        } else {
          disabledProviders.push(provider)
        }
      })
      const newOrder = [...enabledProviders.map((p) => p.id), ...disabledProviders.map((p) => p.id)]

      // 确保所有现有的 provider 都在顺序中
      const existingIds = providers.value.map((p) => p.id)
      const missingIds = existingIds.filter((id) => !newOrder.includes(id))
      const finalOrder = [...newOrder, ...missingIds]

      // 更新顺序
      providerOrder.value = finalOrder
      // 保存新的顺序到配置中
      await configP.setSetting('providerOrder', finalOrder)

      // 使用新的原子操作接口 - 重新排序不需要重建实例
      await configP.reorderProvidersAtomic(newProviders)

      // 强制更新 providers 以触发视图更新
      providers.value = [...newProviders]
    } catch (error) {
      console.error('Failed to update provider order:', error)
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
    await configP.setDefaultSystemPrompt(prompt)
  }

  // 重置为默认系统提示词
  const resetToDefaultPrompt = async (): Promise<void> => {
    await configP.resetToDefaultPrompt()
  }

  // 清空系统提示词
  const clearSystemPrompt = async (): Promise<void> => {
    await configP.clearSystemPrompt()
  }

  const getSystemPrompts = async () => {
    return await configP.getSystemPrompts()
  }

  const setSystemPrompts = async (prompts: any[]) => {
    await configP.setSystemPrompts(prompts)
  }

  const addSystemPrompt = async (prompt: any) => {
    await configP.addSystemPrompt(prompt)
  }

  const updateSystemPrompt = async (promptId: string, updates: any) => {
    await configP.updateSystemPrompt(promptId, updates)
  }

  const deleteSystemPrompt = async (promptId: string) => {
    await configP.deleteSystemPrompt(promptId)
  }

  const setDefaultSystemPromptId = async (promptId: string) => {
    await configP.setDefaultSystemPromptId(promptId)
  }

  const getDefaultSystemPromptId = async () => {
    return await configP.getDefaultSystemPromptId()
  }

  // 模型配置相关方法
  const getModelConfig = async (modelId: string, providerId: string): Promise<any> => {
    return await configP.getModelDefaultConfig(modelId, providerId)
  }

  const setModelConfig = async (
    modelId: string,
    providerId: string,
    config: any
  ): Promise<void> => {
    await configP.setModelConfig(modelId, providerId, config)
    // 配置变更后刷新相关模型数据
    await refreshProviderModels(providerId)
  }

  const resetModelConfig = async (modelId: string, providerId: string): Promise<void> => {
    await configP.resetModelConfig(modelId, providerId)
    // 配置重置后刷新相关模型数据
    await refreshProviderModels(providerId)
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
    setSearchEngine,
    addCustomProvider,
    removeProvider,
    disableAllModels,
    enableAllModels,
    searchAssistantModel,
    setSearchAssistantModel,
    initOrUpdateSearchAssistantModel,
    cleanAllMessages,
    defaultProviders,
    ollamaRunningModels,
    ollamaLocalModels,
    ollamaPullingModels,
    refreshOllamaModels,
    pullOllamaModel,
    deleteOllamaModel,
    isOllamaModelRunning,
    isOllamaModelLocal,
    getOllamaPullingModels,
    removeOllamaEventListeners,
    cleanup,
    getSearchPreviewEnabled,
    setSearchPreviewEnabled,
    setNotificationsEnabled, // 暴露设置系统通知的方法
    getNotificationsEnabled, // 暴露获取系统通知状态的方法
    setupSearchEnginesListener,
    setContentProtectionEnabled,
    setupContentProtectionListener,
    setLoggingEnabled,
    getCopyWithCotEnabled,
    setCopyWithCotEnabled,
    setupCopyWithCotEnabledListener,
    testSearchEngine,
    refreshSearchEngines,
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
