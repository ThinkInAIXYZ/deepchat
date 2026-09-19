import type {
  LLM_PROVIDER,
  MODEL_META,
  RENDERER_MODEL_META,
  ModelConfig,
  ModelRouteConfig
} from '@deepchat/shared/types/provider'
import type { ResolvedCapabilityIdentity } from '@deepchat/shared/types/model-capabilities'
import type { ProviderBatchUpdate } from '@deepchat/shared/provider-operations'
import type { ProviderLocalePort } from '@deepchat/shared/provider/locale'
import type { ProviderDbLoader, ProviderDbRefreshResult } from './providerDbLoader.js'
import type { ModelCapabilities } from './modelCapabilities.js'
import type { createCapabilityResolver } from './capabilityIdentity.js'

export interface ProviderModelSettings {
  getProviderModels(providerId: string): MODEL_META[]
  getCustomModels(providerId: string): MODEL_META[]
  setProviderModels(providerId: string, models: MODEL_META[]): void
  notifyModelsChanged(providerId?: string): void
  addCustomModel(providerId: string, model: MODEL_META): void
  removeCustomModel(providerId: string, modelId: string): void
  updateCustomModel(providerId: string, modelId: string, updates: Partial<MODEL_META>): void
  getModelStatus(providerId: string, modelId: string): boolean
  setModelStatus(providerId: string, modelId: string, enabled: boolean): void
  ensureModelStatus(providerId: string, modelId: string, enabled: boolean): void
  batchSetModelStatusQuiet(providerId: string, status: Record<string, boolean>): void
  resolveEffectiveModels(models: MODEL_META[], providerId: string): MODEL_META[]
  getDbProviderModels(providerId: string): RENDERER_MODEL_META[]
  getModelRouteConfig(modelId: string, providerId?: string): ModelRouteConfig
  getProviderModelRouteMetadata(
    providerId: string,
    modelId: string,
    config?: ModelRouteConfig
  ): Pick<MODEL_META, 'endpointType' | 'supportedEndpointTypes' | 'type' | 'ownedBy'> | undefined
  getModelConfig(
    modelId: string,
    providerId?: string,
    identity?: ResolvedCapabilityIdentity,
    facts?: MODEL_META
  ): ModelConfig
  getAzureApiVersion(): string | undefined
  getVoiceAiConfig(): {
    audioFormat: string
    model: string
    language: string
    temperature: number
    topP: number
    agentId: string
  }
}

export interface ProviderRegistrySettings {
  getProviders(): LLM_PROVIDER[]
  getProviderById(id: string): LLM_PROVIDER | undefined
  setProviderById(id: string, provider: LLM_PROVIDER): void
  updateProviderAtomic(id: string, updates: Partial<LLM_PROVIDER>): boolean
  updateProvidersBatch(update: ProviderBatchUpdate): void
  addProviderAtomic(provider: LLM_PROVIDER): void
  removeProviderAtomic(id: string): void
  reorderProvidersAtomic(providers: LLM_PROVIDER[]): void
  refreshProviderDb(force?: boolean): Promise<ProviderDbRefreshResult>
}

export type ProviderSettingsPort = ProviderModelSettings & ProviderRegistrySettings
export type CacheImageOptions = { signal?: AbortSignal; allowPrivateNetwork?: boolean }
export type ProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface ProviderHost extends ProviderLocalePort {
  getDefaultHeaders(): Record<string, string>
  catalog: ProviderDbLoader
  capabilities: ModelCapabilities
  capabilityResolver: ReturnType<typeof createCapabilityResolver>
  cacheImage(data: string, options?: CacheImageOptions): Promise<string>
  fetchRemoteFile(
    url: string,
    options: CacheImageOptions & { timeoutMs: number; maxBytes: number }
  ): Promise<{ ok: boolean; status: number; data: Buffer; mimeType: string }>
  auth: {
    normalizeCodexBaseUrl(url: string | undefined): string
    codexFetch(headers: Record<string, string>, fetch: ProviderFetch): ProviderFetch
    usesGrokOAuth(provider: LLM_PROVIDER): boolean
    grokFetch(
      provider: LLM_PROVIDER,
      headers: Record<string, string>,
      fetch: ProviderFetch
    ): ProviderFetch
    isTrustedGrokEndpoint(url: string): boolean
    peekGrokToken(): string | null
    refreshGrokToken(): Promise<unknown>
    isGrokAuthenticated(): boolean
  }
}
