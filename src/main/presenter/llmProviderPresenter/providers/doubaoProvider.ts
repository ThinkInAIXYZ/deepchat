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
import { ModelType } from '@shared/model'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { providerDbLoader } from '../../configPresenter/providerDbLoader'
import { modelCapabilities } from '../../configPresenter/modelCapabilities'
import { createStreamEvent } from '@shared/types/core/llm-events'
import { mediaCache } from '@/utils/mediaCache'

interface VolcanoImageGenerationParams {
  model: string
  prompt: string
  size?: string
  response_format: string
  sequential_image_generation: string
  watermark?: boolean
}

interface VolcanoVideoTaskRequest {
  model: string
  content: Array<{ type: string; text?: string; image_url?: { url: string } }>
}

interface VolcanoVideoTaskResponse {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  created_at?: number
  updated_at?: number
  model?: string
  video_url?: string
  cover_url?: string
  duration?: number
  error?: {
    message: string
  }
}

interface VolcanoImageGenerationResponse {
  model: string
  data: Array<{ url: string; size?: string }>
  usage?: {
    generated_images?: number
    output_tokens?: number
  }
}

export class DoubaoProvider extends OpenAICompatibleProvider {
  // List of models that support thinking parameter
  private static readonly THINKING_MODELS: string[] = [
    'deepseek-v3-1-250821',
    'doubao-seed-1-6-vision-250815',
    'doubao-seed-1-6-250615',
    'doubao-seed-1-6-flash-250615',
    'doubao-1-5-thinking-vision-pro-250428',
    'doubao-1-5-ui-tars-250428',
    'doubao-1-5-thinking-pro-m-250428'
  ]

  // Video generation polling configuration
  // Progressive polling: fast polling for first 60s (30 attempts at 2s), then slower for long-running tasks
  // Maximum ~4 hours of polling (14400s) for 48h video generation tasks
  private static readonly MAX_POLL_ATTEMPTS = 720 // 60 (2s interval) + 660 (20s interval) = ~4 hours
  private static readonly FAST_POLL_ATTEMPTS = 30 // First 60 seconds
  private static readonly FAST_POLL_INTERVAL_MS = 2000 // 2 seconds
  private static readonly SLOW_POLL_INTERVAL_MS = 20000 // 20 seconds for longer tasks

  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    // Initialize Doubao model configuration
    super(provider, configPresenter)
  }

  private supportsThinking(modelId: string): boolean {
    return DoubaoProvider.THINKING_MODELS.includes(modelId)
  }

  private getModelType(modelId: string): ModelType {
    if (/seedance/i.test(modelId)) return ModelType.VideoGeneration
    if (/seedream/i.test(modelId)) return ModelType.ImageGeneration
    if (/embedding/i.test(modelId)) return ModelType.Embedding
    return ModelType.Chat
  }

  /**
   * Override coreStream method to support Doubao's multi-modal capabilities
   * Routes to different handlers based on model type
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

    const modelType = this.getModelType(modelId)

    switch (modelType) {
      case ModelType.ImageGeneration:
        yield* this.handleImageGeneration(messages, modelId, modelConfig)
        return

      case ModelType.VideoGeneration:
        yield* this.handleVideoGeneration(messages, modelId, modelConfig)
        return

      default:
        // Chat (including vision, reasoning)
        yield* this.handleChatStream(
          messages,
          modelId,
          modelConfig,
          temperature,
          maxTokens,
          mcpTools
        )
    }
  }

  /**
   * Handle chat stream with thinking parameter support
   */
  private async *handleChatStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const shouldAddThinking = this.supportsThinking(modelId) && modelConfig?.reasoning

    if (shouldAddThinking) {
      // Original create method
      const originalCreate = this.openai.chat.completions.create.bind(this.openai.chat.completions)
      // Replace create method to add thinking parameter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.openai.chat.completions.create = ((params: any, options?: any) => {
        params.thinking = {
          type: 'enabled'
        }
        return originalCreate(params, options)
      }) as typeof originalCreate

      try {
        const effectiveModelConfig = { ...modelConfig, reasoning: false }
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

  protected async fetchOpenAIModels(): Promise<MODEL_META[]> {
    const resolvedId = modelCapabilities.resolveProviderId(this.provider.id) || this.provider.id
    const provider = providerDbLoader.getProvider(resolvedId)
    if (!provider || !Array.isArray(provider.models)) {
      return []
    }

    return provider.models.map((model) => {
      const inputs = model.modalities?.input
      const outputs = model.modalities?.output
      const hasImageInput = Array.isArray(inputs) && inputs.includes('image')
      const hasImageOutput = Array.isArray(outputs) && outputs.includes('image')
      const modelType = hasImageOutput ? ModelType.ImageGeneration : ModelType.Chat

      return {
        id: model.id,
        name: model.display_name || model.name || model.id,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: model.limit?.context ?? 8192,
        maxTokens: model.limit?.output ?? 4096,
        vision: hasImageInput,
        functionCall: Boolean(model.tool_call),
        reasoning: Boolean(model.reasoning?.supported),
        enableSearch: Boolean(model.search?.supported),
        type: modelType
      }
    })
  }

  /**
   * Handle image generation using Volcano API
   */
  private async *handleImageGeneration(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const prompt = this.extractLastText(messages)

    if (!prompt) {
      yield createStreamEvent.error('Could not extract prompt for image generation')
      yield createStreamEvent.stop('error')
      return
    }

    try {
      // Convert OpenAI size format to Volcano format
      const volcanoParams: VolcanoImageGenerationParams = {
        model: modelId,
        prompt,
        size: this.convertSize(modelConfig.size),
        response_format: 'url',
        sequential_image_generation: 'disabled',
        watermark: modelConfig.watermark ?? false
      }

      const result = await this.fetchVolcano<VolcanoImageGenerationResponse>(
        '/images/generations',
        volcanoParams
      )

      if (result.data && result.data[0]?.url) {
        // Download and cache image
        const localUrl = await mediaCache.saveImage(result.data[0].url)
        yield createStreamEvent.imageData({ data: localUrl, mimeType: 'deepchat/image-url' })
        yield createStreamEvent.stop('complete')
      } else {
        yield createStreamEvent.error('No image data received from API')
        yield createStreamEvent.stop('error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      yield createStreamEvent.error(`Image generation failed: ${errorMessage}`)
      yield createStreamEvent.stop('error')
    }
  }

  /**
   * Handle video generation using Volcano API
   * Strategy: Return pending block immediately, poll in background, emit progress events
   */
  private async *handleVideoGeneration(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const textPrompt = this.extractLastText(messages)
    const imageUrl = this.extractLastImage(messages)

    if (!textPrompt) {
      yield createStreamEvent.error('Could not extract prompt for video generation')
      yield createStreamEvent.stop('error')
      return
    }

    try {
      // Build full prompt with parameters
      const fullPrompt = [
        textPrompt,
        `--resolution ${modelConfig.resolution || '1080p'}`,
        `--duration ${modelConfig.duration || 5}`,
        `--camerafixed ${modelConfig.cameraFixed ?? false}`,
        `--watermark ${modelConfig.watermark ?? false}`
      ].join(' ')

      const content: VolcanoVideoTaskRequest['content'] = [{ type: 'text', text: fullPrompt }]
      if (imageUrl) {
        content.push({ type: 'image_url', image_url: { url: imageUrl } })
      }

      const requestBody: VolcanoVideoTaskRequest = {
        model: modelId,
        content
      }

      const response = await this.fetchVolcano<VolcanoVideoTaskResponse>(
        '/contents/generations/tasks',
        requestBody
      )

      if (response.id) {
        // Step 1: Emit pending block immediately (backend will persist it)
        yield createStreamEvent.mediaGenerationPending({
          taskId: response.id,
          mediaType: 'video',
          status: 'queued',
          message: 'Video generation task submitted',
          pollCount: 0,
          maxPolls: DoubaoProvider.MAX_POLL_ATTEMPTS,
          canManualRefresh: true
        })

        // Step 2: Continue polling in background and emit progress events
        yield* this.pollVideoTask(response.id)
      } else {
        yield createStreamEvent.error('Failed to create video generation task')
        yield createStreamEvent.stop('error')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      yield createStreamEvent.error(`Video generation failed: ${errorMessage}`)
      yield createStreamEvent.stop('error')
    }
  }

  /**
   * Poll video generation task status
   * Emits progress events and completes with media_generation_complete
   */
  private async *pollVideoTask(taskId: string): AsyncGenerator<LLMCoreStreamEvent> {
    for (let i = 0; i < DoubaoProvider.MAX_POLL_ATTEMPTS; i++) {
      try {
        const status = await this.fetchVolcano<VolcanoVideoTaskResponse>(
          `/contents/generations/tasks/${taskId}`,
          undefined,
          'GET'
        )

        const progressMessage = this.getVideoProgressMessage(status.status, i)

        switch (status.status) {
          case 'queued':
          case 'processing':
            // Emit progress update (LLMEventHandler will broadcast and update UI)
            yield createStreamEvent.mediaGenerationProgress({
              taskId,
              mediaType: 'video',
              status: status.status,
              message: progressMessage,
              pollCount: i + 1,
              maxPolls: DoubaoProvider.MAX_POLL_ATTEMPTS,
              canManualRefresh: true
            })
            break

          case 'completed':
            if (status.video_url) {
              const localUrl = await mediaCache.saveVideo(status.video_url)
              // Emit completion event with result
              yield createStreamEvent.mediaGenerationComplete({
                taskId,
                mediaType: 'video',
                url: localUrl,
                cover: status.cover_url,
                duration: status.duration
              })
              yield createStreamEvent.stop('complete')
            } else {
              yield createStreamEvent.mediaGenerationComplete({
                taskId,
                mediaType: 'video',
                error: 'Video completed but no URL received'
              })
              yield createStreamEvent.stop('error')
            }
            return

          case 'failed':
            yield createStreamEvent.mediaGenerationComplete({
              taskId,
              mediaType: 'video',
              error: status.error?.message || 'Video generation failed'
            })
            yield createStreamEvent.stop('error')
            return
        }
      } catch (error) {
        yield createStreamEvent.mediaGenerationComplete({
          taskId,
          mediaType: 'video',
          error: `Error polling task: ${String(error)}`
        })
        yield createStreamEvent.stop('error')
        return
      }

      // Progressive polling: fast for first 60s, then slower for long tasks
      const pollInterval =
        i < DoubaoProvider.FAST_POLL_ATTEMPTS
          ? DoubaoProvider.FAST_POLL_INTERVAL_MS
          : DoubaoProvider.SLOW_POLL_INTERVAL_MS

      await this.sleep(pollInterval)
    }

    // Timeout: emit completion with error but allow manual refresh
    yield createStreamEvent.mediaGenerationComplete({
      taskId,
      mediaType: 'video',
      error:
        'Video generation timeout - the task is still processing. You can check the status later.'
    })
    yield createStreamEvent.stop('error')
  }

  /**
   * Get human-readable progress message for video generation
   */
  private getVideoProgressMessage(status: string, pollCount: number): string {
    const elapsedMinutes = Math.floor((pollCount * 2) / 60)

    switch (status) {
      case 'queued':
        return elapsedMinutes > 0
          ? `Queued for ${elapsedMinutes} minute${elapsedMinutes > 1 ? 's' : ''}...`
          : 'Waiting in queue...'
      case 'processing':
        return elapsedMinutes > 0
          ? `Processing for ${elapsedMinutes} minute${elapsedMinutes > 1 ? 's' : ''}...`
          : 'Processing video...'
      default:
        return 'Processing...'
    }
  }

  /**
   * Fetch Volcano API
   */
  private async fetchVolcano<T>(
    endpoint: string,
    body?: unknown,
    method: 'GET' | 'POST' = 'POST'
  ): Promise<T> {
    const url = `${this.provider.baseUrl}${endpoint}`

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.provider.apiKey}`,
        'Content-Type': 'application/json'
      }
    }

    if (body && method === 'POST') {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(url, options)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Volcano API ${response.status}: ${errorText}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Convert OpenAI size format to Volcano format
   */
  private convertSize(openaiSize?: string): string {
    const sizeMap: Record<string, string> = {
      '1024x1024': '1K',
      '2048x2048': '2K'
    }
    return sizeMap[openaiSize || ''] || '2K'
  }

  /**
   * Extract last text content from messages
   */
  private extractLastText(messages: ChatMessage[]): string {
    const lastUserMessage = messages.findLast((m) => m.role === 'user')
    if (!lastUserMessage?.content) return ''

    if (typeof lastUserMessage.content === 'string') {
      return lastUserMessage.content
    }

    if (Array.isArray(lastUserMessage.content)) {
      const textParts = lastUserMessage.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
      return textParts.join('\n')
    }

    return ''
  }

  /**
   * Extract last image URL from messages
   */
  private extractLastImage(messages: ChatMessage[]): string | undefined {
    const lastUserMessage = messages.findLast((m) => m.role === 'user')
    if (!lastUserMessage?.content || typeof lastUserMessage.content === 'string') return undefined

    if (Array.isArray(lastUserMessage.content)) {
      const imagePart = lastUserMessage.content.find((part) => part.type === 'image_url')
      return imagePart?.image_url?.url
    }

    return undefined
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
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
}
