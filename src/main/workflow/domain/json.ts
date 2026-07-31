import { createHash } from 'node:crypto'
import type { JsonValue } from '@shared/contracts/common'

const DEFAULT_MAX_DEPTH = 32
const DEFAULT_MAX_COLLECTION_ENTRIES = 10_000
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export interface WorkflowJsonLimits {
  maxBytes: number
  maxDepth?: number
  maxCollectionEntries?: number
}

export interface CanonicalWorkflowJson {
  value: JsonValue
  json: string
  byteLength: number
  sha256: string
}

export type WorkflowJsonErrorCode = 'INVALID_VALUE' | 'LIMIT_EXCEEDED'

export class WorkflowJsonError extends Error {
  constructor(
    readonly code: WorkflowJsonErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'WorkflowJsonError'
  }
}

export function canonicalizeWorkflowJson(
  value: unknown,
  limits: WorkflowJsonLimits
): CanonicalWorkflowJson {
  const normalized = normalizeJsonValue(value, {
    maxDepth: limits.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxCollectionEntries: limits.maxCollectionEntries ?? DEFAULT_MAX_COLLECTION_ENTRIES,
    entryBudget: {
      remaining: limits.maxCollectionEntries ?? DEFAULT_MAX_COLLECTION_ENTRIES
    },
    maxBytes: limits.maxBytes,
    seen: new Set(),
    path: '$'
  })
  const json = JSON.stringify(normalized)
  const byteLength = Buffer.byteLength(json, 'utf8')
  if (byteLength > limits.maxBytes) {
    throw new WorkflowJsonError(
      'LIMIT_EXCEEDED',
      `Workflow JSON exceeds the ${limits.maxBytes}-byte limit (${byteLength} bytes).`
    )
  }
  return {
    value: normalized,
    json,
    byteLength,
    sha256: createHash('sha256').update(json).digest('hex')
  }
}

interface NormalizeState {
  maxDepth: number
  maxCollectionEntries: number
  entryBudget: {
    remaining: number
  }
  maxBytes: number
  seen: Set<object>
  path: string
}

function normalizeJsonValue(value: unknown, state: NormalizeState, depth = 0): JsonValue {
  if (depth > state.maxDepth) {
    throw new WorkflowJsonError(
      'LIMIT_EXCEEDED',
      `Workflow JSON exceeds maximum depth at ${state.path}.`
    )
  }
  if (value === null || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > state.maxBytes) {
      throw new WorkflowJsonError(
        'LIMIT_EXCEEDED',
        `Workflow JSON string exceeds the ${state.maxBytes}-byte limit at ${state.path}.`
      )
    }
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new WorkflowJsonError(
        'INVALID_VALUE',
        `Workflow JSON contains a non-finite number at ${state.path}.`
      )
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value !== 'object') {
    throw new WorkflowJsonError(
      'INVALID_VALUE',
      `Workflow JSON contains unsupported ${typeof value} at ${state.path}.`
    )
  }
  if (state.seen.has(value)) {
    throw new WorkflowJsonError('INVALID_VALUE', `Workflow JSON contains a cycle at ${state.path}.`)
  }

  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > state.maxCollectionEntries) {
        throw new WorkflowJsonError(
          'LIMIT_EXCEEDED',
          `Workflow JSON array is too large at ${state.path}.`
        )
      }
      consumeEntries(state, value.length)
      return value.map((item, index) =>
        normalizeJsonValue(
          item,
          {
            ...state,
            path: `${state.path}[${index}]`
          },
          depth + 1
        )
      )
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new WorkflowJsonError(
        'INVALID_VALUE',
        `Workflow JSON must use plain objects at ${state.path}.`
      )
    }

    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length > state.maxCollectionEntries) {
      throw new WorkflowJsonError(
        'LIMIT_EXCEEDED',
        `Workflow JSON object is too large at ${state.path}.`
      )
    }
    consumeEntries(state, keys.length)

    const output: Record<string, JsonValue> = Object.create(null)
    const stringKeys: string[] = []
    for (const key of keys) {
      if (typeof key !== 'string') {
        throw new WorkflowJsonError(
          'INVALID_VALUE',
          `Workflow JSON contains a symbol key at ${state.path}.`
        )
      }
      if (UNSAFE_KEYS.has(key)) {
        throw new WorkflowJsonError(
          'INVALID_VALUE',
          `Workflow JSON contains unsafe key "${key}" at ${state.path}.`
        )
      }
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new WorkflowJsonError(
          'INVALID_VALUE',
          `Workflow JSON contains a non-data property "${key}" at ${state.path}.`
        )
      }
      stringKeys.push(key)
    }

    stringKeys.sort()
    for (const key of stringKeys) {
      output[key] = normalizeJsonValue(
        descriptors[key].value,
        {
          ...state,
          path: `${state.path}.${key}`
        },
        depth + 1
      )
    }
    return output
  } finally {
    state.seen.delete(value)
  }
}

function consumeEntries(state: NormalizeState, count: number): void {
  state.entryBudget.remaining -= count
  if (state.entryBudget.remaining < 0) {
    throw new WorkflowJsonError(
      'LIMIT_EXCEEDED',
      `Workflow JSON exceeds the ${state.maxCollectionEntries}-entry limit at ${state.path}.`
    )
  }
}
