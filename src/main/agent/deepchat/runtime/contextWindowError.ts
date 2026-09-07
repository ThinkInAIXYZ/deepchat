const MAX_ERROR_TEXT_DEPTH = 6
const MAX_ERROR_TEXT_FIELD_CHARS = 12_000
const MAX_ERROR_TEXT_TOTAL_CHARS = 48_000
const MAX_ERROR_ARRAY_ITEMS = 16
const MAX_CONTEXT_ERROR_MATCHES = 16

const STRONG_CONTEXT_WINDOW_ERROR_PATTERNS = [
  'context window',
  'context length',
  'maximum context',
  'prompt too long',
  'prompt is too long'
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

const TOKEN_COUNT_CAPTURE = '([0-9](?:[0-9,._ ]{0,17}[0-9])?)(?![0-9,._])'
const ACTUAL_THEN_LIMIT_PATTERN = new RegExp(
  `(?:prompt|input|messages?|request)[^\\d]{0,48}${TOKEN_COUNT_CAPTURE}\\s*tokens?[^.\\n]{0,96}(?:maximum|max|limit)(?:\\s+(?:is|of))?\\s*[:=]?\\s*${TOKEN_COUNT_CAPTURE}`,
  'i'
)
const LIMIT_THEN_ACTUAL_PATTERN = new RegExp(
  `(?:maximum|max)\\s+context\\s+(?:length|window|tokens?)(?:\\s+(?:is|of))?\\s*[:=]?\\s*${TOKEN_COUNT_CAPTURE}\\s*tokens?[\\s\\S]{0,200}?(?:resulted\\s+in|contains?|has|uses?)\\s*${TOKEN_COUNT_CAPTURE}\\s*tokens?`,
  'i'
)
const CONTEXT_COUNT_COMPARISON_PATTERN = new RegExp(
  `(?:prompt|input|messages?|request)[^\\n]{0,96}?${TOKEN_COUNT_CAPTURE}\\s*tokens?\\s*(?:>|exceeds?)\\s*${TOKEN_COUNT_CAPTURE}(?:\\s*tokens?)?(?:\\s*(?:maximum|max|limit))?`,
  'i'
)
const TOTAL_CONTEXT_ARITHMETIC_PATTERN = new RegExp(
  `${TOKEN_COUNT_CAPTURE}\\s*\\+\\s*${TOKEN_COUNT_CAPTURE}\\s*>\\s*${TOKEN_COUNT_CAPTURE}`,
  'i'
)
const INPUT_TOKEN_COUNT_LIMIT_PATTERN = new RegExp(
  `input\\s+token\\s+count\\s*\\(\\s*${TOKEN_COUNT_CAPTURE}\\s*\\)\\s+exceeds?\\s+the\\s+maximum\\s+number\\s+of\\s+tokens\\s+allowed\\s*\\(\\s*${TOKEN_COUNT_CAPTURE}\\s*\\)`,
  'i'
)
const EXPLICIT_CONTEXT_LIMIT_PATTERN = new RegExp(
  `(?:maximum\\s+(?:context\\s+)?(?:length|window|tokens?)|context\\s+limit)(?:\\s+(?:is|of))?\\s*[:=]?\\s*${TOKEN_COUNT_CAPTURE}(?:\\s*tokens?)?`,
  'i'
)

export interface ContextOverflowFacts {
  matched: boolean
  actualTokens?: number
  limitTokens?: number
  limitScope?: 'context' | 'prompt'
  scope?: 'prompt' | 'input' | 'request' | 'messages' | 'unknown'
  confidence: 'none' | 'qualitative' | 'explicit'
}

export function isContextWindowErrorLike(value: unknown): boolean {
  return hasContextWindowErrorText(value, new Set<unknown>(), 0, { totalChars: 0 })
}

function hasValidCeiling(numbers: ReturnType<typeof parseExplicitContextNumbers>): boolean {
  return (
    numbers.limitScope !== undefined &&
    numbers.observedLimitTokens !== undefined &&
    (numbers.actualTokens === undefined || numbers.actualTokens > numbers.observedLimitTokens)
  )
}

export function inspectContextOverflow(value: unknown): ContextOverflowFacts {
  const matches: string[] = []
  const matched = hasContextWindowErrorText(value, new Set<unknown>(), 0, { totalChars: 0 }, matches)
  if (!matched) return { matched: false, confidence: 'none' }

  let explicitMatch:
    | (ReturnType<typeof parseExplicitContextNumbers> & {
        text: string
        scope: ContextOverflowFacts['scope']
      })
    | undefined
  let explicitMatchRank = 0
  for (const text of matches) {
    const numbers = parseExplicitContextNumbers(text)
    if (numbers.actualTokens === undefined && numbers.observedLimitTokens === undefined) continue
    const rank = hasValidCeiling(numbers)
      ? numbers.actualTokens === undefined
        ? 3
        : 4
      : numbers.actualTokens !== undefined && numbers.observedLimitTokens !== undefined
        ? 2
        : 1
    if (rank <= explicitMatchRank) continue
    explicitMatchRank = rank
    explicitMatch = { ...numbers, text, scope: resolveContextScope(text) }
  }
  if (explicitMatch) {
    return {
      matched: true,
      ...(explicitMatch.actualTokens !== undefined
        ? { actualTokens: explicitMatch.actualTokens }
        : {}),
      ...(hasValidCeiling(explicitMatch)
        ? {
            limitTokens: explicitMatch.observedLimitTokens,
            limitScope: explicitMatch.limitScope
          }
        : {}),
      scope: explicitMatch.scope,
      confidence: 'explicit'
    }
  }

  return {
    matched: true,
    scope: resolveContextScope(matches[0] ?? ''),
    confidence: 'qualitative'
  }
}

function isContextWindowErrorText(text: string): boolean {
  const normalized = text.toLowerCase()
  if (NON_CONTEXT_TOKEN_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return false
  }
  if (STRONG_CONTEXT_WINDOW_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true
  }
  const explicit = parseExplicitContextNumbers(text)
  if (
    explicit.actualTokens !== undefined &&
    explicit.observedLimitTokens !== undefined &&
    explicit.actualTokens > explicit.observedLimitTokens &&
    TOKEN_CONTEXT_HINTS.some((hint) => normalized.includes(hint))
  ) {
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
  state: { totalChars: number },
  matches?: string[]
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
    const matched = isContextWindowErrorText(text)
    if (matched && matches && matches.length < MAX_CONTEXT_ERROR_MATCHES) matches.push(text)
    return matched
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false
    }
    seen.add(value)
    let matched = false
    for (const item of value.slice(0, MAX_ERROR_ARRAY_ITEMS)) {
      if (hasContextWindowErrorText(item, seen, depth + 1, state, matches)) {
        matched = true
        if (!matches) return true
      }
    }
    return matched
  }
  if (value instanceof Error) {
    if (seen.has(value)) {
      return false
    }
    seen.add(value)
    let matched = false
    for (const field of [value.message, value.name, value.cause]) {
      if (hasContextWindowErrorText(field, seen, depth + 1, state, matches)) {
        matched = true
        if (!matches) return true
      }
    }
    return (
      hasContextWindowErrorFields(
        value as unknown as Record<string, unknown>,
        seen,
        depth,
        state,
        ['message', 'name', 'cause'],
        matches
      ) || matched
    )
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return false
  }

  seen.add(value)
  return hasContextWindowErrorFields(value as Record<string, unknown>, seen, depth, state, [], matches)
}

function hasContextWindowErrorFields(
  record: Record<string, unknown>,
  seen: Set<unknown>,
  depth: number,
  state: { totalChars: number },
  skipKeys: string[] = [],
  matches?: string[]
): boolean {
  const skipped = new Set(skipKeys)
  let matched = false
  for (const key of CONTEXT_ERROR_TEXT_FIELD_PRIORITY) {
    if (skipped.has(key)) {
      continue
    }
    if (hasContextWindowErrorText(record[key], seen, depth + 1, state, matches)) {
      matched = true
      if (!matches) return true
    }
  }
  return matched
}

function parseTokenCount(value: string | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  const grouped = /^(\d{1,3})([ ,._])\d{3}(?:\2\d{3}){0,5}$/.test(trimmed)
  if (!/^\d+$/.test(trimmed) && !grouped) return undefined
  const normalized = trimmed.replace(/[ ,._]/g, '')
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseExplicitContextNumbers(text: string): {
  actualTokens?: number
  observedLimitTokens?: number
  limitScope?: 'context' | 'prompt'
} {
  const normalized = text.toLowerCase()
  if (
    normalized.includes('input') &&
    normalized.includes('max_tokens') &&
    normalized.includes('context limit')
  ) {
    const arithmetic = TOTAL_CONTEXT_ARITHMETIC_PATTERN.exec(text)
    if (arithmetic) {
      const inputTokens = parseTokenCount(arithmetic[1])
      const outputTokens = parseTokenCount(arithmetic[2])
      const observedLimitTokens = parseTokenCount(arithmetic[3])
      const actualTokens =
        inputTokens !== undefined &&
        outputTokens !== undefined &&
        Number.isSafeInteger(inputTokens + outputTokens)
          ? inputTokens + outputTokens
          : undefined
      if (actualTokens !== undefined && observedLimitTokens !== undefined) {
        return { actualTokens, observedLimitTokens, limitScope: 'context' }
      }
    }
  }

  const inputTokenCountLimit = INPUT_TOKEN_COUNT_LIMIT_PATTERN.exec(text)
  if (inputTokenCountLimit) {
    return {
      actualTokens: parseTokenCount(inputTokenCountLimit[1]),
      observedLimitTokens: parseTokenCount(inputTokenCountLimit[2]),
      limitScope: 'prompt'
    }
  }

  const actualThenLimit = ACTUAL_THEN_LIMIT_PATTERN.exec(text)
  if (actualThenLimit) {
    const scope = resolveContextScope(actualThenLimit[0])
    return {
      actualTokens: parseTokenCount(actualThenLimit[1]),
      observedLimitTokens: parseTokenCount(actualThenLimit[2]),
      ...(scope === 'prompt' ? { limitScope: 'prompt' as const } : {})
    }
  }

  const limitThenActual = LIMIT_THEN_ACTUAL_PATTERN.exec(text)
  if (limitThenActual) {
    return {
      actualTokens: parseTokenCount(limitThenActual[2]),
      observedLimitTokens: parseTokenCount(limitThenActual[1]),
      limitScope: 'context'
    }
  }

  const comparison = CONTEXT_COUNT_COMPARISON_PATTERN.exec(text)
  if (comparison) {
    const scope = resolveContextScope(comparison[0])
    return {
      actualTokens: parseTokenCount(comparison[1]),
      observedLimitTokens: parseTokenCount(comparison[2]),
      ...(scope === 'prompt' ? { limitScope: 'prompt' as const } : {})
    }
  }

  const explicitLimit = EXPLICIT_CONTEXT_LIMIT_PATTERN.exec(text)
  const observedLimitTokens = parseTokenCount(explicitLimit?.[1])
  return observedLimitTokens === undefined
    ? {}
    : { observedLimitTokens, limitScope: 'context' }
}

function resolveContextScope(text: string): ContextOverflowFacts['scope'] {
  const normalized = text.toLowerCase()
  if (
    normalized.includes('input') &&
    normalized.includes('max_tokens') &&
    normalized.includes('context limit')
  ) {
    return 'request'
  }
  if (normalized.includes('prompt')) return 'prompt'
  if (normalized.includes('input')) return 'input'
  if (normalized.includes('message')) return 'messages'
  if (normalized.includes('request')) return 'request'
  return 'unknown'
}
