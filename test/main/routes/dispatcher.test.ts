import type {
  IAgentSessionPresenter,
  IConfigPresenter,
  IDevicePresenter,
  IFilePresenter,
  ILlmProviderPresenter,
  IProjectPresenter,
  ITabPresenter,
  IWindowPresenter,
  IWorkspacePresenter,
  IYoBrowserPresenter
} from '@shared/presenter'
import { createMainKernelRouteRuntime, dispatchDeepchatRoute } from '@/routes'

type MockWindow = {
  id: number
  maximized: boolean
  fullScreen: boolean
  focused: boolean
  destroyed: boolean
  webContents: {
    id: number
  }
  isDestroyed: () => boolean
  isMaximized: () => boolean
  isFullScreen: () => boolean
}

const { browserWindowState } = vi.hoisted(() => {
  const windows = new Map<number, MockWindow>()

  const createWindow = (
    id: number,
    webContentsId: number,
    overrides: Partial<Pick<MockWindow, 'maximized' | 'fullScreen' | 'focused' | 'destroyed'>> = {}
  ): MockWindow => {
    const window: MockWindow = {
      id,
      maximized: false,
      fullScreen: false,
      focused: true,
      destroyed: false,
      webContents: {
        id: webContentsId
      },
      isDestroyed: () => window.destroyed,
      isMaximized: () => window.maximized,
      isFullScreen: () => window.fullScreen
    }

    Object.assign(window, overrides)
    return window
  }

  return {
    browserWindowState: {
      windows,
      reset() {
        windows.clear()
        windows.set(7, createWindow(7, 42, { focused: true }))
        windows.set(3, createWindow(3, 88, { focused: true }))
        windows.set(19, createWindow(19, 444, { focused: false }))
      }
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: (windowId: number) => browserWindowState.windows.get(windowId) ?? null,
    fromWebContents: (webContents: { id: number }) =>
      [...browserWindowState.windows.values()].find(
        (window) => window.webContents.id === webContents.id
      ) ?? null
  }
}))

function createRuntime() {
  browserWindowState.reset()

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
    privacyModeEnabled: false,
    notificationsEnabled: true,
    traceDebugEnabled: false,
    copyWithCotEnabled: true,
    loggingEnabled: false
  }
  const knowledgeConfigs = [
    {
      id: 'knowledge-1',
      description: 'Local docs',
      embedding: {
        providerId: 'openai',
        modelId: 'text-embedding-3-small'
      },
      dimensions: 1536,
      normalized: true,
      fragmentsNumber: 6,
      enabled: true
    }
  ]

  const preparedFile = {
    name: 'demo.txt',
    path: '/workspace/demo.txt',
    type: 'text',
    mimeType: 'text/plain',
    content: 'demo'
  }

  const workspacePreview = {
    path: '/workspace/src/app.ts',
    relativePath: 'src/app.ts',
    name: 'app.ts',
    mimeType: 'text/plain',
    kind: 'text' as const,
    content: 'export const answer = 42',
    language: 'ts',
    metadata: {
      fileName: 'app.ts',
      fileSize: 21,
      fileCreated: new Date('2024-01-01T00:00:00.000Z'),
      fileModified: new Date('2024-01-02T00:00:00.000Z')
    }
  }

  const browserStatus = {
    initialized: true,
    page: {
      id: 'page-1',
      url: 'https://example.com',
      title: 'Example',
      status: 'ready' as const,
      createdAt: 1,
      updatedAt: 2
    },
    canGoBack: false,
    canGoForward: true,
    visible: true,
    loading: false
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
    getPrivacyModeEnabled: vi.fn(() => settings.privacyModeEnabled),
    setPrivacyModeEnabled: vi.fn((value: boolean) => {
      settings.privacyModeEnabled = value
    }),
    getNotificationsEnabled: vi.fn(() => settings.notificationsEnabled),
    setNotificationsEnabled: vi.fn((value: boolean) => {
      settings.notificationsEnabled = value
    }),
    getSystemFonts: vi.fn().mockResolvedValue(['Inter', 'JetBrains Mono']),
    getProviderModels: vi.fn(() => [
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        group: 'default',
        providerId: 'openai'
      }
    ]),
    getCustomModels: vi.fn(() => []),
    getAgentType: vi.fn(async (agentId: string) => (agentId === 'deepchat' ? 'deepchat' : null)),
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
    }),
    getKnowledgeConfigs: vi.fn(() => knowledgeConfigs),
    setKnowledgeConfigs: vi.fn((configs: typeof knowledgeConfigs) => {
      knowledgeConfigs.splice(0, knowledgeConfigs.length, ...configs)
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
    getSessionGenerationSettings: vi.fn().mockResolvedValue({
      systemPrompt: '',
      temperature: 0.7,
      contextLength: 32000,
      maxTokens: 4096,
      timeout: 5000
    }),
    updateSessionGenerationSettings: vi
      .fn()
      .mockImplementation(async (_sessionId: string, settings: { timeout?: number }) => ({
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 32000,
        maxTokens: 4096,
        timeout: settings.timeout ?? 5000
      })),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    steerActiveTurn: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    getMessage: vi.fn().mockResolvedValue({
      id: 'message-1',
      sessionId: 'session-1'
    }),
    respondToolInteraction: vi.fn().mockResolvedValue({
      resumed: true
    }),
    clearSessionPermissions: vi.fn()
  } as unknown as IAgentSessionPresenter

  const llmProviderPresenter = {
    check: vi.fn().mockResolvedValue({
      isOk: true,
      errorMsg: null
    })
  } as unknown as ILlmProviderPresenter

  const windowPresenter = {
    createSettingsWindow: vi.fn().mockResolvedValue(9),
    previewFile: vi.fn(),
    minimize: vi.fn((windowId: number) => {
      const window = browserWindowState.windows.get(windowId)
      if (window) {
        window.focused = false
      }
    }),
    maximize: vi.fn((windowId: number) => {
      const window = browserWindowState.windows.get(windowId)
      if (window) {
        window.maximized = !window.maximized
      }
    }),
    close: vi.fn((windowId: number) => {
      const window = browserWindowState.windows.get(windowId)
      if (window) {
        window.destroyed = true
      }
    }),
    hide: vi.fn((windowId: number) => {
      const window = browserWindowState.windows.get(windowId)
      if (window) {
        window.focused = false
      }
    }),
    isMainWindowFocused: vi.fn(
      (windowId: number) => browserWindowState.windows.get(windowId)?.focused ?? false
    ),
    getFloatingChatWindow: vi.fn(() => ({
      getWindow: () => browserWindowState.windows.get(19) ?? null
    }))
  } as unknown as IWindowPresenter & {
    getFloatingChatWindow: () => {
      getWindow: () => MockWindow | null
    }
  }

  const devicePresenter = {
    getAppVersion: vi.fn().mockResolvedValue('1.2.3'),
    getDeviceInfo: vi.fn().mockResolvedValue({
      platform: 'win32',
      arch: 'x64',
      cpuModel: 'AMD Ryzen',
      totalMemory: 32,
      osVersion: 'Windows 11',
      osVersionMetadata: [{ name: '23H2', build: 22631 }]
    }),
    selectDirectory: vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['C:/workspace']
    }),
    restartApp: vi.fn().mockResolvedValue(undefined),
    sanitizeSvgContent: vi.fn().mockResolvedValue('<svg />')
  } as unknown as IDevicePresenter

  const projectPresenter = {
    getRecentProjects: vi.fn().mockResolvedValue([
      {
        path: 'C:/workspace',
        name: 'workspace',
        icon: null,
        lastAccessedAt: 123
      }
    ]),
    getEnvironments: vi.fn().mockResolvedValue([
      {
        path: 'C:/workspace',
        name: 'workspace',
        sessionCount: 2,
        lastUsedAt: 456,
        isTemp: false,
        exists: true
      }
    ]),
    openDirectory: vi.fn().mockResolvedValue(undefined),
    selectDirectory: vi.fn().mockResolvedValue('C:/selected-workspace')
  } as unknown as IProjectPresenter

  const filePresenter = {
    getMimeType: vi.fn().mockResolvedValue('text/plain'),
    prepareFile: vi.fn().mockResolvedValue(preparedFile),
    prepareDirectory: vi.fn().mockResolvedValue({
      name: 'workspace',
      path: '/workspace',
      type: 'directory'
    }),
    readFile: vi.fn().mockResolvedValue('hello world'),
    isDirectory: vi.fn().mockResolvedValue(true),
    writeImageBase64: vi.fn().mockResolvedValue('/tmp/capture.png')
  } as unknown as IFilePresenter

  const workspacePresenter = {
    registerWorkspace: vi.fn().mockResolvedValue(undefined),
    registerWorkdir: vi.fn().mockResolvedValue(undefined),
    unregisterWorkspace: vi.fn().mockResolvedValue(undefined),
    unregisterWorkdir: vi.fn().mockResolvedValue(undefined),
    watchWorkspace: vi.fn().mockResolvedValue(undefined),
    unwatchWorkspace: vi.fn().mockResolvedValue(undefined),
    readDirectory: vi.fn().mockResolvedValue([
      {
        name: 'src',
        path: '/workspace/src',
        isDirectory: true
      }
    ]),
    expandDirectory: vi.fn().mockResolvedValue([
      {
        name: 'app.ts',
        path: '/workspace/src/app.ts',
        isDirectory: false
      }
    ]),
    revealFileInFolder: vi.fn().mockResolvedValue(undefined),
    openFile: vi.fn().mockResolvedValue(undefined),
    readFilePreview: vi.fn().mockResolvedValue(workspacePreview),
    resolveMarkdownLinkedFile: vi.fn().mockResolvedValue({
      path: '/workspace/docs/guide.md',
      name: 'guide.md',
      relativePath: 'docs/guide.md',
      workspaceRoot: '/workspace'
    }),
    getGitStatus: vi.fn().mockResolvedValue({
      workspacePath: '/workspace',
      branch: 'main',
      ahead: 0,
      behind: 0,
      changes: []
    }),
    getGitDiff: vi.fn().mockResolvedValue({
      workspacePath: '/workspace',
      filePath: '/workspace/src/app.ts',
      relativePath: 'src/app.ts',
      staged: '',
      unstaged: 'diff --git a/src/app.ts b/src/app.ts'
    }),
    searchFiles: vi.fn().mockResolvedValue([
      {
        name: 'app.ts',
        path: '/workspace/src/app.ts',
        isDirectory: false
      }
    ])
  } as unknown as IWorkspacePresenter

  const yoBrowserPresenter = {
    getBrowserStatus: vi.fn().mockResolvedValue(browserStatus),
    loadUrl: vi.fn(
      async (sessionId: string, url: string, timeoutMs?: number, hostWindowId?: number) => ({
        ...browserStatus,
        page: {
          ...browserStatus.page,
          id: `${sessionId}-${hostWindowId ?? 'none'}`,
          url,
          updatedAt: timeoutMs ?? 2
        }
      })
    ),
    attachSessionBrowser: vi.fn().mockResolvedValue(true),
    updateSessionBrowserBounds: vi.fn().mockResolvedValue(undefined),
    detachSessionBrowser: vi.fn().mockResolvedValue(undefined),
    destroySessionBrowser: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined)
  } as unknown as IYoBrowserPresenter

  const tabPresenter = {
    onRendererTabReady: vi.fn().mockResolvedValue(undefined),
    onRendererTabActivated: vi.fn().mockResolvedValue(undefined),
    captureTabArea: vi.fn().mockResolvedValue('data:image/png;base64,capture'),
    stitchImagesWithWatermark: vi.fn().mockResolvedValue('data:image/png;base64,stitched')
  } as unknown as ITabPresenter

  return {
    settings,
    runtime: createMainKernelRouteRuntime({
      configPresenter,
      llmProviderPresenter,
      agentSessionPresenter,
      windowPresenter,
      devicePresenter,
      projectPresenter,
      filePresenter,
      workspacePresenter,
      yoBrowserPresenter,
      tabPresenter
    }),
    configPresenter,
    llmProviderPresenter,
    agentSessionPresenter,
    windowPresenter,
    devicePresenter,
    projectPresenter,
    filePresenter,
    workspacePresenter,
    yoBrowserPresenter,
    tabPresenter
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
          { key: 'privacyModeEnabled', value: true }
        ]
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(configPresenter.setSetting).toHaveBeenCalledWith('fontSizeLevel', 4)
    expect(configPresenter.setPrivacyModeEnabled).toHaveBeenCalledWith(true)
    expect(settings.fontSizeLevel).toBe(4)
    expect(settings.privacyModeEnabled).toBe(true)
    expect(result).toEqual({
      version: expect.any(Number),
      changedKeys: ['fontSizeLevel', 'privacyModeEnabled'],
      values: {
        fontSizeLevel: 4,
        privacyModeEnabled: true
      }
    })
  })

  it('dispatches built-in knowledge config routes through ConfigPresenter', async () => {
    const { runtime, configPresenter } = createRuntime()
    const nextConfigs = [
      {
        id: 'knowledge-2',
        description: 'Updated local docs',
        embedding: {
          providerId: 'openai',
          modelId: 'text-embedding-3-small'
        },
        rerank: {
          providerId: 'openai',
          modelId: 'rerank-model'
        },
        dimensions: 1536,
        normalized: true,
        chunkSize: 800,
        chunkOverlap: 120,
        fragmentsNumber: 8,
        separators: ['\n\n', '\n'],
        enabled: false
      }
    ]

    const getResult = await dispatchDeepchatRoute(
      runtime,
      'config.getKnowledgeConfigs',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const setResult = await dispatchDeepchatRoute(
      runtime,
      'config.setKnowledgeConfigs',
      {
        configs: nextConfigs
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(getResult).toEqual({
      configs: [
        expect.objectContaining({
          id: 'knowledge-1'
        })
      ]
    })
    expect(configPresenter.setKnowledgeConfigs).toHaveBeenCalledWith(nextConfigs)
    expect(setResult).toEqual({
      configs: nextConfigs
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

    await dispatchDeepchatRoute(
      runtime,
      'chat.steerActiveTurn',
      {
        sessionId: 'session-1',
        content: 'refine the active answer'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(agentSessionPresenter.steerActiveTurn).toHaveBeenCalledWith(
      'session-1',
      'refine the active answer'
    )
  })

  it('dispatches session generation settings routes without dropping timeout', async () => {
    const { runtime, agentSessionPresenter } = createRuntime()

    const updateResult = await dispatchDeepchatRoute(
      runtime,
      'sessions.updateGenerationSettings',
      {
        sessionId: 'session-1',
        settings: {
          timeout: 5000
        }
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const getResult = await dispatchDeepchatRoute(
      runtime,
      'sessions.getGenerationSettings',
      {
        sessionId: 'session-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(agentSessionPresenter.updateSessionGenerationSettings).toHaveBeenCalledWith(
      'session-1',
      {
        timeout: 5000
      }
    )
    expect(updateResult).toEqual({
      settings: {
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 32000,
        maxTokens: 4096,
        timeout: 5000
      }
    })
    expect(agentSessionPresenter.getSessionGenerationSettings).toHaveBeenCalledWith('session-1')
    expect(getResult).toEqual({
      settings: {
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 32000,
        maxTokens: 4096,
        timeout: 5000
      }
    })
  })

  it('dispatches provider query and tool interaction routes through typed services', async () => {
    const { runtime, configPresenter, llmProviderPresenter, agentSessionPresenter } =
      createRuntime()

    const modelsResult = await dispatchDeepchatRoute(
      runtime,
      'providers.listModels',
      {
        providerId: 'openai'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const checkResult = await dispatchDeepchatRoute(
      runtime,
      'providers.testConnection',
      {
        providerId: 'openai',
        modelId: 'gpt-5.4'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const interactionResult = await dispatchDeepchatRoute(
      runtime,
      'chat.respondToolInteraction',
      {
        sessionId: 'session-1',
        messageId: 'message-1',
        toolCallId: 'tool-1',
        response: {
          kind: 'permission',
          granted: true
        }
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(configPresenter.getProviderModels).toHaveBeenCalledWith('openai')
    expect(llmProviderPresenter.check).toHaveBeenCalledWith('openai', 'gpt-5.4')
    expect(agentSessionPresenter.respondToolInteraction).toHaveBeenCalledWith(
      'session-1',
      'message-1',
      'tool-1',
      {
        kind: 'permission',
        granted: true
      }
    )
    expect(modelsResult).toEqual({
      providerModels: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          group: 'default',
          providerId: 'openai'
        }
      ],
      customModels: []
    })
    expect(checkResult).toEqual({
      isOk: true,
      errorMsg: null
    })
    expect(interactionResult).toEqual({
      accepted: true,
      resumed: true
    })
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

  it('dispatches phase3 window routes with current window state', async () => {
    const { runtime, windowPresenter } = createRuntime()

    const initialState = await dispatchDeepchatRoute(
      runtime,
      'window.getCurrentState',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const minimizedState = await dispatchDeepchatRoute(
      runtime,
      'window.minimizeCurrent',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const maximizedState = await dispatchDeepchatRoute(
      runtime,
      'window.toggleMaximizeCurrent',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const previewResult = await dispatchDeepchatRoute(
      runtime,
      'window.previewFile',
      {
        filePath: 'C:/workspace/README.md'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const closeFloatingResult = await dispatchDeepchatRoute(
      runtime,
      'window.closeFloatingCurrent',
      {},
      {
        webContentsId: 444,
        windowId: 7
      }
    )

    const closeResult = await dispatchDeepchatRoute(
      runtime,
      'window.closeCurrent',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(initialState).toEqual({
      state: {
        windowId: 7,
        exists: true,
        isMaximized: false,
        isFullScreen: false,
        isFocused: true
      }
    })
    expect(windowPresenter.minimize).toHaveBeenCalledWith(7)
    expect(minimizedState).toEqual({
      state: {
        windowId: 7,
        exists: true,
        isMaximized: false,
        isFullScreen: false,
        isFocused: false
      }
    })
    expect(windowPresenter.maximize).toHaveBeenCalledWith(7)
    expect(maximizedState).toEqual({
      state: {
        windowId: 7,
        exists: true,
        isMaximized: true,
        isFullScreen: false,
        isFocused: false
      }
    })
    expect(windowPresenter.previewFile).toHaveBeenCalledWith('C:/workspace/README.md')
    expect(previewResult).toEqual({ previewed: true })
    expect(windowPresenter.hide).toHaveBeenCalledWith(19)
    expect(closeFloatingResult).toEqual({ closed: true })
    expect(windowPresenter.close).toHaveBeenCalledWith(7)
    expect(closeResult).toEqual({ closed: true })
  })

  it('dispatches phase3 device, project, file, and workspace routes', async () => {
    const { runtime, devicePresenter, projectPresenter, filePresenter, workspacePresenter } =
      createRuntime()

    const appVersion = await dispatchDeepchatRoute(
      runtime,
      'device.getAppVersion',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const deviceInfo = await dispatchDeepchatRoute(
      runtime,
      'device.getInfo',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const directorySelection = await dispatchDeepchatRoute(
      runtime,
      'device.selectDirectory',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const restartResult = await dispatchDeepchatRoute(
      runtime,
      'device.restartApp',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const sanitizeResult = await dispatchDeepchatRoute(
      runtime,
      'device.sanitizeSvg',
      {
        svgContent: '<svg unsafe="1" />'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const recentProjects = await dispatchDeepchatRoute(
      runtime,
      'project.listRecent',
      {
        limit: 5
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const environments = await dispatchDeepchatRoute(
      runtime,
      'project.listEnvironments',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const openDirectoryResult = await dispatchDeepchatRoute(
      runtime,
      'project.openDirectory',
      {
        path: 'C:/workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const selectedDirectory = await dispatchDeepchatRoute(
      runtime,
      'project.selectDirectory',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const mimeType = await dispatchDeepchatRoute(
      runtime,
      'file.getMimeType',
      {
        path: '/workspace/demo.txt'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const preparedFile = await dispatchDeepchatRoute(
      runtime,
      'file.prepareFile',
      {
        path: '/workspace/demo.txt',
        mimeType: 'text/plain'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const preparedDirectory = await dispatchDeepchatRoute(
      runtime,
      'file.prepareDirectory',
      {
        path: '/workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const readFile = await dispatchDeepchatRoute(
      runtime,
      'file.readFile',
      {
        path: '/workspace/demo.txt'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const isDirectory = await dispatchDeepchatRoute(
      runtime,
      'file.isDirectory',
      {
        path: '/workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const imagePath = await dispatchDeepchatRoute(
      runtime,
      'file.writeImageBase64',
      {
        name: 'capture.png',
        content: 'data:image/png;base64,abc'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const registerWorkspace = await dispatchDeepchatRoute(
      runtime,
      'workspace.register',
      {
        workspacePath: '/workspace',
        mode: 'workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const registerWorkdir = await dispatchDeepchatRoute(
      runtime,
      'workspace.register',
      {
        workspacePath: '/workspace',
        mode: 'workdir'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const readDirectory = await dispatchDeepchatRoute(
      runtime,
      'workspace.readDirectory',
      {
        path: '/workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const preview = await dispatchDeepchatRoute(
      runtime,
      'workspace.readFilePreview',
      {
        path: '/workspace/src/app.ts'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const gitStatus = await dispatchDeepchatRoute(
      runtime,
      'workspace.getGitStatus',
      {
        workspacePath: '/workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const gitDiff = await dispatchDeepchatRoute(
      runtime,
      'workspace.getGitDiff',
      {
        workspacePath: '/workspace',
        filePath: '/workspace/src/app.ts'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const resolution = await dispatchDeepchatRoute(
      runtime,
      'workspace.resolveMarkdownLinkedFile',
      {
        workspacePath: '/workspace',
        href: './docs/guide.md',
        sourceFilePath: '/workspace/README.md'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const searchResult = await dispatchDeepchatRoute(
      runtime,
      'workspace.searchFiles',
      {
        workspacePath: '/workspace',
        query: 'app'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const openFileResult = await dispatchDeepchatRoute(
      runtime,
      'workspace.openFile',
      {
        path: '/workspace/src/app.ts'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const revealResult = await dispatchDeepchatRoute(
      runtime,
      'workspace.revealFileInFolder',
      {
        path: '/workspace/src/app.ts'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const unwatchResult = await dispatchDeepchatRoute(
      runtime,
      'workspace.unwatch',
      {
        workspacePath: '/workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const unregisterResult = await dispatchDeepchatRoute(
      runtime,
      'workspace.unregister',
      {
        workspacePath: '/workspace',
        mode: 'workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(devicePresenter.getAppVersion).toHaveBeenCalledTimes(1)
    expect(appVersion).toEqual({ version: '1.2.3' })
    expect(deviceInfo).toEqual({
      info: {
        platform: 'win32',
        arch: 'x64',
        cpuModel: 'AMD Ryzen',
        totalMemory: 32,
        osVersion: 'Windows 11',
        osVersionMetadata: [{ name: '23H2', build: 22631 }]
      }
    })
    expect(directorySelection).toEqual({
      canceled: false,
      filePaths: ['C:/workspace']
    })
    expect(devicePresenter.restartApp).toHaveBeenCalledTimes(1)
    expect(restartResult).toEqual({ restarted: true })
    expect(sanitizeResult).toEqual({ content: '<svg />' })

    expect(projectPresenter.getRecentProjects).toHaveBeenCalledWith(5)
    expect(recentProjects).toEqual({
      projects: [
        {
          path: 'C:/workspace',
          name: 'workspace',
          icon: null,
          lastAccessedAt: 123
        }
      ]
    })
    expect(environments).toEqual({
      environments: [
        {
          path: 'C:/workspace',
          name: 'workspace',
          sessionCount: 2,
          lastUsedAt: 456,
          isTemp: false,
          exists: true
        }
      ]
    })
    expect(projectPresenter.openDirectory).toHaveBeenCalledWith('C:/workspace')
    expect(openDirectoryResult).toEqual({ opened: true })
    expect(selectedDirectory).toEqual({ path: 'C:/selected-workspace' })

    expect(filePresenter.getMimeType).toHaveBeenCalledWith('/workspace/demo.txt')
    expect(mimeType).toEqual({ mimeType: 'text/plain' })
    expect(preparedFile).toEqual({
      file: {
        name: 'demo.txt',
        path: '/workspace/demo.txt',
        type: 'text',
        mimeType: 'text/plain',
        content: 'demo'
      }
    })
    expect(preparedDirectory).toEqual({
      file: {
        name: 'workspace',
        path: '/workspace',
        type: 'directory'
      }
    })
    expect(readFile).toEqual({ content: 'hello world' })
    expect(isDirectory).toEqual({ isDirectory: true })
    expect(imagePath).toEqual({ path: '/tmp/capture.png' })

    expect(workspacePresenter.registerWorkspace).toHaveBeenCalledWith('/workspace')
    expect(registerWorkspace).toEqual({ registered: true })
    expect(workspacePresenter.registerWorkdir).toHaveBeenCalledWith('/workspace')
    expect(registerWorkdir).toEqual({ registered: true })
    expect(readDirectory).toEqual({
      nodes: [
        {
          name: 'src',
          path: '/workspace/src',
          isDirectory: true
        }
      ]
    })
    expect(preview).toEqual({
      preview: expect.objectContaining({
        path: '/workspace/src/app.ts',
        name: 'app.ts',
        relativePath: 'src/app.ts'
      })
    })
    expect(gitStatus).toEqual({
      state: {
        workspacePath: '/workspace',
        branch: 'main',
        ahead: 0,
        behind: 0,
        changes: []
      }
    })
    expect(gitDiff).toEqual({
      diff: {
        workspacePath: '/workspace',
        filePath: '/workspace/src/app.ts',
        relativePath: 'src/app.ts',
        staged: '',
        unstaged: 'diff --git a/src/app.ts b/src/app.ts'
      }
    })
    expect(resolution).toEqual({
      resolution: {
        path: '/workspace/docs/guide.md',
        name: 'guide.md',
        relativePath: 'docs/guide.md',
        workspaceRoot: '/workspace'
      }
    })
    expect(searchResult).toEqual({
      nodes: [
        {
          name: 'app.ts',
          path: '/workspace/src/app.ts',
          isDirectory: false
        }
      ]
    })
    expect(workspacePresenter.openFile).toHaveBeenCalledWith('/workspace/src/app.ts')
    expect(openFileResult).toEqual({ opened: true })
    expect(workspacePresenter.revealFileInFolder).toHaveBeenCalledWith('/workspace/src/app.ts')
    expect(revealResult).toEqual({ revealed: true })
    expect(workspacePresenter.unwatchWorkspace).toHaveBeenCalledWith('/workspace')
    expect(unwatchResult).toEqual({ watching: false })
    expect(workspacePresenter.unregisterWorkspace).toHaveBeenCalledWith('/workspace')
    expect(unregisterResult).toEqual({ unregistered: true })
  })

  it('dispatches phase3 browser routes with host window context', async () => {
    const { runtime, yoBrowserPresenter } = createRuntime()

    const statusResult = await dispatchDeepchatRoute(
      runtime,
      'browser.getStatus',
      {
        sessionId: 'session-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )
    const loadResult = await dispatchDeepchatRoute(
      runtime,
      'browser.loadUrl',
      {
        sessionId: 'session-1',
        url: 'https://example.com/docs',
        timeoutMs: 5000
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )
    const attachResult = await dispatchDeepchatRoute(
      runtime,
      'browser.attachCurrentWindow',
      {
        sessionId: 'session-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )
    const updateResult = await dispatchDeepchatRoute(
      runtime,
      'browser.updateCurrentWindowBounds',
      {
        sessionId: 'session-1',
        bounds: {
          x: 10,
          y: 20,
          width: 400,
          height: 300
        },
        visible: true
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )
    const backResult = await dispatchDeepchatRoute(
      runtime,
      'browser.goBack',
      {
        sessionId: 'session-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )
    const detachResult = await dispatchDeepchatRoute(
      runtime,
      'browser.detach',
      {
        sessionId: 'session-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )
    const destroyResult = await dispatchDeepchatRoute(
      runtime,
      'browser.destroy',
      {
        sessionId: 'session-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(statusResult).toEqual({
      status: expect.objectContaining({
        initialized: true,
        visible: true
      })
    })
    expect(yoBrowserPresenter.loadUrl).toHaveBeenCalledWith(
      'session-1',
      'https://example.com/docs',
      5000,
      3
    )
    expect(loadResult).toEqual({
      status: expect.objectContaining({
        page: expect.objectContaining({
          id: 'session-1-3',
          url: 'https://example.com/docs'
        })
      })
    })
    expect(yoBrowserPresenter.attachSessionBrowser).toHaveBeenCalledWith('session-1', 3)
    expect(attachResult).toEqual({ attached: true })
    expect(yoBrowserPresenter.updateSessionBrowserBounds).toHaveBeenCalledWith(
      'session-1',
      3,
      {
        x: 10,
        y: 20,
        width: 400,
        height: 300
      },
      true
    )
    expect(updateResult).toEqual({ updated: true })
    expect(yoBrowserPresenter.goBack).toHaveBeenCalledWith('session-1')
    expect(backResult).toEqual({
      status: expect.objectContaining({
        initialized: true
      })
    })
    expect(yoBrowserPresenter.detachSessionBrowser).toHaveBeenCalledWith('session-1')
    expect(detachResult).toEqual({ detached: true })
    expect(yoBrowserPresenter.destroySessionBrowser).toHaveBeenCalledWith('session-1')
    expect(destroyResult).toEqual({ destroyed: true })
  })

  it('dispatches phase3 tab routes through the renderer tab adapter', async () => {
    const { runtime, tabPresenter } = createRuntime()

    const readyResult = await dispatchDeepchatRoute(
      runtime,
      'tab.notifyRendererReady',
      {},
      {
        webContentsId: 88,
        windowId: 3
      }
    )
    const activatedResult = await dispatchDeepchatRoute(
      runtime,
      'tab.notifyRendererActivated',
      {
        sessionId: 'session-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )
    const captureResult = await dispatchDeepchatRoute(
      runtime,
      'tab.captureCurrentArea',
      {
        rect: {
          x: 0,
          y: 0,
          width: 100,
          height: 80
        }
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )
    const stitchResult = await dispatchDeepchatRoute(
      runtime,
      'tab.stitchImagesWithWatermark',
      {
        images: ['data:image/png;base64,1', 'data:image/png;base64,2'],
        watermark: {
          isDark: false,
          version: '1.2.3',
          texts: {
            brand: 'DeepChat'
          }
        }
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(tabPresenter.onRendererTabReady).toHaveBeenCalledWith(88)
    expect(readyResult).toEqual({ notified: true })
    expect(tabPresenter.onRendererTabActivated).toHaveBeenCalledWith('session-1')
    expect(activatedResult).toEqual({ notified: true })
    expect(tabPresenter.captureTabArea).toHaveBeenCalledWith(88, {
      x: 0,
      y: 0,
      width: 100,
      height: 80
    })
    expect(captureResult).toEqual({
      imageData: 'data:image/png;base64,capture'
    })
    expect(tabPresenter.stitchImagesWithWatermark).toHaveBeenCalledWith(
      ['data:image/png;base64,1', 'data:image/png;base64,2'],
      {
        isDark: false,
        version: '1.2.3',
        texts: {
          brand: 'DeepChat'
        }
      }
    )
    expect(stitchResult).toEqual({
      imageData: 'data:image/png;base64,stitched'
    })
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
