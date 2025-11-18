import { ref, onMounted, onBeforeUnmount } from 'vue'
import { defineStore } from 'pinia'
import { OLLAMA_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'
import type { OllamaModel } from '@shared/presenter'
import { useModelStore } from '@/stores/modelStore'

export const useOllamaStore = defineStore('ollama', () => {
  const llmP = usePresenter('llmproviderPresenter')
  const modelStore = useModelStore()

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

  const refreshOllamaModels = async (providerId: string) => {
    try {
      const [running, local] = await Promise.all([
        llmP.listOllamaRunningModels(providerId),
        llmP.listOllamaModels(providerId)
      ])
      setRunningModels(providerId, running)
      setLocalModels(providerId, local)
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

  const handlePullEvent = (data: Record<string, unknown>) => {
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

  const setupEventListeners = () => {
    window.electron?.ipcRenderer?.on(
      OLLAMA_EVENTS.PULL_MODEL_PROGRESS,
      (_event, data: Record<string, unknown>) => handlePullEvent(data)
    )
  }

  const cleanup = () => {
    window.electron?.ipcRenderer?.removeAllListeners(OLLAMA_EVENTS.PULL_MODEL_PROGRESS)
  }

  onMounted(() => {
    setupEventListeners()
  })

  onBeforeUnmount(() => {
    cleanup()
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
    cleanup
  }
})
