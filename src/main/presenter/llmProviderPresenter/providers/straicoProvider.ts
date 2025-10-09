import { LLM_PROVIDER, IConfigPresenter, MODEL_META } from '@shared/presenter'
import { ModelType } from '@shared/model'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

type StraicoModelListResponse = {
  data?: StraicoModelEntry[]
  success?: boolean
}

type StraicoModelEntry = {
  name?: string
  model?: string
  pricing?: {
    coins?: number
    words?: number
  }
  max_output?: number
}

export class StraicoProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  protected override async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const response = await this.openai.models.list(options)
    const straicoResponse = response as unknown as StraicoModelListResponse
    const models = Array.isArray(straicoResponse.data) ? straicoResponse.data : []

    return models
      .filter((model) => typeof model.model === 'string' && model.model.trim())
      .map((model) => {
        const id = model.model!.trim()
        const name = model.name?.trim() || id
        const group = id.includes('/') ? id.split('/')[0] : 'default'
        const maxOutput =
          typeof model.max_output === 'number' && Number.isFinite(model.max_output)
            ? model.max_output
            : undefined
        const contextLength = maxOutput ?? 4096
        const maxTokens = maxOutput ?? 4096

        const meta: MODEL_META = {
          id,
          name,
          group,
          providerId: this.provider.id,
          isCustom: false,
          contextLength,
          maxTokens,
          type: ModelType.Chat
        }

        return meta
      })
  }
}
