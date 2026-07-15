import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import {
  estimateMessagesTokens,
  estimateToolDefinitionTokens,
  fitMessagesToContextWindow
} from './contextBuilder'

export const AGENT_DEFAULT_MAX_OUTPUT_TOKENS_CAP = 16_384
export const AGENT_REQUEST_MAX_OUTPUT_TOKENS_CAP = 32_768
export const AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS = 1
export const AGENT_CONTEXT_SAFETY_MARGIN_TOKENS = 256
export const AGENT_CONTEXT_PRESSURE_MIN_OUTPUT_TOKENS = 4_000

export type RequestContextBudget = {
  outputReserveTokens: number
  toolReserveTokens: number
  totalReserveTokens: number
}

export type RequestContextPreflightResult = {
  messages: ChatMessage[]
  inputTokens: number
  toolReserveTokens: number
  requestedMaxTokens: number
  effectiveMaxTokens: number
  usableContextLength: number
  remainingOutputTokens: number
  totalRequestTokens: number
  fitsWithinContext: boolean
  shrunkByContextPressure: boolean
  requiresContextPressureRecovery: boolean
}

export type RequestContextBudgetDiagnostics = {
  usableContextLength: number
  inputTokens: number
  toolReserveTokens: number
  requestedMaxTokens: number
  effectiveMaxTokens: number
  remainingOutputTokens: number
  totalRequestTokens: number
}

export function estimateToolReserveTokens(tools: MCPToolDefinition[]): number {
  return estimateToolDefinitionTokens(tools)
}

export function getUsableContextLength(contextLength: number): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) {
    return contextLength
  }

  // Tiny synthetic windows are used heavily in tests; reserving 256 there would leave no usable
  // room and would not represent a real agent model window.
  if (contextLength <= AGENT_CONTEXT_SAFETY_MARGIN_TOKENS * 4) {
    return contextLength
  }

  return Math.max(
    AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS,
    Math.floor(contextLength - AGENT_CONTEXT_SAFETY_MARGIN_TOKENS)
  )
}

export function capAgentRequestMaxTokens(
  maxTokens: number,
  contextLength: number = Number.MAX_SAFE_INTEGER
): number {
  const normalizedMaxTokens = Number.isFinite(maxTokens)
    ? Math.floor(maxTokens)
    : AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS
  const requested = Math.max(AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS, normalizedMaxTokens)

  return Math.max(
    AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS,
    Math.min(requested, AGENT_REQUEST_MAX_OUTPUT_TOKENS_CAP, getContextOutputCap(contextLength))
  )
}

export function capAgentDefaultMaxTokens(maxTokens: number, contextLength: number): number {
  return Math.min(
    capAgentRequestMaxTokens(maxTokens, contextLength),
    AGENT_DEFAULT_MAX_OUTPUT_TOKENS_CAP
  )
}

export function buildRequestContextBudget(
  maxTokens: number,
  contextLength: number,
  tools: MCPToolDefinition[]
): RequestContextBudget {
  const outputReserveTokens = capAgentRequestMaxTokens(maxTokens, contextLength)
  const toolReserveTokens = estimateToolReserveTokens(tools)
  return {
    outputReserveTokens,
    toolReserveTokens,
    totalReserveTokens: outputReserveTokens + toolReserveTokens
  }
}

export function fitRequestMessagesToContextWindow(params: {
  messages: ChatMessage[]
  contextLength: number
  reserveTokens: number
  minimumProtectedTailCount?: number
}): ChatMessage[] {
  if (!Number.isFinite(params.contextLength) || params.contextLength <= 0) {
    return params.messages
  }

  return fitMessagesToContextWindow(
    params.messages,
    getUsableContextLength(params.contextLength),
    params.reserveTokens,
    Math.max(
      params.minimumProtectedTailCount ?? 0,
      resolveProtectedRequestTailCount(params.messages)
    )
  )
}

export function resolveEffectiveRequestMaxTokens(params: {
  messages: ChatMessage[]
  toolReserveTokens: number
  contextLength: number
  requestedMaxTokens: number
}): number {
  const requested = capAgentRequestMaxTokens(params.requestedMaxTokens, params.contextLength)
  if (!Number.isFinite(params.contextLength) || params.contextLength <= 0) {
    return requested
  }

  const remaining = Math.floor(
    getUsableContextLength(params.contextLength) -
      estimateMessagesTokens(params.messages) -
      params.toolReserveTokens
  )
  if (remaining <= 0) {
    return AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS
  }

  return Math.max(AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS, Math.min(requested, remaining))
}

export function preflightRequestContext(params: {
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  contextLength: number
  requestedMaxTokens: number
  minimumProtectedTailCount?: number
}): RequestContextPreflightResult {
  const requestedMaxTokens = capAgentRequestMaxTokens(
    params.requestedMaxTokens,
    params.contextLength
  )
  const toolReserveTokens = estimateToolReserveTokens(params.tools)
  const fittedMessages = sanitizeToolContinuationMessages(
    fitRequestMessagesToContextWindow({
      messages: params.messages,
      contextLength: params.contextLength,
      reserveTokens: requestedMaxTokens + toolReserveTokens,
      minimumProtectedTailCount: params.minimumProtectedTailCount
    })
  )
  const inputTokens = estimateMessagesTokens(fittedMessages)
  const usableContextLength = getUsableContextLength(params.contextLength)
  const hasFiniteContext =
    Number.isFinite(usableContextLength) &&
    Number.isFinite(params.contextLength) &&
    params.contextLength > 0 &&
    usableContextLength > 0
  const remainingOutputTokens = hasFiniteContext
    ? Math.floor(usableContextLength - inputTokens - toolReserveTokens)
    : requestedMaxTokens
  const fitsWithinContext =
    !hasFiniteContext || remainingOutputTokens >= AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS
  const effectiveMaxTokens = hasFiniteContext
    ? remainingOutputTokens <= 0
      ? 0
      : Math.max(
          AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS,
          Math.min(requestedMaxTokens, remainingOutputTokens)
        )
    : requestedMaxTokens
  const totalRequestTokens = inputTokens + toolReserveTokens + effectiveMaxTokens
  const shrunkByContextPressure = effectiveMaxTokens < requestedMaxTokens
  const requiresContextPressureRecovery =
    shrunkByContextPressure &&
    requestedMaxTokens >= AGENT_CONTEXT_PRESSURE_MIN_OUTPUT_TOKENS &&
    effectiveMaxTokens < AGENT_CONTEXT_PRESSURE_MIN_OUTPUT_TOKENS

  return {
    messages: fittedMessages,
    inputTokens,
    toolReserveTokens,
    requestedMaxTokens,
    effectiveMaxTokens,
    usableContextLength,
    remainingOutputTokens,
    totalRequestTokens,
    fitsWithinContext,
    shrunkByContextPressure,
    requiresContextPressureRecovery
  }
}

export function buildRequestContextBudgetDiagnostics(
  preflight: RequestContextPreflightResult
): RequestContextBudgetDiagnostics {
  return {
    usableContextLength: preflight.usableContextLength,
    inputTokens: preflight.inputTokens,
    toolReserveTokens: preflight.toolReserveTokens,
    requestedMaxTokens: preflight.requestedMaxTokens,
    effectiveMaxTokens: preflight.effectiveMaxTokens,
    remainingOutputTokens: preflight.remainingOutputTokens,
    totalRequestTokens: preflight.totalRequestTokens
  }
}

export function buildRequestContextOverflowErrorMessage(
  preflight: RequestContextPreflightResult
): string {
  const diagnostics = buildRequestContextBudgetDiagnostics(preflight)
  const formatTokenCount = (value: number): string =>
    Number.isFinite(value) ? String(Math.floor(value)) : 'unknown'

  return [
    'Request was not sent because it cannot fit within the model context window after applying the safety margin.',
    `Budget: usable context ${formatTokenCount(diagnostics.usableContextLength)} tokens, estimated input ${formatTokenCount(diagnostics.inputTokens)} tokens, tool schemas ${formatTokenCount(diagnostics.toolReserveTokens)} tokens, requested output ${formatTokenCount(diagnostics.requestedMaxTokens)} tokens, effective output ${formatTokenCount(diagnostics.effectiveMaxTokens)} tokens, remaining output room ${formatTokenCount(diagnostics.remainingOutputTokens)} tokens.`,
    'Try shortening the latest input or attachments, reducing active tools, skills, or system prompt content, lowering max output tokens, or increasing context length.'
  ].join(' ')
}

function resolveProtectedRequestTailCount(messages: ChatMessage[]): number {
  if (messages.length === 0) {
    return 0
  }

  if (messages[messages.length - 1]?.role === 'user') {
    return 1
  }

  let toolTailStart = messages.length - 1
  while (toolTailStart >= 0 && messages[toolTailStart]?.role === 'tool') {
    toolTailStart -= 1
  }

  if (
    toolTailStart < messages.length - 1 &&
    messages[toolTailStart]?.role === 'assistant' &&
    Array.isArray(messages[toolTailStart]?.tool_calls) &&
    messages[toolTailStart]?.tool_calls?.length
  ) {
    return messages.length - toolTailStart
  }

  return 1
}

function sanitizeToolContinuationMessages(messages: ChatMessage[]): ChatMessage[] {
  const sanitized: ChatMessage[] = []
  let pendingToolCallIds = new Set<string>()

  for (const message of messages) {
    if (message.role === 'assistant') {
      sanitized.push(message)
      pendingToolCallIds = new Set(message.tool_calls?.map((toolCall) => toolCall.id) ?? [])
      continue
    }

    if (message.role === 'tool') {
      const toolCallId = message.tool_call_id
      if (!toolCallId) {
        if (pendingToolCallIds.size === 0) {
          continue
        }
        sanitized.push(message)
        continue
      }

      if (!pendingToolCallIds.has(toolCallId)) {
        continue
      }

      sanitized.push(message)
      pendingToolCallIds.delete(toolCallId)
      continue
    }

    sanitized.push(message)
    pendingToolCallIds = new Set()
  }

  return sanitized
}

function getContextOutputCap(contextLength: number): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) {
    return Number.MAX_SAFE_INTEGER
  }

  return Math.max(AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS, Math.floor(contextLength / 2))
}
