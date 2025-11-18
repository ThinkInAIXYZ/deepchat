import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ModelConfig, IModelConfig } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'

export const useModelConfigStore = defineStore('modelConfig', () => {
  const configP = usePresenter('configPresenter')

  const cache = ref<Record<string, ModelConfig>>({})

  const getCacheKey = (modelId: string, providerId?: string) =>
    `${providerId ?? 'default'}:${modelId}`

  const getModelConfig = async (modelId: string, providerId?: string): Promise<ModelConfig> => {
    const key = getCacheKey(modelId, providerId)
    if (cache.value[key]) {
      return cache.value[key]
    }
    const config = await configP.getModelConfig(modelId, providerId)
    cache.value[key] = config
    return config
  }

  const setModelConfig = async (modelId: string, providerId: string, config: ModelConfig) => {
    await configP.setModelConfig(modelId, providerId, config)
    cache.value[getCacheKey(modelId, providerId)] = config
  }

  const resetModelConfig = async (modelId: string, providerId: string) => {
    await configP.resetModelConfig(modelId, providerId)
    delete cache.value[getCacheKey(modelId, providerId)]
  }

  const getProviderModelConfigs = async (providerId: string) => {
    return await configP.getProviderModelConfigs(providerId)
  }

  const hasUserModelConfig = async (modelId: string, providerId: string) => {
    return configP.hasUserModelConfig(modelId, providerId)
  }

  const importConfigs = async (configs: Record<string, IModelConfig>, overwrite = false) => {
    await configP.importModelConfigs(configs, overwrite)
  }

  const exportConfigs = async () => {
    return configP.exportModelConfigs()
  }

  return {
    getModelConfig,
    setModelConfig,
    resetModelConfig,
    getProviderModelConfigs,
    hasUserModelConfig,
    importConfigs,
    exportConfigs
  }
})
