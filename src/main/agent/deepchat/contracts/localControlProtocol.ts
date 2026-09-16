import type { JsonValue } from '@shared/contracts/common'
import type { LocalControlErrorCode } from '@shared/contracts/localControl'

const DEFAULT_MAX_JSON_DEPTH = 64
const DEFAULT_MAX_JSON_KEYS = 10_000
const DEFAULT_MAX_JSON_NODES = 50_000
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export class CliRequestError extends Error {
  constructor(
    readonly code: LocalControlErrorCode,
    message: string,
    readonly options: {
      httpStatus?: number
      retriable?: boolean
      details?: Record<string, JsonValue>
    } = {}
  ) {
    super(message)
    this.name = 'CliRequestError'
  }

  get httpStatus(): number {
    return this.options.httpStatus ?? 400
  }

  get retriable(): boolean {
    return this.options.retriable ?? false
  }
}

function assertBoundedJsonShape(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let keys = 0
  let nodes = 0

  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > DEFAULT_MAX_JSON_NODES) {
      throw new CliRequestError('invalid_request', 'JSON body has too many values')
    }
    if (current.depth > DEFAULT_MAX_JSON_DEPTH) {
      throw new CliRequestError('invalid_request', 'JSON body is nested too deeply')
    }
    if (Array.isArray(current.value)) {
      for (const entry of current.value) {
        pending.push({ value: entry, depth: current.depth + 1 })
      }
      continue
    }
    if (!current.value || typeof current.value !== 'object') continue

    for (const [key, entry] of Object.entries(current.value)) {
      keys += 1
      if (keys > DEFAULT_MAX_JSON_KEYS) {
        throw new CliRequestError('invalid_request', 'JSON body has too many keys')
      }
      if (UNSAFE_JSON_KEYS.has(key)) {
        throw new CliRequestError('invalid_request', `JSON key is not allowed: ${key}`)
      }
      pending.push({ value: entry, depth: current.depth + 1 })
    }
  }
}

/**
 * Decodes and parses a bounded JSON payload, rejecting unsafe keys and oversized shapes. Pure;
 * lives in kernel contracts so the programmatic invocation parser can validate model-supplied
 * stdin without importing the CLI host body module.
 */
export function parseBoundedJsonBytes(bytes: Uint8Array): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CliRequestError('invalid_request', 'Request body is not valid UTF-8')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new CliRequestError('invalid_request', 'Request body is not valid JSON')
  }
  assertBoundedJsonShape(parsed)
  return parsed
}
