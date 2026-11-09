import type { SessionDatabase } from '@/session/data/database'
import type { SessionTranscriptMutationPort } from '@/session/data/contracts'
import type { UserMessageInlineItem, ChatMessageRecord } from '@shared/types/agent-interface'
import { buildEditedUserContent, extractUserMessageInput } from '@/session/data/userMessageContent'
import { isSendMessageInputEmpty } from '@/agent/shared/agentSessionNormalization'
import type { DimSessionSettings } from './sessionSettings'
import type { DimScopeTransitions } from './scopeTransitions'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'
import { DimContent } from './content'
import type { DimUserMessageReuse } from './sessionRuntime'

interface MutationOptions {
  database: SessionDatabase
  host: DimRuntimeSupervisor
  settings: Pick<DimSessionSettings, 'creation'>
  transitions: DimScopeTransitions
  prepareHistory(sessionId: string): Promise<void>
  projectDir(sessionId: string): string | null
  invalidate(sessionId: string, fromOrderSeq: number): void | Promise<void>
}

/** A product history edit selects a new native generation; it never rewrites native facts. */
export class DimTranscriptMutations implements Omit<
  SessionTranscriptMutationPort,
  'forkSessionFromMessage'
> {
  private readonly content: DimContent
  constructor(private readonly options: MutationOptions) {
    this.content = new DimContent(options.host)
  }

  async clearMessages(sessionId: string): Promise<void> {
    await this.options.prepareHistory(sessionId)
    await this.options.transitions.replace(
      sessionId,
      await this.options.settings.creation(sessionId),
      { kind: 'clear' }
    )
    await this.options.invalidate(sessionId, 1)
  }

  async prepareRetryMessage(sessionId: string, messageId: string) {
    await this.options.prepareHistory(sessionId)
    this.requireMessage(await this.messages(sessionId), messageId)
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)!
    const client = await this.options.host.start()
    const ref = { sessionId: binding.dimSessionId, branchId: binding.branchId }
    const pending = await client.call<{
      inputs: Array<{ input: { mode?: string; user?: unknown } }>
    }>('session.deepchat_queue.list', ref)
    if (
      pending.inputs.some(
        ({ input }) =>
          input.mode === 'queue' ||
          input.mode === 'steer' ||
          (input.mode === undefined && input.user != null)
      )
    )
      throw new Error('Finish or remove queued input before retrying this message')
    await client.call('deepchat.host.stop', ref)
    const messages = await this.messages(sessionId)
    const target = this.requireMessage(messages, messageId)
    const source =
      target.role === 'user'
        ? target
        : messages.findLast(
            (message) => message.role === 'user' && message.orderSeq <= target.orderSeq
          )
    if (!source) throw new Error('No user message found for retry.')
    const content = extractUserMessageInput(source.content)
    if (isSendMessageInputEmpty(content)) throw new Error('Cannot retry an empty user message.')
    return {
      content,
      projectDir: this.options.projectDir(sessionId),
      sourceOrderSeq: source.orderSeq,
      retryFromOrderSeq: source.orderSeq,
      sourceMessageId: source.id,
      reuseUserMessage: {
        messageId: source.id,
        orderSeq: source.orderSeq,
        createdAt: source.createdAt
      }
    }
  }

  async commitRetryMessage(
    sessionId: string,
    fromOrderSeq: number,
    reuseUserMessage?: DimUserMessageReuse
  ): Promise<void> {
    await this.options.transitions.replace(
      sessionId,
      await this.options.settings.creation(sessionId),
      reuseUserMessage
        ? { kind: 'retry', fromOrderSeq, messageId: reuseUserMessage.messageId }
        : { kind: 'truncate', fromOrderSeq }
    )
    await this.options.invalidate(sessionId, fromOrderSeq)
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    await this.options.prepareHistory(sessionId)
    const target = this.requireMessage(await this.messages(sessionId), messageId)
    await this.commitRetryMessage(sessionId, target.orderSeq)
  }

  async editUserMessage(
    sessionId: string,
    messageId: string,
    text: string,
    inlineItems?: UserMessageInlineItem[]
  ): Promise<ChatMessageRecord> {
    await this.options.prepareHistory(sessionId)
    const target = this.requireMessage(await this.messages(sessionId), messageId)
    if (target.role !== 'user') throw new Error('Only user messages can be edited.')
    const content = buildEditedUserContent(
      target.content,
      inlineItems ? text : text.trim(),
      inlineItems
    )
    if (isSendMessageInputEmpty(extractUserMessageInput(content)))
      throw new Error('Edited message cannot be empty.')
    await this.options.transitions.replace(
      sessionId,
      await this.options.settings.creation(sessionId),
      { kind: 'edit', messageId, expectedContent: target.content, content }
    )
    await this.options.invalidate(sessionId, target.orderSeq)
    return this.requireMessage(await this.messages(sessionId), messageId)
  }

  private async messages(sessionId: string): Promise<ChatMessageRecord[]> {
    const binding = this.options.database.dimSessionBindingsTable.get(sessionId)
    if (!binding) throw new Error('Native session is not initialized')
    const view = await this.content.transcript(
      { sessionId: binding.dimSessionId, branchId: binding.branchId },
      sessionId
    )
    return view.messages
  }
  private requireMessage(messages: ChatMessageRecord[], messageId: string): ChatMessageRecord {
    const message = messages.find((message) => message.id === messageId)
    if (!message) throw new Error(`Message ${messageId} not found in this session`)
    return message
  }
}
