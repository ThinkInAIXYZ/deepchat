import { LLM_PROVIDER, MODEL_META, IConfigPresenter } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

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

    return []
  }
}
