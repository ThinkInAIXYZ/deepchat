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

export interface CanonicalJsonDataOptions {
  omitUndefinedProperties?: boolean
}

function normalizeJsonData(
  value: unknown,
  ancestors: Set<object>,
  options: CanonicalJsonDataOptions
): unknown {
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
        normalized.push(normalizeJsonData(descriptor.value, ancestors, options))
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
      if (descriptor.value === undefined && options.omitUndefinedProperties) {
        continue
      }
      normalized[key] = normalizeJsonData(descriptor.value, ancestors, options)
    }
    return normalized
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Legacy canonicalizer: plain-object accumulator (an own `__proto__` key is dropped), `undefined`
 * properties are omitted, non-finite numbers serialize as `null`, and non-plain objects are
 * expanded by their enumerable keys.
 *
 * It is an on-disk contract, not a read-only compatibility path. It still produces persisted
 * identities that are UNIQUE provenance keys or inputs to stored hashes: schema-4 ViewManifest
 * `manifestHash` / `promptHash` / `toolDefinitionsHash` (the default interactive-chat manifest),
 * tool fact provenance keys, and Execution Journal v1 operation keys, run keys, `responseHash`
 * and `errorHash`. Those producers depend on this exact coercion (tool fact payloads carry
 * `undefined` optional fields that `hashJsonData` rejects). Any digest drift makes an old Session
 * append duplicate tool facts on backfill, fail stored-manifest verification, and classify its
 * Journal history as corruption because fact parsing rebuilds each provenance key and compares
 * it with the stored one. New fact families must use `hashJsonData`; existing producers stay on
 * this function.
 */
export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value))
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex')
}

/**
 * Strict canonicalizer for ViewManifest hash version 3 and later, contract hashes, tool surface
 * facts, Execution Journal `argumentsHash` and v2 nested operation keys, and skill
 * materialization payloads. It rejects non-JSON values instead of coercing them and keeps
 * `__proto__` identity-bearing through a null-prototype accumulator. Provider payloads that may
 * carry `undefined` opt in to `omitUndefinedProperties`.
 */
export function canonicalJsonStringifyData(
  value: unknown,
  options: CanonicalJsonDataOptions = {}
): string {
  return JSON.stringify(normalizeJsonData(value, new Set(), options))
}

export function hashJsonData(value: unknown, options: CanonicalJsonDataOptions = {}): string {
  return createHash('sha256').update(canonicalJsonStringifyData(value, options)).digest('hex')
}
