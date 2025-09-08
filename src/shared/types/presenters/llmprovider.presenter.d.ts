import { ShowResponse } from 'ollama'
import { ChatMessage, LLMAgentEvent } from '../core/chat'
import { ModelType } from '../core/model'

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
  reasoning?: boolean
  enableSearch?: boolean
  type?: ModelType
  contextLength?: number
  maxTokens?: number
  description?: string
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
}

export type LLM_PROVIDER = {
  id: string
  name: string
  apiType: string
  apiKey: string
  baseUrl: string
  models: MODEL_META[]
  customModels?: MODEL_META[]
  enable: boolean
  enabledModels: string[]
  disabledModels: string[]
  rateLimitConfig?: {
    enabled: boolean
    qpsLimit: number
  }
}

export type LLM_PROVIDER_BASE = {
  websites?: {
    official: string
    apiKey: string
    name: string
    icon: string
  }
} & LLM_PROVIDER

export type LLM_EMBEDDING_ATTRS = {
  dimensions: number
  normalized: boolean
}

export interface KeyStatus {
  remainNum?: number
  /** Remaining quota */
  limit_remaining?: string
  /** Used quota */
  usage?: string
}

export interface AwsBedrockCredential {
  accessKeyId: string
  secretAccessKey: string
  region?: string
}

export type AWS_BEDROCK_PROVIDER = LLM_PROVIDER & {
  credential?: AwsBedrockCredential
}

export interface OllamaModel {
  name: string
  size: number
  digest: string
  modified_at: string
  details: {
    format: string
    family: string
    families?: string[]
    parameter_size: string
    quantization_level: string
  }
  model_info?: {
    general?: {
      architecture?: string
      file_type?: string
      parameter_count?: number
      quantization_version?: number
    }
  }
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

export interface ILlmProviderPresenter {
  setProviders(provider: LLM_PROVIDER[]): void
  getProviders(): LLM_PROVIDER[]
  getProviderById(id: string): LLM_PROVIDER
  getModelList(providerId: string): Promise<MODEL_META[]>
  updateModelStatus(providerId: string, modelId: string, enabled: boolean): Promise<void>
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
  startStreamCompletion(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    eventId: string,
    temperature?: number,
    maxTokens?: number,
    enabledMcpTools?: string[],
    thinkingBudget?: number,
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high',
    verbosity?: 'low' | 'medium' | 'high',
    enableSearch?: boolean,
    forcedSearch?: boolean,
    searchStrategy?: 'turbo' | 'max'
  ): AsyncGenerator<LLMAgentEvent, void, unknown>
  generateCompletion(
    providerId: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string>
  stopStream(eventId: string): Promise<void>
  check(providerId: string, modelId?: string): Promise<{ isOk: boolean; errorMsg: string | null }>
  getKeyStatus(providerId: string): Promise<KeyStatus | null>
  refreshModels(providerId: string): Promise<void>
  summaryTitles(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    providerId: string,
    modelId: string
  ): Promise<string>
  listOllamaModels(): Promise<OllamaModel[]>
  showOllamaModelInfo(modelName: string): Promise<ShowResponse>
  listOllamaRunningModels(): Promise<OllamaModel[]>
  pullOllamaModels(modelName: string): Promise<boolean>
  deleteOllamaModel(modelName: string): Promise<boolean>
  getEmbeddings(providerId: string, modelId: string, texts: string[]): Promise<number[][]>
  getDimensions(
    providerId: string,
    modelId: string
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
  syncModelScopeMcpServers(
    providerId: string,
    syncOptions?: ModelScopeMcpSyncOptions
  ): Promise<ModelScopeMcpSyncResult>

  generateCompletionStandalone(
    providerId: string,
    messages: ChatMessage[],
    modelId: string,
    temperature?: number,
    maxTokens?: number
  ): Promise<string>
}
