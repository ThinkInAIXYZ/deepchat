import type { ProviderSettingsPort } from '@/provider/settings'
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { isJevJudgmentModelId } from '@shared/jevProtocol'
import {
  ModelType,
  isNewApiEndpointType,
  isOpenAIImageGenerationModelId,
  resolveNewApiEndpointTypeFromRoute,
  resolveNewApiModelTypeFromMetadata,
  type NewApiEndpointType
} from '@shared/model'
import type { ResolvedCapabilityIdentity } from '@shared/types/model-capabilities'
import type {
  AWS_BEDROCK_PROVIDER,
  KeyStatus,
  LLM_PROVIDER,
  MODEL_META,
  ModelConfig,
  VERTEX_PROVIDER
} from '@shared/types/provider'
import { getGlobalXaiGrokAuth } from '../../provider/auth/xaiGrok'
import { isTrustedXaiApiEndpoint } from '../../provider/auth/xaiGrok/constants'
import { providerDbLoader } from '../../provider/providerDbLoader'
import { BaseLLMProvider } from '../baseProvider'
import { isOpenCodeGoAnthropicRoute, resolveCapabilityFamilyHint } from '../capabilityIdentity'
import { modelCapabilities } from '../modelCapabilities'
import type { ProviderLocalePort } from '../ports'
import type { ProviderTransportKind } from '../providerEndpoints'
import { normalizeAzureBaseUrl, normalizeGeminiBaseUrl } from '../providerEndpoints'
import {
  resolveAiSdkProviderDefinition,
  type AiSdkCredentialStrategy,
  type AiSdkKeyStatusStrategy,
  type AiSdkModelSourceStrategy,
  type AiSdkProviderDefinition,
  type AiSdkRouteStrategy
} from '../providerRegistry'
import { shouldUseXaiGrokOAuthFetch } from '../xaiGrokAuthAdapter'

const OPENAI_CODEX_RECOMMENDED_MODEL_IDS = [
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
  'gpt-image-2'
]
const GREENPT_RECOMMENDED_MODEL_IDS = [
  'glm-5.2',
  'kimi-k2.7-code',
  'green-embedding',
  'green-rerank'
]
const GREENPT_NON_OPENAI_MODEL_IDS = new Set(['green-s', 'green-s-pro'])
const DEFAULT_NEW_API_BASE_URL = 'https://www.newapi.ai'

export type RouteDecision = {
  providerKind: ProviderTransportKind
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

class ProviderHttpError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ProviderHttpError'
    this.status = status
  }
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

// LiteLLM `model_info.mode` -> the DeepChat model type whose route the proxy also serves.
// `responses` aliases are served on chat completions too.
const LITELLM_MODE_TYPES: Record<string, ModelType | undefined> = {
  chat: ModelType.Chat,
  responses: ModelType.Chat,
  embedding: ModelType.Embedding,
  image_generation: ModelType.ImageGeneration,
  video_generation: ModelType.VideoGeneration,
  audio_speech: ModelType.TTS
}

// LiteLLM `litellm_provider` -> model group, e.g. `vertex_ai-language-models` -> `vertex_ai` and
// `text-completion-codestral` -> `codestral`.
function toLiteLLMProviderGroup(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'default'
  return value.replace(/^text-completion-/i, '').split('-')[0] || 'default'
}

function toPositiveFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

// Id fragments that mark a catalog entry as clearly not a chat model, for public catalogs that
// carry no capability field (embedding, rerank, image, audio, speech).
const NON_CHAT_MODEL_ID_PATTERNS = [
  'embed',
  'rerank',
  'image',
  'flux-',
  'audio',
  'speech',
  'tts',
  'whisper',
  '-asr',
  'transcri'
]

function isNonChatCatalogModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return NON_CHAT_MODEL_ID_PATTERNS.some((pattern) => lower.includes(pattern))
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

  private getNormalizedNewApiHost(): string {
    const rawBaseUrl = (this.provider.baseUrl || DEFAULT_NEW_API_BASE_URL).trim()
    const normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, '')
    return normalizedBaseUrl.replace(/\/(v1|v1beta(?:\d+)?)$/i, '') || DEFAULT_NEW_API_BASE_URL
  }

  private getRuntimeProvider(decision: RouteDecision): LLM_PROVIDER {
    const base: LLM_PROVIDER = {
      ...this.provider,
      ...decision.providerPatch
    }

    // Older built-in Fireworks configs omitted /v1. Normalize only that official endpoint;
    // never rewrite a custom proxy or mutate the user's saved configuration.
    if (
      this.definition.providerDbSourceId === 'fireworks-ai' &&
      /^https:\/\/api\.fireworks\.ai\/inference\/?$/.test(base.baseUrl)
    ) {
      base.baseUrl = 'https://api.fireworks.ai/inference/v1'
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

  private isAzureOpenAI(decision: RouteDecision, runtimeProvider: LLM_PROVIDER): boolean {
    return decision.providerKind === 'azure' || runtimeProvider.id === 'azure-openai'
  }

  private usesGeminiApiKeyHeader(runtimeProvider: LLM_PROVIDER): boolean {
    return runtimeProvider.apiType === 'gemini'
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
      const requestHeaders = this.getRequestHeaders(
        resolvedDecision,
        requestRuntimeProvider,
        defaultHeaders,
        init.body && !(init.body instanceof FormData) ? 'application/json' : undefined
      )
      new Headers(init.headers).forEach((value, name) => {
        for (const existingName of Object.keys(requestHeaders)) {
          if (existingName.toLowerCase() === name.toLowerCase()) {
            delete requestHeaders[existingName]
          }
        }
        requestHeaders[name] = value
      })
      const response = await this.fetchProvider(url, {
        ...init,
        headers: requestHeaders,
        signal: controller.signal
      })

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
    const { signal, dispose } = this.createModelRequestSignal({
      timeout: this.getModelFetchTimeout()
    })

    try {
      const response = await this.fetchProvider(modelsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
          ...this.defaultHeaders,
          ...this.definition.defaultHeadersPatch
        },
        signal
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
    const { signal, dispose } = this.createModelRequestSignal({
      timeout: this.getModelFetchTimeout()
    })

    try {
      const response = await this.fetchProvider(modelsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          ...this.defaultHeaders,
          ...this.definition.defaultHeadersPatch
        },
        signal
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
    return OPENAI_CODEX_RECOMMENDED_MODEL_IDS.flatMap((id) => {
      const model = modelsById.get(id)
      if (model) return [model]
      if (!isOpenAIImageGenerationModelId(id)) return []
      return [{ id, name: id, group: 'Codex', providerId: this.provider.id, isCustom: false }]
    })
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
      case 'requesty':
        return this.fetchRequestyModels()
      case 'litellm':
        return this.fetchLiteLLMModels()
      case 'openllm':
        return this.fetchOpenLLMModels()
      case 'demonroute':
        return this.fetchDemonRouteModels()
      case 'apimodels': {
        const records = await this.fetchOpenAIModelRecords({
          timeout: this.getModelFetchTimeout()
        })
        const models: MODEL_META[] = []
        for (const model of records) {
          if (typeof model.id !== 'string' || !model.id.trim() || model.modality !== 'chat') {
            continue
          }
          models.push({
            id: model.id,
            name: model.id,
            group: 'default',
            providerId: this.provider.id,
            isCustom: false,
            type: ModelType.Chat,
            ...(typeof model.owned_by === 'string' && model.owned_by.trim().length > 0
              ? { ownedBy: model.owned_by.trim() }
              : {})
          })
        }
        return models
      }
      case 'runcrate':
        return this.fetchRuncrateModels()
      case 'cloudgpu':
        return this.fetchCloudgpuModels()
      case 'obscurify':
        return this.fetchObscurifyModels()
      case 'wiro':
        return this.fetchWiroModels()
      case 'bedrock':
        return this.fetchBedrockModels()
      case 'new-api':
        return this.fetchNewApiModels()
      case 'apimart':
        throw new Error('APIMart model discovery requires ApimartProvider')
      case 'workers-ai':
        throw new Error('Workers AI model discovery requires WorkersAiProvider')
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

  /**
   * Requesty lists its curated managed policies (short ids such as `gpt-5.4-mini`) separately from
   * the full `vendor/model` catalog. Both are valid chat model ids, so both are listed, managed
   * policies first. The catalog request is authenticated and doubles as the key check.
   */
  private async fetchRequestyModels(): Promise<MODEL_META[]> {
    const timeout = this.getModelFetchTimeout()
    const catalog = await this.fetchOpenAIModelRecords({ timeout })
    const managedUrl = `${(this.provider.baseUrl || '').replace(/\/+$/, '')}/models/managed`
    const managed = await this.requestProviderJson<unknown>(managedUrl, { method: 'GET' }, timeout)
      .then(toModelRecordArray)
      .catch((error) => {
        console.warn('Error fetching Requesty managed models:', error)
        return []
      })

    const models: MODEL_META[] = []
    const seen = new Set<string>()
    const append = (records: Array<Record<string, unknown>>, group: string) => {
      for (const model of records) {
        const modelId = typeof model.id === 'string' ? model.id : ''
        const api = typeof model.api === 'string' ? model.api : 'chat'
        if (!modelId || seen.has(modelId) || (api !== 'chat' && api !== 'embedding')) {
          continue
        }
        seen.add(modelId)
        const contextLength = toPositiveFiniteNumber(model.context_window)
        const maxTokens = toPositiveFiniteNumber(model.max_output_tokens)
        models.push({
          id: modelId,
          name: modelId,
          group,
          providerId: this.provider.id,
          isCustom: false,
          type: api === 'embedding' ? ModelType.Embedding : ModelType.Chat,
          ...(contextLength !== undefined ? { contextLength } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
          description: typeof model.description === 'string' ? model.description : undefined,
          ...(typeof model.supports_vision === 'boolean' ? { vision: model.supports_vision } : {}),
          ...(typeof model.supports_tool_calling === 'boolean'
            ? { functionCall: model.supports_tool_calling }
            : {}),
          ...(typeof model.supports_reasoning === 'boolean'
            ? { reasoning: model.supports_reasoning }
            : {})
        })
      }
    }

    append(managed, 'Managed')
    append(catalog, 'default')
    return models
  }

  /** LiteLLM management routes (`/model/info`, `/key/info`) live at the proxy root, not `/v1`. */
  private getLiteLLMProxyRoot(): string {
    return (this.provider.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '')
  }

  /**
   * LiteLLM model names are aliases chosen by whoever runs the proxy, so the shared model catalog
   * cannot describe them. The proxy's `/model/info` carries the routed model's mode, limits and
   * capabilities per alias; `/models` (ids only) is the fallback when the proxy returns no model
   * records or the key cannot read them (401, 403, 404). Other errors are surfaced.
   */
  private async fetchLiteLLMModels(): Promise<MODEL_META[]> {
    const timeout = this.getModelFetchTimeout()
    const infoUrl = `${this.getLiteLLMProxyRoot()}/model/info`
    let records: Array<Record<string, unknown>>
    try {
      records = toModelRecordArray(
        await this.requestProviderJson<unknown>(infoUrl, { method: 'GET' }, timeout)
      )
    } catch (error) {
      if (!(error instanceof ProviderHttpError) || ![401, 403, 404].includes(error.status ?? 0)) {
        throw error
      }
      console.warn('LiteLLM model info unavailable, falling back to /models:', error.status)
      records = []
    }

    // Single-model CLI proxies return a data object with a wildcard name; /models has callable IDs.
    if (records.length === 0) {
      const listed = await this.fetchDefaultOpenAIModels({ timeout })
      return listed.filter((model) => !model.id.includes('*'))
    }

    const models = new Map<string, MODEL_META>()
    for (const record of records) {
      const modelId = typeof record.model_name === 'string' ? record.model_name : ''
      const info =
        record.model_info && typeof record.model_info === 'object'
          ? (record.model_info as Record<string, unknown>)
          : {}
      // Modes without a DeepChat route (rerank, audio_transcription, moderation, ...) are skipped,
      // and so are wildcard routes (`*`, `openai/*`), which are patterns rather than callable names.
      const type = LITELLM_MODE_TYPES[typeof info.mode === 'string' ? info.mode : 'chat']
      if (!modelId || modelId.includes('*') || !type) {
        continue
      }
      const contextLength = toPositiveFiniteNumber(info.max_input_tokens)
      const maxTokens = toPositiveFiniteNumber(info.max_output_tokens)
      const existing = models.get(modelId)
      if (existing) {
        // Deployments of one alias are load balanced, so a request can land on any of them: keep
        // the smallest limits and only the capabilities every deployment reports.
        if (contextLength !== undefined) {
          existing.contextLength = Math.min(existing.contextLength ?? contextLength, contextLength)
        }
        if (maxTokens !== undefined) {
          existing.maxTokens = Math.min(existing.maxTokens ?? maxTokens, maxTokens)
        }
        existing.vision = existing.vision === true && info.supports_vision === true
        existing.functionCall =
          existing.functionCall === true && info.supports_function_calling === true
        existing.reasoning = existing.reasoning === true && info.supports_reasoning === true
        continue
      }
      models.set(modelId, {
        id: modelId,
        name: modelId,
        group: toLiteLLMProviderGroup(info.litellm_provider),
        providerId: this.provider.id,
        isCustom: false,
        type,
        ...(contextLength !== undefined ? { contextLength } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(typeof info.supports_vision === 'boolean' ? { vision: info.supports_vision } : {}),
        ...(typeof info.supports_function_calling === 'boolean'
          ? { functionCall: info.supports_function_calling }
          : {}),
        ...(typeof info.supports_reasoning === 'boolean'
          ? { reasoning: info.supports_reasoning }
          : {})
      })
    }
    return [...models.values()]
  }

  /**
   * OpenLLM's `/v1/models` cards carry `capabilities`, `context_window` and `max_output_tokens`.
   * List the chat models and read those facts; ids are kept verbatim (aliases and
   * `<provider>/<model>` ids).
   */
  private async fetchOpenLLMModels(): Promise<MODEL_META[]> {
    const records = await this.fetchOpenAIModelRecords({ timeout: this.getModelFetchTimeout() })
    const models: MODEL_META[] = []
    for (const model of records) {
      const modelId = typeof model.id === 'string' ? model.id.trim() : ''
      const capabilities = Array.isArray(model.capabilities)
        ? model.capabilities.filter((item): item is string => typeof item === 'string')
        : []
      if (!modelId || !capabilities.includes('chat')) {
        continue
      }
      const contextLength =
        toPositiveFiniteNumber(model.context_window) ??
        toPositiveFiniteNumber(model.max_input_tokens)
      const maxTokens = toPositiveFiniteNumber(model.max_output_tokens)
      const displayName = typeof model.display_name === 'string' ? model.display_name.trim() : ''
      models.push({
        id: modelId,
        name: displayName || modelId,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        type: ModelType.Chat,
        ...(contextLength !== undefined ? { contextLength } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        vision: capabilities.includes('vision'),
        functionCall: capabilities.includes('tools'),
        reasoning: capabilities.includes('reasoning'),
        ...(typeof model.owned_by === 'string' && model.owned_by.trim()
          ? { ownedBy: model.owned_by.trim() }
          : {})
      })
    }
    return models
  }

  /**
   * DemonRoute exposes a standard OpenAI-compatible model catalog at `{baseUrl}/models`.
   * The catalog request is authenticated and doubles as the key check.
   */
  private async fetchDemonRouteModels(): Promise<MODEL_META[]> {
    const timeout = this.getModelFetchTimeout()
    const catalog = await this.fetchOpenAIModelRecords({ timeout })

    const models: MODEL_META[] = []
    for (const model of catalog) {
      const modelId = typeof model.id === 'string' ? model.id : ''
      if (!modelId) {
        continue
      }
      const contextLength =
        toPositiveFiniteNumber(model.context_length) ?? toPositiveFiniteNumber(model.context_window)
      const maxTokens =
        toPositiveFiniteNumber(model.max_output_tokens) ?? toPositiveFiniteNumber(model.max_tokens)
      models.push({
        id: modelId,
        name: modelId,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        type: ModelType.Chat,
        ...(contextLength !== undefined ? { contextLength } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(typeof model.description === 'string' ? { description: model.description } : {})
      })
    }
    return models
  }

  /**
   * Runcrate's public catalog also lists image, video, audio and embedding models.
   * Keep the text-in, text-out models and read the limits and features it publishes.
   */
  private async fetchRuncrateModels(): Promise<MODEL_META[]> {
    const records = await this.fetchOpenAIModelRecords({ timeout: this.getModelFetchTimeout() })
    const toStrings = (value: unknown): string[] | undefined =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : undefined

    const models: MODEL_META[] = []
    for (const model of records) {
      const modelId = typeof model.id === 'string' ? model.id.trim() : ''
      const outputModalities = toStrings(model.output_modalities)
      const inputModalities = toStrings(model.input_modalities)
      if (!modelId || !outputModalities?.includes('text') || !inputModalities?.includes('text')) {
        continue
      }
      const features = toStrings(model.supported_features)
      const contextLength = toPositiveFiniteNumber(model.context_length)
      const maxTokens = toPositiveFiniteNumber(model.max_output_length)
      models.push({
        id: modelId,
        name: modelId,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        type: ModelType.Chat,
        ...(contextLength !== undefined ? { contextLength } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(features
          ? { functionCall: features.includes('tools'), reasoning: features.includes('reasoning') }
          : {}),
        ...(inputModalities ? { vision: inputModalities.includes('image') } : {}),
        ...(typeof model.owned_by === 'string' && model.owned_by.trim()
          ? { ownedBy: model.owned_by.trim() }
          : {})
      })
    }
    return models
  }

  /**
   * CloudGPU's public catalog answers without a key and has no capability field. List every id
   * except the ones that are clearly not chat models (embedding, rerank, image, audio, speech).
   */
  private async fetchCloudgpuModels(): Promise<MODEL_META[]> {
    const records = await this.fetchOpenAIModelRecords({ timeout: this.getModelFetchTimeout() })
    const models: MODEL_META[] = []
    for (const model of records) {
      const modelId = typeof model.id === 'string' ? model.id.trim() : ''
      if (!modelId || isNonChatCatalogModelId(modelId)) {
        continue
      }
      models.push({
        id: modelId,
        name: modelId,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        type: ModelType.Chat,
        ...(typeof model.owned_by === 'string' && model.owned_by.trim()
          ? { ownedBy: model.owned_by.trim() }
          : {})
      })
    }
    return models
  }

  /**
   * Obscurify.ai's public catalog answers without a key and publishes each model's context length
   * and whether it accepts tools. It also lists models that are not chat models: decision models
   * (flagged `decisions: true`, which include the Jev judgment models) and an image model. Those are
   * left out so they cannot be picked in chat.
   */
  private async fetchObscurifyModels(): Promise<MODEL_META[]> {
    const records = await this.fetchOpenAIModelRecords({ timeout: this.getModelFetchTimeout() })
    const models: MODEL_META[] = []
    for (const model of records) {
      const modelId = typeof model.id === 'string' ? model.id.trim() : ''
      if (
        !modelId ||
        model.decisions === true ||
        isJevJudgmentModelId(modelId) ||
        isNonChatCatalogModelId(modelId)
      ) {
        continue
      }
      const contextLength = toPositiveFiniteNumber(model.context_length)
      models.push({
        id: modelId,
        name: modelId,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        type: ModelType.Chat,
        ...(contextLength !== undefined ? { contextLength } : {}),
        ...(typeof model.tools === 'boolean' ? { functionCall: model.tools } : {})
      })
    }
    return models
  }

  /**
   * Wiro AI's `/v1/models` catalog needs the key and lists chat models only. Each record publishes
   * the context length, the output limit, the input modalities and whether the model accepts
   * tools; a value the catalog leaves out is not guessed. Ids are lowercase `owner/model` and are
   * kept verbatim.
   */
  private async fetchWiroModels(): Promise<MODEL_META[]> {
    const records = await this.fetchOpenAIModelRecords({ timeout: this.getModelFetchTimeout() })
    const models: MODEL_META[] = []
    for (const model of records) {
      const modelId = typeof model.id === 'string' ? model.id.trim() : ''
      if (!modelId) {
        continue
      }
      const capabilities =
        model.capabilities && typeof model.capabilities === 'object'
          ? (model.capabilities as Record<string, unknown>)
          : {}
      const inputModalities = Array.isArray(capabilities.input_modalities)
        ? capabilities.input_modalities
        : undefined
      const contextLength = toPositiveFiniteNumber(model.context_length)
      const maxTokens = toPositiveFiniteNumber(model.max_tokens)
      models.push({
        id: modelId,
        name: modelId,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        type: ModelType.Chat,
        ...(contextLength !== undefined ? { contextLength } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(inputModalities ? { vision: inputModalities.includes('image') } : {}),
        ...(typeof capabilities.function_tools === 'boolean'
          ? { functionCall: capabilities.function_tools }
          : {}),
        ...(typeof model.owned_by === 'string' && model.owned_by.trim()
          ? { ownedBy: model.owned_by.trim() }
          : {})
      })
    }
    return models
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
        const response = await this.fetchProvider('https://openrouter.ai/api/v1/key', {
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
      case 'litellm': {
        // Spend and budget exist for virtual keys only; a keyless proxy or the master key has none.
        if (!this.provider.apiKey) return null
        const { signal, dispose } = this.createModelRequestSignal({
          timeout: this.getModelFetchTimeout()
        })
        try {
          const response = await this.fetchProvider(`${this.getLiteLLMProxyRoot()}/key/info`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${this.provider.apiKey}` },
            signal
          })
          if (response.status === 404) return null
          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(
              `LiteLLM key check failed: ${response.status} ${response.statusText} - ${errorText}`
            )
          }
          const payload = (await response.json()) as {
            info?: { spend?: number | null; max_budget?: number | null }
          }
          // Per-request spend is often below a cent; keep enough digits to show it.
          const usd = (value: number) => `$${value.toFixed(Math.abs(value) < 0.01 ? 6 : 2)}`
          const spend = Number(payload.info?.spend ?? 0)
          const keyStatus: KeyStatus = { usage: usd(spend) }
          const budget = payload.info?.max_budget
          if (typeof budget === 'number') {
            const remaining = budget - spend
            keyStatus.limit_remaining = usd(remaining)
            keyStatus.remainNum = remaining
          }
          return keyStatus
        } finally {
          dispose()
        }
      }
      case 'deepseek': {
        const response = await this.fetchProvider('https://api.deepseek.com/user/balance', {
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
        const response = await this.fetchProvider('https://api.ppinfra.com/v3/user', {
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
        const response = await this.fetchProvider(`${this.provider.baseUrl}/models`, {
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
        const response = await this.fetchProvider('https://api.302.ai/dashboard/balance', {
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
        const usageResponse = await this.fetchProvider(`${baseUrl}/dashboard/billing/usage`, {
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
      case 'uberllm': {
        const credentialError = this.validateCredentials('api-key')
        if (credentialError) throw new Error(credentialError)

        const baseUrl = this.provider.baseUrl.replace(/\/+$/, '')
        const balance = await this.requestProviderJson<{ available_usd: number } | null>(
          `${baseUrl}/balance`,
          { method: 'GET' },
          this.getModelFetchTimeout()
        )
        if (!balance || !Number.isFinite(balance.available_usd)) {
          throw new Error('Invalid UberLLM balance response')
        }
        // Prepaid credit is not required for requests routed through a BYOK provider.
        return { limit_remaining: `$${balance.available_usd}` }
      }
      case 'modelscope': {
        const response = await this.fetchOpenAIModelRecords({ timeout: 10000 })
        return {
          limit_remaining: 'Available',
          remainNum: response.length
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
      case 'generate-text':
        return {
          isOk: false,
          errorMsg:
            this.validateCredentials(this.definition.credentialStrategy ?? 'none') ??
            'Use the native model connection test for this provider'
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
}
