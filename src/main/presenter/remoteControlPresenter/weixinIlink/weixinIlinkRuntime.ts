import {
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  buildWeixinIlinkEndpointKey,
  type RemoteDeliverySegment,
  type WeixinIlinkInboundMessage,
  type WeixinIlinkRuntimeStatusSnapshot
} from '../types'
import { RemoteBindingStore } from '../services/remoteBindingStore'
import type { RemoteConversationExecution } from '../services/remoteConversationRunner'
import type { WeixinIlinkCommandRouteResult } from '../services/weixinIlinkCommandRouter'
import { WeixinIlinkCommandRouter } from '../services/weixinIlinkCommandRouter'
import { REMOTE_NO_RESPONSE_TEXT } from '../services/remoteBlockRenderer'
import {
  WeixinIlinkApiError,
  WeixinIlinkClient,
  type WeixinIlinkGetUpdatesResponse
} from './weixinIlinkClient'
import { WeixinIlinkParser } from './weixinIlinkParser'

const WEIXIN_SESSION_EXPIRED_ERRCODE = -14
const WEIXIN_INBOUND_DEDUP_LIMIT = 500
const WEIXIN_INBOUND_DEDUP_TTL_MS = 10 * 60 * 1000
const WEIXIN_INTERNAL_ERROR_REPLY = 'An internal error occurred while processing your request.'
const WEIXIN_LOG_TEXT_PREVIEW_LIMIT = 120
const WEIXIN_TRACE_LOG_ENABLED = process.env.DEEPCHAT_WEIXIN_TRACE === '1'

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type WeixinIlinkRuntimeDeps = {
  accountId: string
  ownerUserId: string
  baseUrl: string
  client: WeixinIlinkClient
  parser: WeixinIlinkParser
  router: WeixinIlinkCommandRouter
  bindingStore: RemoteBindingStore
  logger?: {
    info?: (...params: unknown[]) => void
    warn?: (...params: unknown[]) => void
    error: (...params: unknown[]) => void
  }
  onStatusChange?: (snapshot: WeixinIlinkRuntimeStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

type WeixinIlinkProcessedInboundEntry = {
  receivedAt: number
}

type WeixinIlinkSendContext = {
  userId: string
  contextToken: string | null
}

type WeixinIlinkRemoteDeliveryState = {
  sourceMessageId: string
  segments: Array<{
    key: string
    kind: 'process' | 'answer' | 'terminal'
    messageIds: Array<string | null>
    lastText: string
  }>
}

const isFatalWeixinError = (error: unknown): boolean =>
  error instanceof WeixinIlinkApiError &&
  ((typeof error.status === 'number' && [401, 403].includes(error.status)) ||
    error.errcode === WEIXIN_SESSION_EXPIRED_ERRCODE)

export class WeixinIlinkRuntime {
  private runId = 0
  private started = false
  private stopRequested = false
  private readonly processedInboundByMessage = new Map<string, WeixinIlinkProcessedInboundEntry>()
  private readonly endpointOperations = new Map<string, Promise<void>>()
  private statusSnapshot: WeixinIlinkRuntimeStatusSnapshot

  constructor(private readonly deps: WeixinIlinkRuntimeDeps) {
    this.statusSnapshot = {
      state: 'stopped',
      lastError: null,
      botUser: {
        accountId: deps.accountId,
        ownerUserId: deps.ownerUserId,
        baseUrl: deps.baseUrl
      }
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      this.logInfo('Skipped runtime start because it is already running.', {
        accountId: this.deps.accountId,
        runId: this.runId
      })
      return
    }

    this.runId += 1
    this.started = true
    this.stopRequested = false
    this.logInfo('Starting Weixin iLink runtime.', {
      accountId: this.deps.accountId,
      ownerUserId: this.deps.ownerUserId,
      runId: this.runId
    })
    this.setStatus({
      state: 'starting',
      lastError: null
    })

    void this.runLoop(this.runId)
  }

  async stop(): Promise<void> {
    this.logInfo('Stopping Weixin iLink runtime.', {
      accountId: this.deps.accountId,
      runId: this.runId
    })
    this.stopRequested = true
    this.started = false
    this.runId += 1
    this.endpointOperations.clear()
    this.processedInboundByMessage.clear()
    this.setStatus({
      state: 'stopped',
      lastError: null
    })
  }

  getStatusSnapshot(): WeixinIlinkRuntimeStatusSnapshot {
    return {
      ...this.statusSnapshot,
      botUser: this.statusSnapshot.botUser ? { ...this.statusSnapshot.botUser } : null
    }
  }

  private async runLoop(runId: number): Promise<void> {
    let backoffMs = 1_000
    while (this.isCurrentRun(runId)) {
      try {
        const account = this.deps.bindingStore.getWeixinIlinkAccount(this.deps.accountId)
        const cursor = account?.syncCursor ?? ''
        const response = await this.deps.client.getUpdates(cursor)
        if (!this.isCurrentRun(runId)) {
          return
        }

        const fatalError = this.extractFatalResponseError(response)
        if (fatalError) {
          this.setStatus({
            state: 'error',
            lastError: fatalError
          })
          this.deps.onFatalError?.(fatalError)
          this.started = false
          return
        }

        if ((response.ret ?? 0) !== 0) {
          const message = response.errmsg?.trim() || 'Weixin iLink long poll failed.'
          this.setStatus({
            state: 'backoff',
            lastError: message
          })
          await sleep(backoffMs)
          backoffMs = Math.min(backoffMs * 2, 30_000)
          continue
        }

        backoffMs = 1_000
        this.setStatus({
          state: 'running',
          lastError: null
        })

        const nextCursor = response.get_updates_buf?.trim()
        if (nextCursor !== undefined && nextCursor !== cursor) {
          this.deps.bindingStore.updateWeixinIlinkAccount(this.deps.accountId, (current) => ({
            ...current,
            syncCursor: nextCursor
          }))
        }

        for (const rawMessage of response.msgs ?? []) {
          if (!this.isCurrentRun(runId)) {
            return
          }

          const parsed = this.deps.parser.parseMessage(this.deps.accountId, rawMessage)
          if (!parsed || this.rememberInboundMessage(parsed)) {
            continue
          }

          this.logInfo('Accepted inbound Weixin iLink message.', {
            accountId: parsed.accountId,
            userId: parsed.userId,
            messageId: parsed.messageId,
            endpointKey: buildWeixinIlinkEndpointKey(parsed.accountId, parsed.userId),
            command: parsed.command?.name ?? null,
            hasContextToken: Boolean(parsed.contextToken),
            textLength: parsed.text.length,
            textPreview: this.getTextPreview(parsed.text)
          })

          const endpointKey = buildWeixinIlinkEndpointKey(parsed.accountId, parsed.userId)
          if (parsed.command?.name === 'stop') {
            await this.processInboundMessage(parsed, runId)
            continue
          }

          this.enqueueEndpointOperation(endpointKey, runId, async () => {
            await this.processInboundMessage(parsed, runId)
          })
        }
      } catch (error) {
        if (!this.isCurrentRun(runId)) {
          return
        }

        const lastError = error instanceof Error ? error.message : String(error)
        if (isFatalWeixinError(error)) {
          this.setStatus({
            state: 'error',
            lastError
          })
          this.deps.onFatalError?.(lastError)
          this.started = false
          return
        }

        this.setStatus({
          state: 'backoff',
          lastError
        })
        await sleep(backoffMs)
        backoffMs = Math.min(backoffMs * 2, 30_000)
      }
    }
  }

  private extractFatalResponseError(response: WeixinIlinkGetUpdatesResponse): string | null {
    if (response.errcode === WEIXIN_SESSION_EXPIRED_ERRCODE) {
      return response.errmsg?.trim() || 'The Weixin iLink session expired. Please log in again.'
    }

    return null
  }

  private isCurrentRun(runId: number): boolean {
    return this.runId === runId && this.started && !this.stopRequested
  }

  private rememberInboundMessage(message: WeixinIlinkInboundMessage): boolean {
    const now = Date.now()
    this.pruneProcessedInbound(now)

    const messageKey = `${message.accountId}:${message.userId}:${message.messageId}`
    if (this.processedInboundByMessage.has(messageKey)) {
      this.logInfo('Dropped duplicate inbound Weixin iLink message.', {
        accountId: message.accountId,
        userId: message.userId,
        messageId: message.messageId,
        messageKey
      })
      return true
    }

    this.processedInboundByMessage.set(messageKey, {
      receivedAt: now
    })

    while (this.processedInboundByMessage.size > WEIXIN_INBOUND_DEDUP_LIMIT) {
      const oldestKey = this.processedInboundByMessage.keys().next().value
      if (!oldestKey) {
        break
      }
      this.processedInboundByMessage.delete(oldestKey)
    }

    return false
  }

  private pruneProcessedInbound(now: number): void {
    for (const [messageKey, entry] of this.processedInboundByMessage.entries()) {
      if (now - entry.receivedAt <= WEIXIN_INBOUND_DEDUP_TTL_MS) {
        break
      }
      this.processedInboundByMessage.delete(messageKey)
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

  private async processInboundMessage(
    message: WeixinIlinkInboundMessage,
    runId: number
  ): Promise<void> {
    if (!this.isCurrentRun(runId)) {
      return
    }

    const sendContext: WeixinIlinkSendContext = {
      userId: message.userId,
      contextToken: message.contextToken
    }

    try {
      const routed = await this.deps.router.handleMessage(message)
      if (!this.isCurrentRun(runId)) {
        return
      }

      this.logInfo('Resolved inbound Weixin iLink route.', {
        accountId: message.accountId,
        userId: message.userId,
        messageId: message.messageId,
        command: message.command?.name ?? null,
        repliesCount: routed.replies.length,
        hasConversation: Boolean(routed.conversation)
      })

      await this.dispatchRouteResult(message, sendContext, routed, runId)
    } catch (error) {
      if (this.deps.logger?.error) {
        this.deps.logger.error(error, {
          accountId: message.accountId,
          userId: message.userId,
          messageId: message.messageId
        })
      }

      if (!this.isCurrentRun(runId)) {
        return
      }

      await this.sendText(sendContext, WEIXIN_INTERNAL_ERROR_REPLY).catch(() => undefined)
    }
  }

  private async dispatchRouteResult(
    message: WeixinIlinkInboundMessage,
    sendContext: WeixinIlinkSendContext,
    routed: WeixinIlinkCommandRouteResult,
    runId: number
  ): Promise<void> {
    for (const reply of routed.replies) {
      if (!this.isCurrentRun(runId)) {
        return
      }

      await this.sendText(sendContext, reply, 'reply', {
        accountId: message.accountId,
        userId: message.userId,
        inboundMessageId: message.messageId
      })
    }

    if (!routed.conversation) {
      return
    }

    await this.deliverConversation(message, sendContext, routed.conversation, runId)
  }

  private async deliverConversation(
    message: WeixinIlinkInboundMessage,
    sendContext: WeixinIlinkSendContext,
    execution: RemoteConversationExecution,
    runId: number
  ): Promise<void> {
    const startedAt = Date.now()
    const endpointKey = buildWeixinIlinkEndpointKey(message.accountId, message.userId)

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
        const finalText = this.getFinalDeliveryText(snapshot)
        deliverySegments = this.appendTerminalDeliverySegment(
          deliverySegments,
          sourceMessageId,
          finalText
        )

        if (deliveryState && deliverySegments.length > 0) {
          await this.syncDeliverySegments(deliveryState, endpointKey, sendContext, deliverySegments)
        } else if (finalText.trim()) {
          this.logInfo('Sending Weixin iLink final fallback text without delivery state.', {
            accountId: message.accountId,
            userId: message.userId,
            inboundMessageId: message.messageId,
            endpointKey,
            sourceMessageId,
            textLength: finalText.trim().length,
            textPreview: this.getTextPreview(finalText)
          })
          await this.sendText(sendContext, finalText, 'final-fallback', {
            accountId: message.accountId,
            userId: message.userId,
            inboundMessageId: message.messageId,
            endpointKey,
            sourceMessageId
          })
        }

        this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
        return
      }

      if (deliveryState && deliverySegments.length > 0) {
        await this.syncDeliverySegments(deliveryState, endpointKey, sendContext, deliverySegments)
      }

      if (Date.now() - startedAt >= 5 * 60_000) {
        return
      }

      await sleep(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    }
  }

  private createDeliveryState(sourceMessageId: string): WeixinIlinkRemoteDeliveryState {
    return {
      sourceMessageId,
      segments: []
    }
  }

  private getStoredDeliveryState(endpointKey: string): WeixinIlinkRemoteDeliveryState | null {
    const state = this.deps.bindingStore.getRemoteDeliveryState(endpointKey)
    if (!state) {
      return null
    }

    return {
      sourceMessageId: state.sourceMessageId,
      segments: state.segments.map((segment) => ({
        key: segment.key,
        kind: segment.kind,
        messageIds: segment.messageIds.map((messageId) =>
          messageId === null ? null : String(messageId)
        ),
        lastText: segment.lastText
      }))
    }
  }

  private async prepareDeliveryStateForSource(
    endpointKey: string,
    sourceMessageId: string | null,
    state: WeixinIlinkRemoteDeliveryState | null
  ): Promise<WeixinIlinkRemoteDeliveryState | null> {
    if (!sourceMessageId) {
      return state
    }

    if (!state || state.sourceMessageId === sourceMessageId) {
      return state
    }

    this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
    return null
  }

  private getSnapshotDeliverySegments(
    snapshot: Awaited<ReturnType<RemoteConversationExecution['getSnapshot']>>,
    sourceMessageId: string | null
  ): RemoteDeliverySegment[] {
    if (snapshot.deliverySegments && snapshot.deliverySegments.length > 0) {
      return snapshot.deliverySegments
    }

    if (!snapshot.text.trim()) {
      return []
    }

    return [
      {
        key: `${sourceMessageId ?? 'unknown'}:${snapshot.completed ? 'terminal' : 'answer'}`,
        kind: snapshot.completed ? 'terminal' : 'answer',
        text: snapshot.text,
        sourceMessageId: sourceMessageId ?? 'unknown'
      }
    ]
  }

  private appendTerminalDeliverySegment(
    segments: RemoteDeliverySegment[],
    sourceMessageId: string | null,
    finalText: string
  ): RemoteDeliverySegment[] {
    const normalized = finalText.trim()
    if (!normalized) {
      return segments
    }

    const lastAnswerSegment = [...segments].reverse().find((segment) => segment.kind === 'answer')
    if (lastAnswerSegment?.text.trim() === normalized) {
      this.logInfo('Skipped duplicate terminal delivery segment for Weixin iLink.', {
        accountId: this.deps.accountId,
        sourceMessageId,
        answerSegmentKey: lastAnswerSegment.key,
        textLength: normalized.length,
        textPreview: this.getTextPreview(normalized)
      })
      return segments
    }

    if (normalized === REMOTE_NO_RESPONSE_TEXT && segments.length > 0) {
      this.logInfo('Skipped terminal no-response segment because prior segments already exist.', {
        accountId: this.deps.accountId,
        sourceMessageId
      })
      return segments
    }

    const terminalKey = `${sourceMessageId ?? 'unknown'}:terminal`
    if (segments.some((segment) => segment.key === terminalKey)) {
      return segments
    }

    return [
      ...segments,
      {
        key: terminalKey,
        kind: 'terminal',
        text: normalized,
        sourceMessageId: sourceMessageId ?? 'unknown'
      }
    ]
  }

  private getFinalDeliveryText(
    snapshot: Awaited<ReturnType<RemoteConversationExecution['getSnapshot']>>
  ): string {
    return (
      snapshot.finalText?.trim() ||
      snapshot.fullText?.trim() ||
      snapshot.text.trim() ||
      REMOTE_NO_RESPONSE_TEXT
    )
  }

  private async syncDeliverySegments(
    deliveryState: WeixinIlinkRemoteDeliveryState,
    endpointKey: string,
    sendContext: WeixinIlinkSendContext,
    segments: RemoteDeliverySegment[]
  ): Promise<WeixinIlinkRemoteDeliveryState> {
    let changed = false
    const nextSegments = [...deliveryState.segments]

    for (const segment of segments) {
      const existing = nextSegments.find((item) => item.key === segment.key)
      const nextText = segment.text.trim()
      if (!nextText || existing?.lastText === nextText) {
        continue
      }

      this.logInfo('Sending Weixin iLink delivery segment.', {
        accountId: this.deps.accountId,
        endpointKey,
        sourceMessageId: deliveryState.sourceMessageId,
        segmentKey: segment.key,
        segmentKind: segment.kind,
        textLength: nextText.length,
        textPreview: this.getTextPreview(nextText),
        previousTextLength: existing?.lastText.length ?? 0
      })

      await this.sendText(sendContext, nextText, `delivery:${segment.kind}`, {
        accountId: this.deps.accountId,
        endpointKey,
        sourceMessageId: deliveryState.sourceMessageId,
        segmentKey: segment.key,
        segmentKind: segment.kind
      })
      changed = true
      if (existing) {
        existing.lastText = nextText
        existing.messageIds = [...existing.messageIds, null]
      } else {
        nextSegments.push({
          key: segment.key,
          kind: segment.kind,
          messageIds: [null],
          lastText: nextText
        })
      }
    }

    const nextState: WeixinIlinkRemoteDeliveryState = {
      sourceMessageId: deliveryState.sourceMessageId,
      segments: nextSegments
    }

    if (changed) {
      this.deps.bindingStore.rememberRemoteDeliveryState(endpointKey, {
        sourceMessageId: nextState.sourceMessageId,
        segments: nextState.segments.map((segment) => ({
          key: segment.key,
          kind: segment.kind,
          messageIds: [...segment.messageIds],
          lastText: segment.lastText
        }))
      })
    }

    return nextState
  }

  private async sendText(
    sendContext: WeixinIlinkSendContext,
    text: string,
    reason: string = 'message',
    context?: Record<string, unknown>
  ): Promise<void> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      return
    }

    this.logInfo('Sending Weixin iLink text message.', {
      accountId: this.deps.accountId,
      toUserId: sendContext.userId,
      hasContextToken: Boolean(sendContext.contextToken),
      reason,
      textLength: normalizedText.length,
      textPreview: this.getTextPreview(normalizedText),
      ...context
    })

    await this.deps.client.sendTextMessage({
      toUserId: sendContext.userId,
      text: normalizedText,
      contextToken: sendContext.contextToken
    })
  }

  private getTextPreview(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (normalized.length <= WEIXIN_LOG_TEXT_PREVIEW_LIMIT) {
      return normalized
    }

    return `${normalized.slice(0, WEIXIN_LOG_TEXT_PREVIEW_LIMIT)}...`
  }

  private logInfo(message: string, context?: Record<string, unknown>): void {
    if (!WEIXIN_TRACE_LOG_ENABLED) {
      return
    }

    this.deps.logger?.info?.(`[WeixinIlinkRuntime] ${message}`, context)
  }

  private setStatus(next: Partial<WeixinIlinkRuntimeStatusSnapshot>): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...next,
      botUser: this.statusSnapshot.botUser
        ? { ...this.statusSnapshot.botUser }
        : {
            accountId: this.deps.accountId,
            ownerUserId: this.deps.ownerUserId,
            baseUrl: this.deps.baseUrl
          }
    }
    this.deps.onStatusChange?.(this.getStatusSnapshot())
  }
}
