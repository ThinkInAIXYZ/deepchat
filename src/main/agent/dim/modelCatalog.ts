import { resolveOpenAICompatibleVideoRequestBodyShape } from '@shared/videoGenerationSettings'
import { createHash, randomUUID } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type {
  AWS_BEDROCK_PROVIDER,
  LLM_PROVIDER,
  ModelConfig,
  VERTEX_PROVIDER
} from '@shared/types/provider'
import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import { ModelType } from '@shared/model'
import type { DimOAuthConnection } from './providerCredentials'
import type { ProviderSettingsPort } from '@/provider/settings'
import type {
  DimProviderGrantsTable,
  DimProviderGrant
} from '@/session/data/tables/dimProviderGrants'
import { resolveAiSdkProviderDefinition } from '@/provider/providerRegistry'
import { resolveProviderTransport } from '@/provider/providerTransport'
import { GITHUB_COPILOT_CHAT_HEADERS } from '@/provider/auth/githubCopilotProtocol'
import { resolveVertexSettings } from '@/provider/vertexSettings'
import { normalizeOpenAICodexBaseUrl } from '@/provider/openaiCodexAdapter'
import { DimModelBridge, type DimModelId, type DimModelParameters } from './modelBridge'

type JsonObject = { [key: string]: JsonValue }
export type DimCredential =
  | string
  | {
      accessKeyId: string
      secretAccessKey: string
      sessionToken?: string
    }
interface CatalogOptions {
  settings: Pick<
    ProviderSettingsPort,
    | 'getProviderById'
    | 'getModelConfig'
    | 'getCapabilitySnapshot'
    | 'getProviderModelRouteMetadata'
    | 'getModelStatus'
  > &
    Partial<Pick<ProviderSettingsPort, 'getVoiceAiConfig' | 'getProviderMediaRoute'>>
  models: Pick<DimModelBridge, 'configure'> & Partial<Pick<DimModelBridge, 'releaseConfiguration'>>
  grants: Pick<DimProviderGrantsTable, 'get' | 'put'>
  credential(provider: LLM_PROVIDER, signal: AbortSignal): Promise<DimCredential>
  connectionAuth?(
    provider: LLM_PROVIDER,
    rejectedLease: string | undefined,
    signal: AbortSignal
  ): Promise<DimOAuthConnection | null>
}

/** Converts product catalog facts, never an inference request or a provider response. */
export class DimModelCatalog {
  private readonly drafts = new Map<string, DimModelCatalog>()
  private activeDrafts = 0
  constructor(private readonly options: CatalogOptions) {}

  /** Draft credentials are scoped to this call and never replace persisted product grants. */
  async withDraft<T>(
    provider: LLM_PROVIDER,
    work: (catalog: DimModelCatalog) => Promise<T>
  ): Promise<T> {
    const release = this.options.models.releaseConfiguration
    if (!release) throw new Error('Native draft configuration lifecycle is unavailable')
    if (this.activeDrafts >= 32) throw new Error('Too many draft model validations')
    const draft = structuredClone({ ...provider, enable: true })
    this.activeDrafts++
    let active = true
    const identity = randomUUID()
    const grants = new Map<string, DimProviderGrant>()
    const configured = new Set<string>()
    let scoped!: DimModelCatalog
    scoped = new DimModelCatalog({
      settings: {
        getProviderById: (id) => (active && id === draft.id ? draft : undefined),
        getModelStatus: () => true,
        getModelConfig: (modelId) => ({
          ...this.options.settings.getModelConfig(modelId, draft.id),
          type: ModelType.Chat,
          functionCall: false,
          vision: false,
          reasoning: false
        }),
        getProviderModelRouteMetadata: () => undefined,
        getCapabilitySnapshot: (input) => ({
          ...this.options.settings.getCapabilitySnapshot(input),
          supportsAudioInput: false,
          supportsReasoning: false,
          reasoningPortrait: null
        })
      },
      models: {
        configure: async (config) => {
          const metadata = config.model.metadata as JsonObject
          const target = await this.options.models.configure({
            ...config,
            model: {
              ...config.model,
              metadata: {
                ...metadata,
                raw: { ...(metadata.raw as JsonObject), deepchatDraftId: identity }
              }
            },
            key: `deepchat/draft/v1/${identity}/${config.key}`,
            displayName: `DeepChat draft validation ${identity}`
          })
          configured.add(target.providerId)
          this.drafts.set(target.providerId, scoped)
          return target
        }
      },
      grants: {
        get: (id) => grants.get(id) ?? null,
        put: (grant) => {
          grants.set(grant.nativeProviderId, grant)
        }
      },
      credential: (_provider, signal) => this.options.credential(draft, signal),
      connectionAuth: (_provider, rejectedLease, signal) =>
        this.options.connectionAuth?.(draft, rejectedLease, signal) ?? Promise.resolve(null)
    })
    try {
      return await work(scoped)
    } finally {
      // Revoke first: a late native request cannot use a draft after the caller has settled.
      active = false
      this.activeDrafts--
      grants.clear()
      for (const id of configured) this.drafts.delete(id)
      const failures = await Promise.allSettled(
        [...configured].map((providerId) => release.call(this.options.models, providerId))
      )
      for (const result of failures)
        if (result.status === 'rejected')
          console.warn('[dim] Could not remove a revoked draft model configuration')
    }
  }

  async admit(
    providerId: string,
    modelId: string,
    options?: { timeout?: number; session?: boolean }
  ): Promise<DimModelId> {
    return options?.session
      ? this.configureForSession(providerId, modelId, options, false)
      : this.configure(providerId, modelId, options, false)
  }

  parameters(providerId: string, modelId: string, settings: GenerationParameters) {
    return dimModelParameters(this.options.settings, providerId, modelId, settings)
  }

  /** Register a frozen history container. This never authorizes inference or credential access. */
  async registerForHistory(
    providerId: string,
    modelId: string,
    options?: { timeout?: number; session?: boolean }
  ): Promise<DimModelId> {
    return options?.session
      ? this.configureForSession(providerId, modelId, options, true)
      : this.configure(providerId, modelId, options, true)
  }

  mediaSettings(providerId: string, modelId: string): JsonObject {
    const config = this.options.settings.getModelConfig(modelId, providerId)
    return JSON.parse(
      JSON.stringify({
        image: config.imageGeneration ?? {},
        video: config.videoGeneration ?? {},
        speech: config.tts ?? {}
      })
    ) as JsonObject
  }

  private async configureForSession(
    providerId: string,
    modelId: string,
    options: { timeout?: number } | undefined,
    historyOnly: boolean
  ): Promise<DimModelId> {
    const target = await this.configure(providerId, modelId, options, historyOnly)
    const provider = this.requireProvider(providerId, historyOnly)
    const config = this.options.settings.getModelConfig(modelId, providerId)
    const category =
      isVoiceAi(provider) || config.type === ModelType.TTS
        ? 'speech'
        : config.type === ModelType.ImageGeneration
          ? 'image'
          : config.type === ModelType.VideoGeneration
            ? 'video'
            : null
    return category
      ? this.configure(providerId, modelId, options, historyOnly, { target, category })
      : target
  }

  private async configure(
    providerId: string,
    modelId: string,
    options: { timeout?: number } | undefined,
    historyOnly: boolean,
    conversation?: { target: DimModelId; category: 'image' | 'video' | 'speech' }
  ): Promise<DimModelId> {
    const provider = this.requireProvider(providerId, historyOnly)
    if (!historyOnly && !this.options.settings.getModelStatus(providerId, modelId))
      throw new Error('Model is disabled')
    const config = {
      ...this.options.settings.getModelConfig(modelId, providerId),
      ...(isVoiceAi(provider) ? { type: ModelType.TTS } : {}),
      ...(options?.timeout === undefined ? {} : { timeout: options.timeout })
    }
    const connection = this.connection(provider, modelId, config)
    const capability = this.options.settings.getCapabilitySnapshot({ providerId, modelId })
    const portrait = capability.reasoningPortrait
    const modality = dimModality(config)
    const mediaRoute = this.options.settings.getProviderMediaRoute?.(provider.id, modelId)
    const model: JsonObject & { modelId: string } = {
      modelId: conversation ? `deepchat-media/${modelId}` : modelId,
      displayName: modelId,
      status: 'active',
      capabilities: {
        modalities: modality.output
          ? [modality.output]
          : [
              'text',
              ...(config.vision ? ['image'] : []),
              ...(capability.supportsAudioInput ? ['audio'] : [])
            ],
        toolCalling: config.functionCall,
        streaming: true,
        structuredOutput: true,
        vision: config.vision,
        audio: capability.supportsAudioInput,
        reasoning: capability.supportsReasoning,
        contextWindow: config.contextLength,
        maxOutputTokens: config.maxTokens
      },
      metadata: {
        metadataSource: 'deepchat',
        ...(modality.operations.length || (config.type && config.type !== ModelType.Chat)
          ? {
              raw: {
                type: modality.kind,
                modalityCapabilities: modality.operations,
                ...(isVoiceAi(provider)
                  ? { deepchatVoiceAi: this.options.settings.getVoiceAiConfig?.() ?? {} }
                  : {}),
                ...(provider.apiType === 'apimart' || provider.id === 'apimart'
                  ? {
                      deepchatMediaRoute: mediaRoute
                        ? {
                            endpoint: mediaRoute.endpoint,
                            ...(mediaRoute.parameterNames
                              ? { parameterNames: mediaRoute.parameterNames }
                              : {})
                          }
                        : null
                    }
                  : {}),
                deepchatMediaVendors: [
                  ...(['voiceai', 'apimart'].includes(provider.apiType) ? [provider.apiType] : []),
                  provider.capabilityProviderId,
                  provider.id,
                  provider.apiType
                ].filter((name): name is string => !!name)
              }
            }
          : {}),
        reasoning: {
          ...(portrait ? JSON.parse(JSON.stringify(portrait)) : {}),
          supported: capability.supportsReasoning
        }
      }
    }
    if (conversation) {
      const capabilities = model.capabilities as JsonObject
      capabilities.vision = config.vision || conversation.category === 'image'
      capabilities.modalities = ['text', ...(capabilities.vision ? ['image'] : [])]
      capabilities.toolCalling = false
      model.metadata = {
        metadataSource: 'deepchat',
        raw: {
          type: 'chat',
          deepchatMediaConversation: {
            target: { ...conversation.target },
            category: conversation.category,
            ...(conversation.category === 'video'
              ? {
                  videoBodyShape: resolveOpenAICompatibleVideoRequestBodyShape({
                    providerId,
                    providerApiType: provider.apiType,
                    baseUrl: provider.baseUrl,
                    modelId
                  })
                }
              : {})
          }
        }
      }
    }
    const target = await this.options.models.configure({
      key: `${conversation ? 'deepchat/media-session/v1' : 'deepchat/provider/v2'}/${providerId}/${modelId}`,
      displayName: provider.name,
      connection,
      model
    })
    const current = this.requireProvider(providerId, historyOnly)
    if (!historyOnly && !this.options.settings.getModelStatus(providerId, modelId))
      throw new Error('Model is disabled')
    if (fingerprint(this.connection(current, modelId, config)) !== fingerprint(connection))
      throw new Error('Provider connection changed during native configuration')
    if (connection.credential) {
      const reference = this.credentialReference(provider)
      this.options.grants.put({
        nativeProviderId: target.providerId,
        providerId,
        modelId,
        reference,
        connectionFingerprint: fingerprint(this.credentialScope(provider))
      })
    }
    return target
  }

  async connectionAuth(
    nativeProviderId: string,
    modelId: string,
    rejectedLease: string | undefined,
    signal: AbortSignal
  ): Promise<DimOAuthConnection | null> {
    signal.throwIfAborted()
    const draft = this.drafts.get(nativeProviderId)
    if (draft) return draft.connectionAuth(nativeProviderId, modelId, rejectedLease, signal)
    const grant = this.options.grants.get(nativeProviderId)
    if (!grant) return null
    if (grant.modelId !== modelId) throw new Error('Native connection has a different model grant')
    const current = () => {
      signal.throwIfAborted()
      const provider = this.requireProvider(grant.providerId)
      if (!this.options.settings.getModelStatus(grant.providerId, grant.modelId))
        throw new Error('Model is disabled')
      if (fingerprint(this.credentialScope(provider)) !== grant.connectionFingerprint)
        throw new Error('Provider connection was replaced')
      return provider
    }
    const provider = current()
    const connection =
      (await this.options.connectionAuth?.(provider, rejectedLease, signal)) ?? null
    current()
    return connection
  }

  async credential(
    nativeProviderId: string,
    reference: string,
    signal: AbortSignal
  ): Promise<DimCredential> {
    signal.throwIfAborted()
    const draft = this.drafts.get(nativeProviderId)
    if (draft) return draft.credential(nativeProviderId, reference, signal)
    const grant = this.options.grants.get(nativeProviderId)
    if (!grant) throw new Error('Unknown native credential grant')
    const provider = this.requireProvider(grant.providerId)
    if (!this.options.settings.getModelStatus(grant.providerId, grant.modelId))
      throw new Error('Model is disabled')
    if (fingerprint(this.credentialScope(provider)) !== grant.connectionFingerprint)
      throw new Error('Provider connection was replaced')
    let value: DimCredential
    if (reference === grant.reference) {
      // Acknowledgement only: Anonymous never places this value in provider HTTP.
      value = isAnonymous(provider)
        ? 'deepchat-admission-v1'
        : await this.options.credential(provider, signal)
    } else {
      const header = Object.entries(provider.customHeaders ?? {}).find(
        ([name, value]) => value && headerReference(provider.id, name, value) === reference
      )
      if (!header) throw new Error('Unknown native credential grant')
      value = header[1]
    }
    signal.throwIfAborted()
    const current = this.requireProvider(grant.providerId)
    if (!this.options.settings.getModelStatus(grant.providerId, grant.modelId))
      throw new Error('Model is disabled')
    if (fingerprint(this.credentialScope(current)) !== grant.connectionFingerprint)
      throw new Error('Provider connection changed during credential lookup')
    return value
  }

  private requireProvider(id: string, historyOnly = false): LLM_PROVIDER {
    const provider = this.options.settings.getProviderById(id)
    if (!provider || (!historyOnly && !provider.enable)) throw new Error('Provider is unavailable')
    return provider
  }

  private credentialScope(provider: LLM_PROVIDER): JsonObject {
    return {
      id: provider.id,
      apiType: provider.apiType,
      baseUrl: provider.baseUrl,
      openaiAuthMode: provider.openaiAuthMode ?? 'api-key',
      anonymous: isAnonymous(provider),
      copilotClientId: provider.copilotClientId ?? '',
      ...(isVertex(provider) ? { vertex: resolveVertexSettings(provider as VERTEX_PROVIDER) } : {}),
      ...(isBedrock(provider)
        ? {
            aws: {
              authMode: (provider as AWS_BEDROCK_PROVIDER).credential?.authMode ?? 'accessKeys',
              profile: (provider as AWS_BEDROCK_PROVIDER).credential?.profile ?? '',
              region: bedrockRegion(provider)
            }
          }
        : {}),
      customHeaders: provider.customHeaders ?? {}
    }
  }

  private credentialReference(provider: LLM_PROVIDER): string {
    if (resolveAiSdkProviderDefinition(provider)?.runtimeKind === 'openai-codex')
      return `deepchat/codex/v1/${encodeURIComponent(provider.id)}/${fingerprint(this.credentialScope(provider))}`
    return isBedrock(provider) || isCopilot(provider) || isVertex(provider)
      ? `deepchat/provider/scoped/v1/${encodeURIComponent(provider.id)}/${fingerprint(this.credentialScope(provider))}`
      : `deepchat/provider/v1/${encodeURIComponent(provider.id)}`
  }

  private connection(provider: LLM_PROVIDER, modelId: string, config: ModelConfig): JsonObject {
    const definition = resolveAiSdkProviderDefinition(provider)
    const anonymous = isAnonymous(provider)
    const copilot = isCopilot(provider)
    const jev = provider.id === 'jev' || provider.apiType === 'jev'
    if (
      !definition &&
      !anonymous &&
      !isOllama(provider) &&
      !copilot &&
      !jev &&
      !isVoiceAi(provider)
    )
      throw new Error('Provider needs a native product connection adapter')
    const kind = definition
      ? resolveProviderTransport(
          definition,
          provider,
          modelId,
          this.options.settings.getProviderModelRouteMetadata(provider.id, modelId, config) ?? null
        ).providerKind
      : 'openai-compatible'
    const vertex =
      kind === 'vertex' ? resolveVertexSettings(provider as VERTEX_PROVIDER) : undefined
    const driver = {
      'openai-compatible': ['deepseek', 'moonshotai', 'aihubmix', 'zenmux'].includes(provider.id)
        ? provider.id
        : 'openai-compatible',
      'openai-responses': 'openai-responses',
      'deepseek-open-responses': 'openai-responses',
      anthropic: 'anthropic',
      gemini: 'gemini',
      azure: 'azure-openai',
      'aws-bedrock': 'amazon-bedrock',
      vertex: 'gemini',
      'openai-codex': 'openai-responses'
    }[kind]
    const auth: JsonObject = anonymous
      ? { type: 'anonymous' }
      : vertex
        ? vertex.apiKey
          ? { type: 'api_key', headerName: 'x-goog-api-key', prefix: '' }
          : { type: 'bearer' }
        : kind === 'anthropic'
          ? { type: 'api_key', headerName: 'x-api-key', prefix: '' }
          : kind === 'gemini'
            ? { type: 'api_key', headerName: 'x-goog-api-key', prefix: '' }
            : kind === 'azure'
              ? { type: 'api_key', headerName: 'api-key', prefix: '' }
              : kind === 'aws-bedrock'
                ? { type: 'aws_bedrock' }
                : { type: 'bearer' }
    let baseUrl = (
      provider.baseUrl ||
      (jev
        ? 'https://api.typesafe.ai/v1/systemone'
        : isVoiceAi(provider)
          ? 'https://dev.voice.ai'
          : '')
    ).replace(/\/+$/, '')
    if (kind === 'openai-codex') baseUrl = normalizeOpenAICodexBaseUrl(provider.baseUrl)
    if (vertex) baseUrl = vertex.baseUrl
    if (kind === 'aws-bedrock' && !baseUrl)
      baseUrl = `https://bedrock-runtime.${bedrockRegion(provider)}.amazonaws.com`
    if (isOllama(provider)) baseUrl = baseUrl.replace(/\/(api|v1)$/, '') + '/v1'
    const url = new URL(baseUrl)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      throw new Error('Invalid native provider endpoint')
    if (
      config.type === ModelType.Judgment &&
      (provider.id === 'workers-ai' || provider.apiType === 'workers-ai') &&
      ((url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ||
        /[<>]/.test(baseUrl) ||
        !/\/accounts\/[^/]+\/ai\/v1$/.test(url.pathname.replace(/\/+$/, '')))
    )
      throw new Error('Invalid native Workers AI judgment endpoint')
    return {
      driverKind: driver,
      auth,
      baseUrl,
      credential: {
        action: 'set_ref',
        reference: this.credentialReference(provider)
      },
      headers: {
        ...definition?.defaultHeadersPatch,
        ...(copilot ? GITHUB_COPILOT_CHAT_HEADERS : {}),
        ...Object.fromEntries(
          Object.entries(provider.customHeaders ?? {}).map(([name, value]) => [
            name,
            value ? `deepchat-header-ref:v1:${headerReference(provider.id, name, value)}` : ''
          ])
        )
      },
      ...(config.timeout && config.timeout > 0 ? { network: { timeoutMs: config.timeout } } : {})
    }
  }
}

function isBedrock(provider: LLM_PROVIDER): boolean {
  return provider.apiType === 'aws-bedrock' || provider.id === 'aws-bedrock'
}
function isCopilot(provider: LLM_PROVIDER): boolean {
  return provider.apiType === 'github-copilot' || provider.id === 'github-copilot'
}
function isVertex(provider: LLM_PROVIDER): boolean {
  return provider.apiType === 'vertex' || provider.id === 'vertex'
}
function bedrockRegion(provider: LLM_PROVIDER): string {
  const region =
    (provider as AWS_BEDROCK_PROVIDER).credential?.region || process.env.AWS_REGION || 'us-east-1'
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(region)) throw new Error('Invalid native AWS region')
  return region
}

function isVoiceAi(provider: LLM_PROVIDER): boolean {
  return provider.id === 'voiceai' || provider.apiType === 'voiceai'
}

function isOllama(provider: LLM_PROVIDER): boolean {
  return provider.apiType === 'ollama' || provider.id === 'ollama'
}
function isAnonymous(provider: LLM_PROVIDER): boolean {
  return (
    !provider.apiKey &&
    provider.openaiAuthMode !== 'chatgpt' &&
    (isOllama(provider) ||
      ['openai', 'openai-completions', 'openai-responses'].includes(provider.apiType ?? 'openai'))
  )
}

function headerReference(providerId: string, name: string, value: string): string {
  // Rotation creates a different immutable connection and revokes previous grants. Only a
  // digest is durable; the product's protected credential owner retains the actual value.
  return `deepchat/header/v1/${encodeURIComponent(providerId)}/${encodeURIComponent(name)}/${fingerprint(value)}`
}

function dimModality(config: ModelConfig): { kind: string; output?: string; operations: string[] } {
  switch (config.type) {
    case ModelType.Judgment:
      return { kind: 'judgment', operations: ['decision.decide'] }
    case ModelType.Embedding:
      return { kind: 'embedding', operations: ['embedding.embed'] }
    case ModelType.ImageGeneration:
      return {
        kind: 'image-generation',
        output: 'image',
        operations: ['image.generate', 'image.edit']
      }
    case ModelType.VideoGeneration:
      return { kind: 'video-generation', output: 'video', operations: ['video.generate'] }
    case ModelType.TTS:
      return { kind: 'tts', output: 'audio', operations: ['speech.synthesize'] }
    default:
      return {
        kind: config.type ?? 'chat',
        operations: config.speechRecognition ? ['speech.transcribe'] : []
      }
  }
}

type GenerationParameters = Pick<
  SessionGenerationSettings,
  | 'temperature'
  | 'maxTokens'
  | 'topP'
  | 'reasoningEffort'
  | 'thinkingBudget'
  | 'reasoningVisibility'
>

export function dimModelParameters(
  catalog: Pick<
    CatalogOptions['settings'],
    'getProviderById' | 'getModelConfig' | 'getProviderModelRouteMetadata' | 'getCapabilitySnapshot'
  >,
  providerId: string,
  modelId: string,
  settings: GenerationParameters
): DimModelParameters {
  const parameters = {
    temperature: settings.temperature,
    ...(settings.topP === undefined ? {} : { topP: settings.topP }),
    maxTokens: settings.maxTokens
  }
  const { reasoningEffort, reasoningVisibility, thinkingBudget } = settings
  if (!reasoningEffort && !reasoningVisibility && thinkingBudget === undefined) return parameters

  const provider = catalog.getProviderById(providerId)
  const definition = provider && resolveAiSdkProviderDefinition(provider)
  const kind =
    provider && definition
      ? resolveProviderTransport(
          definition,
          provider,
          modelId,
          catalog.getProviderModelRouteMetadata(
            providerId,
            modelId,
            catalog.getModelConfig(modelId, providerId)
          ) ?? null
        ).providerKind
      : 'openai-compatible'
  const gemini = kind === 'gemini' || kind === 'vertex'
  const bedrock = kind === 'aws-bedrock'
  const anthropic = kind === 'anthropic'
  const reasoningMode =
    anthropic || gemini
      ? catalog.getCapabilitySnapshot({ providerId, modelId }).reasoningPortrait?.mode
      : undefined
  const adaptive =
    anthropic &&
    reasoningMode === 'effort' &&
    reasoningEffort !== 'none' &&
    (reasoningEffort !== undefined || reasoningVisibility !== undefined)
  const useBudget =
    thinkingBudget !== undefined &&
    reasoningEffort !== 'none' &&
    ((gemini && reasoningMode !== 'level' && (!reasoningEffort || reasoningMode === 'budget')) ||
      ((anthropic || bedrock) && !adaptive && thinkingBudget > 0))
  const reasoning: JsonObject = {
    ...(reasoningEffort && !bedrock && !(gemini && useBudget) ? { effort: reasoningEffort } : {}),
    ...(useBudget ? { budgetTokens: thinkingBudget } : {}),
    ...(gemini && reasoningVisibility ? { includeThoughts: reasoningVisibility !== 'hidden' } : {})
  }
  return {
    ...parameters,
    ...(Object.keys(reasoning).length ? { reasoning } : {}),
    ...(adaptive ? { providerOptions: { anthropic: { thinking: { type: 'adaptive' } } } } : {})
  }
}

function fingerprint(value: JsonValue): string {
  const canonical = (input: JsonValue): JsonValue =>
    Array.isArray(input)
      ? input.map(canonical)
      : input && typeof input === 'object'
        ? Object.fromEntries(
            Object.keys(input)
              .sort()
              .map((key) => [key, canonical(input[key])])
          )
        : input
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}
