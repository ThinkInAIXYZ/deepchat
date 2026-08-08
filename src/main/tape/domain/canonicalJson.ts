import { createHash } from 'crypto'

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableJson(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      const nested = record[key]
      if (nested !== undefined) {
        result[key] = normalizeForStableJson(nested)
      }
      return result
    }, {})
}

function normalizeJsonData(value: unknown, ancestors: Set<object>): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }

  if (!value || typeof value !== 'object') {
    throw new TypeError('Value contains a non-JSON type.')
  }
  if (ancestors.has(value)) {
    throw new TypeError('Value contains a circular reference.')
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError('Value contains a symbol property.')
      }
      const keys = Object.getOwnPropertyNames(value).filter((key) => key !== 'length')
      if (keys.length !== value.length) {
        throw new TypeError('Value contains a sparse array or non-index property.')
      }
      const normalized: unknown[] = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          throw new TypeError('Value contains a non-data array item.')
        }
        normalized.push(normalizeJsonData(descriptor.value, ancestors))
      }
      return normalized
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Value contains a non-plain object.')
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Value contains a symbol property.')
    }
    const normalized = Object.create(null) as Record<string, unknown>
    for (const key of Object.getOwnPropertyNames(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError('Value contains a non-data property.')
      }
      normalized[key] = normalizeJsonData(descriptor.value, ancestors)
    }
    return normalized
  } finally {
    ancestors.delete(value)
  }
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value))
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex')
}

// ViewManifest hashes keep the legacy object accumulator; journal identities need a
// null-prototype accumulator so JSON keys such as "__proto__" remain identity-bearing.
export function canonicalJsonStringifyData(value: unknown): string {
  return JSON.stringify(normalizeJsonData(value, new Set()))
}

export function hashJsonData(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringifyData(value)).digest('hex')
}
