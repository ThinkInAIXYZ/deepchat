import type { SendMessageInput } from '@shared/types/agent-interface'
import type {
  MessageRepository,
  ProviderCatalogPort,
  ProviderExecutionPort,
  SessionPermissionPort,
  SessionRepository
} from '../hotPathPorts'
import type { OperationRunner } from '../operationRunner'
import { requireAvailableSession } from '@/presenter/agentSessionPresenter/sessionResolution'

const CHAT_LOOKUP_TIMEOUT_MS = 5_000

export class ChatService {
  private readonly activeControllers = new Map<string, AbortController>()

  constructor(
    private readonly deps: {
      sessionRepository: SessionRepository
      messageRepository: MessageRepository
      providerExecutionPort: ProviderExecutionPort
      providerCatalogPort: ProviderCatalogPort
      sessionPermissionPort: SessionPermissionPort
      scheduler: OperationRunner
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
      const resolution = await this.deps.scheduler.observeIdempotent({
        task: async () => await this.deps.sessionRepository.resolve(sessionId),
        deadlineMs: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.sendMessage:${sessionId}:session`,
        signal: controller.signal
      })
      const session = requireAvailableSession('chat.sendMessage', resolution)

      const agentType = await this.deps.scheduler.observeIdempotent({
        task: async () => await this.deps.providerCatalogPort.getAgentType(session.agentId),
        deadlineMs: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.sendMessage:${sessionId}:agentType`,
        signal: controller.signal
      })

      if (!agentType) {
        throw new Error(`Agent type not found: ${session.agentId}`)
      }

      const result = await this.deps.providerExecutionPort.sendMessage(sessionId, content)

      return {
        accepted: true,
        requestId: result.requestId,
        messageId: result.messageId
      }
    } finally {
      if (this.activeControllers.get(sessionId) === controller) {
        this.activeControllers.delete(sessionId)
      }
    }
  }

  async steerActiveTurn(
    sessionId: string,
    content: string | SendMessageInput
  ): Promise<{ accepted: true }> {
    const resolution = await this.deps.scheduler.observeIdempotent({
      task: async () => await this.deps.sessionRepository.resolve(sessionId),
      deadlineMs: CHAT_LOOKUP_TIMEOUT_MS,
      reason: `chat.steerActiveTurn:${sessionId}:session`
    })
    requireAvailableSession('chat.steerActiveTurn', resolution)

    await this.deps.providerExecutionPort.steerActiveTurn(sessionId, content)

    return { accepted: true }
  }

  async stopStream(input: {
    sessionId?: string
    requestId?: string
  }): Promise<{ stopped: boolean }> {
    let targetSessionId = input.sessionId ?? null
    const requestId = input.requestId

    if (!targetSessionId && requestId) {
      const message = await this.deps.scheduler.observeIdempotent({
        task: async () => await this.deps.messageRepository.get(requestId),
        deadlineMs: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.stopStream:${requestId}:message`
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

    const cleanupResults = await Promise.allSettled([
      Promise.resolve().then(() =>
        this.deps.sessionPermissionPort.clearSessionPermissions(targetSessionId)
      ),
      Promise.resolve().then(() =>
        this.deps.providerExecutionPort.cancelGeneration(targetSessionId)
      )
    ])
    const clearPermissionsResult = cleanupResults[0]
    if (clearPermissionsResult?.status === 'rejected') {
      console.warn(
        `[ChatService] Failed to clear session permissions during stop for ${targetSessionId}:`,
        clearPermissionsResult.reason
      )
    }

    const cancelGenerationResult = cleanupResults[1]
    if (cancelGenerationResult?.status === 'rejected') {
      console.warn(
        `[ChatService] Failed to cancel generation during stop for ${targetSessionId}:`,
        cancelGenerationResult.reason
      )
    }

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
    handledInline?: boolean
  }> {
    const result = await this.deps.providerExecutionPort.respondToolInteraction(
      input.sessionId,
      input.messageId,
      input.toolCallId,
      input.response
    )

    return {
      accepted: true,
      ...result
    }
  }
}
