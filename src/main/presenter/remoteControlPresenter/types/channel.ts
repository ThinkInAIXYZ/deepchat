import { EventEmitter } from 'node:events'
import { z } from 'zod'
import type { RemoteRuntimeState } from '@shared/presenter'

export const CHANNEL_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
export const CHANNEL_PLUGIN_SCHEMA_VERSION = 1
export const CHANNEL_PLUGIN_API_VERSION = 1

export type ImageAttachment = {
  data: string
  media_type: string
}

export type FileAttachment = {
  filename: string
  data: string
  media_type: string
  size: number
}

export type ChannelMessageEvent = {
  chatId: string
  userId: string
  userName: string
  text: string
  images?: ImageAttachment[]
  files?: FileAttachment[]
}

export type ChannelCommandEvent = {
  chatId: string
  userId: string
  userName: string
  command: string
  args?: string
}

export type SendMessageOptions = {
  parseMode?: string
  replyToMessageId?: number | string
}

export type ChannelAdapterSource = 'builtin' | 'plugin'

export type ChannelAdapterConfig = {
  channelId: string
  channelType: string
  agentId: string
  channelConfig: Record<string, unknown>
  source?: ChannelAdapterSource
  configSignature?: string
}

export type ChannelStatusSnapshot = {
  connected: boolean
  state: RemoteRuntimeState
  lastError: string | null
  botUser: unknown | null
}

export type ChannelStatusEvent = ChannelStatusSnapshot & {
  channelId: string
  channelType: string
}

export type ChannelLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ChannelLogEntry = {
  level: ChannelLogLevel
  message: string
  context?: Record<string, unknown>
}

export interface IChannelAdapter extends EventEmitter {
  readonly channelId: string
  readonly channelType: string
  readonly agentId: string
  readonly connected: boolean
  readonly configSignature?: string
  notifyChatIds: string[]
  connect(): Promise<void>
  disconnect(): Promise<void>
  getStatusSnapshot(): ChannelStatusSnapshot
  sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void>
  sendTypingIndicator(chatId: string): Promise<void>
  onTextUpdate(chatId: string, fullText: string): Promise<void>
  onStreamComplete(chatId: string, finalText: string): Promise<boolean>
  onStreamError(chatId: string, error: string): Promise<void>
}

export interface ChannelFactory {
  readonly source: ChannelAdapterSource
  readonly channelType: string
  create(config: ChannelAdapterConfig): Promise<IChannelAdapter> | IChannelAdapter
}

export const CHANNEL_PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
export const CHANNEL_TYPE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

export type ChannelPluginManifest = {
  schemaVersion: number
  pluginId: string
  apiVersion: number
  entry: string
  types: string
  channelType: string
  configSchema?: string
}

export interface ChannelPluginModule {
  createChannelPlugin(manifest: ChannelPluginManifest): Promise<ChannelFactory> | ChannelFactory
}

const relativePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !value.includes('..') &&
      !value.includes(':'),
    'must be a relative path inside the plugin package'
  )

const ChannelPluginManifestSchema = z
  .object({
    schemaVersion: z.literal(CHANNEL_PLUGIN_SCHEMA_VERSION),
    pluginId: z.string().regex(CHANNEL_PLUGIN_ID_PATTERN),
    apiVersion: z.literal(CHANNEL_PLUGIN_API_VERSION),
    entry: relativePathSchema,
    types: relativePathSchema,
    channelType: z.string().regex(CHANNEL_TYPE_PATTERN),
    configSchema: relativePathSchema.optional()
  })
  .strip()

export const parseChannelPluginManifest = (input: unknown): ChannelPluginManifest =>
  ChannelPluginManifestSchema.parse(input)

export const isChannelPluginManifest = (input: unknown): input is ChannelPluginManifest =>
  ChannelPluginManifestSchema.safeParse(input).success
