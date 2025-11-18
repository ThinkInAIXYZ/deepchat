import { onBeforeUnmount, onMounted, ref } from 'vue'
import { defineStore, storeToRefs } from 'pinia'
import { OLLAMA_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'
import type { OllamaModel, RENDERER_MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import { useModelStore } from '@/stores/modelStore'
import { useProviderStore } from '@/stores/providerStore'

export const useOllamaStore = defineStore('ollama', () => {
  const llmP = usePresenter('llmproviderPresenter')
  const configP = usePresenter('configPresenter')
  const modelStore = useModelStore()
  const providerStore = useProviderStore()
  const { allProviderModels, enabledModels } = storeToRefs(modelStore)

  const runningModels = ref<Record<string, OllamaModel[]>>({})
  const localModels = ref<Record<string, OllamaModel[]>>({})
  const pullingProgress = ref<Record<string, Record<string, number>>>({})

  const setRunningModels = (providerId: string, models: OllamaModel[]) => {
    runningModels.value = {
      ...runningModels.value,
      [providerId]: models
    }
  }

  const setLocalModels = (providerId: string, models: OllamaModel[]) => {
    localModels.value = {
      ...localModels.value,
      [providerId]: models
    }
  }

  const updatePullingProgress = (providerId: string, modelName: string, progress?: number) => {
    const current = pullingProgress.value[providerId] ?? {}
    const next = { ...current }
    if (progress === undefined) {
      delete next[modelName]
    } else {
      next[modelName] = progress
    }

    const snapshot = { ...pullingProgress.value }
    if (Object.keys(next).length > 0) {
      snapshot[providerId] = next
    } else {
      delete snapshot[providerId]
    }
    pullingProgress.value = snapshot
  }

  const getOllamaRunningModels = (providerId: string): OllamaModel[] =>
    runningModels.value[providerId] || []

  const getOllamaLocalModels = (providerId: string): OllamaModel[] =>
    localModels.value[providerId] || []

  const getOllamaPullingModels = (providerId: string): Record<string, number> =>
    pullingProgress.value[providerId] || {}

  type OllamaRendererModel = RENDERER_MODEL_META & {
    ollamaModel?: OllamaModel
    temperature?: number
    reasoningEffort?: string
    verbosity?: string
    thinkingBudget?: number
    forcedSearch?: boolean
    searchStrategy?: string
  }

  const syncOllamaModelsToGlobal = async (providerId: string): Promise<void> => {
    const ollamaProvider = providerStore.providers.find((p) => p.id === providerId)
    if (!ollamaProvider) return

    const existingOllamaModels =
      allProviderModels.value.find((item) => item.providerId === providerId)?.models || []

    const existingModelMap = new Map<string, OllamaRendererModel>(
      existingOllamaModels.map((model) => [model.id, model as OllamaRendererModel])
    )

    const local = getOllamaLocalModels(providerId)

    const ollamaModelsAsGlobal = await Promise.all(
      local.map(async (model) => {
        const existingModel = existingModelMap.get(model.name)
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

        const modelConfig = await configP.getModelConfig(model.name, providerId)

        const contextLength =
          modelConfig?.contextLength ??
          existingModel?.contextLength ??
          (model as any)?.model_info?.context_length ??
          4096

        const maxTokens = modelConfig?.maxTokens ?? existingModel?.maxTokens ?? 2048

        const resolvedType =
          modelConfig?.type ??
          existingModel?.type ??
          (capabilitySet.has('embedding') ? ModelType.Embedding : ModelType.Chat)

        const normalized: OllamaRendererModel = {
          ...existingModel,
          id: model.name,
          name: model.name,
          contextLength,
          maxTokens,
          group: existingModel?.group || 'local',
          enabled: true,
          isCustom: existingModel?.isCustom || false,
          providerId,
          vision: modelConfig?.vision ?? existingModel?.vision ?? capabilitySet.has('vision'),
          functionCall:
            modelConfig?.functionCall ?? existingModel?.functionCall ?? capabilitySet.has('tools'),
          reasoning:
            modelConfig?.reasoning ?? existingModel?.reasoning ?? capabilitySet.has('thinking'),
          enableSearch: modelConfig?.enableSearch ?? existingModel?.enableSearch ?? false,
          temperature: modelConfig?.temperature ?? existingModel?.temperature,
          reasoningEffort: modelConfig?.reasoningEffort ?? existingModel?.reasoningEffort,
          verbosity: modelConfig?.verbosity ?? existingModel?.verbosity,
          thinkingBudget: modelConfig?.thinkingBudget ?? existingModel?.thinkingBudget,
          forcedSearch: modelConfig?.forcedSearch ?? existingModel?.forcedSearch,
          searchStrategy: modelConfig?.searchStrategy ?? existingModel?.searchStrategy,
          type: resolvedType,
          ollamaModel: model
        }

        return normalized
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
  }

  const refreshOllamaModels = async (providerId: string): Promise<void> => {
    try {
      const [running, local] = await Promise.all([
        llmP.listOllamaRunningModels(providerId),
        llmP.listOllamaModels(providerId)
      ])
      setRunningModels(providerId, running)
      setLocalModels(providerId, local)
      await syncOllamaModelsToGlobal(providerId)
    } catch (error) {
      console.error('Failed to refresh Ollama models for', providerId, error)
    }
  }

  const pullOllamaModel = async (providerId: string, modelName: string) => {
    try {
      updatePullingProgress(providerId, modelName, 0)
      const success = await llmP.pullOllamaModels(providerId, modelName)
      if (!success) {
        updatePullingProgress(providerId, modelName)
      }
      return success
    } catch (error) {
      console.error('Failed to pull Ollama model', modelName, providerId, error)
      updatePullingProgress(providerId, modelName)
      return false
    }
  }

  const handleOllamaModelPullEvent = (data: Record<string, unknown>) => {
    if (data?.eventId !== 'pullOllamaModels') return
    const providerId = data.providerId as string
    const modelName = data.modelName as string
    const completed = data.completed as number | undefined
    const total = data.total as number | undefined
    const status = data.status as string | undefined

    if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
      const progress = Math.min(Math.round((completed / total) * 100), 100)
      updatePullingProgress(providerId, modelName, progress)
    } else if (status && status.includes('manifest')) {
      updatePullingProgress(providerId, modelName, 1)
    }

    if (status === 'success' || status === 'completed') {
      setTimeout(() => {
        updatePullingProgress(providerId, modelName)
        modelStore.getProviderModelsQuery(providerId).refetch()
      }, 600)
    }
  }

  const setupOllamaEventListeners = () => {
    window.electron?.ipcRenderer?.on(
      OLLAMA_EVENTS.PULL_MODEL_PROGRESS,
      (_event: unknown, data: Record<string, unknown>) => handleOllamaModelPullEvent(data)
    )
  }

  const removeOllamaEventListeners = () => {
    window.electron?.ipcRenderer?.removeAllListeners(OLLAMA_EVENTS.PULL_MODEL_PROGRESS)
  }

  const clearOllamaProviderData = (providerId: string) => {
    if (runningModels.value[providerId]) {
      const nextRunning = { ...runningModels.value }
      delete nextRunning[providerId]
      runningModels.value = nextRunning
    }
    if (localModels.value[providerId]) {
      const nextLocal = { ...localModels.value }
      delete nextLocal[providerId]
      localModels.value = nextLocal
    }
    if (pullingProgress.value[providerId]) {
      const nextPulling = { ...pullingProgress.value }
      delete nextPulling[providerId]
      pullingProgress.value = nextPulling
    }
  }

  const isOllamaModelRunning = (providerId: string, modelName: string): boolean => {
    return getOllamaRunningModels(providerId).some((m) => m.name === modelName)
  }

  const isOllamaModelLocal = (providerId: string, modelName: string): boolean => {
    return getOllamaLocalModels(providerId).some((m) => m.name === modelName)
  }

  onMounted(() => {
    setupOllamaEventListeners()
  })

  onBeforeUnmount(() => {
    removeOllamaEventListeners()
  })

  return {
    runningModels,
    localModels,
    pullingProgress,
    refreshOllamaModels,
    pullOllamaModel,
    setRunningModels,
    setLocalModels,
    updatePullingProgress,
    getOllamaRunningModels,
    getOllamaLocalModels,
    getOllamaPullingModels,
    syncOllamaModelsToGlobal,
    handleOllamaModelPullEvent,
    setupOllamaEventListeners,
    removeOllamaEventListeners,
    clearOllamaProviderData,
    isOllamaModelRunning,
    isOllamaModelLocal
  }
})
