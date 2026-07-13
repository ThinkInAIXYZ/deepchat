import { DeepChatAgentRuntime } from '@/agent/deepchat/instance/deepChatAgentRuntime'
import {
  createDeepChatAgentBackend,
  type DeepChatAgentBackendPort
} from '@/agent/manager/deepChatAgentBackend'

export function createDeepChatAgentBackendFixture(
  port: DeepChatAgentBackendPort,
  providedRuntime?: DeepChatAgentRuntime
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

  return createDeepChatAgentBackend({ port, runtime })
}
