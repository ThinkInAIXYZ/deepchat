import { LLM_PROVIDER, LLMResponse, ChatMessage, IConfigPresenter } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { ModelConfig, MCPToolDefinition, LLMCoreStreamEvent } from '@shared/presenter'

export class GrokProvider extends OpenAICompatibleProvider {
  // Image generation model ID
  private static readonly IMAGE_MODEL_ID = 'grok-2-image'
  // private static readonly IMAGE_ENDPOINT = '/images/generations'

  // Reasoning models that support reasoning_content
  private static readonly REASONING_MODELS: string[] = ['grok-4', 'grok-3-mini', 'grok-3-mini-fast']

  // Models that support reasoning_effort parameter (grok-4 does not)
  private static readonly REASONING_EFFORT_MODELS: string[] = ['grok-3-mini', 'grok-3-mini-fast']

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  // Check if it's an image model
  private isImageModel(modelId: string): boolean {
    return modelId.startsWith(GrokProvider.IMAGE_MODEL_ID)
  }

  // Check if model supports reasoning
  private isReasoningModel(modelId: string): boolean {
    return GrokProvider.REASONING_MODELS.some((model) =>
      modelId.toLowerCase().includes(model.toLowerCase())
    )
  }

  // Check if model supports reasoning_effort parameter
  private supportsReasoningEffort(modelId: string): boolean {
    return GrokProvider.REASONING_EFFORT_MODELS.some((model) =>
      modelId.toLowerCase().includes(model.toLowerCase())
    )
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    // Image generation models require special handling
    if (this.isImageModel(modelId)) {
      return this.handleImageGeneration(messages)
    }
    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    // Image generation models do not support summaries
    if (this.isImageModel(modelId)) {
      throw new Error('Image generation model does not support summaries')
    }
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
    // Image generation models use special handling
    if (this.isImageModel(modelId)) {
      return this.handleImageGeneration([{ role: 'user', content: prompt }])
    }
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

  // Special method for handling image generation requests
  private async handleImageGeneration(
    messages: ChatMessage[]
  ): Promise<LLMResponse & { imageData?: string; mimeType?: string }> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    // Extract prompt (use the last user message)
    const userMessage = messages.findLast((msg) => msg.role === 'user')
    if (!userMessage) {
      throw new Error('No user message found for image generation')
    }

    const prompt =
      typeof userMessage.content === 'string'
        ? userMessage.content
        : userMessage.content
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n') || ''

    // Create image generation request
    try {
      const response = await this.openai.images.generate({
        model: GrokProvider.IMAGE_MODEL_ID,
        prompt,
        response_format: 'b64_json'
      })
      // Handle response
      if (response.data && response.data.length > 0) {
        const imageData = response.data[0]
        if (imageData.b64_json) {
          // Return base64-encoded image data while preserving original data
          return {
            content: `![Generated Image](data:image/png;base64,${imageData.b64_json})`,
            imageData: imageData.b64_json,
            mimeType: 'image/png'
          }
        } else if (imageData.url) {
          // Return image URL
          return {
            content: `![Generated Image](${imageData.url})`
          }
        }
      }
      throw new Error('No image data received from API')
    } catch (error: unknown) {
      console.error('Image generation failed:', error)
      throw new Error(
        `Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

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

    // Handle image generation models
    if (this.isImageModel(modelId)) {
      const result = await this.handleImageGeneration(messages)
      // Use additional fields directly
      if (result.imageData && result.mimeType) {
        yield {
          type: 'image_data',
          image_data: {
            data: result.imageData,
            mimeType: result.mimeType
          }
        }
      } else {
        // If no imageData field, fallback to text format
        yield {
          type: 'text',
          content: result.content
        }
      }
      // Add brief delay to ensure all RESPONSE events are processed
      await new Promise((resolve) => setTimeout(resolve, 300))
      return
    }

    // Handle reasoning models
    if (this.isReasoningModel(modelId) && modelConfig?.reasoningEffort) {
      const originalCreate = this.openai.chat.completions.create.bind(this.openai.chat.completions)
      this.openai.chat.completions.create = ((params: any, options?: any) => {
        const modifiedParams = { ...params }

        if (this.supportsReasoningEffort(modelId)) {
          modifiedParams.reasoning_effort = modelConfig.reasoningEffort
        }

        return originalCreate(modifiedParams, options)
      }) as any

      try {
        const effectiveModelConfig = {
          ...modelConfig,
          reasoningEffort: undefined
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
}
