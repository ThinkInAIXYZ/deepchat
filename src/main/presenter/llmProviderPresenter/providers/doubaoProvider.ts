import {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  ChatMessage,
  IConfigPresenter,
  LLMCoreStreamEvent,
  ModelConfig,
  MCPToolDefinition
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

export class DoubaoProvider extends OpenAICompatibleProvider {
  // List of models that support thinking parameter
  private static readonly THINKING_MODELS: string[] = [
    'deepseek-v3-1-250821',
    'doubao-seed-1-6-vision-250815',
    'doubao-seed-1-6-250615',
    'doubao-seed-1-6-flash-250615',
    'doubao-1-5-thinking-vision-pro-250428',
    'doubao-1-5-ui-tars-250428',
    'doubao-1-5-thinking-pro-m-250428'
  ]

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    // Initialize Doubao model configuration
    super(provider, configPresenter)
  }

  private supportsThinking(modelId: string): boolean {
    return DoubaoProvider.THINKING_MODELS.includes(modelId)
  }

  /**
   * Override coreStream method to support Doubao's thinking parameter
   */
  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!this.isInitialized) throw new Error('Provider not initialized')
    if (!modelId) throw new Error('Model ID is required')

    const shouldAddThinking = this.supportsThinking(modelId) && modelConfig?.reasoning

    if (shouldAddThinking) {
      // Original create method
      const originalCreate = this.openai.chat.completions.create.bind(this.openai.chat.completions)
      // Replace create method to add thinking parameter
      this.openai.chat.completions.create = ((params: any, options?: any) => {
        const modifiedParams = {
          ...params,
          thinking: {
            type: 'enabled'
          }
        }
        return originalCreate(modifiedParams, options)
      }) as any

      try {
        const effectiveModelConfig = { ...modelConfig, reasoning: false }
        yield* super.coreStream(
          messages,
          modelId,
          effectiveModelConfig,
          temperature,
          maxTokens,
          mcpTools
        )
      } finally {
        this.openai.chat.completions.create = originalCreate
      }
    } else {
      yield* super.coreStream(messages, modelId, modelConfig, temperature, maxTokens, mcpTools)
    }
  }

  protected async fetchOpenAIModels(): Promise<MODEL_META[]> {
    return [
      // DeepSeek models
      {
        id: 'deepseek-v3-1-250821',
        name: 'deepseek-v3.1',
        group: 'deepseek',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 128000,
        maxTokens: 32000,
        reasoning: false,
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
      // Doubao native models
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
        reasoning: false,
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
        reasoning: false,
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
        reasoning: false,
        functionCall: true,
        vision: true
      },
      {
        id: 'doubao-1-5-thinking-vision-pro-250428',
        name: 'doubao-1.5-thinking-vision-pro',
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
        id: 'doubao-1-5-ui-tars-250428',
        name: 'doubao-1.5-ui-tars',
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
        id: 'doubao-1-5-thinking-pro-m-250428',
        name: 'doubao-1.5-thinking-pro-m',
        group: 'doubao',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: 256000,
        maxTokens: 32000,
        reasoning: true,
        functionCall: true,
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
