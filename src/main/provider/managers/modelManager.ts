import type { ProviderSettingsPort } from '@/provider/settings'
import logger from '@shared/logger'
import type { MODEL_META } from '@shared/types/provider'

import { BaseLLMProvider } from '../baseProvider'

interface ModelManagerOptions {
  providerSettings: ProviderSettingsPort
  getProviderInstance: (providerId: string) => BaseLLMProvider
}

export class ModelManager {
  constructor(private readonly options: ModelManagerOptions) {}

  async getModelList(providerId: string): Promise<MODEL_META[]> {
    logger.info(`[ModelManager] getModelList: fetching models for provider "${providerId}"`)
    const provider = this.options.getProviderInstance(providerId)
    let models = await provider.fetchModels()

    logger.info(
      `[ModelManager] getModelList: received ${models.length} models from provider "${providerId}"`
    )

    models = models.map((model) => {
      // Validate and fix providerId
      if (model.providerId && model.providerId !== providerId) {
        console.warn(
          `[ModelManager] getModelList: Model ${model.id} has incorrect providerId: expected "${providerId}", got "${model.providerId}". Fixing it.`
        )
        model.providerId = providerId
      } else if (!model.providerId) {
        console.warn(
          `[ModelManager] getModelList: Model ${model.id} missing providerId, setting to "${providerId}"`
        )
        model.providerId = providerId
      }
      return model
    })
    models = this.options.providerSettings.resolveEffectiveModels(models, providerId)

    // Final validation
    const incorrectProviderIds = models.filter((m) => m.providerId !== providerId)
    if (incorrectProviderIds.length > 0) {
      console.error(
        `[ModelManager] getModelList: Found ${incorrectProviderIds.length} models with incorrect providerId for provider "${providerId}" after processing`
      )
    } else {
      logger.info(
        `[ModelManager] getModelList: returning ${models.length} validated models for provider "${providerId}"`
      )
    }

    return models
  }

  async updateModelStatus(providerId: string, modelId: string, enabled: boolean): Promise<void> {
    this.options.providerSettings.setModelStatus(providerId, modelId, enabled)
  }

  async batchUpdateModelStatusQuiet(
    providerId: string,
    statusMap: Record<string, boolean>
  ): Promise<void> {
    this.options.providerSettings.batchSetModelStatusQuiet(providerId, statusMap)
  }

  async addCustomModel(
    providerId: string,
    model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ): Promise<MODEL_META> {
    const provider = this.options.getProviderInstance(providerId)
    return provider.addCustomModel(model)
  }

  async removeCustomModel(providerId: string, modelId: string): Promise<boolean> {
    const provider = this.options.getProviderInstance(providerId)
    return provider.removeCustomModel(modelId)
  }

  async updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<MODEL_META>
  ): Promise<boolean> {
    try {
      const provider = this.options.getProviderInstance(providerId)
      const providerResult = await provider.updateCustomModel(modelId, updates)

      // Only update persisted config if provider update was successful
      if (providerResult) {
        await this.options.providerSettings.updateCustomModel(providerId, modelId, updates)
        return true
      } else {
        console.warn(`Provider ${providerId} failed to update model ${modelId}`)
        return false
      }
    } catch (error) {
      console.error(`Failed to update custom model ${modelId} for provider ${providerId}:`, error)
      return false
    }
  }

  async getCustomModels(providerId: string): Promise<MODEL_META[]> {
    try {
      const provider = this.options.getProviderInstance(providerId)
      return provider.getCustomModels()
    } catch (error) {
      console.warn(
        `Failed to get custom models from provider instance ${providerId}, falling back to config:`,
        error
      )
      return this.options.providerSettings.getCustomModels(providerId)
    }
  }
}
