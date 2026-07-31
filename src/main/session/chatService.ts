import type {
  ChatMessageRecord,
  MessageStartResult,
  SendMessageInput,
  SessionWithState,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { SessionPermissionPort } from '@/session/contracts'
import type { Scheduler } from '@/routes/scheduler'

const CHAT_LOOKUP_TIMEOUT_MS = 5_000
const CHAT_SEND_TIMEOUT_MS = 30 * 60 * 1_000
const CHAT_STOP_TIMEOUT_MS = 5_000
const CHAT_INTERACTION_TIMEOUT_MS = CHAT_SEND_TIMEOUT_MS

function relayAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => {}
  const abortTarget = () => target.abort()
  if (source.aborted) {
    abortTarget()
    return () => {}
  }
  source.addEventListener('abort', abortTarget, { once: true })
  return () => source.removeEventListener('abort', abortTarget)
}

export interface ChatServiceTurnPort {
  sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<MessageStartResult>
  steerActiveTurn(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<MessageStartResult>
  cancelGeneration(sessionId: string): Promise<void>
  respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult>
}

export interface ChatRespondToolInteractionInput {
  sessionId: string
  messageId: string
  toolCallId: string
  response: ToolInteractionResponse
}

export interface ChatServiceProjectionPort {
  getSession(sessionId: string): Promise<SessionWithState | null>
  getMessage(messageId: string): Promise<ChatMessageRecord | null>
}

/**
 * Route-layer chat operations. Generation concurrency is owned by the agent runtime
 * (queue / pending / active generation), not by this service's AbortController map.
 * Controllers here only support route-level abort for the in-flight accept path.
 */
export class ChatService {
  private readonly acceptControllers = new Map<string, Set<AbortController>>()

  constructor(
    private readonly deps: {
      turn: ChatServiceTurnPort
      projection: ChatServiceProjectionPort
      sessionPermissionPort: Pick<SessionPermissionPort, 'clearSessionPermissions'>
      scheduler: Scheduler
    }
  ) {}

  async sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<{
    accepted: boolean
    requestId: string | null
    messageId: string | null
    attachmentPreparation?: MessageStartResult['attachmentPreparation']
  }> {
    const controller = new AbortController()
    const removeParentAbortListener = relayAbort(options?.signal, controller)
    const controllers = this.acceptControllers.get(sessionId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.acceptControllers.set(sessionId, controllers)

    try {
      const session = await this.deps.scheduler.timeout({
        task: this.deps.projection.getSession(sessionId),
        ms: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.sendMessage:${sessionId}:session`,
        signal: controller.signal
      })

      if (!session) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      const result = await this.deps.scheduler.timeout({
        task: this.deps.turn.sendMessage(sessionId, content, { signal: controller.signal }),
        ms: CHAT_SEND_TIMEOUT_MS,
        reason: `chat.sendMessage:${sessionId}`,
        signal: controller.signal
      })

      return {
        accepted: result.attachmentPreparation?.status !== 'needs_user_action',
        requestId: result.requestId,
        messageId: result.messageId,
        ...(result.attachmentPreparation
          ? { attachmentPreparation: result.attachmentPreparation }
          : {})
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        controller.abort()
        await this.bestEffortCancel(sessionId, 'send timeout')
      }
      throw error
    } finally {
      removeParentAbortListener()
      const activeControllers = this.acceptControllers.get(sessionId)
      activeControllers?.delete(controller)
      if (activeControllers?.size === 0) {
        this.acceptControllers.delete(sessionId)
      }
    }
  }

  async steerActiveTurn(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<
    | {
        accepted: true
        message: ChatMessageRecord
        attachmentPreparation?: MessageStartResult['attachmentPreparation']
      }
    | {
        accepted: false
        message: null
        attachmentPreparation?: MessageStartResult['attachmentPreparation']
      }
  > {
    const controller = new AbortController()
    const removeParentAbortListener = relayAbort(options?.signal, controller)
    const controllers = this.acceptControllers.get(sessionId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.acceptControllers.set(sessionId, controllers)

    try {
      const session = await this.deps.scheduler.timeout({
        task: this.deps.projection.getSession(sessionId),
        ms: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.steerActiveTurn:${sessionId}:session`,
        signal: controller.signal
      })

      if (!session) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      const result = await this.deps.scheduler.timeout({
        task: this.deps.turn.steerActiveTurn(sessionId, content, { signal: controller.signal }),
        ms: CHAT_SEND_TIMEOUT_MS,
        reason: `chat.steerActiveTurn:${sessionId}`,
        signal: controller.signal
      })

      if (result.attachmentPreparation?.status === 'needs_user_action') {
        return {
          accepted: false,
          message: null,
          attachmentPreparation: result.attachmentPreparation
        }
      }

      if (!result.userMessage) {
        throw new Error(`Steer accepted without a persisted user message: ${sessionId}`)
      }

      return {
        accepted: true,
        message: result.userMessage,
        ...(result.attachmentPreparation
          ? { attachmentPreparation: result.attachmentPreparation }
          : {})
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        controller.abort()
        await this.bestEffortCancel(sessionId, 'steer timeout')
      }
      throw error
    } finally {
      removeParentAbortListener()
      const activeControllers = this.acceptControllers.get(sessionId)
      activeControllers?.delete(controller)
      if (activeControllers?.size === 0) {
        this.acceptControllers.delete(sessionId)
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
        task: this.deps.projection.getMessage(input.requestId),
        ms: CHAT_LOOKUP_TIMEOUT_MS,
        reason: `chat.stopStream:${input.requestId}:message`
      })
      targetSessionId = message?.sessionId ?? null
    }

    if (!targetSessionId) {
      return { stopped: false }
    }

    const controllers = this.acceptControllers.get(targetSessionId)
    if (controllers) {
      for (const controller of controllers) {
        controller.abort()
      }
      this.acceptControllers.delete(targetSessionId)
    }

    let cancelFailed = false
    try {
      await this.deps.scheduler.timeout({
        task: Promise.allSettled([
          Promise.resolve().then(() =>
            this.deps.sessionPermissionPort.clearSessionPermissions(targetSessionId)
          ),
          Promise.resolve().then(() => this.deps.turn.cancelGeneration(targetSessionId))
        ]).then((results) => {
          const clearPermissionsResult = results[0]
          if (clearPermissionsResult?.status === 'rejected') {
            console.warn(
              `[ChatService] Failed to clear session permissions during stop for ${targetSessionId}:`,
              clearPermissionsResult.reason
            )
          }

          const cancelGenerationResult = results[1]
          if (cancelGenerationResult?.status === 'rejected') {
            cancelFailed = true
            console.warn(
              `[ChatService] Failed to cancel generation during stop for ${targetSessionId}:`,
              cancelGenerationResult.reason
            )
          }
        }),
        ms: CHAT_STOP_TIMEOUT_MS,
        reason: `chat.stopStream:${targetSessionId}`
      })
    } catch (error) {
      cancelFailed = true
      console.warn(`[ChatService] Stop cleanup timed out for ${targetSessionId}:`, error)
    }

    return { stopped: !cancelFailed }
  }

  async respondToolInteraction(input: ChatRespondToolInteractionInput): Promise<{
    accepted: true
    resumed?: boolean
    waitingForUserMessage?: boolean
    handledInline?: boolean
  }> {
    const result = await this.deps.scheduler.timeout({
      task: this.deps.turn.respondToolInteraction(
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

  private async bestEffortCancel(sessionId: string, reason: string): Promise<void> {
    let cleanupResults: PromiseSettledResult<void>[]
    try {
      cleanupResults = await this.deps.scheduler.timeout({
        task: Promise.allSettled([
          Promise.resolve().then(() =>
            this.deps.sessionPermissionPort.clearSessionPermissions(sessionId)
          ),
          Promise.resolve().then(() => this.deps.turn.cancelGeneration(sessionId))
        ]),
        ms: CHAT_STOP_TIMEOUT_MS,
        reason: `chat.bestEffortCancel:${sessionId}`
      })
    } catch (error) {
      console.warn(`[ChatService] Cleanup timed out after ${reason} for ${sessionId}:`, error)
      return
    }
    const clearPermissionsResult = cleanupResults[0]
    if (clearPermissionsResult?.status === 'rejected') {
      console.warn(
        `[ChatService] Failed to clear session permissions after ${reason} for ${sessionId}:`,
        clearPermissionsResult.reason
      )
    }
    const cancelGenerationResult = cleanupResults[1]
    if (cancelGenerationResult?.status === 'rejected') {
      console.warn(
        `[ChatService] Failed to cancel generation after ${reason} for ${sessionId}:`,
        cancelGenerationResult.reason
      )
    }
  }
}
