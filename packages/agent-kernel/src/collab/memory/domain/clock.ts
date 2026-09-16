export interface MemoryDomainClock {
  now(): number
  timeZone(): string
}

const MAX_TIME_ZONE_CHARS = 128
const TIME_ZONE_CACHE_LIMIT = 128
const canonicalTimeZoneCache = new Map<string, string | null>()

export function canonicalizeMemoryTimeZone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const timeZone = value.trim()
  if (!timeZone || timeZone.length > MAX_TIME_ZONE_CHARS) return null
  if (canonicalTimeZoneCache.has(timeZone)) {
    return canonicalTimeZoneCache.get(timeZone) ?? null
  }
  let canonical: string | null
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone
  } catch {
    canonical = null
  }
  if (canonicalTimeZoneCache.size >= TIME_ZONE_CACHE_LIMIT) {
    const oldest = canonicalTimeZoneCache.keys().next().value
    if (oldest !== undefined) canonicalTimeZoneCache.delete(oldest)
  }
  canonicalTimeZoneCache.set(timeZone, canonical)
  return canonical
}

function resolveSystemTimeZone(): string {
  try {
    return canonicalizeMemoryTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

export const systemMemoryDomainClock: MemoryDomainClock = {
  now: () => Date.now(),
  timeZone: resolveSystemTimeZone
}
