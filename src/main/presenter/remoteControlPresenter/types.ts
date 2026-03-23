import { z } from 'zod'
import type { HookEventName } from '@shared/hooksNotifications'
import type {
  TelegramRemoteRuntimeState,
  TelegramRemoteSettings,
  TelegramRemoteStatus,
  TelegramStreamMode
} from '@shared/presenter'

export const REMOTE_CONTROL_SETTING_KEY = 'remoteControl'
export const TELEGRAM_REMOTE_POLL_LIMIT = 20
export const TELEGRAM_REMOTE_POLL_TIMEOUT_SEC = 30
export const TELEGRAM_OUTBOUND_TEXT_LIMIT = 4096
export const TELEGRAM_PAIR_CODE_TTL_MS = 10 * 60 * 1000
export const TELEGRAM_TYPING_DELAY_MS = 800
export const TELEGRAM_STREAM_POLL_INTERVAL_MS = 450
export const TELEGRAM_STREAM_START_TIMEOUT_MS = 8_000
export const TELEGRAM_PRIVATE_THREAD_DEFAULT = 0
export const TELEGRAM_RECENT_SESSION_LIMIT = 10

export type TelegramEndpointBinding = {
  sessionId: string
  updatedAt: number
}

export type TelegramPairingState = {
  code: string | null
  expiresAt: number | null
}

export interface TelegramRemoteRuntimeConfig {
  enabled: boolean
  allowlist: number[]
  streamMode: TelegramStreamMode
  pollOffset: number
  pairing: TelegramPairingState
  bindings: Record<string, TelegramEndpointBinding>
}

export interface RemoteControlConfig {
  telegram: TelegramRemoteRuntimeConfig
}

export interface TelegramInboundMessage {
  updateId: number
  chatId: number
  messageThreadId: number
  messageId: number
  chatType: string
  fromId: number | null
  text: string
  command: {
    name: string
    args: string
  } | null
}

export interface TelegramPollerStatusSnapshot {
  state: TelegramRemoteRuntimeState
  lastError: string | null
  botUser: TelegramRemoteStatus['botUser']
}

export interface TelegramTransportTarget {
  chatId: number
  messageThreadId: number
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
    pollOffset: 0,
    pairing: {
      code: null,
      expiresAt: null
    },
    bindings: {}
  }
})

const TelegramEndpointBindingSchema = z
  .object({
    sessionId: z.string().min(1),
    updatedAt: z.number().int().nonnegative().optional()
  })
  .strip()

const TelegramPairingStateSchema = z
  .object({
    code: z.string().nullable().optional(),
    expiresAt: z.number().int().nonnegative().nullable().optional()
  })
  .strip()

const TelegramRemoteRuntimeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    allowlist: z.array(z.union([z.number(), z.string()])).optional(),
    streamMode: z.enum(['draft', 'final']).optional(),
    pollOffset: z.number().int().nonnegative().optional(),
    pairing: TelegramPairingStateSchema.optional(),
    bindings: z.record(z.string(), TelegramEndpointBindingSchema).optional()
  })
  .strip()

const RemoteControlConfigSchema = z
  .object({
    telegram: TelegramRemoteRuntimeConfigSchema.optional()
  })
  .strip()

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

export const normalizeRemoteControlConfig = (input: unknown): RemoteControlConfig => {
  const defaults = createDefaultRemoteControlConfig()
  const parsed = RemoteControlConfigSchema.safeParse(input)
  if (!parsed.success) {
    return defaults
  }

  const telegram = parsed.data.telegram ?? {}
  const bindings: Record<string, TelegramEndpointBinding> = {}
  for (const [endpointKey, binding] of Object.entries(telegram.bindings ?? {})) {
    if (!binding?.sessionId?.trim()) {
      continue
    }
    bindings[endpointKey] = {
      sessionId: binding.sessionId.trim(),
      updatedAt: binding.updatedAt ?? Date.now()
    }
  }

  return {
    telegram: {
      enabled: Boolean(telegram.enabled),
      allowlist: normalizeTelegramUserIds(telegram.allowlist),
      streamMode: telegram.streamMode ?? defaults.telegram.streamMode,
      pollOffset:
        typeof telegram.pollOffset === 'number' && telegram.pollOffset >= 0
          ? telegram.pollOffset
          : defaults.telegram.pollOffset,
      pairing: {
        code: telegram.pairing?.code?.trim() || null,
        expiresAt:
          typeof telegram.pairing?.expiresAt === 'number' ? telegram.pairing.expiresAt : null
      },
      bindings
    }
  }
}

export const buildTelegramEndpointKey = (chatId: number, messageThreadId: number): string =>
  `telegram:${chatId}:${messageThreadId || TELEGRAM_PRIVATE_THREAD_DEFAULT}`

export const createPairCode = (): { code: string; expiresAt: number } => {
  const code = `${Math.floor(100000 + Math.random() * 900000)}`
  return {
    code,
    expiresAt: Date.now() + TELEGRAM_PAIR_CODE_TTL_MS
  }
}

export const normalizeTelegramSettingsInput = (
  input: TelegramRemoteSettings
): TelegramRemoteSettings => ({
  botToken: input.botToken?.trim() ?? '',
  remoteEnabled: Boolean(input.remoteEnabled),
  allowedUserIds: normalizeTelegramUserIds(input.allowedUserIds),
  streamMode: input.streamMode === 'final' ? 'final' : 'draft',
  pairCode: input.pairCode?.trim() || null,
  pairCodeExpiresAt: typeof input.pairCodeExpiresAt === 'number' ? input.pairCodeExpiresAt : null,
  hookNotifications: {
    enabled: Boolean(input.hookNotifications.enabled),
    chatId: input.hookNotifications.chatId?.trim() ?? '',
    threadId: input.hookNotifications.threadId?.trim() || undefined,
    events: Array.from(new Set(input.hookNotifications.events ?? []))
  }
})
