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
import type { ProviderSettingsPort } from '@/provider/settings'
import type {
  DimProviderGrantsTable,
  DimProviderGrant
} from '@/session/data/tables/dimProviderGrants'
import { resolveAiSdkProviderDefinition } from '@/provider/providerRegistry'
import { resolveProviderTransport } from '@/provider/providerTransport'
import { GITHUB_COPILOT_CHAT_HEADERS } from '@/provider/auth/githubCopilotProtocol'
import { resolveVertexSettings } from '@/provider/vertexSettings'
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
  >
  models: Pick<DimModelBridge, 'configure'> & Partial<Pick<DimModelBridge, 'releaseConfiguration'>>
  grants: Pick<DimProviderGrantsTable, 'get' | 'put'>
  credential(provider: LLM_PROVIDER, signal: AbortSignal): Promise<DimCredential>
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
      credential: (_provider, signal) => this.options.credential(draft, signal)
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
    options?: { timeout?: number }
  ): Promise<DimModelId> {
    return this.configure(providerId, modelId, options, false)
  }

  /** Register a frozen history container. This never authorizes inference or credential access. */
  async registerForHistory(
    providerId: string,
    modelId: string,
    options?: { timeout?: number }
  ): Promise<DimModelId> {
    return this.configure(providerId, modelId, options, true)
  }

  private async configure(
    providerId: string,
    modelId: string,
    options: { timeout?: number } | undefined,
    historyOnly: boolean
  ): Promise<DimModelId> {
    const provider = this.requireProvider(providerId, historyOnly)
    if (!historyOnly && !this.options.settings.getModelStatus(providerId, modelId))
      throw new Error('Model is disabled')
    const config = {
      ...this.options.settings.getModelConfig(modelId, providerId),
      ...(options?.timeout === undefined ? {} : { timeout: options.timeout })
    }
    const connection = this.connection(provider, modelId, config)
    const capability = this.options.settings.getCapabilitySnapshot({ providerId, modelId })
    const portrait = capability.reasoningPortrait
    const modality = dimModality(config)
    const model: JsonObject & { modelId: string } = {
      modelId,
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
                deepchatMediaVendors: [
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
    const target = await this.options.models.configure({
      key: `deepchat/provider/v2/${providerId}/${modelId}`,
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
    return isBedrock(provider) || isCopilot(provider) || isVertex(provider)
      ? `deepchat/provider/scoped/v1/${encodeURIComponent(provider.id)}/${fingerprint(this.credentialScope(provider))}`
      : `deepchat/provider/v1/${encodeURIComponent(provider.id)}`
  }

  private connection(provider: LLM_PROVIDER, modelId: string, config: ModelConfig): JsonObject {
    const definition = resolveAiSdkProviderDefinition(provider)
    const anonymous = isAnonymous(provider)
    const copilot = isCopilot(provider)
    if (!definition && !anonymous && !isOllama(provider) && !copilot)
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
    let baseUrl = provider.baseUrl.replace(/\/+$/, '')
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

export function dimModelParameters(
  settings: Pick<
    SessionGenerationSettings,
    | 'temperature'
    | 'maxTokens'
    | 'topP'
    | 'reasoningEffort'
    | 'thinkingBudget'
    | 'reasoningVisibility'
    | 'forceInterleavedThinkingCompat'
  >
): DimModelParameters {
  const reasoning: JsonObject = {
    ...(settings.reasoningEffort ? { effort: settings.reasoningEffort } : {}),
    ...(settings.thinkingBudget && settings.thinkingBudget > 0
      ? { enabled: true, budgetTokens: settings.thinkingBudget }
      : {}),
    ...(settings.reasoningVisibility
      ? { includeThoughts: settings.reasoningVisibility !== 'hidden' }
      : {}),
    ...(settings.forceInterleavedThinkingCompat ? { interleavedThinking: true } : {})
  }
  return {
    temperature: settings.temperature,
    ...(settings.topP === undefined ? {} : { topP: settings.topP }),
    maxTokens: settings.maxTokens,
    ...(Object.keys(reasoning).length ? { reasoning } : {})
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
