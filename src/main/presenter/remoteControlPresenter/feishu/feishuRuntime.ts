import {
  FEISHU_CONVERSATION_POLL_TIMEOUT_MS,
  FEISHU_INBOUND_DEDUP_LIMIT,
  FEISHU_INBOUND_DEDUP_TTL_MS,
  FEISHU_OUTBOUND_TEXT_LIMIT,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  buildFeishuEndpointKey,
  type FeishuInboundMessage,
  type FeishuOutboundAction,
  type RemoteRenderableBlock,
  type FeishuRuntimeStatusSnapshot,
  type FeishuTransportTarget
} from '../types'
import { FeishuCommandRouter } from '../services/feishuCommandRouter'
import type { RemoteConversationExecution } from '../services/remoteConversationRunner'
import {
  buildFeishuPendingInteractionCard,
  buildFeishuPendingInteractionText
} from './feishuInteractionPrompt'
import { chunkFeishuText, FeishuClient, type FeishuBotIdentity } from './feishuClient'
import { FeishuParser } from './feishuParser'

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const FEISHU_INTERNAL_ERROR_REPLY = 'An internal error occurred while processing your request.'

type FeishuRuntimeDeps = {
  client: FeishuClient
  parser: FeishuParser
  router: FeishuCommandRouter
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

    const target: FeishuTransportTarget = {
      chatId: parsed.chatId,
      threadId: parsed.threadId,
      replyToMessageId: parsed.messageId
    }

    try {
      const routed = await this.deps.router.handleMessage(parsed)
      if (!this.isCurrentRun(runId)) {
        return
      }

      for (const reply of routed.replies) {
        if (!this.isCurrentRun(runId)) {
          return
        }
        await this.deps.client.sendText(target, reply)
      }

      if (routed.outboundActions?.length) {
        await this.dispatchOutboundActions(target, routed.outboundActions, runId)
      }

      if (routed.conversation) {
        await this.deliverConversation(target, routed.conversation, runId)
      }
    } catch (error) {
      const diagnostics = {
        runId,
        target,
        chatId: parsed.chatId,
        threadId: parsed.threadId,
        messageId: parsed.messageId,
        eventId: parsed.eventId
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
          messageId: parsed.messageId,
          eventId: parsed.eventId,
          error: sendError
        })
      }
    }
  }

  private async deliverConversation(
    target: FeishuTransportTarget,
    execution: RemoteConversationExecution,
    runId: number
  ): Promise<void> {
    const startedAt = Date.now()
    let lastDeliveredBlockCount = 0

    while (this.isCurrentRun(runId)) {
      const snapshot = await execution.getSnapshot()
      if (!this.isCurrentRun(runId)) {
        return
      }
      const renderBlocks = snapshot.renderBlocks ?? []
      const fullText = snapshot.fullText ?? snapshot.text

      lastDeliveredBlockCount = await this.sendRenderableBlocks(
        target,
        renderBlocks,
        lastDeliveredBlockCount
      )

      if (snapshot.completed) {
        if (!this.isCurrentRun(runId)) {
          return
        }
        if (renderBlocks.length === 0 && fullText.trim()) {
          await this.deps.client.sendText(target, fullText)
        }
        if (snapshot.pendingInteraction) {
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
        return
      }

      if (Date.now() - startedAt >= FEISHU_CONVERSATION_POLL_TIMEOUT_MS) {
        if (!this.isCurrentRun(runId)) {
          return
        }
        await this.deps.client.sendText(
          target,
          'The current conversation timed out before finishing. Please try again.'
        )
        return
      }

      await sleep(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    }
  }

  private async sendRenderableBlocks(
    target: FeishuTransportTarget,
    renderBlocks: RemoteRenderableBlock[],
    lastDeliveredBlockCount: number
  ): Promise<number> {
    for (const block of renderBlocks.slice(lastDeliveredBlockCount)) {
      await this.sendRenderableBlock(target, block)
    }

    return renderBlocks.length
  }

  private async sendRenderableBlock(
    target: FeishuTransportTarget,
    block: RemoteRenderableBlock
  ): Promise<void> {
    const chunks = chunkFeishuText(block.text, FEISHU_OUTBOUND_TEXT_LIMIT - 48)
    if (chunks.length <= 1) {
      await this.deps.client.sendText(target, block.text)
      return
    }

    const label = this.getRenderableBlockLabel(block)
    for (const [index, chunk] of chunks.entries()) {
      const text =
        index === 0 ? chunk : `[${label} continued ${index + 1}/${chunks.length}]\n${chunk}`
      await this.deps.client.sendText(target, text)
    }
  }

  private getRenderableBlockLabel(block: RemoteRenderableBlock): string {
    switch (block.kind) {
      case 'toolCall':
        return 'Tool Call'
      case 'toolResult':
        return 'Tool Result'
      case 'imageNotice':
        return 'Image Notice'
      case 'answer':
        return 'Answer'
      case 'reasoning':
        return 'Reasoning'
      case 'search':
        return 'Search'
      case 'error':
        return 'Error'
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
        await this.deps.client.sendText(target, action.text)
        continue
      }

      try {
        await this.deps.client.sendCard(target, action.card)
      } catch (error) {
        console.warn(
          '[FeishuRuntime] Failed to send interactive card, falling back to text:',
          error
        )
        await this.deps.client.sendText(target, action.fallbackText)
      }
    }
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
