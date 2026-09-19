export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length
}

export function truncateUnicodeCodePoints(value: string, maxCodePoints: number): string {
  const limit = Math.max(0, Math.floor(maxCodePoints))
  // UTF-16 length bounds the code point count, so inputs within the limit skip the array walk.
  if (value.length <= limit) return value
  const codePoints = Array.from(value)
  return codePoints.length <= limit ? value : codePoints.slice(0, limit).join('')
}
