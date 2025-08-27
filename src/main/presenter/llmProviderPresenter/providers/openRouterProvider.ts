import {
  LLM_PROVIDER,
  LLMResponse,
  ChatMessage,
  KeyStatus,
  MODEL_META,
  IConfigPresenter
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

// Define interface for OpenRouter API key response
interface OpenRouterKeyResponse {
  data: {
    label: string
    usage: number
    is_free_tier: boolean
    is_provisioning_key: boolean
    limit: number | null
    limit_remaining: number | null
    rate_limit: {
      requests: number
      interval: string
    }
  }
}

// Define interface for OpenRouter model response based on their API documentation
interface OpenRouterModelResponse {
  id: string
  name: string
  description: string
  created: number
  context_length: number
  architecture?: {
    input_modalities: string[] // ["file", "image", "text"]
    output_modalities: string[] // ["text"]
    tokenizer: string
    instruct_type: string | null
  }
  pricing: {
    prompt: string
    completion: string
    request: string
    image: string
    web_search: string
    internal_reasoning: string
    input_cache_read: string
    input_cache_write: string
  }
  top_provider?: {
    context_length: number
    max_completion_tokens: number
    is_moderated: boolean
  }
  per_request_limits: any
  supported_parameters?: string[]
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
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

  /**
   * Get current API key status from OpenRouter
   * @returns Promise<KeyStatus> API key status information
   */
  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    const response = await fetch('https://openrouter.ai/api/v1/key', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (response.status !== 200) {
      const errorText = await response.text()
      throw new Error(
        `OpenRouter API key check failed: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const responseText = await response.text()
    if (!responseText || responseText.trim().length === 0) {
      throw new Error('OpenRouter API returned empty response')
    }

    const keyResponse: OpenRouterKeyResponse = JSON.parse(responseText)
    if (!keyResponse.data) {
      throw new Error(`OpenRouter API response missing 'data' field`)
    }

    // Build KeyStatus based on available data
    const keyStatus: KeyStatus = {
      usage: '$' + keyResponse.data.usage
    }

    // Only include limit_remaining if it's not null (has actual limit)
    if (keyResponse.data.limit_remaining !== null) {
      keyStatus.limit_remaining = '$' + keyResponse.data.limit_remaining
      keyStatus.remainNum = keyResponse.data.limit_remaining
    }

    return keyStatus
  }

  /**
   * Override check method to use OpenRouter's API key status endpoint
   * @returns Promise<{ isOk: boolean; errorMsg: string | null }>
   */
  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      const keyStatus = await this.getKeyStatus()

      // Check if there's remaining quota (only if limit_remaining exists)
      if (keyStatus.remainNum !== undefined && keyStatus.remainNum <= 0) {
        return {
          isOk: false,
          errorMsg: `API key quota exhausted. Remaining: ${keyStatus.limit_remaining}`
        }
      }

      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      let errorMessage = 'An unknown error occurred during OpenRouter API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('OpenRouter API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }

  /**
   * Override fetchOpenAIModels to parse OpenRouter specific model data and update model configurations
   * @param options - Request options
   * @returns Promise<MODEL_META[]> - Array of model metadata
   */
  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    try {
      const response = await this.openai.models.list(options)
      // console.log('OpenRouter models response:', JSON.stringify(response, null, 2))

      const models: MODEL_META[] = []

      for (const model of response.data) {
        // Type the model as OpenRouter specific response
        const openRouterModel = model as unknown as OpenRouterModelResponse

        // Extract model information
        const modelId = openRouterModel.id
        const supportedParameters = openRouterModel.supported_parameters || []
        const inputModalities = openRouterModel.architecture?.input_modalities || []

        // Check capabilities based on supported parameters and architecture
        const hasFunctionCalling = supportedParameters.includes('tools')
        const hasVision = inputModalities.includes('image')
        const hasReasoning =
          supportedParameters.includes('reasoning') ||
          supportedParameters.includes('include_reasoning')

        // Get existing model configuration first
        const existingConfig =
          this.configPresenter.getModelConfig(modelId, this.provider.id) ?? ({} as const)

        // Extract configuration values with proper fallback priority: API -> existing config -> default
        const contextLength =
          openRouterModel.context_length ||
          openRouterModel.top_provider?.context_length ||
          existingConfig.contextLength ||
          4096
        const maxTokens =
          openRouterModel.top_provider?.max_completion_tokens || existingConfig.maxTokens || 2048

        // Build new configuration based on API response
        const newConfig = {
          contextLength: contextLength,
          maxTokens: maxTokens,
          functionCall: hasFunctionCalling,
          vision: hasVision,
          reasoning: hasReasoning || existingConfig.reasoning, // Use API info or keep existing
          temperature: existingConfig.temperature, // Keep existing temperature
          type: existingConfig.type // Keep existing type
        }

        // Check if configuration has changed
        const configChanged =
          existingConfig.contextLength !== newConfig.contextLength ||
          existingConfig.maxTokens !== newConfig.maxTokens ||
          existingConfig.functionCall !== newConfig.functionCall ||
          existingConfig.vision !== newConfig.vision ||
          existingConfig.reasoning !== newConfig.reasoning

        // Update configuration if changed
        if (configChanged) {
          // console.log(`Updating OpenRouter configuration for model ${modelId}:`, {
          //   old: {
          //     contextLength: existingConfig.contextLength,
          //     maxTokens: existingConfig.maxTokens,
          //     functionCall: existingConfig.functionCall,
          //     vision: existingConfig.vision,
          //     reasoning: existingConfig.reasoning
          //   },
          //   new: newConfig
          // })

          this.configPresenter.setModelConfig(modelId, this.provider.id, newConfig)
        }

        // Create MODEL_META object
        const modelMeta: MODEL_META = {
          id: modelId,
          name: openRouterModel.name || modelId,
          group: 'default',
          providerId: this.provider.id,
          isCustom: false,
          contextLength: contextLength,
          maxTokens: maxTokens,
          description: openRouterModel.description,
          vision: hasVision,
          functionCall: hasFunctionCalling,
          reasoning: hasReasoning || existingConfig.reasoning || false
        }

        models.push(modelMeta)
      }

      console.log(`Processed ${models.length} OpenRouter models with dynamic configuration updates`)
      return models
    } catch (error) {
      console.error('Error fetching OpenRouter models:', error)
      // Fallback to parent implementation
      return super.fetchOpenAIModels(options)
    }
  }
}
