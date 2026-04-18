import { EMBEDDING_TEST_KEY, isNormalized } from '@/utils/vector'
import {
  ApiEndpointType,
  ModelType,
  isNewApiEndpointType,
  resolveNewApiEndpointTypeFromRoute,
  resolveProviderCapabilityProviderId,
  type NewApiEndpointType
} from '@shared/model'
import {
  DEFAULT_MODEL_CONTEXT_LENGTH,
  DEFAULT_MODEL_MAX_TOKENS,
  resolveDerivedModelMaxTokens,
  resolveModelContextLength,
  resolveModelFunctionCall
} from '@shared/modelConfigDefaults'
import {
  AWS_BEDROCK_PROVIDER,
  ChatMessage,
  IConfigPresenter,
  KeyStatus,
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  LLMCoreStreamEvent,
  LLMResponse,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig,
  VERTEX_PROVIDER
} from '@shared/presenter'
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'
import { ProxyAgent } from 'undici'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import {
  runAiSdkCoreStream,
  runAiSdkDimensions,
  runAiSdkEmbeddings,
  runAiSdkGenerateText,
  type AiSdkRuntimeContext
} from '../aiSdk'
import type { AiSdkProviderKind } from '../aiSdk/providerFactory'
import { normalizeAzureBaseUrl } from '../aiSdk/providerFactory'
import { proxyConfig } from '../../proxyConfig'
import type { ProviderMcpRuntimePort } from '../runtimePorts'
import {
  type AiSdkBehaviorPreset,
  type AiSdkCredentialStrategy,
  type AiSdkEmbeddingStrategy,
  type AiSdkKeyStatusStrategy,
  type AiSdkModelSourceStrategy,
  type AiSdkProviderDefinition,
  type AiSdkRouteStrategy,
  resolveAiSdkProviderDefinition
} from '../providerRegistry'
import { providerDbLoader } from '../../configPresenter/providerDbLoader'
import { modelCapabilities } from '../../configPresenter/modelCapabilities'

const OPENAI_IMAGE_GENERATION_MODELS = ['gpt-4o-all', 'gpt-4o-image']
const OPENAI_IMAGE_GENERATION_MODEL_PREFIXES = ['dall-e-', 'gpt-image-']
const DEFAULT_NEW_API_BASE_URL = 'https://www.newapi.ai'

type RouteDecision = {
  providerKind: AiSdkProviderKind
  providerPatch?: Partial<LLM_PROVIDER>
  modelConfigPatch?: Partial<ModelConfig>
  endpointType?: NewApiEndpointType | 'grok-image'
  supportsOfficialAnthropicReasoning?: boolean
}

const isOpenAIImageGenerationModel = (modelId: string): boolean =>
  OPENAI_IMAGE_GENERATION_MODELS.includes(modelId) ||
  OPENAI_IMAGE_GENERATION_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix))

export function normalizeExtractedImageText(content: string): string {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\n\s*\n/g, '\n')
    .trim()
  if (!normalized) {
    return ''
  }

  const semanticText = normalized.replace(/[`*_~!()[\]]/g, '').trim()
  return semanticText.length > 0 ? normalized : ''
}

function toModelRecordArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    )
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  const record = payload as Record<string, unknown>
  for (const key of ['data', 'body', 'models']) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    }
  }

  return []
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}

export class AiSdkProvider extends BaseLLMProvider {
  private readonly definition: AiSdkProviderDefinition

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
    const definition = resolveAiSdkProviderDefinition(provider)
    if (!definition) {
      throw new Error(
        `No AI SDK definition found for provider ${provider.id} (${provider.apiType})`
      )
    }
    this.definition = definition
    this.init()
  }

  private getRouteStrategy(): AiSdkRouteStrategy {
    return this.definition.routeStrategy ?? 'none'
  }

  private getBehaviorPreset(decision: RouteDecision): AiSdkBehaviorPreset {
    switch (this.getRouteStrategy()) {
      case 'new-api':
      case 'zenmux':
        if (decision.providerKind === 'anthropic' || decision.providerKind === 'aws-bedrock') {
          return 'anthropic'
        }
        if (decision.providerKind === 'gemini' || decision.providerKind === 'vertex') {
          return 'google'
        }
        return this.definition.behaviorPreset
      default:
        return this.definition.behaviorPreset
    }
  }

  private getNormalizedNewApiHost(): string {
    const rawBaseUrl = (this.provider.baseUrl || DEFAULT_NEW_API_BASE_URL).trim()
    const normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, '')
    return normalizedBaseUrl.replace(/\/(v1|v1beta(?:\d+)?)$/i, '') || DEFAULT_NEW_API_BASE_URL
  }

  private getStoredModel(modelId: string): MODEL_META | undefined {
    return [...this.models, ...this.customModels].find((model) => model.id === modelId)
  }

  private getConfiguredAnthropicBaseUrl(): string {
    const baseUrl = this.definition.anthropicBaseUrl?.trim()
    if (!baseUrl) {
      throw new Error(`No Anthropic base URL configured for provider ${this.provider.id}`)
    }

    return baseUrl
  }

  private usesOfficialAnthropicReasoning(): boolean {
    return this.provider.id.trim().toLowerCase() === 'anthropic'
  }

  private resolveNewApiEndpointType(modelId: string): NewApiEndpointType {
    const modelConfig = this.getProviderModelConfig(modelId)
    if (isNewApiEndpointType(modelConfig.endpointType)) {
      return modelConfig.endpointType
    }

    const storedModel = this.getStoredModel(modelId)
    if (storedModel && isNewApiEndpointType(storedModel.endpointType)) {
      return storedModel.endpointType
    }

    return resolveNewApiEndpointTypeFromRoute(
      storedModel
        ? {
            endpointType: storedModel.endpointType,
            supportedEndpointTypes: storedModel.supportedEndpointTypes,
            type: storedModel.type
          }
        : null,
      modelId
    )
  }

  private resolveRouteDecision(modelId: string, _modelConfig?: ModelConfig): RouteDecision {
    const strategy = this.getRouteStrategy()

    if (strategy === 'grok' && modelId.startsWith('grok-2-image')) {
      return {
        providerKind: this.definition.runtimeKind,
        endpointType: 'grok-image',
        modelConfigPatch: {
          apiEndpoint: ApiEndpointType.Image
        }
      }
    }

    if (strategy === 'zenmux' && modelId.trim().toLowerCase().startsWith('anthropic/')) {
      return {
        providerKind: 'anthropic',
        supportsOfficialAnthropicReasoning: true,
        providerPatch: {
          apiType: 'anthropic',
          baseUrl: this.getConfiguredAnthropicBaseUrl(),
          capabilityProviderId: 'anthropic'
        }
      }
    }

    if (strategy === 'new-api') {
      const endpointType = this.resolveNewApiEndpointType(modelId)
      const host = this.getNormalizedNewApiHost()

      switch (endpointType) {
        case 'anthropic':
          return {
            providerKind: 'anthropic',
            endpointType,
            supportsOfficialAnthropicReasoning: true,
            providerPatch: {
              apiType: 'anthropic',
              baseUrl: host,
              capabilityProviderId: resolveProviderCapabilityProviderId(
                this.provider.id,
                {
                  endpointType
                },
                modelId
              )
            }
          }
        case 'gemini':
          return {
            providerKind: 'gemini',
            endpointType,
            providerPatch: {
              apiType: 'gemini',
              baseUrl: host,
              capabilityProviderId: resolveProviderCapabilityProviderId(
                this.provider.id,
                {
                  endpointType
                },
                modelId
              )
            }
          }
        case 'openai-response':
          return {
            providerKind: 'openai-responses',
            endpointType,
            providerPatch: {
              apiType: 'openai-responses',
              baseUrl: `${host}/v1`,
              capabilityProviderId: resolveProviderCapabilityProviderId(
                this.provider.id,
                {
                  endpointType
                },
                modelId
              )
            }
          }
        case 'image-generation':
          return {
            providerKind: 'openai-compatible',
            endpointType,
            providerPatch: {
              apiType: 'openai-completions',
              baseUrl: `${host}/v1`,
              capabilityProviderId: resolveProviderCapabilityProviderId(
                this.provider.id,
                {
                  endpointType
                },
                modelId
              )
            },
            modelConfigPatch: {
              apiEndpoint: ApiEndpointType.Image,
              type: ModelType.ImageGeneration,
              endpointType: 'image-generation'
            }
          }
        case 'openai':
        default:
          return {
            providerKind: 'openai-compatible',
            endpointType,
            providerPatch: {
              apiType: 'openai-completions',
              baseUrl: `${host}/v1`,
              capabilityProviderId: resolveProviderCapabilityProviderId(
                this.provider.id,
                {
                  endpointType
                },
                modelId
              )
            }
          }
      }
    }

    const supportsOfficialAnthropicReasoning = this.usesOfficialAnthropicReasoning()

    return {
      providerKind: this.definition.runtimeKind,
      ...(supportsOfficialAnthropicReasoning ? { supportsOfficialAnthropicReasoning } : {})
    }
  }

  private getRuntimeProvider(decision: RouteDecision): LLM_PROVIDER {
    return {
      ...this.provider,
      ...decision.providerPatch
    }
  }

  private getResolvedModelConfig(modelId: string, modelConfig?: ModelConfig): ModelConfig {
    return {
      ...this.configPresenter.getModelConfig(modelId, this.provider.id),
      ...modelConfig
    }
  }

  private getModelConfigForDecision(modelId: string, modelConfig?: ModelConfig): ModelConfig {
    const decision = this.resolveRouteDecision(modelId, modelConfig)
    return {
      ...this.getResolvedModelConfig(modelId, modelConfig),
      ...decision.modelConfigPatch
    }
  }

  public getProviderModelConfig(modelId: string): ModelConfig {
    return this.configPresenter.getModelConfig(modelId, this.provider.id) ?? ({} as ModelConfig)
  }

  public stringifyMessageContent(content: ChatMessage['content']): string {
    if (typeof content === 'string') {
      return content
    }

    if (!Array.isArray(content)) {
      return ''
    }

    return content
      .map((part) => {
        if (part.type === 'text' && typeof part.text === 'string') {
          return part.text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  public buildFallbackSummaryTitle(messages: ChatMessage[]): string {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    const textContent = this.stringifyMessageContent(latestUserMessage?.content ?? '')
    const normalizedTitle = textContent.replace(/\s+/g, ' ').trim()
    if (!normalizedTitle) {
      return 'New Conversation'
    }

    return normalizedTitle.slice(0, 60)
  }

  public getDbProviderModels(providerId = this.provider.id): MODEL_META[] {
    return this.configPresenter.getDbProviderModels(providerId)
  }

  public updateProviderManagedModelConfig(modelId: string, config: Partial<ModelConfig>): void {
    this.configPresenter.setModelConfig(
      modelId,
      this.provider.id,
      {
        ...this.getProviderModelConfig(modelId),
        ...config
      },
      {
        source: 'provider'
      }
    )
  }

  public getModelFetchTimeoutMs(): number {
    return this.getModelFetchTimeout()
  }

  private getFetchDispatcher(): ProxyAgent | undefined {
    const proxyUrl = proxyConfig.getProxyUrl()
    return proxyUrl ? new ProxyAgent(proxyUrl) : undefined
  }

  private isAzureOpenAI(decision: RouteDecision, runtimeProvider: LLM_PROVIDER): boolean {
    return decision.providerKind === 'azure' || runtimeProvider.id === 'azure-openai'
  }

  private isOfficialOpenAIService(decision: RouteDecision, runtimeProvider: LLM_PROVIDER): boolean {
    return runtimeProvider.id === 'openai' && !this.isAzureOpenAI(decision, runtimeProvider)
  }

  private resolveTraceAuthToken(runtimeProvider: LLM_PROVIDER): string {
    return runtimeProvider.oauthToken || runtimeProvider.apiKey || 'MISSING_API_KEY'
  }

  private buildTraceHeaders(
    decision: RouteDecision,
    runtimeProvider: LLM_PROVIDER,
    defaultHeaders: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...defaultHeaders
    }

    if (this.isAzureOpenAI(decision, runtimeProvider)) {
      headers['api-key'] = this.resolveTraceAuthToken(runtimeProvider)
    } else {
      headers.Authorization = `Bearer ${this.resolveTraceAuthToken(runtimeProvider)}`
    }

    return headers
  }

  private getRequestHeaders(
    decision: RouteDecision,
    runtimeProvider: LLM_PROVIDER,
    defaultHeaders: Record<string, string>,
    contentType?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...defaultHeaders
    }

    if (contentType) {
      headers['Content-Type'] = contentType
    }

    if (this.isAzureOpenAI(decision, runtimeProvider)) {
      headers['api-key'] = runtimeProvider.apiKey
    } else {
      headers.Authorization = `Bearer ${runtimeProvider.oauthToken || runtimeProvider.apiKey}`
    }

    return headers
  }

  private buildModelsUrl(decision: RouteDecision, runtimeProvider: LLM_PROVIDER): string {
    if (this.isAzureOpenAI(decision, runtimeProvider)) {
      const azureApiVersion = this.configPresenter.getSetting<string>('azureApiVersion')
      const azureConfig = normalizeAzureBaseUrl(
        runtimeProvider.baseUrl || undefined,
        azureApiVersion
      )
      const baseURL = azureConfig.baseURL?.replace(/\/+$/, '') || ''
      return `${baseURL}/models?api-version=${encodeURIComponent(azureConfig.apiVersion)}`
    }

    const baseUrl = (runtimeProvider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    return `${baseUrl}/models`
  }

  private buildRuntimeContext(
    modelId: string,
    modelConfig?: ModelConfig
  ): { context: AiSdkRuntimeContext; decision: RouteDecision; resolvedModelConfig: ModelConfig } {
    const decision = this.resolveRouteDecision(modelId, modelConfig)
    const runtimeProvider = this.getRuntimeProvider(decision)
    const defaultHeaders = {
      ...this.defaultHeaders,
      ...this.definition.defaultHeadersPatch
    }
    const resolvedModelConfig = this.getModelConfigForDecision(modelId, modelConfig)

    const cleanHeaders = this.isAzureOpenAI(decision, runtimeProvider)
      ? false
      : !this.isOfficialOpenAIService(decision, runtimeProvider)

    const shouldUseImageGeneration =
      decision.endpointType === 'grok-image' || decision.endpointType === 'image-generation'
        ? () => true
        : this.isAzureOpenAI(decision, runtimeProvider)
          ? (_runtimeModelId: string, runtimeModelConfig: ModelConfig) =>
              runtimeModelConfig.apiEndpoint === ApiEndpointType.Image
          : decision.providerKind === 'gemini' || decision.providerKind === 'vertex'
            ? (_runtimeModelId: string, runtimeModelConfig: ModelConfig) =>
                runtimeModelConfig.apiEndpoint === ApiEndpointType.Image
            : decision.providerKind === 'openai-responses'
              ? (runtimeModelId: string, runtimeModelConfig: ModelConfig) =>
                  isOpenAIImageGenerationModel(runtimeModelId) ||
                  runtimeModelConfig.apiEndpoint === ApiEndpointType.Image
              : (runtimeModelId: string, runtimeModelConfig: ModelConfig) =>
                  isOpenAIImageGenerationModel(runtimeModelId) ||
                  runtimeModelConfig.apiEndpoint === ApiEndpointType.Image

    return {
      decision,
      resolvedModelConfig,
      context: {
        providerKind: decision.providerKind,
        provider: runtimeProvider,
        supportsOfficialAnthropicReasoning: decision.supportsOfficialAnthropicReasoning,
        configPresenter: this.configPresenter,
        defaultHeaders,
        buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
        emitRequestTrace: (runtimeModelConfig, payload) =>
          this.emitRequestTrace(runtimeModelConfig, payload),
        buildTraceHeaders: () => this.buildTraceHeaders(decision, runtimeProvider, defaultHeaders),
        cleanHeaders,
        supportsNativeTools: (_runtimeModelId, runtimeModelConfig) =>
          runtimeModelConfig.functionCall === true,
        shouldUseImageGeneration
      }
    }
  }

  public async requestProviderJson<T>(
    url: string,
    init: RequestInit = {},
    timeout?: number,
    decision?: RouteDecision
  ): Promise<T> {
    const resolvedDecision = decision ?? { providerKind: this.definition.runtimeKind }
    const runtimeProvider = this.getRuntimeProvider(resolvedDecision)
    const defaultHeaders = {
      ...this.defaultHeaders,
      ...this.definition.defaultHeadersPatch
    }
    const controller = new AbortController()
    const timeoutId =
      typeof timeout === 'number' && timeout > 0
        ? setTimeout(() => controller.abort(), timeout)
        : undefined

    try {
      const dispatcher = this.getFetchDispatcher()
      const response = await fetch(url, {
        ...init,
        headers: {
          ...this.getRequestHeaders(
            resolvedDecision,
            runtimeProvider,
            defaultHeaders,
            init.body && !(init.body instanceof FormData) ? 'application/json' : undefined
          ),
          ...(init.headers as Record<string, string> | undefined)
        },
        signal: controller.signal,
        ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {})
      } as RequestInit)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Request failed with status ${response.status}`)
      }

      return (await response.json()) as T
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }

  public async fetchOpenAIModelRecords(
    options?: { timeout: number },
    decision?: RouteDecision
  ): Promise<Array<Record<string, unknown>>> {
    const resolvedDecision = decision ?? { providerKind: this.definition.runtimeKind }
    const runtimeProvider = this.getRuntimeProvider(resolvedDecision)
    const payload = await this.requestProviderJson<unknown>(
      this.buildModelsUrl(resolvedDecision, runtimeProvider),
      { method: 'GET' },
      options?.timeout,
      resolvedDecision
    )
    return toModelRecordArray(payload)
  }

  public async fetchDefaultOpenAIModels(
    options?: { timeout: number },
    decision?: RouteDecision
  ): Promise<MODEL_META[]> {
    const response = await this.fetchOpenAIModelRecords(options, decision)
    const models: MODEL_META[] = []

    for (const model of response) {
      if (typeof model.id !== 'string') {
        continue
      }

      models.push({
        id: model.id,
        name: model.id,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        contextLength: DEFAULT_MODEL_CONTEXT_LENGTH,
        maxTokens: DEFAULT_MODEL_MAX_TOKENS
      })
    }

    return models
  }

  public async runText(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    modelConfig?: ModelConfig
  ): Promise<LLMResponse> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }
    if (!modelId) {
      throw new Error('Model ID is required')
    }

    const { context, resolvedModelConfig } = this.buildRuntimeContext(modelId, modelConfig)
    return runAiSdkGenerateText(
      context,
      messages,
      modelId,
      resolvedModelConfig,
      temperature,
      maxTokens
    )
  }

  public async *streamText(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }
    if (!modelId) {
      throw new Error('Model ID is required')
    }

    const { context, resolvedModelConfig } = this.buildRuntimeContext(modelId, modelConfig)
    yield* runAiSdkCoreStream(
      context,
      messages,
      modelId,
      resolvedModelConfig,
      temperature,
      maxTokens,
      tools
    )
  }

  public async collectStreamResponse(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    tools: MCPToolDefinition[] = [],
    modelConfig?: ModelConfig
  ): Promise<LLMResponse> {
    const response: LLMResponse = {
      content: ''
    }
    const resolvedModelConfig =
      modelConfig ??
      ({
        ...this.getProviderModelConfig(modelId),
        apiEndpoint: ApiEndpointType.Image
      } as ModelConfig)

    for await (const event of this.streamText(
      messages,
      modelId,
      resolvedModelConfig,
      temperature ?? resolvedModelConfig.temperature ?? 0.7,
      maxTokens ?? resolvedModelConfig.maxTokens ?? 1024,
      tools
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

  public async runEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    const { context } = this.buildRuntimeContext(modelId)
    return runAiSdkEmbeddings(context, modelId, texts)
  }

  private async runEmbeddingsWithDecision(
    modelId: string,
    texts: string[],
    decision: RouteDecision
  ): Promise<number[][]> {
    const runtimeProvider = this.getRuntimeProvider(decision)
    const defaultHeaders = {
      ...this.defaultHeaders,
      ...this.definition.defaultHeadersPatch
    }
    const context: AiSdkRuntimeContext = {
      providerKind: decision.providerKind,
      provider: runtimeProvider,
      supportsOfficialAnthropicReasoning: decision.supportsOfficialAnthropicReasoning,
      configPresenter: this.configPresenter,
      defaultHeaders,
      buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
      emitRequestTrace: (runtimeModelConfig, payload) =>
        this.emitRequestTrace(runtimeModelConfig, payload),
      buildTraceHeaders: () => this.buildTraceHeaders(decision, runtimeProvider, defaultHeaders),
      cleanHeaders: this.isAzureOpenAI(decision, runtimeProvider)
        ? false
        : !this.isOfficialOpenAIService(decision, runtimeProvider),
      supportsNativeTools: (_runtimeModelId, runtimeModelConfig) =>
        runtimeModelConfig.functionCall === true,
      shouldUseImageGeneration: (_runtimeModelId, runtimeModelConfig) =>
        runtimeModelConfig.apiEndpoint === ApiEndpointType.Image
    }

    return runAiSdkEmbeddings(context, modelId, texts)
  }

  public async runDimensions(modelId: string): Promise<LLM_EMBEDDING_ATTRS> {
    if (modelId === 'text-embedding-3-small' || modelId === 'text-embedding-ada-002') {
      return {
        dimensions: 1536,
        normalized: true
      }
    }

    if (modelId === 'text-embedding-3-large') {
      return {
        dimensions: 3072,
        normalized: true
      }
    }

    try {
      const embeddings = await this.runEmbeddings(modelId, [EMBEDDING_TEST_KEY])
      return {
        dimensions: embeddings[0].length,
        normalized: isNormalized(embeddings[0])
      }
    } catch (error) {
      console.error(`[AiSdkProvider] Failed to get dimensions for model ${modelId}:`, error)
      const { context } = this.buildRuntimeContext(modelId)
      return runAiSdkDimensions(context, modelId)
    }
  }

  private async runDimensionsWithDecision(
    modelId: string,
    decision: RouteDecision
  ): Promise<LLM_EMBEDDING_ATTRS> {
    try {
      const embeddings = await this.runEmbeddingsWithDecision(
        modelId,
        [EMBEDDING_TEST_KEY],
        decision
      )
      return {
        dimensions: embeddings[0].length,
        normalized: isNormalized(embeddings[0])
      }
    } catch (error) {
      console.error(`[AiSdkProvider] Failed to get dimensions for model ${modelId}:`, error)
      const runtimeProvider = this.getRuntimeProvider(decision)
      const defaultHeaders = {
        ...this.defaultHeaders,
        ...this.definition.defaultHeadersPatch
      }
      const context: AiSdkRuntimeContext = {
        providerKind: decision.providerKind,
        provider: runtimeProvider,
        supportsOfficialAnthropicReasoning: decision.supportsOfficialAnthropicReasoning,
        configPresenter: this.configPresenter,
        defaultHeaders,
        buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
        emitRequestTrace: (runtimeModelConfig, payload) =>
          this.emitRequestTrace(runtimeModelConfig, payload),
        buildTraceHeaders: () => this.buildTraceHeaders(decision, runtimeProvider, defaultHeaders),
        cleanHeaders: this.isAzureOpenAI(decision, runtimeProvider)
          ? false
          : !this.isOfficialOpenAIService(decision, runtimeProvider),
        supportsNativeTools: (_runtimeModelId, runtimeModelConfig) =>
          runtimeModelConfig.functionCall === true,
        shouldUseImageGeneration: (_runtimeModelId, runtimeModelConfig) =>
          runtimeModelConfig.apiEndpoint === ApiEndpointType.Image
      }
      return runAiSdkDimensions(context, modelId)
    }
  }

  private mapConfigDbModels(providerId = this.provider.id): MODEL_META[] {
    return this.getDbProviderModels(providerId).map((model) => ({
      id: model.id,
      name: model.name,
      group: model.group || 'default',
      providerId: this.provider.id,
      isCustom: false,
      contextLength: model.contextLength,
      maxTokens: model.maxTokens,
      vision: model.vision || false,
      functionCall: model.functionCall || false,
      reasoning: model.reasoning || false,
      ...(model.type ? { type: model.type } : {})
    }))
  }

  private mapProviderDbModels(group: string): MODEL_META[] {
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
        group,
        providerId: this.provider.id,
        isCustom: false,
        contextLength: resolveModelContextLength(model.limit?.context),
        maxTokens: resolveDerivedModelMaxTokens(model.limit?.output),
        vision: hasImageInput,
        functionCall: resolveModelFunctionCall(model.tool_call),
        reasoning: Boolean(model.reasoning?.supported),
        enableSearch: Boolean(model.search?.supported),
        type: modelType
      }
    })
  }

  private syncProviderModelConfig(modelId: string, nextConfig: Partial<ModelConfig>): void {
    const existingConfig = this.getProviderModelConfig(modelId)
    const merged = {
      ...existingConfig,
      ...nextConfig
    }

    const changed = Object.keys(nextConfig).some(
      (key) => existingConfig[key as keyof ModelConfig] !== merged[key as keyof ModelConfig]
    )

    if (changed) {
      this.updateProviderManagedModelConfig(modelId, merged)
    }
  }

  private async fetchProviderModelsByStrategy(
    strategy: AiSdkModelSourceStrategy
  ): Promise<MODEL_META[]> {
    switch (strategy) {
      case 'config-db':
        return this.mapConfigDbModels(this.definition.providerDbSourceId)
      case 'provider-db':
        return this.mapProviderDbModels(this.definition.providerDbGroup || 'default')
      case 'github': {
        const response = await this.fetchOpenAIModelRecords({
          timeout: this.getModelFetchTimeout()
        })
        return response
          .filter((model) => typeof model.name === 'string')
          .map((model) => ({
            id: model.name as string,
            name: model.name as string,
            group: 'default',
            providerId: this.provider.id,
            isCustom: false,
            contextLength: DEFAULT_MODEL_CONTEXT_LENGTH,
            maxTokens: DEFAULT_MODEL_MAX_TOKENS,
            description: typeof model.description === 'string' ? model.description : undefined
          }))
      }
      case 'together': {
        const response = await this.fetchOpenAIModelRecords({
          timeout: this.getModelFetchTimeout()
        })
        return response
          .filter((model) => model.type === 'chat' || model.type === 'language')
          .map((model) => ({
            id: model.id as string,
            name: model.id as string,
            group: 'default',
            providerId: this.provider.id,
            isCustom: false,
            contextLength: DEFAULT_MODEL_CONTEXT_LENGTH,
            maxTokens: DEFAULT_MODEL_MAX_TOKENS
          }))
      }
      case 'astraflow': {
        const response = await this.fetchOpenAIModelRecords({
          timeout: this.getModelFetchTimeout()
        })
        const NON_CHAT_PATTERNS = [
          'embedding',
          'reranker',
          'speech',
          'suno-',
          'whisper',
          '-codex',
          'tts-',
          'uploads'
        ]
        return response
          .filter((model) => {
            if (typeof model.id !== 'string') return false
            const lower = model.id.toLowerCase()
            return !NON_CHAT_PATTERNS.some((p) => lower.includes(p))
          })
          .map((model) => ({
            id: model.id as string,
            name: model.id as string,
            group: 'default',
            providerId: this.provider.id,
            isCustom: false,
            contextLength: DEFAULT_MODEL_CONTEXT_LENGTH,
            maxTokens: DEFAULT_MODEL_MAX_TOKENS
          }))
      }
      case 'openrouter':
      case 'ppio':
      case 'groq':
      case 'tokenflux':
      case '302ai':
        return this.fetchOpenAiDerivedModels(strategy)
      case 'bedrock':
        return this.fetchBedrockModels()
      case 'new-api':
        return this.fetchNewApiModels()
      case 'openai':
      default:
        return this.fetchDefaultOpenAIModels({ timeout: this.getModelFetchTimeout() }).then(
          (models) =>
            this.getRouteStrategy() === 'zenmux'
              ? models.map((model) => ({
                  ...model,
                  group: 'ZenMux'
                }))
              : models
        )
    }
  }

  private async fetchOpenAiDerivedModels(
    strategy: 'openrouter' | 'ppio' | 'groq' | 'tokenflux' | '302ai'
  ): Promise<MODEL_META[]> {
    try {
      const response = await this.fetchOpenAIModelRecords({ timeout: this.getModelFetchTimeout() })
      const models: MODEL_META[] = []

      for (const model of response) {
        const modelId = typeof model.id === 'string' ? model.id : ''
        if (!modelId) {
          continue
        }

        const existingConfig = this.getProviderModelConfig(modelId)

        if (strategy === 'groq') {
          const status =
            typeof model.status === 'number'
              ? model.status
              : typeof model.active === 'boolean'
                ? model.active
                  ? 1
                  : 0
                : 1
          if (status === 0 || model.active === false) {
            continue
          }
        }

        const features = Array.isArray(model.features)
          ? model.features.filter((item): item is string => typeof item === 'string')
          : []
        const supportedParameters = Array.isArray(model.supported_parameters)
          ? model.supported_parameters.filter((item): item is string => typeof item === 'string')
          : []
        const inputModalities = Array.isArray(
          (model.architecture as Record<string, unknown>)?.input_modalities
        )
          ? ((model.architecture as Record<string, unknown>).input_modalities as unknown[]).filter(
              (item): item is string => typeof item === 'string'
            )
          : []

        const contextLength =
          strategy === 'openrouter'
            ? (typeof model.context_length === 'number' ? model.context_length : undefined) ||
              (typeof (model.top_provider as Record<string, unknown>)?.context_length === 'number'
                ? ((model.top_provider as Record<string, unknown>).context_length as number)
                : undefined) ||
              existingConfig.contextLength ||
              4096
            : strategy === 'ppio'
              ? (typeof model.context_size === 'number' ? model.context_size : undefined) ||
                existingConfig.contextLength ||
                4096
              : strategy === 'groq'
                ? (typeof model.context_size === 'number' ? model.context_size : undefined) ||
                  (typeof model.context_window === 'number' ? model.context_window : undefined) ||
                  existingConfig.contextLength ||
                  4096
                : strategy === 'tokenflux'
                  ? (typeof model.context_length === 'number' ? model.context_length : undefined) ||
                    existingConfig.contextLength ||
                    4096
                  : (typeof model.content_length === 'number' ? model.content_length : undefined) ||
                    existingConfig.contextLength ||
                    4096

        const maxTokens =
          strategy === 'openrouter'
            ? (typeof (model.top_provider as Record<string, unknown>)?.max_completion_tokens ===
              'number'
                ? ((model.top_provider as Record<string, unknown>).max_completion_tokens as number)
                : undefined) ||
              existingConfig.maxTokens ||
              2048
            : strategy === 'ppio'
              ? (typeof model.max_output_tokens === 'number'
                  ? model.max_output_tokens
                  : undefined) ||
                existingConfig.maxTokens ||
                2048
              : strategy === 'groq'
                ? (typeof model.max_output_tokens === 'number'
                    ? model.max_output_tokens
                    : undefined) ||
                  (typeof model.max_tokens === 'number' ? model.max_tokens : undefined) ||
                  existingConfig.maxTokens ||
                  2048
                : strategy === 'tokenflux'
                  ? existingConfig.maxTokens || Math.min(contextLength / 2, 4096)
                  : typeof model.max_completion_tokens === 'number' &&
                      model.max_completion_tokens > 0
                    ? (model.max_completion_tokens as number)
                    : existingConfig.maxTokens || 2048

        const hasFunctionCalling =
          strategy === 'openrouter'
            ? supportedParameters.includes('tools')
            : strategy === 'ppio'
              ? features.includes('function-calling')
              : strategy === 'groq'
                ? features.includes('function-calling') ||
                  (!modelId.toLowerCase().includes('distil') &&
                    !modelId.toLowerCase().includes('gemma'))
                : strategy === 'tokenflux'
                  ? true
                  : model.supported_tools === true

        const hasVision =
          strategy === 'openrouter'
            ? inputModalities.includes('image')
            : strategy === 'ppio'
              ? features.includes('vision')
              : strategy === 'groq'
                ? features.includes('vision') ||
                  modelId.toLowerCase().includes('vision') ||
                  modelId.toLowerCase().includes('llava')
                : strategy === 'tokenflux'
                  ? Boolean(model.supports_vision)
                  : modelId.includes('vision') ||
                    modelId.includes('gpt-4o') ||
                    (typeof model.description === 'string' &&
                      model.description.includes('vision')) ||
                    (typeof model.description_en === 'string' &&
                      model.description_en.toLowerCase().includes('vision')) ||
                    modelId.includes('claude') ||
                    modelId.includes('gemini') ||
                    (modelId.includes('qwen') && modelId.includes('vl'))

        const reasoning =
          strategy === 'openrouter'
            ? supportedParameters.includes('reasoning') ||
              supportedParameters.includes('include_reasoning') ||
              existingConfig.reasoning ||
              false
            : existingConfig.reasoning || false

        this.syncProviderModelConfig(modelId, {
          contextLength,
          maxTokens,
          functionCall: hasFunctionCalling,
          vision: hasVision,
          reasoning,
          temperature: existingConfig.temperature,
          type: existingConfig.type
        })

        models.push({
          id: modelId,
          name:
            strategy === 'ppio' && typeof model.display_name === 'string'
              ? model.display_name
              : strategy === 'groq' && typeof model.display_name === 'string'
                ? model.display_name
                : strategy === 'tokenflux' && typeof model.name === 'string'
                  ? model.name
                  : strategy === 'openrouter' && typeof model.name === 'string'
                    ? model.name
                    : modelId,
          group: 'default',
          providerId: this.provider.id,
          isCustom: false,
          contextLength,
          maxTokens,
          description:
            typeof model.description === 'string'
              ? model.description
              : strategy === 'groq'
                ? `Groq model ${modelId}`
                : undefined,
          vision: hasVision,
          functionCall: hasFunctionCalling,
          reasoning
        })
      }

      return models
    } catch (error) {
      console.error(`Error fetching ${strategy} models:`, error)
      return this.fetchDefaultOpenAIModels({ timeout: this.getModelFetchTimeout() })
    }
  }

  private async fetchBedrockModels(): Promise<MODEL_META[]> {
    const provider = this.provider as AWS_BEDROCK_PROVIDER
    const accessKeyId = provider.credential?.accessKeyId || process.env.BEDROCK_ACCESS_KEY_ID
    const secretAccessKey =
      provider.credential?.secretAccessKey || process.env.BEDROCK_SECRET_ACCESS_KEY
    const region = provider.credential?.region || process.env.BEDROCK_REGION

    if (!accessKeyId || !secretAccessKey || !region) {
      return this.mapConfigDbModels(this.definition.providerDbSourceId).filter((model) =>
        model.id.startsWith('anthropic.')
      )
    }

    try {
      const client = new BedrockClient({
        credentials: {
          accessKeyId,
          secretAccessKey
        },
        region
      })
      const response = await client.send(new ListFoundationModelsCommand({}))
      return (
        response.modelSummaries
          ?.filter(
            (model) => model.modelId && /^anthropic\.claude-[a-z0-9-]+(:\d+)$/g.test(model.modelId)
          )
          ?.filter((model) => model.modelLifecycle?.status === 'ACTIVE')
          ?.filter(
            (model) => model.inferenceTypesSupported && model.inferenceTypesSupported.length > 0
          )
          .map((model) => ({
            id: model.inferenceTypesSupported?.includes('ON_DEMAND')
              ? model.modelId!
              : `${region.split('-')[0]}.${model.modelId}`,
            name: model.modelId?.replace('anthropic.', '') || '<Unknown>',
            providerId: this.provider.id,
            maxTokens: 64_000,
            group: `AWS Bedrock Claude - ${
              model.modelId?.includes('opus')
                ? 'opus'
                : model.modelId?.includes('sonnet')
                  ? 'sonnet'
                  : model.modelId?.includes('haiku')
                    ? 'haiku'
                    : 'other'
            }`,
            isCustom: false,
            contextLength: 200_000,
            vision: false,
            functionCall: false,
            reasoning: false
          })) || []
      )
    } catch (error) {
      console.error('获取AWS Bedrock Anthropic模型列表出错:', error)
      return this.mapConfigDbModels(this.definition.providerDbSourceId).filter((model) =>
        model.id.startsWith('anthropic.')
      )
    }
  }

  private async fetchNewApiModels(): Promise<MODEL_META[]> {
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

    const host = this.getNormalizedNewApiHost()
    const payload = await this.requestProviderJson<NewApiModelsResponse>(
      `${host}/v1/models`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.provider.apiKey}`,
          'Content-Type': 'application/json',
          ...this.defaultHeaders
        }
      },
      this.getModelFetchTimeout()
    )
    const rawModels = Array.isArray(payload.data) ? payload.data : []

    const models = rawModels
      .filter((rawModel): rawModel is NewApiModelRecord & { id: string } => {
        return typeof rawModel.id === 'string' && rawModel.id.trim().length > 0
      })
      .map((rawModel) => {
        const supportedEndpointTypes = Array.isArray(rawModel.supported_endpoint_types)
          ? rawModel.supported_endpoint_types.filter(isNewApiEndpointType)
          : []

        const normalizedRawType =
          typeof rawModel.type === 'string' ? rawModel.type.trim().toLowerCase() : ''
        const normalizedModelId = rawModel.id.toLowerCase()
        const type =
          normalizedRawType === 'imagegeneration' ||
          normalizedRawType === 'image-generation' ||
          normalizedRawType === 'image' ||
          supportedEndpointTypes.includes('image-generation')
            ? ModelType.ImageGeneration
            : normalizedRawType === 'embedding' ||
                normalizedRawType === 'embeddings' ||
                normalizedModelId.includes('embedding')
              ? ModelType.Embedding
              : normalizedRawType === 'rerank' || normalizedModelId.includes('rerank')
                ? ModelType.Rerank
                : undefined

        const contextLengthCandidate = [
          rawModel.context_length,
          rawModel.contextLength,
          rawModel.input_token_limit,
          rawModel.max_input_tokens
        ].find(
          (candidate): candidate is number =>
            typeof candidate === 'number' && Number.isFinite(candidate)
        )

        const maxTokensCandidate = [
          rawModel.max_tokens,
          rawModel.max_output_tokens,
          rawModel.output_token_limit
        ].find(
          (candidate): candidate is number =>
            typeof candidate === 'number' && Number.isFinite(candidate)
        )

        const defaultEndpointType =
          supportedEndpointTypes.length === 0
            ? type === ModelType.ImageGeneration
              ? 'image-generation'
              : undefined
            : resolveNewApiEndpointTypeFromRoute(
                {
                  supportedEndpointTypes,
                  type
                },
                rawModel.id
              )

        return {
          id: rawModel.id,
          name: typeof rawModel.name === 'string' ? rawModel.name : rawModel.id,
          group: typeof rawModel.owned_by === 'string' ? rawModel.owned_by : 'default',
          providerId: this.provider.id,
          isCustom: false,
          supportedEndpointTypes,
          endpointType: defaultEndpointType,
          ...(typeof rawModel.description === 'string'
            ? { description: rawModel.description }
            : {}),
          ...(type ? { type } : {}),
          ...(contextLengthCandidate !== undefined
            ? { contextLength: contextLengthCandidate }
            : {}),
          ...(maxTokensCandidate !== undefined ? { maxTokens: maxTokensCandidate } : {})
        } satisfies MODEL_META
      })

    for (const model of models) {
      if (this.configPresenter.hasUserModelConfig(model.id, this.provider.id)) {
        continue
      }

      const existingConfig = this.getProviderModelConfig(model.id)
      this.updateProviderManagedModelConfig(model.id, {
        ...existingConfig,
        type: model.type ?? existingConfig.type,
        apiEndpoint:
          model.endpointType === 'image-generation' ? ApiEndpointType.Image : ApiEndpointType.Chat,
        endpointType: model.endpointType ?? existingConfig.endpointType
      })
    }

    return models
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    return this.fetchProviderModelsByStrategy(this.definition.modelSource)
  }

  public onProxyResolved(): void {}

  private resolveKeyStatusStrategy(): AiSdkKeyStatusStrategy {
    return this.definition.keyStatusStrategy ?? 'none'
  }

  public async getKeyStatus(): Promise<KeyStatus | null> {
    switch (this.resolveKeyStatusStrategy()) {
      case 'openrouter': {
        const response = await fetch('https://openrouter.ai/api/v1/key', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.provider.apiKey}`,
            'Content-Type': 'application/json'
          }
        })
        if (response.status !== 200) {
          const errorText = await response.text()
          throw new Error(
            `OpenRouter API key check failed: ${response.status} ${response.statusText} - ${errorText}`
          )
        }
        const payload = (await response.json()) as {
          data: {
            usage: number
            limit_remaining: number | null
          }
        }
        const keyStatus: KeyStatus = {
          usage: '$' + payload.data.usage
        }
        if (payload.data.limit_remaining !== null) {
          keyStatus.limit_remaining = '$' + payload.data.limit_remaining
          keyStatus.remainNum = payload.data.limit_remaining
        }
        return keyStatus
      }
      case 'deepseek': {
        const response = await fetch('https://api.deepseek.com/user/balance', {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.provider.apiKey}`
          }
        })
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(
            `DeepSeek API key check failed: ${response.status} ${response.statusText} - ${errorText}`
          )
        }
        const payload = (await response.json()) as {
          is_available: boolean
          balance_infos: Array<{ currency: string; total_balance: string }>
        }
        if (!payload.is_available) {
          throw new Error('DeepSeek API key is not available')
        }
        const balanceInfo =
          payload.balance_infos.find((info) => info.currency === 'CNY') ||
          payload.balance_infos.find((info) => info.currency === 'USD') ||
          payload.balance_infos[0]
        if (!balanceInfo) {
          throw new Error('No balance information available')
        }
        const totalBalance = Number.parseFloat(balanceInfo.total_balance)
        const currencySymbol = balanceInfo.currency === 'USD' ? '$' : '¥'
        return {
          limit_remaining: `${currencySymbol}${totalBalance}`,
          remainNum: totalBalance
        }
      }
      case 'ppio': {
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
        const payload = (await response.json()) as { credit_balance: number }
        return {
          limit_remaining: '¥' + payload.credit_balance / 10000,
          remainNum: payload.credit_balance
        }
      }
      case 'tokenflux': {
        const response = await fetch(`${this.provider.baseUrl}/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.provider.apiKey}`,
            'Content-Type': 'application/json'
          }
        })
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(
            `TokenFlux API key check failed: ${response.status} ${response.statusText} - ${errorText}`
          )
        }
        return {
          limit_remaining: 'Available',
          remainNum: undefined
        }
      }
      case '302ai': {
        const response = await fetch('https://api.302.ai/dashboard/balance', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.provider.apiKey}`,
            'Content-Type': 'application/json'
          }
        })
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(
            `302AI API key check failed: ${response.status} ${response.statusText} - ${errorText}`
          )
        }
        const payload = (await response.json()) as { data: { balance: string } }
        return {
          limit_remaining: `$${payload.data.balance}`,
          remainNum: Number.parseFloat(payload.data.balance)
        }
      }
      case 'cherryin': {
        const baseUrl = (this.provider.baseUrl || 'https://open.cherryin.ai/v1').replace(/\/$/, '')
        const usageResponse = await fetch(`${baseUrl}/dashboard/billing/usage`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.provider.apiKey}`,
            'Content-Type': 'application/json'
          }
        })
        if (!usageResponse.ok) {
          const errorText = await usageResponse.text()
          throw new Error(
            `CherryIn usage check failed: ${usageResponse.status} ${usageResponse.statusText} - ${errorText}`
          )
        }
        const usageData = (await usageResponse.json()) as { total_usage: number }
        const usageUsd = Number.isFinite(Number(usageData.total_usage))
          ? Number(usageData.total_usage) / 100
          : 0
        return {
          usage: `$${usageUsd.toFixed(2)}`
        }
      }
      case 'modelscope': {
        const response = await this.fetchOpenAIModelRecords({ timeout: 10000 })
        return {
          limit_remaining: 'Available',
          remainNum: response.length
        }
      }
      case 'siliconcloud': {
        const response = await fetch('https://api.siliconflow.cn/v1/user/info', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.provider.apiKey}`,
            'Content-Type': 'application/json'
          }
        })
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(
            `SiliconCloud API key check failed: ${response.status} ${response.statusText} - ${errorText}`
          )
        }
        const payload = (await response.json()) as {
          code: number
          message: string
          status: boolean
          data: { totalBalance: string }
        }
        if (payload.code !== 20000 || !payload.status) {
          throw new Error(`SiliconCloud API error: ${payload.message}`)
        }
        const totalBalance = Number.parseFloat(payload.data.totalBalance)
        return {
          limit_remaining: `¥${totalBalance}`,
          remainNum: totalBalance
        }
      }
      case 'none':
      default:
        return null
    }
  }

  private validateCredentials(strategy: AiSdkCredentialStrategy): string | null {
    switch (strategy) {
      case 'api-key':
        return this.provider.apiKey ? null : 'Missing API key'
      case 'anthropic':
        return this.provider.apiKey || process.env.ANTHROPIC_API_KEY ? null : 'Missing API key'
      case 'vertex': {
        const provider = this.provider as VERTEX_PROVIDER
        return provider.projectId &&
          provider.location &&
          (provider.apiKey || (provider.accountClientEmail && provider.accountPrivateKey))
          ? null
          : 'projectId, location, and API credentials are required for Vertex AI'
      }
      case 'bedrock': {
        const provider = this.provider as AWS_BEDROCK_PROVIDER
        const accessKeyId = provider.credential?.accessKeyId || process.env.BEDROCK_ACCESS_KEY_ID
        const secretAccessKey =
          provider.credential?.secretAccessKey || process.env.BEDROCK_SECRET_ACCESS_KEY
        const region = provider.credential?.region || process.env.BEDROCK_REGION
        return accessKeyId && secretAccessKey && region ? null : 'Missing AWS Bedrock credentials'
      }
      case 'none':
      default:
        return null
    }
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    switch (this.definition.checkStrategy) {
      case 'key-status':
        try {
          const keyStatus = await this.getKeyStatus()
          if (keyStatus?.remainNum !== undefined && keyStatus.remainNum <= 0) {
            return {
              isOk: false,
              errorMsg: `API key quota exhausted. Remaining: ${keyStatus.limit_remaining}`
            }
          }
          return { isOk: true, errorMsg: null }
        } catch (error) {
          return {
            isOk: false,
            errorMsg: toErrorMessage(error, 'Provider check failed')
          }
        }
      case 'generate-text': {
        const credentialError = this.validateCredentials(
          this.definition.credentialStrategy ?? 'none'
        )
        if (credentialError) {
          return {
            isOk: false,
            errorMsg: credentialError
          }
        }

        try {
          await this.runText(
            [{ role: 'user', content: this.definition.checkPrompt || 'Hello' }],
            this.definition.checkModelId || '',
            this.definition.checkTemperature ?? 0.2,
            this.definition.checkMaxTokens ?? 16
          )
          return { isOk: true, errorMsg: null }
        } catch (error) {
          return {
            isOk: false,
            errorMsg: toErrorMessage(error, 'Provider check failed')
          }
        }
      }
      case 'fetch-models':
      default:
        try {
          await this.fetchProviderModels()
          return { isOk: true, errorMsg: null }
        } catch (error) {
          return {
            isOk: false,
            errorMsg: toErrorMessage(error, 'Provider check failed')
          }
        }
    }
  }

  private buildTranscript(messages: ChatMessage[]): string {
    return messages
      .map((message) => `${message.role}: ${this.stringifyMessageContent(message.content)}`)
      .join('\n')
  }

  private async runSummaryTitlePrompt(
    messages: ChatMessage[],
    modelId: string,
    temperature: number,
    maxTokens?: number
  ): Promise<string> {
    const response = await this.runText(
      [
        {
          role: 'user',
          content: `${SUMMARY_TITLES_PROMPT}\n\n${this.buildTranscript(messages)}`
        }
      ],
      modelId,
      temperature,
      maxTokens
    )
    return response.content.trim()
  }

  private async runPromptCompletion(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    return this.runText(
      [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ],
      modelId,
      temperature,
      maxTokens
    )
  }

  private async getSuggestionsByPreset(
    preset: AiSdkBehaviorPreset,
    context: string | ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<string[]> {
    const promptContext = Array.isArray(context) ? this.buildTranscript(context) : context

    if (preset === 'anthropic') {
      const response = await this.runPromptCompletion(
        `根据下面的上下文，给出3个可能的回复建议，每个建议一行，不要有编号或者额外的解释：\n\n${promptContext}`,
        modelId,
        temperature ?? 0.7,
        maxTokens ?? 128,
        systemPrompt
      )
      return response.content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
    }

    if (preset === 'google') {
      const response = await this.runPromptCompletion(
        `Based on the following context, please provide up to 5 reasonable suggestion options, each on a new line without numbering:\n\n${promptContext}`,
        modelId,
        temperature ?? 0.7,
        maxTokens ?? 128,
        systemPrompt
      )
      return response.content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 5)
    }

    const messages = Array.isArray(context)
      ? context
      : [{ role: 'user' as const, content: context }]
    const lastUserMessage = messages.filter((message) => message.role === 'user').pop()
    if (!lastUserMessage) {
      return []
    }

    const response = await this.runText(
      [
        {
          role: 'system',
          content:
            'Based on the last user message in the conversation history, provide 3 brief, relevant follow-up suggestions or questions. Output ONLY the suggestions, each on a new line.'
        },
        ...messages.slice(-5)
      ],
      modelId,
      temperature ?? 0.7,
      maxTokens ?? 60
    )

    return response.content
      .split('\n')
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && !item.match(/^[0-9.\-*\s]*/))
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const decision = this.resolveRouteDecision(modelId)
    if (decision.endpointType === 'image-generation') {
      return this.buildFallbackSummaryTitle(messages)
    }

    const preset = this.getBehaviorPreset(decision)

    switch (preset) {
      case 'anthropic':
        return this.runSummaryTitlePrompt(messages, modelId, 0.3, 50)
      case 'google': {
        const title = await this.runSummaryTitlePrompt(messages, modelId, 0.4)
        return title || 'New Conversation'
      }
      case 'openai':
      case 'title-summary':
      case 'english-summary':
      case 'chinese-summary':
      default: {
        const title = await this.runSummaryTitlePrompt(messages, modelId, 0.5)
        return title.replace(/["']/g, '').trim()
      }
    }
  }

  public async completions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    const decision = this.resolveRouteDecision(modelId)
    if (decision.endpointType === 'grok-image' || decision.endpointType === 'image-generation') {
      return this.collectStreamResponse(messages, modelId, temperature, maxTokens)
    }

    return this.runText(messages, modelId, temperature, maxTokens)
  }

  public async summaries(
    text: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const decision = this.resolveRouteDecision(modelId)
    if (decision.endpointType === 'grok-image' || decision.endpointType === 'image-generation') {
      return this.collectStreamResponse(
        [{ role: 'user', content: text }],
        modelId,
        temperature,
        maxTokens
      )
    }

    const preset = this.getBehaviorPreset(decision)
    switch (preset) {
      case 'anthropic':
        return this.runPromptCompletion(
          `请对以下内容进行摘要:\n\n${text}\n\n请提供一个简洁明了的摘要。`,
          modelId,
          temperature,
          maxTokens,
          systemPrompt
        )
      case 'google':
        return this.runPromptCompletion(
          `Please generate a concise summary for the following content:\n\n${text}`,
          modelId,
          temperature,
          maxTokens,
          systemPrompt
        )
      case 'title-summary':
        return this.runPromptCompletion(
          "You need to summarize the user's conversation into a title of no more than 10 words, with the title language matching the user's primary language, without using punctuation or other special symbols：\n" +
            text,
          modelId,
          temperature,
          maxTokens,
          systemPrompt
        )
      case 'english-summary':
        return this.runPromptCompletion(
          `Please summarize the following content using concise language and highlighting key points:\n${text}`,
          modelId,
          temperature,
          maxTokens,
          systemPrompt
        )
      case 'chinese-summary':
        return this.runPromptCompletion(
          `请总结以下内容，使用简洁的语言，突出重点：\n${text}`,
          modelId,
          temperature,
          maxTokens,
          systemPrompt
        )
      case 'openai':
      default:
        if (this.provider.id === 'deepseek') {
          return this.runPromptCompletion(
            `${SUMMARY_TITLES_PROMPT}\n\n${text}`,
            modelId,
            temperature,
            maxTokens,
            systemPrompt
          )
        }
        return this.runText(
          [
            { role: 'system', content: 'Summarize the following text concisely:' },
            { role: 'user', content: text }
          ],
          modelId,
          temperature,
          maxTokens
        )
    }
  }

  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<LLMResponse> {
    const decision = this.resolveRouteDecision(modelId)
    if (decision.endpointType === 'grok-image' || decision.endpointType === 'image-generation') {
      return this.collectStreamResponse(
        [{ role: 'user', content: prompt }],
        modelId,
        temperature,
        maxTokens
      )
    }

    return this.runPromptCompletion(prompt, modelId, temperature, maxTokens, systemPrompt)
  }

  public async suggestions(
    context: string | ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<string[]> {
    const decision = this.resolveRouteDecision(modelId)
    return this.getSuggestionsByPreset(
      this.getBehaviorPreset(decision),
      context,
      modelId,
      temperature,
      maxTokens,
      systemPrompt
    )
  }

  public async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[]
  ): AsyncGenerator<LLMCoreStreamEvent> {
    yield* this.streamText(messages, modelId, modelConfig, temperature, maxTokens, tools)
  }

  private getEmbeddingStrategy(): AiSdkEmbeddingStrategy {
    return this.definition.embeddingStrategy ?? 'none'
  }

  public async getEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    switch (this.getEmbeddingStrategy()) {
      case 'openai':
      case 'google':
        return this.runEmbeddings(modelId, texts)
      case 'new-api': {
        return this.runEmbeddingsWithDecision(modelId, texts, {
          providerKind: 'openai-compatible',
          providerPatch: {
            apiType: 'openai-completions',
            baseUrl: `${this.getNormalizedNewApiHost()}/v1`,
            capabilityProviderId: resolveProviderCapabilityProviderId(
              this.provider.id,
              {
                endpointType: 'openai'
              },
              modelId
            )
          }
        })
      }
      case 'zenmux':
        if (modelId.trim().toLowerCase().startsWith('anthropic/')) {
          throw new Error(`Embeddings not supported for Anthropic models: ${modelId}`)
        }
        return this.runEmbeddings(modelId, texts)
      case 'none':
      default:
        throw new Error('embedding is not supported by this provider')
    }
  }

  public async getDimensions(modelId: string): Promise<LLM_EMBEDDING_ATTRS> {
    switch (this.getEmbeddingStrategy()) {
      case 'openai':
      case 'google':
        return this.runDimensions(modelId)
      case 'new-api': {
        return this.runDimensionsWithDecision(modelId, {
          providerKind: 'openai-compatible',
          providerPatch: {
            apiType: 'openai-completions',
            baseUrl: `${this.getNormalizedNewApiHost()}/v1`,
            capabilityProviderId: resolveProviderCapabilityProviderId(
              this.provider.id,
              {
                endpointType: 'openai'
              },
              modelId
            )
          }
        })
      }
      case 'zenmux':
        if (modelId.trim().toLowerCase().startsWith('anthropic/')) {
          throw new Error(`Embeddings not supported for Anthropic models: ${modelId}`)
        }
        return this.runDimensions(modelId)
      case 'none':
      default:
        throw new Error('embedding is not supported by this provider')
    }
  }
}
