import { ref } from 'vue'
import type { IModelConfig, ModelConfig } from '@shared/presenter'
import { useModelConfigAdapter } from '@/composables/model/useModelConfigAdapter'

export const useModelConfigStoreService = () => {
  const configAdapter = useModelConfigAdapter()
  const cache = ref<Record<string, ModelConfig>>({})

  const getCacheKey = (modelId: string, providerId?: string) =>
    `${providerId ?? 'default'}:${modelId}`

  const getModelConfig = async (modelId: string, providerId?: string): Promise<ModelConfig> => {
    const key = getCacheKey(modelId, providerId)
    if (cache.value[key]) {
      return cache.value[key]
    }
    const config = await configAdapter.getModelConfig(modelId, providerId)
    cache.value[key] = config
    return config
  }

  const setModelConfig = async (modelId: string, providerId: string, config: ModelConfig) => {
    await configAdapter.setModelConfig(modelId, providerId, config)
    cache.value[getCacheKey(modelId, providerId)] = config
  }

  const resetModelConfig = async (modelId: string, providerId: string) => {
    await configAdapter.resetModelConfig(modelId, providerId)
    delete cache.value[getCacheKey(modelId, providerId)]
  }

  const getProviderModelConfigs = async (providerId: string) => {
    return await configAdapter.getProviderModelConfigs(providerId)
  }

  const hasUserModelConfig = async (modelId: string, providerId: string) => {
    return await configAdapter.hasUserModelConfig(modelId, providerId)
  }

  const importConfigs = async (configs: Record<string, IModelConfig>, overwrite = false) => {
    await configAdapter.importModelConfigs(configs, overwrite)
  }

  const exportConfigs = async () => {
    return await configAdapter.exportModelConfigs()
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
}
