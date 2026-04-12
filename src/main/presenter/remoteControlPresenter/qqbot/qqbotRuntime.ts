import {
  FEISHU_CONVERSATION_POLL_TIMEOUT_MS,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  buildQQBotEndpointKey,
  type RemoteDeliverySegment,
  type QQBotInboundMessage,
  type QQBotRuntimeStatusSnapshot,
  type QQBotTransportTarget
} from '../types'
import { RemoteBindingStore } from '../services/remoteBindingStore'
import type { QQBotCommandRouteResult } from '../services/qqbotCommandRouter'
import { QQBotCommandRouter } from '../services/qqbotCommandRouter'
import type { RemoteConversationExecution } from '../services/remoteConversationRunner'
import { REMOTE_NO_RESPONSE_TEXT } from '../services/remoteBlockRenderer'
import { buildFeishuPendingInteractionText } from '../feishu/feishuInteractionPrompt'
import { QQBotClient } from './qqbotClient'
import { QQBotGatewaySession, type QQBotGatewayBotUser } from './qqbotGatewaySession'
import { QQBotParser } from './qqbotParser'

const QQBOT_INBOUND_DEDUP_LIMIT = 500
const QQBOT_INBOUND_DEDUP_TTL_MS = 10 * 60 * 1000
const QQBOT_MAX_PASSIVE_REPLIES = 5
const QQBOT_INTERNAL_ERROR_REPLY = 'An internal error occurred while processing your request.'

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type QQBotRuntimeDeps = {
  client: QQBotClient
  parser: QQBotParser
  router: QQBotCommandRouter
  bindingStore: RemoteBindingStore
  logger?: {
    error: (...params: unknown[]) => void
  }
  onStatusChange?: (snapshot: QQBotRuntimeStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

type QQBotProcessedInboundEntry = {
  receivedAt: number
}

type QQBotRemoteDeliveryState = {
  sourceMessageId: string
  segments: Array<{
    key: string
    kind: 'process' | 'answer' | 'terminal'
    messageIds: Array<string | null>
    lastText: string
  }>
}

type QQBotSendContext = {
  target: QQBotTransportTarget
  nextMsgSeq: number
  sentCount: number
}

export class QQBotRuntime {
  private runId = 0
  private started = false
  private stopRequested = false
  private fatalErrorEmitted = false
  private readonly gateway: QQBotGatewaySession
  private statusSnapshot: QQBotRuntimeStatusSnapshot = {
    state: 'stopped',
    lastError: null,
    botUser: null
  }
  private readonly processedInboundByMessage = new Map<string, QQBotProcessedInboundEntry>()
  private readonly endpointOperations = new Map<string, Promise<void>>()

  constructor(private readonly deps: QQBotRuntimeDeps) {
    this.gateway = new QQBotGatewaySession({
      client: this.deps.client,
      onDispatch: async (payload) => {
        await this.acceptDispatch(payload, this.runId)
      },
      onStatusChange: (snapshot) => {
        this.handleGatewayStatusChange(snapshot)
      },
      onBotUser: (botUser) => {
        this.setBotUser(botUser)
      },
      onFatalError: (message) => {
        this.setStatus({
          state: 'error',
          lastError: message
        })
      }
    })
  }

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
      await this.gateway.start()
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
    await this.gateway.stop()
    this.endpointOperations.clear()
    this.processedInboundByMessage.clear()
    this.setStatus({
      state: 'stopped'
    })
  }

  getStatusSnapshot(): QQBotRuntimeStatusSnapshot {
    return { ...this.statusSnapshot }
  }

  private isCurrentRun(runId: number): boolean {
    return this.runId === runId && this.started && !this.stopRequested
  }

  private async acceptDispatch(
    payload: Parameters<QQBotParser['parseDispatch']>[0],
    runId: number
  ): Promise<void> {
    if (!this.isCurrentRun(runId)) {
      return
    }

    const parsed = this.deps.parser.parseDispatch(payload)
    if (!parsed) {
      return
    }

    if (this.rememberInboundMessage(parsed)) {
      return
    }

    const endpointKey = buildQQBotEndpointKey(parsed.chatType, parsed.chatId)
    if (parsed.command?.name === 'stop') {
      await this.processInboundMessage(parsed, runId)
      return
    }

    this.enqueueEndpointOperation(endpointKey, runId, async () => {
      await this.processInboundMessage(parsed, runId)
    })
  }

  private rememberInboundMessage(message: QQBotInboundMessage): boolean {
    const now = Date.now()
    this.pruneProcessedInbound(now)

    const messageKey = `${message.chatType}:${message.chatId}:${message.messageId}`
    if (this.processedInboundByMessage.has(messageKey)) {
      return true
    }

    this.processedInboundByMessage.set(messageKey, {
      receivedAt: now
    })

    while (this.processedInboundByMessage.size > QQBOT_INBOUND_DEDUP_LIMIT) {
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
      if (now - entry.receivedAt <= QQBOT_INBOUND_DEDUP_TTL_MS) {
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

  private async processInboundMessage(parsed: QQBotInboundMessage, runId: number): Promise<void> {
    if (!this.isCurrentRun(runId)) {
      return
    }

    const target: QQBotTransportTarget = {
      chatType: parsed.chatType,
      openId: parsed.chatId,
      msgId: parsed.messageId
    }
    const sendContext = this.createSendContext(target, parsed.messageSeq)

    try {
      const routed = await this.deps.router.handleMessage(parsed)
      if (!this.isCurrentRun(runId)) {
        return
      }

      await this.dispatchRouteResult(parsed, sendContext, routed, runId)
    } catch (error) {
      const diagnostics = {
        runId,
        target,
        chatId: parsed.chatId,
        chatType: parsed.chatType,
        messageId: parsed.messageId,
        eventId: parsed.eventId
      }

      if (this.deps.logger?.error) {
        this.deps.logger.error(error, diagnostics)
      } else {
        console.error('[QQBotRuntime] Failed to handle dispatch:', error, diagnostics)
      }

      if (!this.isCurrentRun(runId)) {
        return
      }

      await this.sendText(sendContext, QQBOT_INTERNAL_ERROR_REPLY).catch(() => undefined)
    }
  }

  private async dispatchRouteResult(
    message: QQBotInboundMessage,
    sendContext: QQBotSendContext,
    routed: QQBotCommandRouteResult,
    runId: number
  ): Promise<void> {
    for (const reply of routed.replies) {
      if (!this.isCurrentRun(runId)) {
        return
      }

      const sent = await this.sendText(sendContext, reply)
      if (!sent) {
        return
      }
    }

    if (!routed.conversation) {
      return
    }

    await this.deliverConversation(message, sendContext, routed.conversation, runId)
  }

  private async deliverConversation(
    message: QQBotInboundMessage,
    sendContext: QQBotSendContext,
    execution: RemoteConversationExecution,
    runId: number
  ): Promise<void> {
    const startedAt = Date.now()
    const endpointKey = buildQQBotEndpointKey(message.chatType, message.chatId)

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
        if (snapshot.pendingInteraction) {
          if (deliveryState && deliverySegments.length > 0) {
            deliveryState = await this.syncDeliverySegments(
              deliveryState,
              endpointKey,
              sendContext,
              deliverySegments
            )
          }

          await this.sendText(
            sendContext,
            buildFeishuPendingInteractionText(snapshot.pendingInteraction)
          )
          this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
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
              deliveryState,
              endpointKey,
              sendContext,
              deliverySegments
            )
          }
          this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
        } else if (finalText) {
          await this.sendText(sendContext, finalText)
        }

        return
      }

      if (Date.now() - startedAt >= FEISHU_CONVERSATION_POLL_TIMEOUT_MS) {
        await this.sendText(
          sendContext,
          'The current conversation timed out before finishing. Please try again.'
        )
        this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
        return
      }

      if (deliveryState && deliverySegments.length > 0) {
        deliveryState = await this.syncDeliverySegments(
          deliveryState,
          endpointKey,
          sendContext,
          deliverySegments
        )
      }

      if (sendContext.sentCount >= QQBOT_MAX_PASSIVE_REPLIES) {
        this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
        return
      }

      await sleep(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    }
  }

  private getStoredDeliveryState(endpointKey: string): QQBotRemoteDeliveryState | null {
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
    state: QQBotRemoteDeliveryState
  ): QQBotRemoteDeliveryState {
    this.deps.bindingStore.rememberRemoteDeliveryState(endpointKey, state)
    return state
  }

  private createDeliveryState(sourceMessageId: string): QQBotRemoteDeliveryState {
    return {
      sourceMessageId,
      segments: []
    }
  }

  private async prepareDeliveryStateForSource(
    endpointKey: string,
    sourceMessageId: string | null,
    state: QQBotRemoteDeliveryState | null
  ): Promise<QQBotRemoteDeliveryState | null> {
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
    return (snapshot.finalText ?? snapshot.fullText ?? snapshot.text).trim()
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
    state: QQBotRemoteDeliveryState,
    segments: RemoteDeliverySegment[]
  ): boolean {
    if (segments.length < state.segments.length) {
      return false
    }

    return state.segments.every((segment, index) => segments[index]?.key === segment.key)
  }

  private async syncDeliverySegments(
    state: QQBotRemoteDeliveryState,
    endpointKey: string,
    sendContext: QQBotSendContext,
    segments: RemoteDeliverySegment[]
  ): Promise<QQBotRemoteDeliveryState> {
    if (segments.length === 0) {
      return state
    }

    if (!this.isDeliveryStateCompatible(state, segments)) {
      return state
    }

    const syncedSegments = [...state.segments]
    let reachedPassiveReplyLimit = false
    for (let index = 0; index < state.segments.length; index += 1) {
      const segment = segments[index]
      const existingSegment = syncedSegments[index]
      if (!segment || !existingSegment) {
        continue
      }

      const normalizedText = segment.text.trim()
      if (normalizedText === existingSegment.lastText) {
        continue
      }

      const messageId = await this.sendText(sendContext, segment.text)
      syncedSegments[index] = {
        key: segment.key,
        kind: segment.kind,
        messageIds: [...existingSegment.messageIds, messageId],
        lastText: normalizedText
      }

      if (!messageId && sendContext.sentCount >= QQBOT_MAX_PASSIVE_REPLIES) {
        reachedPassiveReplyLimit = true
        break
      }
    }

    if (reachedPassiveReplyLimit) {
      return this.rememberDeliveryState(endpointKey, {
        sourceMessageId: state.sourceMessageId,
        segments: syncedSegments
      })
    }

    for (let index = state.segments.length; index < segments.length; index += 1) {
      const segment = segments[index]
      const messageId = await this.sendText(sendContext, segment.text)
      syncedSegments.push({
        key: segment.key,
        kind: segment.kind,
        messageIds: [messageId],
        lastText: segment.text.trim()
      })

      if (!messageId && sendContext.sentCount >= QQBOT_MAX_PASSIVE_REPLIES) {
        break
      }
    }

    return this.rememberDeliveryState(endpointKey, {
      sourceMessageId: state.sourceMessageId,
      segments: syncedSegments
    })
  }

  private createSendContext(target: QQBotTransportTarget, nextMsgSeq: number): QQBotSendContext {
    return {
      target,
      nextMsgSeq: Math.max(1, nextMsgSeq),
      sentCount: 0
    }
  }

  private async sendText(sendContext: QQBotSendContext, text: string): Promise<string | null> {
    const normalized = text.trim()
    if (!normalized || sendContext.sentCount >= QQBOT_MAX_PASSIVE_REPLIES) {
      return null
    }

    const currentMsgSeq = sendContext.nextMsgSeq
    sendContext.nextMsgSeq += 1
    sendContext.sentCount += 1

    if (sendContext.target.chatType === 'c2c') {
      const response = await this.deps.client.sendC2CMessage({
        openId: sendContext.target.openId,
        msgId: sendContext.target.msgId,
        msgSeq: currentMsgSeq,
        content: normalized
      })
      return response.id?.trim() || null
    }

    const response = await this.deps.client.sendGroupMessage({
      groupOpenId: sendContext.target.openId,
      msgId: sendContext.target.msgId,
      msgSeq: currentMsgSeq,
      content: normalized
    })
    return response.id?.trim() || null
  }

  private setBotUser(botUser: QQBotGatewayBotUser): void {
    this.setStatus({
      botUser: {
        id: botUser.id,
        username: botUser.username
      }
    })
  }

  private handleGatewayStatusChange(snapshot: QQBotRuntimeStatusSnapshot): void {
    this.setStatus({
      state: snapshot.state,
      lastError: snapshot.lastError,
      botUser: snapshot.botUser ?? this.statusSnapshot.botUser
    })
  }

  private setStatus(
    patch: Partial<QQBotRuntimeStatusSnapshot> & {
      state?: QQBotRuntimeStatusSnapshot['state']
    }
  ): void {
    const nextStatus = {
      ...this.statusSnapshot,
      ...patch
    }
    this.statusSnapshot = nextStatus
    this.deps.onStatusChange?.(this.getStatusSnapshot())

    if (nextStatus.state !== 'error') {
      this.fatalErrorEmitted = false
      return
    }

    if (patch.lastError && !this.fatalErrorEmitted) {
      this.fatalErrorEmitted = true
      this.deps.onFatalError?.(patch.lastError)
    }
  }
}
