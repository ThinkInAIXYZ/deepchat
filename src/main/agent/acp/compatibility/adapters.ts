import { nanoid } from 'nanoid'
import type { PermissionRequestPayload } from '@shared/types/core/llm-events'
import { createStreamEvent } from '@shared/types/core/llm-events'
import type {
  AcpCompatibilityProjectionPort,
  AcpCancelCause,
  AcpProjectionHandle,
  AcpProjectionSettlement,
  AcpRequestTracePort,
  AcpViewManifestInput
} from '@/agent/acp/instance/ports'
import { accumulate } from '@/agent/deepchat/runtime/accumulator'
import { startEcho, type EchoHandle } from '@/agent/deepchat/runtime/echo'
import { finalize, finalizeError } from '@/agent/deepchat/runtime/dispatch'
import {
  appendStreamingProviderPermissionBlock,
  markStreamingProviderPermissionResolved,
  resolveProviderTerminalDecision
} from '@/agent/deepchat/runtime/process'
import { createAcpPromptTerminalEvents } from '@/agent/acp/runtime/acpContentMapper'
import {
  createState,
  type DeepChatEventPublisher,
  type DeepChatSessionUpdatePublisher,
  type IoParams,
  type StreamState
} from '@/agent/deepchat/runtime/types'
import type { SessionTranscript } from '@/session/data/transcript'
import type { TapeReconciliationPort } from '@/tape/ports/capabilities'
import { buildPersistableMessageTracePayload } from '@/agent/deepchat/runtime/messageTracePayload'

interface ProjectionState {
  stream: StreamState
  io: IoParams
  echo: EchoHandle
}

export interface AcpCompatibilityProjectionAdapterOptions {
  messageStore: SessionTranscript
  tapeReconciliation: TapeReconciliationPort
  writeViewManifest: (input: AcpViewManifestInput) => void | Promise<void>
  setStatus: (status: 'generating' | 'idle' | 'error') => void
  publishEvent: DeepChatEventPublisher
  publishSessionUpdate: DeepChatSessionUpdatePublisher
}

export class AcpCompatibilityProjectionAdapter implements AcpCompatibilityProjectionPort {
  private readonly states = new Map<string, ProjectionState>()

  constructor(private readonly options: AcpCompatibilityProjectionAdapterOptions) {}

  setStatus(status: 'generating' | 'idle' | 'error'): void {
    this.options.setStatus(status)
  }

  begin(input: Parameters<AcpCompatibilityProjectionPort['begin']>[0]): AcpProjectionHandle {
    const { messageStore, tapeReconciliation } = this.options
    tapeReconciliation.ensureSessionTapeReady(input.sessionId, messageStore)
    let userMessageId: string
    let messageId: string
    if (input.projectionContext) {
      const userMessages = input.projectionContext.userMessageIds.map((messageId) =>
        messageStore.getMessage(messageId)
      )
      const assistantMessage = messageStore.getMessage(input.projectionContext.assistantMessageId)
      if (
        userMessages.length === 0 ||
        userMessages.some(
          (message) =>
            !message ||
            message.sessionId !== input.sessionId ||
            message.role !== 'user' ||
            message.status !== 'pending'
        ) ||
        !assistantMessage ||
        assistantMessage.sessionId !== input.sessionId ||
        assistantMessage.role !== 'assistant' ||
        assistantMessage.status !== 'pending'
      ) {
        throw new Error('Claimed ACP steer projection is unavailable.')
      }
      userMessageId = input.projectionContext.userMessageIds.at(-1)!
      messageId = input.projectionContext.assistantMessageId
    } else {
      userMessageId = messageStore.createUserMessage(
        input.sessionId,
        messageStore.getNextOrderSeq(input.sessionId),
        input.userContent
      )
      this.emitCompletedRefresh(input.sessionId, userMessageId)
      messageId = messageStore.createAssistantMessage(
        input.sessionId,
        messageStore.getNextOrderSeq(input.sessionId)
      )
    }
    const handle: AcpProjectionHandle = {
      requestId: messageId,
      messageId,
      userMessageId,
      requestSeq: messageStore.getMaxMessageTraceRequestSeq(messageId) + 1
    }
    const stream = createState()
    const io: IoParams = {
      sessionId: input.sessionId,
      requestId: messageId,
      messageId,
      providerId: 'acp',
      modelId: 'acp',
      messageStore,
      abortSignal: new AbortController().signal,
      publishEvent: this.options.publishEvent,
      publishSessionUpdate: this.options.publishSessionUpdate
    }
    this.states.set(messageId, { stream, io, echo: startEcho(stream, io) })
    return handle
  }

  async attemptViewManifest(input: AcpViewManifestInput): Promise<void> {
    const state = this.requireState(input.messageId)
    state.io.modelId = input.modelId
    await this.options.writeViewManifest(input)
  }

  applyEvents(
    handle: AcpProjectionHandle,
    events: readonly Parameters<typeof accumulate>[1][]
  ): void {
    const state = this.requireState(handle.messageId)
    events.forEach((event) => accumulate(state.stream, event))
    this.flushIfDirty(state)
  }

  presentPermission(handle: AcpProjectionHandle, payload: PermissionRequestPayload): void {
    const state = this.requireState(handle.messageId)
    accumulate(
      state.stream,
      createStreamEvent.reasoning(
        `ACP agent "${payload.agentName ?? payload.agentId ?? 'unknown'}" requests permission: ${payload.tool_call_name ?? payload.tool_call_id}`
      )
    )
    appendStreamingProviderPermissionBlock(state.stream, payload)
    this.flushIfDirty(state)
  }

  settlePermission(handle: AcpProjectionHandle, requestId: string, granted: boolean): void {
    const state = this.requireState(handle.messageId)
    const block = state.stream.blocks.find(
      (candidate) =>
        candidate.type === 'action' &&
        candidate.action_type === 'tool_call_permission' &&
        candidate.extra?.permissionRequestId === requestId
    )
    if (!block) return
    const permissionType =
      block.extra?.permissionType === 'read' ||
      block.extra?.permissionType === 'write' ||
      block.extra?.permissionType === 'all' ||
      block.extra?.permissionType === 'command'
        ? block.extra.permissionType
        : 'all'
    markStreamingProviderPermissionResolved(block, granted, permissionType)
    state.stream.dirty = true
    this.flushIfDirty(state)
  }

  complete(
    handle: AcpProjectionHandle,
    stopReason: Parameters<AcpCompatibilityProjectionPort['complete']>[1]
  ): AcpProjectionSettlement {
    const state = this.takeState(handle.messageId)
    createAcpPromptTerminalEvents(stopReason).forEach((event) => accumulate(state.stream, event))
    return this.settleTerminal(state)
  }

  fail(handle: AcpProjectionHandle, error: unknown): AcpProjectionSettlement {
    const state = this.takeState(handle.messageId)
    const message = error instanceof Error ? error.message : String(error)
    accumulate(state.stream, createStreamEvent.error(`ACP: ${message}`))
    return this.settleTerminal(state)
  }

  cancel(handle: AcpProjectionHandle, cause: AcpCancelCause): AcpProjectionSettlement {
    const state = this.takeState(handle.messageId)
    if (cause === 'pending_input') {
      finalize(state.stream, state.io)
      return { status: 'aborted', stopReason: 'pending_input' }
    }
    const errorMessage = 'common.error.userCanceledGeneration'
    finalizeError(state.stream, state.io, errorMessage)
    return { status: 'aborted', stopReason: 'user_stop', errorMessage }
  }

  private emitCompletedRefresh(sessionId: string, messageId: string): void {
    this.options.publishEvent('chat.stream.completed', {
      requestId: messageId,
      sessionId,
      messageId,
      completedAt: Date.now()
    })
  }

  private flushIfDirty(state: ProjectionState): void {
    if (state.stream.dirty) state.echo.flush()
  }

  private settleTerminal(state: ProjectionState): AcpProjectionSettlement {
    const decision = resolveProviderTerminalDecision(state.stream)
    if (decision.type === 'error') {
      finalizeError(state.stream, state.io, decision.error)
      return { status: 'error', stopReason: 'error', errorMessage: decision.error }
    }
    finalize(state.stream, state.io)
    return { status: 'completed', stopReason: decision.stopReason }
  }

  private requireState(messageId: string): ProjectionState {
    const state = this.states.get(messageId)
    if (!state) throw new Error(`Unknown ACP projection: ${messageId}`)
    return state
  }

  private takeState(messageId: string): ProjectionState {
    const state = this.requireState(messageId)
    this.states.delete(messageId)
    state.echo.stop()
    return state
  }
}

export class AcpRequestTraceAdapter implements AcpRequestTracePort {
  constructor(private readonly messageStore: SessionTranscript) {}

  writePrompt(input: Parameters<AcpRequestTracePort['writePrompt']>[0]): void {
    if (!input.enabled) return
    try {
      const trace = buildPersistableMessageTracePayload({
        endpoint: 'acp://session/prompt',
        headers: {},
        body: {
          sessionId: input.remoteSessionId,
          prompt: input.prompt
        }
      })
      this.messageStore.insertMessageTrace({
        id: nanoid(),
        sessionId: input.sessionId,
        messageId: input.messageId,
        providerId: input.providerId,
        modelId: input.modelId,
        endpoint: trace.endpoint,
        headersJson: trace.headersJson,
        bodyJson: trace.bodyJson,
        truncated: trace.truncated,
        requestSeq: input.requestSeq
      })
    } catch (error) {
      console.warn('[ACP] Failed to persist request trace:', error)
    }
  }
}
