import { LLM_PROVIDER, MODEL_META, IConfigPresenter } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

const CHERRYIN_FALLBACK_MODELS: Omit<MODEL_META, 'providerId'>[] = [
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    group: 'cherryin',
    isCustom: false,
    vision: true,
    functionCall: true,
    reasoning: true,
    contextLength: 128000,
    maxTokens: 4096
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    group: 'cherryin',
    isCustom: false,
    vision: true,
    functionCall: true,
    reasoning: false,
    contextLength: 128000,
    maxTokens: 8192
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    group: 'cherryin',
    isCustom: false,
    vision: true,
    functionCall: true,
    reasoning: true,
    contextLength: 128000,
    maxTokens: 16384
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    group: 'cherryin',
    isCustom: false,
    vision: true,
    functionCall: true,
    reasoning: false,
    contextLength: 128000,
    maxTokens: 16384
  },
  {
    id: 'o3-mini',
    name: 'O3 Mini',
    group: 'cherryin',
    isCustom: false,
    vision: false,
    functionCall: true,
    reasoning: true,
    contextLength: 200000,
    maxTokens: 64000
  }
]

export class CherryInProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    try {
      const models = await super.fetchOpenAIModels(options)
      if (models.length > 0) {
        return models.map((model) => ({
          ...model,
          group: model.group === 'default' ? 'cherryin' : model.group,
          providerId: this.provider.id
        }))
      }
    } catch (error) {
      console.warn(
        '[CherryInProvider] Failed to fetch models via API, falling back to defaults',
        error
      )
    }

    return CHERRYIN_FALLBACK_MODELS.map((model) => ({
      ...model,
      providerId: this.provider.id
    }))
  }
}
