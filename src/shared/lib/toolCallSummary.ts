const normalizeInlineText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const extractFirstSummaryValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : ''
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
    return entries.length > 0 ? entries[0][1] : ''
  }

  return value
}

const formatSummaryValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return normalizeInlineText(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return ''
  }

  try {
    return normalizeInlineText(JSON.stringify(value))
  } catch {
    return normalizeInlineText(String(value))
  }
}

export const summarizeToolCallPreview = (value: string | undefined | null): string => {
  const raw = value?.trim() ?? ''
  if (!raw) {
    return ''
  }

  try {
    return formatSummaryValue(extractFirstSummaryValue(JSON.parse(raw) as unknown))
  } catch {
    return normalizeInlineText(raw)
  }
}
