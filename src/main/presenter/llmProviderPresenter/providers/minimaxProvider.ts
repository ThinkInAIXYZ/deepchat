import { MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import { AnthropicProvider } from './anthropicProvider'
import { providerDbLoader } from '../../configPresenter/providerDbLoader'
import { modelCapabilities } from '../../configPresenter/modelCapabilities'

export class MinimaxProvider extends AnthropicProvider {
  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    const resolvedId = modelCapabilities.resolveProviderId(this.provider.id) || this.provider.id
    const provider = providerDbLoader.getProvider(resolvedId)

    if (provider && Array.isArray(provider.models) && provider.models.length > 0) {
      return provider.models.map((model) => {
        const inputs = model.modalities?.input
        const outputs = model.modalities?.output
        const hasImageInput = Array.isArray(inputs) && inputs.includes('image')
        const hasImageOutput = Array.isArray(outputs) && outputs.includes('image')
        const modelType = hasImageOutput ? ModelType.ImageGeneration : ModelType.Chat

        return {
          id: model.id,
          name: model.display_name || model.name || model.id,
          group: 'default',
          providerId: this.provider.id,
          isCustom: false,
          contextLength: model.limit?.context ?? 8192,
          maxTokens: model.limit?.output ?? 4096,
          vision: hasImageInput,
          functionCall: Boolean(model.tool_call),
          reasoning: Boolean(model.reasoning?.supported),
          enableSearch: Boolean(model.search?.supported),
          type: modelType
        }
      })
    }

    return super.fetchProviderModels()
  }
}
