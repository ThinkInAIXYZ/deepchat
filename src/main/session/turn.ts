import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { normalizeSendMessageInput } from '@/agent/shared/agentSessionNormalization'
import type {
  ChatMessageRecord,
  MessageStartResult,
  PendingSessionInputRecord,
  SendMessageInput,
  SessionCompactionState,
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

export class SessionTurn implements SessionTurnPort, SessionInitialTurnPort {
  constructor(private readonly dependencies: SessionTurnDependencies) {}

  startInitialTurn(input: SessionInitialTurnInput): void {
    const content = input.content
    if (!content.text.trim() && (content.files?.length ?? 0) === 0) return

    try {
      const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(input.sessionId))
      void runtime
        .send({
          content,
          context: { projectDir: input.projectDir },
          queue: { source: 'send', projectDir: input.projectDir }
        })
        .catch((error) => {
          console.error('[SessionTurn] initial send failed:', error)
        })
    } catch (error) {
      console.error('[SessionTurn] initial send failed:', error)
    }
    this.dependencies.projection.scheduleTitleGeneration({
      sessionId: input.sessionId,
      initialTitle: input.initialTitle,
      fallbackProviderId: input.fallbackProviderId,
      fallbackModelId: input.fallbackModelId
    })
  }

  async sendMessage(
    sessionId: string,
    content: string | SendMessageInput,
    options?: { maxProviderRounds?: number }
  ): Promise<MessageStartResult> {
    let session = this.requireSession(sessionId)
    const wasDraft = session.isDraft
    const normalizedInput = normalizeSendMessageInput(content)

    if (session.isDraft) {
      this.promoteDraft(sessionId, normalizedInput)
      session = this.requireSession(sessionId)
    }

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
        maxProviderRounds: options?.maxProviderRounds
      },
      queue: {
        source: 'send',
        projectDir: session.projectDir ?? null
      }
    })
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

  async steerActiveTurn(sessionId: string, content: string | SendMessageInput): Promise<void> {
    let session = this.requireSession(sessionId)
    const normalizedInput = normalizeSendMessageInput(content)

    if (session.isDraft) {
      this.promoteDraft(sessionId, normalizedInput)
      session = this.requireSession(sessionId)
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
    await runtime.pending.steerActiveTurn(normalizedInput)
  }

  async listPendingInputs(sessionId: string): Promise<PendingSessionInputRecord[]> {
    if (!this.dependencies.sessions.get(sessionId)) return []
    return await this.dependencies.runtime.resolveSession(toAppSessionId(sessionId)).pending.list()
  }

  async queuePendingInput(
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
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .pending.convertToSteer(itemId)
  }

  async steerPendingInput(sessionId: string, itemId: string): Promise<PendingSessionInputRecord> {
    this.requireSession(sessionId)
    return await this.dependencies.runtime
      .resolveSession(toAppSessionId(sessionId))
      .pending.steer(itemId)
  }

  async deletePendingInput(sessionId: string, itemId: string): Promise<void> {
    this.requireSession(sessionId)
    await this.dependencies.runtime.resolveSession(toAppSessionId(sessionId)).pending.delete(itemId)
  }

  async retryMessage(sessionId: string, messageId: string): Promise<void> {
    this.requireSession(sessionId)
    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    const prepared = await this.dependencies.transcript.prepareRetryMessage(sessionId, messageId)
    await runtime.send({
      content: prepared.content,
      context: { projectDir: prepared.projectDir, emitRefreshBeforeStream: true }
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

  async getSessionCompactionState(sessionId: string): Promise<SessionCompactionState> {
    this.requireSession(sessionId)
    const runtime = this.dependencies.runtime.resolveSession(toAppSessionId(sessionId))
    if (runtime.kind === 'acp') {
      return { status: 'idle', cursorOrderSeq: 1, summaryUpdatedAt: null }
    }
    return await runtime.compaction.getState()
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
