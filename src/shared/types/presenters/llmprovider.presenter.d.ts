import { ShowResponse } from 'ollama'
import type { ChatMessage } from '../core/chat-message'
import { ModelType } from '../core/model'
import type { NewApiEndpointType } from '@shared/model'
import type { ImageGenerationOptions } from '../../imageGenerationSettings'
import type { VideoGenerationOptions } from '../../videoGenerationSettings'

/**
 * LLM Provider Presenter Interface
 * Handles LLM provider management, model operations, and stream completions
 */

export type RENDERER_MODEL_META = {
  id: string
  name: string
  group: string
  providerId: string
  enabled?: boolean
  isCustom?: boolean
  vision?: boolean
  functionCall?: boolean
  explicitFunctionCall?: boolean
  reasoning?: boolean
  enableSearch?: boolean
  type?: ModelType
  contextLength?: number
  maxTokens?: number
  description?: string
  supportedEndpointTypes?: NewApiEndpointType[]
  selectableEndpointTypes?: NewApiEndpointType[]
  endpointType?: NewApiEndpointType
  ownedBy?: string
}

export type MODEL_META = {
  id: string
  name: string
  group: string
  providerId: string
  enabled?: boolean
  isCustom?: boolean
  vision?: boolean
  functionCall?: boolean
  reasoning?: boolean
  enableSearch?: boolean
  type?: ModelType
  contextLength?: number
  maxTokens?: number
  description?: string
  supportedEndpointTypes?: NewApiEndpointType[]
  selectableEndpointTypes?: NewApiEndpointType[]
  endpointType?: NewApiEndpointType
  ownedBy?: string
}

export type LLM_PROVIDER = {
  id: string
  capabilityProviderId?: string
  name: string
  apiType: string
  apiKey: string
  copilotClientId?: string
  baseUrl: string
  models?: MODEL_META[]
  customModels?: MODEL_META[]
  enable: boolean
  enabledModels?: string[]
  disabledModels?: string[]
  custom?: boolean
  oauthToken?: string
  websites?: {
    official: string
    apiKey: string
    name?: string
    icon?: string
    docs?: string
    models?: string
    defaultBaseUrl?: string
  }
  rateLimit?: {
    enabled: boolean
    qpsLimit: number
  }
  rateLimitConfig?: {
    enabled: boolean
    qpsLimit: number
  }
}

export type LLM_PROVIDER_BASE = Omit<
  LLM_PROVIDER,
  'models' | 'customModels' | 'enabledModels' | 'disabledModels'
> & {
  models?: MODEL_META[]
  customModels?: MODEL_META[]
  enabledModels?: string[]
  disabledModels?: string[]
  websites?: {
    official: string
    apiKey: string
    name?: string
    icon?: string
    docs?: string
    models?: string
    defaultBaseUrl?: string
  }
}

export type LLM_EMBEDDING_ATTRS = {
  dimensions: number
  normalized: boolean
}

export type StandaloneImageGenerationResult = {
  providerId: string
  modelId: string
  options?: ImageGenerationOptions
  images: Array<{ data: string; mimeType: string }>
}

export type StandaloneVideoGenerationResult = {
  providerId: string
  modelId: string
  options?: VideoGenerationOptions
  videos: Array<{ data: string; mimeType: string }>
}

export interface KeyStatus {
  remainNum?: number
  /** Remaining quota */
  limit_remaining?: string
  /** Used quota */
  usage?: string
}

export interface AwsBedrockCredential {
  authMode?: 'accessKeys' | 'profile'
  accessKeyId: string
  secretAccessKey: string
  region?: string
  profile?: string
}

export type AWS_BEDROCK_PROVIDER = LLM_PROVIDER & {
  credential?: AwsBedrockCredential
}

export type VERTEX_PROVIDER = LLM_PROVIDER & {
  projectId?: string
  location?: string
  accountPrivateKey?: string
  accountClientEmail?: string
  apiVersion?: 'v1' | 'v1beta1'
  endpointMode?: 'standard' | 'express'
}

export interface OllamaModel {
  name: string
  model?: string
  size: number
  digest: string
  modified_at: string | Date
  details: {
    format: string
    family: string
    families?: string[]
    parameter_size: string
    quantization_level: string
  }
  model_info?: {
    context_length?: number
    embedding_length?: number
    vision?: {
      embedding_length: number
    }
    general?: {
      architecture?: string
      file_type?: string
      parameter_count?: number
      quantization_version?: number
    }
  }
  capabilities?: string[]
}

export interface ModelScopeMcpSyncOptions {
  timeout?: number
  retryCount?: number
}

export interface ModelScopeMcpSyncResult {
  success: boolean
  message: string
  synced: number
  imported: number
  skipped: number
  errors: string[]
}

export type RateLimitQueueSnapshot = {
  providerId: string
  qpsLimit: number
  currentQps: number
  queueLength: number
  estimatedWaitTime: number
}

export type AcpConfigOptionValue = {
  value: string
  label: string
  description?: string | null
  groupId?: string | null
  groupLabel?: string | null
}

export type AcpConfigOption = {
  id: string
  label: string
  description?: string | null
  type: 'select' | 'boolean'
  category?: string | null
  currentValue: string | boolean
  options?: AcpConfigOptionValue[]
}

export type AcpConfigState = {
  source: 'configOptions' | 'legacy'
  options: AcpConfigOption[]
}

export interface ILlmProviderPresenter {
  setProviders(provider: LLM_PROVIDER[]): void
  getProviders(): LLM_PROVIDER[]
  getProviderById(id: string): LLM_PROVIDER
  getProviderInstance(providerId: string): unknown
  getExistingProviderInstance(providerId: string): unknown
  getModelList(providerId: string): Promise<MODEL_META[]>
  updateModelStatus(providerId: string, modelId: string, enabled: boolean): Promise<void>
  batchUpdateModelStatus(
    providerId: string,
    updates: { modelId: string; enabled: boolean }[]
  ): Promise<void>
  addCustomModel(
    providerId: string,
    model: Omit<MODEL_META, 'providerId' | 'isCustom' | 'group'>
  ): Promise<MODEL_META>
  removeCustomModel(providerId: string, modelId: string): Promise<boolean>
  updateCustomModel(
    providerId: string,
    modelId: string,
    updates: Partial<MODEL_META>
  ): Promise<boolean>
  getCustomModels(providerId: string): Promise<MODEL_META[]>
  generateCompletion(
    providerId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string>
  generateText(
    providerId: string,
    prompt: string,
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    options?: { signal?: AbortSignal }
  ): Promise<{ content: string }>
  stopStream(eventId: string): Promise<void>
  check(providerId: string, modelId?: string): Promise<{ isOk: boolean; errorMsg: string | null }>
  getKeyStatus(providerId: string): Promise<KeyStatus | null>
  refreshModels(providerId: string): Promise<void>
  summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    providerId: string,
    modelId: string
  ): Promise<string>
  listOllamaModels(providerId: string): Promise<OllamaModel[]>
  showOllamaModelInfo(providerId: string, modelName: string): Promise<ShowResponse>
  listOllamaRunningModels(providerId: string): Promise<OllamaModel[]>
  pullOllamaModels(providerId: string, modelName: string): Promise<boolean>
  getEmbeddings(
    providerId: string,
    modelId: string,
    texts: string[],
    signal?: AbortSignal
  ): Promise<number[][]>
  getDimensions(
    providerId: string,
    modelId: string,
    signal?: AbortSignal
  ): Promise<{ data: LLM_EMBEDDING_ATTRS; errorMsg?: string }>
  updateProviderRateLimit(providerId: string, enabled: boolean, qpsLimit: number): void
  getProviderRateLimitStatus(providerId: string): {
    config: { enabled: boolean; qpsLimit: number }
    currentQps: number
    queueLength: number
    lastRequestTime: number
  }
  getAllProviderRateLimitStatus(): Record<
    string,
    {
      config: { enabled: boolean; qpsLimit: number }
      currentQps: number
      queueLength: number
      lastRequestTime: number
    }
  >
  executeWithRateLimit(
    providerId: string,
    options?: {
      signal?: AbortSignal
      onQueued?: (snapshot: RateLimitQueueSnapshot) => void
      scope?: 'provider' | 'acp-direct'
    }
  ): Promise<void>
  syncModelScopeMcpServers(
    providerId: string,
    syncOptions?: ModelScopeMcpSyncOptions
  ): Promise<ModelScopeMcpSyncResult>

  generateCompletionStandalone(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    options?: { signal?: AbortSignal; swallowErrors?: boolean }
  ): Promise<string>

  transcribeAudioStandalone(
    providerId: string,
    modelId: string,
    audioBase64: string,
    mimeType: string,
    filename?: string,
    options?: { signal?: AbortSignal }
  ): Promise<string>

  generateImageStandalone(
    providerId: string,
    prompt: string,
    modelId: string,
    imageOptions?: ImageGenerationOptions,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneImageGenerationResult>

  generateVideoStandalone(
    providerId: string,
    prompt: string,
    modelId: string,
    videoOptions?: VideoGenerationOptions,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneVideoGenerationResult>
}
