import { EMBEDDING_TEST_KEY, isNormalized } from '@/utils/vector'
import { eventBus, SendTarget } from '@/eventbus'
import { NOTIFICATION_EVENTS } from '@/events'
import {
  ChatMessage,
  IConfigPresenter,
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  LLMCoreStreamEvent,
  LLMResponse,
  MCPToolDefinition,
  MODEL_META,
  ModelConfig
} from '@shared/presenter'
import { ApiEndpointType } from '@shared/model'
import { DEFAULT_MODEL_CONTEXT_LENGTH, DEFAULT_MODEL_MAX_TOKENS } from '@shared/modelConfigDefaults'
import { ProxyAgent } from 'undici'
import { BaseLLMProvider, SUMMARY_TITLES_PROMPT } from '../baseProvider'
import {
  runAiSdkCoreStream,
  runAiSdkDimensions,
  runAiSdkEmbeddings,
  runAiSdkGenerateText,
  type AiSdkRuntimeContext
} from '../aiSdk'
import { normalizeAzureBaseUrl } from '../aiSdk/providerFactory'
import type { ProviderMcpRuntimePort } from '../runtimePorts'
import { proxyConfig } from '../../proxyConfig'

const OPENAI_IMAGE_GENERATION_MODELS = ['gpt-4o-all', 'gpt-4o-image']
const OPENAI_IMAGE_GENERATION_MODEL_PREFIXES = ['dall-e-', 'gpt-image-']

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

export class OpenAICompatibleProvider extends BaseLLMProvider {
  protected isNoModelsApi = false
  private static readonly NO_MODELS_API_LIST: string[] = []

  constructor(
    provider: LLM_PROVIDER,
    configPresenter: IConfigPresenter,
    mcpRuntime?: ProviderMcpRuntimePort
  ) {
    super(provider, configPresenter, mcpRuntime)
    if (OpenAICompatibleProvider.NO_MODELS_API_LIST.includes(this.provider.id.toLowerCase())) {
      this.isNoModelsApi = true
    }
    this.init()
  }

  protected isOfficialOpenAIService(): boolean {
    return this.provider.id === 'openai'
  }

  private isAzureOpenAI(): boolean {
    return this.provider.id === 'azure-openai'
  }

  private resolveTraceAuthToken(): string {
    return this.provider.oauthToken || this.provider.apiKey || 'MISSING_API_KEY'
  }

  protected buildTraceHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders
    }

    if (this.isAzureOpenAI()) {
      headers['api-key'] = this.resolveTraceAuthToken()
    } else {
      headers.Authorization = `Bearer ${this.resolveTraceAuthToken()}`
    }

    return headers
  }

  protected getEffectiveApiEndpoint(modelId: string): ApiEndpointType {
    const modelConfig = this.configPresenter.getModelConfig(modelId, this.provider.id)

    if (modelConfig?.apiEndpoint) {
      return modelConfig.apiEndpoint
    }

    if (isOpenAIImageGenerationModel(modelId)) {
      return ApiEndpointType.Image
    }

    return ApiEndpointType.Chat
  }

  protected getAiSdkRuntimeContext(): AiSdkRuntimeContext {
    const isAzureOpenAI = this.isAzureOpenAI()

    return {
      providerKind: isAzureOpenAI ? 'azure' : 'openai-compatible',
      provider: this.provider,
      configPresenter: this.configPresenter,
      defaultHeaders: this.defaultHeaders,
      buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
      emitRequestTrace: (modelConfig, payload) => this.emitRequestTrace(modelConfig, payload),
      buildTraceHeaders: () => this.buildTraceHeaders(),
      cleanHeaders: !this.isOfficialOpenAIService() && !isAzureOpenAI,
      supportsNativeTools: (_modelId, modelConfig) => modelConfig.functionCall === true,
      shouldUseImageGeneration: (modelId, modelConfig) =>
        isAzureOpenAI
          ? modelConfig.apiEndpoint === ApiEndpointType.Image
          : this.getEffectiveApiEndpoint(modelId) === ApiEndpointType.Image ||
            modelConfig.apiEndpoint === ApiEndpointType.Image
    }
  }

  protected getRequestHeaders(contentType?: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.defaultHeaders
    }

    if (contentType) {
      headers['Content-Type'] = contentType
    }

    if (this.isAzureOpenAI()) {
      headers['api-key'] = this.provider.apiKey
    } else {
      headers.Authorization = `Bearer ${this.provider.oauthToken || this.provider.apiKey}`
    }

    return headers
  }

  protected getFetchDispatcher(): ProxyAgent | undefined {
    const proxyUrl = proxyConfig.getProxyUrl()
    return proxyUrl ? new ProxyAgent(proxyUrl) : undefined
  }

  protected async requestProviderJson<T>(
    url: string,
    init: RequestInit = {},
    timeout?: number
  ): Promise<T> {
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

  protected buildModelsUrl(): string {
    if (this.isAzureOpenAI()) {
      const azureApiVersion = this.configPresenter.getSetting<string>('azureApiVersion')
      const azureConfig = normalizeAzureBaseUrl(this.provider.baseUrl || undefined, azureApiVersion)
      const baseURL = azureConfig.baseURL?.replace(/\/+$/, '') || ''
      return `${baseURL}/models?api-version=${encodeURIComponent(azureConfig.apiVersion)}`
    }

    const baseUrl = (this.provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    return `${baseUrl}/models`
  }

  protected async fetchOpenAIModelRecords(options?: {
    timeout: number
  }): Promise<Array<Record<string, unknown>>> {
    const payload = await this.requestProviderJson<unknown>(
      this.buildModelsUrl(),
      { method: 'GET' },
      options?.timeout
    )
    return toModelRecordArray(payload)
  }

  public onProxyResolved(): void {}

  protected async fetchProviderModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    if (this.isNoModelsApi) {
      return this.models
    }
    return this.fetchOpenAIModels(options)
  }

  protected async fetchOpenAIModels(options?: { timeout: number }): Promise<MODEL_META[]> {
    const response = await this.fetchOpenAIModelRecords(options)
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

  protected async openAICompletion(
    messages: ChatMessage[],
    modelId?: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<LLMResponse> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    return runAiSdkGenerateText(
      this.getAiSdkRuntimeContext(),
      messages,
      modelId,
      this.configPresenter.getModelConfig(modelId, this.provider.id),
      temperature,
      maxTokens
    )
  }

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    try {
      if (!this.isNoModelsApi) {
        this.models = await this.fetchOpenAIModels({ timeout: this.getModelFetchTimeout() })
      }

      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      const errorMessage = toErrorMessage(error, 'An unknown error occurred during provider check.')

      console.error('OpenAICompatibleProvider check failed:', error)

      eventBus.sendToRenderer(NOTIFICATION_EVENTS.SHOW_ERROR, SendTarget.ALL_WINDOWS, {
        title: 'API Check Failed',
        message: errorMessage,
        id: `openai-check-error-${Date.now()}`,
        type: 'error'
      })

      return { isOk: false, errorMsg: errorMessage }
    }
  }

  public async summaryTitles(messages: ChatMessage[], modelId: string): Promise<string> {
    const summaryText = `${SUMMARY_TITLES_PROMPT}\n\n${messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`
    const response = await this.openAICompletion(
      [{ role: 'user', content: summaryText }],
      modelId,
      0.5
    )
    return response.content.replace(/["']/g, '').trim()
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
        { role: 'system', content: 'Summarize the following text concisely:' },
        { role: 'user', content: text }
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
      [{ role: 'user', content: prompt }],
      modelId,
      temperature,
      maxTokens
    )
  }

  async suggestions(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string[]> {
    const lastUserMessage = messages.filter((message) => message.role === 'user').pop()

    if (!lastUserMessage) {
      return []
    }

    const response = await this.openAICompletion(
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

    yield* runAiSdkCoreStream(
      this.getAiSdkRuntimeContext(),
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens,
      mcpTools
    )
  }

  async getEmbeddings(modelId: string, texts: string[]): Promise<number[][]> {
    return runAiSdkEmbeddings(this.getAiSdkRuntimeContext(), modelId, texts)
  }

  async getDimensions(modelId: string): Promise<LLM_EMBEDDING_ATTRS> {
    switch (modelId) {
      case 'text-embedding-3-small':
      case 'text-embedding-ada-002':
        return {
          dimensions: 1536,
          normalized: true
        }
      case 'text-embedding-3-large':
        return {
          dimensions: 3072,
          normalized: true
        }
      default:
        try {
          const embeddings = await runAiSdkEmbeddings(this.getAiSdkRuntimeContext(), modelId, [
            EMBEDDING_TEST_KEY
          ])
          return {
            dimensions: embeddings[0].length,
            normalized: isNormalized(embeddings[0])
          }
        } catch (error) {
          console.error(
            `[OpenAICompatibleProvider] Failed to get dimensions for model ${modelId}:`,
            error
          )

          return runAiSdkDimensions(this.getAiSdkRuntimeContext(), modelId)
        }
    }
  }
}
