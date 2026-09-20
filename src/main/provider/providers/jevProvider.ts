import type { ProviderSettingsPort } from '@/provider/settings'
import type { JevJudgmentRequest, JevJudgmentResult, JevQuestion } from '@shared/jevProtocol'
import { ModelType } from '@shared/model'
import type { ChatMessage } from '@shared/types/core/chat-message'
import { createStreamEvent, type LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type {
  LLM_PROVIDER,
  LLMResponse,
  MODEL_META,
  ModelConfig,
  ProviderStreamOptions
} from '@shared/types/provider'
import { BaseLLMProvider, type ProviderGenerateTextOptions } from '../baseProvider'
import type { ProviderLocalePort } from '../ports'
import { createProviderHttpErrorFromResponse } from '../providerFailure'

const DEFAULT_BASE_URL = 'https://api.typesafe.ai'
const SYSTEM_ONE_PATH = '/v1/systemone'
const MODELS_PATH = '/v1/models'
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Jev's documented budget: 64k tokens per request, 32k for state plus the longest question. */
const JEV_CONTEXT_LENGTH = 64_000

/**
 * Chat-shaped entry points are unsupported by design. Jev returns typed answers rather than
 * generating text, so a caller that reaches a chat path has selected the wrong kind of model.
 * Failing loudly here keeps that mistake at selection time instead of turning it into a
 * confusing empty response.
 */
export const JEV_UNSUPPORTED_CAPABILITY_ERROR = 'jev-unsupported-capability'

export function isJevUnsupportedCapabilityError(error: unknown): boolean {
  return error instanceof Error && error.message === JEV_UNSUPPORTED_CAPABILITY_ERROR
}

/**
 * Type guard for the judgment capability. Used by the runtime so a non-System-One provider fails
 * with a clear message instead of a missing-method crash.
 */
export function supportsJevJudgment(provider: unknown): provider is JevProvider {
  return provider instanceof JevProvider
}

type JevModelRecord = {
  name: string
  description?: string
  release_date?: string
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

/**
 * TypeSafe publishes its catalog as `{ "models": [{ "name", "description", "release_date" }] }`,
 * which is not the OpenAI `{ "data": [...] }` shape, so it is parsed here rather than delegated
 * to the shared tolerant OpenAI parser.
 */
export function extractJevModelRecords(payload: unknown): JevModelRecord[] {
  const root = asRecord(payload)
  const models = root?.models
  if (!Array.isArray(models)) {
    throw new Error('Invalid TypeSafe model catalog response')
  }

  const records: JevModelRecord[] = []
  for (const entry of models) {
    const record = asRecord(entry)
    const name = normalizeString(record?.name)
    if (!name) continue
    records.push({
      name,
      description: normalizeString(record?.description),
      release_date: normalizeString(record?.release_date)
    })
  }
  return records
}

function parseJudgmentAnswers(payload: unknown): JevJudgmentResult {
  const root = asRecord(payload)
  const answers = asRecord(root?.answers)
  if (!answers) {
    throw new Error('Invalid TypeSafe judgment response: missing answers')
  }

  const usage = asRecord(root?.usage)
  return {
    model: normalizeString(root?.model) ?? '',
    answers: answers as JevJudgmentResult['answers'],
    ...(usage
      ? {
          usage: {
            input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
            output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined
          }
        }
      : {})
  }
}

export class JevProvider extends BaseLLMProvider {
  constructor(
    provider: LLM_PROVIDER,
    providerSettings: ProviderSettingsPort,
    locale: ProviderLocalePort
  ) {
    super(provider, providerSettings, locale)
    this.init()
  }

  public onProxyResolved(): void {}

  public async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    if (!this.provider.apiKey) {
      return { isOk: false, errorMsg: 'API key is required' }
    }

    try {
      // The authenticated catalog fetch is the check. It spends no tokens, which matters because
      // TypeSafe bills input tokens per request and a generation probe is not meaningful for a
      // non-generative model.
      await this.listModels()
      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      return { isOk: false, errorMsg: error instanceof Error ? error.message : String(error) }
    }
  }

  public async summaryTitles(_messages: ChatMessage[], _modelId: string): Promise<string> {
    throw new Error(JEV_UNSUPPORTED_CAPABILITY_ERROR)
  }

  public async completions(
    _messages: ChatMessage[],
    _modelId: string,
    _temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    throw new Error(JEV_UNSUPPORTED_CAPABILITY_ERROR)
  }

  public async summaries(
    _text: string,
    _modelId: string,
    _temperature?: number,
    _maxTokens?: number
  ): Promise<LLMResponse> {
    throw new Error(JEV_UNSUPPORTED_CAPABILITY_ERROR)
  }

  public async generateText(
    _prompt: string,
    _modelId: string,
    _temperature?: number,
    _maxTokens?: number,
    _options?: ProviderGenerateTextOptions
  ): Promise<LLMResponse> {
    throw new Error(JEV_UNSUPPORTED_CAPABILITY_ERROR)
  }

  public async *coreStream(
    _messages: ChatMessage[],
    _modelId: string,
    _modelConfig: ModelConfig,
    _temperature: number,
    _maxTokens: number,
    _mcpTools: MCPToolDefinition[],
    options?: ProviderStreamOptions
  ): AsyncGenerator<LLMCoreStreamEvent> {
    options?.signal?.throwIfAborted()
    yield createStreamEvent.error(JEV_UNSUPPORTED_CAPABILITY_ERROR)
    yield createStreamEvent.stop('error')
  }

  /**
   * Evaluates typed questions against a state. This is the only operation this provider supports,
   * and it returns typed answers rather than text.
   */
  public async runJudgment(
    request: JevJudgmentRequest,
    options?: { signal?: AbortSignal }
  ): Promise<JevJudgmentResult> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }
    if (Object.keys(request.questions ?? {}).length === 0) {
      throw new Error('Jev judgment requires at least one question')
    }

    const { signal, cleanup } = this.createRequestSignal(options?.signal)
    try {
      const response = await this.fetchProvider(this.buildUrl(SYSTEM_ONE_PATH), {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          state: request.state,
          model: request.model,
          questions: request.questions
        }),
        signal
      })

      if (!response.ok) {
        throw createProviderHttpErrorFromResponse(
          `TypeSafe judgment failed: ${response.status} ${response.statusText}`,
          response,
          'jev_http_error'
        )
      }

      return parseJudgmentAnswers(await response.json())
    } finally {
      cleanup()
    }
  }

  protected async fetchProviderModels(): Promise<MODEL_META[]> {
    if (!this.provider.apiKey) return []

    try {
      const records = await this.listModels()
      return records.map((record) => this.toModelMeta(record))
    } catch (error) {
      console.error('[Jev] Failed to fetch models:', error)
      return []
    }
  }

  private toModelMeta(record: JevModelRecord): MODEL_META {
    return {
      id: record.name,
      name: record.name,
      group: 'default',
      providerId: this.provider.id,
      isCustom: false,
      type: ModelType.Judgment,
      contextLength: JEV_CONTEXT_LENGTH,
      description: record.description
    }
  }

  private async listModels(signal?: AbortSignal): Promise<JevModelRecord[]> {
    const { signal: requestSignal, cleanup } = this.createRequestSignal(signal)
    try {
      const response = await this.fetchProvider(this.buildUrl(MODELS_PATH), {
        method: 'GET',
        headers: this.getAuthHeaders(),
        signal: requestSignal
      })

      if (!response.ok) {
        throw createProviderHttpErrorFromResponse(
          `TypeSafe model catalog failed: ${response.status} ${response.statusText}`,
          response,
          'jev_models_http_error'
        )
      }

      return extractJevModelRecords(await response.json())
    } finally {
      cleanup()
    }
  }

  private getBaseUrl(): string {
    const raw = this.provider.baseUrl?.trim()
    if (raw && raw.length > 0) {
      return raw.replace(/\/+$/, '')
    }
    return DEFAULT_BASE_URL
  }

  private buildUrl(path: string): string {
    const base = this.getBaseUrl()
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${base}${normalizedPath}`
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.provider.apiKey) {
      throw new Error('API key is required')
    }

    return {
      Authorization: `Bearer ${this.provider.apiKey}`,
      'Content-Type': 'application/json',
      ...this.defaultHeaders
    }
  }

  private createRequestSignal(callerSignal?: AbortSignal): {
    signal: AbortSignal
    cleanup: () => void
  } {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS)
    const onParentAbort = () => controller.abort()
    callerSignal?.addEventListener('abort', onParentAbort, { once: true })

    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timeout)
        callerSignal?.removeEventListener('abort', onParentAbort)
      }
    }
  }
}

export type { JevQuestion }
