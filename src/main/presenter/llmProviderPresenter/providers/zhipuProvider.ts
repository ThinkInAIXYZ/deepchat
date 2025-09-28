import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  ChatMessage,
  IConfigPresenter
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

export class ZhipuProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    // Initialize Zhipu AI model configuration
    super(provider, configPresenter)
  }

  protected async fetchOpenAIModels(): Promise<MODEL_META[]> {
    return [
      // Language models
      {
        id: 'glm-4.5',
        name: 'GLM-4.5',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192
      },
      {
        id: 'glm-4.5-air',
        name: 'GLM-4.5-Air',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192
      },
      {
        id: 'glm-4.5-x',
        name: 'GLM-4.5-X',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192
      },
      {
        id: 'glm-4.5-airx',
        name: 'GLM-4.5-AirX',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192
      },
      {
        id: 'glm-4.5-flash',
        name: 'GLM-4.5-Flash',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 8192
      },
      {
        id: 'glm-4-plus',
        name: 'GLM-4-Plus',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 4096
      },
      {
        id: 'glm-4-air-250414',
        name: 'GLM-4-Air-250414',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 16000
      },
      {
        id: 'glm-4-long',
        name: 'GLM-4-Long',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 1000000,
        maxTokens: 4096
      },
      {
        id: 'glm-4-airx',
        name: 'GLM-4-AirX',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 8000,
        maxTokens: 4096
      },
      {
        id: 'glm-4-flashx',
        name: 'GLM-4-FlashX',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 4096
      },
      {
        id: 'glm-4-flash-250414',
        name: 'GLM-4-Flash-250414',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 16000
      },
      // Reasoning models
      {
        id: 'glm-z1-air',
        name: 'GLM-Z1-Air',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32000,
        maxTokens: 32000
      },
      {
        id: 'glm-z1-airx',
        name: 'GLM-Z1-AirX',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32000,
        maxTokens: 30000
      },
      {
        id: 'glm-z1-flash',
        name: 'GLM-Z1-Flash',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32000,
        maxTokens: 32000
      },
      // Multimodal models
      {
        id: 'glm-4.5v',
        name: 'GLM-4.5V',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 65536,
        maxTokens: 8192
      },
      {
        id: 'glm-4v-plus-0111',
        name: 'GLM-4V-Plus-0111',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 16000,
        maxTokens: 4096
      },
      {
        id: 'glm-4v',
        name: 'GLM-4V',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 4000,
        maxTokens: 4096
      },
      {
        id: 'glm-4v-flash',
        name: 'GLM-4V-Flash',
        group: 'zhipu',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 4000,
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
