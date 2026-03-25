import { z } from 'zod'
import type { HookEventName } from '@shared/hooksNotifications'
import type {
  FeishuPairingSnapshot,
  FeishuRemoteSettings,
  FeishuRemoteStatus,
  RemoteBindingKind,
  RemoteBindingSummary,
  RemoteChannel,
  RemoteRuntimeState,
  TelegramPairingSnapshot,
  TelegramRemoteBindingSummary,
  TelegramRemoteSettings,
  TelegramRemoteStatus,
  TelegramStreamMode
} from '@shared/presenter'

export const REMOTE_CONTROL_SETTING_KEY = 'remoteControl'
export const TELEGRAM_REMOTE_POLL_LIMIT = 20
export const TELEGRAM_REMOTE_POLL_TIMEOUT_SEC = 30
export const TELEGRAM_OUTBOUND_TEXT_LIMIT = 4096
export const TELEGRAM_PAIR_CODE_TTL_MS = 10 * 60 * 1000
export const FEISHU_PAIR_CODE_TTL_MS = TELEGRAM_PAIR_CODE_TTL_MS
export const FEISHU_INBOUND_DEDUP_TTL_MS = 30 * 60 * 1000
export const FEISHU_INBOUND_DEDUP_LIMIT = 2048
export const TELEGRAM_TYPING_DELAY_MS = 800
export const TELEGRAM_STREAM_POLL_INTERVAL_MS = 450
export const TELEGRAM_STREAM_START_TIMEOUT_MS = 8_000
export const TELEGRAM_PRIVATE_THREAD_DEFAULT = 0
export const TELEGRAM_RECENT_SESSION_LIMIT = 10
export const TELEGRAM_MODEL_MENU_TTL_MS = 10 * 60 * 1000
export const TELEGRAM_REMOTE_DEFAULT_AGENT_ID = 'deepchat'
export const FEISHU_REMOTE_DEFAULT_AGENT_ID = TELEGRAM_REMOTE_DEFAULT_AGENT_ID
export const TELEGRAM_REMOTE_REACTION_EMOJI = '🤯'
export const TELEGRAM_REMOTE_COMMANDS = [
  {
    command: 'start',
    description: 'Show remote control status'
  },
  {
    command: 'help',
    description: 'Show available commands'
  },
  {
    command: 'pair',
    description: 'Authorize this Telegram account'
  },
  {
    command: 'new',
    description: 'Start a new DeepChat session'
  },
  {
    command: 'sessions',
    description: 'List recent sessions'
  },
  {
    command: 'use',
    description: 'Bind a listed session'
  },
  {
    command: 'stop',
    description: 'Stop the active generation'
  },
  {
    command: 'open',
    description: 'Open the current session on desktop'
  },
  {
    command: 'model',
    description: 'Switch provider and model'
  },
  {
    command: 'status',
    description: 'Show runtime and session status'
  }
] as const

export const FEISHU_REMOTE_COMMANDS = [
  {
    command: 'start',
    description: 'Show remote control status'
  },
  {
    command: 'help',
    description: 'Show available commands'
  },
  {
    command: 'pair',
    description: 'Authorize this Feishu account'
  },
  {
    command: 'new',
    description: 'Start a new DeepChat session'
  },
  {
    command: 'sessions',
    description: 'List recent sessions'
  },
  {
    command: 'use',
    description: 'Bind a listed session'
  },
  {
    command: 'stop',
    description: 'Stop the active generation'
  },
  {
    command: 'open',
    description: 'Open the current session on desktop'
  },
  {
    command: 'model',
    description: 'View or switch the current model'
  },
  {
    command: 'status',
    description: 'Show runtime and session status'
  }
] as const

export interface RemoteEndpointBindingMeta {
  channel: RemoteChannel
  kind: RemoteBindingKind
  chatId: string
  threadId: string | null
}

export type RemoteEndpointBinding = {
  sessionId: string
  updatedAt: number
  meta?: RemoteEndpointBindingMeta
}

export type TelegramEndpointBinding = RemoteEndpointBinding

export type TelegramPairingState = {
  code: string | null
  expiresAt: number | null
}

export type FeishuPairingState = TelegramPairingState

export type TelegramCommandPayload = {
  name: string
  args: string
}

export interface TelegramRemoteRuntimeConfig {
  enabled: boolean
  allowlist: number[]
  streamMode: TelegramStreamMode
  defaultAgentId: string
  pollOffset: number
  lastFatalError: string | null
  pairing: TelegramPairingState
  bindings: Record<string, TelegramEndpointBinding>
}

export interface FeishuRemoteRuntimeConfig {
  appId: string
  appSecret: string
  verificationToken: string
  encryptKey: string
  enabled: boolean
  defaultAgentId: string
  pairedUserOpenIds: string[]
  lastFatalError: string | null
  pairing: FeishuPairingState
  bindings: Record<string, RemoteEndpointBinding>
}

export interface RemoteControlConfig {
  telegram: TelegramRemoteRuntimeConfig
  feishu: FeishuRemoteRuntimeConfig
}

interface TelegramInboundBase {
  updateId: number
  chatId: number
  messageThreadId: number
  messageId: number
  chatType: string
  fromId: number | null
}

export interface TelegramInboundMessage extends TelegramInboundBase {
  kind: 'message'
  text: string
  command: TelegramCommandPayload | null
}

export interface TelegramInboundCallbackQuery extends TelegramInboundBase {
  kind: 'callback_query'
  callbackQueryId: string
  data: string
}

export type TelegramInboundEvent = TelegramInboundMessage | TelegramInboundCallbackQuery

export interface FeishuRawMention {
  key: string
  id?: {
    open_id?: string
  }
  name?: string
}

export interface FeishuInboundMessage {
  kind: 'message'
  eventId: string
  chatId: string
  threadId: string | null
  messageId: string
  chatType: 'p2p' | 'group'
  senderOpenId: string | null
  text: string
  command: TelegramCommandPayload | null
  mentionedBot: boolean
  mentions: FeishuRawMention[]
}

export interface TelegramInlineKeyboardButton {
  text: string
  callback_data: string
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][]
}

export type TelegramOutboundAction =
  | {
      type: 'sendMessage'
      text: string
      replyMarkup?: TelegramInlineKeyboardMarkup
    }
  | {
      type: 'editMessageText'
      messageId: number
      text: string
      replyMarkup?: TelegramInlineKeyboardMarkup | null
    }

export interface TelegramCallbackAnswer {
  text?: string
  showAlert?: boolean
}

export interface TelegramModelOption {
  modelId: string
  modelName: string
}

export interface TelegramModelProviderOption {
  providerId: string
  providerName: string
  models: TelegramModelOption[]
}

export interface TelegramModelMenuState {
  endpointKey: string
  sessionId: string
  createdAt: number
  providers: TelegramModelProviderOption[]
}

export type TelegramModelMenuCallback =
  | {
      action: 'provider'
      token: string
      providerIndex: number
    }
  | {
      action: 'model'
      token: string
      providerIndex: number
      modelIndex: number
    }
  | {
      action: 'back' | 'cancel'
      token: string
    }

const TELEGRAM_MODEL_MENU_CALLBACK_PREFIX = 'model'
const TELEGRAM_ENDPOINT_KEY_REGEX = /^telegram:(-?\d+):(-?\d+)$/
const FEISHU_ENDPOINT_KEY_REGEX = /^feishu:([^:]+):([^:]+)$/

export const createTelegramCallbackToken = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const buildModelMenuProviderCallbackData = (token: string, providerIndex: number): string =>
  `${TELEGRAM_MODEL_MENU_CALLBACK_PREFIX}:${token}:p:${providerIndex}`

export const buildModelMenuChoiceCallbackData = (
  token: string,
  providerIndex: number,
  modelIndex: number
): string => `${TELEGRAM_MODEL_MENU_CALLBACK_PREFIX}:${token}:m:${providerIndex}:${modelIndex}`

export const buildModelMenuBackCallbackData = (token: string): string =>
  `${TELEGRAM_MODEL_MENU_CALLBACK_PREFIX}:${token}:b`

export const buildModelMenuCancelCallbackData = (token: string): string =>
  `${TELEGRAM_MODEL_MENU_CALLBACK_PREFIX}:${token}:c`

export const parseModelMenuCallbackData = (data: string): TelegramModelMenuCallback | null => {
  const parts = data.trim().split(':')
  if (parts[0] !== TELEGRAM_MODEL_MENU_CALLBACK_PREFIX || !parts[1]) {
    return null
  }

  const token = parts[1]
  const action = parts[2]
  if (action === 'p' && parts[3] !== undefined) {
    const providerIndex = Number.parseInt(parts[3], 10)
    if (Number.isInteger(providerIndex) && providerIndex >= 0) {
      return {
        action: 'provider',
        token,
        providerIndex
      }
    }
  }

  if (action === 'm' && parts[3] !== undefined && parts[4] !== undefined) {
    const providerIndex = Number.parseInt(parts[3], 10)
    const modelIndex = Number.parseInt(parts[4], 10)
    if (
      Number.isInteger(providerIndex) &&
      providerIndex >= 0 &&
      Number.isInteger(modelIndex) &&
      modelIndex >= 0
    ) {
      return {
        action: 'model',
        token,
        providerIndex,
        modelIndex
      }
    }
  }

  if (action === 'b') {
    return {
      action: 'back',
      token
    }
  }

  if (action === 'c') {
    return {
      action: 'cancel',
      token
    }
  }

  return null
}

export interface TelegramPollerStatusSnapshot {
  state: RemoteRuntimeState
  lastError: string | null
  botUser: TelegramRemoteStatus['botUser']
}

export interface FeishuRuntimeStatusSnapshot {
  state: RemoteRuntimeState
  lastError: string | null
  botUser: FeishuRemoteStatus['botUser']
}

export interface TelegramTransportTarget {
  chatId: number
  messageThreadId: number
}

export interface FeishuTransportTarget {
  chatId: string
  threadId: string | null
  replyToMessageId?: string | null
}

export interface TelegramRemoteHookSettingsInput {
  enabled: boolean
  chatId: string
  threadId?: string
  events: HookEventName[]
}

export const createDefaultRemoteControlConfig = (): RemoteControlConfig => ({
  telegram: {
    enabled: false,
    allowlist: [],
    streamMode: 'draft',
    defaultAgentId: TELEGRAM_REMOTE_DEFAULT_AGENT_ID,
    pollOffset: 0,
    lastFatalError: null,
    pairing: {
      code: null,
      expiresAt: null
    },
    bindings: {}
  },
  feishu: {
    appId: '',
    appSecret: '',
    verificationToken: '',
    encryptKey: '',
    enabled: false,
    defaultAgentId: FEISHU_REMOTE_DEFAULT_AGENT_ID,
    pairedUserOpenIds: [],
    lastFatalError: null,
    pairing: {
      code: null,
      expiresAt: null
    },
    bindings: {}
  }
})

const RemoteEndpointBindingMetaSchema = z
  .object({
    channel: z.enum(['telegram', 'feishu']).optional(),
    kind: z.enum(['dm', 'group', 'topic']).optional(),
    chatId: z.string().optional(),
    threadId: z.string().nullable().optional()
  })
  .strip()

const RemoteEndpointBindingSchema = z
  .object({
    sessionId: z.string().min(1),
    updatedAt: z.number().int().nonnegative().optional(),
    meta: RemoteEndpointBindingMetaSchema.optional()
  })
  .strip()

const PairingStateSchema = z
  .object({
    code: z.string().nullable().optional(),
    expiresAt: z.number().int().nonnegative().nullable().optional()
  })
  .strip()

const TelegramRemoteRuntimeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowlist: z.array(z.union([z.number(), z.string()])).optional(),
    defaultAgentId: z.string().optional(),
    streamMode: z.enum(['draft', 'final']).optional(),
    pollOffset: z.number().int().nonnegative().optional(),
    lastFatalError: z.string().nullable().optional(),
    pairing: PairingStateSchema.optional(),
    bindings: z.record(z.string(), z.unknown()).optional()
  })
  .strip()

const FeishuRemoteRuntimeConfigSchema = z
  .object({
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    verificationToken: z.string().optional(),
    encryptKey: z.string().optional(),
    enabled: z.boolean().optional(),
    defaultAgentId: z.string().optional(),
    pairedUserOpenIds: z.array(z.string()).optional(),
    lastFatalError: z.string().nullable().optional(),
    pairing: PairingStateSchema.optional(),
    bindings: z.record(z.string(), z.unknown()).optional()
  })
  .strip()

const RemoteControlConfigSchema = z
  .object({
    telegram: TelegramRemoteRuntimeConfigSchema.optional(),
    feishu: FeishuRemoteRuntimeConfigSchema.optional()
  })
  .strip()

type LegacyTelegramRemoteConfig = z.infer<typeof TelegramRemoteRuntimeConfigSchema>
type LegacyFeishuRemoteConfig = z.infer<typeof FeishuRemoteRuntimeConfigSchema>

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const hasAnyOwn = (value: Record<string, unknown>, keys: string[]): boolean =>
  keys.some((key) => hasOwn(value, key))

const hasBindingPrefix = (value: Record<string, unknown>, prefix: string): boolean => {
  const bindings = value.bindings
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    return false
  }

  return Object.keys(bindings as Record<string, unknown>).some((key) => key.startsWith(prefix))
}

const extractLegacyTelegramConfig = (input: unknown): LegacyTelegramRemoteConfig | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }

  const record = input as Record<string, unknown>
  if (
    !hasAnyOwn(record, ['allowlist', 'streamMode', 'pollOffset', 'lastFatalError']) &&
    !hasBindingPrefix(record, 'telegram:')
  ) {
    return null
  }

  const parsed = TelegramRemoteRuntimeConfigSchema.safeParse(record)
  return parsed.success ? parsed.data : null
}

const extractLegacyFeishuConfig = (input: unknown): LegacyFeishuRemoteConfig | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }

  const record = input as Record<string, unknown>
  if (
    !hasAnyOwn(record, [
      'appId',
      'appSecret',
      'verificationToken',
      'encryptKey',
      'pairedUserOpenIds',
      'lastFatalError'
    ]) &&
    !hasBindingPrefix(record, 'feishu:')
  ) {
    return null
  }

  const parsed = FeishuRemoteRuntimeConfigSchema.safeParse(record)
  return parsed.success ? parsed.data : null
}

const normalizeStringList = (input: Array<string | number> | undefined): string[] =>
  Array.from(
    new Set((input ?? []).map((value) => String(value ?? '').trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right))

export const normalizeTelegramUserIds = (input: Array<number | string> | undefined): number[] => {
  const normalized = new Set<number>()
  for (const value of input ?? []) {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number.parseInt(value.trim(), 10)
          : Number.NaN
    if (Number.isInteger(parsed) && parsed > 0) {
      normalized.add(parsed)
    }
  }
  return Array.from(normalized).sort((left, right) => left - right)
}

export const normalizeFeishuOpenIds = (input: Array<string | number> | undefined): string[] =>
  normalizeStringList(input)

const normalizeBindingMeta = (
  endpointKey: string,
  meta: unknown,
  fallbackChannel: RemoteChannel
): RemoteEndpointBindingMeta | undefined => {
  const parsed = RemoteEndpointBindingMetaSchema.safeParse(meta)
  if (parsed.success && parsed.data.channel && parsed.data.kind && parsed.data.chatId) {
    return {
      channel: parsed.data.channel,
      kind: parsed.data.kind,
      chatId: parsed.data.chatId,
      threadId: parsed.data.threadId ?? null
    }
  }

  if (fallbackChannel === 'telegram') {
    return deriveTelegramBindingMeta(endpointKey) ?? undefined
  }

  return deriveFeishuBindingMeta(endpointKey) ?? undefined
}

const normalizeBindings = (
  rawBindings: Record<string, unknown> | undefined,
  channel: RemoteChannel
): Record<string, RemoteEndpointBinding> => {
  const bindings: Record<string, RemoteEndpointBinding> = {}
  for (const [endpointKey, binding] of Object.entries(rawBindings ?? {})) {
    const parsedBinding = RemoteEndpointBindingSchema.safeParse(binding)
    if (!parsedBinding.success) {
      continue
    }

    const normalizedSessionId = parsedBinding.data.sessionId.trim()
    if (!normalizedSessionId) {
      continue
    }

    bindings[endpointKey] = {
      sessionId: normalizedSessionId,
      updatedAt: parsedBinding.data.updatedAt ?? Date.now(),
      meta: normalizeBindingMeta(endpointKey, parsedBinding.data.meta, channel)
    }
  }
  return bindings
}

export const normalizeRemoteControlConfig = (input: unknown): RemoteControlConfig => {
  const defaults = createDefaultRemoteControlConfig()
  const parsed = RemoteControlConfigSchema.safeParse(input)
  if (!parsed.success) {
    return defaults
  }

  const telegram = parsed.data.telegram ?? extractLegacyTelegramConfig(input) ?? {}
  const feishu = parsed.data.feishu ?? extractLegacyFeishuConfig(input) ?? {}

  return {
    telegram: {
      enabled: Boolean(telegram.enabled),
      allowlist: normalizeTelegramUserIds(telegram.allowlist),
      streamMode: 'draft',
      defaultAgentId: telegram.defaultAgentId?.trim() || defaults.telegram.defaultAgentId,
      pollOffset:
        typeof telegram.pollOffset === 'number' && telegram.pollOffset >= 0
          ? telegram.pollOffset
          : defaults.telegram.pollOffset,
      lastFatalError: telegram.lastFatalError?.trim() || null,
      pairing: {
        code: telegram.pairing?.code?.trim() || null,
        expiresAt:
          typeof telegram.pairing?.expiresAt === 'number' ? telegram.pairing.expiresAt : null
      },
      bindings: normalizeBindings(telegram.bindings, 'telegram')
    },
    feishu: {
      appId: feishu.appId?.trim() || '',
      appSecret: feishu.appSecret?.trim() || '',
      verificationToken: feishu.verificationToken?.trim() || '',
      encryptKey: feishu.encryptKey?.trim() || '',
      enabled: Boolean(feishu.enabled),
      defaultAgentId: feishu.defaultAgentId?.trim() || defaults.feishu.defaultAgentId,
      pairedUserOpenIds: normalizeFeishuOpenIds(feishu.pairedUserOpenIds),
      lastFatalError: feishu.lastFatalError?.trim() || null,
      pairing: {
        code: feishu.pairing?.code?.trim() || null,
        expiresAt: typeof feishu.pairing?.expiresAt === 'number' ? feishu.pairing.expiresAt : null
      },
      bindings: normalizeBindings(feishu.bindings, 'feishu')
    }
  }
}

export const buildTelegramEndpointKey = (chatId: number, messageThreadId: number): string =>
  `telegram:${chatId}:${messageThreadId || TELEGRAM_PRIVATE_THREAD_DEFAULT}`

export const parseTelegramEndpointKey = (
  endpointKey: string
): Pick<TelegramRemoteBindingSummary, 'chatId' | 'messageThreadId'> | null => {
  const match = TELEGRAM_ENDPOINT_KEY_REGEX.exec(endpointKey.trim())
  if (!match) {
    return null
  }

  return {
    chatId: Number.parseInt(match[1], 10),
    messageThreadId: Number.parseInt(match[2], 10)
  }
}

export const buildTelegramBindingMeta = (
  chatId: number,
  messageThreadId: number
): RemoteEndpointBindingMeta => {
  const normalizedThreadId = messageThreadId || TELEGRAM_PRIVATE_THREAD_DEFAULT
  const isTopic = normalizedThreadId > 0
  const isGroup = chatId < 0
  return {
    channel: 'telegram',
    kind: isTopic ? 'topic' : isGroup ? 'group' : 'dm',
    chatId: String(chatId),
    threadId: isTopic ? String(normalizedThreadId) : null
  }
}

export const deriveTelegramBindingMeta = (
  endpointKey: string
): RemoteEndpointBindingMeta | null => {
  const endpoint = parseTelegramEndpointKey(endpointKey)
  if (!endpoint) {
    return null
  }

  return buildTelegramBindingMeta(endpoint.chatId, endpoint.messageThreadId)
}

export const buildFeishuEndpointKey = (chatId: string, threadId?: string | null): string =>
  `feishu:${chatId}:${threadId?.trim() || 'root'}`

export const parseFeishuEndpointKey = (
  endpointKey: string
): Pick<RemoteBindingSummary, 'chatId' | 'threadId'> | null => {
  const match = FEISHU_ENDPOINT_KEY_REGEX.exec(endpointKey.trim())
  if (!match) {
    return null
  }

  return {
    chatId: match[1],
    threadId: match[2] === 'root' ? null : match[2]
  }
}

export const buildFeishuBindingMeta = (params: {
  chatId: string
  threadId?: string | null
  chatType: 'p2p' | 'group'
}): RemoteEndpointBindingMeta => ({
  channel: 'feishu',
  kind: params.chatType === 'p2p' ? 'dm' : params.threadId ? 'topic' : 'group',
  chatId: params.chatId.trim(),
  threadId: params.threadId?.trim() || null
})

export const deriveFeishuBindingMeta = (endpointKey: string): RemoteEndpointBindingMeta | null => {
  const endpoint = parseFeishuEndpointKey(endpointKey)
  if (!endpoint) {
    return null
  }

  return {
    channel: 'feishu',
    kind: endpoint.threadId ? 'topic' : 'group',
    chatId: endpoint.chatId,
    threadId: endpoint.threadId
  }
}

export const buildBindingSummary = (
  endpointKey: string,
  binding: RemoteEndpointBinding
): RemoteBindingSummary | null => {
  const meta =
    binding.meta ?? deriveTelegramBindingMeta(endpointKey) ?? deriveFeishuBindingMeta(endpointKey)

  if (!meta) {
    return null
  }

  return {
    channel: meta.channel,
    endpointKey,
    sessionId: binding.sessionId,
    chatId: meta.chatId,
    threadId: meta.threadId,
    kind: meta.kind,
    updatedAt: binding.updatedAt
  }
}

export const createPairCode = (
  ttlMs: number = TELEGRAM_PAIR_CODE_TTL_MS
): {
  code: string
  expiresAt: number
} => {
  const code = `${Math.floor(100000 + Math.random() * 900000)}`
  return {
    code,
    expiresAt: Date.now() + ttlMs
  }
}

export const normalizeTelegramSettingsInput = (
  input: TelegramRemoteSettings
): TelegramRemoteSettings => ({
  botToken: input.botToken?.trim() ?? '',
  remoteEnabled: Boolean(input.remoteEnabled),
  allowedUserIds: normalizeTelegramUserIds(input.allowedUserIds),
  defaultAgentId: input.defaultAgentId?.trim() || TELEGRAM_REMOTE_DEFAULT_AGENT_ID,
  hookNotifications: {
    enabled: Boolean(input.hookNotifications.enabled),
    chatId: input.hookNotifications.chatId?.trim() ?? '',
    threadId: input.hookNotifications.threadId?.trim() || undefined,
    events: Array.from(new Set(input.hookNotifications.events ?? []))
  }
})

export const normalizeFeishuSettingsInput = (
  input: FeishuRemoteSettings
): FeishuRemoteSettings => ({
  appId: input.appId?.trim() ?? '',
  appSecret: input.appSecret?.trim() ?? '',
  verificationToken: input.verificationToken?.trim() ?? '',
  encryptKey: input.encryptKey?.trim() ?? '',
  remoteEnabled: Boolean(input.remoteEnabled),
  defaultAgentId: input.defaultAgentId?.trim() || FEISHU_REMOTE_DEFAULT_AGENT_ID,
  pairedUserOpenIds: normalizeFeishuOpenIds(input.pairedUserOpenIds)
})

export const buildTelegramPairingSnapshot = (
  settings: TelegramRemoteRuntimeConfig
): TelegramPairingSnapshot => ({
  pairCode: settings.pairing.code,
  pairCodeExpiresAt: settings.pairing.expiresAt,
  allowedUserIds: [...settings.allowlist]
})

export const buildFeishuPairingSnapshot = (
  settings: FeishuRemoteRuntimeConfig
): FeishuPairingSnapshot => ({
  pairCode: settings.pairing.code,
  pairCodeExpiresAt: settings.pairing.expiresAt,
  pairedUserOpenIds: [...settings.pairedUserOpenIds]
})
