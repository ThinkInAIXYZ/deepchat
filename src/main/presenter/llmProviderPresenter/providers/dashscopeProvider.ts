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
import { modelCapabilities } from '../../configPresenter/modelCapabilities'

export class DashscopeProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  private supportsEnableThinking(modelId: string): boolean {
    return modelCapabilities.supportsReasoning(this.provider.id, modelId)
  }

  private supportsEnableSearch(modelId: string): boolean {
    return modelCapabilities.supportsSearch(this.provider.id, modelId)
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
          const dbBudget = modelCapabilities.getThinkingBudgetRange(
            this.provider.id,
            modelId
          ).default
          const budget = modelConfig?.thinkingBudget ?? dbBudget
          if (typeof budget === 'number') {
            modifiedParams.thinking_budget = budget
          }
        }

        if (shouldAddEnableSearch) {
          modifiedParams.enable_search = true
          const dbSearch = modelCapabilities.getSearchDefaults(this.provider.id, modelId)
          if (modelConfig?.forcedSearch ?? dbSearch.forced) {
            modifiedParams.forced_search = true
          }
          const strategy = modelConfig?.searchStrategy ?? dbSearch.strategy
          if (strategy) {
            modifiedParams.search_strategy = strategy
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
