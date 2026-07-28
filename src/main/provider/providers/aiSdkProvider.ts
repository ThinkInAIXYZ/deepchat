import type { ProviderSettingsPort } from '@/provider/settings'
import { EMBEDDING_TEST_KEY, isNormalized } from '@/utils/vector'
import {
  ApiEndpointType,
  ModelType,
  isNewApiEndpointType,
  resolveNewApiModelTypeFromMetadata,
  resolveNewApiEndpointTypeFromRoute,
  type NewApiEndpointType
} from '@shared/model'
import { isTtsModelConfig, isTtsModelId } from '@shared/ttsSettings'
import { isVideoGenerationModelConfig } from '@shared/videoGenerationSettings'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { LLMResponse } from '@shared/types/provider'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type {
  AWS_BEDROCK_PROVIDER,
  KeyStatus,
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  ModelRouteConfig,
  ProviderStreamOptions,
  VERTEX_PROVIDER
} from '@shared/types/provider'
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { ProxyAgent } from 'undici'
import {
  BaseLLMProvider,
  SUMMARY_TITLES_PROMPT,
  type ProviderGenerateTextOptions
} from '../baseProvider'
import type { ProviderLocalePort } from '../ports'
import {
  runAiSdkCoreStream,
  runAiSdkDimensions,
  runAiSdkEmbeddings,
  runAiSdkGenerateText,
  type AiSdkRuntimeContext
} from '../aiSdk'
import type { AiSdkProviderKind } from '../aiSdk/providerFactory'
import { normalizeAzureBaseUrl, normalizeGeminiBaseUrl } from '../aiSdk/providerFactory'
import { shouldUseXaiGrokOAuthFetch } from '../xaiGrokAuthAdapter'
import { getGlobalXaiGrokAuth } from '../../provider/auth/xaiGrok'
import { isTrustedXaiApiEndpoint } from '../../provider/auth/xaiGrok/constants'
import { proxyConfig } from '../../platform/proxy'
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
import { providerDbLoader } from '../../provider/providerDbLoader'
import { modelCapabilities } from '../modelCapabilities'
import {
  buildResolvedCapabilitySnapshot,
  isOpenCodeGoAnthropicRoute,
  isZenmuxAnthropicRoute,
  resolveCapabilityFamilyHint,
  resolveCapabilityIdentity as resolveModelCapabilityIdentity
} from '../capabilityIdentity'
import type { ResolvedCapabilityIdentity } from '@shared/types/model-capabilities'

const OPENAI_IMAGE_GENERATION_MODELS = ['gpt-4o-all', 'gpt-4o-image']
const OPENAI_IMAGE_GENERATION_MODEL_PREFIXES = ['dall-e-', 'gpt-image-']
const OPENAI_CODEX_RECOMMENDED_MODEL_IDS = [
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark'
]
const GREENPT_RECOMMENDED_MODEL_IDS = [
  'glm-5.2',
  'kimi-k2.7-code',
  'green-embedding',
  'green-rerank'
]
const GREENPT_NON_OPENAI_MODEL_IDS = new Set(['green-s', 'green-s-pro'])
const DEFAULT_NEW_API_BASE_URL = 'https://www.newapi.ai'

type RouteDecision = {
  providerKind: AiSdkProviderKind
  providerPatch?: Partial<LLM_PROVIDER>
  modelConfigPatch?: Partial<ModelConfig>
  resolvedModelConfig?: ModelConfig
  endpointType?: NewApiEndpointType | 'grok-image'
  supportsOfficialAnthropicReasoning?: boolean
  capabilityIdentity?: ResolvedCapabilityIdentity
}

type ProviderRequestOptions = {
  timeout?: number
  signal?: AbortSignal
}

type StoredModelRouteMetadata = Pick<
  MODEL_META,
  'endpointType' | 'supportedEndpointTypes' | 'type' | 'ownedBy'
>

export interface AiSdkGenerateTextOptions extends ProviderGenerateTextOptions {
  systemPrompt?: string
}

type AudioTranscriptionResponse = {
  text?: unknown
}

class ProviderHttpError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ProviderHttpError'
    this.status = status
  }
}

const isOpenAIImageGenerationModel = (modelId: string): boolean =>
  OPENAI_IMAGE_GENERATION_MODELS.includes(modelId) ||
  OPENAI_IMAGE_GENERATION_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix))

const shouldUseOpenAIImageGenerationRoute = (modelId: string, modelConfig: ModelConfig): boolean =>
  isOpenAIImageGenerationModel(modelId) ||
  modelConfig.apiEndpoint === ApiEndpointType.Image ||
  modelConfig.type === ModelType.ImageGeneration

const shouldUseOpenAIVideoGenerationRoute = (modelId: string, modelConfig: ModelConfig): boolean =>
  modelConfig.apiEndpoint === ApiEndpointType.Video ||
  isVideoGenerationModelConfig(modelConfig, modelId)

const shouldUseOpenAITtsRoute = (modelId: string, modelConfig: ModelConfig): boolean =>
  isTtsModelConfig(modelConfig) ||
  modelConfig.apiEndpoint === ApiEndpointType.AudioSpeech ||
  isTtsModelId(modelId)

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

function toPositiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
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
  private definition: AiSdkProviderDefinition

  constructor(
    provider: LLM_PROVIDER,
    providerSettings: ProviderSettingsPort,
    locale: ProviderLocalePort
  ) {
    super(provider, providerSettings, locale)
    const definition = resolveAiSdkProviderDefinition(provider)
    if (!definition) {
      throw new Error(
        `No AI SDK definition found for provider ${provider.id} (${provider.apiType})`
      )
    }
    this.definition = definition
    this.init()
  }

  public override updateConfig(provider: LLM_PROVIDER): void {
    const definition = resolveAiSdkProviderDefinition(provider)
    if (!definition) {
      throw new Error(
        `No AI SDK definition found for provider ${provider.id} (${provider.apiType})`
      )
    }

    super.updateConfig(provider)
    this.definition = definition
  }

  private getRouteStrategy(): AiSdkRouteStrategy {
    return this.definition.routeStrategy ?? 'none'
  }

  private getBehaviorPreset(decision: RouteDecision): AiSdkBehaviorPreset {
    switch (this.getRouteStrategy()) {
      case 'new-api':
      case 'opencode-go':
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

  private getNormalizedNewApiGeminiBaseUrl(): string {
    return normalizeGeminiBaseUrl(this.provider.baseUrl || DEFAULT_NEW_API_BASE_URL)
  }

  private getStoredModel(modelId: string): MODEL_META | undefined {
    return (
      this.models.find((model) => model.id === modelId) ??
      this.customModels.find((model) => model.id === modelId)
    )
  }

  private getStoredModelRouteMetadata(
    modelId: string,
    routeConfig: ModelRouteConfig
  ): StoredModelRouteMetadata | undefined {
    return (
      this.providerSettings.getProviderModelRouteMetadata?.(
        this.provider.id,
        modelId,
        routeConfig
      ) ?? this.getStoredModel(modelId)
    )
  }

  private resolveCapabilityIdentity(
    modelId: string,
    endpointType: RouteDecision['endpointType'] | undefined,
    modelConfig: ModelRouteConfig,
    storedModel: StoredModelRouteMetadata | undefined
  ): ResolvedCapabilityIdentity {
    const ownedBy = storedModel?.ownedBy ?? modelConfig.ownedBy
    return resolveModelCapabilityIdentity({
      providerId: this.provider.id,
      modelId,
      ownedBy,
      endpointType: endpointType === 'grok-image' ? undefined : endpointType,
      explicitProviderId: this.provider.capabilityProviderId
    })
  }

  private resolveCapabilityIdentityFromProviderState(
    modelId: string,
    endpointType?: RouteDecision['endpointType']
  ): ResolvedCapabilityIdentity {
    const routeModelConfig = this.getRouteModelConfig(modelId)
    return this.resolveCapabilityIdentity(
      modelId,
      endpointType,
      routeModelConfig,
      this.getStoredModelRouteMetadata(modelId, routeModelConfig)
    )
  }

  private getRuntimeCapabilityProviderId(
    identity: ResolvedCapabilityIdentity,
    endpointType?: NewApiEndpointType
  ): string {
    if (endpointType === 'anthropic') {
      return 'anthropic'
    }
    if (endpointType === 'gemini') {
      return 'google'
    }
    return identity.providerId
  }

  private usesOfficialAnthropicReasoning(): boolean {
    return this.provider.id.trim().toLowerCase() === 'anthropic'
  }

  private resolveNewApiEndpointType(
    modelId: string,
    modelConfig: ModelRouteConfig,
    storedModel: StoredModelRouteMetadata | undefined
  ): NewApiEndpointType {
    if (isNewApiEndpointType(modelConfig.endpointType)) {
      return modelConfig.endpointType
    }

    if (storedModel && isNewApiEndpointType(storedModel.endpointType)) {
      return storedModel.endpointType
    }

    const ownedBy = storedModel?.ownedBy ?? modelConfig.ownedBy
    const capabilityFamilyHint = resolveCapabilityFamilyHint(modelId, ownedBy)
    return resolveNewApiEndpointTypeFromRoute(
      storedModel
        ? {
            endpointType: storedModel.endpointType,
            supportedEndpointTypes: storedModel.supportedEndpointTypes,
            type: storedModel.type,
            ownedBy,
            capabilityFamilyHint
          }
        : {
            ownedBy,
            capabilityFamilyHint
          },
      modelId
    )
  }

  private buildRouteDecision(modelId: string, modelConfig: ModelRouteConfig): RouteDecision {
    const strategy = this.getRouteStrategy()
    const storedModel = this.getStoredModelRouteMetadata(modelId, modelConfig)

    if (strategy === 'grok' && modelId.startsWith('grok-2-image')) {
      return {
        providerKind: this.definition.runtimeKind,
        endpointType: 'grok-image',
        capabilityIdentity: this.resolveCapabilityIdentity(
          modelId,
          undefined,
          modelConfig,
          storedModel
        ),
        modelConfigPatch: {
          apiEndpoint: ApiEndpointType.Image
        }
      }
    }

    if (strategy === 'zenmux' && isZenmuxAnthropicRoute(this.provider.id, modelId)) {
      const capabilityIdentity = this.resolveCapabilityIdentity(
        modelId,
        undefined,
        modelConfig,
        storedModel
      )
      return {
        providerKind: 'openai-compatible',
        capabilityIdentity,
        providerPatch: {
          apiType: 'openai-completions',
          capabilityProviderId: capabilityIdentity.providerId
        }
      }
    }

    if (strategy === 'opencode-go' && isOpenCodeGoAnthropicRoute(this.provider.id, modelId)) {
      const capabilityIdentity = this.resolveCapabilityIdentity(
        modelId,
        undefined,
        modelConfig,
        storedModel
      )
      return {
        providerKind: 'anthropic',
        capabilityIdentity,
        providerPatch: {
          apiType: 'anthropic',
          baseUrl: this.provider.baseUrl,
          capabilityProviderId: capabilityIdentity.providerId
        }
      }
    }

    if (strategy === 'new-api') {
      const endpointType = this.resolveNewApiEndpointType(modelId, modelConfig, storedModel)
      const capabilityIdentity = this.resolveCapabilityIdentity(
        modelId,
        endpointType,
        modelConfig,
        storedModel
      )
      const capabilityProviderId = this.getRuntimeCapabilityProviderId(
        capabilityIdentity,
        endpointType
      )
      const host = this.getNormalizedNewApiHost()

      switch (endpointType) {
        case 'anthropic':
          return {
            providerKind: 'anthropic',
            endpointType,
            capabilityIdentity,
            supportsOfficialAnthropicReasoning: true,
            providerPatch: {
              apiType: 'anthropic',
              baseUrl: host,
              capabilityProviderId
            }
          }
        case 'gemini':
          return {
            providerKind: 'gemini',
            endpointType,
            capabilityIdentity,
            providerPatch: {
              apiType: 'gemini',
              baseUrl: this.getNormalizedNewApiGeminiBaseUrl(),
              capabilityProviderId
            }
          }
        case 'openai-response':
          return {
            providerKind: 'openai-responses',
            endpointType,
            capabilityIdentity,
            providerPatch: {
              apiType: 'openai-responses',
              baseUrl: `${host}/v1`,
              capabilityProviderId
            }
          }
        case 'image-generation':
          return {
            providerKind: 'openai-compatible',
            endpointType,
            capabilityIdentity,
            providerPatch: {
              apiType: 'openai-completions',
              baseUrl: `${host}/v1`,
              capabilityProviderId
            },
            modelConfigPatch: {
              apiEndpoint: ApiEndpointType.Image,
              type: ModelType.ImageGeneration,
              endpointType: 'image-generation'
            }
          }
        case 'video-generation':
          return {
            providerKind: 'openai-compatible',
            endpointType,
            capabilityIdentity,
            providerPatch: {
              apiType: 'openai-completions',
              baseUrl: `${host}/v1`,
              capabilityProviderId
            },
            modelConfigPatch: {
              apiEndpoint: ApiEndpointType.Video,
              type: ModelType.VideoGeneration,
              endpointType: 'video-generation'
            }
          }
        case 'openai':
        default:
          return {
            providerKind: 'openai-compatible',
            endpointType,
            capabilityIdentity,
            providerPatch: {
              apiType: 'openai-completions',
              baseUrl: `${host}/v1`,
              capabilityProviderId
            }
          }
      }
    }

    const supportsOfficialAnthropicReasoning = this.usesOfficialAnthropicReasoning()

    return {
      providerKind: this.definition.runtimeKind,
      capabilityIdentity: this.resolveCapabilityIdentity(
        modelId,
        undefined,
        modelConfig,
        storedModel
      ),
      ...(supportsOfficialAnthropicReasoning ? { supportsOfficialAnthropicReasoning } : {})
    }
  }

  private resolveRouteDecision(modelId: string, modelConfig?: ModelConfig): RouteDecision {
    const routeModelConfig = this.getRouteModelConfig(modelId, modelConfig)
    const decision = this.buildRouteDecision(modelId, routeModelConfig)
    const resolvedModelConfig = {
      ...this.providerSettings.getModelConfig(
        modelId,
        this.provider.id,
        decision.capabilityIdentity
      ),
      ...modelConfig
    }
    return {
      ...decision,
      resolvedModelConfig
    }
  }

  private getRuntimeProvider(decision: RouteDecision): LLM_PROVIDER {
    const base: LLM_PROVIDER = {
      ...this.provider,
      ...decision.providerPatch
    }

    if (shouldUseXaiGrokOAuthFetch(base)) {
      const oauthToken = getGlobalXaiGrokAuth().peekAccessToken()
      if (oauthToken) {
        return {
          ...base,
          oauthToken
        }
      }
    }

    return base
  }

  private getRouteModelConfig(modelId: string, modelConfig?: ModelConfig): ModelRouteConfig {
    const routeConfig = this.providerSettings.getModelRouteConfig
      ? this.providerSettings.getModelRouteConfig(modelId, this.provider.id)
      : this.providerSettings.getModelConfig(modelId, this.provider.id)
    return {
      ...routeConfig,
      ...modelConfig
    }
  }

  private getModelConfigForDecision(
    modelId: string,
    decision: RouteDecision,
    modelConfig?: ModelConfig
  ): ModelConfig {
    return {
      ...(decision.resolvedModelConfig ??
        this.providerSettings.getModelConfig(
          modelId,
          this.provider.id,
          decision.capabilityIdentity
        )),
      ...modelConfig,
      ...decision.modelConfigPatch
    }
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

  private usesGeminiApiKeyHeader(runtimeProvider: LLM_PROVIDER): boolean {
    return runtimeProvider.apiType === 'gemini'
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
    } else if (decision.providerKind === 'openai-codex') {
      headers.Authorization = 'Bearer OPENAI_CODEX_OAUTH'
    } else if (this.usesGeminiApiKeyHeader(runtimeProvider)) {
      headers['x-goog-api-key'] = this.resolveTraceAuthToken(runtimeProvider)
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
    } else if (this.usesGeminiApiKeyHeader(runtimeProvider)) {
      headers['x-goog-api-key'] = runtimeProvider.oauthToken || runtimeProvider.apiKey
    } else {
      headers.Authorization = `Bearer ${runtimeProvider.oauthToken || runtimeProvider.apiKey}`
    }

    return headers
  }

  private buildModelsUrl(decision: RouteDecision, runtimeProvider: LLM_PROVIDER): string {
    if (this.isAzureOpenAI(decision, runtimeProvider)) {
      const azureApiVersion = this.providerSettings.getAzureApiVersion()
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
    decision: RouteDecision,
    modelConfig?: ModelConfig
  ): { context: AiSdkRuntimeContext; decision: RouteDecision; resolvedModelConfig: ModelConfig } {
    const runtimeProvider = this.getRuntimeProvider(decision)
    const defaultHeaders = {
      ...this.defaultHeaders,
      ...this.definition.defaultHeadersPatch
    }
    const resolvedModelConfig = this.getModelConfigForDecision(modelId, decision, modelConfig)
    const capabilityIdentity =
      decision.capabilityIdentity ??
      this.resolveCapabilityIdentityFromProviderState(modelId, decision.endpointType)
    const capabilitySnapshot = buildResolvedCapabilitySnapshot(capabilityIdentity, {
      reasoningEnabled: resolvedModelConfig.reasoning
    })

    const cleanHeaders =
      this.isAzureOpenAI(decision, runtimeProvider) || runtimeProvider.id === 'kimi-for-coding'
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
                  shouldUseOpenAIImageGenerationRoute(runtimeModelId, runtimeModelConfig)
              : decision.providerKind === 'openai-compatible'
                ? (runtimeModelId: string, runtimeModelConfig: ModelConfig) =>
                    shouldUseOpenAIImageGenerationRoute(runtimeModelId, runtimeModelConfig)
                : (runtimeModelId: string, runtimeModelConfig: ModelConfig) =>
                    isOpenAIImageGenerationModel(runtimeModelId) ||
                    runtimeModelConfig.apiEndpoint === ApiEndpointType.Image

    const shouldUseVideoGeneration =
      this.isAzureOpenAI(decision, runtimeProvider) ||
      decision.providerKind === 'gemini' ||
      decision.providerKind === 'vertex' ||
      decision.providerKind === 'anthropic'
        ? undefined
        : decision.endpointType === 'video-generation'
          ? () => true
          : (runtimeModelId: string, runtimeModelConfig: ModelConfig) =>
              shouldUseOpenAIVideoGenerationRoute(runtimeModelId, runtimeModelConfig)

    // TTS route: only applicable for OpenAI-compatible providers (not Azure, Gemini, Vertex)
    const shouldUseTts =
      this.isAzureOpenAI(decision, runtimeProvider) ||
      decision.providerKind === 'gemini' ||
      decision.providerKind === 'vertex' ||
      decision.providerKind === 'anthropic'
        ? undefined
        : (runtimeModelId: string, runtimeModelConfig: ModelConfig) =>
            shouldUseOpenAITtsRoute(runtimeModelId, runtimeModelConfig)

    return {
      decision,
      resolvedModelConfig,
      context: {
        providerKind: decision.providerKind,
        provider: runtimeProvider,
        capabilitySnapshot,
        supportsOfficialAnthropicReasoning: decision.supportsOfficialAnthropicReasoning,
        providerSettings: this.providerSettings,
        defaultHeaders,
        buildLegacyFunctionCallPrompt: (tools) => this.getFunctionCallWrapPrompt(tools),
        emitRequestTrace: (runtimeModelConfig, payload) =>
          this.emitRequestTrace(runtimeModelConfig, payload),
        buildTraceHeaders: () => this.buildTraceHeaders(decision, runtimeProvider, defaultHeaders),
        cleanHeaders,
        supportsNativeTools: (_runtimeModelId, runtimeModelConfig) =>
          runtimeModelConfig.functionCall === true,
        shouldUseImageGeneration,
        shouldUseVideoGeneration,
        shouldUseTts
      }
    }
  }

  public async requestProviderJson<T>(
    url: string,
    init: RequestInit = {},
    options?: number | ProviderRequestOptions,
    decision?: RouteDecision
  ): Promise<T> {
    const resolvedDecision = decision ?? { providerKind: this.definition.runtimeKind }
    const defaultHeaders = {
      ...this.defaultHeaders,
      ...this.definition.defaultHeadersPatch
    }
    const resolvedOptions =
      typeof options === 'number'
        ? { timeout: options }
        : (options ?? ({} as ProviderRequestOptions))
    const controller = new AbortController()
    const timeoutId =
      typeof resolvedOptions.timeout === 'number' && resolvedOptions.timeout > 0
        ? setTimeout(() => controller.abort(), resolvedOptions.timeout)
        : undefined
    const externalSignal = resolvedOptions.signal
    const onExternalAbort = () => {
      controller.abort(externalSignal?.reason)
    }

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason)
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    try {
      // Refresh Grok OAuth tokens before model/list requests that use sync headers.
      const runtimeProvider = this.getRuntimeProvider(resolvedDecision)
      const useGrokOAuth =
        shouldUseXaiGrokOAuthFetch(runtimeProvider) && isTrustedXaiApiEndpoint(url)
      if (useGrokOAuth) {
        await getGlobalXaiGrokAuth()
          .ensureAccessToken()
          .catch(() => null)
      }
      const refreshedRuntimeProvider = this.getRuntimeProvider(resolvedDecision)
      const requestRuntimeProvider = useGrokOAuth
        ? refreshedRuntimeProvider
        : { ...refreshedRuntimeProvider, oauthToken: undefined }
      const dispatcher = this.getFetchDispatcher()
      const response = await fetch(url, {
        ...init,
        headers: {
          ...this.getRequestHeaders(
            resolvedDecision,
            requestRuntimeProvider,
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
        throw new ProviderHttpError(
          errorText || `Request failed with status ${response.status}`,
          response.status
        )
      }

      return (await response.json()) as T
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  private supportsDirectAudioTranscription(decision: RouteDecision, runtimeProvider: LLM_PROVIDER) {
    return (
      !this.isAzureOpenAI(decision, runtimeProvider) &&
      (decision.providerKind === 'openai-compatible' ||
        decision.providerKind === 'openai-responses')
    )
  }

  private buildAudioTranscriptionsUrl(runtimeProvider: LLM_PROVIDER): string {
    const baseUrl = (runtimeProvider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    return `${baseUrl}/audio/transcriptions`
  }

  private shouldFallbackAudioTranscription(
    decision: RouteDecision,
    runtimeProvider: LLM_PROVIDER,
    error: unknown
  ): boolean {
    if (this.isOfficialOpenAIService(decision, runtimeProvider)) {
      return false
    }

    if (error instanceof ProviderHttpError) {
      return [400, 404, 405, 415, 422, 501].includes(error.status ?? -1)
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      return (
        message.includes('audio/transcriptions') ||
        message.includes('not found') ||
        message.includes('unsupported') ||
        message.includes('invalid audio transcription response')
      )
    }

    return false
  }

  public override async transcribeAudio(
    modelId: string,
    audioBase64: string,
    mimeType: string,
    filename?: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    const decision = this.resolveRouteDecision(modelId)
    const runtimeProvider = this.getRuntimeProvider(decision)
    if (!this.supportsDirectAudioTranscription(decision, runtimeProvider)) {
      throw this.createAudioTranscriptionNotSupportedError()
    }

    const normalizedAudioBase64 = audioBase64.replace(/\s/g, '').trim()
    if (!normalizedAudioBase64) {
      throw new Error('Audio data is required for transcription')
    }

    const normalizedMimeType = mimeType.trim() || 'audio/wav'
    const normalizedFilename = filename?.trim() || 'recording.wav'
    const audioBuffer = Buffer.from(normalizedAudioBase64, 'base64')
    const formData = new FormData()
    formData.append(
      'file',
      new Blob([audioBuffer], { type: normalizedMimeType }),
      normalizedFilename
    )
    formData.append('model', modelId)

    let payload: AudioTranscriptionResponse
    try {
      payload = await this.requestProviderJson<AudioTranscriptionResponse>(
        this.buildAudioTranscriptionsUrl(runtimeProvider),
        {
          method: 'POST',
          body: formData
        },
        {
          timeout: this.resolveModelRequestTimeout(
            this.getModelConfigForDecision(modelId, decision)
          ),
          signal: options?.signal
        },
        decision
      )
    } catch (error) {
      if (this.shouldFallbackAudioTranscription(decision, runtimeProvider, error)) {
        throw this.createAudioTranscriptionNotSupportedError()
      }

      throw error
    }

    if (typeof payload.text !== 'string') {
      if (
        this.shouldFallbackAudioTranscription(
          decision,
          runtimeProvider,
          new Error('invalid audio transcription response')
        )
      ) {
        throw this.createAudioTranscriptionNotSupportedError()
      }
      throw new Error('Invalid audio transcription response')
    }

    return payload.text
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
        ...(typeof model.owned_by === 'string' && model.owned_by.trim().length > 0
          ? { ownedBy: model.owned_by.trim() }
          : {})
      })
    }

    return models
  }

  private assertModelRequestReady(modelId: string): void {
    if (!this.isInitialized) {
      throw new Error('Provider not initialized')
    }
    if (!modelId) {
      throw new Error('Model ID is required')
    }
  }

  private resolveRequestRouteDecision(modelId: string, modelConfig?: ModelConfig): RouteDecision {
    this.assertModelRequestReady(modelId)
    return this.resolveRouteDecision(modelId, modelConfig)
  }

  private async runTextWithDecision(
    messages: ChatMessage[],
    modelId: string,
    decision: RouteDecision,
    temperature?: number,
    maxTokens?: number,
    modelConfig?: ModelConfig,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    this.assertModelRequestReady(modelId)
    const { context, resolvedModelConfig } = this.buildRuntimeContext(
      modelId,
      decision,
      modelConfig
    )
    if (signal) {
      return runAiSdkGenerateText(
        context,
        messages,
        modelId,
        resolvedModelConfig,
        temperature,
        maxTokens,
        signal
      )
    }
    return runAiSdkGenerateText(
      context,
      messages,
      modelId,
      resolvedModelConfig,
      temperature,
      maxTokens
    )
  }

  public async runText(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    modelConfig?: ModelConfig,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const decision = this.resolveRequestRouteDecision(modelId, modelConfig)
    return this.runTextWithDecision(
      messages,
      modelId,
      decision,
      temperature,
      maxTokens,
      modelConfig,
      signal
    )
  }

  private async *streamTextWithDecision(
    messages: ChatMessage[],
    modelId: string,
    decision: RouteDecision,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[],
    signal?: AbortSignal
  ): AsyncGenerator<LLMCoreStreamEvent> {
    this.assertModelRequestReady(modelId)
    const { context, resolvedModelConfig } = this.buildRuntimeContext(
      modelId,
      decision,
      modelConfig
    )
    if (signal) {
      yield* runAiSdkCoreStream(
        context,
        messages,
        modelId,
        resolvedModelConfig,
        temperature,
        maxTokens,
        tools,
        signal
      )
      return
    }
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

  public async *streamText(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[],
    signal?: AbortSignal
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const decision = this.resolveRequestRouteDecision(modelId, modelConfig)
    yield* this.streamTextWithDecision(
      messages,
      modelId,
      decision,
      modelConfig,
      temperature,
      maxTokens,
      tools,
      signal
    )
  }

  private async collectStreamResponseWithDecision(
    messages: ChatMessage[],
    modelId: string,
    decision: RouteDecision,
    temperature?: number,
    maxTokens?: number,
    tools: MCPToolDefinition[] = [],
    modelConfig?: ModelConfig,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const response: LLMResponse = {
      content: ''
    }
    const resolvedModelConfig = this.getModelConfigForDecision(
      modelId,
      decision,
      modelConfig ?? ({ apiEndpoint: ApiEndpointType.Image } as ModelConfig)
    )

    for await (const event of this.streamTextWithDecision(
      messages,
      modelId,
      decision,
      resolvedModelConfig,
      temperature ?? resolvedModelConfig.temperature ?? 0.7,
      maxTokens ?? resolvedModelConfig.maxTokens ?? 1024,
      tools,
      signal
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

  public async collectStreamResponse(
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    tools: MCPToolDefinition[] = [],
    modelConfig?: ModelConfig,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const decision = this.resolveRequestRouteDecision(modelId, modelConfig)
    return this.collectStreamResponseWithDecision(
      messages,
      modelId,
      decision,
      temperature,
      maxTokens,
      tools,
      modelConfig,
      signal
    )
  }

  public async runEmbeddings(
    modelId: string,
    texts: string[],
    signal?: AbortSignal
  ): Promise<number[][]> {
    const decision = this.resolveRouteDecision(modelId)
    const { context } = this.buildRuntimeContext(modelId, decision)
    return runAiSdkEmbeddings(context, modelId, texts, signal)
  }

  private buildEmbeddingRuntimeContext(
    modelId: string,
    decision: RouteDecision
  ): AiSdkRuntimeContext {
    const runtimeProvider = this.getRuntimeProvider(decision)
    const capabilityIdentity =
      decision.capabilityIdentity ??
      this.resolveCapabilityIdentityFromProviderState(modelId, decision.endpointType)
    const defaultHeaders = {
      ...this.defaultHeaders,
      ...this.definition.defaultHeadersPatch
    }

    return {
      providerKind: decision.providerKind,
      provider: runtimeProvider,
      capabilitySnapshot: buildResolvedCapabilitySnapshot(capabilityIdentity),
      supportsOfficialAnthropicReasoning: decision.supportsOfficialAnthropicReasoning,
      providerSettings: this.providerSettings,
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
  }

  private async runEmbeddingsWithDecision(
    modelId: string,
    texts: string[],
    decision: RouteDecision,
    signal?: AbortSignal
  ): Promise<number[][]> {
    const context = this.buildEmbeddingRuntimeContext(modelId, decision)
    return runAiSdkEmbeddings(context, modelId, texts, signal)
  }

  public async runDimensions(modelId: string, signal?: AbortSignal): Promise<LLM_EMBEDDING_ATTRS> {
    signal?.throwIfAborted()

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
      const embeddings = await this.runEmbeddings(modelId, [EMBEDDING_TEST_KEY], signal)
      return {
        dimensions: embeddings[0].length,
        normalized: isNormalized(embeddings[0])
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error
      }
      console.error(`[AiSdkProvider] Failed to get dimensions for model ${modelId}:`, error)
      const decision = this.resolveRouteDecision(modelId)
      const { context } = this.buildRuntimeContext(modelId, decision)
      return runAiSdkDimensions(context, modelId, signal)
    }
  }

  private async runDimensionsWithDecision(
    modelId: string,
    decision: RouteDecision,
    signal?: AbortSignal
  ): Promise<LLM_EMBEDDING_ATTRS> {
    try {
      const embeddings = await this.runEmbeddingsWithDecision(
        modelId,
        [EMBEDDING_TEST_KEY],
        decision,
        signal
      )
      return {
        dimensions: embeddings[0].length,
        normalized: isNormalized(embeddings[0])
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error
      }
      console.error(`[AiSdkProvider] Failed to get dimensions for model ${modelId}:`, error)
      const context = this.buildEmbeddingRuntimeContext(modelId, decision)
      return runAiSdkDimensions(context, modelId, signal)
    }
  }

  private mapConfigDbModels(providerId = this.provider.id): MODEL_META[] {
    return this.mapProviderDbModels('default', providerId)
  }

  private async fetchAnthropicModelsWithFallback(): Promise<MODEL_META[]> {
    const fallbackModels = this.mapConfigDbModels(this.definition.providerDbSourceId)
    const apiKey = this.provider.apiKey?.trim()
    if (!apiKey) {
      return fallbackModels
    }

    const normalizedBaseUrl = (this.provider.baseUrl || 'https://api.anthropic.com')
      .trim()
      .replace(/\/+$/, '')
    const modelsUrl = /\/v1$/i.test(normalizedBaseUrl)
      ? `${normalizedBaseUrl}/models`
      : `${normalizedBaseUrl}/v1/models`
    const { signal, dispose } = this.createModelRequestSignal(null)

    try {
      const dispatcher = this.getFetchDispatcher()
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
          ...this.defaultHeaders,
          ...this.definition.defaultHeadersPatch
        },
        signal,
        ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {})
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Failed to fetch Anthropic models: ${response.status}`)
      }

      const payload = (await response.json()) as {
        data?: Array<{ id?: string; display_name?: string }>
      }

      const models = Array.isArray(payload.data)
        ? payload.data
            .filter((model): model is { id: string; display_name?: string } => !!model?.id)
            .map((model) => ({
              id: model.id,
              name: model.display_name || model.id,
              providerId: this.provider.id,
              group: 'Claude',
              isCustom: false
            }))
        : []

      return models.length > 0 ? models : fallbackModels
    } catch (error) {
      console.error('Failed to fetch Anthropic models:', error)
      if (fallbackModels.length > 0 && !this.provider.custom) {
        return fallbackModels
      }
      throw error
    } finally {
      dispose()
    }
  }

  private async fetchGeminiModelsWithFallback(): Promise<MODEL_META[]> {
    const fallbackModels = this.mapConfigDbModels(this.definition.providerDbSourceId)
    const apiKey = this.provider.apiKey?.trim()
    if (!apiKey) {
      return fallbackModels
    }

    const modelsUrl = `${normalizeGeminiBaseUrl(this.provider.baseUrl || undefined).replace(/\/+$/, '')}/models`
    const { signal, dispose } = this.createModelRequestSignal(null)

    try {
      const dispatcher = this.getFetchDispatcher()
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          ...this.defaultHeaders,
          ...this.definition.defaultHeadersPatch
        },
        signal,
        ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {})
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Failed to fetch Gemini models: ${response.status}`)
      }

      const payload = (await response.json()) as {
        models?: Array<{
          name?: string
          displayName?: string
          inputTokenLimit?: number
          outputTokenLimit?: number
        }>
      }

      const models = Array.isArray(payload.models)
        ? payload.models
            .filter(
              (
                model
              ): model is {
                name: string
                displayName?: string
                inputTokenLimit?: number
                outputTokenLimit?: number
              } => !!model?.name
            )
            .filter((model) => {
              const lowerName = model.name.toLowerCase()
              return (
                !lowerName.includes('embedding') &&
                !lowerName.includes('aqa') &&
                !lowerName.includes('text-embedding') &&
                !lowerName.includes('gemma-3n-e4b-it')
              )
            })
            .map((model) => {
              const contextLength = toPositiveFiniteNumber(model.inputTokenLimit)
              const maxTokens = toPositiveFiniteNumber(model.outputTokenLimit)
              return {
                id: model.name,
                name: model.displayName || model.name,
                group: /\b(exp|preview)\b/i.test(model.name)
                  ? 'experimental'
                  : /\bgemma\b/i.test(model.name)
                    ? 'gemma'
                    : 'default',
                providerId: this.provider.id,
                isCustom: false,
                ...(contextLength !== undefined ? { contextLength } : {}),
                ...(maxTokens !== undefined ? { maxTokens } : {})
              }
            })
        : []

      return models.length > 0 ? models : fallbackModels
    } catch (error) {
      console.error('Failed to fetch Gemini models:', error)
      if (fallbackModels.length > 0 && !this.provider.custom) {
        return fallbackModels
      }
      throw error
    } finally {
      dispose()
    }
  }

  private async fetchConfigDbModels(): Promise<MODEL_META[]> {
    if (!this.provider.custom) {
      return this.mapConfigDbModels(this.definition.providerDbSourceId)
    }

    switch (this.definition.runtimeKind) {
      case 'anthropic':
        return this.fetchAnthropicModelsWithFallback()
      case 'gemini':
        return this.fetchGeminiModelsWithFallback()
      default:
        return this.mapConfigDbModels(this.definition.providerDbSourceId)
    }
  }

  private mapProviderDbModels(
    group: string,
    sourceId = this.definition.providerDbSourceId || this.provider.id
  ): MODEL_META[] {
    const resolvedId = modelCapabilities.resolveProviderId(sourceId) || sourceId
    const provider = providerDbLoader.getProvider(resolvedId)
    if (!provider || !Array.isArray(provider.models)) {
      return []
    }

    return provider.models.map((model) => ({
      id: model.id,
      name: model.display_name || model.name || model.id,
      group,
      providerId: this.provider.id,
      isCustom: false
    }))
  }

  private mapOpenAICodexModels(): MODEL_META[] {
    const models = this.mapProviderDbModels(this.definition.providerDbGroup || 'Codex')
    const modelsById = new Map(models.map((model) => [model.id, model]))
    const recommended = OPENAI_CODEX_RECOMMENDED_MODEL_IDS.flatMap((id) => {
      const model = modelsById.get(id)
      return model ? [model] : []
    })

    if (recommended.length > 0) {
      return recommended
    }

    return models.filter(
      (model) =>
        model.id.toLowerCase().includes('codex') || model.name.toLowerCase().includes('codex')
    )
  }

  private mapKimiForCodingModels(): MODEL_META[] {
    const models = this.mapProviderDbModels(this.definition.providerDbGroup || 'Kimi Code')
    const stableModel = models.find((model) => model.id === 'kimi-for-coding')
    return stableModel ? [stableModel] : models
  }

  private async fetchProviderModelsByStrategy(
    strategy: AiSdkModelSourceStrategy
  ): Promise<MODEL_META[]> {
    switch (strategy) {
      case 'config-db':
        return this.fetchConfigDbModels()
      case 'provider-db':
        return this.mapProviderDbModels(this.definition.providerDbGroup || 'default')
      case 'openai-codex':
        return this.mapOpenAICodexModels()
      case 'opencode-go':
        return this.fetchOpenCodeGoModels()
      case 'kimi-for-coding':
        return this.mapKimiForCodingModels()
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
            description: typeof model.description === 'string' ? model.description : undefined
          }))
      }
      case 'greenpt': {
        const response = await this.fetchOpenAIModelRecords({
          timeout: this.getModelFetchTimeout()
        })
        const priority = new Map(
          GREENPT_RECOMMENDED_MODEL_IDS.map((modelId, index) => [modelId, index])
        )

        return response
          .filter(
            (model) => typeof model.id === 'string' && !GREENPT_NON_OPENAI_MODEL_IDS.has(model.id)
          )
          .map((model) => {
            const id = model.id as string
            const type = id.includes('embedding')
              ? ModelType.Embedding
              : id.includes('rerank')
                ? ModelType.Rerank
                : ModelType.Chat

            return {
              id,
              name: id,
              group: type === ModelType.Chat ? 'Chat' : type,
              providerId: this.provider.id,
              isCustom: false,
              type,
              ownedBy: typeof model.owned_by === 'string' ? model.owned_by : undefined
            } satisfies MODEL_META
          })
          .sort(
            (a, b) =>
              (priority.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (priority.get(b.id) ?? Number.MAX_SAFE_INTEGER)
          )
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
            isCustom: false
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
            isCustom: false
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

        const rawFeatures = model.features
        const hasFeatureFacts = Array.isArray(rawFeatures)
        const features = Array.isArray(rawFeatures)
          ? rawFeatures.filter((item): item is string => typeof item === 'string')
          : []
        const rawSupportedParameters = model.supported_parameters
        const hasSupportedParameterFacts = Array.isArray(rawSupportedParameters)
        const supportedParameters = Array.isArray(rawSupportedParameters)
          ? rawSupportedParameters.filter((item): item is string => typeof item === 'string')
          : []
        const hasInputModalityFacts = Array.isArray(
          (model.architecture as Record<string, unknown>)?.input_modalities
        )
        const inputModalities = hasInputModalityFacts
          ? ((model.architecture as Record<string, unknown>).input_modalities as unknown[]).filter(
              (item): item is string => typeof item === 'string'
            )
          : []

        const contextLength =
          strategy === 'openrouter'
            ? (toPositiveFiniteNumber(model.context_length) ??
              toPositiveFiniteNumber(
                (model.top_provider as Record<string, unknown>)?.context_length
              ))
            : strategy === 'ppio'
              ? toPositiveFiniteNumber(model.context_size)
              : strategy === 'groq'
                ? (toPositiveFiniteNumber(model.context_size) ??
                  toPositiveFiniteNumber(model.context_window))
                : strategy === 'tokenflux'
                  ? toPositiveFiniteNumber(model.context_length)
                  : toPositiveFiniteNumber(model.content_length)

        const maxTokens =
          strategy === 'openrouter'
            ? toPositiveFiniteNumber(
                (model.top_provider as Record<string, unknown>)?.max_completion_tokens
              )
            : strategy === 'ppio'
              ? toPositiveFiniteNumber(model.max_output_tokens)
              : strategy === 'groq'
                ? (toPositiveFiniteNumber(model.max_output_tokens) ??
                  toPositiveFiniteNumber(model.max_tokens))
                : strategy === 'tokenflux'
                  ? undefined
                  : toPositiveFiniteNumber(model.max_completion_tokens)

        const hasFunctionCalling =
          strategy === 'openrouter'
            ? hasSupportedParameterFacts
              ? supportedParameters.includes('tools')
              : undefined
            : strategy === 'ppio'
              ? hasFeatureFacts
                ? features.includes('function-calling')
                : undefined
              : strategy === 'groq'
                ? hasFeatureFacts
                  ? features.includes('function-calling')
                  : undefined
                : strategy === 'tokenflux'
                  ? undefined
                  : typeof model.supported_tools === 'boolean'
                    ? model.supported_tools
                    : undefined

        const hasVision =
          strategy === 'openrouter'
            ? hasInputModalityFacts
              ? inputModalities.includes('image')
              : undefined
            : strategy === 'ppio'
              ? hasFeatureFacts
                ? features.includes('vision')
                : undefined
              : strategy === 'groq'
                ? hasFeatureFacts
                  ? features.includes('vision')
                  : undefined
                : strategy === 'tokenflux'
                  ? typeof model.supports_vision === 'boolean'
                    ? model.supports_vision
                    : undefined
                  : typeof model.supports_vision === 'boolean'
                    ? model.supports_vision
                    : hasInputModalityFacts
                      ? inputModalities.includes('image')
                      : undefined

        const reasoning =
          strategy === 'openrouter' && hasSupportedParameterFacts
            ? supportedParameters.includes('reasoning') ||
              supportedParameters.includes('include_reasoning')
            : undefined

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
          ...(contextLength !== undefined ? { contextLength } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          description:
            typeof model.description === 'string'
              ? model.description
              : strategy === 'groq'
                ? `Groq model ${modelId}`
                : undefined,
          ...(hasVision !== undefined ? { vision: hasVision } : {}),
          ...(hasFunctionCalling !== undefined ? { functionCall: hasFunctionCalling } : {}),
          ...(reasoning !== undefined ? { reasoning } : {})
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
    const credential = provider.credential
    const region = credential?.region || process.env.AWS_REGION
    const useProfile = credential?.authMode === 'profile' && credential?.profile

    if (!useProfile) {
      const accessKeyId = credential?.accessKeyId || process.env.AWS_ACCESS_KEY_ID
      const secretAccessKey = credential?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY
      if (!accessKeyId || !secretAccessKey || !region) {
        return this.mapConfigDbModels(this.definition.providerDbSourceId).filter((model) =>
          model.id.startsWith('anthropic.')
        )
      }
    }

    if (!region) {
      return this.mapConfigDbModels(this.definition.providerDbSourceId).filter((model) =>
        model.id.startsWith('anthropic.')
      )
    }

    try {
      const clientConfig: Record<string, unknown> = { region }
      if (useProfile) {
        clientConfig.credentials = fromNodeProviderChain({ profile: credential.profile })
      } else {
        clientConfig.credentials = {
          accessKeyId: credential?.accessKeyId || process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: credential?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY
        }
      }
      const client = new BedrockClient(clientConfig as any)
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
            group: `AWS Bedrock Claude - ${
              model.modelId?.includes('opus')
                ? 'opus'
                : model.modelId?.includes('sonnet')
                  ? 'sonnet'
                  : model.modelId?.includes('haiku')
                    ? 'haiku'
                    : 'other'
            }`,
            isCustom: false
          })) || []
      )
    } catch (error) {
      console.error('获取AWS Bedrock Anthropic模型列表出错:', error)
      return this.mapConfigDbModels(this.definition.providerDbSourceId).filter((model) =>
        model.id.startsWith('anthropic.')
      )
    }
  }

  private async fetchOpenCodeGoModels(): Promise<MODEL_META[]> {
    const records = await this.fetchOpenAIModelRecords({ timeout: this.getModelFetchTimeout() })

    return records
      .filter((model): model is Record<string, unknown> & { id: string } => {
        return typeof model.id === 'string' && model.id.trim().length > 0
      })
      .map((model) => {
        const modelId = model.id.trim()
        const isAnthropicModel = isOpenCodeGoAnthropicRoute(this.provider.id, modelId)
        const endpointType = isAnthropicModel ? 'anthropic' : 'openai'

        return {
          id: modelId,
          name: modelId,
          group: isAnthropicModel ? 'Messages' : 'Chat Completions',
          providerId: this.provider.id,
          isCustom: false,
          endpointType,
          supportedEndpointTypes: [endpointType],
          ownedBy: typeof model.owned_by === 'string' ? model.owned_by : 'opencode',
          type: ModelType.Chat
        } satisfies MODEL_META
      })
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
        const ownedBy =
          typeof rawModel.owned_by === 'string' && rawModel.owned_by.trim().length > 0
            ? rawModel.owned_by.trim()
            : undefined
        const supportedEndpointTypeValue = rawModel.supported_endpoint_types
        const hasSupportedEndpointTypes = Array.isArray(supportedEndpointTypeValue)
        const rawSupportedEndpointTypes = hasSupportedEndpointTypes
          ? supportedEndpointTypeValue.filter(isNewApiEndpointType)
          : []

        const normalizedRawType =
          typeof rawModel.type === 'string' ? rawModel.type.trim().toLowerCase() : ''
        const type = resolveNewApiModelTypeFromMetadata(
          rawSupportedEndpointTypes,
          rawModel.id,
          normalizedRawType
        )
        const supportedEndpointTypes = rawSupportedEndpointTypes
        const contextLengthCandidate =
          toPositiveFiniteNumber(rawModel.context_length) ??
          toPositiveFiniteNumber(rawModel.contextLength) ??
          toPositiveFiniteNumber(rawModel.input_token_limit) ??
          toPositiveFiniteNumber(rawModel.max_input_tokens)

        const maxTokensCandidate =
          toPositiveFiniteNumber(rawModel.max_tokens) ??
          toPositiveFiniteNumber(rawModel.max_output_tokens) ??
          toPositiveFiniteNumber(rawModel.output_token_limit)

        const capabilityFamilyHint = resolveCapabilityFamilyHint(rawModel.id, ownedBy)
        const defaultEndpointType = resolveNewApiEndpointTypeFromRoute(
          {
            supportedEndpointTypes,
            type,
            ownedBy,
            capabilityFamilyHint
          },
          rawModel.id
        )
        return {
          id: rawModel.id,
          name: typeof rawModel.name === 'string' ? rawModel.name : rawModel.id,
          group: ownedBy ?? 'default',
          providerId: this.provider.id,
          isCustom: false,
          ...(hasSupportedEndpointTypes ? { supportedEndpointTypes } : {}),
          endpointType: defaultEndpointType,
          ownedBy,
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
        if (shouldUseXaiGrokOAuthFetch(this.provider)) {
          if (this.provider.apiKey || getGlobalXaiGrokAuth().isAuthenticated()) {
            return null
          }
          return 'Missing API key or xAI Grok OAuth sign-in'
        }
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
        const credential = provider.credential
        const region = credential?.region || process.env.AWS_REGION

        if (credential?.authMode === 'profile') {
          return credential.profile && region ? null : 'Missing AWS profile name or region'
        }

        const accessKeyId = credential?.accessKeyId || process.env.AWS_ACCESS_KEY_ID
        const secretAccessKey = credential?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY
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
    decision: RouteDecision,
    temperature: number,
    maxTokens?: number
  ): Promise<string> {
    const response = await this.runTextWithDecision(
      [
        {
          role: 'user',
          content: `${SUMMARY_TITLES_PROMPT}\n\n${this.buildTranscript(messages)}`
        }
      ],
      modelId,
      decision,
      temperature,
      maxTokens
    )
    return response.content.trim()
  }

  private async runPromptCompletion(
    prompt: string,
    modelId: string,
    decision: RouteDecision,
    temperature?: number,
    maxTokens?: number,
    systemPrompt?: string,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    return this.runTextWithDecision(
      [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ],
      modelId,
      decision,
      temperature,
      maxTokens,
      undefined,
      signal
    )
  }

  private async getSuggestionsByPreset(
    preset: AiSdkBehaviorPreset,
    decision: RouteDecision,
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
        decision,
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
        decision,
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

    const response = await this.runTextWithDecision(
      [
        {
          role: 'system',
          content:
            'Based on the last user message in the conversation history, provide 3 brief, relevant follow-up suggestions or questions. Output ONLY the suggestions, each on a new line.'
        },
        ...messages.slice(-5)
      ],
      modelId,
      decision,
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
        return this.runSummaryTitlePrompt(messages, modelId, decision, 0.3, 50)
      case 'google': {
        const title = await this.runSummaryTitlePrompt(messages, modelId, decision, 0.4)
        return title || 'New Conversation'
      }
      case 'openai':
      case 'title-summary':
      case 'english-summary':
      case 'chinese-summary':
      default: {
        const title = await this.runSummaryTitlePrompt(messages, modelId, decision, 0.5)
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
      return this.collectStreamResponseWithDecision(
        messages,
        modelId,
        decision,
        temperature,
        maxTokens
      )
    }

    return this.runTextWithDecision(messages, modelId, decision, temperature, maxTokens)
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
      return this.collectStreamResponseWithDecision(
        [{ role: 'user', content: text }],
        modelId,
        decision,
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
          decision,
          temperature,
          maxTokens,
          systemPrompt
        )
      case 'google':
        return this.runPromptCompletion(
          `Please generate a concise summary for the following content:\n\n${text}`,
          modelId,
          decision,
          temperature,
          maxTokens,
          systemPrompt
        )
      case 'title-summary':
        return this.runPromptCompletion(
          "You need to summarize the user's conversation into a title of no more than 10 words, with the title language matching the user's primary language, without using punctuation or other special symbols：\n" +
            text,
          modelId,
          decision,
          temperature,
          maxTokens,
          systemPrompt
        )
      case 'english-summary':
        return this.runPromptCompletion(
          `Please summarize the following content using concise language and highlighting key points:\n${text}`,
          modelId,
          decision,
          temperature,
          maxTokens,
          systemPrompt
        )
      case 'chinese-summary':
        return this.runPromptCompletion(
          `请总结以下内容，使用简洁的语言，突出重点：\n${text}`,
          modelId,
          decision,
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
            decision,
            temperature,
            maxTokens,
            systemPrompt
          )
        }
        return this.runTextWithDecision(
          [
            { role: 'system', content: 'Summarize the following text concisely:' },
            { role: 'user', content: text }
          ],
          modelId,
          decision,
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
    options?: AiSdkGenerateTextOptions
  ): Promise<LLMResponse>
  /** @deprecated Pass `{ systemPrompt }` as the fifth argument instead. */
  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    systemPrompt?: string
  ): Promise<LLMResponse>
  public async generateText(
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    optionsOrSystemPrompt?: AiSdkGenerateTextOptions | string
  ): Promise<LLMResponse> {
    const options: AiSdkGenerateTextOptions =
      typeof optionsOrSystemPrompt === 'string'
        ? { systemPrompt: optionsOrSystemPrompt }
        : (optionsOrSystemPrompt ?? {})
    const decision = this.resolveRouteDecision(modelId)
    if (decision.endpointType === 'grok-image' || decision.endpointType === 'image-generation') {
      return this.collectStreamResponseWithDecision(
        [{ role: 'user', content: prompt }],
        modelId,
        decision,
        temperature,
        maxTokens,
        [],
        undefined,
        options?.signal
      )
    }

    return this.runPromptCompletion(
      prompt,
      modelId,
      decision,
      temperature,
      maxTokens,
      options?.systemPrompt,
      options?.signal
    )
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
      decision,
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
    tools: MCPToolDefinition[],
    options?: ProviderStreamOptions
  ): AsyncGenerator<LLMCoreStreamEvent> {
    yield* this.streamText(
      messages,
      modelId,
      modelConfig,
      temperature,
      maxTokens,
      tools,
      options?.signal
    )
  }

  private getEmbeddingStrategy(): AiSdkEmbeddingStrategy {
    return this.definition.embeddingStrategy ?? 'none'
  }

  public async getEmbeddings(
    modelId: string,
    texts: string[],
    signal?: AbortSignal
  ): Promise<number[][]> {
    switch (this.getEmbeddingStrategy()) {
      case 'openai':
      case 'google':
        return this.runEmbeddings(modelId, texts, signal)
      case 'new-api': {
        const endpointType = 'openai' as const
        const capabilityIdentity = this.resolveCapabilityIdentityFromProviderState(
          modelId,
          endpointType
        )
        return this.runEmbeddingsWithDecision(
          modelId,
          texts,
          {
            providerKind: 'openai-compatible',
            endpointType,
            capabilityIdentity,
            providerPatch: {
              apiType: 'openai-completions',
              baseUrl: `${this.getNormalizedNewApiHost()}/v1`,
              capabilityProviderId: this.getRuntimeCapabilityProviderId(
                capabilityIdentity,
                endpointType
              )
            }
          },
          signal
        )
      }
      case 'zenmux':
        if (modelId.trim().toLowerCase().startsWith('anthropic/')) {
          throw new Error(`Embeddings not supported for Anthropic models: ${modelId}`)
        }
        return this.runEmbeddings(modelId, texts, signal)
      case 'none':
      default:
        throw new Error('embedding is not supported by this provider')
    }
  }

  public async getDimensions(modelId: string, signal?: AbortSignal): Promise<LLM_EMBEDDING_ATTRS> {
    switch (this.getEmbeddingStrategy()) {
      case 'openai':
      case 'google':
        return this.runDimensions(modelId, signal)
      case 'new-api': {
        const endpointType = 'openai' as const
        const capabilityIdentity = this.resolveCapabilityIdentityFromProviderState(
          modelId,
          endpointType
        )
        return this.runDimensionsWithDecision(
          modelId,
          {
            providerKind: 'openai-compatible',
            endpointType,
            capabilityIdentity,
            providerPatch: {
              apiType: 'openai-completions',
              baseUrl: `${this.getNormalizedNewApiHost()}/v1`,
              capabilityProviderId: this.getRuntimeCapabilityProviderId(
                capabilityIdentity,
                endpointType
              )
            }
          },
          signal
        )
      }
      case 'zenmux':
        if (modelId.trim().toLowerCase().startsWith('anthropic/')) {
          throw new Error(`Embeddings not supported for Anthropic models: ${modelId}`)
        }
        return this.runDimensions(modelId, signal)
      case 'none':
      default:
        throw new Error('embedding is not supported by this provider')
    }
  }
}
