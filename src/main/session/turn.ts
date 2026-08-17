import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { normalizeSendMessageInput } from '@/agent/shared/agentSessionNormalization'
import type {
  AttachmentFallbackPolicy,
  ChatMessageRecord,
  MessageStartResult,
  PendingSessionInputRecord,
  SendMessageInput,
  SessionCompactionSnapshot,
  SessionCompactionState,
  SessionContextOccupancySnapshot,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type {
  SessionAssignmentWorkdirPort,
  SessionInitialTurnInput,
  SessionInitialTurnPort,
  SessionTurnPort,
  SessionTurnProjectionPort,
  SessionTurnRuntimePort,
  SessionTurnStorePort,
  SessionTurnTranscriptPort
} from './contracts'

export interface SessionTurnDependencies {
  sessions: SessionTurnStorePort
  runtime: SessionTurnRuntimePort
  transcript: SessionTurnTranscriptPort
  workdir: SessionAssignmentWorkdirPort
  projection: SessionTurnProjectionPort
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

export class SessionTurn implements SessionTurnPort, SessionInitialTurnPort {
  constructor(private readonly dependencies: SessionTurnDependencies) {}

  async startInitialTurn(input: SessionInitialTurnInput): Promise<MessageStartResult | undefined> {
    const content = input.content
    if (!content.text.trim() && (content.files?.length ?? 0) === 0) return undefined
    input.signal?.throwIfAborted()

    try {
      const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(input.sessionId))
      let result: MessageStartResult = { requestId: null, messageId: null }
      if (runtime.kind === 'deepchat') {
        try {
          result = await runtime.send({
            content,
            context: {
              projectDir: input.projectDir,
              ...(input.signal ? { signal: input.signal } : {})
            },
            queue: { source: 'send', projectDir: input.projectDir }
          })
        } catch (error) {
          if (isAbortError(error, input.signal)) throw error
          if ((content.files?.length ?? 0) === 0) throw error
          console.error('[SessionTurn] initial attachment acceptance failed:', error)
          return {
            requestId: null,
            messageId: null,
            attachmentPreparation: {
              status: 'needs_user_action',
              issues: [],
              suggestedActions: ['retry', 'send_without_image_content']
            }
          }
        }
        if (result.attachmentPreparation?.status === 'needs_user_action') {
          return result
        }
      } else {
        void runtime
          .send({
            content,
            context: {
              projectDir: input.projectDir,
              ...(input.signal ? { signal: input.signal } : {})
            },
            queue: { source: 'send', projectDir: input.projectDir }
          })
          .catch((error) => {
            console.error('[SessionTurn] initial send failed:', error)
          })
      }
      this.dependencies.projection.scheduleTitleGeneration({
        sessionId: input.sessionId,
        initialTitle: input.initialTitle,
        fallbackProviderId: input.fallbackProviderId,
        fallbackModelId: input.fallbackModelId
      })
      return result
    } catch (error) {
      if (isAbortError(error, input.signal)) throw error
      console.error('[SessionTurn] initial send failed:', error)
      return undefined
    }
  }

  async sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { maxProviderRounds?: number; signal?: AbortSignal }
  ): Promise<MessageStartResult> {
    return await this.dependencies.workdir.runWithSessionOperationGate(
      sessionId,
      async () => await this.sendMessageUnderSessionGate(sessionId, content, options)
    )
  }

  private async sendMessageUnderSessionGate(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { maxProviderRounds?: number; signal?: AbortSignal }
  ): Promise<MessageStartResult> {
    let session = this.requireSession(sessionId)
    const wasDraft = session.isDraft
    const normalizedInput = normalizeSendMessageInput(content)

    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    const state = await runtime.snapshot()
    const hadMessages = await this.dependencies.transcript.hasMessages(sessionId)
    const providerId = this.resolveProviderId(runtime.kind, state?.providerId)
    this.dependencies.workdir.assertAcpSessionHasWorkdir(providerId, session.projectDir ?? null)
    await this.dependencies.workdir.syncAcpSessionWorkdir(
      providerId,
      sessionId,
      session.agentId,
      session.projectDir ?? null
    )
    const result = await runtime.send({
      content: normalizedInput,
      context: {
        projectDir: session.projectDir ?? null,
        maxProviderRounds: options?.maxProviderRounds,
        ...(options?.signal ? { signal: options.signal } : {})
      },
      queue: {
        source: 'send',
        projectDir: session.projectDir ?? null
      }
    })
    if (result.attachmentPreparation?.status === 'needs_user_action') {
      return result
    }
    const acceptedSession = this.requireSession(sessionId)
    if (acceptedSession.isDraft) {
      this.promoteDraft(sessionId, normalizedInput)
      session = this.requireSession(sessionId)
    } else {
      session = acceptedSession
    }
    if (!hadMessages && !wasDraft) {
      this.dependencies.projection.scheduleTitleGeneration({
        sessionId,
        initialTitle: session.title,
        fallbackProviderId: providerId,
        fallbackModelId: state?.modelId ?? ''
      })
    }
    return result
  }

  async steerActiveTurn(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<MessageStartResult> {
    return await this.dependencies.workdir.runWithSessionOperationGate(
      sessionId,
      async () => await this.steerActiveTurnUnderSessionGate(sessionId, content, options)
    )
  }

  private async steerActiveTurnUnderSessionGate(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { signal?: AbortSignal }
  ): Promise<MessageStartResult> {
    const session = this.requireSession(sessionId)
    const normalizedInput = normalizeSendMessageInput(content)

    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    const state = await runtime.snapshot()
    const providerId = this.resolveProviderId(runtime.kind, state?.providerId)
    this.dependencies.workdir.assertAcpSessionHasWorkdir(providerId, session.projectDir ?? null)
    await this.dependencies.workdir.syncAcpSessionWorkdir(
      providerId,
      sessionId,
      session.agentId,
      session.projectDir ?? null
    )
    const result = options?.signal
      ? await runtime.pending.steerActiveTurn(normalizedInput, { signal: options.signal })
      : await runtime.pending.steerActiveTurn(normalizedInput)
    if (result.attachmentPreparation?.status === 'needs_user_action') {
      return result
    }
    const acceptedSession = this.requireSession(sessionId)
    if (acceptedSession.isDraft) {
      this.promoteDraft(sessionId, normalizedInput)
    }
    return result
  }

  async listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]> {
    if (!this.dependencies.sessions.get(sessionId)) return []
    return await this.dependencies.runtime.resolveSession(toAppSessionId(sessionId)).pending.list()
  }

  async isPendingQueueResumeAvailable(sessionId: string): Promise<boolean> {
    if (!this.dependencies.sessions.get(sessionId)) return false
    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    return runtime.kind === 'deepchat' && (await runtime.isPendingQueueResumeAvailable())
  }

  async resumePendingQueue(sessionId: string): Promise<boolean> {
    return await this.dependencies.workdir.runWithSessionOperationGate(sessionId, async () => {
      this.requireSession(sessionId)
      const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
      if (runtime.kind !== 'deepchat') {
        throw new Error('Pending queue resume is only available for DeepChat sessions.')
      }
      return await runtime.resumePendingQueue()
    })
  }

  async retryPendingQueueInput(
    sessionId: string,
    itemId: string
  ): Promise<{ accepted: boolean; started: boolean }> {
    return await this.dependencies.workdir.runWithSessionOperationGate(sessionId, async () => {
      this.requireSession(sessionId)
      const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
      if (runtime.kind !== 'deepchat') {
        throw new Error('Pending queue retry is only available for DeepChat sessions.')
      }
      return await runtime.retryPendingQueueInput(itemId)
    })
  }

  async queuePendingInput(
    sessionId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    return await this.dependencies.workdir.runWithSessionOperationGate(
      sessionId,
      async () => await this.queuePendingInputUnderSessionGate(sessionId, content)
    )
  }

  private async queuePendingInputUnderSessionGate(
    sessionId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    let session = this.requireSession(sessionId)
    const normalizedInput = normalizeSendMessageInput(content)
    if (session.isDraft) {
      this.promoteDraft(sessionId, normalizedInput)
      session = this.dependencies.sessions.get(sessionId) ?? session
    }

    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    const state = await runtime.snapshot()
    const providerId = this.resolveProviderId(runtime.kind, state?.providerId)
    this.dependencies.workdir.assertAcpSessionHasWorkdir(providerId, session.projectDir ?? null)
    await this.dependencies.workdir.syncAcpSessionWorkdir(
      providerId,
      sessionId,
      session.agentId,
      session.projectDir ?? null
    )
    return await runtime.pending.queue(normalizedInput, {
      source: 'queue',
      projectDir: session.projectDir ?? null
    })
  }

  async updateQueuedInput(
    sessionId: string,
    itemId: string,
    content: string | SendMessageInput
  ): Promise<PendingSessionInputRecord> {
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .pending.update(itemId, normalizeSendMessageInput(content))
  }

  async moveQueuedInput(
    sessionId: string,
    itemId: string,
    toIndex: number
  ): Promise<PendingSessionInputRecord[]> {
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .pending.move(itemId, toIndex)
  }

  async convertPendingInputToSteer(
    sessionId: string,
    itemId: string
  ): Promise<PendingSessionInputRecord> {
    return await this.steerPendingInput(sessionId, itemId)
  }

  async steerPendingInput(sessionId: string, itemId: string): Promise<PendingSessionInputRecord> {
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .pending.steer(itemId)
  }

  async resolveBlockedPendingInput(
    sessionId: string,
    itemId: string,
    action: 'retry' | 'send_without_image_content'
  ): Promise<PendingSessionInputRecord> {
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .pending.resolveBlocked(itemId, action)
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    this.requireSession(sessionId)
    await this.dependencies.runtime.resolveSession(toAppSessionId(sessionId)).pending.delete(itemId)
  }

  async retryMessage(
    sessionId: string,
    messageId: string,
    options?: { attachmentFallbackPolicy?: AttachmentFallbackPolicy }
  ): Promise<MessageStartResult> {
    return await this.dependencies.workdir.runWithSessionOperationGate(
      sessionId,
      async () => await this.retryMessageUnderSessionGate(sessionId, messageId, options)
    )
  }

  private async retryMessageUnderSessionGate(
    sessionId: string,
    messageId: string,
    options?: { attachmentFallbackPolicy?: AttachmentFallbackPolicy }
  ): Promise<MessageStartResult> {
    this.requireSession(sessionId)
    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    const prepared = await this.dependencies.transcript.prepareRetryMessage(sessionId, messageId)
    if (runtime.kind === 'acp') {
      this.dependencies.transcript.commitRetryMessage(sessionId, prepared.sourceOrderSeq)
      return await runtime.send({
        content: prepared.content,
        context: { projectDir: prepared.projectDir, emitRefreshBeforeStream: true }
      })
    }
    const retryContent = options?.attachmentFallbackPolicy
      ? {
          ...prepared.content,
          attachmentFallbackPolicy: options.attachmentFallbackPolicy
        }
      : prepared.content
    return await runtime.send({
      content: retryContent,
      context: {
        projectDir: prepared.projectDir,
        emitRefreshBeforeStream: true,
        preserveResolvedRepresentations: true,
        beforeHistoryPreparation: () =>
          this.dependencies.transcript.commitRetryMessage(sessionId, prepared.sourceOrderSeq)
      }
    })
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    this.requireSession(sessionId)
    await this.dependencies.runtime.resolveSession(toAppSessionId(sessionId)).cancel()
    await this.dependencies.transcript.deleteMessage(sessionId, messageId)
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string
  ): Promise<ChatMessageRecord> {
    this.requireSession(sessionId)
    return await this.dependencies.transcript.editUserMessage(sessionId, messageId, text)
  }

  async getSessionCompactionSnapshot(sessionId: string): Promise<SessionCompactionSnapshot> {
    this.requireSession(sessionId)
    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (runtime.kind === 'acp') {
      return {
        state: {
          status: 'idle',
          cursorOrderSeq: 1,
          summaryUpdatedAt: null,
          boundaryReason: null
        },
        emitSeq: 0,
        latestAnchorEntryId: null
      }
    }
    return await runtime.compaction.getSnapshot()
  }

  async getSessionContextOccupancy(sessionId: string): Promise<SessionContextOccupancySnapshot> {
    this.requireSession(sessionId)
    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (runtime.kind === 'acp') {
      return {
        freshness: 'unavailable',
        source: null,
        occupiedTokens: null,
        contextWindowTokens: null,
        requestSeq: null,
        manifestEntryId: null,
        providerAttemptEntryId: null,
        measuredAt: null
      }
    }
    return await runtime.getContextOccupancy()
  }

  async compactSession(
    sessionId: string
  ): Promise<{ compacted: boolean; state: SessionCompactionState }> {
    const session = this.requireSession(sessionId)
    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (runtime.kind === 'acp') {
      throw new Error(`Agent ${session.agentId} does not support manual compaction.`)
    }
    if ((await runtime.snapshot())?.providerId === 'acp') {
      throw new Error('Manual compaction is only available for DeepChat agent sessions.')
    }
    return await runtime.compaction.compact()
  }

  async clearSessionMessages(sessionId: string): Promise<void> {
    this.requireSession(sessionId)
    await this.dependencies.runtime.resolveSession(toAppSessionId(sessionId)).cancel()
    await this.dependencies.transcript.clearMessages(sessionId)
    this.dependencies.projection.notify({ sessionIds: [sessionId], reason: 'updated' })
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    if (!this.dependencies.sessions.get(sessionId)) return
    await this.dependencies.runtime.resolveSession(toAppSessionId(sessionId)).cancel()
  }

  async respondToolInteraction(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> {
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .toolInteractions.respond(messageId, toolCallId, response)
  }

  private promoteDraft(sessionId: string, input: SendMessageInput): void {
    const title = input.text.trim().slice(0, 50) || 'New Chat'
    this.dependencies.sessions.update(sessionId, { isDraft: false, title })
    this.dependencies.projection.notify({ sessionIds: [sessionId], reason: 'updated' })
  }

  private requireSession(sessionId: string) {
    const session = this.dependencies.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    return session
  }

  private resolveProviderId(kind: 'deepchat' | 'acp', providerId?: string): string {
    return providerId || (kind === 'acp' ? 'acp' : '')
  }
}
