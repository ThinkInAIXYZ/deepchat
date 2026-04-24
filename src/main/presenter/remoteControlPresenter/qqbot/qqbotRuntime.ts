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
import { REMOTE_NO_RESPONSE_TEXT } from '../services/remoteBlockRenderer'
import type { QQBotCommandRouteResult } from '../services/qqbotCommandRouter'
import { QQBotCommandRouter } from '../services/qqbotCommandRouter'
import type { RemoteConversationExecution } from '../services/remoteConversationRunner'
import { buildFeishuPendingInteractionText } from '../feishu/feishuInteractionPrompt'
import { QQBotClient } from './qqbotClient'
import { QQBotGatewaySession, type QQBotGatewayBotUser } from './qqbotGatewaySession'
import { QQBotParser } from './qqbotParser'

const QQBOT_INBOUND_DEDUP_LIMIT = 500
const QQBOT_INBOUND_DEDUP_TTL_MS = 10 * 60 * 1000
const QQBOT_MAX_PASSIVE_REPLIES = 5
const QQBOT_INTERNAL_ERROR_REPLY = 'An internal error occurred while processing your request.'
const QQBOT_TIMEOUT_REPLY = 'The current conversation timed out before finishing. Please try again.'

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

type QQBotPendingProcessBatch = {
  keys: string[]
  ready: boolean
}

type QQBotToolBufferState = {
  sourceMessageId: string | null
  pendingProcessSegments: QQBotPendingProcessBatch[]
  lastProcessTextByKey: Map<string, string>
  flushedProcessKeys: Set<string>
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
  private readonly endpointToolBuffers = new Map<string, QQBotToolBufferState>()

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
    this.endpointToolBuffers.clear()
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

      const endpointKey = buildQQBotEndpointKey(parsed.chatType, parsed.chatId)
      this.markBufferedProcessBatchesReady(endpointKey)
      await this.flushBufferedProcessMessages(endpointKey, sendContext, {
        reserveTerminalSlot: true
      }).catch(() => undefined)
      this.clearToolBuffer(endpointKey)
      this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
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
    this.clearToolBuffer(endpointKey)
    this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)

    while (this.isCurrentRun(runId)) {
      const snapshot = await execution.getSnapshot()
      if (!this.isCurrentRun(runId)) {
        return
      }

      const sourceMessageId = this.getConversationSourceMessageId(message, execution, snapshot)
      const deliverySegments = this.getSnapshotDeliverySegments(snapshot, sourceMessageId)
      const timedOut = Date.now() - startedAt >= FEISHU_CONVERSATION_POLL_TIMEOUT_MS
      this.syncToolBuffer(endpointKey, sourceMessageId, deliverySegments, {
        flushTrailingBatch: snapshot.completed || timedOut
      })

      if (snapshot.completed) {
        if (snapshot.pendingInteraction) {
          await this.flushBufferedProcessMessages(endpointKey, sendContext, {
            reserveTerminalSlot: true
          })
          await this.sendText(
            sendContext,
            buildFeishuPendingInteractionText(snapshot.pendingInteraction)
          )
          this.clearToolBuffer(endpointKey)
          this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
          return
        }

        const finalText = this.getFinalDeliveryText(snapshot)
        const skipNoResponseTerminal = this.shouldSkipNoResponseTerminal(endpointKey, finalText)
        const didFlushProcessOutput = await this.flushBufferedProcessMessages(
          endpointKey,
          sendContext,
          {
            reserveTerminalSlot: Boolean(finalText) && !skipNoResponseTerminal
          }
        )

        if (finalText && (!skipNoResponseTerminal || !didFlushProcessOutput)) {
          await this.sendText(sendContext, finalText)
        }
        await this.sendGeneratedImages(sendContext, snapshot)
        this.clearToolBuffer(endpointKey)
        this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)

        return
      }

      if (timedOut) {
        await this.flushBufferedProcessMessages(endpointKey, sendContext, {
          reserveTerminalSlot: true
        })
        await this.sendText(sendContext, QQBOT_TIMEOUT_REPLY)
        this.clearToolBuffer(endpointKey)
        this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
        return
      }

      await this.flushBufferedProcessMessages(endpointKey, sendContext, {
        reserveTerminalSlot: true
      })
      await sleep(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    }
  }

  private getConversationSourceMessageId(
    message: QQBotInboundMessage,
    execution: RemoteConversationExecution,
    snapshot: Awaited<ReturnType<RemoteConversationExecution['getSnapshot']>>
  ): string | null {
    return (
      snapshot.messageId?.trim() ||
      execution.eventId?.trim() ||
      message.eventId?.trim() ||
      message.messageId?.trim() ||
      null
    )
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

  private syncToolBuffer(
    endpointKey: string,
    sourceMessageId: string | null,
    segments: RemoteDeliverySegment[],
    options: {
      flushTrailingBatch: boolean
    }
  ): QQBotToolBufferState | null {
    const state = this.getOrCreateToolBuffer(endpointKey, sourceMessageId)
    if (!state) {
      return null
    }

    const pendingProcessSegments: QQBotPendingProcessBatch[] = []
    let currentBatchKeys: string[] = []

    for (const segment of segments) {
      if (segment.sourceMessageId !== state.sourceMessageId) {
        continue
      }

      const normalizedKey = segment.key.trim()
      const normalizedText = segment.text.trim()
      if (!normalizedKey || !normalizedText) {
        continue
      }

      if (segment.kind === 'process') {
        if (state.flushedProcessKeys.has(normalizedKey)) {
          continue
        }

        state.lastProcessTextByKey.set(normalizedKey, normalizedText)
        if (!currentBatchKeys.includes(normalizedKey)) {
          currentBatchKeys.push(normalizedKey)
        }
        continue
      }

      if (currentBatchKeys.length > 0) {
        pendingProcessSegments.push({
          keys: currentBatchKeys,
          ready: true
        })
        currentBatchKeys = []
      }
    }

    if (currentBatchKeys.length > 0) {
      pendingProcessSegments.push({
        keys: currentBatchKeys,
        ready: options.flushTrailingBatch
      })
    }

    state.pendingProcessSegments = pendingProcessSegments
    return state
  }

  private getOrCreateToolBuffer(
    endpointKey: string,
    sourceMessageId: string | null
  ): QQBotToolBufferState | null {
    const current = this.endpointToolBuffers.get(endpointKey)
    if (current) {
      if (!sourceMessageId || current.sourceMessageId === sourceMessageId) {
        return current
      }

      this.migrateToolBufferSourceMessageId(current, sourceMessageId)
      return current
    }

    if (!sourceMessageId) {
      return null
    }

    const nextState: QQBotToolBufferState = {
      sourceMessageId,
      pendingProcessSegments: [],
      lastProcessTextByKey: new Map(),
      flushedProcessKeys: new Set()
    }
    this.endpointToolBuffers.set(endpointKey, nextState)
    return nextState
  }

  private clearToolBuffer(endpointKey: string): void {
    this.endpointToolBuffers.delete(endpointKey)
  }

  private migrateToolBufferSourceMessageId(
    state: QQBotToolBufferState,
    nextSourceMessageId: string
  ): void {
    const previousSourceMessageId = state.sourceMessageId
    if (!previousSourceMessageId || previousSourceMessageId === nextSourceMessageId) {
      state.sourceMessageId = nextSourceMessageId
      return
    }

    const migratedLastProcessTextByKey = new Map<string, string>()
    for (const [key, text] of state.lastProcessTextByKey.entries()) {
      migratedLastProcessTextByKey.set(
        this.rewriteToolBufferKey(key, previousSourceMessageId, nextSourceMessageId),
        text
      )
    }

    state.lastProcessTextByKey = migratedLastProcessTextByKey
    state.flushedProcessKeys = new Set(
      [...state.flushedProcessKeys].map((key) =>
        this.rewriteToolBufferKey(key, previousSourceMessageId, nextSourceMessageId)
      )
    )
    state.pendingProcessSegments = state.pendingProcessSegments.map((batch) => ({
      ...batch,
      keys: this.dedupeKeysInOrder(
        batch.keys.map((key) =>
          this.rewriteToolBufferKey(key, previousSourceMessageId, nextSourceMessageId)
        )
      )
    }))
    state.sourceMessageId = nextSourceMessageId
  }

  private rewriteToolBufferKey(
    key: string,
    previousSourceMessageId: string,
    nextSourceMessageId: string
  ): string {
    const previousPrefix = `${previousSourceMessageId}:`
    if (!key.startsWith(previousPrefix)) {
      return key
    }

    return `${nextSourceMessageId}:${key.slice(previousPrefix.length)}`
  }

  private dedupeKeysInOrder(keys: string[]): string[] {
    const seenKeys = new Set<string>()
    const dedupedKeys: string[] = []

    for (const key of keys) {
      if (seenKeys.has(key)) {
        continue
      }

      seenKeys.add(key)
      dedupedKeys.push(key)
    }

    return dedupedKeys
  }

  private markBufferedProcessBatchesReady(endpointKey: string): void {
    const state = this.endpointToolBuffers.get(endpointKey)
    if (!state) {
      return
    }

    state.pendingProcessSegments = state.pendingProcessSegments.map((batch) => ({
      keys: [...batch.keys],
      ready: true
    }))
  }

  private async flushBufferedProcessMessages(
    endpointKey: string,
    sendContext: QQBotSendContext,
    options: {
      reserveTerminalSlot: boolean
    }
  ): Promise<boolean> {
    const state = this.endpointToolBuffers.get(endpointKey)
    if (!state || state.pendingProcessSegments.length === 0) {
      return false
    }

    const retainedBatches: QQBotPendingProcessBatch[] = []
    let didFlushProcessOutput = false

    for (let index = 0; index < state.pendingProcessSegments.length; index += 1) {
      const batch = state.pendingProcessSegments[index]
      if (!batch.ready) {
        retainedBatches.push(batch)
        continue
      }

      const reservedSlots = options.reserveTerminalSlot ? 1 : 0
      if (sendContext.sentCount + reservedSlots >= QQBOT_MAX_PASSIVE_REPLIES) {
        retainedBatches.push(batch, ...state.pendingProcessSegments.slice(index + 1))
        state.pendingProcessSegments = retainedBatches
        return didFlushProcessOutput
      }

      const processText = this.buildBufferedProcessText(state, batch)
      if (!processText) {
        this.markProcessBatchFlushed(state, batch)
        continue
      }

      const sent = await this.sendText(sendContext, processText)
      if (!sent) {
        retainedBatches.push(batch, ...state.pendingProcessSegments.slice(index + 1))
        state.pendingProcessSegments = retainedBatches
        return didFlushProcessOutput
      }

      didFlushProcessOutput = true
      this.markProcessBatchFlushed(state, batch)
    }

    state.pendingProcessSegments = retainedBatches
    return didFlushProcessOutput
  }

  private buildBufferedProcessText(
    state: QQBotToolBufferState,
    batch: QQBotPendingProcessBatch
  ): string {
    return batch.keys
      .map((key) => state.lastProcessTextByKey.get(key)?.trim() || '')
      .filter((text) => text.length > 0)
      .join('\n')
      .trim()
  }

  private markProcessBatchFlushed(
    state: QQBotToolBufferState,
    batch: QQBotPendingProcessBatch
  ): void {
    for (const key of batch.keys) {
      state.flushedProcessKeys.add(key)
      state.lastProcessTextByKey.delete(key)
    }
  }

  private shouldSkipNoResponseTerminal(endpointKey: string, finalText: string): boolean {
    if (finalText !== REMOTE_NO_RESPONSE_TEXT) {
      return false
    }

    const state = this.endpointToolBuffers.get(endpointKey)
    if (!state) {
      return false
    }

    return state.pendingProcessSegments.some((batch) => {
      if (!batch.ready) {
        return false
      }

      return batch.keys.some((key) => {
        const processText = state.lastProcessTextByKey.get(key)?.trim() || ''
        return processText.length > 0
      })
    })
  }

  private getFinalDeliveryText(
    snapshot: Awaited<ReturnType<RemoteConversationExecution['getSnapshot']>>
  ): string {
    const finalText = snapshot.finalText?.trim() ?? ''
    if (finalText) {
      return finalText
    }
    const fullText = snapshot.fullText?.trim() ?? ''
    const text = snapshot.text?.trim() ?? ''
    if ((snapshot.generatedImages?.length ?? 0) > 0 && !fullText && !text) {
      return ''
    }
    return fullText || text
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

  private async sendGeneratedImages(
    sendContext: QQBotSendContext,
    snapshot: Awaited<ReturnType<RemoteConversationExecution['getSnapshot']>>
  ): Promise<void> {
    for (const asset of snapshot.generatedImages ?? []) {
      if (sendContext.sentCount >= QQBOT_MAX_PASSIVE_REPLIES) {
        return
      }

      const currentMsgSeq = sendContext.nextMsgSeq
      sendContext.nextMsgSeq += 1
      sendContext.sentCount += 1

      try {
        if (sendContext.target.chatType === 'c2c') {
          await this.deps.client.sendC2CImage({
            openId: sendContext.target.openId,
            msgId: sendContext.target.msgId,
            msgSeq: currentMsgSeq,
            filePath: asset.path
          })
        } else {
          await this.deps.client.sendGroupImage({
            groupOpenId: sendContext.target.openId,
            msgId: sendContext.target.msgId,
            msgSeq: currentMsgSeq,
            filePath: asset.path
          })
        }
      } catch (error) {
        console.warn('[QQBotRuntime] Failed to send generated image:', {
          path: asset.path,
          error
        })
        sendContext.sentCount -= 1
        sendContext.nextMsgSeq -= 1
        await this.sendText(
          sendContext,
          '[Image] Delivery failed - see local copy in the app.'
        ).catch(() => undefined)
      }
    }
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
