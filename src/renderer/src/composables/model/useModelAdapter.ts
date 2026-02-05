import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS, PROVIDER_DB_EVENTS } from '@/events'
import type { MODEL_META, RENDERER_MODEL_META } from '@shared/presenter'

export type ModelStatusChangedPayload = {
  providerId: string
  modelId: string
  enabled: boolean
}

export type ModelEventHandlers = {
  onModelListChanged: (providerId?: string) => void
  onModelStatusChanged: (payload: ModelStatusChangedPayload) => void
  onProviderDbUpdated: () => void
  onProviderDbLoaded: () => void
}

export type ModelAdapter = {
  getProviderModels: (providerId: string) => Promise<MODEL_META[]>
  getCustomModels: (providerId: string) => Promise<MODEL_META[]>
  addCustomModelConfig: (providerId: string, model: RENDERER_MODEL_META) => Promise<void>
  removeCustomModelConfig: (providerId: string, modelId: string) => Promise<void>
  getDbProviderModels: (providerId: string) => Promise<RENDERER_MODEL_META[]>
  getBatchModelStatus: (providerId: string, modelIds: string[]) => Promise<Record<string, boolean>>
  getModelList: (providerId: string) => Promise<MODEL_META[]>
  updateModelStatus: (providerId: string, modelId: string, enabled: boolean) => Promise<void>
  isAgentProvider: (providerId: string) => Promise<boolean>
  addCustomModel: (
    providerId: string,
    model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ) => Promise<RENDERER_MODEL_META>
  removeCustomModel: (providerId: string, modelId: string) => Promise<boolean>
  updateCustomModel: (
    providerId: string,
    modelId: string,
    updates: Partial<RENDERER_MODEL_META> & { enabled?: boolean }
  ) => Promise<boolean>
  bindModelEvents: (handlers: ModelEventHandlers) => () => void
}

export function useModelAdapter(): ModelAdapter {
  const configPresenter = usePresenter('configPresenter')
  const llmPresenter = usePresenter('llmproviderPresenter')

  const isAgentProvider = (providerId: string): boolean => {
    const provider = llmPresenter.getProviderById(providerId)
    return provider?.apiType === 'acp'
  }

  const bindModelEvents = (handlers: ModelEventHandlers) => {
    const ipc = window.electron?.ipcRenderer
    if (!ipc) return () => undefined

    const handleListChanged = (_event: unknown, providerId?: string) => {
      handlers.onModelListChanged(providerId)
    }
    const handleStatusChanged = (_event: unknown, payload: ModelStatusChangedPayload) => {
      handlers.onModelStatusChanged(payload)
    }
    const handleDbUpdated = () => {
      handlers.onProviderDbUpdated()
    }
    const handleDbLoaded = () => {
      handlers.onProviderDbLoaded()
    }

    ipc.on(CONFIG_EVENTS.MODEL_LIST_CHANGED, handleListChanged)
    ipc.on(CONFIG_EVENTS.MODEL_STATUS_CHANGED, handleStatusChanged)
    ipc.on(PROVIDER_DB_EVENTS.UPDATED, handleDbUpdated)
    ipc.on(PROVIDER_DB_EVENTS.LOADED, handleDbLoaded)

    return () => {
      ipc.removeListener(CONFIG_EVENTS.MODEL_LIST_CHANGED, handleListChanged)
      ipc.removeListener(CONFIG_EVENTS.MODEL_STATUS_CHANGED, handleStatusChanged)
      ipc.removeListener(PROVIDER_DB_EVENTS.UPDATED, handleDbUpdated)
      ipc.removeListener(PROVIDER_DB_EVENTS.LOADED, handleDbLoaded)
    }
  }

  return {
    getProviderModels: (providerId: string) =>
      Promise.resolve(configPresenter.getProviderModels(providerId)),
    getCustomModels: (providerId: string) =>
      Promise.resolve(configPresenter.getCustomModels(providerId)),
    addCustomModelConfig: (providerId: string, model: RENDERER_MODEL_META) =>
      Promise.resolve(configPresenter.addCustomModel(providerId, model)),
    removeCustomModelConfig: (providerId: string, modelId: string) =>
      Promise.resolve(configPresenter.removeCustomModel(providerId, modelId)),
    getDbProviderModels: (providerId: string) =>
      Promise.resolve(configPresenter.getDbProviderModels(providerId)),
    getBatchModelStatus: (providerId: string, modelIds: string[]) =>
      Promise.resolve(configPresenter.getBatchModelStatus(providerId, modelIds)),
    getModelList: (providerId: string) => Promise.resolve(llmPresenter.getModelList(providerId)),
    updateModelStatus: (providerId: string, modelId: string, enabled: boolean) =>
      Promise.resolve(llmPresenter.updateModelStatus(providerId, modelId, enabled)),
    isAgentProvider: (providerId: string) => Promise.resolve(isAgentProvider(providerId)),
    addCustomModel: (
      providerId: string,
      model: Omit<RENDERER_MODEL_META, 'providerId' | 'isCustom' | 'group'>
    ) => Promise.resolve(llmPresenter.addCustomModel(providerId, model)),
    removeCustomModel: (providerId: string, modelId: string) =>
      Promise.resolve(llmPresenter.removeCustomModel(providerId, modelId)),
    updateCustomModel: (
      providerId: string,
      modelId: string,
      updates: Partial<RENDERER_MODEL_META> & { enabled?: boolean }
    ) => Promise.resolve(llmPresenter.updateCustomModel(providerId, modelId, updates)),
    bindModelEvents
  }
}
