import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  ChatSettingsToolHandler,
  buildChatSettingsToolDefinitions,
  CHAT_SETTINGS_SKILL_NAME,
  CHAT_SETTINGS_TOOL_NAMES
} from '@/tool/agentTools/chatSettingsTools'

describe('ChatSettingsToolHandler', () => {
  const desktopSettings = { applyDisplayChange: vi.fn() }

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
      desktopSettings,
      skillSettings,
      skillService,
      windowRuntime: windowPresenter
    })

  beforeEach(() => {
    vi.clearAllMocks()
    desktopSettings.applyDisplayChange.mockImplementation(async (change) => ({
      ok: true,
      id: change.id,
      value: change.value,
      previousValue: change.id === 'copyWithCotEnabled' ? true : 'dark',
      appliedAt: 1
    }))
    skillSettings.isEnabled.mockReturnValue(true)
    skillService.getActiveSkills.mockResolvedValue([CHAT_SETTINGS_SKILL_NAME])
    windowPresenter.createSettingsWindow.mockResolvedValue(1)
    windowPresenter.sendSettingsNavigation.mockResolvedValue(true)
  })

  it('rejects toggle when skill is inactive', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    const handler = buildHandler()
    const result = await handler.toggle({ setting: 'copyWithCotEnabled', enabled: true }, 'conv-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('skill_inactive')
    }
    expect(desktopSettings.applyDisplayChange).not.toHaveBeenCalled()
  })

  it('rejects invalid toggle payloads', async () => {
    const handler = buildHandler()
    const result = await handler.toggle({ setting: 'unknownSetting', enabled: 'true' }, 'conv-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('invalid_request')
    }
    expect(desktopSettings.applyDisplayChange).not.toHaveBeenCalled()
  })

  it('applies copyWithCotEnabled toggle', async () => {
    const handler = buildHandler()
    const result = await handler.toggle({ setting: 'copyWithCotEnabled', enabled: false }, 'conv-1')

    expect(desktopSettings.applyDisplayChange).toHaveBeenCalledWith({
      id: 'copyWithCotEnabled',
      value: false
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.previousValue).toBe(true)
    }
  })

  it('accepts a skill activated for the current runtime message', async () => {
    skillService.getActiveSkills.mockResolvedValue([])
    const handler = buildHandler()
    const result = await handler.setTheme({ theme: 'light' }, 'conv-1', [CHAT_SETTINGS_SKILL_NAME])

    expect(result.ok).toBe(true)
    expect(desktopSettings.applyDisplayChange).toHaveBeenCalledWith({ id: 'theme', value: 'light' })
    expect(skillService.getActiveSkills).not.toHaveBeenCalled()
  })

  it('waits for the native owner and returns its applied receipt', async () => {
    const receipt = {
      ok: true as const,
      id: 'theme' as const,
      value: 'light' as const,
      previousValue: 'system' as const,
      appliedAt: 123
    }
    let acknowledge!: (value: typeof receipt) => void
    desktopSettings.applyDisplayChange.mockReturnValueOnce(
      new Promise((resolve) => {
        acknowledge = resolve
      })
    )
    const result = buildHandler().setTheme({ theme: 'light' }, 'conv-1', [CHAT_SETTINGS_SKILL_NAME])
    let settled = false
    void result.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    acknowledge(receipt)
    expect(await result).toEqual(receipt)
  })

  it('reports an asynchronous native mutation failure', async () => {
    desktopSettings.applyDisplayChange.mockRejectedValueOnce(new Error('native owner stopped'))
    expect(await buildHandler().setTheme({ theme: 'light' }, 'conv-1')).toMatchObject({
      ok: false,
      errorCode: 'apply_failed'
    })
  })

  it('propagates dispatch commit failure without changing settings', async () => {
    const handler = buildHandler()
    const journalError = new Error('journal unavailable')
    const beforeMutation = vi.fn(() => {
      throw journalError
    })

    await expect(
      handler.setTheme({ theme: 'light' }, 'conv-1', [CHAT_SETTINGS_SKILL_NAME], beforeMutation)
    ).rejects.toBe(journalError)

    expect(beforeMutation).toHaveBeenCalledWith({ theme: 'light' })
    expect(desktopSettings.applyDisplayChange).not.toHaveBeenCalled()
  })

  it('waits for settings navigation acknowledgement', async () => {
    const acknowledgement = Promise.withResolvers<boolean>()
    windowPresenter.sendSettingsNavigation.mockReturnValueOnce(acknowledgement.promise)
    const handler = buildHandler()
    let settled = false
    const opening = handler.open({ section: 'mcp' }, 'conv-1').then((result) => {
      settled = true
      return result
    })

    await vi.waitFor(() => {
      expect(windowPresenter.sendSettingsNavigation).toHaveBeenCalledWith(1, {
        routeName: 'settings-mcp',
        section: 'mcp'
      })
    })
    expect(settled).toBe(false)
    acknowledgement.resolve(true)
    await expect(opening).resolves.toMatchObject({ ok: true, routeName: 'settings-mcp' })
  })

  it.each([false, new Error('Native window closed')])(
    'reports navigation failure after a negative or failed native receipt (%s)',
    async (outcome) => {
      windowPresenter.sendSettingsNavigation.mockImplementationOnce(async () => {
        if (outcome instanceof Error) throw outcome
        return outcome
      })
      await expect(buildHandler().open({ section: 'mcp' }, 'conv-1')).resolves.toMatchObject({
        ok: false,
        errorCode: 'open_failed'
      })
    }
  )
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
