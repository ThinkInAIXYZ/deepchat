const DATE_MARKER = '__deepchatDate'

/**
 * The sidecar uses JSON instead of Electron's structured clone. Preserve the
 * Date objects used by typed routes without changing their public schema.
 */
export function stringifyDeepchatJson(value: unknown): string {
  const encoded = JSON.stringify(value, function (key, current) {
    const original = (this as Record<string, unknown>)[key]
    if (original instanceof Date) {
      return { [DATE_MARKER]: 'date', value: original.toJSON() }
    }
    if (
      original &&
      typeof original === 'object' &&
      !Array.isArray(original) &&
      Object.prototype.hasOwnProperty.call(original, DATE_MARKER)
    ) {
      return { [DATE_MARKER]: 'entries', entries: Object.entries(original) }
    }
    return current
  })
  if (encoded === undefined) {
    throw new Error('DeepChat payload is not JSON-serializable')
  }
  return encoded
}

export function reviveDeepchatJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    let revived: unknown[] | undefined
    for (let index = 0; index < value.length; index++) {
      const entry = reviveDeepchatJson(value[index])
      if (entry !== value[index]) {
        revived ??= value.slice()
        revived[index] = entry
      }
    }
    return revived ?? value
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return value
  }
  const record = value as Record<string, unknown>
  const entries = record.entries
  if (
    record[DATE_MARKER] === 'entries' &&
    Object.keys(record).length === 2 &&
    Array.isArray(entries) &&
    entries.every(
      (entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string'
    )
  ) {
    return Object.fromEntries(entries.map(([key, entry]) => [key, reviveDeepchatJson(entry)]))
  }
  if (record[DATE_MARKER] === 'date' && Object.keys(record).length === 2) {
    if (record.value === null) return new Date(Number.NaN)
    if (typeof record.value === 'string' && !Number.isNaN(Date.parse(record.value))) {
      return new Date(record.value)
    }
  }
  let revived: Record<string, unknown> | undefined
  for (const [key, entry] of Object.entries(record)) {
    const next = reviveDeepchatJson(entry)
    if (next !== entry) {
      revived ??= { ...record }
      revived[key] = next
    }
  }
  return revived ?? value
}

export function parseDeepchatJson(raw: string): unknown {
  return reviveDeepchatJson(JSON.parse(raw))
}
