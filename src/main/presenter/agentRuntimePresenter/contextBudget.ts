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

export type RequestContextBudget = {
  outputReserveTokens: number
  toolReserveTokens: number
  totalReserveTokens: number
}

export function estimateToolReserveTokens(tools: MCPToolDefinition[]): number {
  return estimateToolDefinitionTokens(tools)
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
    params.contextLength,
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
    params.contextLength - estimateMessagesTokens(params.messages) - params.toolReserveTokens
  )
  if (remaining <= 0) {
    return AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS
  }

  return Math.max(AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS, Math.min(requested, remaining))
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

function getContextOutputCap(contextLength: number): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) {
    return Number.MAX_SAFE_INTEGER
  }

  return Math.max(AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS, Math.floor(contextLength / 2))
}
