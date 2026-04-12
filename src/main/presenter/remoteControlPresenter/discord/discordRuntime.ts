import {
  DISCORD_REMOTE_COMMANDS,
  FEISHU_CONVERSATION_POLL_TIMEOUT_MS,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  buildDiscordEndpointKey,
  type DiscordInboundMessage,
  type DiscordRuntimeStatusSnapshot,
  type DiscordTransportTarget,
  type RemoteDeliverySegment
} from '../types'
import { RemoteBindingStore } from '../services/remoteBindingStore'
import type { DiscordCommandRouteResult } from '../services/discordCommandRouter'
import { DiscordCommandRouter } from '../services/discordCommandRouter'
import type { RemoteConversationExecution } from '../services/remoteConversationRunner'
import { REMOTE_NO_RESPONSE_TEXT } from '../services/remoteBlockRenderer'
import { buildFeishuPendingInteractionText } from '../feishu/feishuInteractionPrompt'
import {
  DiscordClient,
  type DiscordBotIdentity,
  type DiscordSlashCommandDefinition
} from './discordClient'
import { DiscordGatewaySession, type DiscordGatewayBotUser } from './discordGatewaySession'
import { DiscordParser } from './discordParser'

const DISCORD_INBOUND_DEDUP_LIMIT = 500
const DISCORD_INBOUND_DEDUP_TTL_MS = 10 * 60 * 1000
const DISCORD_OUTBOUND_TEXT_LIMIT = 1_900
const DISCORD_STREAM_EDIT_INTERVAL_MS = 700
const DISCORD_INTERNAL_ERROR_REPLY = 'An internal error occurred while processing your request.'

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type DiscordRuntimeDeps = {
  client: DiscordClient
  parser: DiscordParser
  router: DiscordCommandRouter
  bindingStore: RemoteBindingStore
  logger?: {
    error: (...params: unknown[]) => void
  }
  onStatusChange?: (snapshot: DiscordRuntimeStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

type DiscordProcessedInboundEntry = {
  receivedAt: number
}

type DiscordRemoteDeliveryState = {
  sourceMessageId: string
  segments: Array<{
    key: string
    kind: 'process' | 'answer' | 'terminal'
    messageIds: string[]
    lastText: string
  }>
}

const chunkDiscordText = (text: string, limit: number = DISCORD_OUTBOUND_TEXT_LIMIT): string[] => {
  const normalized = text.trim() || '(No text output)'
  if (normalized.length <= limit) {
    return [normalized]
  }

  const chunks: string[] = []
  let remaining = normalized

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit)
    const splitIndex = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'))
    const nextIndex = splitIndex > Math.floor(limit * 0.55) ? splitIndex : limit
    chunks.push(remaining.slice(0, nextIndex).trim())
    remaining = remaining.slice(nextIndex).trim()
  }

  if (remaining) {
    chunks.push(remaining)
  }

  return chunks
}

const discordSlashCommands = (): DiscordSlashCommandDefinition[] => {
  const commandsWithArgs = new Set(['pair', 'new', 'use', 'model'])
  return DISCORD_REMOTE_COMMANDS.map((command) => ({
    name: command.command,
    description: command.description,
    ...(commandsWithArgs.has(command.command)
      ? {
          options: [
            {
              type: 3 as const,
              name: 'args',
              description: 'Command arguments',
              required: false
            }
          ]
        }
      : {})
  }))
}

export class DiscordRuntime {
  private runId = 0
  private started = false
  private stopRequested = false
  private readonly gateway: DiscordGatewaySession
  private statusSnapshot: DiscordRuntimeStatusSnapshot = {
    state: 'stopped',
    lastError: null,
    botUser: null
  }
  private readonly processedInboundByMessage = new Map<string, DiscordProcessedInboundEntry>()
  private readonly endpointOperations = new Map<string, Promise<void>>()
  private applicationId: string | null = null
  private lastEditAt = 0

  constructor(private readonly deps: DiscordRuntimeDeps) {
    this.gateway = new DiscordGatewaySession({
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
      onApplicationId: (applicationId) => {
        this.applicationId = applicationId
      },
      onFatalError: (message) => {
        this.setStatus({
          state: 'error',
          lastError: message
        })
        this.deps.onFatalError?.(message)
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
    this.applicationId = null
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
      await this.gateway.start()
      if (!this.isCurrentRun(runId)) {
        return
      }

      if (!this.applicationId) {
        throw new Error('Discord application ID is missing from the READY payload.')
      }

      await this.deps.client.registerCommands(this.applicationId, discordSlashCommands())
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
    this.applicationId = null
    await this.gateway.stop()
    this.endpointOperations.clear()
    this.processedInboundByMessage.clear()
    this.setStatus({
      state: 'stopped'
    })
  }

  getStatusSnapshot(): DiscordRuntimeStatusSnapshot {
    return { ...this.statusSnapshot }
  }

  private isCurrentRun(runId: number): boolean {
    return this.runId === runId && this.started && !this.stopRequested
  }

  private async acceptDispatch(
    payload: Parameters<DiscordParser['parseDispatch']>[0],
    runId: number
  ): Promise<void> {
    if (!this.isCurrentRun(runId)) {
      return
    }

    const parsed = this.deps.parser.parseDispatch(payload, this.statusSnapshot.botUser?.id)
    if (!parsed) {
      return
    }

    if (this.rememberInboundMessage(parsed)) {
      return
    }

    const endpointKey = buildDiscordEndpointKey(parsed.chatType, parsed.chatId)
    if (parsed.command?.name === 'stop') {
      await this.processInboundMessage(parsed, runId)
      return
    }

    this.enqueueEndpointOperation(endpointKey, runId, async () => {
      await this.processInboundMessage(parsed, runId)
    })
  }

  private rememberInboundMessage(message: DiscordInboundMessage): boolean {
    const now = Date.now()
    this.pruneProcessedInbound(now)

    const messageKey = `${message.kind}:${message.chatType}:${message.chatId}:${message.messageId}`
    if (this.processedInboundByMessage.has(messageKey)) {
      return true
    }

    this.processedInboundByMessage.set(messageKey, {
      receivedAt: now
    })

    while (this.processedInboundByMessage.size > DISCORD_INBOUND_DEDUP_LIMIT) {
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
      if (now - entry.receivedAt <= DISCORD_INBOUND_DEDUP_TTL_MS) {
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

  private async processInboundMessage(parsed: DiscordInboundMessage, runId: number): Promise<void> {
    if (!this.isCurrentRun(runId)) {
      return
    }

    try {
      const routed = await this.deps.router.handleMessage(parsed)
      if (!this.isCurrentRun(runId)) {
        return
      }

      if (parsed.kind === 'interaction') {
        await this.dispatchInteractionRouteResult(parsed, routed, runId)
        return
      }

      const target: DiscordTransportTarget = {
        chatType: parsed.chatType,
        channelId: parsed.chatId
      }

      for (const reply of routed.replies) {
        if (!this.isCurrentRun(runId)) {
          return
        }
        await this.deps.client.sendMessage(target.channelId, reply)
      }

      if (routed.conversation) {
        await this.deliverConversation(target, routed.conversation, runId)
      }
    } catch (error) {
      const diagnostics = {
        runId,
        chatId: parsed.chatId,
        chatType: parsed.chatType,
        messageId: parsed.messageId,
        eventId: parsed.eventId,
        kind: parsed.kind
      }

      if (this.deps.logger?.error) {
        this.deps.logger.error(error, diagnostics)
      } else {
        console.error('[DiscordRuntime] Failed to handle dispatch:', error, diagnostics)
      }

      if (!this.isCurrentRun(runId)) {
        return
      }

      if (parsed.kind === 'interaction') {
        await this.safeRespondToInteraction(parsed, [DISCORD_INTERNAL_ERROR_REPLY])
        return
      }

      await this.deps.client
        .sendMessage(parsed.chatId, DISCORD_INTERNAL_ERROR_REPLY)
        .catch(() => undefined)
    }
  }

  private async dispatchInteractionRouteResult(
    message: DiscordInboundMessage,
    routed: DiscordCommandRouteResult,
    runId: number
  ): Promise<void> {
    if (!message.interactionId || !message.interactionToken || !message.applicationId) {
      return
    }

    await this.deps.client.deferInteractionResponse(message.interactionId, message.interactionToken)
    if (!this.isCurrentRun(runId)) {
      return
    }

    if (routed.conversation) {
      await this.safeRespondToInteraction(message, [
        'Slash commands do not support free-form prompts. Send a regular message to chat with DeepChat.'
      ])
      return
    }

    const replies = routed.replies.length > 0 ? routed.replies : ['Done.']
    await this.safeRespondToInteraction(message, replies)
  }

  private async safeRespondToInteraction(
    message: DiscordInboundMessage,
    replies: string[]
  ): Promise<void> {
    if (!message.applicationId || !message.interactionToken) {
      return
    }

    const [firstReply, ...restReplies] = replies
    await this.deps.client.editOriginalInteractionResponse(
      message.applicationId,
      message.interactionToken,
      firstReply
    )

    for (const reply of restReplies) {
      await this.deps.client.sendInteractionFollowup(
        message.applicationId,
        message.interactionToken,
        reply
      )
    }
  }

  private async deliverConversation(
    target: DiscordTransportTarget,
    execution: RemoteConversationExecution,
    runId: number
  ): Promise<void> {
    const startedAt = Date.now()
    const endpointKey = buildDiscordEndpointKey(target.chatType, target.channelId)

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
              target,
              endpointKey,
              deliveryState,
              deliverySegments
            )
          }

          await this.deps.client.sendMessage(
            target.channelId,
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
              target,
              endpointKey,
              deliveryState,
              deliverySegments
            )
          }
          this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
        } else if (finalText) {
          await this.deps.client.sendMessage(target.channelId, finalText)
        }
        return
      }

      if (Date.now() - startedAt >= FEISHU_CONVERSATION_POLL_TIMEOUT_MS) {
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
          await this.deps.client.sendMessage(target.channelId, timeoutText)
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

  private getStoredDeliveryState(endpointKey: string): DiscordRemoteDeliveryState | null {
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
          (messageId): messageId is string =>
            typeof messageId === 'string' && messageId.trim().length > 0
        ),
        lastText: segment.lastText
      }))
    }
  }

  private rememberDeliveryState(
    endpointKey: string,
    state: DiscordRemoteDeliveryState
  ): DiscordRemoteDeliveryState {
    this.deps.bindingStore.rememberRemoteDeliveryState(endpointKey, state)
    return state
  }

  private createDeliveryState(sourceMessageId: string): DiscordRemoteDeliveryState {
    return {
      sourceMessageId,
      segments: []
    }
  }

  private async prepareDeliveryStateForSource(
    endpointKey: string,
    sourceMessageId: string | null,
    state: DiscordRemoteDeliveryState | null
  ): Promise<DiscordRemoteDeliveryState | null> {
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
    state: DiscordRemoteDeliveryState,
    segments: RemoteDeliverySegment[]
  ): boolean {
    if (segments.length < state.segments.length) {
      return false
    }

    return state.segments.every((segment, index) => segments[index]?.key === segment.key)
  }

  private async syncDeliverySegments(
    target: DiscordTransportTarget,
    endpointKey: string,
    state: DiscordRemoteDeliveryState,
    segments: RemoteDeliverySegment[]
  ): Promise<DiscordRemoteDeliveryState> {
    if (segments.length === 0) {
      return state
    }

    let nextState = state
    if (!this.isDeliveryStateCompatible(nextState, segments)) {
      this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
      nextState = this.createDeliveryState(state.sourceMessageId)
    }

    const syncedSegments: DiscordRemoteDeliveryState['segments'] = []
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
    target: DiscordTransportTarget,
    existing: DiscordRemoteDeliveryState['segments'][number] | null,
    segment: RemoteDeliverySegment
  ): Promise<DiscordRemoteDeliveryState['segments'][number]> {
    const normalized = segment.text.trim()
    const nextChunks = chunkDiscordText(normalized)

    if (!existing) {
      const messageIds: string[] = []
      for (const chunk of nextChunks) {
        const messageId = await this.deps.client.sendMessage(target.channelId, chunk)
        if (messageId) {
          messageIds.push(messageId)
        }
      }

      return {
        key: segment.key,
        kind: segment.kind,
        messageIds,
        lastText: normalized
      }
    }

    const previousChunks = existing.lastText ? chunkDiscordText(existing.lastText) : []
    if (
      nextChunks.length < existing.messageIds.length ||
      previousChunks.length < existing.messageIds.length ||
      previousChunks
        .slice(0, Math.max(0, existing.messageIds.length - 1))
        .some((chunk, index) => chunk !== nextChunks[index])
    ) {
      for (const messageId of existing.messageIds) {
        await this.deps.client.deleteMessage(target.channelId, messageId).catch(() => undefined)
      }

      const messageIds: string[] = []
      for (const chunk of nextChunks) {
        const messageId = await this.deps.client.sendMessage(target.channelId, chunk)
        if (messageId) {
          messageIds.push(messageId)
        }
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

      await this.throttleEdit()
      await this.deps.client.updateMessage(target.channelId, messageId, nextChunks[index])
    }

    for (let index = messageIds.length; index < nextChunks.length; index += 1) {
      const messageId = await this.deps.client.sendMessage(target.channelId, nextChunks[index])
      if (messageId) {
        messageIds.push(messageId)
      }
    }

    return {
      key: segment.key,
      kind: segment.kind,
      messageIds,
      lastText: normalized
    }
  }

  private async throttleEdit(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastEditAt
    if (elapsed < DISCORD_STREAM_EDIT_INTERVAL_MS) {
      await sleep(DISCORD_STREAM_EDIT_INTERVAL_MS - elapsed)
    }
    this.lastEditAt = Date.now()
  }

  private setBotUser(botUser: DiscordBotIdentity | DiscordGatewayBotUser): void {
    this.setStatus({
      botUser: {
        id: botUser.id,
        username: botUser.username,
        displayName: 'displayName' in botUser ? botUser.displayName : undefined
      }
    })
  }

  private handleGatewayStatusChange(snapshot: DiscordRuntimeStatusSnapshot): void {
    if (!this.started || this.stopRequested) {
      return
    }

    this.setStatus({
      state: snapshot.state,
      lastError: snapshot.lastError
    })
  }

  private setStatus(
    patch: Partial<DiscordRuntimeStatusSnapshot> & { state?: DiscordRuntimeStatusSnapshot['state'] }
  ): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...patch
    }
    this.deps.onStatusChange?.({ ...this.statusSnapshot })
  }
}
