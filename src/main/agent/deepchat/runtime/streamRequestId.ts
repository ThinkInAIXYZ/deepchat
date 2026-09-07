import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionScopeRegistry } from '@/agent/deepchat/instance/deepChatAgentRuntime'

export type StreamRequestIdRegistry = SessionScopeRegistry

// Shared by run lifecycle and message projection so neither has to depend on the other.
export function resolveStreamRequestId(
  registry: StreamRequestIdRegistry,
  sessionId: string,
  messageId: string
): string {
  const activeRun = registry
    .getHydratedScope(toAppSessionId(sessionId))
    ?.instance.getActiveGeneration()
  if (!activeRun || activeRun.messageId !== messageId) {
    return messageId
  }
  return activeRun.runId
}
