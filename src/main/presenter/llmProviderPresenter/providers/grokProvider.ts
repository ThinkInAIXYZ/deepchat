import {
  ChatMessage,
  IConfigPresenter,
  LLM_PROVIDER,
  LLMCoreStreamEvent,
  LLMResponse,
  MCPToolDefinition,
  ModelConfig
} from '@shared/presenter'
import { ApiEndpointType } from '@shared/model'
import type { AiSdkRuntimeContext } from '../aiSdk'
import type { ProviderMcpRuntimePort } from '../runtimePorts'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'

export class GrokProvider extends OpenAICompatibleProvider {
  private static readonly IMAGE_MODEL_ID = 'grok-2-image'

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
  }

  private isImageModel(modelId: string): boolean {
    return modelId.startsWith(GrokProvider.IMAGE_MODEL_ID)
  }

  protected override getAiSdkRuntimeContext(): AiSdkRuntimeContext {
    const context = super.getAiSdkRuntimeContext()
    return {
      ...context,
      shouldUseImageGeneration: (modelId, modelConfig) =>
        this.isImageModel(modelId) ||
        modelConfig.apiEndpoint === ApiEndpointType.Image ||
        context.shouldUseImageGeneration?.(modelId, modelConfig) === true
    }
  }

  private async collectImageCompletion(
    messages: ChatMessage[],
    modelId: string
  ): Promise<LLMResponse> {
    const response: LLMResponse = {
      content: ''
    }

    const imageModelConfig: ModelConfig = {
      ...(this.configPresenter.getModelConfig(modelId, this.provider.id) ?? {}),
      apiEndpoint: ApiEndpointType.Image
    }

    for await (const event of super.coreStream(
      messages,
      modelId,
      imageModelConfig,
      0.7,
      1024,
      []
    )) {
      switch (event.type) {
        case 'text':
          response.content += event.content
          break
        case 'reasoning':
          response.reasoning_content = `${response.reasoning_content ?? ''}${event.reasoning_content}`
          break
        case 'image_data':
          if (!response.content) {
            response.content = `![Generated Image](data:${event.image_data.mimeType};base64,${event.image_data.data})`
          }
          break
        case 'usage':
          response.totalUsage = event.usage
          break
        case 'error':
          throw new Error(event.error_message)
      }
    }

    return response
  }

  async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (this.isImageModel(modelId)) {
      return this.collectImageCompletion(messages, modelId)
    }

    return this.openAICompletion(messages, modelId, temperature, maxTokens)
  }

  async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (this.isImageModel(modelId)) {
      return this.collectImageCompletion([{ role: 'user', content: text }], modelId)
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
    if (this.isImageModel(modelId)) {
      return this.collectImageCompletion([{ role: 'user', content: prompt }], modelId)
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

  async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    mcpTools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }
    if (!modelId) {
      throw new Error('Model ID is required')
    }

    if (this.isImageModel(modelId)) {
      yield* super.coreStream(
        messages,
        modelId,
        {
          ...modelConfig,
          apiEndpoint: ApiEndpointType.Image
        },
        temperature,
        maxTokens,
        mcpTools
      )
      return
    }

    yield* super.coreStream(messages, modelId, modelConfig, temperature, maxTokens, mcpTools)
  }
}
