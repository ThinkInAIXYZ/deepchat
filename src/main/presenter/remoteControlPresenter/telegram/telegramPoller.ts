import {
  TELEGRAM_REMOTE_REACTION_EMOJI,
  TELEGRAM_REMOTE_POLL_LIMIT,
  TELEGRAM_REMOTE_POLL_TIMEOUT_SEC,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  TELEGRAM_TYPING_DELAY_MS,
  type RemotePendingInteraction,
  type TelegramInboundMessage,
  type TelegramOutboundAction,
  type TelegramPollerStatusSnapshot,
  type TelegramTransportTarget
} from '../types'
import { RemoteBindingStore } from '../services/remoteBindingStore'
import {
  RemoteCommandRouter,
  type RemoteCommandRouteContinuation,
  type RemoteCommandRouteResult
} from '../services/remoteCommandRouter'
import { chunkTelegramText } from './telegramOutbound'
import { buildTelegramPendingInteractionPrompt } from './telegramInteractionPrompt'
import { TelegramApiRequestError, TelegramClient, type TelegramRawUpdate } from './telegramClient'
import { TelegramParser } from './telegramParser'

const POLL_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const
const CALLBACK_QUERY_ACK_TIMEOUT_MS = 500

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, ms)

    const handleAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

type TelegramPollerDeps = {
  client: TelegramClient
  parser: TelegramParser
  router: RemoteCommandRouter
  bindingStore: RemoteBindingStore
  onStatusChange?: (snapshot: TelegramPollerStatusSnapshot) => void
  onFatalError?: (message: string) => void
}

type TelegramRemoteDeliveryState = {
  sourceMessageId: string
  statusMessageId: number | null
  contentMessageIds: number[]
  lastStatusText: string
  lastContentText: string
}

export class TelegramPoller {
  private stopRequested = false
  private loopPromise: Promise<void> | null = null
  private activePollController: AbortController | null = null
  private runId = 0
  private readonly backgroundTasks = new Set<Promise<void>>()
  private statusSnapshot: TelegramPollerStatusSnapshot = {
    state: 'stopped',
    lastError: null,
    botUser: null
  }

  constructor(private readonly deps: TelegramPollerDeps) {}

  async start(): Promise<void> {
    if (this.loopPromise) {
      return
    }

    this.stopRequested = false
    const runId = ++this.runId
    this.loopPromise = this.runLoop(runId).finally(() => {
      this.loopPromise = null
      if (this.isCurrentRun(runId) && this.statusSnapshot.state !== 'error') {
        this.setStatus({
          state: 'stopped'
        })
      }
    })
  }

  async stop(): Promise<void> {
    this.stopRequested = true
    this.runId += 1
    this.activePollController?.abort()
    const loop = this.loopPromise
    if (loop) {
      await loop
    }
    this.backgroundTasks.clear()
    this.setStatus({
      state: 'stopped'
    })
  }

  getStatusSnapshot(): TelegramPollerStatusSnapshot {
    return { ...this.statusSnapshot }
  }

  private async runLoop(runId: number): Promise<void> {
    let backoffIndex = 0

    while (this.isCurrentRun(runId)) {
      const pollSignal = this.createPollSignal()
      let updates: TelegramRawUpdate[]

      try {
        await this.ensureBotIdentity()
        this.setStatus({
          state: 'running',
          lastError: null
        })

        updates = await this.deps.client.getUpdates({
          offset: this.deps.bindingStore.getPollOffset(),
          limit: TELEGRAM_REMOTE_POLL_LIMIT,
          timeout: TELEGRAM_REMOTE_POLL_TIMEOUT_SEC,
          allowedUpdates: ['message', 'callback_query'],
          signal: pollSignal
        })

        backoffIndex = 0
      } catch (error) {
        if (!this.isCurrentRun(runId)) {
          return
        }

        const lastError = error instanceof Error ? error.message : String(error)
        if (this.isFatalPollError(error)) {
          this.setStatus({
            state: 'error',
            lastError
          })
          this.deps.onFatalError?.(lastError)
          return
        }

        const delay = POLL_BACKOFF_MS[Math.min(backoffIndex, POLL_BACKOFF_MS.length - 1)]
        backoffIndex += 1
        this.setStatus({
          state: 'backoff',
          lastError
        })
        await sleep(delay, pollSignal)
        continue
      }

      for (const update of updates) {
        if (!this.isCurrentRun(runId)) {
          return
        }

        // Persist the next offset before processing to avoid replaying
        // partially-delivered Telegram side effects after restart.
        this.deps.bindingStore.setPollOffset(update.update_id + 1)

        try {
          await this.handleRawUpdate(update, runId)
        } catch (error) {
          if (!this.isCurrentRun(runId)) {
            return
          }

          console.warn('[TelegramPoller] Failed to handle update:', {
            updateId: update.update_id,
            error
          })
        }
      }
    }
  }

  private createPollSignal(): AbortSignal {
    this.activePollController?.abort()
    this.activePollController = new AbortController()
    return this.activePollController.signal
  }

  private async ensureBotIdentity(): Promise<void> {
    if (this.statusSnapshot.botUser) {
      return
    }

    const botUser = await this.deps.client.getMe()
    this.setStatus({
      botUser
    })
  }

  private async handleRawUpdate(update: TelegramRawUpdate, runId: number): Promise<void> {
    const parsed = this.deps.parser.parseUpdate(update)
    if (!parsed) {
      return
    }

    const target: TelegramTransportTarget = {
      chatId: parsed.chatId,
      messageThreadId: parsed.messageThreadId
    }
    const callbackAcknowledger =
      parsed.kind === 'callback_query'
        ? this.createCallbackQueryAcknowledger(parsed.callbackQueryId)
        : null

    let routed: Awaited<ReturnType<RemoteCommandRouter['handleMessage']>>
    try {
      routed = await this.deps.router.handleMessage(parsed)
    } catch (error) {
      if (callbackAcknowledger) {
        await callbackAcknowledger.answer()
      }
      throw error
    }

    if (callbackAcknowledger) {
      await callbackAcknowledger.answer(routed.callbackAnswer)
    }

    await this.dispatchRouteResult(
      target,
      routed,
      runId,
      parsed.kind === 'message' && !parsed.command ? parsed : null
    )

    if (routed.deferred) {
      this.scheduleDeferredRouteResult(target, routed.deferred, runId)
    }
  }

  private scheduleDeferredRouteResult(
    target: TelegramTransportTarget,
    deferred: Promise<RemoteCommandRouteContinuation>,
    runId: number
  ): void {
    const task = Promise.resolve()
      .then(async () => {
        const continuation = await deferred
        if (!this.isCurrentRun(runId)) {
          return
        }

        await this.dispatchRouteResult(target, continuation, runId)
      })
      .catch((error) => {
        console.warn('[TelegramPoller] Deferred route dispatch failed:', error)
      })
      .finally(() => {
        this.backgroundTasks.delete(task)
      })

    this.backgroundTasks.add(task)
  }

  private async dispatchRouteResult(
    target: TelegramTransportTarget,
    routed:
      | Pick<RemoteCommandRouteResult, 'replies' | 'outboundActions' | 'conversation'>
      | RemoteCommandRouteContinuation,
    runId: number,
    reactionMessage: TelegramInboundMessage | null = null
  ): Promise<void> {
    if (!this.isCurrentRun(runId)) {
      return
    }

    for (const reply of routed.replies ?? []) {
      if (!this.isCurrentRun(runId)) {
        return
      }
      await this.sendChunkedMessage(target, reply)
    }

    if (routed.outboundActions?.length) {
      if (!this.isCurrentRun(runId)) {
        return
      }
      await this.dispatchOutboundActions(target, routed.outboundActions)
    }

    if (!routed.conversation) {
      return
    }

    if (reactionMessage) {
      await this.setIncomingReaction(reactionMessage.chatId, reactionMessage.messageId)
    }

    try {
      await this.deliverConversation(target, routed.conversation, runId)
    } finally {
      if (reactionMessage) {
        await this.clearIncomingReaction(reactionMessage.chatId, reactionMessage.messageId)
      }
    }
  }

  private async deliverConversation(
    target: TelegramTransportTarget,
    execution: NonNullable<
      Awaited<ReturnType<RemoteCommandRouter['handleMessage']>>['conversation']
    >,
    runId: number
  ): Promise<void> {
    const startedAt = Date.now()
    let typingSent = false
    const endpointKey = this.deps.bindingStore.getEndpointKey(target)

    while (this.isCurrentRun(runId)) {
      const snapshot = await execution.getSnapshot()
      const sourceMessageId = snapshot.messageId ?? execution.eventId ?? null
      let deliveryState = this.getStoredDeliveryState(endpointKey)
      deliveryState = await this.prepareDeliveryStateForSource(
        target,
        endpointKey,
        sourceMessageId,
        deliveryState
      )
      const statusText = snapshot.statusText?.trim() || ''
      const streamText = snapshot.text?.trim() || ''

      if (sourceMessageId) {
        deliveryState = deliveryState ?? {
          sourceMessageId,
          statusMessageId: null,
          contentMessageIds: [],
          lastStatusText: '',
          lastContentText: ''
        }

        deliveryState = await this.syncStatusMessage(target, endpointKey, deliveryState, statusText)
        deliveryState = await this.syncContentText(target, endpointKey, deliveryState, streamText)
      }

      if (snapshot.completed) {
        if (snapshot.pendingInteraction) {
          await this.sendPendingInteractionPrompt(target, snapshot.pendingInteraction)
          return
        }

        const finalText = (snapshot.finalText ?? snapshot.fullText ?? snapshot.text).trim()
        if (deliveryState) {
          deliveryState = await this.syncFinalContentText(
            target,
            endpointKey,
            deliveryState,
            finalText
          )
          await this.deleteStatusMessage(target, deliveryState.statusMessageId)
          this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)
        } else {
          await this.sendChunkedMessage(target, finalText)
        }
        return
      }

      if (!typingSent && Date.now() - startedAt >= TELEGRAM_TYPING_DELAY_MS) {
        typingSent = true
        await this.sendTyping(target)
      }

      await sleep(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    }
  }

  private getStoredDeliveryState(endpointKey: string): TelegramRemoteDeliveryState | null {
    const state = this.deps.bindingStore.getRemoteDeliveryState(endpointKey)
    if (!state) {
      return null
    }

    return {
      sourceMessageId: state.sourceMessageId,
      statusMessageId: typeof state.statusMessageId === 'number' ? state.statusMessageId : null,
      contentMessageIds: state.contentMessageIds.filter(
        (messageId): messageId is number => typeof messageId === 'number'
      ),
      lastStatusText: state.lastStatusText,
      lastContentText: state.lastContentText
    }
  }

  private rememberDeliveryState(
    endpointKey: string,
    state: TelegramRemoteDeliveryState
  ): TelegramRemoteDeliveryState {
    this.deps.bindingStore.rememberRemoteDeliveryState(endpointKey, state)
    return state
  }

  private async prepareDeliveryStateForSource(
    target: TelegramTransportTarget,
    endpointKey: string,
    sourceMessageId: string | null,
    state: TelegramRemoteDeliveryState | null
  ): Promise<TelegramRemoteDeliveryState | null> {
    if (!state) {
      return sourceMessageId
        ? {
            sourceMessageId,
            statusMessageId: null,
            contentMessageIds: [],
            lastStatusText: '',
            lastContentText: ''
          }
        : null
    }

    if (sourceMessageId && state.sourceMessageId === sourceMessageId) {
      return state
    }

    await this.deleteStatusMessage(target, state.statusMessageId)
    this.deps.bindingStore.clearRemoteDeliveryState(endpointKey)

    if (!sourceMessageId) {
      return null
    }

    return {
      sourceMessageId,
      statusMessageId: null,
      contentMessageIds: [],
      lastStatusText: '',
      lastContentText: ''
    }
  }

  private async syncStatusMessage(
    target: TelegramTransportTarget,
    endpointKey: string,
    state: TelegramRemoteDeliveryState,
    statusText: string
  ): Promise<TelegramRemoteDeliveryState> {
    const normalized = statusText.trim()
    if (!normalized) {
      return state
    }

    if (state.statusMessageId == null) {
      const statusMessageId = await this.deps.client.sendMessage(target, normalized)
      return this.rememberDeliveryState(endpointKey, {
        ...state,
        statusMessageId,
        lastStatusText: normalized
      })
    }

    if (normalized !== state.lastStatusText) {
      await this.editMessageText(target, {
        type: 'editMessageText',
        messageId: state.statusMessageId,
        text: normalized,
        replyMarkup: null
      })
      return this.rememberDeliveryState(endpointKey, {
        ...state,
        lastStatusText: normalized
      })
    }

    return state
  }

  private async syncContentText(
    target: TelegramTransportTarget,
    endpointKey: string,
    state: TelegramRemoteDeliveryState,
    contentText: string
  ): Promise<TelegramRemoteDeliveryState> {
    const normalized = contentText.trim()
    if (!normalized) {
      return state
    }

    const nextChunks = chunkTelegramText(normalized)
    const previousChunks = state.lastContentText ? chunkTelegramText(state.lastContentText) : []
    const contentMessageIds = [...state.contentMessageIds]

    if (contentMessageIds.length === 0) {
      for (const chunk of nextChunks) {
        contentMessageIds.push(await this.deps.client.sendMessage(target, chunk))
      }
      return this.rememberDeliveryState(endpointKey, {
        ...state,
        contentMessageIds,
        lastContentText: normalized
      })
    }

    const editableIndex = Math.max(0, contentMessageIds.length - 1)
    const retainedCount = Math.min(contentMessageIds.length, nextChunks.length)

    for (let index = editableIndex; index < retainedCount; index += 1) {
      if (previousChunks[index] === nextChunks[index]) {
        continue
      }

      await this.editMessageText(target, {
        type: 'editMessageText',
        messageId: contentMessageIds[index],
        text: nextChunks[index],
        replyMarkup: null
      })
    }

    for (let index = contentMessageIds.length; index < nextChunks.length; index += 1) {
      contentMessageIds.push(await this.deps.client.sendMessage(target, nextChunks[index]))
    }

    return this.rememberDeliveryState(endpointKey, {
      ...state,
      contentMessageIds,
      lastContentText: normalized
    })
  }

  private async syncFinalContentText(
    target: TelegramTransportTarget,
    endpointKey: string,
    state: TelegramRemoteDeliveryState,
    finalText: string
  ): Promise<TelegramRemoteDeliveryState> {
    const normalized = finalText.trim()
    if (!normalized) {
      return state
    }

    const nextChunks = chunkTelegramText(normalized)
    const previousChunks = state.lastContentText ? chunkTelegramText(state.lastContentText) : []
    const contentMessageIds = [...state.contentMessageIds]

    for (let index = 0; index < nextChunks.length; index += 1) {
      if (index < contentMessageIds.length) {
        if (previousChunks[index] === nextChunks[index]) {
          continue
        }

        await this.editMessageText(target, {
          type: 'editMessageText',
          messageId: contentMessageIds[index],
          text: nextChunks[index],
          replyMarkup: null
        })
        continue
      }

      contentMessageIds.push(await this.deps.client.sendMessage(target, nextChunks[index]))
    }

    for (const messageId of contentMessageIds.slice(nextChunks.length)) {
      await this.deleteMessage(target, messageId)
    }

    return this.rememberDeliveryState(endpointKey, {
      ...state,
      contentMessageIds: contentMessageIds.slice(0, nextChunks.length),
      lastContentText: normalized
    })
  }

  private async deleteStatusMessage(
    target: TelegramTransportTarget,
    messageId: number | null
  ): Promise<void> {
    if (messageId == null) {
      return
    }

    await this.deleteMessage(target, messageId)
  }

  private async deleteMessage(target: TelegramTransportTarget, messageId: number): Promise<void> {
    try {
      await this.deps.client.deleteMessage({
        target,
        messageId
      })
    } catch (error) {
      console.warn('[TelegramPoller] Failed to delete message:', {
        target,
        messageId,
        error
      })
    }
  }

  private async sendTyping(target: TelegramTransportTarget): Promise<void> {
    try {
      await this.deps.client.sendChatAction(target, 'typing')
    } catch (error) {
      console.warn('[TelegramPoller] Failed to send typing action:', error)
    }
  }

  private async sendChunkedMessage(target: TelegramTransportTarget, text: string): Promise<void> {
    for (const chunk of chunkTelegramText(text)) {
      await this.deps.client.sendMessage(target, chunk)
    }
  }

  private async sendPendingInteractionPrompt(
    target: TelegramTransportTarget,
    interaction: RemotePendingInteraction
  ): Promise<void> {
    const endpointKey = this.deps.bindingStore.getEndpointKey(target)
    const token = this.deps.bindingStore.createPendingInteractionState(endpointKey, interaction)
    const prompt = buildTelegramPendingInteractionPrompt(interaction, token)

    if (prompt.replyMarkup) {
      await this.deps.client.sendMessage(target, prompt.text, prompt.replyMarkup)
      return
    }

    await this.sendChunkedMessage(target, prompt.text)
  }

  private async dispatchOutboundActions(
    target: TelegramTransportTarget,
    actions: TelegramOutboundAction[]
  ): Promise<void> {
    for (const action of actions) {
      if (action.type === 'sendMessage') {
        if (action.replyMarkup) {
          await this.deps.client.sendMessage(target, action.text, action.replyMarkup)
          continue
        }

        await this.sendChunkedMessage(target, action.text)
        continue
      }

      await this.editMessageText(target, action)
    }
  }

  private async editMessageText(
    target: TelegramTransportTarget,
    action: Extract<TelegramOutboundAction, { type: 'editMessageText' }>
  ): Promise<void> {
    try {
      await this.deps.client.editMessageText({
        target,
        messageId: action.messageId,
        text: action.text,
        replyMarkup: action.replyMarkup ?? undefined
      })
    } catch (error) {
      if (this.isMessageNotModifiedError(error)) {
        return
      }

      throw error
    }
  }

  private async setIncomingReaction(chatId: number, messageId: number): Promise<void> {
    try {
      await this.deps.client.setMessageReaction({
        chatId,
        messageId,
        emoji: TELEGRAM_REMOTE_REACTION_EMOJI
      })
    } catch (error) {
      console.warn('[TelegramPoller] Failed to set message reaction:', error)
    }
  }

  private async clearIncomingReaction(chatId: number, messageId: number): Promise<void> {
    try {
      await this.deps.client.setMessageReaction({
        chatId,
        messageId,
        emoji: null
      })
    } catch (error) {
      console.warn('[TelegramPoller] Failed to clear message reaction:', error)
    }
  }

  private async answerCallbackQuery(
    callbackQueryId: string,
    answer?: {
      text?: string
      showAlert?: boolean
    }
  ): Promise<void> {
    try {
      await this.deps.client.answerCallbackQuery({
        callbackQueryId,
        text: answer?.text,
        showAlert: answer?.showAlert
      })
    } catch (error) {
      if (this.isExpiredCallbackQueryError(error)) {
        return
      }

      console.warn('[TelegramPoller] Failed to answer callback query:', error)
    }
  }

  private createCallbackQueryAcknowledger(callbackQueryId: string): {
    answer: (answer?: { text?: string; showAlert?: boolean }) => Promise<void>
  } {
    let answered = false
    const timer = setTimeout(() => {
      if (answered) {
        return
      }

      answered = true
      void this.answerCallbackQuery(callbackQueryId)
    }, CALLBACK_QUERY_ACK_TIMEOUT_MS)

    return {
      answer: async (answer) => {
        clearTimeout(timer)
        if (answered) {
          return
        }

        answered = true
        await this.answerCallbackQuery(callbackQueryId, answer)
      }
    }
  }

  private isExpiredCallbackQueryError(error: unknown): boolean {
    return (
      error instanceof TelegramApiRequestError &&
      error.code === 400 &&
      /query is too old|query id is invalid|response timeout expired/i.test(error.message)
    )
  }

  private isMessageNotModifiedError(error: unknown): boolean {
    return (
      error instanceof TelegramApiRequestError &&
      error.code === 400 &&
      /message is not modified/i.test(error.message)
    )
  }

  private isFatalPollError(error: unknown): boolean {
    if (error instanceof TelegramApiRequestError) {
      return typeof error.code === 'number' && error.code >= 400 && error.code < 500
        ? error.code !== 429
        : false
    }

    if (!(error instanceof Error)) {
      return false
    }

    return error.message.includes('terminated by other getUpdates request')
  }

  private isCurrentRun(runId: number): boolean {
    return this.runId === runId && !this.stopRequested
  }

  private setStatus(
    patch: Partial<TelegramPollerStatusSnapshot> & {
      state?: TelegramPollerStatusSnapshot['state']
    }
  ): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...patch
    }
    this.deps.onStatusChange?.(this.getStatusSnapshot())
  }
}
