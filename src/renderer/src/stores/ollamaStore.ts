import { onBeforeUnmount, onMounted, ref } from 'vue'
import { defineStore } from 'pinia'
import { OLLAMA_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'
import type { OllamaModel } from '@shared/presenter'
import { useModelStore } from '@/stores/modelStore'
import { useProviderStore } from '@/stores/providerStore'

export const useOllamaStore = defineStore('ollama', () => {
  const llmP = usePresenter('llmproviderPresenter')
  const modelStore = useModelStore()
  const providerStore = useProviderStore()

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

  const refreshOllamaModels = async (providerId: string): Promise<void> => {
    try {
      const [running, local] = await Promise.all([
        llmP.listOllamaRunningModels(providerId),
        llmP.listOllamaModels(providerId)
      ])
      setRunningModels(providerId, running)
      setLocalModels(providerId, local)
      await llmP.refreshModels(providerId)
      await modelStore.refreshProviderModels(providerId)
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
      setTimeout(async () => {
        updatePullingProgress(providerId, modelName)
        await refreshOllamaModels(providerId)
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

  const initialize = async () => {
    setupOllamaEventListeners()
    const ollamaProviders = providerStore.providers.filter(
      (p) => p.apiType === 'ollama' && p.enable
    )
    for (const provider of ollamaProviders) {
      await refreshOllamaModels(provider.id)
    }
  }

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
    handleOllamaModelPullEvent,
    setupOllamaEventListeners,
    removeOllamaEventListeners,
    clearOllamaProviderData,
    isOllamaModelRunning,
    isOllamaModelLocal,
    initialize
  }
})
