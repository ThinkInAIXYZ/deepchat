export type AgentToolResult = {
  ok: boolean
  summary: string
  data?: unknown
  meta?: {
    truncated?: boolean
    nextOffset?: number
    offloadPath?: string
    tokenEstimate?: number
    resultCount?: number
  }
  error?: {
    code: string
    message: string
    recoverable?: boolean
  }
}

const DEFAULT_SUMMARY_LIMIT = 240

export const summarizeAgentToolContent = (
  toolName: string,
  content: unknown,
  limit = DEFAULT_SUMMARY_LIMIT
): string => {
  const text =
    typeof content === 'string'
      ? content
      : content === undefined || content === null
        ? ''
        : JSON.stringify(content)
  const normalized = text.replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return `${toolName} completed without textual output.`
  }

  if (normalized.length <= limit) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`
}

export const createAgentToolSuccessResult = (
  toolName: string,
  content: unknown,
  options: {
    summary?: string
    data?: unknown
    meta?: AgentToolResult['meta']
  } = {}
): AgentToolResult => ({
  ok: true,
  summary: options.summary ?? summarizeAgentToolContent(toolName, content),
  data: options.data ?? { content },
  ...(options.meta ? { meta: options.meta } : {})
})

export const createAgentToolErrorResult = (
  toolName: string,
  message: string,
  options: {
    code?: string
    recoverable?: boolean
    data?: unknown
    meta?: AgentToolResult['meta']
  } = {}
): AgentToolResult => ({
  ok: false,
  summary: summarizeAgentToolContent(toolName, message),
  ...(options.data ? { data: options.data } : {}),
  ...(options.meta ? { meta: options.meta } : {}),
  error: {
    code: options.code ?? 'TOOL_ERROR',
    message,
    recoverable: options.recoverable
  }
})
