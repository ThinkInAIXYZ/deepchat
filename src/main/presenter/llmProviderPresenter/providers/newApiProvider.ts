import {
  ChatMessage,
  IConfigPresenter,
  KeyStatus,
  LLMCoreStreamEvent,
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  LLMResponse,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig
} from '@shared/presenter'
import {
  ApiEndpointType,
  ModelType,
  isNewApiEndpointType,
  resolveNewApiCapabilityProviderId,
  type NewApiEndpointType
} from '@shared/model'
import { ProxyAgent } from 'undici'
import { BaseLLMProvider } from '../baseProvider'
import { proxyConfig } from '../../proxyConfig'
import { AnthropicProvider } from './anthropicProvider'
import { GeminiProvider } from './geminiProvider'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
import { OpenAIResponsesProvider } from './openAIResponsesProvider'
import type { ProviderMcpRuntimePort } from '../runtimePorts'

type NewApiModelRecord = {
  id?: unknown
  name?: unknown
  owned_by?: unknown
  description?: unknown
  type?: unknown
  supported_endpoint_types?: unknown
  context_length?: unknown
  contextLength?: unknown
  input_token_limit?: unknown
  max_input_tokens?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
  output_token_limit?: unknown
}

type NewApiModelsResponse = {
  data?: NewApiModelRecord[]
}

const DEFAULT_NEW_API_BASE_URL = 'https://www.newapi.ai'

class NewApiOpenAIChatDelegate extends OpenAICompatibleProvider {
  protected override async init() {
    this.isInitialized = true
  }
}

class NewApiOpenAIResponsesDelegate extends OpenAIResponsesProvider {
  protected override async init() {
    this.isInitialized = true
  }
}

class NewApiGeminiDelegate extends GeminiProvider {
  protected override async init() {
    this.isInitialized = true
  }
}

class NewApiAnthropicDelegate extends AnthropicProvider {
  protected override async init() {
    this.isInitialized = true
  }
}

export class NewApiProvider extends BaseLLMProvider {
  private readonly openaiChatDelegate: NewApiOpenAIChatDelegate
  private readonly openaiResponsesDelegate: NewApiOpenAIResponsesDelegate
  private readonly anthropicDelegate: NewApiAnthropicDelegate
  private readonly geminiDelegate: NewApiGeminiDelegate

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)

    const host = this.getNormalizedBaseHost()

    this.openaiChatDelegate = new NewApiOpenAIChatDelegate(
      this.buildDelegateProvider({
        apiType: 'openai-completions',
        baseUrl: `${host}/v1`,
        capabilityProviderId: resolveNewApiCapabilityProviderId('openai')
      }),
      configPresenter,
      mcpRuntime
    )

    this.openaiResponsesDelegate = new NewApiOpenAIResponsesDelegate(
      this.buildDelegateProvider({
        apiType: 'openai-responses',
        baseUrl: `${host}/v1`,
        capabilityProviderId: resolveNewApiCapabilityProviderId('openai-response')
      }),
      configPresenter,
      mcpRuntime
    )

    this.anthropicDelegate = new NewApiAnthropicDelegate(
      this.buildDelegateProvider({
        apiType: 'anthropic',
        baseUrl: host,
        capabilityProviderId: resolveNewApiCapabilityProviderId('anthropic')
      }),
      configPresenter,
      mcpRuntime
    )

    this.geminiDelegate = new NewApiGeminiDelegate(
      this.buildDelegateProvider({
        apiType: 'gemini',
        baseUrl: host,
        capabilityProviderId: resolveNewApiCapabilityProviderId('gemini')
      }),
      configPresenter,
      mcpRuntime
    )

    this.init()
  }

  private getNormalizedBaseHost(): string {
    const rawBaseUrl = (this.provider.baseUrl || DEFAULT_NEW_API_BASE_URL).trim()
    const normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, '')
    return normalizedBaseUrl.replace(/\/(v1|v1beta(?:\d+)?)$/i, '') || DEFAULT_NEW_API_BASE_URL
  }

  private getStoredModelMeta(modelId: string): MODEL_META | undefined {
    return [...this.models, ...this.customModels].find((model) => model.id === modelId)
  }

  private buildDelegateProvider(overrides: Partial<LLM_PROVIDER>): LLM_PROVIDER {
    return {
      ...this.provider,
      ...overrides
    }
  }

  private getDefaultEndpointType(model: Pick<MODEL_META, 'supportedEndpointTypes' | 'type'>) {
    const supportedEndpointTypes = model.supportedEndpointTypes ?? []
    if (supportedEndpointTypes.length === 0) {
      return model.type === ModelType.ImageGeneration ? 'image-generation' : undefined
    }

    if (
      model.type === ModelType.ImageGeneration &&
      supportedEndpointTypes.includes('image-generation')
    ) {
      return 'image-generation'
    }

    return supportedEndpointTypes[0]
  }

  private resolveEndpointType(modelId: string): NewApiEndpointType {
    const modelConfig = this.configPresenter.getModelConfig(modelId, this.provider.id)
    if (isNewApiEndpointType(modelConfig.endpointType)) {
      return modelConfig.endpointType
    }

    const storedModel = this.getStoredModelMeta(modelId)
    if (storedModel && isNewApiEndpointType(storedModel.endpointType)) {
      return storedModel.endpointType
    }

    const defaultEndpointType = storedModel ? this.getDefaultEndpointType(storedModel) : undefined
    return defaultEndpointType ?? 'openai'
  }

  private buildImageModelConfig(modelId: string, modelConfig?: ModelConfig): ModelConfig {
    const baseConfig = modelConfig ?? this.configPresenter.getModelConfig(modelId, this.provider.id)
    return {
      ...baseConfig,
      apiEndpoint: ApiEndpointType.Image,
      type: ModelType.ImageGeneration,
      endpointType: 'image-generation'
    }
  }

  private buildFallbackSummaryTitle(messages: ChatMessage[]): string {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    const rawContent = latestUserMessage?.content

    const textContent =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent
              .filter((part) => part.type === 'text' && typeof part.text === 'string')
              .map((part) => part.text)
              .join(' ')
          : ''

    const normalizedTitle = textContent.replace(/\s+/g, ' ').trim()
    if (!normalizedTitle) {
      return 'New Conversation'
    }

    return normalizedTitle.slice(0, 60)
  }

  private inferModelType(rawModel: NewApiModelRecord, supported: NewApiEndpointType[]) {
    const normalizedRawType =
      typeof rawModel.type === 'string' ? rawModel.type.trim().toLowerCase() : ''
    const normalizedModelId = typeof rawModel.id === 'string' ? rawModel.id.toLowerCase() : ''

    if (
      normalizedRawType === 'imagegeneration' ||
      normalizedRawType === 'image-generation' ||
      normalizedRawType === 'image' ||
      supported.includes('image-generation')
    ) {
      return ModelType.ImageGeneration
    }

    if (
      normalizedRawType === 'embedding' ||
      normalizedRawType === 'embeddings' ||
      normalizedModelId.includes('embedding')
    ) {
      return ModelType.Embedding
    }

    if (normalizedRawType === 'rerank' || normalizedModelId.includes('rerank')) {
      return ModelType.Rerank
    }

    return undefined
  }

  private toGeminiMessages(messages: ChatMessage[]): Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }> {
    return messages
      .filter((message): message is ChatMessage & { role: 'system' | 'user' | 'assistant' } => {
        return message.role === 'system' || message.role === 'user' || message.role === 'assistant'
      })
      .map((message) => ({
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                  .filter((part) => part.type === 'text' && typeof part.text === 'string')
                  .map((part) => part.text)
                  .join('\n')
              : ''
      }))
  }

  private resolveContextLength(rawModel: NewApiModelRecord): number | undefined {
    const candidates = [
      rawModel.context_length,
      rawModel.contextLength,
      rawModel.input_token_limit,
      rawModel.max_input_tokens
    ]

    const firstNumber = candidates.find(
      (candidate): candidate is number =>
        typeof candidate === 'number' && Number.isFinite(candidate)
    )
    return firstNumber
  }

  private resolveMaxTokens(rawModel: NewApiModelRecord): number | undefined {
    const candidates = [
      rawModel.max_tokens,
      rawModel.max_output_tokens,
      rawModel.output_token_limit
    ]

    const firstNumber = candidates.find(
      (candidate): candidate is number =>
        typeof candidate === 'number' && Number.isFinite(candidate)
    )
    return firstNumber
  }

  private async ensureAnthropicDelegateReady(): Promise<NewApiAnthropicDelegate> {
    return this.anthropicDelegate
  }

  private async collectImageCompletion(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const response: LLMResponse = {
      content: ''
    }

    const modelConfig = this.buildImageModelConfig(modelId)

    for await (const event of this.openaiChatDelegate.coreStream(
      messages,
      modelId,
      modelConfig,
      temperature ?? modelConfig.temperature ?? 0.7,
      maxTokens ?? modelConfig.maxTokens ?? 1024,
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
            response.content = event.image_data.data
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

  private async syncProviderManagedEndpointType(models: MODEL_META[]): Promise<void> {
    for (const model of models) {
      if (this.configPresenter.hasUserModelConfig(model.id, this.provider.id)) {
        continue
      }

      const existingConfig = this.configPresenter.getModelConfig(model.id, this.provider.id)
      const defaultEndpointType = this.getDefaultEndpointType(model)
      const nextApiEndpoint =
        defaultEndpointType === 'image-generation' ? ApiEndpointType.Image : ApiEndpointType.Chat

      this.configPresenter.setModelConfig(
        model.id,
        this.provider.id,
        {
          ...existingConfig,
          type: model.type ?? existingConfig.type,
          apiEndpoint: nextApiEndpoint,
          endpointType: defaultEndpointType ?? existingConfig.endpointType
        },
        { source: 'provider' }
      )
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.getModelFetchTimeout())

    try {
      const proxyUrl = proxyConfig.getProxyUrl()
      const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined
      const response = await fetch(`${this.getNormalizedBaseHost()}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.provider.apiKey}`,
          'Content-Type': 'application/json',
          ...this.defaultHeaders
        },
        signal: controller.signal,
        ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {})
      })

      if (!response.ok) {
        const responseText = await response.text()
        throw new Error(responseText || `Failed to fetch models: ${response.status}`)
      }

      const payload = (await response.json()) as NewApiModelsResponse
      const rawModels = Array.isArray(payload.data) ? payload.data : []

      const models = rawModels
        .filter((rawModel): rawModel is NewApiModelRecord & { id: string } => {
          return typeof rawModel.id === 'string' && rawModel.id.trim().length > 0
        })
        .map((rawModel) => {
          const supportedEndpointTypes = Array.isArray(rawModel.supported_endpoint_types)
            ? rawModel.supported_endpoint_types.filter(isNewApiEndpointType)
            : []
          const type = this.inferModelType(rawModel, supportedEndpointTypes)
          const contextLength = this.resolveContextLength(rawModel)
          const maxTokens = this.resolveMaxTokens(rawModel)
          const model: MODEL_META = {
            id: rawModel.id,
            name: typeof rawModel.name === 'string' ? rawModel.name : rawModel.id,
            group: typeof rawModel.owned_by === 'string' ? rawModel.owned_by : 'default',
            providerId: this.provider.id,
            isCustom: false,
            supportedEndpointTypes,
            endpointType: this.getDefaultEndpointType({
              supportedEndpointTypes,
              type
            }),
            ...(typeof rawModel.description === 'string'
              ? { description: rawModel.description }
              : {}),
            ...(type ? { type } : {}),
            ...(contextLength !== undefined ? { contextLength } : {}),
            ...(maxTokens !== undefined ? { maxTokens } : {})
          }
          return model
        })

      await this.syncProviderManagedEndpointType(models)
      return models
    } finally {
      clearTimeout(timeout)
    }
  }

  public override onProxyResolved(): void {
    this.openaiChatDelegate.onProxyResolved()
    this.openaiResponsesDelegate.onProxyResolved()
    this.geminiDelegate.onProxyResolved()
    this.anthropicDelegate.onProxyResolved()
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      await this.fetchProviderModels()
      return { isOk: true, errorMsg: null }
    } catch (error) {
      return {
        isOk: false,
        errorMsg: error instanceof Error ? error.message : String(error)
      }
    }
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const endpointType = this.resolveEndpointType(modelId)

    switch (endpointType) {
      case 'anthropic': {
        const delegate = await this.ensureAnthropicDelegateReady()
        return delegate.summaryTitles(messages, modelId)
      }
      case 'gemini':
        return this.geminiDelegate.summaryTitles(this.toGeminiMessages(messages), modelId)
      case 'openai-response':
        return this.openaiResponsesDelegate.summaryTitles(messages, modelId)
      case 'image-generation':
        return this.buildFallbackSummaryTitle(messages)
      case 'openai':
      default:
        return this.openaiChatDelegate.summaryTitles(messages, modelId)
    }
  }

  public async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const endpointType = this.resolveEndpointType(modelId)

    switch (endpointType) {
      case 'anthropic': {
        const delegate = await this.ensureAnthropicDelegateReady()
        return delegate.completions(messages, modelId, temperature, maxTokens)
      }
      case 'gemini':
        return this.geminiDelegate.completions(
          this.toGeminiMessages(messages),
          modelId,
          temperature,
          maxTokens
        )
      case 'openai-response':
        return this.openaiResponsesDelegate.completions(messages, modelId, temperature, maxTokens)
      case 'image-generation':
        return this.collectImageCompletion(messages, modelId, temperature, maxTokens)
      case 'openai':
      default:
        return this.openaiChatDelegate.completions(messages, modelId, temperature, maxTokens)
    }
  }

  public async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const endpointType = this.resolveEndpointType(modelId)

    switch (endpointType) {
      case 'anthropic': {
        const delegate = await this.ensureAnthropicDelegateReady()
        return delegate.summaries(text, modelId, temperature, maxTokens)
      }
      case 'gemini':
        return this.geminiDelegate.summaries(text, modelId, temperature, maxTokens)
      case 'openai-response':
        return this.openaiResponsesDelegate.summaries(text, modelId, temperature, maxTokens)
      case 'image-generation':
        return this.collectImageCompletion(
          [{ role: 'user', content: text }],
          modelId,
          temperature,
          maxTokens
        )
      case 'openai':
      default:
        return this.openaiChatDelegate.summaries(text, modelId, temperature, maxTokens)
    }
  }

  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const endpointType = this.resolveEndpointType(modelId)

    switch (endpointType) {
      case 'anthropic': {
        const delegate = await this.ensureAnthropicDelegateReady()
        return delegate.generateText(prompt, modelId, temperature, maxTokens)
      }
      case 'gemini':
        return this.geminiDelegate.generateText(prompt, modelId, temperature, maxTokens)
      case 'openai-response':
        return this.openaiResponsesDelegate.generateText(prompt, modelId, temperature, maxTokens)
      case 'image-generation':
        return this.collectImageCompletion(
          [{ role: 'user', content: prompt }],
          modelId,
          temperature,
          maxTokens
        )
      case 'openai':
      default:
        return this.openaiChatDelegate.generateText(prompt, modelId, temperature, maxTokens)
    }
  }

  public async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const endpointType = this.resolveEndpointType(modelId)

    switch (endpointType) {
      case 'anthropic': {
        const delegate = await this.ensureAnthropicDelegateReady()
        yield* delegate.coreStream(messages, modelId, modelConfig, temperature, maxTokens, tools)
        return
      }
      case 'gemini':
        yield* this.geminiDelegate.coreStream(
          messages,
          modelId,
          modelConfig,
          temperature,
          maxTokens,
          tools
        )
        return
      case 'openai-response':
        yield* this.openaiResponsesDelegate.coreStream(
          messages,
          modelId,
          modelConfig,
          temperature,
          maxTokens,
          tools
        )
        return
      case 'image-generation':
        yield* this.openaiChatDelegate.coreStream(
          messages,
          modelId,
          this.buildImageModelConfig(modelId, modelConfig),
          temperature,
          maxTokens,
          tools
        )
        return
      case 'openai':
      default:
        yield* this.openaiChatDelegate.coreStream(
          messages,
          modelId,
          modelConfig,
          temperature,
          maxTokens,
          tools
        )
        return
    }
  }

  public async getEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    return this.openaiChatDelegate.getEmbeddings(modelId, texts)
  }

  public async getDimensions(modelId: string): Promise<LLM_EMBEDDING_ATTRS> {
    return this.openaiChatDelegate.getDimensions(modelId)
  }

  public async getKeyStatus(): Promise<KeyStatus | null> {
    return this.openaiChatDelegate.getKeyStatus()
  }
}
