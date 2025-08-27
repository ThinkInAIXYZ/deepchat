import {
  LLM_PROVIDER,
  LLMResponse,
  ChatMessage,
  MODEL_META,
  IConfigPresenter
} from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

// Define interface for Groq model response (following PPIO naming convention)
interface GroqModelResponse {
  id: string
  object: string
  owned_by: string
  created: number
  display_name?: string
  description?: string
  context_size: number // Groq uses context_window, but we'll map it to context_size
  max_output_tokens: number // Groq may use max_tokens, but we'll map it to max_output_tokens
  features?: string[]
  status?: number // Groq uses active boolean, we'll map it to status number
  model_type?: string
  // Groq specific fields that we need to handle
  active?: boolean
  context_window?: number
  max_tokens?: number
  public_apps?: boolean
}

export class GroqProvider extends OpenAICompatibleProvider {
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

  /**
   * Override fetchOpenAIModels to parse Groq specific model data and update model configurations
   * @param options - Request options
   * @returns Promise<MODEL_META[]> - Array of model metadata
   */
  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    try {
      const response = await this.openai.models.list(options)
      // console.log('Groq models response:', JSON.stringify(response, null, 2))

      const models: MODEL_META[] = []

      for (const model of response.data) {
        // Type the model as Groq specific response
        const groqModel = model as unknown as GroqModelResponse

        // Skip inactive models (map Groq's active field to status)
        const modelStatus = groqModel.status ?? (groqModel.active ? 1 : 0)
        if (modelStatus === 0 || groqModel.active === false) {
          continue
        }

        // Extract model information
        const modelId = groqModel.id
        const features = groqModel.features || []

        // Map Groq fields to PPIO-style naming
        const contextSize = groqModel.context_size || groqModel.context_window || 4096
        const maxOutputTokens = groqModel.max_output_tokens || groqModel.max_tokens || 2048

        // Check features for capabilities or infer from model name
        const hasFunctionCalling =
          features.includes('function-calling') ||
          (!modelId.toLowerCase().includes('distil') && !modelId.toLowerCase().includes('gemma'))
        const hasVision =
          features.includes('vision') ||
          modelId.toLowerCase().includes('vision') ||
          modelId.toLowerCase().includes('llava')

        // Get existing model configuration first
        const existingConfig = this.configPresenter.getModelConfig(modelId, this.provider.id)

        // Extract configuration values with proper fallback priority: API -> existing config -> default
        const contextLength = contextSize || existingConfig.contextLength || 4096
        const maxTokens = maxOutputTokens || existingConfig.maxTokens || 2048

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
          name: groqModel.display_name || modelId,
          group: 'default',
          providerId: this.provider.id,
          isCustom: false,
          contextLength: contextLength,
          maxTokens: maxTokens,
          description: groqModel.description || `Groq model ${modelId}`,
          vision: hasVision,
          functionCall: hasFunctionCalling,
          reasoning: existingConfig.reasoning || false
        }

        models.push(modelMeta)
      }

      console.log(`Processed ${models.length} Groq models with dynamic configuration updates`)
      return models
    } catch (error) {
      console.error('Error fetching Groq models:', error)
      // Fallback to parent implementation
      return super.fetchOpenAIModels(options)
    }
  }
}
