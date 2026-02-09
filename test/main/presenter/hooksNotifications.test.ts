import { describe, it, expect, vi } from 'vitest'
import { truncateText, parseRetryAfterMs } from '../../../src/main/presenter/hooksNotifications'
import {
  normalizeHooksNotificationsConfig,
  createDefaultHooksNotificationsConfig
} from '../../../src/main/presenter/hooksNotifications/config'
import {
  DEFAULT_IMPORTANT_HOOK_EVENTS,
  HOOK_EVENT_NAMES
} from '../../../src/shared/hooksNotifications'

vi.mock('electron-log', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}))

describe('hooksNotifications', () => {
  it('truncateText keeps short strings intact', () => {
    expect(truncateText('hello', 10)).toBe('hello')
  })

  it('truncateText truncates with suffix', () => {
    const result = truncateText('abcdefghijklmnopqrstuvwxyz', 20)
    expect(result.endsWith(' ...(truncated)')).toBe(true)
    expect(result.length).toBe(20)
  })

  it('parseRetryAfterMs reads seconds header', () => {
    const response = new Response(null, {
      status: 429,
      headers: { 'retry-after': '2' }
    })
    expect(parseRetryAfterMs(response)).toBe(2000)
  })

  it('parseRetryAfterMs reads ms header', () => {
    const response = new Response(null, {
      status: 429,
      headers: { 'retry-after': '1200' }
    })
    expect(parseRetryAfterMs(response)).toBe(1200)
  })

  it('parseRetryAfterMs reads retry_after from body', () => {
    const response = new Response(null, { status: 429 })
    expect(parseRetryAfterMs(response, { retry_after: 3 })).toBe(3000)
  })

  it('normalizeHooksNotificationsConfig sanitizes events and commands', () => {
    const input = {
      telegram: {
        enabled: true,
        botToken: 'token',
        chatId: 'chat',
        events: ['SessionStart', 'UnknownEvent']
      },
      discord: {
        enabled: true,
        events: []
      },
      confirmo: {
        enabled: true,
        events: ['Stop', 'UnknownEvent']
      },
      commands: {
        enabled: true,
        events: {
          SessionStart: { enabled: true, command: 'echo ok' },
          UnknownEvent: { enabled: true, command: 'bad' }
        }
      },
      extra: 'ignored'
    }

    const normalized = normalizeHooksNotificationsConfig(input)

    expect(normalized.telegram.enabled).toBe(true)
    expect(normalized.telegram.botToken).toBe('token')
    expect(normalized.telegram.chatId).toBe('chat')
    expect(normalized.telegram.events).toEqual(['SessionStart'])

    expect(normalized.discord.enabled).toBe(true)
    expect(normalized.discord.events).toEqual(DEFAULT_IMPORTANT_HOOK_EVENTS)

    expect(normalized.confirmo.enabled).toBe(true)
    expect(normalized.confirmo.events).toEqual([...HOOK_EVENT_NAMES])

    expect(Object.keys(normalized.commands.events)).toEqual([...HOOK_EVENT_NAMES])
    expect(normalized.commands.events.SessionStart.enabled).toBe(true)
    expect(normalized.commands.events.SessionStart.command).toBe('echo ok')
  })

  it('normalizeHooksNotificationsConfig falls back to defaults', () => {
    const defaults = createDefaultHooksNotificationsConfig()
    const normalized = normalizeHooksNotificationsConfig(null)

    expect(normalized).toEqual(defaults)
  })
})
