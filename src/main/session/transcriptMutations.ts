import type { ChatMessageRecord, SendMessageInput } from '@shared/types/agent-interface'
import type { SessionPendingInputs } from './data/pendingInputs'
import type { SessionSettingsStore } from './data/settings'
import type { SessionTranscript } from './data/transcript'
import { buildEditedUserContent, extractUserMessageInput } from './data/userMessageContent'
import { parseMessageMetadata } from './usageStats'

export interface SessionTranscriptRuntimePort {
  prepareClearMessages(sessionId: string): Promise<void>
  finishClearMessages(sessionId: string): void
  prepareRetry(
    sessionId: string,
    options?: { allowRestartHeldQueue?: boolean }
  ): Promise<{ projectDir: string | null }>
  assertNoActivePendingInputs(sessionId: string): void
  cancelForTranscriptMutation(sessionId: string): Promise<void>
  invalidateTranscriptFrom(sessionId: string, orderSeq: number): void
  finishTranscriptTruncate(sessionId: string): void
  resetForkTarget(sessionId: string): void
}

export interface SessionTranscriptMutationDependencies {
  transcript: SessionTranscript
  settings: SessionSettingsStore
  pendingInputs: SessionPendingInputs
  runtime: SessionTranscriptRuntimePort
  runInTransaction<T>(operation: () => T): T
}

export class SessionTranscriptMutations {
  constructor(private readonly dependencies: SessionTranscriptMutationDependencies) {}

  async clearMessages(sessionId: string): Promise<void> {
    await this.dependencies.runtime.prepareClearMessages(sessionId)
    this.dependencies.runInTransaction(() => {
      this.dependencies.pendingInputs.deleteBySession(sessionId)
      this.dependencies.transcript.deleteBySession(sessionId)
      this.dependencies.settings.resetTape(sessionId)
    })
    this.dependencies.runtime.finishClearMessages(sessionId)
  }

  async prepareRetryMessage(
    sessionId: string,
    messageId: string
  ): Promise<{ content: SendMessageInput; projectDir: string | null; sourceOrderSeq: number }> {
    const target = this.requireMessage(sessionId, messageId)
    const sourceUserMessage =
      target.role === 'user'
        ? target
        : this.dependencies.transcript.getLastUserMessageBeforeOrAt(sessionId, target.orderSeq)
    if (!sourceUserMessage) throw new Error('No user message found for retry.')
    const sourceMetadata = parseMessageMetadata(sourceUserMessage.metadata)
    const allowRestartHeldQueue =
      target.status === 'error' && sourceMetadata.inputReceipt?.mode === 'steer'
    const { projectDir } = await this.dependencies.runtime.prepareRetry(sessionId, {
      allowRestartHeldQueue
    })

    const content = extractUserMessageInput(sourceUserMessage.content)
    if (!content.text.trim() && (content.files?.length ?? 0) === 0) {
      throw new Error('Cannot retry an empty user message.')
    }

    return { content, projectDir, sourceOrderSeq: sourceUserMessage.orderSeq }
  }

  commitRetryMessage(sessionId: string, sourceOrderSeq: number): void {
    this.dependencies.runInTransaction(() => {
      this.dependencies.transcript.deleteFromOrderSeq(sessionId, sourceOrderSeq)
    })
    this.dependencies.runtime.invalidateTranscriptFrom(sessionId, sourceOrderSeq)
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    this.dependencies.runtime.assertNoActivePendingInputs(sessionId)
    const target = this.requireMessage(sessionId, messageId)

    await this.dependencies.runtime.cancelForTranscriptMutation(sessionId)
    this.dependencies.runtime.invalidateTranscriptFrom(sessionId, target.orderSeq)
    this.dependencies.transcript.deleteFromOrderSeq(sessionId, target.orderSeq)
    this.dependencies.runtime.finishTranscriptTruncate(sessionId)
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string
  ): Promise<ChatMessageRecord> {
    this.dependencies.runtime.assertNoActivePendingInputs(sessionId)
    const target = this.requireMessage(sessionId, messageId)
    if (target.role !== 'user') throw new Error('Only user messages can be edited.')

    const nextText = text.trim()
    if (!nextText) throw new Error('Edited message cannot be empty.')

    this.dependencies.runtime.invalidateTranscriptFrom(sessionId, target.orderSeq)
    this.dependencies.transcript.updateMessageContent(
      messageId,
      buildEditedUserContent(target.content, nextText)
    )

    const updated = this.dependencies.transcript.getMessage(messageId)
    if (!updated) throw new Error(`Message ${messageId} not found after edit`)
    return updated
  }

  async forkSessionFromMessage(
    sourceSessionId: string,
    targetSessionId: string,
    targetMessageId: string
  ): Promise<void> {
    const target = this.requireMessage(sourceSessionId, targetMessageId)
    this.dependencies.transcript.cloneSentMessagesToSession(
      sourceSessionId,
      targetSessionId,
      target.orderSeq
    )
    this.dependencies.runtime.resetForkTarget(targetSessionId)
  }

  private requireMessage(sessionId: string, messageId: string): ChatMessageRecord {
    const message = this.dependencies.transcript.getMessage(messageId)
    if (!message) throw new Error(`Message ${messageId} not found`)
    if (message.sessionId !== sessionId) {
      throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
    }
    return message
  }
}
