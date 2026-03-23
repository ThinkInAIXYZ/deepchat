import {
  TELEGRAM_REMOTE_POLL_LIMIT,
  TELEGRAM_REMOTE_POLL_TIMEOUT_SEC,
  TELEGRAM_STREAM_POLL_INTERVAL_MS,
  TELEGRAM_TYPING_DELAY_MS,
  type TelegramPollerStatusSnapshot,
  type TelegramTransportTarget
} from '../types'
import { RemoteBindingStore } from '../services/remoteBindingStore'
import { RemoteCommandRouter } from '../services/remoteCommandRouter'
import { chunkTelegramText, createTelegramDraftId } from './telegramOutbound'
import { TelegramApiRequestError, TelegramClient, type TelegramRawUpdate } from './telegramClient'
import { TelegramParser } from './telegramParser'

const POLL_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

type TelegramPollerDeps = {
  client: TelegramClient
  parser: TelegramParser
  router: RemoteCommandRouter
  bindingStore: RemoteBindingStore
  onStatusChange?: (snapshot: TelegramPollerStatusSnapshot) => void
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
      try {
        await this.ensureBotIdentity()
        this.setStatus({
          state: 'running',
          lastError: null
        })

        const updates = await this.deps.client.getUpdates({
          offset: this.deps.bindingStore.getPollOffset(),
          limit: TELEGRAM_REMOTE_POLL_LIMIT,
          timeout: TELEGRAM_REMOTE_POLL_TIMEOUT_SEC,
          allowedUpdates: ['message'],
          signal: this.createPollSignal()
        })

        backoffIndex = 0

        for (const update of updates) {
          if (this.stopRequested) {
            return
          }

          await this.handleRawUpdate(update)
          this.deps.bindingStore.setPollOffset(update.update_id + 1)
        }
      } catch (error) {
        if (this.stopRequested) {
          return
        }

        const lastError = error instanceof Error ? error.message : String(error)
        if (this.isTerminalConflictError(error)) {
          this.setStatus({
            state: 'error',
            lastError
          })
          return
        }

        const delay = POLL_BACKOFF_MS[Math.min(backoffIndex, POLL_BACKOFF_MS.length - 1)]
        backoffIndex += 1
        this.setStatus({
          state: 'backoff',
          lastError
        })
        await sleep(delay)
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
    const routed = await this.deps.router.handleMessage(parsed)

    for (const reply of routed.replies) {
      await this.sendChunkedMessage(target, reply)
    }

    if (routed.conversation) {
      await this.deliverConversation(target, routed.conversation)
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
        await this.sendChunkedMessage(target, snapshot.text)
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
        await this.sendChunkedMessage(target, snapshot.text)
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

  private isTerminalConflictError(error: unknown): boolean {
    if (error instanceof TelegramApiRequestError) {
      return error.code === 409
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
