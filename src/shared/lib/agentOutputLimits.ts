import type { DeepChatAgentConfig } from '@shared/types/agent-interface'

export const AGENT_OUTPUT_LIMIT_MIN_CHARS = 1_000
export const AGENT_OUTPUT_LIMIT_MAX_CHARS = 200_000

export interface AgentOutputLimits {
  readFileAutoTruncateChars: number
  toolOutputInlineChars: number
  commandOutputInlineChars: number
}

export const DEFAULT_AGENT_OUTPUT_LIMITS: Readonly<AgentOutputLimits> = {
  readFileAutoTruncateChars: 4_500,
  toolOutputInlineChars: 5_000,
  commandOutputInlineChars: 12_000
}

const normalizeLimit = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(
    AGENT_OUTPUT_LIMIT_MAX_CHARS,
    Math.max(AGENT_OUTPUT_LIMIT_MIN_CHARS, Math.round(value))
  )
}

export const resolveAgentOutputLimits = (
  config?: DeepChatAgentConfig | null
): AgentOutputLimits => ({
  readFileAutoTruncateChars: normalizeLimit(
    config?.readFileAutoTruncateChars,
    DEFAULT_AGENT_OUTPUT_LIMITS.readFileAutoTruncateChars
  ),
  toolOutputInlineChars: normalizeLimit(
    config?.toolOutputInlineChars,
    DEFAULT_AGENT_OUTPUT_LIMITS.toolOutputInlineChars
  ),
  commandOutputInlineChars: normalizeLimit(
    config?.commandOutputInlineChars,
    DEFAULT_AGENT_OUTPUT_LIMITS.commandOutputInlineChars
  )
})
