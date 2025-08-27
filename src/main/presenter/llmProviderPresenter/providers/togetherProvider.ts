import { IConfigPresenter, LLM_PROVIDER, LLMResponse, MODEL_META } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import Together from 'together-ai'
export class TogetherProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  async completions(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: `请总结以下内容，使用简洁的语言，突出重点：\n${text}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(
      [
        {
          role: 'user',
          content: prompt
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }
  protected async fetchProviderModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    // 检查供应商是否在黑名单中
    if (this.isNoModelsApi) {
      // console.log(`Provider ${this.provider.name} does not support OpenAI models API`)
      return this.models
    }
    return this.fetchTogetherAIModels(options)
  }

  protected async fetchTogetherAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const togetherai = new Together({
      apiKey: this.provider.apiKey
    })
    const response = await togetherai.models.list(options)
    return response
      .filter((model) => model.type === 'chat' || model.type === 'language')
      .map((model) => ({
        id: model.id,
        name: model.id,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 4096,
        maxTokens: 2048
      }))
  }
}
