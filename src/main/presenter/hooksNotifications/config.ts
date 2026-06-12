import { randomUUID } from 'node:crypto'
import log from 'electron-log'
import { z } from 'zod'
import {
  DEFAULT_IMPORTANT_HOOK_EVENTS,
  HOOK_EVENT_NAMES,
  HookCommandItem,
  HookEventName,
  HooksNotificationsSettings
} from '@shared/hooksNotifications'

const HookCommandItemSchema = z
  .object({
    id: z.unknown().optional(),
    name: z.unknown().optional(),
    enabled: z.unknown().optional(),
    command: z.unknown().optional(),
    events: z.array(z.string()).optional()
  })
  .strip()

const HooksNotificationsSchema = z
  .object({
    hooks: z.array(z.unknown()).optional()
  })
  .strip()

type LooseHookCommandItem = z.infer<typeof HookCommandItemSchema>

const sanitizeEvents = (events?: string[] | null): HookEventName[] => {
  if (!Array.isArray(events)) {
    return []
  }

  const sanitized = new Set<HookEventName>()
  for (const eventName of events) {
    if (HOOK_EVENT_NAMES.includes(eventName as HookEventName)) {
      sanitized.add(eventName as HookEventName)
    }
  }
  return Array.from(sanitized)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const warnUnknownKeys = (label: string, value: unknown, allowed: string[]) => {
  if (!isRecord(value)) {
    return
  }

  const unknownKeys = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknownKeys.length > 0) {
    log.warn(`[HooksNotifications] Unknown keys at ${label}: ${unknownKeys.join(', ')}`)
  }
}

const normalizeHookItem = (
  input: LooseHookCommandItem | undefined,
  index: number
): HookCommandItem => ({
  id: typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : randomUUID(),
  name:
    typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : `Hook ${index + 1}`,
  enabled: input?.enabled === true,
  command: typeof input?.command === 'string' ? input.command : '',
  events: sanitizeEvents(input?.events)
})

export const createDefaultHookCommand = (index: number): HookCommandItem => ({
  id: randomUUID(),
  name: `Hook ${index + 1}`,
  enabled: false,
  command: '',
  events: [...DEFAULT_IMPORTANT_HOOK_EVENTS]
})

export const createDefaultHooksNotificationsConfig = (): HooksNotificationsSettings => ({
  hooks: []
})

export const normalizeHooksNotificationsConfig = (input: unknown): HooksNotificationsSettings => {
  warnUnknownKeys('hooksNotifications', input, ['hooks'])
  if (isRecord(input) && Array.isArray(input.hooks)) {
    input.hooks.forEach((item, index) => {
      warnUnknownKeys(`hooksNotifications.hooks[${index}]`, item, [
        'id',
        'name',
        'enabled',
        'command',
        'events'
      ])
    })
  }

  const defaults = createDefaultHooksNotificationsConfig()
  const parsed = HooksNotificationsSchema.safeParse(input)
  if (!parsed.success) {
    log.warn('[HooksNotifications] Invalid config, using defaults:', parsed.error?.message)
    return defaults
  }

  const rawHooks = parsed.data.hooks ?? []
  const hooks = rawHooks.reduce<HookCommandItem[]>((items, item, index) => {
    const parsedItem = HookCommandItemSchema.safeParse(item)
    if (!parsedItem.success) {
      log.warn(
        `[HooksNotifications] Invalid hook at index ${index}, skipping: ${parsedItem.error?.message}`
      )
      return items
    }

    items.push(normalizeHookItem(parsedItem.data, items.length))
    return items
  }, [])

  return { hooks }
}
