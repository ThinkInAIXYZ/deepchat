import { usePresenter } from '@/composables/usePresenter'
import { OLLAMA_EVENTS } from '@/events'
import type { ModelConfig, OllamaModel } from '@shared/presenter'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type OllamaAdapter = {
  listOllamaRunningModels: (providerId: string) => Promise<OllamaModel[]>
  listOllamaModels: (providerId: string) => Promise<OllamaModel[]>
  pullOllamaModels: (providerId: string, modelName: string) => Promise<boolean>
  getModelConfig: (modelId: string, providerId?: string) => Promise<ModelConfig>
  onPullModelProgress: (handler: (payload: Record<string, unknown>) => void) => Unsubscribe
}

export const useOllamaAdapter = (): OllamaAdapter => {
  const llmPresenter = usePresenter('llmproviderPresenter')
  const configPresenter = usePresenter('configPresenter')

  const subscribe = <T>(event: string, handler: (payload: T) => void): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (_event: unknown, payload: T) => {
      handler(payload)
    }

    window.electron.ipcRenderer.on(event, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }

  return {
    listOllamaRunningModels: (providerId: string) =>
      llmPresenter.listOllamaRunningModels(providerId),
    listOllamaModels: (providerId: string) => llmPresenter.listOllamaModels(providerId),
    pullOllamaModels: (providerId: string, modelName: string) =>
      llmPresenter.pullOllamaModels(providerId, modelName),
    getModelConfig: (modelId: string, providerId?: string) =>
      Promise.resolve(configPresenter.getModelConfig(modelId, providerId)),
    onPullModelProgress: (handler) =>
      subscribe<Record<string, unknown>>(OLLAMA_EVENTS.PULL_MODEL_PROGRESS, handler)
  }
}
