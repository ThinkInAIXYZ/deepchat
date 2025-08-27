import {
  LLM_PROVIDER,
  LLMResponse,
  ChatMessage,
  KeyStatus,
  MODEL_META,
  IConfigPresenter
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

// Define interface for 302AI API balance response
interface _302AIBalanceResponse {
  data: {
    balance: string
  }
}

// Define interface for 302AI model response based on actual API format
interface _302AIModelResponse {
  id: string
  object: string
  category?: string
  category_en?: string
  content_length: number // This is the context length
  created_on?: string
  description?: string
  description_en?: string
  description_jp?: string
  first_byte_req_time?: string
  is_moderated: boolean
  max_completion_tokens: number // This is the max output tokens
  price?: {
    input_token?: string
    output_token?: string
    per_request?: string
  }
  supported_tools: boolean // This indicates function calling support
}

export class _302AIProvider extends OpenAICompatibleProvider {
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
   * Get current API key status from 302AI
   * @returns Promise<KeyStatus> API key status information
   */
  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    const response = await fetch('https://api.302.ai/dashboard/balance', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `302AI API key check failed: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const balanceResponse: _302AIBalanceResponse = await response.json()
    const balance = parseFloat(balanceResponse.data.balance)
    const remaining = '$' + balanceResponse.data.balance

    return {
      limit_remaining: remaining,
      remainNum: balance
    }
  }

  /**
   * Override check method to use 302AI's API key status endpoint
   * @returns Promise<{ isOk: boolean; errorMsg: string | null }>
   */
  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      const keyStatus = await this.getKeyStatus()
      // Check if there's remaining quota
      if (keyStatus.remainNum !== undefined && keyStatus.remainNum <= 0) {
        return {
          isOk: false,
          errorMsg: `API key quota exhausted. Remaining: ${keyStatus.limit_remaining}`
        }
      }

      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      let errorMessage = 'An unknown error occurred during 302AI API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('302AI API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }

  /**
   * Override fetchOpenAIModels to parse 302AI specific model data and update model configurations
   * @param options - Request options
   * @returns Promise<MODEL_META[]> - Array of model metadata
   */
  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    try {
      const response = await this.openai.models.list(options)
      // console.log('302AI models response:', JSON.stringify(response, null, 2))

      const models: MODEL_META[] = []

      for (const model of response.data) {
        // Type the model as 302AI specific response
        const _302aiModel = model as unknown as _302AIModelResponse

        // Extract model information
        const modelId = _302aiModel.id

        // Check for function calling support using supported_tools field
        const hasFunctionCalling = _302aiModel.supported_tools === true

        // Check for vision support based on model ID and description patterns
        const hasVision =
          modelId.includes('vision') ||
          modelId.includes('gpt-4o') ||
          (_302aiModel.description && _302aiModel.description.includes('vision')) ||
          (_302aiModel.description_en &&
            _302aiModel.description_en.toLowerCase().includes('vision')) ||
          modelId.includes('claude') || // Some Claude models support vision
          modelId.includes('gemini') || // Gemini models often support vision
          (modelId.includes('qwen') && modelId.includes('vl')) // Qwen VL models

        // Get existing model configuration first
        const existingConfig = this.configPresenter.getModelConfig(modelId, this.provider.id)

        // Extract configuration values with proper fallback priority: API -> existing config -> default
        const contextLength = _302aiModel.content_length || existingConfig.contextLength || 4096

        // Use max_completion_tokens if available, otherwise fall back to existing config or default
        const maxTokens =
          _302aiModel.max_completion_tokens > 0
            ? _302aiModel.max_completion_tokens
            : existingConfig.maxTokens || 2048

        // Build new configuration based on API response
        const newConfig = {
          contextLength: contextLength,
          maxTokens: maxTokens,
          functionCall: hasFunctionCalling,
          vision: hasVision,
          reasoning: existingConfig.reasoning || false, // Keep existing reasoning setting
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
          console.log(`Updating configuration for 302AI model ${modelId}:`, {
            old: {
              contextLength: existingConfig.contextLength,
              maxTokens: existingConfig.maxTokens,
              functionCall: existingConfig.functionCall,
              vision: existingConfig.vision
            },
            new: newConfig,
            apiData: {
              content_length: _302aiModel.content_length,
              max_completion_tokens: _302aiModel.max_completion_tokens,
              supported_tools: _302aiModel.supported_tools,
              category: _302aiModel.category,
              description: _302aiModel.description
            }
          })

          this.configPresenter.setModelConfig(modelId, this.provider.id, newConfig)
        }

        // Create MODEL_META object
        const modelMeta: MODEL_META = {
          id: modelId,
          name: modelId,
          group: 'default',
          providerId: this.provider.id,
          isCustom: false,
          contextLength: contextLength,
          maxTokens: maxTokens,
          vision: hasVision,
          functionCall: hasFunctionCalling,
          reasoning: existingConfig.reasoning || false
        }

        models.push(modelMeta)
      }

      console.log(`Processed ${models.length} 302AI models with dynamic configuration updates`)
      return models
    } catch (error) {
      console.error('Error fetching 302AI models:', error)
      // Fallback to parent implementation
      return super.fetchOpenAIModels(options)
    }
  }
}
