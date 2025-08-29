import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  ChatMessage,
  IConfigPresenter
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

export class DoubaoProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    // 初始化豆包模型配置
    super(provider, configPresenter)
  }

  protected async fetchOpenAIModels(): Promise<MODEL_META[]> {
    return [
      // DeepSeek 模型
      {
        id: 'deepseek-v3-1-250821',
        name: 'deepseek-v3.1',
        group: 'deepseek',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 32000,
        reasoning: true,
        functionCall: true,
        vision: false
      },
      {
        id: 'deepseek-r1-250120',
        name: 'deepseek-r1',
        group: 'deepseek',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 4096,
        reasoning: true,
        functionCall: false,
        vision: false
      },
      {
        id: 'deepseek-r1-distill-qwen-32b-250120',
        name: 'deepseek-r1-distill-qwen-32b',
        group: 'deepseek',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32000,
        maxTokens: 4096,
        reasoning: true,
        functionCall: false,
        vision: false
      },
      {
        id: 'deepseek-r1-distill-qwen-7b-250120',
        name: 'deepseek-r1-distill-qwen-7b',
        group: 'deepseek',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 32000,
        maxTokens: 4096,
        reasoning: true,
        functionCall: false,
        vision: false
      },
      {
        id: 'deepseek-v3-250324',
        name: 'deepseek-v3',
        group: 'deepseek',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 64000,
        maxTokens: 4096,
        reasoning: false,
        functionCall: true,
        vision: false
      },
      // 豆包原生模型
      {
        id: 'doubao-seed-1-6-vision-250815',
        name: 'doubao-seed-1.6-vision',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 256000,
        maxTokens: 32000,
        reasoning: true,
        functionCall: true,
        vision: true
      },
      {
        id: 'doubao-seed-1-6-250615',
        name: 'doubao-seed-1.6',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 256000,
        maxTokens: 32000,
        reasoning: true,
        functionCall: true,
        vision: true
      },
      {
        id: 'doubao-seed-1-6-flash-250715',
        name: 'doubao-seed-1.6-flash',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 256000,
        maxTokens: 32000,
        reasoning: true,
        functionCall: true,
        vision: true
      },
      {
        id: 'doubao-seed-1-6-flash-250615',
        name: 'doubao-seed-1.6-flash (250615)',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 256000,
        maxTokens: 32000,
        reasoning: true,
        functionCall: true,
        vision: true
      },
      {
        id: 'doubao-seed-1-6-thinking-250715',
        name: 'doubao-seed-1.6-thinking',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 256000,
        maxTokens: 32000,
        reasoning: true,
        functionCall: true,
        vision: true
      },
      {
        id: 'doubao-seed-1-6-thinking-250615',
        name: 'doubao-seed-1.6-thinking (250615)',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 256000,
        maxTokens: 32000,
        reasoning: true,
        functionCall: true,
        vision: true
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
