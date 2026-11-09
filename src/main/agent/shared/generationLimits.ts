export const AGENT_REQUEST_MAX_OUTPUT_TOKENS_CAP = 131_072
export const AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS = 1
export const AGENT_CONTEXT_SAFETY_MARGIN_TOKENS = 256

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

function getContextOutputCap(contextLength: number): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) {
    return Number.MAX_SAFE_INTEGER
  }

  return Math.max(AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS, Math.floor(contextLength / 2))
}
