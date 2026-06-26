import {
  FEISHU_CONVERSATION_POLL_TIMEOUT_MS,
  FEISHU_INBOUND_DEDUP_LIMIT,
  FEISHU_INBOUND_DEDUP_TTL_MS,
  FEISHU_REMOTE_REACTION_EMOJI,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  buildFeishuEndpointKey,
  type RemoteDeliverySegment,
  type FeishuInboundMessage,
  type FeishuOutboundAction,
  type FeishuRuntimeStatusSnapshot,
  type FeishuTransportTarget
} from '../types'
import { RemoteBindingStore } from '../services/remoteBindingStore'
import { FeishuCommandRouter } from '../services/feishuCommandRouter'
import type { RemoteConversationExecution } from '../services/remoteConversationRunner'
import { REMOTE_NO_RESPONSE_TEXT } from '../services/remoteBlockRenderer'
import {
  buildFeishuPendingInteractionCard,
  buildFeishuPendingInteractionText
} from './feishuInteractionPrompt'
import { chunkFeishuText, FeishuClient, type FeishuBotIdentity } from './feishuClient'
import { optimizeMarkdownForFeishu } from './feishuMarkdown'
import { FeishuParser } from './feishuParser'

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const safeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const FEISHU_INTERNAL_ERROR_REPLY = 'An internal error occurred while processing your request.'
const FEISHU_STREAMING_CARD_FALLBACK_NOTICE =
  'Feishu CardKit streaming failed. Falling back to normal message updates. Check that the app has im:message and cardkit:card:write permissions.'

type FeishuRuntimeDeps = {
  client: FeishuClient
  parser: FeishuParser
  router: FeishuCommandRouter
  bindingStore: RemoteBindingStore
  enableStreamingCards?: boolean
  logger?: {
    error: (...params: unknown[]) => void
  }
  onStatusChange?: (snapshot: FeishuRuntimeStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

type FeishuProcessedInboundEntry = {
  receivedAt: number
  eventId: string | null
}

type FeishuRemoteDeliveryState = {
  sourceMessageId: string
  segments: Array<{
    key: string
    kind: 'process' | 'answer' | 'terminal'
    messageIds: Array<string | null>
    lastText: string
  }>
}

type FeishuStreamingCardDeliveryState = {
  cardId: string
  elementId: string
  sequence: number
  lastText: string
  closed: boolean
}

export class FeishuRuntime {
  private runId = 0
  private started = false
  private stopRequested = false
  private statusSnapshot: FeishuRuntimeStatusSnapshot = {
    state: 'stopped',
    lastError: null,
    botUser: null
  }
  private readonly processedInboundByMessage = new Map<string, FeishuProcessedInboundEntry>()
  private readonly processedEventToMessage = new Map<string, string>()
  private readonly endpointOperations = new Map<string, Promise<void>>()

  constructor(private readonly deps: FeishuRuntimeDeps) {}

  async start(): Promise<void> {
    if (this.started) {
      return
    }

    const runId = ++this.runId
    this.started = true
    this.stopRequested = false
    this.setStatus({
      state: 'starting',
      lastError: null
    })

    try {
      const botUser = await this.deps.client.probeBot()
      if (!this.isCurrentRun(runId)) {
        return
      }

      this.setBotUser(botUser)
      await this.deps.client.startMessageStream({
        onMessage: async (event) => {
          try {
            this.acceptRawMessage(event, runId)
          } catch (error) {
            console.warn('[FeishuRuntime] Failed to enqueue event:', error)
          }
        }
      })
      if (!this.isCurrentRun(runId)) {
        return
      }

      this.setStatus({
        state: 'running',
        lastError: null
      })
    } catch (error) {
      if (!this.isCurrentRun(runId)) {
        return
      }

      this.started = false
      this.setStatus({
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true
    this.started = false
    this.runId += 1
    this.deps.client.stop()
    this.endpointOperations.clear()
    this.processedInboundByMessage.clear()
    this.processedEventToMessage.clear()
    this.setStatus({
      state: 'stopped'
    })
  }

  getStatusSnapshot(): FeishuRuntimeStatusSnapshot {
    return { ...this.statusSnapshot }
  }

  private isCurrentRun(runId: number): boolean {
    return this.runId === runId && this.started && !this.stopRequested
  }

  private acceptRawMessage(event: Parameters<FeishuParser['parseEvent']>[0], runId: number): void {
    if (!this.isCurrentRun(runId)) {
      return
    }

    const parsed = this.deps.parser.parseEvent(event, this.statusSnapshot.botUser?.openId)
    if (!parsed) {
      return
    }

    const duplicateReason = this.rememberInboundMessage(parsed)
    if (duplicateReason) {
      console.info('[FeishuRuntime] Dropped duplicate inbound message.', {
        reason: duplicateReason,
        chatId: parsed.chatId,
        threadId: parsed.threadId,
        messageId: parsed.messageId,
        eventId: parsed.eventId
      })
      return
    }

    const endpointKey = buildFeishuEndpointKey(parsed.chatId, parsed.threadId)
    if (parsed.command?.name === 'stop') {
      void this.processInboundMessage(parsed, runId)
      return
    }

    this.enqueueEndpointOperation(endpointKey, runId, async () => {
      await this.processInboundMessage(parsed, runId)
    })
  }

  private rememberInboundMessage(message: FeishuInboundMessage): 'eventId' | 'messageId' | null {
    const now = Date.now()
    this.pruneProcessedInbound(now)

    const messageKey = this.buildMessageDedupKey(message)
    if (this.processedInboundByMessage.has(messageKey)) {
      return 'messageId'
    }

    const normalizedEventId = message.eventId.trim()
    if (normalizedEventId && this.processedEventToMessage.has(normalizedEventId)) {
      return 'eventId'
    }

    this.processedInboundByMessage.set(messageKey, {
      receivedAt: now,
      eventId: normalizedEventId || null
    })
    if (normalizedEventId) {
      this.processedEventToMessage.set(normalizedEventId, messageKey)
    }

    while (this.processedInboundByMessage.size > FEISHU_INBOUND_DEDUP_LIMIT) {
      const oldestKey = this.processedInboundByMessage.keys().next().value
      if (!oldestKey) {
        break
      }
      this.deleteProcessedInbound(oldestKey)
    }

    return null
  }

  private buildMessageDedupKey(message: FeishuInboundMessage): string {
    return `${message.chatId}:${message.messageId}`
  }

  private pruneProcessedInbound(now: number): void {
    for (const [messageKey, entry] of this.processedInboundByMessage.entries()) {
      if (now - entry.receivedAt <= FEISHU_INBOUND_DEDUP_TTL_MS) {
        break
      }
      this.deleteProcessedInbound(messageKey)
    }
  }

  private deleteProcessedInbound(messageKey: string): void {
    const entry = this.processedInboundByMessage.get(messageKey)
    if (!entry) {
      return
    }

    this.processedInboundByMessage.delete(messageKey)
    if (entry.eventId) {
      this.processedEventToMessage.delete(entry.eventId)
    }
  }

  private enqueueEndpointOperation(
    endpointKey: string,
    runId: number,
    operation: () => Promise<void>
  ): void {
    const previous = this.endpointOperations.get(endpointKey) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (!this.isCurrentRun(runId)) {
          return
        }

        await operation()
      })
      .finally(() => {
        if (this.endpointOperations.get(endpointKey) === next) {
          this.endpointOperations.delete(endpointKey)
        }
      })

    this.endpointOperations.set(endpointKey, next)
  }

  private async processInboundMessage(parsed: FeishuInboundMessage, runId: number): Promise<void> {
    if (!this.isCurrentRun(runId)) {
      return
    }
    const message = await this.resolveMessageAttachments(parsed)

    const target: FeishuTransportTarget = {
      chatId: message.chatId,
      threadId: message.threadId,
      replyToMessageId: message.messageId
    }

    try {
      const routed = await this.deps.router.handleMessage(message)
      if (!this.isCurrentRun(runId)) {
        return
      }

      for (const reply of routed.replies) {
        if (!this.isCurrentRun(runId)) {
          return
        }
        await this.deps.client.sendMarkdown(target, optimizeMarkdownForFeishu(reply))
      }

      if (routed.outboundActions?.length) {
        await this.dispatchOutboundActions(target, routed.outboundActions, runId)
      }

      if (routed.conversation) {
        let reactionId: string | null = null
        try {
          reactionId = await this.setThinkingReaction(message.messageId)
        } catch (error) {
          console.warn('[FeishuRuntime] Failed to set thinking reaction:', error)
        }

        try {
          await this.deliverConversation(target, routed.conversation, runId)
        } finally {
          if (reactionId) {
            try {
              await this.clearThinkingReaction(message.messageId, reactionId)
            } catch (error) {
              console.warn('[FeishuRuntime] Failed to clear thinking reaction:', error)
            }
          }
        }
      }
    } catch (error) {
      const diagnostics = {
        runId,
        target,
        chatId: message.chatId,
        threadId: message.threadId,
        messageId: message.messageId,
        eventId: message.eventId
      }

      console.warn('[FeishuRuntime] Failed to handle event:', {
        ...diagnostics,
        error
      })
      if (this.deps.logger?.error) {
        this.deps.logger.error(error, diagnostics)
      } else {
        console.error('[FeishuRuntime] Failed to handle event:', error, diagnostics)
      }

      if (!this.isCurrentRun(runId)) {
        return
      }

      try {
        if (!this.isCurrentRun(runId)) {
          return
        }
        await this.deps.client.sendText(target, FEISHU_INTERNAL_ERROR_REPLY)
      } catch (sendError) {
        console.warn('[FeishuRuntime] Failed to send error reply:', {
          chatId: parsed.chatId,
          threadId: parsed.threadId,
          messageId: message.messageId,
          eventId: message.eventId,
          error: sendError
        })
      }
    }
  }

  private async resolveMessageAttachments(
    message: FeishuInboundMessage
  ): Promise<FeishuInboundMessage> {
    if ((message.attachments ?? []).length === 0) {
      return message
    }

    const attachments = await Promise.all(
      (message.attachments ?? []).map(async (attachment) => {
        if (!attachment.resourceKey || attachment.data) {
          return attachment
        }

        try {
          const downloaded = await this.deps.client.downloadMessageResource({
            messageId: message.messageId,
            fileKey: attachment.resourceKey,
            type: attachment.resourceType === 'image' ? 'image' : 'file'
          })
          return {
            ...attachment,
            data: downloaded.data,
            mediaType: downloaded.mediaType?.trim() || attachment.mediaType
          }
        } catch (error) {
          console.warn('[FeishuRuntime] Failed to download Feishu message resource:', {
            messageId: message.messageId,
            filename: attachment.filename,
            error
          })
          return {
            ...attachment,
            failedDownload: true,
            errorMessage: 'Failed to load attachment'
          }
        }
      })
    )

    return {
      ...message,
      attachments,
      allAttachmentsFailed:
        attachments.length > 0 && attachments.every((attachment) => attachment.failedDownload)
    }
  }

  private async deliverConversation(
    target: FeishuTransportTarget,
    execution: RemoteConversationExecution,
    runId: number
  ): Promise<void> {
    const startedAt = Date.now()
    const endpointKey = buildFeishuEndpointKey(target.chatId, target.threadId)

    if (this.deps.enableStreamingCards) {
      const streamed = await this.deliverConversationWithStreamingCard(
        target,
        execution,
        runId,
        endpointKey,
        startedAt
      )
      if (streamed) {
        return
      }
    }

    while (this.isCurrentRun(runId)) {
      const snapshot = await execution.getSnapshot()
      if (!this.isCurrentRun(runId)) {
        return
      }
      const sourceMessageId = snapshot.messageId ?? execution.eventId ?? null
      let deliveryState = this.getStoredDeliveryState(endpointKey)
      deliveryState = await this.prepareDeliveryStateForSource(
        endpointKey,
        sourceMessageId,
        deliveryState
      )
      let deliverySegments = this.getSnapshotDeliverySegments(snapshot, sourceMessageId)

      if (sourceMessageId) {
        deliveryState = deliveryState ?? this.createDeliveryState(sourceMessageId)
      }

      if (snapshot.completed) {
        if (!this.isCurrentRun(runId)) {
          return
        }
        if (snapshot.pendingInteraction) {
          if (deliveryState && deliverySegments.length > 0) {
            deliveryState = await this.syncDeliverySegments(
              target,
              endpointKey,
              deliveryState,
              deliverySegments
            )
          }
          await this.dispatchOutboundActions(
            target,
            [
              {
                type: 'sendCard',
                card: buildFeishuPendingInteractionCard(snapshot.pendingInteraction),
                fallbackText: buildFeishuPendingInteractionText(snapshot.pendingInteraction)
              }
            ],
            runId
          )
          return
        }

        const finalText = this.getFinalDeliveryText(snapshot)
        deliverySegments = this.appendTerminalDeliverySegment(
          deliverySegments,
          sourceMessageId,
          finalText
        )
        if (deliveryState) {
          if (deliverySegments.length > 0) {
            deliveryState = await this.syncDeliverySegments(
              target,
              endpointKey,
              deliveryState,
              deliverySegments
            )
          }
          this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
        } else if (finalText) {
          await this.deps.client.sendMarkdown(target, optimizeMarkdownForFeishu(finalText))
        }
        await this.sendGeneratedImages(target, snapshot)
        return
      }

      if (Date.now() - startedAt >= FEISHU_CONVERSATION_POLL_TIMEOUT_MS) {
        if (!this.isCurrentRun(runId)) {
          return
        }
        const timeoutText = 'The current conversation timed out before finishing. Please try again.'
        if (deliveryState) {
          deliveryState = await this.syncDeliverySegments(
            target,
            endpointKey,
            deliveryState,
            this.appendTerminalDeliverySegment(deliverySegments, sourceMessageId, timeoutText)
          )
          this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
        } else {
          await this.deps.client.sendMarkdown(target, optimizeMarkdownForFeishu(timeoutText))
        }
        return
      }

      if (deliveryState && deliverySegments.length > 0) {
        deliveryState = await this.syncDeliverySegments(
          target,
          endpointKey,
          deliveryState,
          deliverySegments
        )
      }

      await sleep(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    }
  }

  private async deliverConversationWithStreamingCard(
    target: FeishuTransportTarget,
    execution: RemoteConversationExecution,
    runId: number,
    endpointKey: string,
    startedAt: number
  ): Promise<boolean> {
    let cardState: FeishuStreamingCardDeliveryState | null = null
    const closeAndFinish = async (): Promise<boolean> => {
      try {
        cardState = await this.closeStreamingCardIfNeeded(cardState)
      } catch (error) {
        console.warn('[FeishuRuntime] Failed to close streaming card before exit:', {
          cardId: cardState?.cardId,
          error: safeErrorMessage(error)
        })
      }
      return true
    }

    try {
      while (this.isCurrentRun(runId)) {
        const snapshot = await execution.getSnapshot()
        if (!this.isCurrentRun(runId)) {
          return await closeAndFinish()
        }

        const sourceMessageId = snapshot.messageId ?? execution.eventId ?? null
        let deliverySegments = this.getSnapshotDeliverySegments(snapshot, sourceMessageId)

        if (snapshot.completed) {
          if (snapshot.pendingInteraction) {
            const pendingText = this.buildStreamingCardText(deliverySegments)
            if (pendingText) {
              cardState = await this.syncStreamingCardText(target, cardState, pendingText)
            }
            cardState = await this.closeStreamingCardIfNeeded(cardState)
            await this.dispatchOutboundActions(
              target,
              [
                {
                  type: 'sendCard',
                  card: buildFeishuPendingInteractionCard(snapshot.pendingInteraction),
                  fallbackText: buildFeishuPendingInteractionText(snapshot.pendingInteraction)
                }
              ],
              runId
            )
            this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
            return true
          }

          const finalText = this.getFinalDeliveryText(snapshot)
          deliverySegments = this.appendTerminalDeliverySegment(
            deliverySegments,
            sourceMessageId,
            finalText
          )
          const completedText = this.buildStreamingCardText(deliverySegments) || finalText.trim()
          if (completedText) {
            cardState = await this.syncStreamingCardText(target, cardState, completedText)
          }
          cardState = await this.closeStreamingCardIfNeeded(cardState)
          this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
          await this.sendGeneratedImages(target, snapshot)
          return true
        }

        if (Date.now() - startedAt >= FEISHU_CONVERSATION_POLL_TIMEOUT_MS) {
          if (!this.isCurrentRun(runId)) {
            return await closeAndFinish()
          }
          const timeoutText =
            'The current conversation timed out before finishing. Please try again.'
          const timeoutSegments = this.appendTerminalDeliverySegment(
            deliverySegments,
            sourceMessageId,
            timeoutText
          )
          cardState = await this.syncStreamingCardText(
            target,
            cardState,
            this.buildStreamingCardText(timeoutSegments) || timeoutText
          )
          cardState = await this.closeStreamingCardIfNeeded(cardState)
          this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
          return true
        }

        const streamingText = this.buildStreamingCardText(deliverySegments, snapshot.statusText)
        if (streamingText) {
          cardState = await this.syncStreamingCardText(target, cardState, streamingText)
        }

        await sleep(TELEGRAM_STREAM_POLL_INTERVAL_MS)
      }

      return await closeAndFinish()
    } catch (error) {
      console.warn('[FeishuRuntime] Streaming card delivery failed, falling back to markdown:', {
        chatId: target.chatId,
        threadId: target.threadId,
        replyToMessageId: target.replyToMessageId,
        error: safeErrorMessage(error)
      })
      if (this.isCurrentRun(runId)) {
        try {
          await this.deps.client.sendText(target, FEISHU_STREAMING_CARD_FALLBACK_NOTICE)
        } catch (noticeError) {
          console.warn('[FeishuRuntime] Failed to send streaming card fallback notice:', {
            chatId: target.chatId,
            threadId: target.threadId,
            replyToMessageId: target.replyToMessageId,
            error: safeErrorMessage(noticeError)
          })
        }
      }
      return false
    }
  }

  private buildStreamingCardText(segments: RemoteDeliverySegment[], statusText?: string): string {
    const status = statusText?.trim() ?? ''
    const processText = segments
      .filter((segment) => segment.kind === 'process')
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join('\n\n')
    const answerText = segments
      .filter((segment) => segment.kind !== 'process')
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join('\n\n')

    return [
      status ? `**Status**\n${status}` : '',
      processText ? `**Process**\n${processText}` : '',
      answerText ? `**Answer**\n${answerText}` : ''
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim()
  }

  private async syncStreamingCardText(
    target: FeishuTransportTarget,
    state: FeishuStreamingCardDeliveryState | null,
    text: string
  ): Promise<FeishuStreamingCardDeliveryState> {
    const normalized = optimizeMarkdownForFeishu(text.trim())
    if (!normalized) {
      if (state) {
        return state
      }
      throw new Error('Feishu streaming card content is empty.')
    }

    const nextState = state ?? (await this.createStreamingCardState(target))
    if (nextState.lastText === normalized) {
      return nextState
    }

    const sequence = nextState.sequence + 1
    try {
      await this.deps.client.updateStreamingCardContent({
        cardId: nextState.cardId,
        elementId: nextState.elementId,
        content: normalized,
        sequence
      })
    } catch (error) {
      await this.closeStreamingCardAfterFailure(nextState, sequence + 1)
      throw error
    }

    return {
      ...nextState,
      sequence,
      lastText: normalized
    }
  }

  private async createStreamingCardState(
    target: FeishuTransportTarget
  ): Promise<FeishuStreamingCardDeliveryState> {
    const card = await this.deps.client.createStreamingCard('')
    const state: FeishuStreamingCardDeliveryState = {
      cardId: card.cardId,
      elementId: card.elementId,
      sequence: 0,
      lastText: '',
      closed: false
    }

    try {
      await this.deps.client.sendCardEntity(target, card.cardId)
    } catch (error) {
      await this.closeStreamingCardAfterFailure(state, state.sequence + 1)
      throw error
    }

    return state
  }

  private async closeStreamingCardIfNeeded(
    state: FeishuStreamingCardDeliveryState | null
  ): Promise<FeishuStreamingCardDeliveryState | null> {
    if (!state || state.closed) {
      return state
    }

    const sequence = state.sequence + 1
    await this.deps.client.closeStreamingCard(state.cardId, sequence)
    return {
      ...state,
      sequence,
      closed: true
    }
  }

  private async closeStreamingCardAfterFailure(
    state: FeishuStreamingCardDeliveryState,
    sequence: number
  ): Promise<void> {
    if (state.closed) {
      return
    }

    try {
      await this.deps.client.closeStreamingCard(state.cardId, sequence)
    } catch (error) {
      console.warn('[FeishuRuntime] Failed to close streaming card after failure:', {
        cardId: state.cardId,
        error: safeErrorMessage(error)
      })
    }
  }

  private getStoredDeliveryState(endpointKey: string): FeishuRemoteDeliveryState | null {
    const state = this.deps.bindingStore.getRemoteDeliveryState(endpointKey)
    if (!state) {
      return null
    }

    return {
      sourceMessageId: state.sourceMessageId,
      segments: state.segments.map((segment) => ({
        key: segment.key,
        kind: segment.kind,
        messageIds: segment.messageIds.filter(
          (messageId): messageId is string | null =>
            typeof messageId === 'string' || messageId === null
        ),
        lastText: segment.lastText
      }))
    }
  }

  private rememberDeliveryState(
    endpointKey: string,
    state: FeishuRemoteDeliveryState
  ): FeishuRemoteDeliveryState {
    this.deps.bindingStore.rememberRemoteDeliveryState(endpointKey, state)
    return state
  }

  private createDeliveryState(sourceMessageId: string): FeishuRemoteDeliveryState {
    return {
      sourceMessageId,
      segments: []
    }
  }

  private async prepareDeliveryStateForSource(
    endpointKey: string,
    sourceMessageId: string | null,
    state: FeishuRemoteDeliveryState | null
  ): Promise<FeishuRemoteDeliveryState | null> {
    if (!state) {
      return sourceMessageId ? this.createDeliveryState(sourceMessageId) : null
    }

    if (sourceMessageId && state.sourceMessageId === sourceMessageId) {
      return state
    }

    this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)

    if (!sourceMessageId) {
      return null
    }

    return this.createDeliveryState(sourceMessageId)
  }

  private getSnapshotDeliverySegments(
    snapshot: Awaited<ReturnType<RemoteConversationExecution['getSnapshot']>>,
    sourceMessageId: string | null
  ): RemoteDeliverySegment[] {
    if (snapshot.deliverySegments !== undefined) {
      return snapshot.deliverySegments.filter((segment) => segment.text.trim().length > 0)
    }

    if (!sourceMessageId) {
      return []
    }

    const segments: RemoteDeliverySegment[] = []
    const traceText = snapshot.traceText?.trim() || ''
    const answerText = snapshot.text?.trim() || ''

    if (traceText) {
      segments.push({
        key: `${sourceMessageId}:legacy:process`,
        kind: 'process',
        text: traceText,
        sourceMessageId
      })
    }

    if (answerText) {
      segments.push({
        key: `${sourceMessageId}:legacy:answer`,
        kind: 'answer',
        text: answerText,
        sourceMessageId
      })
    }

    return segments
  }

  private getFinalDeliveryText(
    snapshot: Awaited<ReturnType<RemoteConversationExecution['getSnapshot']>>
  ): string {
    const finalText = snapshot.finalText?.trim() ?? ''
    if (finalText) {
      return finalText
    }
    if ((snapshot.generatedImages?.length ?? 0) > 0) {
      return ''
    }
    return (snapshot.fullText ?? snapshot.text).trim()
  }

  private async sendGeneratedImages(
    target: FeishuTransportTarget,
    snapshot: Awaited<ReturnType<RemoteConversationExecution['getSnapshot']>>
  ): Promise<void> {
    for (const asset of snapshot.generatedImages ?? []) {
      try {
        await this.deps.client.sendImage(target, asset.path)
      } catch (error) {
        console.warn('[FeishuRuntime] Failed to send generated image:', {
          path: asset.path,
          error
        })
        await this.deps.client.sendText(
          target,
          '[Image] Delivery failed - see local copy in the app.'
        )
      }
    }
  }

  private appendTerminalDeliverySegment(
    segments: RemoteDeliverySegment[],
    sourceMessageId: string | null,
    finalText: string
  ): RemoteDeliverySegment[] {
    const normalized = finalText.trim()
    if (!sourceMessageId || !normalized) {
      return segments
    }

    const lastAnswerSegment = [...segments].reverse().find((segment) => segment.kind === 'answer')
    if (lastAnswerSegment?.text === normalized) {
      return segments
    }

    if (normalized === REMOTE_NO_RESPONSE_TEXT && segments.length > 0) {
      return segments
    }

    return [
      ...segments,
      {
        key: `${sourceMessageId}:terminal`,
        kind: 'terminal',
        text: normalized,
        sourceMessageId
      }
    ]
  }

  private isDeliveryStateCompatible(
    state: FeishuRemoteDeliveryState,
    segments: RemoteDeliverySegment[]
  ): boolean {
    if (segments.length < state.segments.length) {
      return false
    }

    return state.segments.every((segment, index) => segments[index]?.key === segment.key)
  }

  private async syncDeliverySegments(
    target: FeishuTransportTarget,
    endpointKey: string,
    state: FeishuRemoteDeliveryState,
    segments: RemoteDeliverySegment[]
  ): Promise<FeishuRemoteDeliveryState> {
    if (segments.length === 0) {
      return state
    }

    let nextState = state
    if (!this.isDeliveryStateCompatible(nextState, segments)) {
      this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
      nextState = this.createDeliveryState(state.sourceMessageId)
    }

    const syncedSegments: FeishuRemoteDeliveryState['segments'] = []

    for (const [index, segment] of segments.entries()) {
      const syncedSegment = await this.syncDeliverySegment(
        target,
        nextState.segments[index] ?? null,
        segment
      )
      syncedSegments.push(syncedSegment)
    }

    return this.rememberDeliveryState(endpointKey, {
      sourceMessageId: nextState.sourceMessageId,
      segments: syncedSegments
    })
  }

  private async syncDeliverySegment(
    target: FeishuTransportTarget,
    existing: FeishuRemoteDeliveryState['segments'][number] | null,
    segment: RemoteDeliverySegment
  ): Promise<FeishuRemoteDeliveryState['segments'][number]> {
    const normalized = segment.text.trim()
    const optimized = optimizeMarkdownForFeishu(normalized)
    const nextChunks = chunkFeishuText(optimized)

    if (!existing) {
      const messageIds: Array<string | null> = []
      for (const chunk of nextChunks) {
        const messageId = await this.deps.client.sendMarkdown(target, chunk)
        messageIds.push(messageId ?? null)
      }

      return {
        key: segment.key,
        kind: segment.kind,
        messageIds,
        lastText: normalized
      }
    }

    const previousChunks = existing.lastText
      ? chunkFeishuText(optimizeMarkdownForFeishu(existing.lastText))
      : []
    if (
      nextChunks.length < existing.messageIds.length ||
      previousChunks.length < existing.messageIds.length ||
      previousChunks
        .slice(0, Math.max(0, existing.messageIds.length - 1))
        .some((chunk, index) => chunk !== nextChunks[index])
    ) {
      const messageIds: Array<string | null> = []
      for (const chunk of nextChunks) {
        const messageId = await this.deps.client.sendMarkdown(target, chunk)
        messageIds.push(messageId ?? null)
      }

      return {
        key: segment.key,
        kind: segment.kind,
        messageIds,
        lastText: normalized
      }
    }

    const messageIds = [...existing.messageIds]
    const editableIndex = Math.max(0, messageIds.length - 1)
    const retainedCount = Math.min(messageIds.length, nextChunks.length)

    for (let index = editableIndex; index < retainedCount; index += 1) {
      if (previousChunks[index] === nextChunks[index]) {
        continue
      }

      const messageId = messageIds[index]
      if (!messageId) {
        continue
      }

      await this.deps.client.updateMarkdown(messageId, nextChunks[index])
    }

    for (let index = messageIds.length; index < nextChunks.length; index += 1) {
      const messageId = await this.deps.client.sendMarkdown(target, nextChunks[index])
      messageIds.push(messageId ?? null)
    }

    return {
      key: segment.key,
      kind: segment.kind,
      messageIds,
      lastText: normalized
    }
  }

  private setBotUser(botUser: FeishuBotIdentity): void {
    this.setStatus({
      botUser: {
        openId: botUser.openId,
        name: botUser.name
      }
    })
  }

  private async dispatchOutboundActions(
    target: FeishuTransportTarget,
    actions: FeishuOutboundAction[],
    runId: number
  ): Promise<void> {
    for (const action of actions) {
      if (!this.isCurrentRun(runId)) {
        return
      }

      if (action.type === 'sendText') {
        await this.deps.client.sendMarkdown(target, optimizeMarkdownForFeishu(action.text))
        continue
      }

      try {
        await this.deps.client.sendCard(target, action.card)
      } catch (error) {
        console.warn(
          '[FeishuRuntime] Failed to send interactive card, falling back to text:',
          safeErrorMessage(error)
        )
        await this.deps.client.sendMarkdown(target, optimizeMarkdownForFeishu(action.fallbackText))
      }
    }
  }

  private async setThinkingReaction(messageId: string): Promise<string> {
    return await this.deps.client.addReaction(messageId, FEISHU_REMOTE_REACTION_EMOJI)
  }

  private async clearThinkingReaction(messageId: string, reactionId: string): Promise<void> {
    await this.deps.client.removeReaction(messageId, reactionId)
  }

  private setStatus(
    patch: Partial<FeishuRuntimeStatusSnapshot> & {
      state?: FeishuRuntimeStatusSnapshot['state']
    }
  ): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...patch
    }
    this.deps.onStatusChange?.(this.getStatusSnapshot())

    if (patch.state === 'error' && patch.lastError) {
      this.deps.onFatalError?.(patch.lastError)
    }
  }
}
