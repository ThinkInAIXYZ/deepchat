import { createHash } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/json'
import type { LLM_PROVIDER, ModelConfig } from '@shared/types/provider'
import type { SessionGenerationSettings } from '@shared/types/agent-interface'
import type { ProviderSettingsPort } from '@/provider/settings'
import type { DimProviderGrantsTable } from '@/session/data/tables/dimProviderGrants'
import { resolveAiSdkProviderDefinition } from '@/provider/providerRegistry'
import { resolveProviderTransport } from '@/provider/providerTransport'
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
  models: Pick<DimModelBridge, 'configure'>
  grants: Pick<DimProviderGrantsTable, 'get' | 'put'>
  credential(provider: LLM_PROVIDER, signal: AbortSignal): Promise<DimCredential>
}

/** Converts product catalog facts, never an inference request or a provider response. */
export class DimModelCatalog {
  constructor(private readonly options: CatalogOptions) {}

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
    const model: JsonObject & { modelId: string } = {
      modelId,
      displayName: modelId,
      status: 'active',
      capabilities: {
        modalities: [
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
        reasoning: {
          ...(portrait ? JSON.parse(JSON.stringify(portrait)) : {}),
          supported: capability.supportsReasoning
        }
      }
    }
    const target = await this.options.models.configure({
      key: `${providerId}/${modelId}`,
      displayName: provider.name,
      connection,
      model
    })
    const current = this.requireProvider(providerId, historyOnly)
    if (!historyOnly && !this.options.settings.getModelStatus(providerId, modelId))
      throw new Error('Model is disabled')
    if (fingerprint(this.connection(current, modelId, config)) !== fingerprint(connection))
      throw new Error('Provider connection changed during native configuration')
    if (
      connection.credential &&
      typeof connection.credential === 'object' &&
      !Array.isArray(connection.credential)
    ) {
      const reference = connection.credential.reference
      if (typeof reference !== 'string')
        throw new Error('Native provider requires a credential reference')
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
    const grant = this.options.grants.get(nativeProviderId)
    if (!grant || grant.reference !== reference) throw new Error('Unknown native credential grant')
    const provider = this.requireProvider(grant.providerId)
    if (!this.options.settings.getModelStatus(grant.providerId, grant.modelId))
      throw new Error('Model is disabled')
    if (fingerprint(this.credentialScope(provider)) !== grant.connectionFingerprint)
      throw new Error('Provider connection was replaced')
    const value = await this.options.credential(provider, signal)
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
      copilotClientId: provider.copilotClientId ?? '',
      customHeaders: provider.customHeaders ?? {}
    }
  }

  private connection(provider: LLM_PROVIDER, modelId: string, config: ModelConfig): JsonObject {
    const definition = resolveAiSdkProviderDefinition(provider)
    const anonymous = provider.apiType === 'ollama' || provider.id === 'ollama'
    if (!definition && !anonymous)
      throw new Error('Provider needs a native product connection adapter')
    const kind = definition
      ? resolveProviderTransport(
          definition,
          provider,
          modelId,
          this.options.settings.getProviderModelRouteMetadata(provider.id, modelId, config) ?? null
        ).providerKind
      : 'openai-compatible'
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
    if (anonymous) baseUrl = baseUrl.replace(/\/(api|v1)$/, '') + '/v1'
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
      ...(anonymous
        ? {}
        : {
            credential: {
              action: 'set_ref',
              reference: `deepchat/provider/v1/${encodeURIComponent(provider.id)}`
            }
          }),
      headers: { ...definition?.defaultHeadersPatch, ...provider.customHeaders },
      ...(config.timeout && config.timeout > 0 ? { network: { timeoutMs: config.timeout } } : {})
    }
  }
}

export function dimModelParameters(settings: SessionGenerationSettings): DimModelParameters {
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
