import type { IAgentSessionPresenter, IConfigPresenter, IWindowPresenter } from '@shared/presenter'
import { createMainKernelRouteRuntime, dispatchDeepchatRoute } from '@/routes'

function createRuntime() {
  const settings = {
    fontSizeLevel: 2,
    fontFamily: 'JetBrains Mono',
    codeFontFamily: 'Fira Code',
    artifactsEffectEnabled: false,
    autoScrollEnabled: true,
    autoCompactionEnabled: true,
    autoCompactionTriggerThreshold: 80,
    autoCompactionRetainRecentPairs: 2,
    contentProtectionEnabled: false,
    notificationsEnabled: true,
    traceDebugEnabled: false,
    copyWithCotEnabled: true,
    loggingEnabled: false
  }

  const configPresenter = {
    getSetting: vi.fn((key: keyof typeof settings) => settings[key]),
    setSetting: vi.fn((key: keyof typeof settings, value: unknown) => {
      ;(settings as Record<string, unknown>)[key] = value
    }),
    getFontFamily: vi.fn(() => settings.fontFamily),
    setFontFamily: vi.fn((value?: string | null) => {
      settings.fontFamily = value ?? ''
    }),
    getCodeFontFamily: vi.fn(() => settings.codeFontFamily),
    setCodeFontFamily: vi.fn((value?: string | null) => {
      settings.codeFontFamily = value ?? ''
    }),
    getAutoScrollEnabled: vi.fn(() => settings.autoScrollEnabled),
    setAutoScrollEnabled: vi.fn((value: boolean) => {
      settings.autoScrollEnabled = value
    }),
    getAutoCompactionEnabled: vi.fn(() => settings.autoCompactionEnabled),
    setAutoCompactionEnabled: vi.fn((value: boolean) => {
      settings.autoCompactionEnabled = value
    }),
    getAutoCompactionTriggerThreshold: vi.fn(() => settings.autoCompactionTriggerThreshold),
    setAutoCompactionTriggerThreshold: vi.fn((value: number) => {
      settings.autoCompactionTriggerThreshold = value
    }),
    getAutoCompactionRetainRecentPairs: vi.fn(() => settings.autoCompactionRetainRecentPairs),
    setAutoCompactionRetainRecentPairs: vi.fn((value: number) => {
      settings.autoCompactionRetainRecentPairs = value
    }),
    getContentProtectionEnabled: vi.fn(() => settings.contentProtectionEnabled),
    setContentProtectionEnabled: vi.fn((value: boolean) => {
      settings.contentProtectionEnabled = value
    }),
    getNotificationsEnabled: vi.fn(() => settings.notificationsEnabled),
    setNotificationsEnabled: vi.fn((value: boolean) => {
      settings.notificationsEnabled = value
    }),
    getSystemFonts: vi.fn().mockResolvedValue(['Inter', 'JetBrains Mono']),
    getCopyWithCotEnabled: vi.fn(() => settings.copyWithCotEnabled),
    setCopyWithCotEnabled: vi.fn((value: boolean) => {
      settings.copyWithCotEnabled = value
    }),
    getLoggingEnabled: vi.fn(() => settings.loggingEnabled),
    setLoggingEnabled: vi.fn((value: boolean) => {
      settings.loggingEnabled = value
    }),
    setTraceDebugEnabled: vi.fn((value: boolean) => {
      settings.traceDebugEnabled = value
    })
  } as unknown as IConfigPresenter

  const agentSessionPresenter = {
    createSession: vi.fn().mockResolvedValue({
      id: 'session-1',
      agentId: 'deepchat',
      title: 'New Chat',
      projectDir: '/workspace',
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled: false,
      subagentMeta: null,
      createdAt: 1,
      updatedAt: 2,
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5.4'
    }),
    getSession: vi.fn().mockResolvedValue({
      id: 'session-1',
      agentId: 'deepchat',
      title: 'Restored',
      projectDir: '/workspace',
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled: false,
      subagentMeta: null,
      createdAt: 1,
      updatedAt: 2,
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5.4'
    }),
    getMessages: vi.fn().mockResolvedValue([
      {
        id: 'message-1',
        sessionId: 'session-1',
        orderSeq: 1,
        role: 'user',
        content: '{"text":"hello"}',
        status: 'sent',
        isContextEdge: 0,
        metadata: '{}',
        createdAt: 1,
        updatedAt: 1
      }
    ]),
    getSessionList: vi.fn().mockResolvedValue([]),
    getActiveSession: vi.fn().mockResolvedValue(null),
    activateSession: vi.fn().mockResolvedValue(undefined),
    deactivateSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    getMessage: vi.fn().mockResolvedValue({
      id: 'message-1',
      sessionId: 'session-1'
    }),
    getAgents: vi.fn().mockResolvedValue([
      {
        id: 'deepchat',
        type: 'deepchat',
        agentType: 'deepchat',
        enabled: true,
        name: 'DeepChat'
      }
    ])
  } as unknown as IAgentSessionPresenter

  const windowPresenter = {
    createSettingsWindow: vi.fn().mockResolvedValue(9)
  } as unknown as IWindowPresenter

  return {
    settings,
    runtime: createMainKernelRouteRuntime({
      configPresenter,
      agentSessionPresenter,
      windowPresenter
    }),
    configPresenter,
    agentSessionPresenter,
    windowPresenter
  }
}

describe('dispatchDeepchatRoute', () => {
  it('reads a typed settings snapshot', async () => {
    const { runtime } = createRuntime()

    const result = await dispatchDeepchatRoute(
      runtime,
      'settings.getSnapshot',
      {
        keys: ['fontSizeLevel', 'fontFamily']
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(result).toEqual({
      version: expect.any(Number),
      values: {
        fontSizeLevel: 2,
        fontFamily: 'JetBrains Mono'
      }
    })
  })

  it('lists system fonts through the settings handler adapter', async () => {
    const { runtime, configPresenter } = createRuntime()

    const result = await dispatchDeepchatRoute(
      runtime,
      'settings.listSystemFonts',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(configPresenter.getSystemFonts).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      fonts: ['Inter', 'JetBrains Mono']
    })
  })

  it('applies typed settings updates through presenter adapters', async () => {
    const { runtime, configPresenter, settings } = createRuntime()

    const result = await dispatchDeepchatRoute(
      runtime,
      'settings.update',
      {
        changes: [
          { key: 'fontSizeLevel', value: 4 },
          { key: 'notificationsEnabled', value: false }
        ]
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(configPresenter.setSetting).toHaveBeenCalledWith('fontSizeLevel', 4)
    expect(configPresenter.setNotificationsEnabled).toHaveBeenCalledWith(false)
    expect(settings.fontSizeLevel).toBe(4)
    expect(settings.notificationsEnabled).toBe(false)
    expect(result).toEqual({
      version: expect.any(Number),
      changedKeys: ['fontSizeLevel', 'notificationsEnabled'],
      values: {
        fontSizeLevel: 4,
        notificationsEnabled: false
      }
    })
  })

  it('dispatches session and chat routes with renderer context', async () => {
    const { runtime, agentSessionPresenter } = createRuntime()

    const createResult = await dispatchDeepchatRoute(
      runtime,
      'sessions.create',
      {
        agentId: 'deepchat',
        message: 'hello world'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(agentSessionPresenter.createSession).toHaveBeenCalledWith(
      {
        agentId: 'deepchat',
        message: 'hello world'
      },
      88
    )
    expect(createResult).toEqual({
      session: expect.objectContaining({
        id: 'session-1'
      })
    })

    await dispatchDeepchatRoute(
      runtime,
      'chat.sendMessage',
      {
        sessionId: 'session-1',
        content: 'follow up'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(agentSessionPresenter.sendMessage).toHaveBeenCalledWith('session-1', 'follow up')
  })

  it('activates, deactivates, and reads the active session through typed routes', async () => {
    const { runtime, agentSessionPresenter } = createRuntime()
    ;(agentSessionPresenter.getActiveSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'session-1',
      agentId: 'deepchat',
      title: 'Restored',
      projectDir: '/workspace',
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentEnabled: false,
      subagentMeta: null,
      createdAt: 1,
      updatedAt: 2,
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-5.4'
    })

    const activateResult = await dispatchDeepchatRoute(
      runtime,
      'sessions.activate',
      {
        sessionId: 'session-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const deactivateResult = await dispatchDeepchatRoute(
      runtime,
      'sessions.deactivate',
      {},
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const activeResult = await dispatchDeepchatRoute(
      runtime,
      'sessions.getActive',
      {},
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(agentSessionPresenter.activateSession).toHaveBeenCalledWith(88, 'session-1')
    expect(agentSessionPresenter.deactivateSession).toHaveBeenCalledWith(88)
    expect(agentSessionPresenter.getActiveSession).toHaveBeenCalledWith(88)
    expect(activateResult).toEqual({ activated: true })
    expect(deactivateResult).toEqual({ deactivated: true })
    expect(activeResult).toEqual({
      session: expect.objectContaining({
        id: 'session-1'
      })
    })
  })

  it('resolves stopStream by requestId when sessionId is omitted', async () => {
    const { runtime, agentSessionPresenter } = createRuntime()

    const result = await dispatchDeepchatRoute(
      runtime,
      'chat.stopStream',
      {
        requestId: 'message-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(agentSessionPresenter.getMessage).toHaveBeenCalledWith('message-1')
    expect(agentSessionPresenter.cancelGeneration).toHaveBeenCalledWith('session-1')
    expect(result).toEqual({ stopped: true })
  })

  it('opens the settings window through the system route', async () => {
    const { runtime, windowPresenter } = createRuntime()

    const result = await dispatchDeepchatRoute(
      runtime,
      'system.openSettings',
      {
        routeName: 'settings-display',
        section: 'fonts'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(windowPresenter.createSettingsWindow).toHaveBeenCalledWith({
      routeName: 'settings-display',
      params: undefined,
      section: 'fonts'
    })
    expect(result).toEqual({ windowId: 9 })
  })
})
