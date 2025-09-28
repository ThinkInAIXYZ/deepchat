import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  ChatMessage,
  IConfigPresenter
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

export class MinimaxProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    // 初始化智谱AI模型配置
    super(provider, configPresenter)
  }

  protected async fetchOpenAIModels(): Promise<MODEL_META[]> {
    return [
      {
        id: 'MiniMax-M1',
        name: 'MiniMax-M1',
        group: 'default',
        providerId: 'minimax',
        isCustom: false,
        contextLength: 1_000_000,
        maxTokens: 80_000,
        vision: false,
        functionCall: true,
        reasoning: true
      },
      {
        id: 'MiniMax-Text-01',
        name: 'MiniMax-Text-01',
        group: 'default',
        providerId: 'minimax',
        isCustom: false,
        contextLength: 1_000_000,
        maxTokens: 80_000,
        vision: false
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
          content: `You need to summarize the user's conversation into a title of no more than 10 words, with the title language matching the user's primary language, without using punctuation or other special symbols：\n${text}`
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
}
