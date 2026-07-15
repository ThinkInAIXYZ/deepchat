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
    tape: Pick<SessionTapePort, 'mergeSubagentTape' | 'discardSubagentTape'>
  } = {
    transcript: { hasMessages: async () => false },
    tape: {
      mergeSubagentTape: async () => undefined,
      discardSubagentTape: async () => undefined
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
