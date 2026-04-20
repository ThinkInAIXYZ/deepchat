import type { SendMessageInput } from '@shared/types/agent-interface'
import type {
  MessageRepository,
  ProviderCatalogPort,
  ProviderExecutionPort,
  SessionPermissionPort,
  SessionRepository
} from '../hotPathPorts'
import type { Scheduler } from '../scheduler'

const CHAT_LOOKUP_TIMEOUT_MS = 5_000
const CHAT_SEND_TIMEOUT_MS = 30 * 60 * 1_000
const CHAT_STOP_TIMEOUT_MS = 5_000
const CHAT_INTERACTION_TIMEOUT_MS = CHAT_SEND_TIMEOUT_MS

export class ChatService {
  private readonly activeControllers = new Map<string, AbortController>()

  constructor(
    private readonly deps: {
      sessionRepository: SessionRepository
      messageRepository: MessageRepository
      providerExecutionPort: ProviderExecutionPort
      providerCatalogPort: ProviderCatalogPort
      sessionPermissionPort: SessionPermissionPort
      scheduler: Scheduler
    }
  ) {}

  async sendMessage(
    sessionId: string,
    content: string | SendMessageInput
  ): Promise<{
    accepted: true
    requestId: string | null
    messageId: string | null
  }> {
    if (this.activeControllers.has(sessionId)) {
      throw new Error(`A stream is already active for session ${sessionId}`)
    }

    const controller = new AbortController()
    this.activeControllers.set(sessionId, controller)

    try {
      const session = await this.deps.scheduler.timeout({
        task: this.deps.sessionRepository.get(sessionId),
        ms: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.sendMessage:${sessionId}:session`
      })

      if (!session) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      const agentType = await this.deps.scheduler.timeout({
        task: this.deps.providerCatalogPort.getAgentType(session.agentId),
        ms: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.sendMessage:${sessionId}:agentType`
      })

      if (!agentType) {
        throw new Error(`Agent type not found: ${session.agentId}`)
      }

      await this.deps.scheduler.timeout({
        task: this.deps.providerExecutionPort.sendMessage(sessionId, content),
        ms: CHAT_SEND_TIMEOUT_MS,
        reason: `chat.sendMessage:${sessionId}`,
        signal: controller.signal
      })

      const messages = await this.deps.scheduler.timeout({
        task: this.deps.messageRepository.listBySession(sessionId),
        ms: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.sendMessage:${sessionId}:messages`
      })
      const latestAssistantMessage =
        [...messages]
          .filter((message) => message.role === 'assistant')
          .sort((left, right) => right.orderSeq - left.orderSeq)[0] ?? null

      return {
        accepted: true,
        requestId: latestAssistantMessage?.id ?? null,
        messageId: latestAssistantMessage?.id ?? null
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        const cleanupResults = await Promise.allSettled([
          Promise.resolve(this.deps.sessionPermissionPort.clearSessionPermissions(sessionId)),
          this.deps.providerExecutionPort.cancelGeneration(sessionId)
        ])
        const clearPermissionsResult = cleanupResults[0]
        if (clearPermissionsResult?.status === 'rejected') {
          console.warn(
            `[ChatService] Failed to clear session permissions after send timeout for ${sessionId}:`,
            clearPermissionsResult.reason
          )
        }
        const cancelGenerationResult = cleanupResults[1]
        if (cancelGenerationResult?.status === 'rejected') {
          console.warn(
            `[ChatService] Failed to cancel generation after send timeout for ${sessionId}:`,
            cancelGenerationResult.reason
          )
        }
      }
      throw error
    } finally {
      if (this.activeControllers.get(sessionId) === controller) {
        this.activeControllers.delete(sessionId)
      }
    }
  }

  async stopStream(input: {
    sessionId?: string
    requestId?: string
  }): Promise<{ stopped: boolean }> {
    let targetSessionId = input.sessionId ?? null

    if (!targetSessionId && input.requestId) {
      const message = await this.deps.scheduler.timeout({
        task: this.deps.messageRepository.get(input.requestId),
        ms: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.stopStream:${input.requestId}:message`
      })
      targetSessionId = message?.sessionId ?? null
    }

    if (!targetSessionId) {
      return { stopped: false }
    }

    const controller = this.activeControllers.get(targetSessionId)
    if (controller) {
      controller.abort()
      this.activeControllers.delete(targetSessionId)
    }

    await this.deps.scheduler.timeout({
      task: Promise.resolve(
        this.deps.sessionPermissionPort.clearSessionPermissions(targetSessionId)
      ).then(async () => await this.deps.providerExecutionPort.cancelGeneration(targetSessionId)),
      ms: CHAT_STOP_TIMEOUT_MS,
      reason: `chat.stopStream:${targetSessionId}`
    })

    return { stopped: true }
  }

  async respondToolInteraction(input: {
    sessionId: string
    messageId: string
    toolCallId: string
    response: Parameters<ProviderExecutionPort['respondToolInteraction']>[3]
  }): Promise<{
    accepted: true
    resumed?: boolean
    waitingForUserMessage?: boolean
  }> {
    const result = await this.deps.scheduler.timeout({
      task: this.deps.providerExecutionPort.respondToolInteraction(
        input.sessionId,
        input.messageId,
        input.toolCallId,
        input.response
      ),
      ms: CHAT_INTERACTION_TIMEOUT_MS,
      reason: `chat.respondToolInteraction:${input.sessionId}:${input.toolCallId}`
    })

    return {
      accepted: true,
      ...result
    }
  }
}
