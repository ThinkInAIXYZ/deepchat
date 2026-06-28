const MAX_ERROR_TEXT_DEPTH = 4
const MAX_ERROR_TEXT_FIELD_CHARS = 12_000
const MAX_ERROR_TEXT_TOTAL_CHARS = 48_000
const MAX_ERROR_ARRAY_ITEMS = 16

const STRONG_CONTEXT_WINDOW_ERROR_PATTERNS = [
  'context window',
  'context length',
  'maximum context',
  'prompt too long'
]

const TOKEN_CONTEXT_ERROR_PATTERNS = ['token limit', 'too many tokens', 'reduce the length']
const TOKEN_CONTEXT_HINTS = ['context', 'prompt', 'input', 'request', 'message', 'schema']
const INPUT_EXCEEDS_CONTEXT_HINTS = ['context', 'prompt', 'request', 'message', 'schema', 'token']
const CONTEXT_ERROR_TEXT_FIELD_PRIORITY = [
  'message',
  'error_message',
  'errorMessage',
  'error',
  'errors',
  'detail',
  'details',
  'issues',
  'reason',
  'description',
  'body',
  'response',
  'data',
  'cause'
]

const NON_CONTEXT_TOKEN_ERROR_PATTERNS = [
  'rate limit',
  'rate-limit',
  'tokens per minute',
  'token per minute',
  'insufficient quota',
  'monthly limit',
  'daily limit',
  'billing',
  'quota',
  '429',
  'tpm',
  'rpm'
]

export function isContextWindowErrorLike(value: unknown): boolean {
  return hasContextWindowErrorText(value, new Set<unknown>(), 0, { totalChars: 0 })
}

function isContextWindowErrorText(text: string): boolean {
  const normalized = text.toLowerCase()
  if (NON_CONTEXT_TOKEN_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return false
  }
  if (STRONG_CONTEXT_WINDOW_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true
  }
  return (
    (TOKEN_CONTEXT_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern)) &&
      TOKEN_CONTEXT_HINTS.some((hint) => normalized.includes(hint))) ||
    (normalized.includes('input exceeds') &&
      INPUT_EXCEEDS_CONTEXT_HINTS.some((hint) => normalized.includes(hint)))
  )
}

function hasContextWindowErrorText(
  value: unknown,
  seen: Set<unknown>,
  depth: number,
  state: { totalChars: number }
): boolean {
  if (depth > MAX_ERROR_TEXT_DEPTH || state.totalChars >= MAX_ERROR_TEXT_TOTAL_CHARS) {
    return false
  }
  if (typeof value === 'string') {
    const remainingChars = MAX_ERROR_TEXT_TOTAL_CHARS - state.totalChars
    if (remainingChars <= 0) {
      return false
    }
    const text = value.slice(0, Math.min(MAX_ERROR_TEXT_FIELD_CHARS, remainingChars))
    state.totalChars += text.length
    return isContextWindowErrorText(text)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false
    }
    seen.add(value)
    for (const item of value.slice(0, MAX_ERROR_ARRAY_ITEMS)) {
      if (hasContextWindowErrorText(item, seen, depth, state)) {
        return true
      }
    }
    return false
  }
  if (value instanceof Error) {
    if (seen.has(value)) {
      return false
    }
    seen.add(value)
    return (
      hasContextWindowErrorText(value.message, seen, depth + 1, state) ||
      hasContextWindowErrorText(value.name, seen, depth + 1, state) ||
      hasContextWindowErrorText(value.cause, seen, depth + 1, state) ||
      hasContextWindowErrorFields(value as unknown as Record<string, unknown>, seen, depth, state, [
        'message',
        'name',
        'cause'
      ])
    )
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return false
  }

  seen.add(value)
  return hasContextWindowErrorFields(value as Record<string, unknown>, seen, depth, state)
}

function hasContextWindowErrorFields(
  record: Record<string, unknown>,
  seen: Set<unknown>,
  depth: number,
  state: { totalChars: number },
  skipKeys: string[] = []
): boolean {
  const skipped = new Set(skipKeys)
  for (const key of CONTEXT_ERROR_TEXT_FIELD_PRIORITY) {
    if (skipped.has(key)) {
      continue
    }
    if (hasContextWindowErrorText(record[key], seen, depth + 1, state)) {
      return true
    }
  }
  return false
}
