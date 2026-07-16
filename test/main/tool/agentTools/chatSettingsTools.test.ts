import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  ChatSettingsToolHandler,
  buildChatSettingsToolDefinitions,
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from '@/tool/agentTools/chatSettingsTools'

describe('ChatSettingsToolHandler', () => {
  const providerSettings = {
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    setLanguage: vi.fn(),
    setTheme: vi.fn()
  } as any

  const desktopSettings = {
    getCopyWithCotEnabled: vi.fn(),
    setCopyWithCotEnabled: vi.fn()
  } as any

  const skillSettings = {
    isEnabled: vi.fn()
  } as any

  const skillService = {
    getActiveSkills: vi.fn()
  } as any

  const windowPresenter = {
    createSettingsWindow: vi.fn(),
    sendSettingsNavigation: vi.fn()
  } as any

  const buildHandler = () =>
    new ChatSettingsToolHandler({
      providerSettings,
      desktopSettings,
      skillSettings,
      skillService,
      windowRuntime: windowPresenter
    })

  beforeEach(() => {
    vi.clearAllMocks()
    desktopSettings.getCopyWithCotEnabled.mockReturnValue(true)
    providerSettings.getSetting.mockReturnValue('chat')
    providerSettings.setTheme.mockResolvedValue(false)
    skillSettings.isEnabled.mockReturnValue(true)
    skillService.getActiveSkills.mockResolvedValue([CHAT_SETTINGS_SKILL_NAME])
    windowPresenter.createSettingsWindow.mockResolvedValue(1)
    windowPresenter.sendSettingsNavigation.mockReturnValue(true)
  })

  it('rejects toggle when skill is inactive', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    const handler = buildHandler()
    const result = await handler.toggle({ setting: 'copyWithCotEnabled', enabled: true }, 'conv-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('skill_inactive')
    }
    expect(desktopSettings.setCopyWithCotEnabled).not.toHaveBeenCalled()
  })

  it('rejects invalid toggle payloads', async () => {
    const handler = buildHandler()
    const result = await handler.toggle({ setting: 'unknownSetting', enabled: 'true' }, 'conv-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('invalid_request')
    }
    expect(desktopSettings.setCopyWithCotEnabled).not.toHaveBeenCalled()
  })

  it('applies copyWithCotEnabled toggle', async () => {
    const handler = buildHandler()
    const result = await handler.toggle({ setting: 'copyWithCotEnabled', enabled: false }, 'conv-1')

    expect(desktopSettings.setCopyWithCotEnabled).toHaveBeenCalledWith(false)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.previousValue).toBe(true)
    }
  })

  it('opens settings and navigates to section', async () => {
    const handler = buildHandler()
    const result = await handler.open({ section: 'mcp' }, 'conv-1')

    expect(windowPresenter.createSettingsWindow).toHaveBeenCalled()
    expect(windowPresenter.sendSettingsNavigation).toHaveBeenCalledWith(1, {
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
