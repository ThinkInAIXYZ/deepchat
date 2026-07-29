import type { MCPContentItem } from '@shared/types/core/mcp'

const CUA_ELEMENT_TOKEN_TOOLS = new Set([
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'set_value',
  'scroll'
])

const CUA_REFUSAL_CODE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

export function normalizeCuaToolArguments(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (!CUA_ELEMENT_TOKEN_TOOLS.has(toolName)) {
    return args
  }

  const elementToken = args.element_token
  if (typeof elementToken !== 'string' || elementToken.trim()) {
    return args
  }

  // CUA declares an optional unconstrained string, but its resolver treats any present token as
  // authoritative and rejects "". Keep this compatibility shim local to CUA until the upstream
  // schema rejects empty tokens and provider argument generation stops zero-filling them.
  const normalized = { ...args }
  delete normalized.element_token
  return normalized
}

export function buildCuaWindowStateProjection(
  toolName: string,
  structuredContent: unknown
): string | undefined {
  if (toolName !== 'get_window_state' || !isRecord(structuredContent)) {
    return undefined
  }

  const tokenByIndex = new Map<number, string>()
  if (Array.isArray(structuredContent.elements)) {
    for (const element of structuredContent.elements) {
      if (!isRecord(element)) {
        continue
      }
      const index = element.element_index
      const token = readNonEmptyString(element.element_token)
      if (
        typeof index === 'number' &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        token &&
        !tokenByIndex.has(index)
      ) {
        tokenByIndex.set(index, token)
      }
    }
  }

  const snapshotId = readNonEmptyString(structuredContent.snapshot_id)
  const degraded = structuredContent.degraded === true
  const degradedReason = readNonEmptyString(structuredContent.degraded_reason)
  const escalation = isRecord(structuredContent.escalation)
    ? structuredContent.escalation
    : undefined

  if (!snapshotId && tokenByIndex.size === 0 && !degraded && !degradedReason && !escalation) {
    return undefined
  }

  const lines = [
    '## CUA structured handles',
    'Use only handles from this latest snapshot: prefer a non-empty element_token, or use its same-snapshot element_index as the fallback.'
  ]
  if (snapshotId) {
    lines.push(`snapshot_id=${JSON.stringify(snapshotId)}`)
  }
  if (tokenByIndex.size > 0) {
    lines.push('element_tokens (element_index=element_token):')
    for (const [index, token] of [...tokenByIndex.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`${index}=${JSON.stringify(token)}`)
    }
  }
  if (degraded) {
    lines.push('degraded=true')
  }
  if (degradedReason) {
    lines.push(`degraded_reason=${JSON.stringify(degradedReason)}`)
  }
  if (escalation) {
    lines.push(`escalation=${JSON.stringify(escalation)}`)
  }
  return lines.join('\n')
}

export function buildCuaRefusalProjection(structuredContent: unknown): string | undefined {
  if (!isRecord(structuredContent) || !isRecord(structuredContent.refusal)) {
    return undefined
  }

  const code = structuredContent.refusal.code
  if (typeof code !== 'string' || !CUA_REFUSAL_CODE_PATTERN.test(code)) {
    return undefined
  }

  return `## CUA structured refusal\nrefusal.code=${JSON.stringify(code)}`
}

export function appendCuaStructuredProjection(
  content: string | MCPContentItem[],
  projection: string | undefined
): string | MCPContentItem[] {
  if (!projection) {
    return content
  }
  if (typeof content === 'string') {
    return content ? `${content}\n\n${projection}` : projection
  }
  return [...content, { type: 'text', text: projection }]
}

export function appendCuaResultProjections(
  content: string | MCPContentItem[],
  toolName: string,
  structuredContent: unknown
): string | MCPContentItem[] {
  const withWindowState = appendCuaStructuredProjection(
    content,
    buildCuaWindowStateProjection(toolName, structuredContent)
  )
  return appendCuaStructuredProjection(
    withWindowState,
    buildCuaRefusalProjection(structuredContent)
  )
}
