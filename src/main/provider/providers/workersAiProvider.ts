import type { JevJudgmentRequest, JevJudgmentResult } from '@shared/jevProtocol'
import { isJevJudgmentModelId } from '@shared/jevProtocol'
import { ModelType } from '@shared/model'
import type { ChatMessage } from '@shared/types/core/chat-message'
import { createStreamEvent, type LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type { MODEL_META, ModelConfig, ProviderStreamOptions } from '@shared/types/provider'
import { AiSdkProvider, type RouteDecision, type RouteDecisionOptions } from './aiSdkProvider'
import { JEV_UNSUPPORTED_CAPABILITY_ERROR, parseJudgmentAnswers } from './jevProvider'

/**
 * Cloudflare Workers AI as one provider with two capabilities:
 *
 * - text generation and embedding models are served by the OpenAI-compatible endpoints
 *   (`{baseUrl}/chat/completions`, `{baseUrl}/embeddings`), which is what the AI SDK transport
 *   already speaks, so those models are ordinary chat and embedding models here;
 * - TypeSafe's `typesafe/jev` is a decision model rather than a chat model, and Workers AI serves it
 *   through the run API instead (`POST {apiRoot}/run` with `{ model, input: { state, questions } }`).
 *
 * `baseUrl` is the documented OpenAI-compatible base, `.../accounts/<ACCOUNT_ID>/ai/v1`. The run and
 * catalog endpoints hang off the same path with `/v1` removed, so one configured base URL serves
 * both capabilities and no extra setting is introduced.
 */
export const WORKERS_AI_BASE_URL_HINT =
  'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1'

export const WORKERS_AI_BASE_URL_ERROR = `Cloudflare base URL must look like ${WORKERS_AI_BASE_URL_HINT}`

const RUN_PATH = '/run'
const MODEL_SEARCH_PATH = '/models/search'
const JUDGMENT_TIMEOUT_MS = 30_000

/** Hosts for which plain HTTP is accepted: a proxy on this machine cannot be reached over TLS. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Cloudflare's model search is paginated; the catalog is well under this ceiling today. */
const MODEL_SEARCH_PAGE_SIZE = 100
const MAX_MODEL_SEARCH_PAGES = 5

/** The Workers AI model id for TypeSafe's Jev, and the id the profile ships in its catalog. */
export const WORKERS_AI_JEV_MODEL_ID = 'typesafe/jev'

/** Workers AI documents a 32k context window for that model. */
const JEV_CONTEXT_LENGTH = 32_000

/**
 * Workers AI task names whose models the OpenAI-compatible endpoints can serve. Everything else in
 * the catalog (image, speech, classification, rerank) needs a different transport and is not offered.
 */
const OPENAI_COMPATIBLE_TASK_TYPES: Record<string, ModelType> = {
  'text generation': ModelType.Chat,
  'text embeddings': ModelType.Embedding
}

export type WorkersAiModelRecord = {
  name: string
  task?: string
  description?: string
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

/** Task names arrive as `Text Generation`, `text-generation` or `text_generation`. */
const normalizeTaskKey = (value: string | undefined): string =>
  (value ?? '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The search response reports a model's task as a string, as `{ name }`, or as `{ id }`, where the id
 * is hyphenated (`text-generation`). All three are normalized to the task-name form the map uses.
 */
const resolveTaskName = (value: unknown): string | undefined => {
  const raw =
    typeof value === 'string'
      ? normalizeString(value)
      : (normalizeString(asRecord(value)?.name) ?? normalizeString(asRecord(value)?.id))
  return raw ? normalizeTaskKey(raw) : undefined
}

/**
 * Reads the model records out of a Workers AI model search response. An unrecognized shape yields no
 * records instead of throwing, so the caller keeps the last-known catalog rather than clearing the
 * per-provider store the pickers read.
 */
export function extractWorkersAiModelRecords(payload: unknown): WorkersAiModelRecord[] {
  const result = asRecord(payload)?.result
  if (!Array.isArray(result)) return []

  const records: WorkersAiModelRecord[] = []
  for (const entry of result) {
    const record = asRecord(entry)
    const name = normalizeString(record?.name)
    if (!name) continue
    records.push({
      name,
      task: resolveTaskName(record?.task),
      description: normalizeString(record?.description)
    })
  }
  return records
}

/** Cloudflare's V4 envelope reports pagination in `result_info`; absent means a single page. */
function resolveTotalPages(payload: unknown): number {
  const totalPages = asRecord(asRecord(payload)?.result_info)?.total_pages
  return typeof totalPages === 'number' && Number.isFinite(totalPages) && totalPages > 1
    ? Math.floor(totalPages)
    : 1
}

/**
 * Cloudflare reports a failed request in the envelope, which can arrive with a 2xx status. Without
 * this, a 200 body carrying `success: false` would read as an account with no models.
 */
export function assertWorkersAiSuccess(payload: unknown): void {
  const root = asRecord(payload)
  if (!root || root.success !== false) return

  const messages = Array.isArray(root.errors)
    ? root.errors
        .map((entry) => normalizeString(asRecord(entry)?.message))
        .filter((message): message is string => Boolean(message))
    : []
  throw new Error(messages.join('; ') || 'Cloudflare reported an unsuccessful response')
}

/** `undefined` means this transport cannot serve the model, which is why it is not offered. */
export function resolveWorkersAiModelType(record: WorkersAiModelRecord): ModelType | undefined {
  if (isJevJudgmentModelId(record.name)) return ModelType.Judgment
  return OPENAI_COMPATIBLE_TASK_TYPES[normalizeTaskKey(record.task)]
}

/**
 * The run API wraps the model output in `result`. An already-unwrapped body is accepted as well, so
 * a proxy that forwards the System One payload directly keeps working.
 */
export function unwrapWorkersAiResult(payload: unknown): unknown {
  const root = asRecord(payload)
  if (!root) return payload
  if (asRecord(root.answers)) return payload
  return asRecord(root.result) ?? payload
}

export class WorkersAiProvider extends AiSdkProvider {
  public override async check(): Promise<{ isOk: boolean; errorMsg: string | null }> {
    if (!this.provider.apiKey) {
      return { isOk: false, errorMsg: 'API key is required' }
    }

    try {
      // The authenticated model search is the check. It spends no neurons, and unlike the shared
      // `fetch-models` check it proves the account id in the base URL as well: that check would ask
      // the OpenAI-compatible path for a catalog it does not serve.
      await this.searchModels()
      return { isOk: true, errorMsg: null }
    } catch (error: unknown) {
      return { isOk: false, errorMsg: this.describeCheckFailure(error) }
    }
  }

  /**
   * Evaluates typed questions against a state on Workers AI. This is the judgment capability the
   * agent's judgment-model slot uses; the same provider serves the account's chat models through the
   * inherited AI SDK transport.
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

    const payload = await this.requestProviderJson<unknown>(
      `${this.resolveApiRoot()}${RUN_PATH}`,
      {
        method: 'POST',
        body: JSON.stringify({
          model: request.model,
          input: {
            state: request.state,
            questions: request.questions
          }
        })
      },
      { timeout: JUDGMENT_TIMEOUT_MS, signal: options?.signal }
    )

    return parseJudgmentAnswers(unwrapWorkersAiResult(payload))
  }

  /**
   * A judgment model is not a chat model. Every chat-shaped path resolves a route first, so refusing
   * here is what keeps `typesafe/jev` from being sent to the chat endpoint and answered as prose —
   * the failure the model type exists to prevent. The pickers already filter judgment models out of
   * chat surfaces; this is the boundary behind them.
   */
  protected override resolveRouteDecision(
    modelId: string,
    modelConfig?: ModelConfig,
    options?: RouteDecisionOptions
  ): RouteDecision {
    if (isJevJudgmentModelId(modelId)) {
      throw new Error(JEV_UNSUPPORTED_CAPABILITY_ERROR)
    }
    return super.resolveRouteDecision(modelId, modelConfig, options)
  }

  public override async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[],
    options?: ProviderStreamOptions
  ): AsyncGenerator<LLMCoreStreamEvent> {
    // A streaming surface reports failure as an event rather than a throw, so the refusal keeps the
    // shape the judgment-only provider uses.
    if (isJevJudgmentModelId(modelId)) {
      options?.signal?.throwIfAborted()
      yield createStreamEvent.error(JEV_UNSUPPORTED_CAPABILITY_ERROR)
      yield createStreamEvent.stop('error')
      return
    }
    yield* super.coreStream(messages, modelId, modelConfig, temperature, maxTokens, tools, options)
  }

  protected override async fetchProviderModels(): Promise<MODEL_META[]> {
    // `fetchModels` persists whatever this returns, so an empty list on a missing key or one
    // transient failure would clear the per-provider store the pickers read.
    const fallback = this.models.length > 0 ? this.models : (this.provider.models ?? [])
    if (!this.provider.apiKey) return this.withJudgmentModel(fallback)

    try {
      const records = await this.searchModels()
      const models = records.flatMap((record) => this.toModelMeta(record))
      return this.withJudgmentModel(models.length > 0 ? models : fallback)
    } catch (error) {
      console.error(
        '[WorkersAI] Failed to fetch models, falling back to the last-known catalog:',
        error
      )
      return this.withJudgmentModel(fallback)
    }
  }

  private toModelMeta(record: WorkersAiModelRecord): MODEL_META[] {
    const type = resolveWorkersAiModelType(record)
    if (!type) return []

    return [
      {
        id: record.name,
        name: record.name,
        group: 'default',
        providerId: this.provider.id,
        isCustom: false,
        type,
        ...(type === ModelType.Judgment ? { contextLength: JEV_CONTEXT_LENGTH } : {}),
        ...(record.description ? { description: record.description } : {})
      }
    ]
  }

  /**
   * The judgment model id is fixed and shipped by Workers AI, while the catalog is third-party: it
   * may omit the model, the refresh may fail, and a custom `workers-ai` provider has no bundled seed
   * at all. None of those may empty the judgment-model slot, so the fixed id is always merged back
   * in — from the bundled seed when there is one and from the built definition when there is not.
   * Other Jev-family entries the catalog lists are kept as they are: a variant does not stand in for
   * the id `runJudgment` sends.
   */
  private withJudgmentModel(models: MODEL_META[]): MODEL_META[] {
    const seeded = (this.provider.models ?? []).find(
      (model) => model.id === WORKERS_AI_JEV_MODEL_ID
    )

    return [
      ...models.filter((model) => model.id !== WORKERS_AI_JEV_MODEL_ID),
      seeded ?? this.buildJudgmentModel()
    ]
  }

  private buildJudgmentModel(): MODEL_META {
    return {
      id: WORKERS_AI_JEV_MODEL_ID,
      name: 'Jev',
      group: 'default',
      providerId: this.provider.id,
      isCustom: false,
      type: ModelType.Judgment,
      contextLength: JEV_CONTEXT_LENGTH,
      description: "TypeSafe's System One decision model, served through Workers AI."
    }
  }

  private async searchModels(): Promise<WorkersAiModelRecord[]> {
    const records = new Map<string, WorkersAiModelRecord>()
    for (let page = 1; page <= MAX_MODEL_SEARCH_PAGES; page += 1) {
      const payload = await this.requestProviderJson<unknown>(
        `${this.resolveApiRoot()}${MODEL_SEARCH_PATH}?per_page=${MODEL_SEARCH_PAGE_SIZE}&page=${page}`,
        { method: 'GET' },
        this.getModelFetchTimeout()
      )
      assertWorkersAiSuccess(payload)

      // Keyed by id: a repeated page must not duplicate models in the persisted catalog.
      const pageRecords = extractWorkersAiModelRecords(payload)
      for (const record of pageRecords) {
        records.set(record.name, record)
      }
      if (pageRecords.length === 0 || page >= resolveTotalPages(payload)) break
    }
    return [...records.values()]
  }

  /**
   * The Workers AI API root, `.../accounts/<ACCOUNT_ID>/ai`, derived from the configured
   * OpenAI-compatible base URL.
   *
   * The account id is a path segment, so an unconfigured or placeholder base URL is refused here
   * rather than falling back to another vendor's host — that fallback would send the token to the
   * wrong vendor and report a confusing error.
   */
  private resolveApiRoot(): string {
    const raw = this.provider.baseUrl?.trim().replace(/\/+$/, '') ?? ''
    // A leftover `<ACCOUNT_ID>` placeholder is not a configuration, and `new URL` percent-encodes the
    // angle brackets, so this check has to happen before parsing.
    if (!raw || raw.includes('<') || raw.includes('>')) {
      throw new Error(WORKERS_AI_BASE_URL_ERROR)
    }

    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new Error(WORKERS_AI_BASE_URL_ERROR)
    }

    // The bearer token must not travel in cleartext, so the transport is HTTPS. HTTP is allowed only
    // for a loopback host, which is what a local proxy or a tunnel on this machine uses.
    const isLoopback = LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
      throw new Error(WORKERS_AI_BASE_URL_ERROR)
    }

    // A query or fragment would be spliced into the request path, and a base URL without `/v1` would
    // break the chat endpoints the inherited transport derives from it.
    const path = url.pathname.replace(/\/+$/, '')
    if (url.search || url.hash || !/\/accounts\/[^/]+\/ai\/v1$/.test(path)) {
      throw new Error(WORKERS_AI_BASE_URL_ERROR)
    }

    return `${url.origin}${path.replace(/\/v1$/, '')}`
  }

  /**
   * The AI SDK transport throws its own private `ProviderHttpError` (the shared `providerFailure`
   * class is a different type), so the status is read structurally rather than by `instanceof`. An
   * error without a status is a configuration or transport failure whose own message is the useful
   * one — an unconfigured base URL, for instance — so it is passed through unchanged.
   */
  private describeCheckFailure(error: unknown): string {
    const message = (error instanceof Error ? error.message : String(error)).trim()
    const status = (error as { status?: unknown } | undefined)?.status
    if (typeof status !== 'number') return message

    const detail = message.slice(0, 200)
    return detail
      ? `Cloudflare model search failed (HTTP ${status}): ${detail}`
      : `Cloudflare model search failed (HTTP ${status})`
  }
}
