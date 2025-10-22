import { LLM_PROVIDER, MODEL_META, IConfigPresenter } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

export class JiekouProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const models = await super.fetchOpenAIModels(options)
    return models.map((model) => ({
      ...model,
      group: 'JieKou.AI'
    }))
  }
}
