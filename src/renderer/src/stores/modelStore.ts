import { computed, type ComputedRef, ref } from 'vue'
import { defineStore } from 'pinia'
import { useQueryCache, type DataState, type EntryKey, type UseQueryEntry } from '@pinia/colada'
import { useThrottleFn } from '@vueuse/core'
import type { MODEL_META, RENDERER_MODEL_META, ModelConfig } from '@shared/presenter'
import { ModelType } from '@shared/model'
import { useIpcMutation } from '@/composables/useIpcMutation'
import { usePresenter } from '@/composables/usePresenter'
import { useAgentModelStore } from '@/stores/agentModelStore'
import { useModelConfigStore } from '@/stores/modelConfigStore'
import { useProviderStore } from '@/stores/providerStore'
import { CONFIG_EVENTS, PROVIDER_DB_EVENTS } from '@/events'
import {
  buildSelectableProviderCatalog,
  type ModelCatalogFilters
} from '@/composables/model/modelCatalog'

const PROVIDER_MODELS_KEY = (providerId: string) => ['model-store', 'provider-models', providerId]
const CUSTOM_MODELS_KEY = (providerId: string) => ['model-store', 'custom-models', providerId]
const ENABLED_MODELS_KEY = (providerId: string) => ['model-store', 'enabled-models', providerId]

type ModelQueryHandle<TData> = {
  entry: UseQueryEntry<TData, unknown, TData | undefined>
  data: ComputedRef<TData | undefined>
  refresh: (throwOnError?: boolean) => Promise<DataState<TData, unknown, TData | undefined>>
  refetch: (throwOnError?: boolean) => Promise<DataState<TData, unknown, TData | undefined>>
}

export const useModelStore = defineStore('model', () => {
  const configP = usePresenter('configPresenter')
  const llmP = usePresenter('llmproviderPresenter')
  const providerStore = useProviderStore()
  const modelConfigStore = useModelConfigStore()
  const agentModelStore = useAgentModelStore()

  const enabledModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const allProviderModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const customModels = ref<{ providerId: string; models: RENDERER_MODEL_META[] }[]>([])
  const listenersRegistered = ref(false)

  const providerInitialized = ref<Set<string>>(new Set())
  const providerInitCallbacks = ref<Map<string, Array<() => void>>>(new Map())

  const providerModelQueries = new Map<string, ModelQueryHandle<MODEL_META[]>>()
  const customModelQueries = new Map<string, ModelQueryHandle<MODEL_META[]>>()
  const enabledModelQueries = new Map<string, ModelQueryHandle<RENDERER_MODEL_META[]>>()
  const queryCache = useQueryCache()
  const isAgentProvider = async (providerId: string): Promise<boolean> => {
    try {
      return Boolean(await llmP.isAgentProvider(providerId))
    } catch (error) {
      console.warn(`[ModelStore] Failed to determine provider type: ${providerId}`, error)
      return false
    }
  }

  const matchesProviderModelsEntry = (
    entry: { key: readonly unknown[] },
    targetProviderId?: string
  ) => {
    const key = entry.key
    if (!Array.isArray(key) || key.length < 3) return false
    const [namespace, scope, providerId] = key
    if (namespace !== 'model-store' || scope !== 'provider-models') return false
    if (!targetProviderId) return true

    // Strict matching: providerId must be a string and exactly match
    const matches = typeof providerId === 'string' && providerId === targetProviderId
    if (!matches && targetProviderId) {
      console.warn(
        `[ModelStore] matchesProviderModelsEntry: Cache key providerId "${providerId}" does not match target "${targetProviderId}"`
      )
    }
    return matches
  }

  const invalidateProviderModelsCache = async (providerId?: string) => {
    await queryCache.invalidateQueries({
      predicate: (entry) => matchesProviderModelsEntry(entry, providerId)
    })
  }

  const updateProviderModelsCache = (providerId: string, data: MODEL_META[]) => {
    console.log(
      `[ModelStore] updateProviderModelsCache: updating cache for provider "${providerId}" with ${data.length} models`
    )

    // Validate that all models have the correct providerId
    const validatedData = data.filter((model) => {
      if (model.providerId !== providerId) {
        console.warn(
          `[ModelStore] updateProviderModelsCache: Model ${model.id} has mismatched providerId: expected "${providerId}", got "${model.providerId}". Filtering out.`
        )
        return false
      }
      return true
    })

    if (validatedData.length !== data.length) {
      console.error(
        `[ModelStore] updateProviderModelsCache: Filtered out ${data.length - validatedData.length} models with incorrect providerId for provider "${providerId}"`
      )
    }

    console.log(
      `[ModelStore] updateProviderModelsCache: updating cache with ${validatedData.length} validated models for provider "${providerId}"`
    )

    queryCache.setQueriesData(
      {
        predicate: (entry) => matchesProviderModelsEntry(entry, providerId)
      },
      () => validatedData
    )
  }

  const normalizeRendererModel = (model: MODEL_META, providerId: string): RENDERER_MODEL_META => ({
    id: model.id,
    name: model.name || model.id,
    contextLength: model.contextLength ?? 4096,
    maxTokens: model.maxTokens ?? 2048,
    group: model.group || 'default',
    providerId,
    enabled: (model as RENDERER_MODEL_META).enabled ?? false,
    isCustom: model.isCustom ?? false,
    vision: model.vision ?? false,
    functionCall: model.functionCall ?? false,
    reasoning: model.reasoning ?? false,
    enableSearch: (model as RENDERER_MODEL_META).enableSearch ?? false,
    type: (model.type ?? ModelType.Chat) as ModelType
  })

  const createQueryHandle = <TData>(
    entry: UseQueryEntry<TData, unknown, TData | undefined>
  ): ModelQueryHandle<TData> => {
    const data = computed(() => entry.state.value.data as TData | undefined)
    const refresh = (throwOnError?: boolean) => {
      const promise = queryCache.refresh(entry)
      return throwOnError ? promise : promise.catch(() => entry.state.value)
    }
    const refetch = (throwOnError?: boolean) => {
      const promise = queryCache.fetch(entry)
      return throwOnError ? promise : promise.catch(() => entry.state.value)
    }
    return { entry, data, refresh, refetch }
  }

  const ensureQueryHandle = <TData>(
    map: Map<string, ModelQueryHandle<TData>>,
    providerId: string,
    options: {
      key: EntryKey
      staleTime: number
      query: () => Promise<TData>
    }
  ) => {
    const entry = queryCache.ensure<TData>(options)
    const existing = map.get(providerId)
    if (existing?.entry === entry) return existing
    const handle = createQueryHandle(entry)
    map.set(providerId, handle)
    return handle
  }

  const getProviderModelsQuery = (providerId: string) => {
    return ensureQueryHandle(providerModelQueries, providerId, {
      key: PROVIDER_MODELS_KEY(providerId),
      staleTime: 30_000,
      query: async () => configP.getProviderModels(providerId)
    })
  }

  const getCustomModelsQuery = (providerId: string) => {
    return ensureQueryHandle(customModelQueries, providerId, {
      key: CUSTOM_MODELS_KEY(providerId),
      staleTime: 30_000,
      query: async () => configP.getCustomModels(providerId)
    })
  }

  const getEnabledModelsQuery = (providerId: string) => {
    return ensureQueryHandle(enabledModelQueries, providerId, {
      key: ENABLED_MODELS_KEY(providerId),
      staleTime: 30_000,
      query: async () => {
        const [providerModels, customModelsList] = await Promise.all([
          configP.getProviderModels(providerId),
          configP.getCustomModels(providerId)
        ])
        const modelIds = [...providerModels, ...customModelsList].map((model) => model.id)
        const statusMap =
          modelIds.length > 0 ? await configP.getBatchModelStatus(providerId, modelIds) : {}
        return [...providerModels, ...customModelsList]
          .filter((model) => statusMap[model.id] === true)
          .map((model) => ({ ...normalizeRendererModel(model, providerId), enabled: true }))
      }
    })
  }

  const applyUserDefinedModelConfig = async (
    model: RENDERER_MODEL_META,
    providerId: string
  ): Promise<RENDERER_MODEL_META> => {
    const normalized: RENDERER_MODEL_META = {
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
          config.maxTokens ?? config.maxCompletionTokens ?? normalized.maxTokens
        return {
          ...normalized,
          contextLength: config.contextLength ?? normalized.contextLength,
          maxTokens: resolvedMaxTokens,
          vision: config.vision ?? normalized.vision ?? false,
          functionCall: config.functionCall ?? normalized.functionCall ?? false,
          reasoning: config.reasoning ?? normalized.reasoning ?? false,
          enableSearch: config.enableSearch ?? normalized.enableSearch ?? false,
          type: config.type ?? normalized.type ?? ModelType.Chat
        }
      }
    } catch (error) {
      console.error(`读取模型配置失败: ${providerId}/${model.id}`, error)
    }

    return normalized
  }

  const updateCustomModelState = (providerId: string, models: RENDERER_MODEL_META[]) => {
    const customIndex = customModels.value.findIndex((item) => item.providerId === providerId)
    if (customIndex !== -1) {
      customModels.value[customIndex].models = models
    } else {
      customModels.value.push({ providerId, models })
    }
  }

  const updateAllProviderState = (providerId: string, models: RENDERER_MODEL_META[]) => {
    const idx = allProviderModels.value.findIndex((item) => item.providerId === providerId)
    if (idx !== -1) {
      allProviderModels.value[idx].models = models
    } else {
      allProviderModels.value.push({ providerId, models })
    }
  }

  const updateEnabledState = (providerId: string, models: RENDERER_MODEL_META[]) => {
    console.log(
      `[ModelStore] updateEnabledState: updating enabled state for provider "${providerId}" with ${models.length} models`
    )
    const enabledModelsList = models.filter((model) => model.enabled)
    const idx = enabledModels.value.findIndex((item) => item.providerId === providerId)
    if (idx !== -1) {
      if (enabledModelsList.length > 0) {
        enabledModels.value[idx].models = enabledModelsList
      } else {
        enabledModels.value.splice(idx, 1)
      }
    } else if (enabledModelsList.length > 0) {
      enabledModels.value.push({ providerId, models: enabledModelsList })
    }

    enabledModels.value = [...enabledModels.value]
  }

  const refreshCustomModels = async (providerId: string): Promise<void> => {
    try {
      const query = getCustomModelsQuery(providerId)
      await query.refetch()
      const customModelsList = query.data.value ?? []

      const modelIds = customModelsList.map((model) => model.id)
      const modelStatusMap =
        modelIds.length > 0 ? await configP.getBatchModelStatus(providerId, modelIds) : {}

      const customModelsWithStatus = await Promise.all(
        customModelsList.map(async (model) => {
          const base: RENDERER_MODEL_META = {
            ...normalizeRendererModel(model, providerId),
            enabled: modelStatusMap[model.id] ?? true,
            isCustom: true
          }
          return applyUserDefinedModelConfig(base, providerId)
        })
      )

      updateCustomModelState(providerId, customModelsWithStatus)

      const existingStandard =
        allProviderModels.value
          .find((item) => item.providerId === providerId)
          ?.models.filter((model) => !model.isCustom) || []
      updateAllProviderState(providerId, [...existingStandard, ...customModelsWithStatus])
      updateEnabledState(providerId, [...existingStandard, ...customModelsWithStatus])
    } catch (error) {
      console.error(`刷新自定义模型失败: ${providerId}`, error)
    }
  }

  const refreshStandardModels = async (providerId: string): Promise<void> => {
    try {
      console.log(
        `[ModelStore] refreshStandardModels: refreshing models for provider "${providerId}"`
      )
      await invalidateProviderModelsCache(providerId)
      let models: RENDERER_MODEL_META[] = await configP.getDbProviderModels(providerId)
      console.log(
        `[ModelStore] refreshStandardModels: got ${models.length} models from DB for provider "${providerId}"`
      )

      const providerModelsQuery = getProviderModelsQuery(providerId)
      await providerModelsQuery.refetch()
      let storedModels = providerModelsQuery.data.value ?? []
      console.log(
        `[ModelStore] refreshStandardModels: got ${storedModels.length} stored models for provider "${providerId}"`
      )

      if (storedModels.length === 0) {
        // Fallback: try to get models directly from config
        const fallbackProviderModels = (await configP.getProviderModels(providerId)) ?? []
        if (fallbackProviderModels.length > 0) {
          storedModels = fallbackProviderModels
          updateProviderModelsCache(providerId, fallbackProviderModels)
        }
      }

      if (storedModels.length > 0) {
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
            enableSearch:
              (model as RENDERER_MODEL_META).enableSearch ??
              (fallback as RENDERER_MODEL_META | undefined)?.enableSearch ??
              false,
            type: (model.type ?? fallback?.type ?? ModelType.Chat) as ModelType
          }
        }

        for (const storedModel of storedModels) {
          const normalized = normalizeStoredModel(storedModel, dbModelMap.get(storedModel.id))
          storedModelMap.set(storedModel.id, normalized)
        }

        const mergedModels: RENDERER_MODEL_META[] = []

        // If models array is empty, use storedModels directly
        if (models.length === 0) {
          for (const model of storedModelMap.values()) {
            mergedModels.push(model)
          }
        } else {
          // Otherwise, merge db models with stored models
          for (const model of models) {
            const override = storedModelMap.get(model.id)
            if (override) {
              storedModelMap.delete(model.id)
              mergedModels.push({ ...model, ...override, providerId })
            } else {
              mergedModels.push({ ...model, providerId })
            }
          }

          // Add remaining stored models that are not in db
          for (const model of storedModelMap.values()) {
            mergedModels.push(model)
          }
        }

        models = mergedModels
      }

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
              type: (meta.type || ModelType.Chat) as ModelType
            }))
          }
        } catch (error) {
          console.error(`Failed to fetch models for provider ${providerId}:`, error)
          models = []
        }
      }

      const modelIds = models.map((model) => model.id)
      const modelStatusMap =
        modelIds.length > 0 ? await configP.getBatchModelStatus(providerId, modelIds) : {}

      const modelsWithStatus = await Promise.all(
        models.map(async (model) => {
          const base: RENDERER_MODEL_META = {
            ...normalizeRendererModel(model, providerId),
            enabled: modelStatusMap[model.id] ?? true,
            isCustom: model.isCustom || false
          }
          return applyUserDefinedModelConfig(base, providerId)
        })
      )

      const existingCustom =
        customModels.value.find((item) => item.providerId === providerId)?.models || []
      updateAllProviderState(providerId, [...modelsWithStatus, ...existingCustom])
      updateEnabledState(providerId, [...modelsWithStatus, ...existingCustom])
    } catch (error) {
      console.error(`刷新标准模型失败: ${providerId}`, error)
    }
  }

  const markProviderInitialized = (providerId: string) => {
    if (!providerInitialized.value.has(providerId)) {
      providerInitialized.value.add(providerId)
      providerInitialized.value = new Set(providerInitialized.value)

      const callbacks = providerInitCallbacks.value.get(providerId)
      if (callbacks) {
        callbacks.forEach((callback) => callback())
        providerInitCallbacks.value.delete(providerId)
        providerInitCallbacks.value = new Map(providerInitCallbacks.value)
      }
    }
  }

  const awaitProviderInitialized = (providerId: string): Promise<void> => {
    if (providerInitialized.value.has(providerId)) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      const callbacks = providerInitCallbacks.value.get(providerId) || []
      callbacks.push(resolve)
      providerInitCallbacks.value.set(providerId, callbacks)
      providerInitCallbacks.value = new Map(providerInitCallbacks.value)
    })
  }

  const isProviderReady = (providerId: string): boolean => {
    return providerInitialized.value.has(providerId)
  }

  const refreshProviderModels = async (providerId: string) => {
    if (await isAgentProvider(providerId)) {
      try {
        const { rendererModels, modelMetas } = await agentModelStore.refreshAgentModels(providerId)
        updateProviderModelsCache(providerId, modelMetas)
        updateAllProviderState(providerId, rendererModels)
        updateEnabledState(providerId, rendererModels)
        markProviderInitialized(providerId)
      } catch (error) {
        console.error(`[ModelStore] Failed to refresh agent models for ${providerId}:`, error)
      }
      return
    }

    await refreshStandardModels(providerId)
    await refreshCustomModels(providerId)
    markProviderInitialized(providerId)
  }

  const _refreshAllModelsInternal = async () => {
    const activeProviders = providerStore.providers.filter((p) => p.enable)
    for (const provider of activeProviders) {
      await refreshProviderModels(provider.id)
    }
  }

  const refreshAllModels = useThrottleFn(_refreshAllModelsInternal, 1000, true, true)

  const getSelectableProviders = (filters: ModelCatalogFilters = {}) => {
    return buildSelectableProviderCatalog(
      providerStore.sortedProviders,
      enabledModels.value,
      filters
    )
  }

  const searchModels = (query: string) => {
    const normalized = query.toLowerCase()
    return enabledModels.value
      .map((group) => ({
        providerId: group.providerId,
        models: group.models.filter(
          (model) =>
            model.id.toLowerCase().includes(normalized) ||
            model.name.toLowerCase().includes(normalized)
        )
      }))
      .filter((group) => group.models.length > 0)
  }

  const updateLocalModelStatus = (providerId: string, modelId: string, enabled: boolean) => {
    let updatedEnabledModels: { providerId: string; models: RENDERER_MODEL_META[] }[] | null = null
    const provider = allProviderModels.value.find((p) => p.providerId === providerId)
    const providerModel = provider?.models.find((m) => m.id === modelId)
    const customProvider = customModels.value.find((p) => p.providerId === providerId)
    const customModel = customProvider?.models.find((m) => m.id === modelId)

    if (providerModel) {
      providerModel.enabled = enabled
    }
    if (customModel) {
      customModel.enabled = enabled
    }

    let enabledProvider = enabledModels.value.find((p) => p.providerId === providerId)

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

      const sourceModel = providerModel ?? customModel ?? models[modelIndex]
      if (enabled) {
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

  const updateModelStatus = async (providerId: string, modelId: string, enabled: boolean) => {
    const previousState = getLocalModelEnabledState(providerId, modelId)
    updateLocalModelStatus(providerId, modelId, enabled)

    const provider = providerStore.providers.find((p) => p.id === providerId)
    if (provider?.apiType === 'ollama') {
      return
    }

    try {
      await llmP.updateModelStatus(providerId, modelId, enabled)
      await refreshProviderModels(providerId)
    } catch (error) {
      console.error('Failed to update model status:', error)
      if (previousState !== null && previousState !== enabled) {
        updateLocalModelStatus(providerId, modelId, previousState)
      }
    }
  }

  const addCustomModel = async (
    providerId: string,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ) => {
    try {
      const newModel = await llmP.addCustomModel(providerId, model)
      await configP.addCustomModel(providerId, newModel)
      await refreshCustomModels(providerId)
      return newModel
    } catch (error) {
      console.error('Failed to add custom model:', error)
      throw error
    }
  }

  const removeCustomModel = async (providerId: string, modelId: string) => {
    try {
      await configP.removeCustomModel(providerId, modelId)
      const success = await llmP.removeCustomModel(providerId, modelId)
      if (success) {
        await refreshCustomModels(providerId)
      }
      return success
    } catch (error) {
      console.error('Failed to remove custom model:', error)
      throw error
    }
  }

  const updateCustomModel = async (
    providerId: string,
    modelId: string,
    updates: Partial<RENDERER_MODEL_META> & { enabled?: boolean }
  ) => {
    try {
      const success = await llmP.updateCustomModel(providerId, modelId, updates)
      if (success) {
        await refreshCustomModels(providerId)
      }
      return success
    } catch (error) {
      console.error('Failed to update custom model:', error)
      throw error
    }
  }

  const enableAllModels = async (providerId: string): Promise<void> => {
    try {
      const providerModelsData = allProviderModels.value.find((p) => p.providerId === providerId)
      if (!providerModelsData || providerModelsData.models.length === 0) {
        console.warn(`No models found for provider ${providerId}`)
        return
      }

      for (const model of providerModelsData.models) {
        if (!model.enabled) {
          await llmP.updateModelStatus(providerId, model.id, true)
        }
      }
      await refreshProviderModels(providerId)
    } catch (error) {
      console.error(`Failed to enable all models for provider ${providerId}:`, error)
      throw error
    }
  }

  const disableAllModels = async (providerId: string): Promise<void> => {
    try {
      const providerModelsData = allProviderModels.value.find((p) => p.providerId === providerId)
      if (!providerModelsData || providerModelsData.models.length === 0) {
        console.warn(`No models found for provider ${providerId}`)
        return
      }

      const customModelsData = customModels.value.find((p) => p.providerId === providerId)
      const standardModels = providerModelsData.models
      for (const model of standardModels) {
        if (model.enabled) {
          await llmP.updateModelStatus(providerId, model.id, false)
        }
      }

      if (customModelsData) {
        for (const model of customModelsData.models) {
          if (model.enabled) {
            await llmP.updateModelStatus(providerId, model.id, false)
          }
        }
      }
      await refreshProviderModels(providerId)
    } catch (error) {
      console.error(`Failed to disable all models for provider ${providerId}:`, error)
      throw error
    }
  }

  const findModelByIdOrName = (
    modelId: string
  ): { model: RENDERER_MODEL_META; providerId: string } | null => {
    for (const providerModels of enabledModels.value) {
      const model = providerModels.models.find((m) => m.id === modelId)
      if (model) {
        return { model, providerId: providerModels.providerId }
      }
    }

    const enabledModel = enabledModels.value
      .flatMap((provider) =>
        provider.models.map((m) => ({ ...m, providerId: provider.providerId }))
      )
      .find((m) => m.id === modelId)
    if (enabledModel) {
      return { model: enabledModel, providerId: enabledModel.providerId! }
    }

    for (const providerModels of enabledModels.value) {
      for (const model of providerModels.models) {
        if (
          model.id.toLowerCase().includes(modelId.toLowerCase()) ||
          model.name.toLowerCase().includes(modelId.toLowerCase())
        ) {
          return { model, providerId: providerModels.providerId }
        }
      }
    }

    return null
  }

  const setupModelListeners = () => {
    if (listenersRegistered.value) return
    listenersRegistered.value = true

    window.electron?.ipcRenderer?.on(
      CONFIG_EVENTS.MODEL_LIST_CHANGED,
      async (_event, providerId: string) => {
        if (providerId) {
          await refreshProviderModels(providerId)
        } else {
          await refreshAllModels()
        }
      }
    )

    window.electron?.ipcRenderer?.on(
      CONFIG_EVENTS.MODEL_STATUS_CHANGED,
      async (_event, msg: { providerId: string; modelId: string; enabled: boolean }) => {
        updateLocalModelStatus(msg.providerId, msg.modelId, msg.enabled)
      }
    )

    window.electron?.ipcRenderer?.on(PROVIDER_DB_EVENTS.UPDATED, async () => {
      await refreshAllModels()
    })
    window.electron?.ipcRenderer?.on(PROVIDER_DB_EVENTS.LOADED, async () => {
      await refreshAllModels()
    })
  }

  const cleanup = () => {
    window.electron?.ipcRenderer?.removeAllListeners(CONFIG_EVENTS.MODEL_LIST_CHANGED)
    window.electron?.ipcRenderer?.removeAllListeners(CONFIG_EVENTS.MODEL_STATUS_CHANGED)
    window.electron?.ipcRenderer?.removeAllListeners(PROVIDER_DB_EVENTS.UPDATED)
    window.electron?.ipcRenderer?.removeAllListeners(PROVIDER_DB_EVENTS.LOADED)
    listenersRegistered.value = false
  }

  const initialize = async () => {
    setupModelListeners()
    await refreshAllModels()
  }

  const addCustomModelMutation = useIpcMutation({
    presenter: 'configPresenter',
    method: 'addCustomModel',
    invalidateQueries: (_, [providerId]) => [
      CUSTOM_MODELS_KEY(providerId),
      ENABLED_MODELS_KEY(providerId)
    ]
  })

  const removeCustomModelMutation = useIpcMutation({
    presenter: 'configPresenter',
    method: 'removeCustomModel',
    invalidateQueries: (_, [providerId]) => [
      CUSTOM_MODELS_KEY(providerId),
      ENABLED_MODELS_KEY(providerId)
    ]
  })

  const updateCustomModelMutation = useIpcMutation({
    presenter: 'configPresenter',
    method: 'updateCustomModel',
    invalidateQueries: (_, [providerId]) => [CUSTOM_MODELS_KEY(providerId)]
  })

  return {
    enabledModels,
    allProviderModels,
    customModels,
    providerInitialized,
    getProviderModelsQuery,
    getCustomModelsQuery,
    getEnabledModelsQuery,
    refreshCustomModels,
    refreshStandardModels,
    refreshProviderModels,
    refreshAllModels,
    getSelectableProviders,
    updateModelStatus,
    updateLocalModelStatus,
    getLocalModelEnabledState,
    addCustomModel,
    removeCustomModel,
    updateCustomModel,
    enableAllModels,
    disableAllModels,
    searchModels,
    findModelByIdOrName,
    applyUserDefinedModelConfig,
    addCustomModelMutation,
    removeCustomModelMutation,
    updateCustomModelMutation,
    setupModelListeners,
    cleanup,
    initialize,
    markProviderInitialized,
    awaitProviderInitialized,
    isProviderReady
  }
})
