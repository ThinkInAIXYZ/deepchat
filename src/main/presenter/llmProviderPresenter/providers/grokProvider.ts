import { LLM_PROVIDER, LLMResponse, ChatMessage, IConfigPresenter } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { ModelConfig, MCPToolDefinition, LLMCoreStreamEvent } from '@shared/presenter'

export class GrokProvider extends OpenAICompatibleProvider {
  // Image generation model ID
  private static readonly IMAGE_MODEL_ID = 'grok-2-image'
  // private static readonly IMAGE_ENDPOINT = '/images/generations'

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }

  // Check if it's an image model
  private isImageModel(modelId: string): boolean {
    return modelId.startsWith(GrokProvider.IMAGE_MODEL_ID)
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
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
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
    } else {
      yield* super.coreStream(messages, modelId, modelConfig, temperature, maxTokens, tools)
    }
  }
}
