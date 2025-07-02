import { LLM_PROVIDER, LLMResponse, MODEL_META, ChatMessage } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { ConfigPresenter } from '../../configPresenter'

export class DoubaoProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: ConfigPresenter) {
    // 初始化豆包模型配置
    super(provider, configPresenter)
  }

  protected async fetchOpenAIModels(): Promise<MODEL_META[]> {
    return [
      {
        id: 'doubao-1-5-pro-32k-250115',
        name: 'doubao-1.5-pro-32k-250115',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32000,
        maxTokens: 4096
      },
      {
        id: 'deepseek-r1-250120',
        name: 'deepseek-r1',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 4096
      },
      {
        id: 'deepseek-r1-distill-qwen-32b-250120',
        name: 'deepseek-r1-distill-qwen-32b',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32000,
        maxTokens: 4096
      },
      {
        id: 'deepseek-r1-distill-qwen-7b-250120',
        name: 'deepseek-r1-distill-qwen-7b',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32000,
        maxTokens: 4096
      },
      {
        id: 'deepseek-v3-250324',
        name: 'deepseek-v3',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 4096
      }
    ]
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
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
}
