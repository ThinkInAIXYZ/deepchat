import type { ChatMessageProviderReplayProjector } from '@shared/types/core/chat-message'

export const DEEPSEEK_RESPONSES_MODEL_ID = 'deepseek-v4-flash'

export const DEEPSEEK_RESPONSES_BASE_URL = 'https://api.deepseek.com'

const DEEPSEEK_PROVIDER_ID = 'deepseek'

const MAX_REPLAY_JSON_BYTES = 1024 * 1024

type JsonRecord = Record<string, unknown>

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

type DeepSeekResponsesRouteInput = {
  providerId: string
  modelId: string
  baseUrl?: string
}

export type DeepSeekResponsesRoute = {
  providerKind: 'deepseek-open-responses'
  baseUrl: typeof DEEPSEEK_RESPONSES_BASE_URL
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
    providerKind: 'deepseek-open-responses',
    baseUrl: DEEPSEEK_RESPONSES_BASE_URL
  }
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
