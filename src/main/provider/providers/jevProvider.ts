import type { ProviderSettingsPort } from '@/provider/settings'
import type { JevJudgmentRequest, JevJudgmentResult } from '@shared/jevProtocol'
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
import { createProviderHttpErrorFromResponse, ProviderHttpError } from '../providerFailure'

/**
 * TypeSafe's own System One endpoint, used only when a provider carries no base URL. The configured
 * base URL is the endpoint itself rather than a host: vendors expose System One at different paths, so
 * the URL is taken whole instead of being assembled from a host plus a fixed route.
 */
const DEFAULT_BASE_URL = 'https://api.typesafe.ai/v1/systemone'

/** The catalog is the endpoint's sibling: `/v1/systemone` -> `/v1/models`. */
const CATALOG_SEGMENT = 'models'
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
 * The model catalog for a configured System One endpoint: its sibling path with the last segment
 * replaced by `models` (`/v1/systemone` -> `/v1/models`). Vendors that do not expose a catalog simply
 * answer 404 there, which discovery reads as "no live catalog" and the check as "not contradicted".
 */
export function resolveJevCatalogUrl(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint)
    const segments = url.pathname.split('/')
    if (segments.length < 2) return undefined

    segments[segments.length - 1] = CATALOG_SEGMENT
    url.pathname = segments.join('/')
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

const isMissingCatalogError = (error: unknown): boolean =>
  error instanceof ProviderHttpError &&
  (error.failure.statusCode === 404 || error.failure.statusCode === 405)

/**
 * Structural type guard for the judgment capability. Used by the runtime so a provider that cannot
 * judge fails with a clear message instead of a missing-method crash. It is structural rather than
 * `instanceof JevProvider` because one provider can serve judgments *and* ordinary chat models —
 * Cloudflare Workers AI does — so the capability cannot be tied to the System One class.
 */
export function supportsJevJudgment(provider: unknown): provider is JevJudgmentCapable {
  return typeof (provider as Partial<JevJudgmentCapable> | undefined)?.runJudgment === 'function'
}

/** The judgment capability, as the runtime consumes it. */
export type JevJudgmentCapable = {
  runJudgment(
    request: JevJudgmentRequest,
    options?: { signal?: AbortSignal }
  ): Promise<JevJudgmentResult>
}

type JevModelRecord = {
  name: string
  description?: string
  /** Retained for the deferred model-manager surfacing noted in the feature spec. */
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

/**
 * Parses the System One answer payload. Exported because a second transport (Cloudflare Workers AI)
 * returns the same answer shape inside its own envelope and unwraps it into this parser.
 */
export function parseJudgmentAnswers(payload: unknown): JevJudgmentResult {
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
      // A vendor that does not expose the sibling catalog answers 404/405 there. That says nothing
      // about the endpoint itself, and probing the endpoint would spend the vendor's tokens, so a
      // missing catalog is reported as usable rather than as a broken configuration.
      if (isMissingCatalogError(error)) {
        return { isOk: true, errorMsg: null }
      }
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
      // The configured base URL *is* the System One endpoint: vendors expose it at different paths,
      // so nothing is appended to it.
      const response = await this.fetchProvider(this.getBaseUrl(), {
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
    // The fallback matters because `BaseLLMProvider.fetchModels` persists whatever this returns, so
    // an empty list on a missing key or one transient failure would clear the per-provider model
    // store the picker actually reads.
    //
    // Preference order: the last-known catalog first, then the static seed. The last-known catalog
    // is `this.models`, loaded from the per-provider model store by the base constructor, and it is
    // the one that survives a provider reorder. `this.provider.models` does NOT survive: the
    // settings sidebar reorders by sending provider summaries, which omit `models` entirely, and the
    // reorder writes that array over the whole providers list. Seeding only from the settings JSON
    // would therefore leave the fallback empty exactly when it is needed.
    const fallback = this.models.length > 0 ? this.models : this.getBundledCatalog()
    if (!this.provider.apiKey) return fallback

    try {
      const records = await this.listModels()
      if (records.length === 0) return fallback
      return records.map((record) => this.toModelMeta(record))
    } catch (error) {
      console.error('[Jev] Failed to fetch models, falling back to the last-known catalog:', error)
      return fallback
    }
  }

  /** The static seed shipped in the provider profile. Only used when nothing has been discovered. */
  private getBundledCatalog(): MODEL_META[] {
    return this.provider.models ?? []
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
    const catalogUrl = resolveJevCatalogUrl(this.getBaseUrl())
    if (!catalogUrl) return []

    const { signal: requestSignal, cleanup } = this.createRequestSignal(signal)
    try {
      const response = await this.fetchProvider(catalogUrl, {
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

  /**
   * Delegates to the base helper rather than re-implementing it. The base version aborts with
   * `provider_request_timeout` on timeout and with the caller's own reason on cancellation, so the
   * two cases stay distinguishable downstream; a bare private controller would collapse them.
   */
  private createRequestSignal(callerSignal?: AbortSignal): {
    signal: AbortSignal | undefined
    cleanup: () => void
  } {
    const { signal, dispose } = this.createModelRequestSignal(
      { timeout: DEFAULT_REQUEST_TIMEOUT_MS },
      callerSignal
    )
    return { signal, cleanup: dispose }
  }
}
