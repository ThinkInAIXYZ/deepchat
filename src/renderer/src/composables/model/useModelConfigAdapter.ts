import { usePresenter } from '@/composables/usePresenter'
import type { IModelConfig, ModelConfig } from '@shared/presenter'

export type ModelConfigAdapter = {
  getModelConfig: (modelId: string, providerId?: string) => Promise<ModelConfig>
  setModelConfig: (modelId: string, providerId: string, config: ModelConfig) => Promise<void>
  resetModelConfig: (modelId: string, providerId: string) => Promise<void>
  getProviderModelConfigs: (providerId: string) => Promise<Record<string, ModelConfig>>
  hasUserModelConfig: (modelId: string, providerId: string) => Promise<boolean>
  importModelConfigs: (configs: Record<string, IModelConfig>, overwrite?: boolean) => Promise<void>
  exportModelConfigs: () => Promise<Record<string, IModelConfig>>
}

export const useModelConfigAdapter = (): ModelConfigAdapter => {
  const configPresenter = usePresenter('configPresenter')
  const mapProviderConfigs = (
    entries: Array<{ modelId: string; config: ModelConfig }>
  ): Record<string, ModelConfig> => {
    return entries.reduce<Record<string, ModelConfig>>((acc, entry) => {
      acc[entry.modelId] = entry.config
      return acc
    }, {})
  }

  return {
    getModelConfig: (modelId: string, providerId?: string) =>
      Promise.resolve(configPresenter.getModelConfig(modelId, providerId)),
    setModelConfig: (modelId: string, providerId: string, config: ModelConfig) =>
      Promise.resolve(configPresenter.setModelConfig(modelId, providerId, config)),
    resetModelConfig: (modelId: string, providerId: string) =>
      Promise.resolve(configPresenter.resetModelConfig(modelId, providerId)),
    getProviderModelConfigs: async (providerId: string) => {
      const entries = await Promise.resolve(configPresenter.getProviderModelConfigs(providerId))
      return mapProviderConfigs(entries)
    },
    hasUserModelConfig: (modelId: string, providerId: string) =>
      Promise.resolve(configPresenter.hasUserModelConfig(modelId, providerId)),
    importModelConfigs: (configs: Record<string, IModelConfig>, overwrite?: boolean) =>
      Promise.resolve(configPresenter.importModelConfigs(configs, overwrite ?? false)),
    exportModelConfigs: () => Promise.resolve(configPresenter.exportModelConfigs())
  }
}
