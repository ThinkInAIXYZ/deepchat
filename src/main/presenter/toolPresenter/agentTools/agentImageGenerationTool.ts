import { z } from 'zod'
import { toDeepChatJsonSchema } from '@shared/lib/zodJsonSchema'
import type { IConfigPresenter, MCPToolDefinition } from '@shared/presenter'
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
import type { AgentToolRuntimePort } from '../runtimePorts'

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
      configPresenter: IConfigPresenter
      runtimePort: AgentToolRuntimePort
    }
  ) {}

  async canUse(conversationId?: string): Promise<boolean> {
    if (!conversationId) {
      return true
    }

    return Boolean(await this.resolveImageGenerationModel(conversationId))
  }

  getToolDefinition(): MCPToolDefinition {
    return {
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
    options?: { signal?: AbortSignal }
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

    try {
      const result = await this.options.runtimePort
        .getLlmProviderPresenter()
        .generateImageStandalone(
          model.providerId,
          parsed.data.prompt,
          model.modelId,
          imageOptions,
          { signal: options?.signal }
        )
      const imagePreviews = result.images.map<ToolCallImagePreview>((image, index) => ({
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

  private async resolveImageGenerationModel(
    conversationId?: string
  ): Promise<ImageGenerationModelSelection | null> {
    if (!conversationId) {
      return null
    }

    try {
      const session = await this.options.runtimePort.resolveConversationSessionInfo(conversationId)
      if (!session || session.agentType !== 'deepchat') {
        return null
      }

      const config = await this.options.configPresenter.resolveDeepChatAgentConfig(session.agentId)
      const providerId = config.imageGenerationModel?.providerId?.trim()
      const modelId = config.imageGenerationModel?.modelId?.trim()
      if (!providerId || !modelId) {
        return null
      }

      if (!this.isSupportedImageGenerationModel(providerId, modelId)) {
        logger.warn('[AgentImageGenerationTool] Configured model is not an image model', {
          providerId,
          modelId,
          conversationId
        })
        return null
      }

      return { providerId, modelId }
    } catch (error) {
      logger.warn('[AgentImageGenerationTool] Failed to resolve image generation model', {
        conversationId,
        error
      })
      return null
    }
  }

  private isSupportedImageGenerationModel(providerId: string, modelId: string): boolean {
    try {
      const modelConfig = this.options.configPresenter.getModelConfig(modelId, providerId)
      return (
        modelConfig.type === ModelType.ImageGeneration ||
        modelConfig.apiEndpoint === ApiEndpointType.Image ||
        modelConfig.endpointType === 'image-generation'
      )
    } catch (error) {
      logger.warn('[AgentImageGenerationTool] Failed to inspect image generation model config', {
        providerId,
        modelId,
        error
      })
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
