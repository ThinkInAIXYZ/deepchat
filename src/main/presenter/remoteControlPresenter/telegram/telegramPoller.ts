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
import { chunkTelegramText, createTelegramDraftId } from './telegramOutbound'
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

export class TelegramPoller {
  private stopRequested = false
  private loopPromise: Promise<void> | null = null
  private activePollController: AbortController | null = null
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
    this.loopPromise = this.runLoop().finally(() => {
      this.loopPromise = null
      if (!this.stopRequested && this.statusSnapshot.state !== 'error') {
        this.setStatus({
          state: 'stopped'
        })
      }
    })
  }

  async stop(): Promise<void> {
    this.stopRequested = true
    this.activePollController?.abort()
    const loop = this.loopPromise
    if (loop) {
      await loop
    }
    this.setStatus({
      state: 'stopped'
    })
  }

  getStatusSnapshot(): TelegramPollerStatusSnapshot {
    return { ...this.statusSnapshot }
  }

  private async runLoop(): Promise<void> {
    let backoffIndex = 0

    while (!this.stopRequested) {
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
        if (this.stopRequested) {
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
        if (this.stopRequested) {
          return
        }

        // Persist the next offset before processing to avoid replaying
        // partially-delivered Telegram side effects after restart.
        this.deps.bindingStore.setPollOffset(update.update_id + 1)

        try {
          await this.handleRawUpdate(update)
        } catch (error) {
          if (this.stopRequested) {
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

  private async handleRawUpdate(update: TelegramRawUpdate): Promise<void> {
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
      parsed.kind === 'message' && !parsed.command ? parsed : null
    )

    if (routed.deferred) {
      const deferred = await routed.deferred
      await this.dispatchRouteResult(target, deferred)
    }
  }

  private async dispatchRouteResult(
    target: TelegramTransportTarget,
    routed:
      | Pick<RemoteCommandRouteResult, 'replies' | 'outboundActions' | 'conversation'>
      | RemoteCommandRouteContinuation,
    reactionMessage?: TelegramInboundMessage | null
  ): Promise<void> {
    for (const reply of routed.replies ?? []) {
      await this.sendChunkedMessage(target, reply)
    }

    if (routed.outboundActions?.length) {
      await this.dispatchOutboundActions(target, routed.outboundActions)
    }

    if (!routed.conversation) {
      return
    }

    if (reactionMessage) {
      await this.setIncomingReaction(reactionMessage.chatId, reactionMessage.messageId)
    }

    try {
      await this.deliverConversation(target, routed.conversation)
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
    >
  ): Promise<void> {
    const streamMode = this.deps.bindingStore.getTelegramConfig().streamMode
    if (streamMode === 'final') {
      await this.deliverFinalConversation(target, execution)
      return
    }

    try {
      await this.deliverDraftConversation(target, execution)
    } catch (error) {
      console.warn('[TelegramPoller] Draft streaming failed, falling back to final mode:', error)
      await this.deliverFinalConversation(target, execution)
    }
  }

  private async deliverDraftConversation(
    target: TelegramTransportTarget,
    execution: NonNullable<
      Awaited<ReturnType<RemoteCommandRouter['handleMessage']>>['conversation']
    >
  ): Promise<void> {
    const draftId = createTelegramDraftId()
    const startedAt = Date.now()
    let typingSent = false
    let lastDraftText = ''

    while (!this.stopRequested) {
      const snapshot = await execution.getSnapshot()
      if (snapshot.completed) {
        if (snapshot.text.trim()) {
          await this.sendChunkedMessage(target, snapshot.text)
        }
        if (snapshot.pendingInteraction) {
          await this.sendPendingInteractionPrompt(target, snapshot.pendingInteraction)
        }
        return
      }

      const draftText = snapshot.text.trim() ? chunkTelegramText(snapshot.text)[0] : ''
      if (draftText && draftText !== lastDraftText) {
        await this.deps.client.sendMessageDraft(target, draftId, draftText)
        lastDraftText = draftText
      } else if (!typingSent && Date.now() - startedAt >= TELEGRAM_TYPING_DELAY_MS) {
        typingSent = true
        await this.sendTyping(target)
      }

      await sleep(TELEGRAM_STREAM_POLL_INTERVAL_MS)
    }
  }

  private async deliverFinalConversation(
    target: TelegramTransportTarget,
    execution: NonNullable<
      Awaited<ReturnType<RemoteCommandRouter['handleMessage']>>['conversation']
    >
  ): Promise<void> {
    const startedAt = Date.now()
    let typingSent = false

    while (!this.stopRequested) {
      const snapshot = await execution.getSnapshot()
      if (snapshot.completed) {
        if (snapshot.text.trim()) {
          await this.sendChunkedMessage(target, snapshot.text)
        }
        if (snapshot.pendingInteraction) {
          await this.sendPendingInteractionPrompt(target, snapshot.pendingInteraction)
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
