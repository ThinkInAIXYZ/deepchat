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

export class DashscopeProvider extends OpenAICompatibleProvider {
  // List of models that support enable_thinking parameter (dual-mode models)
  private static readonly ENABLE_THINKING_MODELS: string[] = [
    // Open source versions
    'qwen3-235b-a22b',
    'qwen3-32b',
    'qwen3-30b-a3b',
    'qwen3-14b',
    'qwen3-8b',
    'qwen3-4b',
    'qwen3-1.7b',
    'qwen3-0.6b',
    // Commercial versions
    'qwen-plus',
    'qwen-plus-latest',
    'qwen-plus-2025-04-28',
    'qwen-flash',
    'qwen-flash-2025-07-28',
    'qwen-turbo',
    'qwen-turbo-latest',
    'qwen-turbo-2025-04-28'
  ]

  // List of models that support enable_search parameter (internet search)
  private static readonly ENABLE_SEARCH_MODELS: string[] = [
    'qwen-max',
    'qwen-plus',
    'qwen-plus-latest',
    'qwen-plus-2025-07-14',
    'qwen-flash',
    'qwen-flash-2025-07-28',
    'qwen-turbo',
    'qwen-turbo-latest',
    'qwen-turbo-2025-07-15',
    'qwq-plus',
    'qwen3-max-preview'
  ]

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  /**
   * Check if model supports enable_thinking parameter
   * @param modelId Model ID
   * @returns boolean Whether enable_thinking is supported
   */
  private supportsEnableThinking(modelId: string): boolean {
    const normalizedModelId = modelId.toLowerCase()
    return DashscopeProvider.ENABLE_THINKING_MODELS.some((supportedModel) =>
      normalizedModelId.includes(supportedModel)
    )
  }

  /**
   * Check if model supports enable_search parameter
   * @param modelId Model ID
   * @returns boolean Whether enable_search is supported
   */
  private supportsEnableSearch(modelId: string): boolean {
    const normalizedModelId = modelId.toLowerCase()
    return DashscopeProvider.ENABLE_SEARCH_MODELS.some((supportedModel) =>
      normalizedModelId.includes(supportedModel)
    )
  }

  /**
   * Override coreStream method to support DashScope's enable_thinking and enable_search parameters
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

    const shouldAddEnableThinking = this.supportsEnableThinking(modelId) && modelConfig?.reasoning
    const shouldAddEnableSearch = this.supportsEnableSearch(modelId) && modelConfig?.enableSearch

    if (shouldAddEnableThinking || shouldAddEnableSearch) {
      // Original create method
      const originalCreate = this.openai.chat.completions.create.bind(this.openai.chat.completions)
      // Replace create method to add enable_thinking and enable_search parameters
      this.openai.chat.completions.create = ((params: any, options?: any) => {
        const modifiedParams = { ...params }

        if (shouldAddEnableThinking) {
          modifiedParams.enable_thinking = true
          if (modelConfig?.thinkingBudget) {
            modifiedParams.thinking_budget = modelConfig.thinkingBudget
          }
        }

        if (shouldAddEnableSearch) {
          modifiedParams.enable_search = true
          if (modelConfig?.forcedSearch) {
            modifiedParams.forced_search = true
          }
          if (modelConfig?.searchStrategy) {
            modifiedParams.search_strategy = modelConfig.searchStrategy
          }
        }

        return originalCreate(modifiedParams, options)
      }) as any

      try {
        const effectiveModelConfig = {
          ...modelConfig,
          reasoning: false,
          enableSearch: false
        }
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

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const response = await this.openai.models.list(options)
    return response.data.map((model) => ({
      id: model.id,
      name: model.id,
      group: 'default',
      providerId: this.provider.id,
      isCustom: false,
      contextLength: 8192,
      maxTokens: 4096
    }))
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
          content: `Please summarize the following content using concise language and highlighting key points:\n${text}`
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
