import log from 'electron-log'
import { z } from 'zod'
import {
  DEFAULT_IMPORTANT_HOOK_EVENTS,
  HOOK_EVENT_NAMES,
  HookEventName,
  HooksNotificationsSettings
} from '@shared/hooksNotifications'

const HookCommandConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    command: z.string().optional()
  })
  .strip()

const HookCommandsSchema = z
  .object({
    enabled: z.boolean().optional(),
    events: z.record(z.string(), HookCommandConfigSchema).optional()
  })
  .strip()

const TelegramSchema = z
  .object({
    enabled: z.boolean().optional(),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    threadId: z.union([z.string(), z.number()]).optional(),
    events: z.array(z.string()).optional()
  })
  .strip()

const DiscordSchema = z
  .object({
    enabled: z.boolean().optional(),
    webhookUrl: z.string().optional(),
    events: z.array(z.string()).optional()
  })
  .strip()

const ConfirmoSchema = z
  .object({
    enabled: z.boolean().optional(),
    events: z.array(z.string()).optional()
  })
  .strip()

const HooksNotificationsSchema = z
  .object({
    telegram: TelegramSchema.optional(),
    discord: DiscordSchema.optional(),
    confirmo: ConfirmoSchema.optional(),
    commands: HookCommandsSchema.optional()
  })
  .strip()

const normalizeOptionalString = (value?: string | number | null): string | undefined => {
  if (value === null || value === undefined) return undefined
  const text = String(value).trim()
  return text.length > 0 ? text : undefined
}

const sanitizeEvents = (events?: string[] | null): HookEventName[] => {
  if (!Array.isArray(events)) return []
  const set = new Set<HookEventName>()
  for (const item of events) {
    if (HOOK_EVENT_NAMES.includes(item as HookEventName)) {
      set.add(item as HookEventName)
    }
  }
  return Array.from(set)
}

const createDefaultCommandEvents = () => {
  const events: HooksNotificationsSettings['commands']['events'] =
    {} as HooksNotificationsSettings['commands']['events']
  for (const name of HOOK_EVENT_NAMES) {
    events[name] = { enabled: false, command: '' }
  }
  return events
}

export const createDefaultHooksNotificationsConfig = (): HooksNotificationsSettings => ({
  telegram: {
    enabled: false,
    botToken: '',
    chatId: '',
    threadId: undefined,
    events: [...DEFAULT_IMPORTANT_HOOK_EVENTS]
  },
  discord: {
    enabled: false,
    webhookUrl: '',
    events: [...DEFAULT_IMPORTANT_HOOK_EVENTS]
  },
  confirmo: {
    enabled: false,
    events: [...HOOK_EVENT_NAMES]
  },
  commands: {
    enabled: false,
    events: createDefaultCommandEvents()
  }
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const warnUnknownKeys = (label: string, value: unknown, allowed: string[]) => {
  if (!isRecord(value)) return
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length) {
    log.warn(`[HooksNotifications] Unknown keys at ${label}: ${unknown.join(', ')}`)
  }
}

export const normalizeHooksNotificationsConfig = (input: unknown): HooksNotificationsSettings => {
  warnUnknownKeys('hooksNotifications', input, ['telegram', 'discord', 'confirmo', 'commands'])
  if (isRecord(input)) {
    warnUnknownKeys('hooksNotifications.telegram', input.telegram, [
      'enabled',
      'botToken',
      'chatId',
      'threadId',
      'events'
    ])
    warnUnknownKeys('hooksNotifications.discord', input.discord, [
      'enabled',
      'webhookUrl',
      'events'
    ])
    warnUnknownKeys('hooksNotifications.confirmo', input.confirmo, ['enabled', 'events'])
    warnUnknownKeys('hooksNotifications.commands', input.commands, ['enabled', 'events'])
    const commandInput = isRecord(input.commands) ? input.commands : null
    if (commandInput && isRecord(commandInput.events)) {
      const unknownEvents = Object.keys(commandInput.events).filter(
        (name) => !HOOK_EVENT_NAMES.includes(name as HookEventName)
      )
      if (unknownEvents.length) {
        log.warn(`[HooksNotifications] Unknown command events: ${unknownEvents.join(', ')}`)
      }
    }
  }

  const defaults = createDefaultHooksNotificationsConfig()
  const parsed = HooksNotificationsSchema.safeParse(input)
  if (!parsed.success) {
    log.warn('[HooksNotifications] Invalid config, using defaults:', parsed.error?.message)
    return defaults
  }

  const telegram = (parsed.data.telegram ?? {}) as Partial<HooksNotificationsSettings['telegram']>
  const discord = (parsed.data.discord ?? {}) as Partial<HooksNotificationsSettings['discord']>
  const confirmo = (parsed.data.confirmo ?? {}) as Partial<HooksNotificationsSettings['confirmo']>
  const commands = (parsed.data.commands ?? {}) as Partial<HooksNotificationsSettings['commands']>

  const normalizedCommandEvents: HooksNotificationsSettings['commands']['events'] =
    createDefaultCommandEvents()
  const inputEvents = commands.events ?? {}
  for (const name of HOOK_EVENT_NAMES) {
    const item = inputEvents[name]
    if (item && typeof item === 'object') {
      normalizedCommandEvents[name] = {
        enabled: Boolean((item as { enabled?: boolean }).enabled),
        command:
          typeof (item as { command?: string }).command === 'string'
            ? (item as { command: string }).command
            : ''
      }
    }
  }

  const telegramEvents = sanitizeEvents(telegram.events)
  const discordEvents = sanitizeEvents(discord.events)
  const confirmoEvents = [...HOOK_EVENT_NAMES]

  return {
    telegram: {
      ...defaults.telegram,
      enabled: Boolean(telegram.enabled),
      botToken: telegram.botToken ?? '',
      chatId: telegram.chatId ?? '',
      threadId: normalizeOptionalString(telegram.threadId),
      events: telegramEvents.length ? telegramEvents : [...defaults.telegram.events]
    },
    discord: {
      ...defaults.discord,
      enabled: Boolean(discord.enabled),
      webhookUrl: discord.webhookUrl ?? '',
      events: discordEvents.length ? discordEvents : [...defaults.discord.events]
    },
    confirmo: {
      ...defaults.confirmo,
      enabled: Boolean(confirmo.enabled),
      events: confirmoEvents
    },
    commands: {
      enabled: Boolean(commands.enabled),
      events: normalizedCommandEvents
    }
  }
}
