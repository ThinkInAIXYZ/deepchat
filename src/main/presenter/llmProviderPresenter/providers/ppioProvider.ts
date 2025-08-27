import {
  LLM_PROVIDER,
  LLMResponse,
  ChatMessage,
  KeyStatus,
  MODEL_META,
  IConfigPresenter
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

// Define interface for PPIO API key response
interface PPIOKeyResponse {
  credit_balance: number
}

// Define interface for PPIO model response
interface PPIOModelResponse {
  id: string
  object: string
  owned_by: string
  created: number
  display_name: string
  description: string
  context_size: number
  max_output_tokens: number
  features?: string[]
  status: number
  model_type: string
}

export class PPIOProvider extends OpenAICompatibleProvider {
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
   * Get current API key status from PPIO
   * @returns Promise<KeyStatus> API key status information
   */
  public async getKeyStatus(): Promise<KeyStatus> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    const response = await fetch('https://api.ppinfra.com/v3/user', {
      method: 'GET',
      headers: {
        Authorization: this.provider.apiKey,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `PPIO API key check failed: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const keyResponse: PPIOKeyResponse = await response.json()
    const remaining = '¥' + keyResponse.credit_balance / 10000
    return {
      limit_remaining: remaining,
      remainNum: keyResponse.credit_balance
    }
  }

  /**
   * Override check method to use PPIO's API key status endpoint
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
      let errorMessage = 'An unknown error occurred during PPIO API key check.'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }

      console.error('PPIO API key check failed:', error)
      return { isOk: false, errorMsg: errorMessage }
    }
  }

  /**
   * Override fetchOpenAIModels to parse PPIO specific model data and update model configurations
   * @param options - Request options
   * @returns Promise<MODEL_META[]> - Array of model metadata
   */
  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    try {
      const response = await this.openai.models.list(options)
      // console.log('PPIO models response:', JSON.stringify(response, null, 2))

      const models: MODEL_META[] = []

      for (const model of response.data) {
        // Type the model as PPIO specific response
        const ppioModel = model as unknown as PPIOModelResponse

        // Extract model information
        const modelId = ppioModel.id
        const features = ppioModel.features || []

        // Check features for capabilities
        const hasFunctionCalling = features.includes('function-calling')
        const hasVision = features.includes('vision')
        // const hasStructuredOutputs = features.includes('structured-outputs')

        // Get existing model configuration first
        const existingConfig = this.configPresenter.getModelConfig(modelId, this.provider.id)

        // Extract configuration values with proper fallback priority: API -> existing config -> default
        const contextLength = ppioModel.context_size || existingConfig.contextLength || 4096
        const maxTokens = ppioModel.max_output_tokens || existingConfig.maxTokens || 2048

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
          // console.log(`Updating configuration for model ${modelId}:`, {
          //   old: {
          //     contextLength: existingConfig.contextLength,
          //     maxTokens: existingConfig.maxTokens,
          //     functionCall: existingConfig.functionCall,
          //     vision: existingConfig.vision
          //   },
          //   new: newConfig
          // })

          this.configPresenter.setModelConfig(modelId, this.provider.id, newConfig)
        }

        // Create MODEL_META object
        const modelMeta: MODEL_META = {
          id: modelId,
          name: ppioModel.display_name || modelId,
          group: 'default',
          providerId: this.provider.id,
          isCustom: false,
          contextLength: contextLength,
          maxTokens: maxTokens,
          description: ppioModel.description,
          vision: hasVision,
          functionCall: hasFunctionCalling,
          reasoning: existingConfig.reasoning || false
        }

        models.push(modelMeta)
      }

      console.log(`Processed ${models.length} PPIO models with dynamic configuration updates`)
      return models
    } catch (error) {
      console.error('Error fetching PPIO models:', error)
      // Fallback to parent implementation
      return super.fetchOpenAIModels(options)
    }
  }
}
