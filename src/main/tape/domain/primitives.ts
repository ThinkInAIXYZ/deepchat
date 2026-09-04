/** Lower-case SHA-256 hex digest; the shape every stored Tape hash is validated against. */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

/**
 * RFC 9562 UUID (versions 1-8) in canonical lower-case form; the shape every UUID identity is
 * stored in. Validate stored values against it directly; normalise input with `canonicalUuid`.
 */
export const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The canonical form of a UUID given in any letter case, or null when it is not a UUID. */
export function canonicalUuid(value: string): string | null {
  const lower = value.toLowerCase()
  return CANONICAL_UUID_PATTERN.test(lower) ? lower : null
}

/** Tape size limits are byte limits on the UTF-8 encoding, not JavaScript string lengths. */
export function utf8Length(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/**
 * Orders strings by UTF-16 code unit, which is what `<` does. Canonical key and target orderings
 * inside persisted facts are defined on this comparison; a locale or code-point compare would
 * reorder existing hashes.
 */
export function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Freezes a plain-data tree in place and returns it; already-frozen subtrees are not revisited. */
export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}
