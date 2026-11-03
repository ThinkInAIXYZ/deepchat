import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import {
  createDeepChatAgentBackend,
  type DeepChatAgentBackendPort
} from '@/agent/manager/deepChatAgentBackend'
import type { SessionTapePort, SessionTranscriptReadPort } from '@/session/data/contracts'

export function createDeepChatAgentBackendFixture(
  port: Omit<DeepChatAgentBackendPort, 'openSessionInstance' | 'getHydratedSessionListState'> &
    Partial<Pick<DeepChatAgentBackendPort, 'openSessionInstance' | 'getHydratedSessionListState'>>,
  providedRuntime?: DeepChatAgentRuntime,
  data: {
    transcript: Pick<SessionTranscriptReadPort, 'hasMessages'>
    tape: Pick<SessionTapePort, 'linkSubagentTape'>
  } = {
    transcript: { hasMessages: async () => false },
    tape: {
      linkSubagentTape: async (input) => ({
        linkEntry: { sessionId: input.parentSessionId, entryId: 1 },
        childSessionId: input.childSessionId,
        childHeadEntryId: 1,
        childEntryCount: 1,
        outcome: input.outcome
      })
    }
  }
) {
  const runtime = providedRuntime ?? new DeepChatAgentRuntime()

  return createDeepChatAgentBackend({
    port: Object.assign(Object.create(port), {
      openSessionInstance:
        port.openSessionInstance ??
        ((sessionId) => {
          const instance = runtime.getOrHydrate(sessionId)
          return () => {
            if (runtime.getHydrated(sessionId) === instance) runtime.evict(sessionId)
          }
        }),
      getHydratedSessionListState:
        port.getHydratedSessionListState ??
        (async (sessionId) =>
          runtime.getHydrated(sessionId) ? await port.getSessionListState(sessionId) : null)
    }),
    ...data
  })
}
