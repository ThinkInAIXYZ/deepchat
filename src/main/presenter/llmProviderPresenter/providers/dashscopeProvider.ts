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
  // 支持 enable_thinking 参数的模型列表（双模式模型）
  private static readonly ENABLE_THINKING_MODELS: string[] = [
    // 开源版
    'qwen3-235b-a22b',
    'qwen3-32b',
    'qwen3-30b-a3b',
    'qwen3-14b',
    'qwen3-8b',
    'qwen3-4b',
    'qwen3-1.7b',
    'qwen3-0.6b'
  ]

  // 支持 enable_search 参数的模型列表（联网搜索）
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
    'qwq-plus'
  ]

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  /**
   * 检查模型是否支持 enable_thinking 参数
   * @param modelId 模型ID
   * @returns boolean 是否支持 enable_thinking
   */
  private supportsEnableThinking(modelId: string): boolean {
    const normalizedModelId = modelId.toLowerCase()
    return DashscopeProvider.ENABLE_THINKING_MODELS.some((supportedModel) =>
      normalizedModelId.includes(supportedModel)
    )
  }

  /**
   * 检查模型是否支持 enable_search 参数
   * @param modelId 模型ID
   * @returns boolean 是否支持 enable_search
   */
  private supportsEnableSearch(modelId: string): boolean {
    const normalizedModelId = modelId.toLowerCase()
    return DashscopeProvider.ENABLE_SEARCH_MODELS.some((supportedModel) =>
      normalizedModelId.includes(supportedModel)
    )
  }

  /**
   * 重写 coreStream 方法以支持 DashScope 的 enable_thinking 和 enable_search 参数
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
      // 原始的 create 方法
      const originalCreate = this.openai.chat.completions.create.bind(this.openai.chat.completions)
      // 替换 create 方法以添加 enable_thinking 和 enable_search 参数
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
}
