import { embedMany, generateId, generateImage, generateText, streamText } from 'ai'
import type {
  ChatMessage,
  IConfigPresenter,
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  LLMResponse,
  MCPToolDefinition,
  ModelConfig
} from '@shared/presenter'
import { ApiEndpointType } from '@shared/model'
import { presenter } from '@/presenter'
import { EMBEDDING_TEST_KEY, isNormalized } from '@/utils/vector'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import { mcpToolsToAISDKTools } from './toolMapper'
import { mapMessagesToModelMessages } from './messageMapper'
import { buildProviderOptions } from './providerOptionsMapper'
import { type AiSdkProviderKind, createAiSdkProviderContext } from './providerFactory'
import { adaptAiSdkStream } from './streamAdapter'

export interface AiSdkRuntimeContext {
  providerKind: AiSdkProviderKind
  provider: LLM_PROVIDER
  configPresenter: IConfigPresenter
  defaultHeaders: Record<string, string>
  buildLegacyFunctionCallPrompt?: (tools: MCPToolDefinition[]) => string
  emitRequestTrace?: (
    modelConfig: ModelConfig,
    payload: {
      endpoint: string
      headers?: Record<string, string>
      body?: unknown
    }
  ) => Promise<void>
  cleanHeaders?: boolean
  supportsNativeTools?: (modelId: string, modelConfig: ModelConfig) => boolean
  shouldUseImageGeneration?: (modelId: string, modelConfig: ModelConfig) => boolean
}

function normalizePromptValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
          return item.text
        }

        return ''
      })
      .filter((item) => item.trim().length > 0)
      .join('\n')
  }

  if (value && typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text
    }

    const stringified = String(value)
    return stringified === '[object Object]' ? '' : stringified
  }

  return ''
}

function extractImagePrompt(messages: ChatMessage[]): string {
  return messages
    .map((message) => (message.role === 'user' ? normalizePromptValue(message.content) : ''))
    .filter((content) => content.trim().length > 0)
    .join('\n\n')
}

function resolveSupportsNativeTools(
  context: AiSdkRuntimeContext,
  modelId: string,
  modelConfig: ModelConfig
): boolean {
  if (context.supportsNativeTools) {
    return context.supportsNativeTools(modelId, modelConfig)
  }

  return modelConfig.functionCall === true
}

function shouldUseImageGenerationRuntime(
  context: AiSdkRuntimeContext,
  modelId: string,
  modelConfig: ModelConfig
): boolean {
  if (context.shouldUseImageGeneration) {
    return context.shouldUseImageGeneration(modelId, modelConfig)
  }

  return modelConfig.apiEndpoint === ApiEndpointType.Image
}

async function buildPromptRuntime(
  context: AiSdkRuntimeContext,
  messages: ChatMessage[],
  modelId: string,
  modelConfig: ModelConfig,
  tools: MCPToolDefinition[]
) {
  const supportsNativeTools = resolveSupportsNativeTools(context, modelId, modelConfig)
  const providerContext = createAiSdkProviderContext({
    providerKind: context.providerKind,
    provider: context.provider,
    configPresenter: context.configPresenter,
    defaultHeaders: context.defaultHeaders,
    modelId,
    cleanHeaders: context.cleanHeaders
  })
  const mappedMessages = mapMessagesToModelMessages(messages, {
    tools,
    supportsNativeTools,
    buildLegacyFunctionCallPrompt: context.buildLegacyFunctionCallPrompt
  })
  const toolsMap = supportsNativeTools ? mcpToolsToAISDKTools(tools) : {}
  const providerOptionResult = buildProviderOptions({
    providerId: context.provider.id,
    providerOptionsKey: providerContext.providerOptionsKey,
    apiType: providerContext.apiType,
    modelId,
    modelConfig,
    tools,
    messages: mappedMessages
  })

  return {
    providerContext,
    messages: providerOptionResult.messages,
    providerOptions: providerOptionResult.providerOptions,
    tools: toolsMap,
    supportsNativeTools
  }
}

function usageToLlmResponse(
  usage:
    | {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
      }
    | undefined
): LLMResponse['totalUsage'] | undefined {
  if (!usage) {
    return undefined
  }

  return {
    prompt_tokens: usage.inputTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  }
}

export async function runAiSdkGenerateText(
  context: AiSdkRuntimeContext,
  messages: ChatMessage[],
  modelId: string,
  modelConfig: ModelConfig,
  temperature?: number,
  maxTokens?: number
): Promise<LLMResponse> {
  const runtime = await buildPromptRuntime(context, messages, modelId, modelConfig, [])

  await context.emitRequestTrace?.(modelConfig, {
    endpoint: runtime.providerContext.endpoint,
    headers: context.defaultHeaders,
    body: {
      model: modelId,
      maxOutputTokens: maxTokens,
      temperature
    }
  })

  const result = await generateText({
    model: runtime.providerContext.model,
    messages: runtime.messages,
    providerOptions: runtime.providerOptions as any,
    temperature,
    maxOutputTokens: maxTokens
  })

  return {
    content: result.text,
    reasoning_content: result.reasoningText,
    totalUsage: usageToLlmResponse(result.totalUsage)
  }
}

export async function* runAiSdkCoreStream(
  context: AiSdkRuntimeContext,
  messages: ChatMessage[],
  modelId: string,
  modelConfig: ModelConfig,
  temperature: number,
  maxTokens: number,
  tools: MCPToolDefinition[]
): AsyncGenerator<LLMCoreStreamEvent> {
  if (shouldUseImageGenerationRuntime(context, modelId, modelConfig)) {
    const prompt = extractImagePrompt(messages)

    const providerContext = createAiSdkProviderContext({
      providerKind: context.providerKind,
      provider: context.provider,
      configPresenter: context.configPresenter,
      defaultHeaders: context.defaultHeaders,
      modelId,
      cleanHeaders: context.cleanHeaders
    })

    if (!providerContext.imageModel) {
      throw new Error(`Image generation is not supported by provider ${context.provider.id}`)
    }

    await context.emitRequestTrace?.(modelConfig, {
      endpoint: providerContext.endpoint,
      headers: context.defaultHeaders,
      body: {
        model: modelId,
        prompt
      }
    })

    const result = await generateImage({
      model: providerContext.imageModel,
      prompt
    })

    for (const image of result.images) {
      const dataUrl = `data:${image.mediaType};base64,${image.base64}`
      const cachedImage = await presenter.devicePresenter.cacheImage(dataUrl)
      yield {
        type: 'image_data',
        image_data: {
          data: cachedImage,
          mimeType: image.mediaType
        }
      }
    }

    yield {
      type: 'stop',
      stop_reason: 'complete'
    }
    return
  }

  const runtime = await buildPromptRuntime(context, messages, modelId, modelConfig, tools)

  await context.emitRequestTrace?.(modelConfig, {
    endpoint: runtime.providerContext.endpoint,
    headers: context.defaultHeaders,
    body: {
      model: modelId,
      maxOutputTokens: maxTokens,
      temperature,
      tools: tools.map((tool) => tool.function.name)
    }
  })

  const result = streamText({
    model: runtime.providerContext.model,
    messages: runtime.messages,
    tools: runtime.tools,
    providerOptions: runtime.providerOptions as any,
    temperature,
    maxOutputTokens: maxTokens
  })

  yield* adaptAiSdkStream(result.fullStream, {
    supportsNativeTools: runtime.supportsNativeTools,
    cacheImage: (data) => presenter.devicePresenter.cacheImage(data)
  })
}

export async function runAiSdkEmbeddings(
  context: AiSdkRuntimeContext,
  modelId: string,
  texts: string[]
): Promise<number[][]> {
  const providerContext = createAiSdkProviderContext({
    providerKind: context.providerKind,
    provider: context.provider,
    configPresenter: context.configPresenter,
    defaultHeaders: context.defaultHeaders,
    modelId,
    cleanHeaders: context.cleanHeaders,
    wrapThinkReasoning: false
  })

  if (!providerContext.embeddingModel) {
    throw new Error(`embedding is not supported by provider ${context.provider.id}`)
  }

  const result = await embedMany({
    model: providerContext.embeddingModel,
    values: texts
  })

  return result.embeddings
}

export async function runAiSdkDimensions(
  context: AiSdkRuntimeContext,
  modelId: string
): Promise<LLM_EMBEDDING_ATTRS> {
  const embeddings = await runAiSdkEmbeddings(context, modelId, [
    EMBEDDING_TEST_KEY || generateId()
  ])
  return {
    dimensions: embeddings[0].length,
    normalized: isNormalized(embeddings[0])
  }
}
