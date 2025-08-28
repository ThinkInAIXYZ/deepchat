import {
  LLM_PROVIDER,
  LLMResponse,
  ChatMessage,
  KeyStatus,
  MODEL_META,
  IConfigPresenter
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

// Define interface for TokenFlux API model response
interface TokenFluxModelResponse {
  id: string
  name: string
  description: string
  provider: string
  pricing: {
    input: number
    output: number
  }
  context_length: number
  supports_streaming: boolean
  supports_vision: boolean
}

// Define interface for TokenFlux models list response
interface TokenFluxModelsResponse {
  object: string
  data: TokenFluxModelResponse[]
}

export class TokenFluxProvider extends OpenAICompatibleProvider {
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
   * Get current API key status from TokenFlux
   * @returns Promise<KeyStatus> API key status information
   */
  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    // TokenFlux uses OpenAI-compatible API, so we can use the models endpoint for key validation
    const response = await fetch(`${this.provider.baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `TokenFlux API key check failed: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    // TokenFlux doesn't provide quota information in the models endpoint response
    // So we return a simple success status
    return {
      limit_remaining: 'Available',
      remainNum: undefined
    }
  }

  /**
   * Override check method to use TokenFlux's API key status endpoint
   * @returns Promise<{ isOk: boolean; errorMsg: string | null }>
   */
  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      await this.getKeyStatus()
      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      let errorMessage = 'An unknown error occurred during TokenFlux API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('TokenFlux API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }

  /**
   * Override fetchOpenAIModels to parse TokenFlux specific model data and update model configurations
   * @param options - Request options
   * @returns Promise<MODEL_META[]> - Array of model metadata
   */
  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    try {
      const response = await this.openai.models.list(options)
      // console.log('TokenFlux models response:', JSON.stringify(response, null, 2))

      const models: MODEL_META[] = []

      // Cast response to TokenFlux format
      const tokenfluxResponse = response as unknown as TokenFluxModelsResponse

      for (const model of tokenfluxResponse.data) {
        // Extract model information
        const modelId = model.id
        const modelName = model.name || modelId
        const description = model.description || ''

        // Determine capabilities based on TokenFlux model data
        const hasVision = model.supports_vision || false
        const hasFunctionCalling = true // Most TokenFlux models should support function calling

        // Get existing model configuration first
        const existingConfig = this.configPresenter.getModelConfig(modelId, this.provider.id)

        // Extract configuration values with proper fallback priority: API -> existing config -> default
        const contextLength = model.context_length || existingConfig.contextLength || 4096
        const maxTokens = existingConfig.maxTokens || Math.min(contextLength / 2, 4096)

        // Build new configuration based on API response
        const newConfig = {
          contextLength: contextLength,
          maxTokens: maxTokens,
          functionCall: hasFunctionCalling,
          vision: hasVision,
          reasoning: existingConfig.reasoning, // Keep existing reasoning setting
          temperature: existingConfig.temperature, // Keep existing temperature
          type: existingConfig.type // Keep existing type
        }

        // Check if configuration has changed
        const configChanged =
          existingConfig.contextLength !== newConfig.contextLength ||
          existingConfig.maxTokens !== newConfig.maxTokens ||
          existingConfig.functionCall !== newConfig.functionCall ||
          existingConfig.vision !== newConfig.vision

        // Update configuration if changed
        if (configChanged) {
          this.configPresenter.setModelConfig(modelId, this.provider.id, newConfig)
        }

        // Create MODEL_META object
        const modelMeta: MODEL_META = {
          id: modelId,
          name: modelName,
          group: 'default',
          providerId: this.provider.id,
          isCustom: false,
          contextLength: contextLength,
          maxTokens: maxTokens,
          description: description,
          vision: hasVision,
          functionCall: hasFunctionCalling,
          reasoning: existingConfig.reasoning || false
        }

        models.push(modelMeta)
      }

      console.log(`Processed ${models.length} TokenFlux models with dynamic configuration updates`)
      return models
    } catch (error) {
      console.error('Error fetching TokenFlux models:', error)
      // Fallback to parent implementation
      return super.fetchOpenAIModels(options)
    }
  }
}
