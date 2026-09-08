import type { ProviderSettingsPort } from '@/provider/settings'
import { z } from 'zod'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import type { ToolCallImagePreview } from '@shared/types/core/mcp'
import type { ImageGenerationOptions } from '@shared/imageGenerationSettings'
import {
  IMAGE_GENERATION_MODERATION_VALUES,
  IMAGE_GENERATION_OUTPUT_FORMAT_VALUES,
  IMAGE_GENERATION_QUALITY_VALUES,
  OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES,
  isValidOpenAIImageGenerationSize,
  normalizeImageGenerationOptions
} from '@shared/imageGenerationSettings'
import { ApiEndpointType, ModelType } from '@shared/model'
import {
  createAgentToolErrorResult,
  createAgentToolSuccessResult
} from '@shared/lib/agentToolResultEnvelope'
import {
  IMAGE_GENERATE_TOOL_NAME,
  IMAGE_GENERATION_TOOL_SERVER_NAME
} from '@shared/agentImageGenerationTool'
import logger from '@shared/logger'
import type { CacheImageCallback } from '@/lib/toolCallImagePreviews'
import type { AgentProviderToolPort, AgentToolSessionPort } from '../runtimePorts'
import type { AgentSettingsPort } from '@/agent/settings'

export { IMAGE_GENERATE_TOOL_NAME, IMAGE_GENERATION_TOOL_SERVER_NAME }

const imageGenerateSchema = z.strictObject({
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(8000)
    .describe('Detailed text prompt for the image to generate.'),
  size: z
    .string()
    .trim()
    .refine((value) => !value || isValidOpenAIImageGenerationSize(value), {
      message: 'size must be a valid WIDTHxHEIGHT image generation size'
    })
    .optional()
    .describe('Optional output size, such as 1024x1024, 1536x1024, or 1024x1536.'),
  quality: z
    .enum(IMAGE_GENERATION_QUALITY_VALUES)
    .optional()
    .describe('Optional quality hint when the selected image model supports it.'),
  outputFormat: z
    .enum(IMAGE_GENERATION_OUTPUT_FORMAT_VALUES)
    .optional()
    .describe('Optional output format hint when the selected image model supports it.'),
  background: z
    .enum(OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES)
    .optional()
    .describe('Optional background hint when the selected image model supports it.'),
  moderation: z
    .enum(IMAGE_GENERATION_MODERATION_VALUES)
    .optional()
    .describe('Optional moderation hint when the selected image model supports it.')
})

type ImageGenerateInput = z.infer<typeof imageGenerateSchema>
type ImageGenerationModelSelection = {
  providerId: string
  modelId: string
}

// Inline base64 payloads below this size are allowed to pass through uncached; anything larger
// that could not be written to the image cache fails the tool call instead of flowing multi-MB
// strings through message persistence, IPC and the renderer. The limit applies to the encoded
// base64 character length of the payload (not its decoded byte size).
const MAX_INLINE_IMAGE_BASE64_CHARS = 2 * 1024 * 1024

const estimateBase64PayloadChars = (dataUrl: string): number => {
  const commaIndex = dataUrl.indexOf(',')
  return commaIndex === -1 ? dataUrl.length : dataUrl.length - commaIndex - 1
}

type AgentImageGenerationToolCallResult = {
  content: string
  rawData: {
    content: string
    isError: boolean
    toolResult: unknown
    imagePreviews?: ToolCallImagePreview[]
  }
}

export class AgentImageGenerationTool {
  constructor(
    private readonly options: {
      providerSettings: Pick<ProviderSettingsPort, 'getModelConfig'>
      agentSettings: Pick<AgentSettingsPort, 'resolveDeepChatAgentConfig'>
      sessions: AgentToolSessionPort
      provider: AgentProviderToolPort
      cacheImage?: CacheImageCallback
    }
  ) {}

  async canUse(
    conversationId?: string,
    options: { strict?: boolean; reportDiagnostics?: boolean } = {}
  ): Promise<boolean> {
    if (!conversationId) {
      return true
    }

    return Boolean(await this.resolveImageGenerationModel(conversationId, options))
  }

  getToolDefinition(): MCPToolDefinition {
    return {
      execution: TOOL_EXECUTION.write,
      type: 'function',
      function: {
        name: IMAGE_GENERATE_TOOL_NAME,
        description:
          'Generate a new image from a text prompt using the DeepChat Agent configured image generation model. Use this when the user asks to create, draw, render, or generate an image. The generated image is returned as a DeepChat image preview, not as text.',
        parameters: toDeepChatJsonSchema(imageGenerateSchema) as {
          type: string
          properties: Record<string, unknown>
          required?: string[]
        }
      },
      server: {
        name: IMAGE_GENERATION_TOOL_SERVER_NAME,
        icons: '🖼️',
        description: 'Agent image generation tools'
      }
    }
  }

  async call(
    args: Record<string, unknown>,
    conversationId?: string,
    options?: {
      signal?: AbortSignal
      beforeGenerate?: (normalizedArguments: Record<string, unknown>) => void
    }
  ): Promise<AgentImageGenerationToolCallResult> {
    const parsed = imageGenerateSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid arguments for ${IMAGE_GENERATE_TOOL_NAME}: ${parsed.error.message}`)
    }

    const model = await this.resolveImageGenerationModel(conversationId)
    if (!model) {
      return this.buildErrorResult(
        'IMAGE_GENERATION_MODEL_UNAVAILABLE',
        'No available image generation model is configured for this DeepChat Agent.',
        parsed.data
      )
    }

    const imageOptions = this.toImageGenerationOptions(parsed.data)
    options?.signal?.throwIfAborted()
    options?.beforeGenerate?.({
      ...parsed.data,
      providerId: model.providerId,
      modelId: model.modelId
    })

    try {
      const result = await this.options.provider.generateImageStandalone(
        model.providerId,
        parsed.data.prompt,
        model.modelId,
        imageOptions,
        { signal: options?.signal }
      )
      const images = await Promise.all(
        result.images.map(async (image) => ({
          mimeType: image.mimeType,
          data: await this.cacheGeneratedImageData(image.data, image.mimeType, options?.signal)
        }))
      )
      const imagePreviews = images.map<ToolCallImagePreview>((image, index) => ({
        id: `generated-image-${index + 1}`,
        data: image.data,
        mimeType: image.mimeType,
        title: `Generated image ${index + 1}`,
        source: 'tool_output'
      }))
      const metadataImages = imagePreviews.map(({ id, mimeType, title, source }) => ({
        id,
        mimeType,
        title,
        source
      }))
      const output = {
        ok: true,
        prompt: parsed.data.prompt,
        model,
        settings: result.options ?? imageOptions ?? {},
        imageCount: imagePreviews.length,
        images: metadataImages
      }
      const content = JSON.stringify(output, null, 2)

      return {
        content,
        rawData: {
          content,
          isError: false,
          imagePreviews,
          toolResult: createAgentToolSuccessResult(IMAGE_GENERATE_TOOL_NAME, content, {
            summary: `Generated ${imagePreviews.length} image${imagePreviews.length === 1 ? '' : 's'}.`,
            data: output
          })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.buildErrorResult('IMAGE_GENERATION_FAILED', message, parsed.data, model)
    }
  }

  private async cacheGeneratedImageData(
    data: string,
    mimeType: string,
    signal?: AbortSignal
  ): Promise<string> {
    const trimmed = data.trim()
    if (trimmed.toLowerCase().startsWith('imgcache://')) {
      return trimmed
    }

    const source =
      trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `data:${mimeType || 'image/png'};base64,${trimmed}`

    let resolved = source
    if (this.options.cacheImage) {
      try {
        // Provider-returned HTTP(S) URLs are cached with private-network access disabled and the
        // tool-call abort signal forwarded, so cancellation cannot leave an unmanaged download
        // running. `allowPrivateNetwork: false` is passed unconditionally so an omitted signal
        // cannot re-enable private-network access.
        resolved = await this.options.cacheImage(source, {
          signal,
          allowPrivateNetwork: false
        })
      } catch (error) {
        if (signal?.aborted) throw error
        logger.warn('[AgentImageGenerationTool] Failed to cache generated image', { error })
      }
    }
    signal?.throwIfAborted()

    // A provider-returned HTTP(S) URL that could not be written to the cache must not flow through
    // the tool-result pipeline as an unmanaged remote reference; fail the call instead so the
    // agent can surface a recoverable error.
    if (/^https?:\/\//i.test(resolved)) {
      throw new Error('Generated image URL could not be written to the image cache.')
    }

    if (
      resolved.startsWith('data:') &&
      estimateBase64PayloadChars(resolved) > MAX_INLINE_IMAGE_BASE64_CHARS
    ) {
      throw new Error(
        'Generated image could not be written to the image cache and is too large to return inline.'
      )
    }
    return resolved
  }

  private async resolveImageGenerationModel(
    conversationId?: string,
    options: { strict?: boolean; reportDiagnostics?: boolean } = {}
  ): Promise<ImageGenerationModelSelection | null> {
    if (!conversationId) {
      return null
    }

    try {
      const session = await this.options.sessions.resolveConversationSessionInfo(conversationId)
      if (!session || session.agentType !== 'deepchat') {
        return null
      }

      const config = await this.options.agentSettings.resolveDeepChatAgentConfig(session.agentId)
      const providerId = config.imageGenerationModel?.providerId?.trim()
      const modelId = config.imageGenerationModel?.modelId?.trim()
      if (!providerId || !modelId) {
        return null
      }

      if (!this.isSupportedImageGenerationModel(providerId, modelId, options)) {
        if (options.reportDiagnostics !== false) {
          logger.warn('[AgentImageGenerationTool] Configured model is not an image model', {
            providerId,
            modelId,
            conversationId
          })
        }
        return null
      }

      return { providerId, modelId }
    } catch (error) {
      if (options.strict) throw error
      if (options.reportDiagnostics !== false) {
        logger.warn('[AgentImageGenerationTool] Failed to resolve image generation model', {
          conversationId,
          error
        })
      }
      return null
    }
  }

  private isSupportedImageGenerationModel(
    providerId: string,
    modelId: string,
    options: { strict?: boolean; reportDiagnostics?: boolean } = {}
  ): boolean {
    try {
      const modelConfig = this.options.providerSettings.getModelConfig(modelId, providerId)
      return (
        modelConfig.type === ModelType.ImageGeneration ||
        modelConfig.apiEndpoint === ApiEndpointType.Image ||
        modelConfig.endpointType === 'image-generation'
      )
    } catch (error) {
      if (options.strict) throw error
      if (options.reportDiagnostics !== false) {
        logger.warn('[AgentImageGenerationTool] Failed to inspect image generation model config', {
          providerId,
          modelId,
          error
        })
      }
      return false
    }
  }

  private toImageGenerationOptions(input: ImageGenerateInput): ImageGenerationOptions | undefined {
    return normalizeImageGenerationOptions({
      size: input.size,
      quality: input.quality,
      outputFormat: input.outputFormat,
      background: input.background,
      moderation: input.moderation
    })
  }

  private buildErrorResult(
    code: string,
    message: string,
    input: ImageGenerateInput,
    model?: ImageGenerationModelSelection
  ): AgentImageGenerationToolCallResult {
    const output = {
      ok: false,
      error: {
        code,
        message,
        recoverable: true
      },
      prompt: input.prompt,
      ...(model ? { model } : {})
    }
    const content = JSON.stringify(output, null, 2)

    return {
      content,
      rawData: {
        content,
        isError: true,
        toolResult: createAgentToolErrorResult(IMAGE_GENERATE_TOOL_NAME, message, {
          code,
          recoverable: true,
          data: output
        })
      }
    }
  }
}
