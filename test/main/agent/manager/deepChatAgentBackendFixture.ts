import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import {
  createDeepChatAgentBackend,
  type DeepChatAgentBackendPort
} from '@/agent/manager/deepChatAgentBackend'
import type { SessionTapePort, SessionTranscriptReadPort } from '@/session/data/contracts'

export function createDeepChatAgentBackendFixture(
  port: DeepChatAgentBackendPort,
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
  const runtime =
    providedRuntime ??
    new DeepChatAgentRuntime((sessionId) => ({
      async send(input) {
        if (input.queue) {
          await port.queuePendingInput(sessionId, input.content, input.queue)
          return { requestId: null, messageId: null }
        }
        return await port.processMessage(sessionId, input.content, input.context)
      },
      cancel: () => port.cancelGeneration(sessionId),
      snapshot: (options) =>
        options?.lightweight
          ? port.getSessionListState(sessionId)
          : port.getSessionState(sessionId),
      close: () => port.destroySession(sessionId)
    }))

  return createDeepChatAgentBackend({ port, runtime, ...data })
}
