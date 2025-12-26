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
import { ModelType } from '@shared/model'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { providerDbLoader } from '../../configPresenter/providerDbLoader'
import { modelCapabilities } from '../../configPresenter/modelCapabilities'

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
    const resolvedId = modelCapabilities.resolveProviderId(this.provider.id) || this.provider.id
    const provider = providerDbLoader.getProvider(resolvedId)
    if (!provider || !Array.isArray(provider.models)) {
      return []
    }

    return provider.models.map((model) => {
      const inputs = model.modalities?.input
      const outputs = model.modalities?.output
      const hasImageInput = Array.isArray(inputs) && inputs.includes('image')
      const hasImageOutput = Array.isArray(outputs) && outputs.includes('image')
      const modelType = hasImageOutput ? ModelType.ImageGeneration : ModelType.Chat

      return {
        id: model.id,
        name: model.display_name || model.name || model.id,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: model.limit?.context ?? 8192,
        maxTokens: model.limit?.output ?? 4096,
        vision: hasImageInput,
        functionCall: Boolean(model.tool_call),
        reasoning: Boolean(model.reasoning?.supported),
        enableSearch: Boolean(model.search?.supported),
        type: modelType
      }
    })
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
