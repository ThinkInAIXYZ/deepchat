import path from 'node:path'
import { EventEmitter } from 'node:events'
import { net } from 'electron'
import logger from '@shared/logger'
import {
  CHANNEL_MAX_FILE_SIZE_BYTES,
  type ChannelAdapterConfig,
  type ChannelLogEntry,
  type ChannelLogLevel,
  type ChannelStatusSnapshot,
  type FileAttachment,
  type IChannelAdapter,
  type ImageAttachment,
  type SendMessageOptions
} from './types/channel'

type ChannelAdapterLogger = {
  debug?: (...params: unknown[]) => void
  info?: (...params: unknown[]) => void
  warn?: (...params: unknown[]) => void
  error?: (...params: unknown[]) => void
}

const noopAsync = async (): Promise<void> => {}

export abstract class ChannelAdapter extends EventEmitter implements IChannelAdapter {
  readonly channelId: string
  readonly channelType: string
  readonly agentId: string
  readonly configSignature?: string
  notifyChatIds: string[] = []

  private readonly logger: ChannelAdapterLogger
  private connectPromise: Promise<void> | null = null
  private disconnectPromise: Promise<void> | null = null
  private connectionController: AbortController | null = null
  private connectedState = false
  private statusSnapshot: ChannelStatusSnapshot = {
    connected: false,
    state: 'stopped',
    lastError: null,
    botUser: null
  }

  constructor(
    config: ChannelAdapterConfig,
    options?: {
      configSignature?: string
      logger?: ChannelAdapterLogger
    }
  ) {
    super()
    this.channelId = config.channelId
    this.channelType = config.channelType
    this.agentId = config.agentId
    this.configSignature = options?.configSignature
    this.logger = options?.logger ?? logger
  }

  get connected(): boolean {
    return this.connectedState
  }

  async connect(): Promise<void> {
    if (this.connectedState) {
      return
    }

    if (this.connectPromise) {
      return await this.connectPromise
    }

    this.connectPromise = (async () => {
      const ready = await this.checkReady()
      if (!ready) {
        return
      }

      this.connectionController?.abort()
      this.connectionController = new AbortController()
      this.setStatus({
        connected: false,
        state: 'starting',
        lastError: null
      })

      try {
        await this.performConnect(this.connectionController.signal)
        this.connectedState = true
        this.setStatus({
          connected: true,
          state:
            this.statusSnapshot.state === 'error'
              ? 'running'
              : this.statusSnapshot.state || 'running',
          lastError: null
        })
      } catch (error) {
        this.connectedState = false
        this.setStatus({
          connected: false,
          state: 'error',
          lastError: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    })().finally(() => {
      this.connectPromise = null
    })

    return await this.connectPromise
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) {
      return await this.disconnectPromise
    }

    this.disconnectPromise = (async () => {
      this.connectionController?.abort()
      this.connectionController = null

      try {
        await this.performDisconnect()
      } finally {
        this.connectedState = false
        this.setStatus({
          connected: false,
          state: 'stopped'
        })
      }
    })().finally(() => {
      this.disconnectPromise = null
    })

    return await this.disconnectPromise
  }

  getStatusSnapshot(): ChannelStatusSnapshot {
    return { ...this.statusSnapshot }
  }

  async onTextUpdate(_chatId: string, _fullText: string): Promise<void> {
    await noopAsync()
  }

  async onStreamComplete(_chatId: string, _finalText: string): Promise<boolean> {
    return false
  }

  async onStreamError(_chatId: string, _error: string): Promise<void> {
    await noopAsync()
  }

  protected async checkReady(): Promise<boolean> {
    return true
  }

  protected abstract performConnect(signal: AbortSignal): Promise<void>

  protected abstract performDisconnect(): Promise<void>

  abstract sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void>

  abstract sendTypingIndicator(chatId: string): Promise<void>

  protected setStatus(
    next: Partial<ChannelStatusSnapshot> & { state?: ChannelStatusSnapshot['state'] }
  ): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...next,
      connected: next.connected ?? this.connectedState
    }

    this.emit('statusChange', {
      channelId: this.channelId,
      channelType: this.channelType,
      ...this.statusSnapshot
    })
  }

  protected emitLog(
    level: ChannelLogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    const entry: ChannelLogEntry = {
      level,
      message,
      ...(context ? { context } : {})
    }

    const writer = this.logger[level] ?? this.logger.info
    writer?.(`[ChannelAdapter:${this.channelType}:${this.channelId}] ${message}`, context)
    this.emit('log', entry)
  }

  protected async downloadImageAsBase64(url: string): Promise<ImageAttachment | null> {
    const response = await this.fetchBinaryAttachment(url)
    if (!response) {
      return null
    }

    return {
      data: response.data,
      media_type: response.mediaType
    }
  }

  protected async downloadFileAsBase64(
    url: string,
    filename: string
  ): Promise<FileAttachment | null> {
    const response = await this.fetchBinaryAttachment(url)
    if (!response) {
      return null
    }

    return {
      filename: filename.trim() || path.basename(new URL(url).pathname) || 'attachment',
      data: response.data,
      media_type: response.mediaType,
      size: response.size
    }
  }

  private async fetchBinaryAttachment(url: string): Promise<{
    data: string
    mediaType: string
    size: number
  } | null> {
    const response = await net.fetch(url)
    if (!response.ok) {
      this.emitLog('warn', 'Failed to download channel attachment.', {
        url,
        status: response.status
      })
      return null
    }

    const contentLength = response.headers.get('content-length')
    const declaredSize =
      typeof contentLength === 'string' && contentLength.trim()
        ? Number.parseInt(contentLength, 10)
        : Number.NaN

    if (Number.isFinite(declaredSize) && declaredSize > CHANNEL_MAX_FILE_SIZE_BYTES) {
      this.emitLog('warn', 'Skipped oversized channel attachment.', {
        url,
        size: declaredSize,
        limit: CHANNEL_MAX_FILE_SIZE_BYTES
      })
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.byteLength > CHANNEL_MAX_FILE_SIZE_BYTES) {
      this.emitLog('warn', 'Skipped oversized channel attachment.', {
        url,
        size: buffer.byteLength,
        limit: CHANNEL_MAX_FILE_SIZE_BYTES
      })
      return null
    }

    return {
      data: buffer.toString('base64'),
      mediaType: response.headers.get('content-type')?.trim() || 'application/octet-stream',
      size: buffer.byteLength
    }
  }
}
