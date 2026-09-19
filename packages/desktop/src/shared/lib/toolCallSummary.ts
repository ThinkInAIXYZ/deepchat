const normalizeInlineText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

type ToolCallSummaryContext = {
  toolName?: string | null
}

const matchesToolContractName = (
  toolName: string | undefined | null,
  expectedName: string
): boolean => {
  const normalized = toolName?.trim().toLowerCase() ?? ''
  return (
    normalized === expectedName ||
    normalized.endsWith(`_${expectedName}`) ||
    normalized.endsWith(`-${expectedName}`) ||
    normalized.startsWith(`${expectedName}_`) ||
    normalized.startsWith(`${expectedName}-`)
  )
}

const extractStringField = (value: Record<string, unknown>, field: string): string | undefined => {
  const fieldValue = value[field]
  return typeof fieldValue === 'string' && fieldValue.trim().length > 0 ? fieldValue : undefined
}

const extractToolSpecificSummaryValue = (
  value: unknown,
  context?: ToolCallSummaryContext
): unknown => {
  if (!isRecord(value)) {
    return undefined
  }

  if (matchesToolContractName(context?.toolName, 'exec')) {
    return extractStringField(value, 'command')
  }

  if (
    matchesToolContractName(context?.toolName, 'read') ||
    matchesToolContractName(context?.toolName, 'write')
  ) {
    return extractStringField(value, 'path')
  }

  return undefined
}

const extractFirstSummaryValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.length > 0 ? value[0] : ''
  }

  if (isRecord(value)) {
    if (typeof value.command === 'string' && value.command.trim().length > 0) {
      return value.command
    }

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

export const summarizeToolCallPreview = (
  value: string | undefined | null,
  context?: ToolCallSummaryContext
): string => {
  const raw = value?.trim() ?? ''
  if (!raw) {
    return ''
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return formatSummaryValue(
      extractToolSpecificSummaryValue(parsed, context) ?? extractFirstSummaryValue(parsed)
    )
  } catch {
    return normalizeInlineText(raw)
  }
}
