export function extractJsonContainer(
  raw: string,
  shape: 'array' | 'object' | 'either'
): string | null {
  if (!raw) return null
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenceMatch ? fenceMatch[1] : raw
  const find = (open: '[' | '{', close: ']' | '}'): string | null => {
    const start = body.indexOf(open)
    const end = body.lastIndexOf(close)
    return start >= 0 && end > start ? body.slice(start, end + 1) : null
  }
  if (shape === 'array') return find('[', ']')
  if (shape === 'object') return find('{', '}')
  return find('[', ']') ?? find('{', '}')
}
