import { MODEL_META } from '@shared/presenter'
import { IConfigPresenter } from '@shared/presenter'
import { BaseLLMProvider } from '../baseProvider'

interface ModelManagerOptions {
  configPresenter: IConfigPresenter
  getProviderInstance: (providerId: string) => BaseLLMProvider
}

export class ModelManager {
  constructor(private readonly options: ModelManagerOptions) {}

  async getModelList(providerId: string): Promise<MODEL_META[]> {
    const provider = this.options.getProviderInstance(providerId)
    let models = await provider.fetchModels()
    models = models.map((model) => {
      const config = this.options.configPresenter.getModelConfig(model.id, providerId)

      model.maxTokens = config.maxTokens
      model.contextLength = config.contextLength

      if (config.isUserDefined) {
        model.vision = config.vision
        model.functionCall = config.functionCall
        model.reasoning = config.reasoning
        model.type = config.type
      } else {
        model.vision = model.vision !== undefined ? model.vision : config.vision
        model.functionCall =
          model.functionCall !== undefined ? model.functionCall : config.functionCall
        model.reasoning = model.reasoning !== undefined ? model.reasoning : config.reasoning
        model.type = model.type || config.type
      }

      return model
    })
    return models
  }

  async updateModelStatus(providerId: string, modelId: string, enabled: boolean): Promise<void> {
    this.options.configPresenter.setModelStatus(providerId, modelId, enabled)
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
    const provider = this.options.getProviderInstance(providerId)
    const res = provider.updateCustomModel(modelId, updates)
    this.options.configPresenter.updateCustomModel(providerId, modelId, updates)
    return res
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
      return this.options.configPresenter.getCustomModels(providerId)
    }
  }
}
