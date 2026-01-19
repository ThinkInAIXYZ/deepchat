import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SETTINGS_EVENTS } from '@/events'
import {
  ChatSettingsToolHandler,
  buildChatSettingsToolDefinitions,
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from '@/presenter/agentPresenter/acp/chatSettingsTools'

describe('ChatSettingsToolHandler', () => {
  const configPresenter = {
    getSoundEnabled: vi.fn(),
    setSoundEnabled: vi.fn(),
    getCopyWithCotEnabled: vi.fn(),
    setCopyWithCotEnabled: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    setLanguage: vi.fn(),
    setTheme: vi.fn(),
    getSkillsEnabled: vi.fn()
  } as any

  const skillPresenter = {
    getActiveSkills: vi.fn()
  } as any

  const sessionPresenter = {
    updateConversationSettings: vi.fn()
  } as any

  const windowPresenter = {
    createSettingsWindow: vi.fn(),
    sendToWindow: vi.fn()
  } as any

  const buildHandler = () =>
    new ChatSettingsToolHandler({
      configPresenter,
      skillPresenter,
      sessionPresenter,
      windowPresenter
    })

  beforeEach(() => {
    vi.clearAllMocks()
    configPresenter.getSoundEnabled.mockReturnValue(false)
    configPresenter.getCopyWithCotEnabled.mockReturnValue(true)
    configPresenter.getSetting.mockReturnValue('chat')
    configPresenter.setTheme.mockResolvedValue(false)
    configPresenter.getSkillsEnabled.mockReturnValue(true)
    skillPresenter.getActiveSkills.mockResolvedValue([CHAT_SETTINGS_SKILL_NAME])
    sessionPresenter.updateConversationSettings.mockResolvedValue(undefined)
    windowPresenter.createSettingsWindow.mockResolvedValue(1)
    windowPresenter.sendToWindow.mockReturnValue(true)
  })

  it('rejects toggle when skill is inactive', async () => {
    skillPresenter.getActiveSkills.mockResolvedValue([])
    const handler = buildHandler()
    const result = await handler.toggle({ setting: 'soundEnabled', enabled: true }, 'conv-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('skill_inactive')
    }
    expect(configPresenter.setSoundEnabled).not.toHaveBeenCalled()
  })

  it('rejects invalid toggle payloads', async () => {
    const handler = buildHandler()
    const result = await handler.toggle({ setting: 'soundEnabled', enabled: 'true' }, 'conv-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('invalid_request')
    }
    expect(configPresenter.setSoundEnabled).not.toHaveBeenCalled()
  })

  it('applies soundEnabled toggle', async () => {
    const handler = buildHandler()
    const result = await handler.toggle({ setting: 'soundEnabled', enabled: true }, 'conv-1')

    expect(configPresenter.setSoundEnabled).toHaveBeenCalledWith(true)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.previousValue).toBe(false)
    }
  })

  it('opens settings and navigates to section', async () => {
    const handler = buildHandler()
    const result = await handler.open({ section: 'mcp' }, 'conv-1')

    expect(windowPresenter.createSettingsWindow).toHaveBeenCalled()
    expect(windowPresenter.sendToWindow).toHaveBeenCalledWith(1, SETTINGS_EVENTS.NAVIGATE, {
      routeName: 'settings-mcp',
      section: 'mcp'
    })
    expect(result.ok).toBe(true)
  })
})

describe('buildChatSettingsToolDefinitions', () => {
  it('filters tool definitions by allowedTools', () => {
    const none = buildChatSettingsToolDefinitions([])
    expect(none).toHaveLength(0)

    const toggleOnly = buildChatSettingsToolDefinitions([CHAT_SETTINGS_TOOL_NAMES.toggle])
    expect(toggleOnly.map((def) => def.function.name)).toEqual([CHAT_SETTINGS_TOOL_NAMES.toggle])

    const both = buildChatSettingsToolDefinitions([
      CHAT_SETTINGS_TOOL_NAMES.toggle,
      CHAT_SETTINGS_TOOL_NAMES.open
    ])
    expect(both.map((def) => def.function.name).sort()).toEqual(
      [CHAT_SETTINGS_TOOL_NAMES.toggle, CHAT_SETTINGS_TOOL_NAMES.open].sort()
    )
  })
})
