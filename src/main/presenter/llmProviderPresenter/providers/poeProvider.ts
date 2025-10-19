import { LLM_PROVIDER, MODEL_META, IConfigPresenter } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

/**
 * PoeProvider integrates Poe's OpenAI-compatible API surface with the shared
 * BaseLLMProvider contract so the rest of the app can treat it just like
 * any other OpenAI-style backend.
 *
 * Poe exposes hundreds of community and frontier models through a single
 * endpoint. We reuse the OpenAICompatibleProvider implementation and only
 * tweak metadata so the renderer can present a clearer group name.
 */
export class PoeProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const models = await super.fetchOpenAIModels(options)
    return models.map((model) => ({
      ...model,
      group: 'Poe'
    }))
  }
}
