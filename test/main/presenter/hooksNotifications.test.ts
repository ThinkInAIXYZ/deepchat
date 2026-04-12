import { describe, expect, it, vi } from 'vitest'
import {
  expandHookCommandPlaceholders,
  truncateText
} from '../../../src/main/presenter/hooksNotifications'
import {
  createDefaultHookCommand,
  createDefaultHooksNotificationsConfig,
  normalizeHooksNotificationsConfig
} from '../../../src/main/presenter/hooksNotifications/config'
import { DEFAULT_IMPORTANT_HOOK_EVENTS } from '../../../src/shared/hooksNotifications'

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

  it('expandHookCommandPlaceholders resolves quoted env references on posix', () => {
    expect(
      expandHookCommandPlaceholders(
        'node scripts/hook.js {{event}} {{conversationId}} {{toolName}}',
        'linux'
      )
    ).toBe(
      'node scripts/hook.js "${DEEPCHAT_HOOK_EVENT}" "${DEEPCHAT_CONVERSATION_ID}" "${DEEPCHAT_TOOL_NAME}"'
    )
  })

  it('expandHookCommandPlaceholders resolves quoted env references on windows', () => {
    expect(
      expandHookCommandPlaceholders(
        'powershell -File scripts/hook.ps1 {{event}} {{isTest}}',
        'win32'
      )
    ).toBe('powershell -File scripts/hook.ps1 "%DEEPCHAT_HOOK_EVENT%" "%DEEPCHAT_HOOK_IS_TEST%"')
  })

  it('createDefaultHookCommand uses important events', () => {
    expect(createDefaultHookCommand(0)).toEqual(
      expect.objectContaining({
        name: 'Hook 1',
        enabled: false,
        command: '',
        events: DEFAULT_IMPORTANT_HOOK_EVENTS
      })
    )
  })

  it('normalizeHooksNotificationsConfig sanitizes hook entries', () => {
    const normalized = normalizeHooksNotificationsConfig({
      hooks: [
        {
          id: 'hook-1',
          name: ' Build Hook ',
          enabled: true,
          command: 'echo ok',
          events: ['SessionStart', 'UnknownEvent', 'SessionStart']
        },
        {
          enabled: false,
          command: 123
        }
      ],
      extra: 'ignored'
    })

    expect(normalized.hooks).toHaveLength(2)
    expect(normalized.hooks[0]).toEqual({
      id: 'hook-1',
      name: 'Build Hook',
      enabled: true,
      command: 'echo ok',
      events: ['SessionStart']
    })
    expect(normalized.hooks[1]).toEqual(
      expect.objectContaining({
        name: 'Hook 2',
        enabled: false,
        command: '',
        events: []
      })
    )
    expect(normalized.hooks[1].id).toBeTruthy()
  })

  it('normalizeHooksNotificationsConfig resets legacy config to defaults', () => {
    const defaults = createDefaultHooksNotificationsConfig()
    const normalized = normalizeHooksNotificationsConfig({
      telegram: { enabled: true, botToken: 'token' },
      commands: { enabled: true }
    })

    expect(normalized).toEqual(defaults)
  })

  it('normalizeHooksNotificationsConfig falls back to defaults for invalid input', () => {
    expect(normalizeHooksNotificationsConfig(null)).toEqual(createDefaultHooksNotificationsConfig())
  })
})
