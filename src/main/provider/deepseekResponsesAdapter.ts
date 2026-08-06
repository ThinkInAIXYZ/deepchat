import { openai } from '@ai-sdk/openai'
import type {
  ChatMessage,
  ChatMessageProviderOptions,
  ChatMessageProviderReplay,
  ChatMessageProviderReplayProjector
} from '@shared/types/core/chat-message'
import type { ProviderSearchPayload } from '@shared/types/core/llm-events'
import type { SearchResult } from '@shared/types/core/search'
import type { LLM_PROVIDER } from '@shared/types/provider'

export const DEEPSEEK_RESPONSES_MODEL_ID = 'deepseek-v4-flash'
export const DEEPSEEK_RESPONSES_BASE_URL = 'https://api.deepseek.com'

const DEEPSEEK_PROVIDER_ID = 'deepseek'
const DEEPSEEK_WEB_SEARCH_TOOL_NAME = 'deepseek_provider_web_search'
const MAX_REPLAY_JSON_BYTES = 1024 * 1024
const MAX_NORMALIZED_SOURCES = 100
const MAX_DISPLAY_TARGET_LENGTH = 2048
const MAX_NORMALIZED_URL_LENGTH = 8192
const MAX_NORMALIZED_TITLE_LENGTH = 512
const MAX_NORMALIZED_SNIPPET_LENGTH = 4096
const CONTINUATION_FIELDS = ['previous_response_id', 'conversation', 'truncation'] as const

type JsonRecord = Record<string, unknown>
type AiSdkFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type DeepSeekWebSearchCall = JsonRecord & {
  type: 'web_search_call'
  id: string
  status: 'completed'
  action: JsonRecord & {
    type: 'search' | 'open_page' | 'find_in_page'
  }
}

type DeepSeekWebSearchReplayEnvelopeV1 = {
  version: 1
  providerId: typeof DEEPSEEK_PROVIDER_ID
  modelId: typeof DEEPSEEK_RESPONSES_MODEL_ID
  item: DeepSeekWebSearchCall
}

export type DeepSeekResponsesRouteInput = {
  providerId: string
  modelId: string
  baseUrl?: string
}

export type DeepSeekResponsesRoute = {
  providerKind: 'openai-responses'
  baseUrl: typeof DEEPSEEK_RESPONSES_BASE_URL
}

export type DeepSeekResponsesRequestRouteInput = DeepSeekResponsesRouteInput & {
  messages: readonly ChatMessage[]
  search: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function serializedByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function isOfficialDeepSeekEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) {
    return false
  }

  try {
    const normalizedInput = baseUrl.trim()
    const authority = normalizedInput.match(/^https:\/\/([^/?#]+)/i)?.[1]
    if (authority?.toLowerCase() !== 'api.deepseek.com') {
      return false
    }

    const url = new URL(normalizedInput)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    return (
      url.protocol === 'https:' &&
      url.hostname === 'api.deepseek.com' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      (pathname === '/' || pathname === '/v1')
    )
  } catch {
    return false
  }
}

export function resolveDeepSeekResponsesRoute(
  input: DeepSeekResponsesRouteInput
): DeepSeekResponsesRoute | null {
  if (
    input.providerId !== DEEPSEEK_PROVIDER_ID ||
    input.modelId !== DEEPSEEK_RESPONSES_MODEL_ID ||
    !isOfficialDeepSeekEndpoint(input.baseUrl)
  ) {
    return null
  }

  return {
    providerKind: 'openai-responses',
    baseUrl: DEEPSEEK_RESPONSES_BASE_URL
  }
}

export function resolveDeepSeekResponsesRequestRoute(
  input: DeepSeekResponsesRequestRouteInput
): DeepSeekResponsesRoute | null {
  const requiresResponses =
    input.search || input.messages.some((message) => message.provider_replay !== undefined)
  return requiresResponses ? resolveDeepSeekResponsesRoute(input) : null
}

function validateWebSearchCall(value: unknown): DeepSeekWebSearchCall {
  if (
    !isRecord(value) ||
    value.type !== 'web_search_call' ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    value.id.length > 512 ||
    value.status !== 'completed' ||
    !isRecord(value.action) ||
    (value.action.type !== 'search' &&
      value.action.type !== 'open_page' &&
      value.action.type !== 'find_in_page')
  ) {
    throw new Error('DeepSeek Web Search replay item is malformed.')
  }

  return value as DeepSeekWebSearchCall
}

function parseEnvelopeJson(value: string): JsonRecord {
  if (serializedByteLength(value) > MAX_REPLAY_JSON_BYTES) {
    throw new Error('DeepSeek Web Search replay envelope exceeds the 1 MiB limit.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('DeepSeek Web Search replay envelope is not valid JSON.')
  }

  if (!isRecord(parsed)) {
    throw new Error('DeepSeek Web Search replay envelope is malformed.')
  }
  return parsed
}

function parseMatchedEnvelope(
  value: string,
  target: DeepSeekResponsesRouteInput
): DeepSeekWebSearchReplayEnvelopeV1 | null {
  const parsed = parseEnvelopeJson(value)
  if (parsed.providerId !== target.providerId || parsed.modelId !== target.modelId) {
    return null
  }
  if (parsed.version !== 1) {
    throw new Error('DeepSeek Web Search replay envelope version is unsupported.')
  }

  return {
    version: 1,
    providerId: DEEPSEEK_PROVIDER_ID,
    modelId: DEEPSEEK_RESPONSES_MODEL_ID,
    item: validateWebSearchCall(parsed.item)
  }
}

export function createDeepSeekResponsesReplayProjector(
  target: DeepSeekResponsesRouteInput
): ChatMessageProviderReplayProjector | undefined {
  if (!resolveDeepSeekResponsesRoute(target)) {
    return undefined
  }

  return (providerReplayJson) => {
    try {
      const envelope = parseMatchedEnvelope(providerReplayJson, target)
      if (!envelope) {
        return null
      }
      return {
        markerId: envelope.item.id,
        payload: providerReplayJson
      }
    } catch (error) {
      console.warn(
        '[DeepSeekResponsesAdapter] Ignoring invalid persisted Web Search replay:',
        error
      )
      return null
    }
  }
}

function stripOpenAIItemId(
  providerOptions: ChatMessageProviderOptions | undefined
): ChatMessageProviderOptions | undefined {
  const openaiOptions = providerOptions?.openai
  if (!isRecord(openaiOptions) || !Object.prototype.hasOwnProperty.call(openaiOptions, 'itemId')) {
    return providerOptions
  }

  const nextOpenAIOptions = { ...openaiOptions }
  delete nextOpenAIOptions.itemId
  const nextOptions = { ...providerOptions }
  if (Object.keys(nextOpenAIOptions).length > 0) {
    nextOptions.openai = nextOpenAIOptions
  } else {
    delete nextOptions.openai
  }
  return Object.keys(nextOptions).length > 0 ? nextOptions : undefined
}

function stripNonSearchOpenAIItemIds(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const providerOptions = stripOpenAIItemId(message.provider_options)
    const reasoningProviderOptions = stripOpenAIItemId(message.reasoning_provider_options)
    return {
      ...message,
      provider_options: providerOptions,
      reasoning_provider_options: reasoningProviderOptions,
      ...(Array.isArray(message.content)
        ? {
            content: message.content.map((part) => ({
              ...part,
              provider_options: stripOpenAIItemId(part.provider_options)
            }))
          }
        : {}),
      ...(message.tool_calls
        ? {
            tool_calls: message.tool_calls.map((toolCall) => ({
              ...toolCall,
              provider_options: stripOpenAIItemId(toolCall.provider_options)
            }))
          }
        : {})
    }
  })
}

function requestUrl(input: string | URL | Request): URL {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    return new URL(value)
  } catch {
    throw new Error('DeepSeek Responses request URL is invalid.')
  }
}

function assertResponsesRequestUrl(input: string | URL | Request): void {
  const url = requestUrl(input)
  if (
    url.origin !== DEEPSEEK_RESPONSES_BASE_URL ||
    Boolean(url.username) ||
    Boolean(url.password) ||
    Boolean(url.port) ||
    url.pathname.replace(/\/+$/, '') !== '/responses' ||
    url.search ||
    url.hash
  ) {
    throw new Error('DeepSeek Responses adapter refused an unexpected endpoint.')
  }
}

function parseRequestBody(body: BodyInit | null | undefined): JsonRecord {
  if (typeof body !== 'string') {
    throw new Error('DeepSeek Responses adapter expected a JSON string request body.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('DeepSeek Responses adapter received invalid request JSON.')
  }
  if (!isRecord(parsed)) {
    throw new Error('DeepSeek Responses adapter expected a JSON object request body.')
  }
  return parsed
}

function isItemReference(value: unknown): value is { type: 'item_reference'; id: string } {
  return isRecord(value) && value.type === 'item_reference' && typeof value.id === 'string'
}

function normalizeHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > MAX_NORMALIZED_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }
  if (url.username || url.password) {
    return null
  }
  if (url.href.length > MAX_NORMALIZED_URL_LENGTH) {
    return null
  }
  return url
}

function normalizeSource(source: unknown, searchId: string, rank: number): SearchResult | null {
  if (!isRecord(source) || source.type !== 'url') {
    return null
  }

  const url = normalizeHttpUrl(source.url)
  if (!url) return null

  const title =
    typeof source.title === 'string' && source.title.trim()
      ? source.title.trim().slice(0, MAX_NORMALIZED_TITLE_LENGTH)
      : url.hostname
  const snippet =
    typeof source.snippet === 'string' && source.snippet.trim()
      ? source.snippet.trim().slice(0, MAX_NORMALIZED_SNIPPET_LENGTH)
      : undefined
  return {
    title,
    url: url.href,
    ...(snippet ? { snippet } : {}),
    rank,
    searchId
  }
}

function normalizeSearchResults(item: DeepSeekWebSearchCall): SearchResult[] {
  const action = isRecord(item.action) ? item.action : null
  const sources = action && Array.isArray(action.sources) ? action.sources : []
  const seen = new Set<string>()
  const results: SearchResult[] = []

  for (const source of sources) {
    if (results.length >= MAX_NORMALIZED_SOURCES) {
      break
    }
    const result = normalizeSource(source, item.id, results.length)
    if (!result || seen.has(result.url)) {
      continue
    }
    seen.add(result.url)
    results.push(result)
  }
  return results
}

function normalizeDisplayTarget(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, MAX_DISPLAY_TARGET_LENGTH)
}

function normalizeSearchQuery(value: unknown): string {
  const query = normalizeDisplayTarget(value)
  return /^ws_call_id\s*=\s*call_[a-z0-9_-]+$/i.test(query) ? '' : query
}

function normalizeSearchQueries(value: unknown): string {
  if (!Array.isArray(value)) return ''

  let target = ''
  for (const entry of value) {
    const query = normalizeSearchQuery(entry)
    if (!query) continue
    target = `${target}${target ? ', ' : ''}${query}`.slice(0, MAX_DISPLAY_TARGET_LENGTH)
    if (target.length >= MAX_DISPLAY_TARGET_LENGTH) break
  }
  return target
}

function resolveSearchAction(item: DeepSeekWebSearchCall): ProviderSearchPayload['action'] {
  const action = item.action

  if (item.action.type === 'search') {
    const target = normalizeSearchQuery(action.query) || normalizeSearchQueries(action.queries)
    return { type: 'search', target }
  }

  const url = normalizeHttpUrl(action.url)?.href
  if (item.action.type === 'open_page') {
    return {
      type: 'open_page',
      target: normalizeDisplayTarget(url),
      ...(url ? { url } : {})
    }
  }

  return {
    type: 'find_in_page',
    target: normalizeDisplayTarget(action.pattern) || normalizeDisplayTarget(url),
    ...(url ? { url } : {})
  }
}

function encodeEnvelope(item: DeepSeekWebSearchCall): string {
  const envelope: DeepSeekWebSearchReplayEnvelopeV1 = {
    version: 1,
    providerId: DEEPSEEK_PROVIDER_ID,
    modelId: DEEPSEEK_RESPONSES_MODEL_ID,
    item
  }
  const serialized = JSON.stringify(envelope)
  if (serializedByteLength(serialized) > MAX_REPLAY_JSON_BYTES) {
    throw new Error('DeepSeek Web Search replay envelope exceeds the 1 MiB limit.')
  }
  return serialized
}

export type DeepSeekResponsesAdapter = {
  prepareMessages(messages: ChatMessage[]): ChatMessage[]
  mapReplay(replay: ChatMessageProviderReplay): unknown
  wrapFetch(baseFetch: AiSdkFetch): AiSdkFetch
  getSearchTools(): Record<string, ReturnType<typeof openai.tools.webSearch>>
  projectRawChunk(rawValue: unknown): ProviderSearchPayload | null
  isSearchToolName(toolName: string): boolean
}

export function createDeepSeekResponsesAdapter(input: {
  providerKind: string
  provider: Pick<LLM_PROVIDER, 'id' | 'baseUrl'>
  modelId: string
}): DeepSeekResponsesAdapter | null {
  const target: DeepSeekResponsesRouteInput = {
    providerId: input.provider.id,
    modelId: input.modelId,
    baseUrl: input.provider.baseUrl
  }
  if (input.providerKind !== 'openai-responses' || !resolveDeepSeekResponsesRoute(target)) {
    return null
  }

  const replayItems = new Map<string, DeepSeekWebSearchCall>()
  const seenRawItems = new Set<string>()

  return {
    prepareMessages: stripNonSearchOpenAIItemIds,
    mapReplay(replay) {
      const envelope = parseMatchedEnvelope(replay.payload, target)
      if (!envelope || replay.markerId !== envelope.item.id) {
        throw new Error('DeepSeek Web Search replay marker does not match its envelope.')
      }
      if (replayItems.has(replay.markerId)) {
        throw new Error(`Duplicate DeepSeek Web Search replay marker: ${replay.markerId}`)
      }
      replayItems.set(replay.markerId, envelope.item)
      return {
        type: 'tool-call',
        toolCallId: replay.markerId,
        toolName: DEEPSEEK_WEB_SEARCH_TOOL_NAME,
        input: {},
        providerExecuted: true,
        providerOptions: {
          openai: {
            itemId: replay.markerId
          }
        }
      }
    },
    wrapFetch(baseFetch) {
      return async (requestInput, requestInit) => {
        assertResponsesRequestUrl(requestInput)
        const body = parseRequestBody(requestInit?.body)
        const usedReplayIds = new Set<string>()

        if (Array.isArray(body.input)) {
          body.input = body.input.map((item) => {
            if (!isItemReference(item)) {
              return item
            }
            const replayItem = replayItems.get(item.id)
            if (!replayItem) {
              throw new Error(`Unmatched DeepSeek Responses item_reference: ${item.id}`)
            }
            if (usedReplayIds.has(item.id)) {
              throw new Error(`Duplicate DeepSeek Responses item_reference: ${item.id}`)
            }
            usedReplayIds.add(item.id)
            return replayItem
          })
        } else if (replayItems.size > 0) {
          throw new Error('DeepSeek Responses replay markers require an array input body.')
        }

        for (const replayId of replayItems.keys()) {
          if (!usedReplayIds.has(replayId)) {
            throw new Error(`DeepSeek Responses replay marker was not emitted: ${replayId}`)
          }
        }
        if (Array.isArray(body.input) && body.input.some(isItemReference)) {
          throw new Error('DeepSeek Responses request still contains an item_reference.')
        }

        body.store = false
        for (const field of CONTINUATION_FIELDS) {
          delete body[field]
        }

        return await baseFetch(requestInput, {
          ...requestInit,
          body: JSON.stringify(body)
        })
      }
    },
    getSearchTools: () => ({
      [DEEPSEEK_WEB_SEARCH_TOOL_NAME]: openai.tools.webSearch()
    }),
    projectRawChunk(rawValue) {
      if (!isRecord(rawValue) || rawValue.type !== 'response.output_item.done') {
        return null
      }
      if (!isRecord(rawValue.item) || rawValue.item.type !== 'web_search_call') {
        return null
      }
      const item = validateWebSearchCall(rawValue.item)
      if (seenRawItems.has(item.id)) {
        throw new Error(`Duplicate DeepSeek Web Search output item: ${item.id}`)
      }
      const providerReplayJson = encodeEnvelope(item)
      seenRawItems.add(item.id)
      const action = resolveSearchAction(item)
      return {
        id: item.id,
        action,
        label: action.target || 'Web Search',
        provider: DEEPSEEK_PROVIDER_ID,
        results: normalizeSearchResults(item),
        providerReplayJson
      }
    },
    isSearchToolName: (toolName) => toolName === DEEPSEEK_WEB_SEARCH_TOOL_NAME
  }
}
