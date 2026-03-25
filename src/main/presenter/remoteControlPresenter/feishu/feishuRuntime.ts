import {
  FEISHU_INBOUND_DEDUP_LIMIT,
  FEISHU_INBOUND_DEDUP_TTL_MS,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  buildFeishuEndpointKey,
  type FeishuInboundMessage,
  type FeishuRuntimeStatusSnapshot,
  type FeishuTransportTarget
} from '../types'
import { FeishuCommandRouter } from '../services/feishuCommandRouter'
import type { RemoteConversationExecution } from '../services/remoteConversationRunner'
import { FeishuClient, type FeishuBotIdentity } from './feishuClient'
import { FeishuParser } from './feishuParser'

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type FeishuRuntimeDeps = {
  client: FeishuClient
  parser: FeishuParser
  router: FeishuCommandRouter
  onStatusChange?: (snapshot: FeishuRuntimeStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

type FeishuProcessedInboundEntry = {
  receivedAt: number
  eventId: string | null
}

export class FeishuRuntime {
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

    this.started = true
    this.stopRequested = false
    this.setStatus({
      state: 'starting',
      lastError: null
    })

    try {
      const botUser = await this.deps.client.probeBot()
      this.setBotUser(botUser)
      await this.deps.client.startMessageStream({
        onMessage: async (event) => {
          try {
            this.acceptRawMessage(event)
          } catch (error) {
            console.warn('[FeishuRuntime] Failed to enqueue event:', error)
          }
        }
      })
      this.setStatus({
        state: 'running',
        lastError: null
      })
    } catch (error) {
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

  private acceptRawMessage(event: Parameters<FeishuParser['parseEvent']>[0]): void {
    if (this.stopRequested || !this.started) {
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
      void this.processInboundMessage(parsed)
      return
    }

    this.enqueueEndpointOperation(endpointKey, async () => {
      await this.processInboundMessage(parsed)
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

  private enqueueEndpointOperation(endpointKey: string, operation: () => Promise<void>): void {
    const previous = this.endpointOperations.get(endpointKey) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.stopRequested || !this.started) {
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

  private async processInboundMessage(parsed: FeishuInboundMessage): Promise<void> {
    if (this.stopRequested || !this.started) {
      return
    }

    const target: FeishuTransportTarget = {
      chatId: parsed.chatId,
      threadId: parsed.threadId,
      replyToMessageId: parsed.messageId
    }

    try {
      const routed = await this.deps.router.handleMessage(parsed)
      if (this.stopRequested || !this.started) {
        return
      }

      for (const reply of routed.replies) {
        await this.deps.client.sendText(target, reply)
      }

      if (routed.conversation) {
        await this.deliverConversation(target, routed.conversation)
      }
    } catch (error) {
      console.warn('[FeishuRuntime] Failed to handle event:', {
        chatId: parsed.chatId,
        threadId: parsed.threadId,
        messageId: parsed.messageId,
        eventId: parsed.eventId,
        error
      })

      if (this.stopRequested || !this.started) {
        return
      }

      try {
        await this.deps.client.sendText(
          target,
          error instanceof Error ? error.message : String(error)
        )
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
    execution: RemoteConversationExecution
  ): Promise<void> {
    while (!this.stopRequested) {
      const snapshot = await execution.getSnapshot()
      if (snapshot.completed) {
        await this.deps.client.sendText(target, snapshot.text)
        return
      }

      await sleep(TELEGRAM_STREAM_POLL_INTERVAL_MS)
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
