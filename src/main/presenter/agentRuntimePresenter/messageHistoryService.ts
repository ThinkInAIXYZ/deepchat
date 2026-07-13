import type {
  ChatMessageRecord,
  DeepChatSessionState,
  MessageFile,
  SendMessageInput,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { DeepChatMessageStore } from './messageStore'

export type MessageHistoryRuntime = {
  getSessionState: (sessionId: string) => Promise<DeepChatSessionState | null>
  cancelGeneration: (sessionId: string) => Promise<void>
  deletePendingInputs: (sessionId: string) => void
  clearFirstTurnReady: (sessionId: string) => void
  resetMemoryExtractionCursor: (sessionId: string) => void
  clearMemoryIngestionProjectionRetry: (sessionId: string) => void
  resetTape: (sessionId: string) => void
  resetSummaryState: (sessionId: string) => void
  setSessionStatus: (sessionId: string, status: DeepChatSessionState['status']) => void
  hasPendingInteractions: (sessionId: string) => boolean
  assertNoActiveInputs: (sessionId: string) => void
  invalidateSummaryIfNeeded: (sessionId: string, orderSeq: number) => void
  invalidateMemoryExtractionFromOrderSeq: (sessionId: string, orderSeq: number) => void
  resolveProjectDir: (sessionId: string) => string | null
  processMessage: (
    sessionId: string,
    input: SendMessageInput,
    context: { projectDir: string | null; emitRefreshBeforeStream: true }
  ) => Promise<unknown>
}

function normalizeSkillNames(skillNames: string[]): string[] {
  return Array.from(
    new Set(skillNames.map((name) => name.trim()).filter((name) => name.length > 0))
  ).sort((left, right) => left.localeCompare(right))
}

function extractUserMessageInput(content: string): SendMessageInput {
  const fallback: SendMessageInput = { text: '', files: [] }

  try {
    const parsed = JSON.parse(content) as UserMessageContent | SendMessageInput | string
    if (typeof parsed === 'string') {
      return { text: parsed, files: [] }
    }
    if (!parsed || typeof parsed !== 'object') {
      return fallback
    }

    const text = typeof parsed.text === 'string' ? parsed.text : ''
    const files = Array.isArray((parsed as { files?: unknown }).files)
      ? ((parsed as { files?: unknown }).files as MessageFile[]).filter((file) => Boolean(file))
      : []
    const activeSkills = normalizeSkillNames(
      Array.isArray((parsed as { activeSkills?: unknown }).activeSkills)
        ? ((parsed as { activeSkills?: unknown }).activeSkills as string[])
        : []
    )
    const inlineItems: NonNullable<SendMessageInput['inlineItems']> = Array.isArray(
      (parsed as { inlineItems?: unknown }).inlineItems
    )
      ? ((parsed as { inlineItems?: unknown }).inlineItems as NonNullable<
          SendMessageInput['inlineItems']
        >)
      : []

    return {
      text,
      files,
      ...(activeSkills.length > 0 ? { activeSkills } : {}),
      ...(inlineItems.length > 0 ? { inlineItems } : {})
    }
  } catch {
    return { text: content, files: [] }
  }
}

function buildEditedUserContent(rawContent: string, text: string): string {
  const fallback: UserMessageContent = {
    text,
    files: [],
    links: [],
    search: false,
    think: false
  }

  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown> | string
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return JSON.stringify(fallback)
    }

    const next = { ...parsed, text } as Record<string, unknown>
    delete next.inlineItems

    if (!Array.isArray(next.files)) {
      next.files = []
    }
    if (!Array.isArray(next.links)) {
      next.links = []
    }
    if (typeof next.search !== 'boolean') {
      next.search = false
    }
    if (typeof next.think !== 'boolean') {
      next.think = false
    }

    if (Array.isArray(next.content)) {
      let replaced = false
      const mapped = next.content.map((item) => {
        if (
          !replaced &&
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          (item as { type?: unknown }).type === 'text'
        ) {
          replaced = true
          return { ...(item as Record<string, unknown>), content: text }
        }
        return item
      })

      if (!replaced) {
        mapped.unshift({ type: 'text', content: text })
      }
      next.content = mapped
    }

    return JSON.stringify(next)
  } catch {
    return JSON.stringify(fallback)
  }
}

export class MessageHistoryService {
  constructor(
    private readonly messageStore: DeepChatMessageStore,
    private readonly runtime: MessageHistoryRuntime
  ) {}

  async clearMessages(sessionId: string): Promise<void> {
    const state = await this.runtime.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }

    await this.runtime.cancelGeneration(sessionId)
    this.runtime.deletePendingInputs(sessionId)
    this.runtime.clearFirstTurnReady(sessionId)
    this.runtime.resetMemoryExtractionCursor(sessionId)
    this.runtime.clearMemoryIngestionProjectionRetry(sessionId)
    this.messageStore.deleteBySession(sessionId)
    this.runtime.resetTape(sessionId)
    this.runtime.resetSummaryState(sessionId)
    this.runtime.setSessionStatus(sessionId, 'idle')
  }

  rollbackPersistedPendingInputTurn(sessionId: string, userMessageId: string | null): void {
    const userMessage = userMessageId ? this.messageStore.getMessage(userMessageId) : null
    if (!userMessage) return

    this.runtime.invalidateSummaryIfNeeded(sessionId, userMessage.orderSeq)
    this.runtime.invalidateMemoryExtractionFromOrderSeq(sessionId, userMessage.orderSeq)
    this.messageStore.deleteFromOrderSeq(sessionId, userMessage.orderSeq)
  }

  async retryMessage(sessionId: string, messageId: string): Promise<void> {
    const state = await this.runtime.getSessionState(sessionId)
    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (state.status === 'generating') {
      throw new Error('Cannot retry while session is generating.')
    }
    if (this.runtime.hasPendingInteractions(sessionId)) {
      throw new Error('Please resolve pending tool interactions before retrying.')
    }
    this.runtime.assertNoActiveInputs(sessionId)

    const target = await this.messageStore.getMessage(messageId)
    if (!target) {
      throw new Error(`Message ${messageId} not found`)
    }
    if (target.sessionId !== sessionId) {
      throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
    }

    const sourceUserMessage =
      target.role === 'user'
        ? target
        : this.messageStore.getLastUserMessageBeforeOrAt(sessionId, target.orderSeq)
    if (!sourceUserMessage) {
      throw new Error('No user message found for retry.')
    }

    const retryInput = extractUserMessageInput(sourceUserMessage.content)
    if (!retryInput.text.trim()) {
      throw new Error('Cannot retry an empty user message.')
    }

    this.runtime.invalidateSummaryIfNeeded(sessionId, sourceUserMessage.orderSeq)
    this.runtime.invalidateMemoryExtractionFromOrderSeq(sessionId, sourceUserMessage.orderSeq)
    this.messageStore.deleteFromOrderSeq(sessionId, sourceUserMessage.orderSeq)
    await this.runtime.processMessage(sessionId, retryInput, {
      projectDir: this.runtime.resolveProjectDir(sessionId),
      emitRefreshBeforeStream: true
    })
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    this.runtime.assertNoActiveInputs(sessionId)
    const target = await this.messageStore.getMessage(messageId)
    if (!target) {
      throw new Error(`Message ${messageId} not found`)
    }
    if (target.sessionId !== sessionId) {
      throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
    }

    await this.runtime.cancelGeneration(sessionId)
    this.runtime.invalidateSummaryIfNeeded(sessionId, target.orderSeq)
    this.runtime.invalidateMemoryExtractionFromOrderSeq(sessionId, target.orderSeq)
    this.messageStore.deleteFromOrderSeq(sessionId, target.orderSeq)
    this.runtime.setSessionStatus(sessionId, 'idle')
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string
  ): Promise<ChatMessageRecord> {
    this.runtime.assertNoActiveInputs(sessionId)
    const target = await this.messageStore.getMessage(messageId)
    if (!target) {
      throw new Error(`Message ${messageId} not found`)
    }
    if (target.sessionId !== sessionId) {
      throw new Error(`Message ${messageId} does not belong to session ${sessionId}`)
    }
    if (target.role !== 'user') {
      throw new Error('Only user messages can be edited.')
    }

    const nextText = text.trim()
    if (!nextText) {
      throw new Error('Edited message cannot be empty.')
    }

    const nextContent = buildEditedUserContent(target.content, nextText)
    this.runtime.invalidateSummaryIfNeeded(sessionId, target.orderSeq)
    this.runtime.invalidateMemoryExtractionFromOrderSeq(sessionId, target.orderSeq)
    this.messageStore.updateMessageContent(messageId, nextContent)

    const updated = await this.messageStore.getMessage(messageId)
    if (!updated) {
      throw new Error(`Message ${messageId} not found after edit`)
    }
    return updated
  }

  async forkSessionFromMessage(
    sourceSessionId: string,
    targetSessionId: string,
    targetMessageId: string
  ): Promise<void> {
    const target = await this.messageStore.getMessage(targetMessageId)
    if (!target) {
      throw new Error(`Message ${targetMessageId} not found`)
    }
    if (target.sessionId !== sourceSessionId) {
      throw new Error(`Message ${targetMessageId} does not belong to session ${sourceSessionId}`)
    }

    this.messageStore.cloneSentMessagesToSession(sourceSessionId, targetSessionId, target.orderSeq)
    this.runtime.resetSummaryState(targetSessionId)
  }
}
