import { computed, readonly, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useThrottleFn } from '@vueuse/core'
import type { ModelConfig, RENDERER_MODEL_META } from '@shared/types/provider'
import { isChatSelectableModelType, ModelType } from '@shared/model'
import { resolveModelFunctionCall, resolveModelVision } from '@shared/modelConfigDefaults'
import type { ProviderCatalogSnapshot } from '@shared/types/providerCatalog'
import { useAgentModelStore } from '@/stores/agentModelStore'
import { useProviderStore } from '@/stores/providerStore'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { createModelClient } from '../../api/ModelClient'
import { createProviderCatalogClient } from '../../api/ProviderCatalogClient'

type ChatSelectableModelGroup = {
  providerId: string
  providerName: string
  models: RENDERER_MODEL_META[]
}

type ProviderModelGroup = { providerId: string; models: RENDERER_MODEL_META[] }

export const useModelStore = defineStore('model', () => {
  const modelClient = createModelClient()
  const catalogClient = createProviderCatalogClient()
  const providerStore = useProviderStore()
  const agentModelStore = useAgentModelStore()
  const uiSettingsStore = useUiSettingsStore()

  const enabledModels = ref<ProviderModelGroup[]>([])
  const allProviderModels = ref<ProviderModelGroup[]>([])
  const customModels = ref<ProviderModelGroup[]>([])
  const listenersRegistered = ref(false)
  const initialized = ref(false)
  const isInitializing = ref(false)
  const initializationError = ref<Error | null>(null)
  const initializationPromise = ref<Promise<void> | null>(null)
  const chatSelectableModelGroupsRevision = ref(0)

  let removeModelListeners: (() => void) | null = null
  const inFlightRefreshes = new Map<string, Promise<boolean>>()
  const pendingModelStatusEchoes = new Map<string, boolean>()
  const providerModelsReadyAt = new Map<string, number>()
  const activeProviderIds = computed(
    () =>
      new Set(
        providerStore.providers.filter((provider) => provider.enable).map((provider) => provider.id)
      )
  )
  const activeEnabledModels = computed(() =>
    enabledModels.value.filter((group) => activeProviderIds.value.has(group.providerId))
  )

  const MODEL_TOGGLE_PERF_LOG_PREFIX = '[ModelTogglePerf]'
  const getPerfNow = () =>
    import.meta.env.DEV ? (typeof performance !== 'undefined' ? performance.now() : Date.now()) : 0
  const logModelTogglePerf = (phase: string, details: Record<string, unknown>) => {
    if (!import.meta.env.DEV || !uiSettingsStore.traceDebugEnabled) {
      return
    }

    console.info(`${MODEL_TOGGLE_PERF_LOG_PREFIX} ${phase}`, details)
  }

  const getModelStatusKey = (providerId: string, modelId: string) => `${providerId}:${modelId}`

  const getProviderState = (providerId: string) => {
    return providerStore.providers.find((provider) => provider.id === providerId) ?? null
  }

  const markProviderModelsReady = (providerId: string) => {
    providerModelsReadyAt.set(providerId, Date.now())
  }

  const clearProviderModelsReady = (providerId?: string) => {
    if (providerId) {
      providerModelsReadyAt.delete(providerId)
      return
    }

    providerModelsReadyAt.clear()
  }

  const isProviderModelsReady = (providerId: string) => {
    return providerModelsReadyAt.has(providerId)
  }

  const trackPendingModelStatusEcho = (providerId: string, modelId: string, enabled: boolean) => {
    const statusKey = getModelStatusKey(providerId, modelId)
    pendingModelStatusEchoes.set(statusKey, enabled)
    setTimeout(() => {
      if (pendingModelStatusEchoes.get(statusKey) === enabled) {
        pendingModelStatusEchoes.delete(statusKey)
      }
    }, 1500)
  }

  const ensureModelRuntime = () => {
    setupModelListeners()
  }

  const getMaterializedProviderIds = () => {
    return Array.from(
      new Set([
        ...allProviderModels.value.map((entry) => entry.providerId),
        ...customModels.value.map((entry) => entry.providerId),
        ...enabledModels.value.map((entry) => entry.providerId)
      ])
    ).filter((providerId): providerId is string => Boolean(providerId))
  }

  const removeProviderGroups = (groups: ProviderModelGroup[], providerId: string) => {
    return groups.filter((group) => group.providerId !== providerId)
  }

  const purgeRemovedProviderState = (providerId: string) => {
    allProviderModels.value = removeProviderGroups(allProviderModels.value, providerId)
    customModels.value = removeProviderGroups(customModels.value, providerId)
    enabledModels.value = removeProviderGroups(enabledModels.value, providerId)
    clearProviderModelsReady(providerId)

    for (const statusKey of Array.from(pendingModelStatusEchoes.keys())) {
      if (statusKey.startsWith(`${providerId}:`)) {
        pendingModelStatusEchoes.delete(statusKey)
      }
    }
  }

  watch(
    () => providerStore.providers.map((provider) => provider.id),
    (providerIds) => {
      const providerIdSet = new Set(providerIds)
      for (const materializedProviderId of getMaterializedProviderIds()) {
        if (!providerIdSet.has(materializedProviderId)) {
          purgeRemovedProviderState(materializedProviderId)
        }
      }
    }
  )

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
    const providerState = getProviderState(providerId)
    const enabledModelsList = providerState?.enable ? models.filter((model) => model.enabled) : []
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

  const pruneModelState = (providerIds: Set<string>, enabledProviderIds: Set<string>) => {
    enabledModels.value = enabledModels.value.filter((group) =>
      enabledProviderIds.has(group.providerId)
    )
    allProviderModels.value = allProviderModels.value.filter((group) =>
      providerIds.has(group.providerId)
    )
    customModels.value = customModels.value.filter((group) => providerIds.has(group.providerId))
  }

  const applyCatalogSnapshot = (snapshot: ProviderCatalogSnapshot) => {
    const providerModels = snapshot.models.filter((model) => !model.isCustom)
    const customModelList = snapshot.models.filter((model) => model.isCustom)
    updateAllProviderState(snapshot.providerId, providerModels)
    updateCustomModelState(snapshot.providerId, customModelList)
    updateEnabledState(snapshot.providerId, snapshot.models)
    markProviderModelsReady(snapshot.providerId)
  }

  const updateEnabledStateFromLocalProvider = (providerId: string) => {
    const materializedProviderModels =
      allProviderModels.value.find((item) => item.providerId === providerId)?.models ?? []
    const materializedCustomModels =
      customModels.value.find((item) => item.providerId === providerId)?.models ?? []

    if (materializedCustomModels.length === 0) {
      updateEnabledState(providerId, materializedProviderModels)
      return
    }

    const mergedModels = new Map<string, RENDERER_MODEL_META>()

    for (const model of materializedProviderModels) {
      mergedModels.set(model.id, model)
    }

    for (const model of materializedCustomModels) {
      mergedModels.set(model.id, model)
    }

    updateEnabledState(providerId, Array.from(mergedModels.values()))
  }

  const updateLocalBatchModelStatus = (
    providerId: string,
    updates: { modelId: string; enabled: boolean }[]
  ) => {
    const previousStates = new Map<string, boolean | null>()

    if (updates.length === 0) {
      return previousStates
    }

    const providerEntry = allProviderModels.value.find((item) => item.providerId === providerId)
    const customEntry = customModels.value.find((item) => item.providerId === providerId)
    const enabledEntry = enabledModels.value.find((item) => item.providerId === providerId)
    const providerModelById = providerEntry
      ? new Map(providerEntry.models.map((model) => [model.id, model]))
      : null
    const customModelById = customEntry
      ? new Map(customEntry.models.map((model) => [model.id, model]))
      : null
    const enabledModelIds = enabledEntry
      ? new Set(enabledEntry.models.map((model) => model.id))
      : null

    const nextEnabledByModelId = new Map<string, boolean>()
    for (const update of updates) {
      const providerModel = providerModelById?.get(update.modelId)
      const customModel = customModelById?.get(update.modelId)
      previousStates.set(
        update.modelId,
        providerModel
          ? !!providerModel.enabled
          : customModel
            ? !!customModel.enabled
            : (enabledModelIds?.has(update.modelId) ?? null)
      )
      nextEnabledByModelId.set(update.modelId, update.enabled)
    }

    if (providerEntry) {
      for (const model of providerEntry.models) {
        const nextEnabled = nextEnabledByModelId.get(model.id)
        if (nextEnabled !== undefined) {
          model.enabled = nextEnabled
        }
      }
    }

    if (customEntry) {
      for (const model of customEntry.models) {
        const nextEnabled = nextEnabledByModelId.get(model.id)
        if (nextEnabled !== undefined) {
          model.enabled = nextEnabled
        }
      }
    }

    updateEnabledStateFromLocalProvider(providerId)

    return previousStates
  }

  const rollbackLocalBatchModelStatus = (
    providerId: string,
    previousStates: Map<string, boolean | null>
  ) => {
    const rollbackUpdates: { modelId: string; enabled: boolean }[] = []
    for (const [modelId, enabled] of previousStates) {
      if (enabled !== null) {
        rollbackUpdates.push({ modelId, enabled })
      }
    }

    if (rollbackUpdates.length > 0) {
      updateLocalBatchModelStatus(providerId, rollbackUpdates)
    }
  }

  const trackPendingBatchModelStatusEchoes = (
    providerId: string,
    updates: { modelId: string; enabled: boolean }[]
  ) => {
    const trackedEchoes: { statusKey: string; enabled: boolean }[] = []
    for (const update of updates) {
      const statusKey = getModelStatusKey(providerId, update.modelId)
      pendingModelStatusEchoes.set(statusKey, update.enabled)
      trackedEchoes.push({ statusKey, enabled: update.enabled })
    }

    setTimeout(() => {
      for (const echo of trackedEchoes) {
        if (pendingModelStatusEchoes.get(echo.statusKey) === echo.enabled) {
          pendingModelStatusEchoes.delete(echo.statusKey)
        }
      }
    }, 1500)
  }

  const clearPendingBatchModelStatusEchoes = (
    providerId: string,
    updates: { modelId: string; enabled: boolean }[]
  ) => {
    for (const update of updates) {
      const statusKey = getModelStatusKey(providerId, update.modelId)
      if (pendingModelStatusEchoes.get(statusKey) === update.enabled) {
        pendingModelStatusEchoes.delete(statusKey)
      }
    }
  }

  const refreshProviderModelsNow = async (
    providerId: string,
    discoverModels: boolean
  ): Promise<boolean> => {
    if (providerId === 'acp') {
      try {
        const { rendererModels } = await agentModelStore.refreshAgentModels(providerId)
        updateAllProviderState(providerId, rendererModels)
        updateEnabledState(providerId, rendererModels)
        markProviderModelsReady(providerId)
        return true
      } catch (error) {
        console.error(`[ModelStore] Failed to refresh agent models for ${providerId}:`, error)
        clearProviderModelsReady(providerId)
        return false
      }
    }

    try {
      if (discoverModels) {
        // Stale catalogs revalidate in the background; the changed event reloads the snapshot.
        await catalogClient.ensureFresh(providerId)
      }
      applyCatalogSnapshot(await catalogClient.getCatalog(providerId))
      return true
    } catch (error) {
      console.error(`刷新模型列表失败: ${providerId}`, error)
      clearProviderModelsReady(providerId)
      return false
    }
  }

  const refreshProviderModels = (
    providerId: string,
    discoverModels = getProviderState(providerId)?.enable === true
  ): Promise<boolean> => {
    ensureModelRuntime()

    const existingRefresh = inFlightRefreshes.get(providerId)
    if (existingRefresh) {
      return existingRefresh
    }

    const refreshPromise = refreshProviderModelsNow(providerId, discoverModels).finally(() => {
      if (inFlightRefreshes.get(providerId) === refreshPromise) {
        inFlightRefreshes.delete(providerId)
      }
    })

    inFlightRefreshes.set(providerId, refreshPromise)
    return refreshPromise
  }

  const refreshCustomModels = (providerId: string): Promise<boolean> =>
    refreshProviderModels(providerId, false)

  const _refreshAllModelsInternal = async (): Promise<boolean> => {
    await providerStore.ensureInitialized()

    const activeProviders = providerStore.providers.filter((p) => p.enable)
    if (activeProviders.length === 0) {
      return true
    }

    try {
      const catalogs = await catalogClient.listCatalogs(
        activeProviders.map((provider) => provider.id)
      )
      for (const snapshot of catalogs) {
        applyCatalogSnapshot(snapshot)
      }
    } catch (error) {
      console.error('[ModelStore] Failed to load provider catalogs:', error)
      return false
    }

    for (const provider of activeProviders) {
      if (provider.id === 'acp') {
        await refreshProviderModels(provider.id, false)
        continue
      }
      void catalogClient.ensureFresh(provider.id).catch((error) => {
        console.error(`[ModelStore] Failed to schedule catalog revalidation: ${provider.id}`, error)
      })
    }

    return true
  }

  const refreshAllModels = useThrottleFn(_refreshAllModelsInternal, 1000, true, true)

  watch(
    () => ({
      providers: providerStore.sortedProviders.map((provider) => ({
        id: provider.id,
        name: provider.name,
        enable: provider.enable
      })),
      fallbackProviders: providerStore.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        enable: provider.enable
      })),
      enabledModelGroups: enabledModels.value.map((group) => ({
        providerId: group.providerId,
        models: group.models.map((model) => ({
          ...model,
          supportedEndpointTypes: [...(model.supportedEndpointTypes ?? [])],
          selectableEndpointTypes: [...(model.selectableEndpointTypes ?? [])]
        }))
      }))
    }),
    () => {
      chatSelectableModelGroupsRevision.value += 1
    },
    { immediate: true }
  )

  const chatSelectableModelGroups = computed<ChatSelectableModelGroup[]>(() => {
    const orderedProviders =
      providerStore.sortedProviders?.length > 0
        ? providerStore.sortedProviders
        : providerStore.providers
    const modelsByProviderId = new Map(
      enabledModels.value
        .filter((group) => group.providerId !== 'acp')
        .map(
          (group) =>
            [
              group.providerId,
              group.models.filter((model) => isChatSelectableModelType(model.type))
            ] as const
        )
        .filter(([, models]) => models.length > 0)
    )

    const result: ChatSelectableModelGroup[] = []

    for (const provider of orderedProviders) {
      if (!provider.enable || provider.id === 'acp') {
        continue
      }

      const models = modelsByProviderId.get(provider.id)
      if (!models || models.length === 0) {
        continue
      }

      result.push({
        providerId: provider.id,
        providerName: provider.name,
        models
      })
    }

    return result
  })

  const findChatSelectableModel = (providerId: string, modelId: string) => {
    const group = chatSelectableModelGroups.value.find((entry) => entry.providerId === providerId)
    const model = group?.models.find((entry) => entry.id === modelId)
    if (!group || !model) {
      return null
    }

    return {
      providerId: group.providerId,
      providerName: group.providerName,
      model
    }
  }

  const pickFirstChatSelectableModel = () => {
    const firstGroup = chatSelectableModelGroups.value[0]
    const firstModel = firstGroup?.models[0]
    if (!firstGroup || !firstModel) {
      return null
    }

    return {
      providerId: firstGroup.providerId,
      providerName: firstGroup.providerName,
      model: firstModel
    }
  }

  const searchModels = (query: string) => {
    const normalized = query.toLowerCase()
    return activeEnabledModels.value
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
    let updatedEnabledModels: ProviderModelGroup[] | null = null
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

    if (!getProviderState(providerId)?.enable) {
      enabledModels.value = enabledModels.value.filter((entry) => entry.providerId !== providerId)
      return
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
            vision: resolveModelVision(sourceModel.vision),
            functionCall: resolveModelFunctionCall(sourceModel.functionCall),
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
    const actionStart = getPerfNow()
    const previousState = getLocalModelEnabledState(providerId, modelId)
    const localUpdateStart = getPerfNow()
    updateLocalModelStatus(providerId, modelId, enabled)
    trackPendingModelStatusEcho(providerId, modelId, enabled)
    logModelTogglePerf('store.local-update', {
      providerId,
      modelId,
      enabled,
      previousState,
      elapsedMs: Math.round(getPerfNow() - localUpdateStart)
    })

    try {
      const ipcStart = getPerfNow()
      await modelClient.updateModelStatus(providerId, modelId, enabled)
      logModelTogglePerf('store.ipc-complete', {
        providerId,
        modelId,
        enabled,
        elapsedMs: Math.round(getPerfNow() - ipcStart),
        totalMs: Math.round(getPerfNow() - actionStart)
      })
      return true
    } catch (error) {
      console.error('Failed to update model status:', error)
      const statusKey = getModelStatusKey(providerId, modelId)
      if (pendingModelStatusEchoes.get(statusKey) === enabled) {
        pendingModelStatusEchoes.delete(statusKey)
      }
      if (previousState !== null && previousState !== enabled) {
        updateLocalModelStatus(providerId, modelId, previousState)
      }
      logModelTogglePerf('store.rollback', {
        providerId,
        modelId,
        enabled,
        previousState,
        totalMs: Math.round(getPerfNow() - actionStart)
      })
      return false
    }
  }

  const stripDerivedRendererModelFields = <T extends Partial<RENDERER_MODEL_META>>(model: T) => {
    const { explicitFunctionCall: _explicitFunctionCall, ...persistedModel } = model
    return persistedModel as Omit<T, 'explicitFunctionCall'>
  }

  const addCustomModel = async (
    providerId: string,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ) => {
    try {
      const newModel = await modelClient.addCustomModel(
        providerId,
        stripDerivedRendererModelFields(model)
      )
      await refreshCustomModels(providerId)
      return newModel
    } catch (error) {
      console.error('Failed to add custom model:', error)
      throw error
    }
  }

  const saveCustomModel = async (
    providerId: string,
    originalModelId: string | undefined,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>,
    config: ModelConfig
  ) => {
    const savedModel = await modelClient.saveCustomModel(
      providerId,
      originalModelId,
      stripDerivedRendererModelFields(model),
      config
    )
    await refreshCustomModels(providerId)
    return savedModel
  }

  const removeCustomModel = async (providerId: string, modelId: string) => {
    try {
      const success = await modelClient.removeCustomModel(providerId, modelId)
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
      const success = await modelClient.updateCustomModel(
        providerId,
        modelId,
        stripDerivedRendererModelFields(updates)
      )
      if (success) {
        await refreshCustomModels(providerId)
      }
      return success
    } catch (error) {
      console.error('Failed to update custom model:', error)
      throw error
    }
  }

  const enableAllModels = async (
    providerId: string,
    models: RENDERER_MODEL_META[] = []
  ): Promise<void> => {
    const actionStart = getPerfNow()
    let previousStates: Map<string, boolean | null> | null = null
    let updates: { modelId: string; enabled: boolean }[] = []
    try {
      const providerModelsData =
        models.length > 0
          ? { providerId, models }
          : allProviderModels.value.find((p) => p.providerId === providerId)

      if (!providerModelsData || providerModelsData.models.length === 0) {
        console.warn(`No models found for provider ${providerId}`)
        return
      }

      const targetModels = providerModelsData.models.filter((model) => !model.enabled)
      if (targetModels.length === 0) {
        return
      }

      updates = targetModels.map((model) => ({ modelId: model.id, enabled: true }))
      previousStates = updateLocalBatchModelStatus(providerId, updates)
      trackPendingBatchModelStatusEchoes(providerId, updates)
      await modelClient.setBatchModelStatus(providerId, updates)
      logModelTogglePerf('store.batch-enable-complete', {
        providerId,
        modelCount: updates.length,
        totalMs: Math.round(getPerfNow() - actionStart)
      })
    } catch (error) {
      console.error(`Failed to enable all models for provider ${providerId}:`, error)
      clearPendingBatchModelStatusEchoes(providerId, updates)
      if (previousStates) {
        rollbackLocalBatchModelStatus(providerId, previousStates)
      }
      throw error
    }
  }

  const disableAllModels = async (
    providerId: string,
    models: RENDERER_MODEL_META[] = []
  ): Promise<void> => {
    const actionStart = getPerfNow()
    let previousStates: Map<string, boolean | null> | null = null
    let updates: { modelId: string; enabled: boolean }[] = []
    try {
      const providerModelsData =
        models.length > 0
          ? { providerId, models }
          : allProviderModels.value.find((p) => p.providerId === providerId)

      if (!providerModelsData || providerModelsData.models.length === 0) {
        console.warn(`No models found for provider ${providerId}`)
        return
      }

      const targetModels = providerModelsData.models.filter((model) => model.enabled)
      if (targetModels.length === 0) {
        return
      }

      updates = targetModels.map((model) => ({ modelId: model.id, enabled: false }))
      previousStates = updateLocalBatchModelStatus(providerId, updates)
      trackPendingBatchModelStatusEchoes(providerId, updates)
      await modelClient.setBatchModelStatus(providerId, updates)
      logModelTogglePerf('store.batch-disable-complete', {
        providerId,
        modelCount: updates.length,
        totalMs: Math.round(getPerfNow() - actionStart)
      })
    } catch (error) {
      console.error(`Failed to disable all models for provider ${providerId}:`, error)
      clearPendingBatchModelStatusEchoes(providerId, updates)
      if (previousStates) {
        rollbackLocalBatchModelStatus(providerId, previousStates)
      }
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

  watch(
    () =>
      providerStore.providers.map((provider) => ({
        id: provider.id,
        enable: provider.enable
      })),
    (nextProviders, previousProviders) => {
      const providerIds = new Set(nextProviders.map((provider) => provider.id))
      const enabledProviderIds = new Set(
        nextProviders.filter((provider) => provider.enable).map((provider) => provider.id)
      )
      const previousEnabledProviderIds = new Set(
        (previousProviders ?? [])
          .filter((provider) => provider.enable)
          .map((provider) => provider.id)
      )

      pruneModelState(providerIds, enabledProviderIds)

      for (const provider of previousProviders ?? []) {
        if (provider.enable && !enabledProviderIds.has(provider.id)) {
          clearProviderModelsReady(provider.id)
        }
      }

      for (const providerId of providerIds) {
        if (enabledProviderIds.has(providerId) && !previousEnabledProviderIds.has(providerId)) {
          updateEnabledStateFromLocalProvider(providerId)
          if (initialized.value) {
            void refreshProviderModels(providerId)
          }
        }
      }
    },
    { immediate: true }
  )

  const setupModelListeners = () => {
    if (listenersRegistered.value) return
    listenersRegistered.value = true

    const unsubscribeCatalogChanged = catalogClient.onCatalogChanged(({ providerId }) => {
      void refreshProviderModels(providerId, false)
    })

    const unsubscribeModelListChanged = modelClient.onModelsChanged(
      async ({ providerId, reason }) => {
        if (providerId) {
          await refreshProviderModels(providerId)
          return
        }

        if (reason === 'provider-db-loaded' || reason === 'provider-db-updated') {
          return
        }

        if (initialized.value) {
          await refreshAllModels()
        }
      }
    )

    const unsubscribeModelStatusChanged = modelClient.onModelStatusChanged(
      async (msg: { providerId: string; modelId: string; enabled: boolean }) => {
        const statusKey = getModelStatusKey(msg.providerId, msg.modelId)
        const pendingEnabled = pendingModelStatusEchoes.get(statusKey)
        if (pendingEnabled !== undefined) {
          pendingModelStatusEchoes.delete(statusKey)
          if (pendingEnabled === msg.enabled) {
            return
          }
        }

        updateLocalModelStatus(msg.providerId, msg.modelId, msg.enabled)
      }
    )

    const unsubscribeModelBatchStatusChanged = modelClient.onModelBatchStatusChanged(
      async (msg: { providerId: string; updates: { modelId: string; enabled: boolean }[] }) => {
        for (const update of msg.updates) {
          const statusKey = getModelStatusKey(msg.providerId, update.modelId)
          const pendingEnabled = pendingModelStatusEchoes.get(statusKey)
          if (pendingEnabled !== undefined) {
            pendingModelStatusEchoes.delete(statusKey)
            if (pendingEnabled === update.enabled) {
              continue
            }
          }
          updateLocalModelStatus(msg.providerId, update.modelId, update.enabled)
        }
      }
    )

    removeModelListeners = () => {
      unsubscribeCatalogChanged()
      unsubscribeModelListChanged()
      unsubscribeModelStatusChanged()
      unsubscribeModelBatchStatusChanged()
    }
  }

  const cleanup = () => {
    removeModelListeners?.()
    removeModelListeners = null
    listenersRegistered.value = false
    initialized.value = false
    isInitializing.value = false
    initializationError.value = null
    initializationPromise.value = null
    inFlightRefreshes.clear()
    pendingModelStatusEchoes.clear()
    clearProviderModelsReady()
  }

  const initialize = async () => {
    if (initialized.value) {
      return
    }

    if (initializationPromise.value) {
      await initializationPromise.value
      return
    }

    initializationError.value = null
    isInitializing.value = true
    initializationPromise.value = (async () => {
      ensureModelRuntime()
      const refreshed = await _refreshAllModelsInternal()
      if (!refreshed) {
        console.warn('[ModelStore] Some enabled providers failed to refresh during initialization')
      }
      initialized.value = true
    })()

    try {
      await initializationPromise.value
    } catch (error) {
      initialized.value = false
      initializationError.value =
        error instanceof Error ? error : new Error('Failed to initialize enabled models')
      throw error
    } finally {
      isInitializing.value = false
      if (!initialized.value) {
        initializationPromise.value = null
      }
    }
  }

  const ensureProviderModelsReady = async (providerId: string) => {
    ensureModelRuntime()
    if (isProviderModelsReady(providerId)) {
      return
    }

    await refreshProviderModels(providerId)
  }

  // First-setup model recommendations: deterministic metadata only (the app
  // normalizes a missing type to Chat), capped at three, and never applied when
  // the user already has any enabled model for the provider.
  const applyInitialModelRecommendations = async (providerId: string): Promise<number> => {
    await ensureProviderModelsReady(providerId)
    const models =
      allProviderModels.value.find((entry) => entry.providerId === providerId)?.models ?? []
    if (models.length === 0 || models.some((model) => model.enabled)) {
      return 0
    }
    const recommended = models
      .filter((model) => (model.type ?? ModelType.Chat) === ModelType.Chat)
      .slice(0, 3)
    let appliedCount = 0
    for (const model of recommended) {
      await updateModelStatus(providerId, model.id, true)
      // updateModelStatus swallows IPC failures and rolls back the local state,
      // so only count models whose activation actually landed.
      if (getLocalModelEnabledState(providerId, model.id) === true) {
        appliedCount += 1
      }
    }
    return appliedCount
  }

  const getProviderModelsQuery = (providerId: string) => ({
    data: computed(
      () => allProviderModels.value.find((entry) => entry.providerId === providerId)?.models ?? []
    )
  })

  return {
    enabledModels,
    activeEnabledModels,
    allProviderModels,
    customModels,
    initialized: readonly(initialized),
    isInitializing: readonly(isInitializing),
    initializationError: readonly(initializationError),
    getProviderModelsQuery,
    refreshCustomModels,
    refreshProviderModels,
    ensureProviderModelsReady,
    applyInitialModelRecommendations,
    refreshAllModels,
    updateModelStatus,
    updateLocalModelStatus,
    getLocalModelEnabledState,
    addCustomModel,
    saveCustomModel,
    removeCustomModel,
    updateCustomModel,
    enableAllModels,
    disableAllModels,
    searchModels,
    findModelByIdOrName,
    chatSelectableModelGroups,
    chatSelectableModelGroupsRevision: readonly(chatSelectableModelGroupsRevision),
    findChatSelectableModel,
    pickFirstChatSelectableModel,
    setupModelListeners,
    cleanup,
    initialize
  }
})
