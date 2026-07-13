export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length
}

export function truncateUnicodeCodePoints(value: string, maxCodePoints: number): string {
  const limit = Math.max(0, Math.floor(maxCodePoints))
  const codePoints = Array.from(value)
  return codePoints.length <= limit ? value : codePoints.slice(0, limit).join('')
}
