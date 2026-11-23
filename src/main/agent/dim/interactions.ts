import type { SessionDatabase } from '@/session/data/database'
import type {
  AssistantMessageBlock,
  MessageMetadata,
  ToolInteractionResponse,
  ToolInteractionResult
} from '@shared/types/agent-interface'
import type { DimSessionControls } from './sessionControls'
import type { JsonValue } from '@shared/contracts/json'
import { dimQuestions, staleDimInteractionMessages } from '@shared/dimQuestions'
import { DimMethodError } from './pluginClient'
import type { DimSessionRef } from './sessionConnection'

/** Responds to native owners. A desktop response never resumes a TypeScript continuation. */
export class DimInteractions {
  private readonly acceptedQuestions = new Map<string, Set<string>>()

  constructor(
    private readonly database: SessionDatabase,
    private readonly controls: DimSessionControls
  ) {}

  readonly respondToolInteraction = async (
    sessionId: string,
    messageId: string,
    toolCallId: string,
    response: ToolInteractionResponse
  ): Promise<ToolInteractionResult> => {
    const { ref, block } = this.pending(sessionId, messageId, toolCallId)
    if (block.action_type === 'tool_call_permission') {
      if (response.kind !== 'permission') throw new Error('A permission decision is required')
      await this.controls.call('approval', ref, {
        requestId: toolCallId,
        decision: response.granted ? 'allow' : 'deny'
      })
    } else if (block.action_type === 'question_request') {
      if (response.kind === 'permission') throw new Error('A question answer is required')
      const requestId = block.extra?.dimRequestId
      if (typeof requestId !== 'string')
        throw new Error('Native question request identity is missing')
      const questions = dimQuestions(JSON.parse(String(block.extra?.dimQuestions ?? '[]')))
      if (!questions.length) throw new Error('Native question arguments are unavailable')
      if (response.kind === 'question_other') {
        await this.answerQuestion(sessionId, messageId, ref, {
          requestId,
          callId: toolCallId,
          declined: true
        })
      } else {
        const answers =
          response.kind === 'question_option' && response.answers
            ? response.answers
            : questions.length === 1
              ? [
                  {
                    questionId: questions[0].id,
                    selected: response.kind === 'question_option' ? [response.optionLabel] : [],
                    ...(response.kind === 'question_custom' ? { custom: response.answerText } : {})
                  }
                ]
              : null
        if (!answers) throw new Error('Answer every native question before submitting the batch')
        await this.answerQuestion(sessionId, messageId, ref, {
          requestId,
          callId: toolCallId,
          answers: answers as unknown as JsonValue
        })
      }
    } else throw new Error('Unknown native interaction')
    return { resumed: true }
  }

  readonly dismissToolInteraction = async (
    sessionId: string,
    messageId: string,
    toolCallId: string
  ): Promise<boolean> => {
    const { ref, block } = this.pending(sessionId, messageId, toolCallId)
    if (block.action_type === 'tool_call_permission')
      await this.controls.call('approval', ref, { requestId: toolCallId, decision: 'deny' })
    else if (block.action_type === 'question_request')
      await this.answerQuestion(sessionId, messageId, ref, {
        requestId: String(block.extra?.dimRequestId),
        callId: toolCallId,
        declined: true
      })
    else return false
    return true
  }

  clearAcceptedQuestions(sessionId: string): void {
    this.acceptedQuestions.delete(sessionId)
  }

  private async answerQuestion(
    sessionId: string,
    messageId: string,
    ref: DimSessionRef,
    params: { requestId: string; callId: string } & ({ answers: JsonValue } | { declined: true })
  ): Promise<void> {
    const key = JSON.stringify([messageId, params.requestId, params.callId])
    try {
      await this.controls.call('answer', ref, params)
    } catch (error) {
      const data = error instanceof DimMethodError ? error.data : null
      if (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        data.appError === 'question_not_pending'
      ) {
        // Dim also returns this before the handler registers its waiter.
        const { block } = this.pending(sessionId, messageId, params.callId)
        if (
          this.acceptedQuestions.get(sessionId)?.has(key) ||
          block.extra?.dimRequestId !== params.requestId
        )
          throw new Error(staleDimInteractionMessages.noLongerPending)
      }
      throw error
    }
    // Remember the acknowledgement until the transcript catches up, including across renderer reloads.
    if (this.database.deepchatMessagesTable.get(messageId)?.status !== 'pending') return
    const accepted = this.acceptedQuestions.get(sessionId) ?? new Set<string>()
    accepted.add(key)
    this.acceptedQuestions.set(sessionId, accepted)
  }

  private pending(sessionId: string, messageId: string, toolCallId: string) {
    const binding = this.database.dimSessionBindingsTable.get(sessionId)
    const message = this.database.deepchatMessagesTable.get(messageId)
    if (!binding || !message || message.session_id !== sessionId || message.role !== 'assistant')
      throw new Error(staleDimInteractionMessages.wrongSession)
    const metadata = JSON.parse(message.metadata) as MessageMetadata
    if (
      metadata.dim?.sessionId !== binding.dimSessionId ||
      metadata.dim.branchId !== binding.branchId
    )
      throw new Error(staleDimInteractionMessages.replacedScope)
    const blocks = JSON.parse(message.content) as AssistantMessageBlock[]
    const block = blocks.find(
      (candidate) =>
        candidate.type === 'action' &&
        candidate.status === 'pending' &&
        candidate.extra?.needsUserAction !== false &&
        candidate.tool_call?.id === toolCallId
    )
    if (!block) throw new Error(staleDimInteractionMessages.noLongerPending)
    return { ref: { sessionId: binding.dimSessionId, branchId: binding.branchId }, block }
  }
}
