import { defineStore } from 'pinia'
import { useQuery } from '@pinia/colada'
import type { MODEL_META, RENDERER_MODEL_META } from '@shared/presenter'
import { useIpcMutation } from '@/composables/useIpcMutation'
import { usePresenter } from '@/composables/usePresenter'

const PROVIDER_MODELS_KEY = (providerId: string) => ['model-store', 'provider-models', providerId]
const CUSTOM_MODELS_KEY = (providerId: string) => ['model-store', 'custom-models', providerId]
const ENABLED_MODELS_KEY = (providerId: string) => ['model-store', 'enabled-models', providerId]

export const useModelStore = defineStore('model', () => {
  const configP = usePresenter('configPresenter')

  const getProviderModelsQuery = (providerId: string) =>
    useQuery<MODEL_META[]>({
      key: () => PROVIDER_MODELS_KEY(providerId),
      staleTime: 30_000,
      query: async () => {
        return configP.getProviderModels(providerId)
      }
    })

  const getCustomModelsQuery = (providerId: string) =>
    useQuery<MODEL_META[]>({
      key: () => CUSTOM_MODELS_KEY(providerId),
      staleTime: 30_000,
      query: async () => {
        return configP.getCustomModels(providerId)
      }
    })

  const getEnabledModelsQuery = (providerId: string) =>
    useQuery<RENDERER_MODEL_META[]>({
      key: () => ENABLED_MODELS_KEY(providerId),
      staleTime: 30_000,
      query: async () => {
        const [providerModels, customModels] = await Promise.all([
          configP.getProviderModels(providerId),
          configP.getCustomModels(providerId)
        ])
        const modelIds = [...providerModels, ...customModels].map((model) => model.id)
        const statusMap = configP.getBatchModelStatus(providerId, modelIds)
        return [...providerModels, ...customModels]
          .filter((model) => statusMap[model.id] === true)
          .map((model) => ({ ...model, enabled: true }))
      }
    })

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
    getProviderModelsQuery,
    getCustomModelsQuery,
    getEnabledModelsQuery,
    addCustomModelMutation,
    removeCustomModelMutation,
    updateCustomModelMutation
  }
})
