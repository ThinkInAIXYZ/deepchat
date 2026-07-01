import type {
  IAgentSessionPresenter,
  IConfigPresenter,
  IConversationExporter,
  IDevicePresenter,
  IFilePresenter,
  IKnowledgePresenter,
  ILlmProviderPresenter,
  IMCPPresenter,
  IOAuthPresenter,
  IProjectPresenter,
  IRemoteControlPresenter,
  ISQLitePresenter,
  IShortcutPresenter,
  ISkillPresenter,
  ITabPresenter,
  IWindowPresenter,
  IWorkspacePresenter,
  IYoBrowserPresenter,
  ISkillSyncPresenter
} from '@shared/presenter'
import type { ProviderInstallPreview } from '@shared/providerDeeplink'
import {
  createEmptyArchiveCandidateLifecyclePreview,
  createEmptyMemoryHealth
} from '@shared/contracts/routes'
import { createMainKernelRouteRuntime, dispatchDeepchatRoute } from '@/routes'
import { setDeepchatEventWindowPresenter } from '@/routes/publishDeepchatEvent'
import { killTerminal, writeToTerminal } from '@/presenter/configPresenter/acpInitHelper'

vi.mock('@/presenter/configPresenter/acpInitHelper', () => ({
  writeToTerminal: vi.fn(),
  killTerminal: vi.fn()
}))

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
    launchAtLoginEnabled: false,
    traceDebugEnabled: false,
    copyWithCotEnabled: true,
    loggingEnabled: false,
    proxyMode: 'system' as 'system' | 'none' | 'custom',
    customProxyUrl: '',
    updateChannel: 'stable' as 'stable' | 'beta',
    skillDraftSuggestionsEnabled: false,
    defaultProjectPath: null as string | null
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
  const agents: Array<{
    id: string
    name: string
    type: 'deepchat'
    enabled: boolean
    protected?: boolean
    config?: {
      systemPrompt?: string
    }
  }> = [
    {
      id: 'deepchat',
      name: 'DeepChat',
      type: 'deepchat' as const,
      enabled: true,
      protected: true,
      config: {
        systemPrompt: 'system'
      }
    }
  ]
  const hooksNotifications = {
    hooks: [] as Array<{
      id: string
      name: string
      enabled: boolean
      command: string
      events: Array<'SessionStart'>
    }>
  }
  let acpEnabled = true
  const acpRegistryAgents = [
    {
      id: 'codex-acp',
      name: 'Codex ACP',
      version: '1.0.0',
      distribution: {
        npx: {
          package: '@zed-industries/codex-acp'
        }
      },
      source: 'registry' as const,
      enabled: true,
      installState: {
        status: 'installed' as const,
        distributionType: 'npx' as const,
        version: '1.0.0',
        installedAt: 123,
        lastCheckedAt: 123,
        installDir: null,
        error: null
      }
    }
  ]
  const manualAcpAgents = [
    {
      id: 'manual-acp',
      name: 'Manual ACP',
      command: 'node',
      enabled: true,
      source: 'manual' as const
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
    getLaunchAtLoginEnabled: vi.fn(() => settings.launchAtLoginEnabled),
    setLaunchAtLoginEnabled: vi.fn((value: boolean) => {
      settings.launchAtLoginEnabled = value
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
    getProxyMode: vi.fn(() => settings.proxyMode),
    setProxyMode: vi.fn((mode: 'system' | 'none' | 'custom') => {
      settings.proxyMode = mode
    }),
    getCustomProxyUrl: vi.fn(() => settings.customProxyUrl),
    setCustomProxyUrl: vi.fn((url: string) => {
      settings.customProxyUrl = url
    }),
    getDefaultProjectPath: vi.fn(() => settings.defaultProjectPath),
    setDefaultProjectPath: vi.fn((projectPath: string | null) => {
      settings.defaultProjectPath = projectPath
    }),
    openLoggingFolder: vi.fn().mockResolvedValue(undefined),
    getUpdateChannel: vi.fn(() => settings.updateChannel),
    setUpdateChannel: vi.fn((channel: 'stable' | 'beta') => {
      settings.updateChannel = channel
    }),
    getSkillDraftSuggestionsEnabled: vi.fn(() => settings.skillDraftSuggestionsEnabled),
    setSkillDraftSuggestionsEnabled: vi.fn((enabled: boolean) => {
      settings.skillDraftSuggestionsEnabled = enabled
    }),
    refreshProviderDb: vi.fn().mockResolvedValue({
      status: 'updated',
      lastUpdated: 123,
      providersCount: 2
    }),
    getHooksNotificationsConfig: vi.fn(() => hooksNotifications),
    setHooksNotificationsConfig: vi.fn((config: typeof hooksNotifications) => {
      hooksNotifications.hooks = [...config.hooks]
      return hooksNotifications
    }),
    testHookCommand: vi.fn().mockResolvedValue({
      success: true,
      durationMs: 10,
      exitCode: 0
    }),
    getAcpEnabled: vi.fn().mockImplementation(async () => acpEnabled),
    setAcpEnabled: vi.fn().mockImplementation(async (enabled: boolean) => {
      acpEnabled = enabled
    }),
    listAcpRegistryAgents: vi.fn().mockResolvedValue(acpRegistryAgents),
    refreshAcpRegistry: vi.fn().mockResolvedValue(acpRegistryAgents),
    setAcpAgentEnabled: vi.fn().mockResolvedValue(undefined),
    setAcpAgentEnvOverride: vi.fn().mockResolvedValue(undefined),
    ensureAcpAgentInstalled: vi.fn().mockResolvedValue(acpRegistryAgents[0].installState),
    repairAcpAgent: vi.fn().mockResolvedValue(acpRegistryAgents[0].installState),
    uninstallAcpRegistryAgent: vi.fn().mockResolvedValue(undefined),
    listManualAcpAgents: vi.fn().mockResolvedValue(manualAcpAgents),
    addManualAcpAgent: vi
      .fn()
      .mockImplementation(async (input: { name: string; command: string }) => ({
        id: 'manual-new',
        name: input.name,
        command: input.command,
        enabled: true,
        source: 'manual'
      })),
    updateManualAcpAgent: vi
      .fn()
      .mockImplementation(async (agentId: string, updates: { enabled?: boolean }) => ({
        id: agentId,
        name: 'Manual ACP',
        command: 'node',
        enabled: updates.enabled ?? true,
        source: 'manual'
      })),
    removeManualAcpAgent: vi.fn().mockResolvedValue(true),
    setTraceDebugEnabled: vi.fn((value: boolean) => {
      settings.traceDebugEnabled = value
    }),
    getKnowledgeConfigs: vi.fn(() => knowledgeConfigs),
    setKnowledgeConfigs: vi.fn((configs: typeof knowledgeConfigs) => {
      knowledgeConfigs.splice(0, knowledgeConfigs.length, ...configs)
    }),
    listAgents: vi.fn().mockImplementation(async () => agents),
    createDeepChatAgent: vi.fn().mockImplementation(async (input: { name: string }) => {
      const agent = {
        id: 'writer',
        name: input.name,
        type: 'deepchat' as const,
        enabled: true
      }
      agents.push(agent)
      return agent
    }),
    updateDeepChatAgent: vi
      .fn()
      .mockImplementation(
        async (agentId: string, updates: { name?: string; enabled?: boolean }) => {
          const agent = agents.find((item) => item.id === agentId)
          if (!agent) {
            return null
          }
          if (typeof updates.name === 'string') {
            agent.name = updates.name
          }
          if (typeof updates.enabled === 'boolean') {
            agent.enabled = updates.enabled
          }
          return agent
        }
      ),
    deleteDeepChatAgent: vi.fn().mockImplementation(async (agentId: string) => {
      const index = agents.findIndex((item) => item.id === agentId)
      if (index === -1) {
        return false
      }
      agents.splice(index, 1)
      return true
    })
  } as unknown as IConfigPresenter

  const agentSessionPresenter = {
    getActiveSessionId: vi.fn(() => null),
    getLightweightSessionsByIds: vi.fn().mockResolvedValue([]),
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
    sendMessage: vi.fn().mockResolvedValue({
      requestId: 'message-2',
      messageId: 'message-2'
    }),
    steerActiveTurn: vi.fn().mockResolvedValue(undefined),
    compactSession: vi.fn().mockResolvedValue({
      compacted: true,
      state: {
        status: 'compacted',
        cursorOrderSeq: 5,
        summaryUpdatedAt: 123
      }
    }),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    getMessage: vi.fn().mockResolvedValue({
      id: 'message-1',
      sessionId: 'session-1'
    }),
    respondToolInteraction: vi.fn().mockResolvedValue({
      resumed: true
    }),
    getAgents: vi.fn().mockResolvedValue([
      {
        id: 'deepchat',
        name: 'DeepChat',
        type: 'deepchat',
        enabled: true
      }
    ]),
    getUsageDashboard: vi.fn().mockResolvedValue({
      recordingStartedAt: null,
      backfillStatus: {
        status: 'completed',
        startedAt: null,
        finishedAt: null,
        error: null,
        updatedAt: 123
      },
      summary: {
        messageCount: 1,
        sessionCount: 1,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cachedInputTokens: 0,
        cacheHitRate: 0,
        estimatedCostUsd: null,
        mostActiveDay: {
          date: '2026-06-11',
          messageCount: 1
        }
      },
      calendar: [
        {
          date: '2026-06-11',
          messageCount: 1,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 0,
          estimatedCostUsd: null,
          level: 1
        }
      ],
      providerBreakdown: [],
      modelBreakdown: [],
      rtk: {
        scope: 'deepchat',
        enabled: true,
        effectiveEnabled: true,
        available: true,
        health: 'healthy',
        checkedAt: 123,
        source: 'bundled',
        failureStage: null,
        failureMessage: null,
        summary: {
          totalCommands: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalSavedTokens: 0,
          avgSavingsPct: 0,
          totalTimeMs: 0,
          avgTimeMs: 0
        },
        daily: []
      }
    }),
    retryRtkHealthCheck: vi.fn().mockResolvedValue(undefined),
    clearSessionPermissions: vi.fn()
  } as unknown as IAgentSessionPresenter

  let rateLimitConfig = {
    enabled: false,
    qpsLimit: 1
  }
  const llmProviderPresenter = {
    check: vi.fn().mockResolvedValue({
      isOk: true,
      errorMsg: null
    }),
    getKeyStatus: vi.fn().mockResolvedValue({
      remainNum: 42,
      limit_remaining: '42',
      usage: '8'
    }),
    getProviderRateLimitStatus: vi.fn(() => ({
      config: rateLimitConfig,
      currentQps: 0,
      queueLength: 0,
      lastRequestTime: 0
    })),
    updateProviderRateLimit: vi.fn((_providerId: string, enabled: boolean, qpsLimit: number) => {
      rateLimitConfig = {
        enabled,
        qpsLimit
      }
    }),
    getDimensions: vi.fn().mockResolvedValue({
      data: {
        dimensions: 1536,
        normalized: true
      }
    }),
    syncModelScopeMcpServers: vi.fn().mockResolvedValue({
      success: true,
      message: 'ok',
      synced: 1,
      imported: 1,
      skipped: 0,
      errors: []
    }),
    runAcpDebugAction: vi.fn().mockResolvedValue({
      status: 'ok',
      sessionId: 'debug-session',
      events: [
        {
          id: 'event-1',
          kind: 'response',
          action: 'initialize',
          agentId: 'codex-acp',
          timestamp: 123,
          payload: { ok: true }
        }
      ]
    }),
    refreshModels: vi.fn().mockResolvedValue(undefined)
  } as unknown as ILlmProviderPresenter

  const mcpRouterItem = {
    uuid: 'router-item-1',
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    name: 'context7',
    author_name: 'upstash',
    title: 'Context7',
    description: 'Fetch current docs',
    content: 'Documentation helper',
    server_key: 'context7',
    config_name: 'Context7',
    server_url: 'https://mcp.context7.com/mcp'
  }
  const mcpPresenter = {
    listMcpRouterServers: vi.fn().mockResolvedValue({ servers: [mcpRouterItem] }),
    installMcpRouterServer: vi.fn().mockResolvedValue(true),
    getMcpRouterApiKey: vi.fn().mockResolvedValue('router-key'),
    setMcpRouterApiKey: vi.fn().mockResolvedValue(undefined),
    isServerInstalled: vi.fn().mockResolvedValue(false),
    updateMcpRouterServersAuth: vi.fn().mockResolvedValue(undefined)
  } as unknown as IMCPPresenter
  const remoteControlPresenter = {
    listRemoteChannels: vi.fn().mockResolvedValue([
      {
        id: 'telegram',
        type: 'builtin',
        implemented: true,
        titleKey: 'settings.remote.telegram.title',
        descriptionKey: 'settings.remote.telegram.description',
        supportsPairing: true,
        supportsNotifications: false
      }
    ]),
    getChannelSettings: vi.fn().mockResolvedValue({
      botToken: 'telegram-token',
      remoteEnabled: true,
      defaultAgentId: 'deepchat',
      defaultWorkdir: ''
    }),
    saveChannelSettings: vi
      .fn()
      .mockImplementation(async (_channel: string, settings: unknown) => settings),
    getChannelStatus: vi.fn().mockResolvedValue({
      channel: 'telegram',
      enabled: true,
      state: 'running',
      pollOffset: 1,
      bindingCount: 0,
      allowedUserCount: 1,
      lastError: null,
      botUser: null
    }),
    getChannelBindings: vi.fn().mockResolvedValue([]),
    removeChannelBinding: vi.fn().mockResolvedValue(undefined),
    removeChannelPrincipal: vi.fn().mockResolvedValue(undefined),
    getChannelPairingSnapshot: vi.fn().mockResolvedValue({
      pairCode: null,
      pairCodeExpiresAt: null,
      allowedUserIds: [123]
    }),
    createChannelPairCode: vi.fn().mockResolvedValue({
      code: '654321',
      expiresAt: 123456
    }),
    clearChannelPairCode: vi.fn().mockResolvedValue(undefined),
    getTelegramStatus: vi.fn().mockResolvedValue({
      channel: 'telegram',
      enabled: true,
      state: 'running',
      pollOffset: 1,
      bindingCount: 0,
      allowedUserCount: 1,
      lastError: null,
      botUser: null
    }),
    getWeixinIlinkStatus: vi.fn().mockResolvedValue({
      channel: 'weixin-ilink',
      enabled: false,
      state: 'disabled',
      bindingCount: 0,
      accountCount: 0,
      connectedAccountCount: 0,
      lastError: null,
      accounts: []
    }),
    startWeixinIlinkLogin: vi.fn().mockResolvedValue({
      sessionKey: 'weixin-session',
      loginUrl: null,
      messageKey: 'settings.remote.weixinIlink.loginWindowOpened'
    }),
    waitForWeixinIlinkLogin: vi.fn().mockResolvedValue({
      connected: true,
      account: null,
      messageKey: 'settings.remote.weixinIlink.loginConnected'
    }),
    removeWeixinIlinkAccount: vi.fn().mockResolvedValue(undefined),
    restartWeixinIlinkAccount: vi.fn().mockResolvedValue(undefined)
  } as unknown as IRemoteControlPresenter
  const shortcutPresenter = {
    registerShortcuts: vi.fn(),
    unregisterShortcuts: vi.fn(),
    destroy: vi.fn()
  } as unknown as IShortcutPresenter

  const pendingProviderInstalls: ProviderInstallPreview[] = [
    {
      kind: 'builtin' as const,
      id: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-secret',
      maskedApiKey: 'sk-s...cret',
      iconModelId: 'deepseek-chat',
      willOverwrite: true
    }
  ]
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
    getSettingsWindowId: vi.fn().mockReturnValue(99),
    closeSettingsWindow: vi.fn(),
    focusMainWindow: vi.fn().mockReturnValue(true),
    notifySettingsReady: vi.fn(),
    consumePendingSettingsProviderInstall: vi.fn(() => pendingProviderInstalls.shift() ?? null),
    setPendingSettingsProviderInstall: vi.fn((preview: ProviderInstallPreview) => {
      pendingProviderInstalls.push(preview)
    }),
    sendToAllWindows: vi.fn().mockResolvedValue(undefined),
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
    selectFiles: vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ['C:/workspace/skill.zip']
    }),
    restartApp: vi.fn().mockResolvedValue(undefined),
    resetDataByType: vi.fn().mockResolvedValue(undefined),
    sanitizeSvgContent: vi.fn().mockResolvedValue('<svg />')
  } as unknown as IDevicePresenter

  const projectPresenter = {
    ensureDefaultWorkspace: vi.fn().mockResolvedValue('C:/Users/test/Documents/DeepChat'),
    getRecentProjects: vi.fn().mockResolvedValue([
      {
        path: 'C:/workspace',
        name: 'workspace',
        icon: null,
        lastAccessedAt: 123,
        exists: true
      }
    ]),
    getEnvironments: vi.fn().mockResolvedValue([
      {
        path: 'C:/workspace',
        name: 'workspace',
        sessionCount: 2,
        lastUsedAt: 456,
        isTemp: false,
        exists: true,
        status: 'active',
        sortOrder: 2147483647,
        archivedAt: null,
        removedAt: null
      }
    ]),
    reorderEnvironments: vi.fn().mockResolvedValue(undefined),
    archiveEnvironment: vi.fn().mockResolvedValue(undefined),
    restoreEnvironment: vi.fn().mockResolvedValue(undefined),
    removeEnvironment: vi.fn().mockResolvedValue({ clearedSessionIds: ['session-1'] }),
    openDirectory: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
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

  const knowledgeFile = {
    id: 'file-1',
    name: 'guide.md',
    path: '/workspace/guide.md',
    mimeType: 'text/markdown',
    status: 'completed' as const,
    uploadedAt: 123,
    metadata: {
      size: 1024,
      totalChunks: 3
    }
  }
  const knowledgePresenter = {
    isSupported: vi.fn().mockResolvedValue(true),
    getSupportedLanguages: vi.fn().mockResolvedValue(['markdown', 'typescript']),
    getSeparatorsForLanguage: vi.fn().mockResolvedValue(['\n\n', '\n', ' ', '']),
    getSupportedFileExtensions: vi.fn().mockResolvedValue(['md', 'txt', 'pdf']),
    listFiles: vi.fn().mockResolvedValue([knowledgeFile]),
    similarityQuery: vi.fn().mockResolvedValue([
      {
        id: 'chunk-1',
        metadata: {
          from: 'guide.md',
          filePath: '/workspace/guide.md',
          content: 'hello knowledge'
        },
        distance: 0.1
      }
    ]),
    validateFile: vi.fn().mockResolvedValue({
      isSupported: true,
      mimeType: 'text/markdown',
      adapterType: 'text'
    }),
    addFile: vi.fn().mockResolvedValue({
      data: knowledgeFile
    }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    reAddFile: vi.fn().mockResolvedValue({
      data: {
        ...knowledgeFile,
        status: 'processing'
      }
    }),
    pauseAllRunningTasks: vi.fn().mockResolvedValue(undefined),
    resumeAllPausedTasks: vi.fn().mockResolvedValue(undefined)
  } as unknown as IKnowledgePresenter

  const externalSkill = {
    name: 'write-tests',
    description: 'Write tests',
    path: '/tools/write-tests.md',
    format: 'markdown',
    lastModified: new Date('2024-01-01T00:00:00.000Z')
  }
  const scanResult = {
    toolId: 'codex',
    toolName: 'Codex',
    available: true,
    skillsDir: '/tools',
    skills: [externalSkill]
  }
  const importPreview = {
    skill: {
      name: 'write-tests',
      description: 'Write tests',
      instructions: 'Write useful tests'
    },
    source: externalSkill,
    warnings: []
  }
  const exportPreview = {
    skillName: 'write-tests',
    targetTool: 'codex',
    targetPath: '/tools/write-tests.md',
    convertedContent: '# Write tests',
    warnings: []
  }
  const syncResult = {
    success: true,
    imported: 1,
    exported: 0,
    skipped: 0,
    failed: []
  }
  const skillSyncPresenter = {
    scanExternalTools: vi.fn().mockResolvedValue([scanResult]),
    getNewDiscoveries: vi.fn().mockResolvedValue([
      {
        toolId: 'codex',
        toolName: 'Codex',
        newSkills: [externalSkill]
      }
    ]),
    acknowledgeDiscoveries: vi.fn().mockResolvedValue(undefined),
    getRegisteredTools: vi.fn(() => [
      {
        id: 'codex',
        name: 'Codex',
        skillsDir: '/tools',
        filePattern: '*.md',
        format: 'markdown',
        capabilities: {
          hasFrontmatter: true,
          supportsName: true,
          supportsDescription: true,
          supportsTools: true,
          supportsModel: true,
          supportsSubfolders: false,
          supportsReferences: false,
          supportsScripts: false
        }
      }
    ]),
    previewImport: vi.fn().mockResolvedValue([importPreview]),
    executeImport: vi.fn().mockResolvedValue(syncResult),
    previewExport: vi.fn().mockResolvedValue([exportPreview]),
    executeExport: vi.fn().mockResolvedValue({
      ...syncResult,
      imported: 0,
      exported: 1
    })
  } as unknown as ISkillSyncPresenter

  const oauthPresenter = {
    startGitHubCopilotLogin: vi.fn().mockResolvedValue(true),
    startGitHubCopilotDeviceFlowLogin: vi.fn().mockResolvedValue(false),
    getOpenAICodexStatus: vi.fn().mockResolvedValue({
      state: 'signed-out',
      authenticated: false,
      storage: 'safeStorage'
    }),
    startOpenAICodexBrowserLogin: vi.fn().mockResolvedValue({
      state: 'authenticated',
      authenticated: true,
      storage: 'safeStorage'
    }),
    cancelOpenAICodexLogin: vi.fn().mockResolvedValue({
      state: 'signed-out',
      authenticated: false,
      storage: 'safeStorage'
    }),
    logoutOpenAICodex: vi.fn().mockResolvedValue({
      state: 'signed-out',
      authenticated: false,
      storage: 'safeStorage'
    })
  } as unknown as IOAuthPresenter
  const nowledgeMemConfig = {
    baseUrl: 'http://127.0.0.1:14242',
    apiKey: '',
    timeout: 30000
  }
  const exporter = {
    getNowledgeMemConfig: vi.fn(() => nowledgeMemConfig),
    updateNowledgeMemConfig: vi.fn().mockResolvedValue(undefined),
    testNowledgeMemConnection: vi.fn().mockResolvedValue({
      success: true,
      message: 'Connection successful'
    })
  } as unknown as IConversationExporter
  const skillPresenter = {
    readSkillFile: vi.fn().mockResolvedValue('---\nname: write-tests\n---\nUse tests well')
  } as unknown as ISkillPresenter

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
    reload: vi.fn().mockResolvedValue(undefined),
    clearSandboxData: vi.fn().mockResolvedValue(undefined)
  } as unknown as IYoBrowserPresenter

  const tabPresenter = {
    onRendererTabReady: vi.fn().mockResolvedValue(undefined),
    onRendererTabActivated: vi.fn().mockResolvedValue(undefined),
    captureTabArea: vi.fn().mockResolvedValue('data:image/png;base64,capture'),
    stitchImagesWithWatermark: vi.fn().mockResolvedValue('data:image/png;base64,stitched')
  } as unknown as ITabPresenter
  const databaseRepairReport = {
    startedAt: 1,
    finishedAt: 2,
    status: 'healthy' as const,
    backupPath: null,
    diagnosisBeforeRepair: {
      checkedAt: 1,
      isHealthy: true,
      issues: [],
      repairableIssues: [],
      manualIssues: []
    },
    diagnosisAfterRepair: {
      checkedAt: 2,
      isHealthy: true,
      issues: [],
      repairableIssues: [],
      manualIssues: []
    },
    repairedIssues: [],
    remainingIssues: []
  }
  const sqlitePresenter = {
    recordSettingsActivity: vi.fn().mockResolvedValue(undefined),
    listSettingsActivity: vi.fn().mockResolvedValue([]),
    repairSchema: vi.fn().mockResolvedValue(databaseRepairReport)
  } as unknown as ISQLitePresenter
  const scheduledTasks = {
    setSessionCreator: vi.fn(),
    list: vi.fn(() => ({ enabled: false, tasks: [] })),
    upsert: vi.fn((task: unknown) => ({ task, settings: { enabled: false, tasks: [task] } })),
    delete: vi.fn(() => ({ enabled: false, tasks: [] })),
    toggle: vi.fn((id: string, enabled: boolean) => ({
      task: { id, enabled },
      settings: { enabled: false, tasks: [{ id, enabled }] }
    })),
    fireNow: vi.fn(async (id: string) => ({
      task: { id },
      settings: { enabled: false, tasks: [{ id }] }
    }))
  }

  setDeepchatEventWindowPresenter(windowPresenter)

  return {
    settings,
    runtime: createMainKernelRouteRuntime({
      configPresenter,
      llmProviderPresenter,
      agentSessionPresenter,
      skillPresenter,
      skillSyncPresenter,
      exporter,
      oauthPresenter,
      mcpPresenter,
      remoteControlPresenter,
      shortcutPresenter,
      sqlitePresenter,
      windowPresenter,
      devicePresenter,
      projectPresenter,
      filePresenter,
      knowledgePresenter,
      workspacePresenter,
      yoBrowserPresenter,
      tabPresenter,
      scheduledTasks
    }),
    configPresenter,
    llmProviderPresenter,
    agentSessionPresenter,
    skillPresenter,
    skillSyncPresenter,
    exporter,
    oauthPresenter,
    mcpPresenter,
    remoteControlPresenter,
    shortcutPresenter,
    sqlitePresenter,
    windowPresenter,
    devicePresenter,
    projectPresenter,
    filePresenter,
    knowledgePresenter,
    workspacePresenter,
    yoBrowserPresenter,
    tabPresenter
  }
}

describe('dispatchDeepchatRoute', () => {
  it('ensures the built-in chat workspace before startup bootstrap returns', async () => {
    const { runtime, settings, projectPresenter } = createRuntime()
    vi.mocked(projectPresenter.ensureDefaultWorkspace).mockImplementation(async () => {
      settings.defaultProjectPath = 'C:/Users/test/Documents/DeepChat'
      return 'C:/Users/test/Documents/DeepChat'
    })

    const result = await dispatchDeepchatRoute(
      runtime,
      'startup.getBootstrap',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(projectPresenter.ensureDefaultWorkspace).toHaveBeenCalledTimes(1)
    expect(result.bootstrap.defaultProjectPath).toBe('C:/Users/test/Documents/DeepChat')
    expect(result.bootstrap.defaultChatWorkspacePath).toBe('C:/Users/test/Documents/DeepChat')
  })

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

  it('sanitizes memory audit refs at the route boundary', async () => {
    const { runtime } = createRuntime()
    const listByAgent = vi.fn().mockReturnValue([
      {
        id: 'audit-1',
        agent_id: 'deepchat',
        event_type: 'memory/reflect',
        actor_type: 'scheduler',
        session_id: 's1',
        input_refs_json: JSON.stringify({
          memoryIds: ['m1'],
          createdAt: 100,
          secretAt: 'raw secret',
          content: 'raw memory content',
          nested: { content: 'raw nested' }
        }),
        output_refs_json: JSON.stringify({ reflectionIds: ['r1'], result: 'raw output' }),
        model_provider_id: 'openai',
        model_id: 'gpt-4o-mini',
        status: 'completed',
        reason: null,
        created_at: 200
      }
    ])
    ;(runtime as any).sqlitePresenter = {
      agentMemoryAuditTable: {
        listByAgent
      }
    }

    const result = await dispatchDeepchatRoute(
      runtime,
      'memory.listAuditEvents',
      { agentId: 'deepchat' },
      { webContentsId: 42, windowId: 7 }
    )

    expect(listByAgent).toHaveBeenCalledWith(
      'deepchat',
      expect.objectContaining({
        limit: undefined
      })
    )
    expect(result).toEqual({
      events: [
        expect.objectContaining({
          inputRefs: {
            memoryIds: ['m1'],
            createdAt: 100,
            secretAt: '[redacted]',
            content: '[redacted]',
            nested: '{...}'
          },
          outputRefs: {
            reflectionIds: ['r1'],
            result: '[redacted]'
          }
        })
      ]
    })
  })

  it('returns no memory audit events for missing or non-DeepChat agents', async () => {
    const { runtime, configPresenter } = createRuntime()
    const listByAgent = vi.fn()
    ;(runtime as any).sqlitePresenter = {
      agentMemoryAuditTable: {
        listByAgent
      }
    }
    vi.mocked(configPresenter.getAgentType).mockResolvedValueOnce(null).mockResolvedValueOnce('acp')

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.listAuditEvents',
        { agentId: 'deleted' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ events: [] })
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.listAuditEvents',
        { agentId: 'acp-agent' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ events: [] })
    expect(listByAgent).not.toHaveBeenCalled()
  })

  it('dispatches memory health with deepchat guard and zero fallback', async () => {
    const { runtime, configPresenter } = createRuntime()
    const health = {
      ...createEmptyMemoryHealth(),
      totalRows: 1,
      byKind: { episodic: 0, semantic: 1, reflection: 0, persona: 0, working: 0 },
      byStatus: {
        pending_embedding: 0,
        embedded: 1,
        error: 0,
        fts_only: 0,
        archived: 0,
        conflicted: 0
      }
    }
    const getHealth = vi.fn(() => health)
    ;(runtime as any).memoryPresenter = { getHealth }

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getHealth',
        { agentId: 'other' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ health: createEmptyMemoryHealth() })
    expect(getHealth).not.toHaveBeenCalled()

    vi.mocked(configPresenter.getAgentType).mockResolvedValueOnce('deepchat')
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getHealth',
        { agentId: 'deepchat' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ health })
    expect(getHealth).toHaveBeenCalledWith('deepchat')
  })

  it('dispatches memory lifecycle with deepchat guard and empty fallback', async () => {
    const { runtime, configPresenter } = createRuntime()
    const lifecycles = [
      {
        memoryId: 'm1',
        kind: 'semantic',
        status: 'embedded',
        recallable: true,
        decayTier: 'fresh',
        recall: {
          weights: { similarity: 0.6, recency: 0.25, importance: 0.15 },
          similarity: 0.3,
          similaritySource: 'baseline',
          recency: 1,
          importance: 0.5,
          confidenceFactor: 1,
          importanceFloor: 0.075,
          final: 0.48,
          flooredByImportance: false,
          halfLifeMs: 14 * 24 * 60 * 60 * 1000
        },
        forget: {
          anchorAt: 1000,
          ageDays: 0,
          halfLifeDays: 30,
          decayScore: 1,
          materializedDecay: null,
          materializedStale: true
        },
        archiveEligibility: {
          eligible: false,
          oldEnough: false,
          decayedEnough: false,
          neverAccessed: true,
          active: true,
          exempt: false,
          exemptReasons: [],
          gaps: {}
        }
      }
    ]
    const preview = {
      lifecycles,
      previewLimit: 25,
      scanLimit: 200,
      scanned: 1,
      previewTruncated: false,
      scanTruncated: false
    }
    const getLifecycle = vi.fn(() => lifecycles)
    const getArchiveCandidateLifecyclePreview = vi.fn(() => preview)
    ;(runtime as any).memoryPresenter = { getLifecycle, getArchiveCandidateLifecyclePreview }

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getLifecycle',
        { agentId: 'other', memoryId: 'm1' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ lifecycles: [] })
    expect(getLifecycle).not.toHaveBeenCalled()

    vi.mocked(configPresenter.getAgentType).mockResolvedValueOnce('deepchat')
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getLifecycle',
        { agentId: 'deepchat', memoryId: 'm1' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ lifecycles })
    expect(getLifecycle).toHaveBeenCalledWith('deepchat', 'm1')

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getArchiveCandidateLifecyclePreview',
        { agentId: 'other' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ preview: createEmptyArchiveCandidateLifecyclePreview() })
    expect(getArchiveCandidateLifecyclePreview).not.toHaveBeenCalled()

    vi.mocked(configPresenter.getAgentType).mockResolvedValueOnce('deepchat')
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getArchiveCandidateLifecyclePreview',
        { agentId: 'deepchat' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ preview })
    expect(getArchiveCandidateLifecyclePreview).toHaveBeenCalledWith('deepchat')
  })

  it('returns no memory audit events when the SQLite presenter has no memory audit table', async () => {
    const { runtime } = createRuntime()

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.listAuditEvents',
        { agentId: 'deepchat' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ events: [] })
  })

  it('filters memory view manifests by message before applying the requested limit', async () => {
    const { runtime, configPresenter } = createRuntime()
    vi.mocked(configPresenter.getAgentType).mockResolvedValueOnce('deepchat')
    const listSessions = vi.fn()
    const listMemoryViewManifestAnchorsByAgent = vi.fn().mockReturnValue([
      {
        session_id: 's1',
        entry_id: 20,
        kind: 'anchor',
        name: 'memory/view_assembled',
        source_type: 'memory',
        source_id: 'msg-new',
        source_seq: 0,
        provenance_key: null,
        payload_json: JSON.stringify({
          state: {
            policyVersion: 1,
            tokenBudget: 1000,
            estimatedTokens: 10,
            selected: ['new'],
            dropped: [],
            queryHash: 'newhash'
          }
        }),
        meta_json: JSON.stringify({ messageId: 'msg-new' }),
        created_at: 200
      },
      {
        session_id: 's1',
        entry_id: 10,
        kind: 'anchor',
        name: 'memory/view_assembled',
        source_type: 'memory',
        source_id: 'msg-old',
        source_seq: 0,
        provenance_key: null,
        payload_json: JSON.stringify({
          state: {
            policyVersion: 1,
            tokenBudget: 900,
            estimatedTokens: 9,
            selected: ['old'],
            dropped: ['drop'],
            queryHash: 'oldhash'
          }
        }),
        meta_json: JSON.stringify({ messageId: 'msg-old' }),
        created_at: 100
      }
    ])
    ;(runtime as any).sqlitePresenter = {
      newSessionsTable: {
        list: listSessions
      },
      deepchatTapeEntriesTable: {
        listMemoryViewManifestAnchorsByAgent
      }
    }

    const result = await dispatchDeepchatRoute(
      runtime,
      'memory.listViewManifests',
      { agentId: 'a', sessionId: 's1', messageId: 'msg-old', limit: 1 },
      { webContentsId: 42, windowId: 7 }
    )

    expect(listSessions).not.toHaveBeenCalled()
    expect(listMemoryViewManifestAnchorsByAgent).toHaveBeenCalledWith('a', {
      sessionId: 's1',
      limit: 1,
      messageId: 'msg-old'
    })
    expect(result).toEqual({
      manifests: [
        expect.objectContaining({
          messageId: 'msg-old',
          entryId: 10,
          selectedCount: 1,
          droppedCount: 1,
          queryHash: 'oldhash'
        })
      ]
    })
  })

  it('returns no memory view manifests for missing or non-DeepChat agents', async () => {
    const { runtime, configPresenter } = createRuntime()
    const listMemoryViewManifestAnchorsByAgent = vi.fn()
    ;(runtime as any).sqlitePresenter = {
      deepchatTapeEntriesTable: {
        listMemoryViewManifestAnchorsByAgent
      }
    }
    vi.mocked(configPresenter.getAgentType).mockResolvedValueOnce(null).mockResolvedValueOnce('acp')

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.listViewManifests',
        { agentId: 'deleted' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ manifests: [] })
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.listViewManifests',
        { agentId: 'acp-agent' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ manifests: [] })
    expect(listMemoryViewManifestAnchorsByAgent).not.toHaveBeenCalled()
  })

  it('returns no memory view manifests when the SQLite presenter has no tape table', async () => {
    const { runtime } = createRuntime()

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.listViewManifests',
        { agentId: 'deepchat' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ manifests: [] })
  })

  it('returns a null memory source span when the SQLite presenter has no tape table', async () => {
    const { runtime } = createRuntime()
    ;(runtime as any).memoryPresenter = {
      listMemories: vi.fn(() => [
        {
          id: 'm1',
          agent_id: 'deepchat',
          source_session: 's1',
          source_entry_ids: '[1]'
        }
      ])
    }

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getSourceSpan',
        { agentId: 'deepchat', memoryId: 'm1' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ span: null })
  })

  it('does not expand all sessions when listing memory view manifests', async () => {
    const { runtime, configPresenter } = createRuntime()
    vi.mocked(configPresenter.getAgentType).mockResolvedValueOnce('deepchat')
    const listSessions = vi.fn(() =>
      Array.from({ length: 1200 }, (_, index) => ({ id: `s-${index}` }))
    )
    const listMemoryViewManifestAnchorsByAgent = vi.fn().mockReturnValue([
      {
        session_id: 's-1199',
        entry_id: 1,
        kind: 'anchor',
        name: 'memory/view_assembled',
        source_type: 'memory',
        source_id: 'msg-1',
        source_seq: 0,
        provenance_key: null,
        payload_json: JSON.stringify({
          state: {
            policyVersion: 1,
            tokenBudget: 1000,
            estimatedTokens: 10,
            selected: ['m1'],
            dropped: [],
            queryHash: 'hash'
          }
        }),
        meta_json: JSON.stringify({ messageId: 'msg-1' }),
        created_at: 100
      }
    ])
    ;(runtime as any).sqlitePresenter = {
      newSessionsTable: {
        list: listSessions
      },
      deepchatTapeEntriesTable: {
        listMemoryViewManifestAnchorsByAgent
      }
    }

    const result = await dispatchDeepchatRoute(
      runtime,
      'memory.listViewManifests',
      { agentId: 'a', limit: 100 },
      { webContentsId: 42, windowId: 7 }
    )

    expect(listSessions).not.toHaveBeenCalled()
    expect(listMemoryViewManifestAnchorsByAgent).toHaveBeenCalledWith('a', {
      sessionId: undefined,
      limit: 100,
      messageId: undefined
    })
    expect(result).toEqual({
      manifests: [expect.objectContaining({ sessionId: 's-1199', entryId: 1 })]
    })
  })

  it('dispatches ACP terminal command routes through the terminal helper', async () => {
    const { runtime } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const inputResult = await dispatchDeepchatRoute(
      runtime,
      'acpTerminal.input',
      { data: 'hello\n' },
      context
    )
    const killResult = await dispatchDeepchatRoute(runtime, 'acpTerminal.kill', {}, context)

    expect(writeToTerminal).toHaveBeenCalledWith('hello\n')
    expect(killTerminal).toHaveBeenCalledTimes(1)
    expect(inputResult).toEqual({ sent: true })
    expect(killResult).toEqual({ killed: true })
  })

  it('dispatches shortcut routes through ShortcutPresenter', async () => {
    const { runtime, shortcutPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const registerResult = await dispatchDeepchatRoute(runtime, 'shortcut.register', {}, context)
    const unregisterResult = await dispatchDeepchatRoute(
      runtime,
      'shortcut.unregister',
      {},
      context
    )
    const destroyResult = await dispatchDeepchatRoute(runtime, 'shortcut.destroy', {}, context)

    expect(shortcutPresenter.registerShortcuts).toHaveBeenCalledTimes(1)
    expect(shortcutPresenter.unregisterShortcuts).toHaveBeenCalledTimes(1)
    expect(shortcutPresenter.destroy).toHaveBeenCalledTimes(1)
    expect(registerResult).toEqual({ registered: true })
    expect(unregisterResult).toEqual({ unregistered: true })
    expect(destroyResult).toEqual({ destroyed: true })
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

  it('dispatches knowledge file routes through KnowledgePresenter', async () => {
    const { runtime, knowledgePresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const supportedResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.isSupported',
      {},
      context
    )
    const languagesResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.getSupportedLanguages',
      {},
      context
    )
    const separatorsResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.getSeparatorsForLanguage',
      { language: 'markdown' },
      context
    )
    const extensionsResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.getSupportedFileExtensions',
      {},
      context
    )
    const filesResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.listFiles',
      { knowledgeBaseId: 'knowledge-1' },
      context
    )
    const queryResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.similarityQuery',
      { knowledgeBaseId: 'knowledge-1', query: 'hello' },
      context
    )
    const validationResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.validateFile',
      { filePath: '/workspace/guide.md' },
      context
    )
    const addResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.addFile',
      { knowledgeBaseId: 'knowledge-1', filePath: '/workspace/guide.md' },
      context
    )
    const deleteResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.deleteFile',
      { knowledgeBaseId: 'knowledge-1', fileId: 'file-1' },
      context
    )
    const reAddResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.reAddFile',
      { knowledgeBaseId: 'knowledge-1', fileId: 'file-1' },
      context
    )
    const pauseResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.pauseAllRunningTasks',
      { knowledgeBaseId: 'knowledge-1' },
      context
    )
    const resumeResult = await dispatchDeepchatRoute(
      runtime,
      'knowledge.resumeAllPausedTasks',
      { knowledgeBaseId: 'knowledge-1' },
      context
    )

    expect(knowledgePresenter.isSupported).toHaveBeenCalled()
    expect(knowledgePresenter.getSupportedLanguages).toHaveBeenCalled()
    expect(knowledgePresenter.getSeparatorsForLanguage).toHaveBeenCalledWith('markdown')
    expect(knowledgePresenter.getSupportedFileExtensions).toHaveBeenCalled()
    expect(knowledgePresenter.listFiles).toHaveBeenCalledWith('knowledge-1')
    expect(knowledgePresenter.similarityQuery).toHaveBeenCalledWith('knowledge-1', 'hello')
    expect(knowledgePresenter.validateFile).toHaveBeenCalledWith('/workspace/guide.md')
    expect(knowledgePresenter.addFile).toHaveBeenCalledWith('knowledge-1', '/workspace/guide.md')
    expect(knowledgePresenter.deleteFile).toHaveBeenCalledWith('knowledge-1', 'file-1')
    expect(knowledgePresenter.reAddFile).toHaveBeenCalledWith('knowledge-1', 'file-1')
    expect(knowledgePresenter.pauseAllRunningTasks).toHaveBeenCalledWith('knowledge-1')
    expect(knowledgePresenter.resumeAllPausedTasks).toHaveBeenCalledWith('knowledge-1')
    expect(supportedResult).toEqual({ supported: true })
    expect(languagesResult).toEqual({ languages: ['markdown', 'typescript'] })
    expect(separatorsResult).toEqual({ separators: ['\n\n', '\n', ' ', ''] })
    expect(extensionsResult).toEqual({ extensions: ['md', 'txt', 'pdf'] })
    expect(filesResult).toEqual({
      files: [expect.objectContaining({ id: 'file-1', status: 'completed' })]
    })
    expect(queryResult).toEqual({
      results: [expect.objectContaining({ id: 'chunk-1', distance: 0.1 })]
    })
    expect(validationResult).toEqual({
      result: {
        isSupported: true,
        mimeType: 'text/markdown',
        adapterType: 'text'
      }
    })
    expect(addResult).toEqual({
      result: {
        data: expect.objectContaining({ id: 'file-1' })
      }
    })
    expect(deleteResult).toEqual({ deleted: true })
    expect(reAddResult).toEqual({
      result: {
        data: expect.objectContaining({ id: 'file-1', status: 'processing' })
      }
    })
    expect(pauseResult).toEqual({ paused: true })
    expect(resumeResult).toEqual({ resumed: true })
  })

  it('dispatches skill sync routes through SkillSyncPresenter', async () => {
    const { runtime, skillSyncPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }
    const importPreview = {
      skill: {
        name: 'write-tests',
        description: 'Write tests',
        instructions: 'Write useful tests'
      },
      source: {
        name: 'write-tests',
        description: 'Write tests',
        path: '/tools/write-tests.md',
        format: 'markdown',
        lastModified: new Date('2024-01-01T00:00:00.000Z')
      },
      warnings: []
    }
    const exportPreview = {
      skillName: 'write-tests',
      targetTool: 'codex',
      targetPath: '/tools/write-tests.md',
      convertedContent: '# Write tests',
      warnings: []
    }

    const scanResult = await dispatchDeepchatRoute(
      runtime,
      'skillSync.scanExternalTools',
      {},
      context
    )
    const discoveriesResult = await dispatchDeepchatRoute(
      runtime,
      'skillSync.getNewDiscoveries',
      {},
      context
    )
    const ackResult = await dispatchDeepchatRoute(
      runtime,
      'skillSync.acknowledgeDiscoveries',
      {},
      context
    )
    const toolsResult = await dispatchDeepchatRoute(
      runtime,
      'skillSync.getRegisteredTools',
      {},
      context
    )
    const importPreviewResult = await dispatchDeepchatRoute(
      runtime,
      'skillSync.previewImport',
      {
        toolId: 'codex',
        skillNames: ['write-tests']
      },
      context
    )
    const importResult = await dispatchDeepchatRoute(
      runtime,
      'skillSync.executeImport',
      {
        previews: [importPreview],
        strategies: {
          'write-tests': 'overwrite'
        }
      },
      context
    )
    const exportPreviewResult = await dispatchDeepchatRoute(
      runtime,
      'skillSync.previewExport',
      {
        skillNames: ['write-tests'],
        targetToolId: 'codex',
        options: {
          inclusion: 'always'
        }
      },
      context
    )
    const exportResult = await dispatchDeepchatRoute(
      runtime,
      'skillSync.executeExport',
      {
        previews: [exportPreview],
        strategies: {
          'write-tests': 'overwrite'
        }
      },
      context
    )

    expect(skillSyncPresenter.scanExternalTools).toHaveBeenCalled()
    expect(skillSyncPresenter.getNewDiscoveries).toHaveBeenCalled()
    expect(skillSyncPresenter.acknowledgeDiscoveries).toHaveBeenCalled()
    expect(skillSyncPresenter.getRegisteredTools).toHaveBeenCalled()
    expect(skillSyncPresenter.previewImport).toHaveBeenCalledWith('codex', ['write-tests'])
    expect(skillSyncPresenter.executeImport).toHaveBeenCalledWith([importPreview], {
      'write-tests': 'overwrite'
    })
    expect(skillSyncPresenter.previewExport).toHaveBeenCalledWith(['write-tests'], 'codex', {
      inclusion: 'always'
    })
    expect(skillSyncPresenter.executeExport).toHaveBeenCalledWith([exportPreview], {
      'write-tests': 'overwrite'
    })
    expect(scanResult).toEqual({
      results: [expect.objectContaining({ toolId: 'codex' })]
    })
    expect(discoveriesResult).toEqual({
      discoveries: [expect.objectContaining({ toolId: 'codex' })]
    })
    expect(ackResult).toEqual({ acknowledged: true })
    expect(toolsResult).toEqual({
      tools: [expect.objectContaining({ id: 'codex' })]
    })
    expect(importPreviewResult).toEqual({
      previews: [
        expect.objectContaining({ skill: expect.objectContaining({ name: 'write-tests' }) })
      ]
    })
    expect(importResult).toEqual({
      result: {
        success: true,
        imported: 1,
        exported: 0,
        skipped: 0,
        failed: []
      }
    })
    expect(exportPreviewResult).toEqual({
      previews: [expect.objectContaining({ skillName: 'write-tests' })]
    })
    expect(exportResult).toEqual({
      result: {
        success: true,
        imported: 0,
        exported: 1,
        skipped: 0,
        failed: []
      }
    })
  })

  it('dispatches GitHub Copilot OAuth routes through OAuthPresenter', async () => {
    const { runtime, oauthPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const loginResult = await dispatchDeepchatRoute(
      runtime,
      'oauth.githubCopilot.startLogin',
      { providerId: 'github-copilot' },
      context
    )
    const deviceFlowResult = await dispatchDeepchatRoute(
      runtime,
      'oauth.githubCopilot.startDeviceFlowLogin',
      { providerId: 'github-copilot' },
      context
    )

    expect(oauthPresenter.startGitHubCopilotLogin).toHaveBeenCalledWith('github-copilot')
    expect(oauthPresenter.startGitHubCopilotDeviceFlowLogin).toHaveBeenCalledWith('github-copilot')
    expect(loginResult).toEqual({ success: true })
    expect(deviceFlowResult).toEqual({ success: false })
  })

  it('dispatches OpenAI Codex OAuth routes through OAuthPresenter', async () => {
    const { runtime, oauthPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const statusResult = await dispatchDeepchatRoute(
      runtime,
      'oauth.openaiCodex.getStatus',
      {},
      context
    )
    const browserResult = await dispatchDeepchatRoute(
      runtime,
      'oauth.openaiCodex.startBrowserLogin',
      {},
      context
    )
    const cancelResult = await dispatchDeepchatRoute(
      runtime,
      'oauth.openaiCodex.cancelLogin',
      {},
      context
    )
    const logoutResult = await dispatchDeepchatRoute(
      runtime,
      'oauth.openaiCodex.logout',
      {},
      context
    )

    expect(oauthPresenter.getOpenAICodexStatus).toHaveBeenCalledTimes(1)
    expect(oauthPresenter.startOpenAICodexBrowserLogin).toHaveBeenCalledTimes(1)
    expect(oauthPresenter.cancelOpenAICodexLogin).toHaveBeenCalledTimes(1)
    expect(oauthPresenter.logoutOpenAICodex).toHaveBeenCalledTimes(1)
    expect(statusResult.status.state).toBe('signed-out')
    expect(browserResult.status.authenticated).toBe(true)
    expect(cancelResult.status.state).toBe('signed-out')
    expect(logoutResult.status.state).toBe('signed-out')
  })

  it('dispatches database schema repair through SQLitePresenter', async () => {
    const { runtime, sqlitePresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const repairResult = await dispatchDeepchatRoute(
      runtime,
      'databaseSecurity.repairSchema',
      {},
      context
    )

    expect(sqlitePresenter.repairSchema).toHaveBeenCalledTimes(1)
    expect(repairResult).toEqual({
      report: expect.objectContaining({
        status: 'healthy',
        repairedIssues: [],
        remainingIssues: []
      })
    })
  })

  it('dispatches NowledgeMem routes through ConversationExporter', async () => {
    const { runtime, exporter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const getResult = await dispatchDeepchatRoute(runtime, 'nowledgeMem.getConfig', {}, context)
    const updateResult = await dispatchDeepchatRoute(
      runtime,
      'nowledgeMem.updateConfig',
      {
        config: {
          baseUrl: 'http://127.0.0.1:14242',
          apiKey: 'secret',
          timeout: 45000
        }
      },
      context
    )
    const testResult = await dispatchDeepchatRoute(
      runtime,
      'nowledgeMem.testConnection',
      {},
      context
    )

    expect(exporter.getNowledgeMemConfig).toHaveBeenCalledTimes(2)
    expect(exporter.updateNowledgeMemConfig).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: 'secret',
      timeout: 45000
    })
    expect(exporter.testNowledgeMemConnection).toHaveBeenCalledTimes(1)
    expect(getResult).toEqual({
      config: {
        baseUrl: 'http://127.0.0.1:14242',
        apiKey: '',
        timeout: 30000
      }
    })
    expect(updateResult).toEqual({
      config: {
        baseUrl: 'http://127.0.0.1:14242',
        apiKey: '',
        timeout: 30000
      }
    })
    expect(testResult).toEqual({
      result: {
        success: true,
        message: 'Connection successful'
      }
    })
  })

  it('dispatches skill file reads through SkillPresenter', async () => {
    const { runtime, skillPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const result = await dispatchDeepchatRoute(
      runtime,
      'skills.readFile',
      { name: 'write-tests' },
      context
    )

    expect(skillPresenter.readSkillFile).toHaveBeenCalledWith('write-tests')
    expect(result).toEqual({
      content: '---\nname: write-tests\n---\nUse tests well'
    })
  })

  it('dispatches MCP Router marketplace routes through McpPresenter', async () => {
    const { runtime, mcpPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const listResult = await dispatchDeepchatRoute(
      runtime,
      'mcp.router.listServers',
      {
        page: 1,
        limit: 20
      },
      context
    )
    const keyResult = await dispatchDeepchatRoute(runtime, 'mcp.router.getApiKey', {}, context)
    const saveResult = await dispatchDeepchatRoute(
      runtime,
      'mcp.router.setApiKey',
      {
        key: 'new-router-key'
      },
      context
    )
    const authResult = await dispatchDeepchatRoute(
      runtime,
      'mcp.router.updateServersAuth',
      {
        apiKey: 'new-router-key'
      },
      context
    )
    const installedResult = await dispatchDeepchatRoute(
      runtime,
      'mcp.router.isServerInstalled',
      {
        source: 'mcprouter',
        sourceId: 'context7'
      },
      context
    )
    const installResult = await dispatchDeepchatRoute(
      runtime,
      'mcp.router.installServer',
      {
        serverKey: 'context7'
      },
      context
    )

    expect(mcpPresenter.listMcpRouterServers).toHaveBeenCalledWith(1, 20)
    expect(mcpPresenter.getMcpRouterApiKey).toHaveBeenCalledTimes(1)
    expect(mcpPresenter.setMcpRouterApiKey).toHaveBeenCalledWith('new-router-key')
    expect(mcpPresenter.updateMcpRouterServersAuth).toHaveBeenCalledWith('new-router-key')
    expect(mcpPresenter.isServerInstalled).toHaveBeenCalledWith('mcprouter', 'context7')
    expect(mcpPresenter.installMcpRouterServer).toHaveBeenCalledWith('context7')
    expect(listResult).toEqual({
      servers: [
        expect.objectContaining({
          server_key: 'context7',
          title: 'Context7'
        })
      ]
    })
    expect(keyResult).toEqual({ key: 'router-key' })
    expect(saveResult).toEqual({ saved: true })
    expect(authResult).toEqual({ updated: true })
    expect(installedResult).toEqual({ installed: false })
    expect(installResult).toEqual({ installed: true })
  })

  it('dispatches remote control routes through RemoteControlPresenter', async () => {
    const { runtime, remoteControlPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    await dispatchDeepchatRoute(runtime, 'remoteControl.listChannels', {}, context)
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.getChannelSettings',
      {
        channel: 'telegram'
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.saveChannelSettings',
      {
        channel: 'telegram',
        settings: {
          botToken: 'telegram-token',
          remoteEnabled: true,
          defaultAgentId: 'deepchat',
          defaultWorkdir: ''
        }
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.getChannelStatus',
      {
        channel: 'telegram'
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.getChannelBindings',
      {
        channel: 'telegram'
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.removeChannelBinding',
      {
        channel: 'telegram',
        endpointKey: 'telegram:100:0'
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.removeChannelPrincipal',
      {
        channel: 'telegram',
        principalId: '123'
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.getChannelPairingSnapshot',
      {
        channel: 'telegram'
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.createChannelPairCode',
      {
        channel: 'telegram'
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.clearChannelPairCode',
      {
        channel: 'telegram'
      },
      context
    )
    await dispatchDeepchatRoute(runtime, 'remoteControl.getTelegramStatus', {}, context)
    await dispatchDeepchatRoute(runtime, 'remoteControl.getWeixinIlinkStatus', {}, context)
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.startWeixinIlinkLogin',
      {
        force: true
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.waitForWeixinIlinkLogin',
      {
        sessionKey: 'weixin-session',
        timeoutMs: 480000
      },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'remoteControl.removeWeixinIlinkAccount',
      {
        accountId: 'account-1'
      },
      context
    )
    const restartResult = await dispatchDeepchatRoute(
      runtime,
      'remoteControl.restartWeixinIlinkAccount',
      {
        accountId: 'account-1'
      },
      context
    )

    expect(remoteControlPresenter.listRemoteChannels).toHaveBeenCalledTimes(1)
    expect(remoteControlPresenter.getChannelSettings).toHaveBeenCalledWith('telegram')
    expect(remoteControlPresenter.saveChannelSettings).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({
        remoteEnabled: true
      })
    )
    expect(remoteControlPresenter.getChannelStatus).toHaveBeenCalledWith('telegram')
    expect(remoteControlPresenter.getChannelBindings).toHaveBeenCalledWith('telegram')
    expect(remoteControlPresenter.removeChannelBinding).toHaveBeenCalledWith(
      'telegram',
      'telegram:100:0'
    )
    expect(remoteControlPresenter.removeChannelPrincipal).toHaveBeenCalledWith('telegram', '123')
    expect(remoteControlPresenter.getChannelPairingSnapshot).toHaveBeenCalledWith('telegram')
    expect(remoteControlPresenter.createChannelPairCode).toHaveBeenCalledWith('telegram')
    expect(remoteControlPresenter.clearChannelPairCode).toHaveBeenCalledWith('telegram')
    expect(remoteControlPresenter.getTelegramStatus).toHaveBeenCalledTimes(1)
    expect(remoteControlPresenter.getWeixinIlinkStatus).toHaveBeenCalledTimes(1)
    expect(remoteControlPresenter.startWeixinIlinkLogin).toHaveBeenCalledWith({ force: true })
    expect(remoteControlPresenter.waitForWeixinIlinkLogin).toHaveBeenCalledWith({
      sessionKey: 'weixin-session',
      timeoutMs: 480000
    })
    expect(remoteControlPresenter.removeWeixinIlinkAccount).toHaveBeenCalledWith('account-1')
    expect(remoteControlPresenter.restartWeixinIlinkAccount).toHaveBeenCalledWith('account-1')
    expect(restartResult).toEqual({ restarted: true })
  })

  it('dispatches DeepChat agent config routes through ConfigPresenter', async () => {
    const { runtime, configPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const listResult = await dispatchDeepchatRoute(
      runtime,
      'config.listAgents',
      { agentType: 'deepchat' },
      context
    )
    const createResult = await dispatchDeepchatRoute(
      runtime,
      'config.createDeepChatAgent',
      {
        name: 'Writer',
        enabled: true,
        config: {
          systemPrompt: 'Write clearly'
        }
      },
      context
    )
    const updateResult = await dispatchDeepchatRoute(
      runtime,
      'config.updateDeepChatAgent',
      {
        agentId: 'writer',
        updates: {
          name: 'Writer Pro',
          enabled: false
        }
      },
      context
    )
    const deleteResult = await dispatchDeepchatRoute(
      runtime,
      'config.deleteDeepChatAgent',
      {
        agentId: 'writer'
      },
      context
    )

    expect(listResult).toEqual({
      agents: [
        expect.objectContaining({
          id: 'deepchat'
        })
      ]
    })
    expect(configPresenter.createDeepChatAgent).toHaveBeenCalledWith({
      name: 'Writer',
      enabled: true,
      config: {
        systemPrompt: 'Write clearly'
      }
    })
    expect(createResult).toEqual({
      agent: expect.objectContaining({
        id: 'writer',
        name: 'Writer'
      })
    })
    expect(configPresenter.updateDeepChatAgent).toHaveBeenCalledWith('writer', {
      name: 'Writer Pro',
      enabled: false
    })
    expect(updateResult).toEqual({
      agent: expect.objectContaining({
        id: 'writer',
        name: 'Writer Pro',
        enabled: false
      })
    })
    expect(configPresenter.deleteDeepChatAgent).toHaveBeenCalledWith('writer')
    expect(deleteResult).toEqual({
      removed: true
    })
  })

  it('dispatches proxy, logging, update channel, skill draft, provider DB, and hook routes', async () => {
    const { runtime, configPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const initialProxy = await dispatchDeepchatRoute(
      runtime,
      'config.getProxySettings',
      {},
      context
    )
    const updatedMode = await dispatchDeepchatRoute(
      runtime,
      'config.setProxyMode',
      {
        mode: 'custom'
      },
      context
    )
    const updatedUrl = await dispatchDeepchatRoute(
      runtime,
      'config.setCustomProxyUrl',
      {
        url: 'http://127.0.0.1:7890'
      },
      context
    )
    const loggingResult = await dispatchDeepchatRoute(
      runtime,
      'config.openLoggingFolder',
      {},
      context
    )
    const initialUpdateChannel = await dispatchDeepchatRoute(
      runtime,
      'config.getUpdateChannel',
      {},
      context
    )
    const updatedUpdateChannel = await dispatchDeepchatRoute(
      runtime,
      'config.setUpdateChannel',
      {
        channel: 'beta'
      },
      context
    )
    const initialSkillDraftSuggestions = await dispatchDeepchatRoute(
      runtime,
      'config.getSkillDraftSuggestions',
      {},
      context
    )
    const updatedSkillDraftSuggestions = await dispatchDeepchatRoute(
      runtime,
      'config.setSkillDraftSuggestions',
      {
        enabled: true
      },
      context
    )
    const refreshProviderDbResult = await dispatchDeepchatRoute(
      runtime,
      'config.refreshProviderDb',
      {
        force: true
      },
      context
    )
    const initialHooksConfig = await dispatchDeepchatRoute(
      runtime,
      'config.getHooksNotifications',
      {},
      context
    )
    const updatedHooksConfig = await dispatchDeepchatRoute(
      runtime,
      'config.setHooksNotifications',
      {
        config: {
          hooks: [
            {
              id: 'hook-1',
              name: 'Hook 1',
              enabled: true,
              command: 'echo test',
              events: ['SessionStart']
            }
          ]
        }
      },
      context
    )
    const hookTestResult = await dispatchDeepchatRoute(
      runtime,
      'config.testHookCommand',
      {
        hookId: 'hook-1'
      },
      context
    )

    expect(initialProxy).toEqual({
      mode: 'system',
      customProxyUrl: ''
    })
    expect(configPresenter.setProxyMode).toHaveBeenCalledWith('custom')
    expect(updatedMode).toEqual({
      mode: 'custom',
      customProxyUrl: ''
    })
    expect(configPresenter.setCustomProxyUrl).toHaveBeenCalledWith('http://127.0.0.1:7890')
    expect(updatedUrl).toEqual({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7890'
    })
    expect(configPresenter.openLoggingFolder).toHaveBeenCalled()
    expect(loggingResult).toEqual({
      opened: true
    })
    expect(initialUpdateChannel).toEqual({
      channel: 'stable'
    })
    expect(configPresenter.setUpdateChannel).toHaveBeenCalledWith('beta')
    expect(updatedUpdateChannel).toEqual({
      channel: 'beta'
    })
    expect(initialSkillDraftSuggestions).toEqual({
      enabled: false
    })
    expect(configPresenter.setSkillDraftSuggestionsEnabled).toHaveBeenCalledWith(true)
    expect(updatedSkillDraftSuggestions).toEqual({
      enabled: true
    })
    expect(configPresenter.refreshProviderDb).toHaveBeenCalledWith(true)
    expect(refreshProviderDbResult).toEqual({
      result: {
        status: 'updated',
        lastUpdated: 123,
        providersCount: 2
      }
    })
    expect(initialHooksConfig).toEqual({
      config: {
        hooks: []
      }
    })
    expect(configPresenter.setHooksNotificationsConfig).toHaveBeenCalledWith({
      hooks: [
        {
          id: 'hook-1',
          name: 'Hook 1',
          enabled: true,
          command: 'echo test',
          events: ['SessionStart']
        }
      ]
    })
    expect(updatedHooksConfig).toEqual({
      config: {
        hooks: [
          {
            id: 'hook-1',
            name: 'Hook 1',
            enabled: true,
            command: 'echo test',
            events: ['SessionStart']
          }
        ]
      }
    })
    expect(configPresenter.testHookCommand).toHaveBeenCalledWith('hook-1')
    expect(hookTestResult).toEqual({
      result: {
        success: true,
        durationMs: 10,
        exitCode: 0
      }
    })
  })

  it('dispatches ACP config routes through ConfigPresenter', async () => {
    const { runtime, configPresenter } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const setEnabledResult = await dispatchDeepchatRoute(
      runtime,
      'config.setAcpEnabled',
      { enabled: false },
      context
    )
    const registryResult = await dispatchDeepchatRoute(
      runtime,
      'config.listAcpRegistryAgents',
      {},
      context
    )
    const refreshResult = await dispatchDeepchatRoute(
      runtime,
      'config.refreshAcpRegistry',
      { force: true },
      context
    )
    const manualResult = await dispatchDeepchatRoute(
      runtime,
      'config.listManualAcpAgents',
      {},
      context
    )
    const addManualResult = await dispatchDeepchatRoute(
      runtime,
      'config.addManualAcpAgent',
      {
        name: 'Manual New',
        command: 'node',
        enabled: true
      },
      context
    )
    const updateManualResult = await dispatchDeepchatRoute(
      runtime,
      'config.updateManualAcpAgent',
      {
        agentId: 'manual-acp',
        updates: { enabled: false }
      },
      context
    )
    const removeManualResult = await dispatchDeepchatRoute(
      runtime,
      'config.removeManualAcpAgent',
      { agentId: 'manual-acp' },
      context
    )
    const setAgentEnabledResult = await dispatchDeepchatRoute(
      runtime,
      'config.setAcpAgentEnabled',
      { agentId: 'codex-acp', enabled: true },
      context
    )
    const setEnvResult = await dispatchDeepchatRoute(
      runtime,
      'config.setAcpAgentEnvOverride',
      { agentId: 'codex-acp', env: { KEY: 'value' } },
      context
    )
    const ensureResult = await dispatchDeepchatRoute(
      runtime,
      'config.ensureAcpAgentInstalled',
      { agentId: 'codex-acp' },
      context
    )
    const repairResult = await dispatchDeepchatRoute(
      runtime,
      'config.repairAcpAgent',
      { agentId: 'codex-acp' },
      context
    )
    const uninstallResult = await dispatchDeepchatRoute(
      runtime,
      'config.uninstallAcpRegistryAgent',
      { agentId: 'codex-acp' },
      context
    )

    expect(configPresenter.setAcpEnabled).toHaveBeenCalledWith(false)
    expect(setEnabledResult).toEqual({ enabled: false })
    expect(registryResult).toEqual({
      agents: [expect.objectContaining({ id: 'codex-acp' })]
    })
    expect(refreshResult).toEqual({
      agents: [expect.objectContaining({ id: 'codex-acp' })]
    })
    expect(manualResult).toEqual({
      agents: [expect.objectContaining({ id: 'manual-acp' })]
    })
    expect(addManualResult).toEqual({
      agent: expect.objectContaining({ id: 'manual-new', name: 'Manual New' })
    })
    expect(updateManualResult).toEqual({
      agent: expect.objectContaining({ id: 'manual-acp', enabled: false })
    })
    expect(removeManualResult).toEqual({ removed: true })
    expect(setAgentEnabledResult).toEqual({ ok: true })
    expect(setEnvResult).toEqual({ ok: true })
    expect(ensureResult).toEqual({
      installState: expect.objectContaining({ status: 'installed' })
    })
    expect(repairResult).toEqual({
      installState: expect.objectContaining({ status: 'installed' })
    })
    expect(uninstallResult).toEqual({ ok: true })
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

    const compactResult = await dispatchDeepchatRoute(
      runtime,
      'sessions.compact',
      {
        sessionId: 'session-1'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    expect(agentSessionPresenter.compactSession).toHaveBeenCalledWith('session-1')
    expect(compactResult).toEqual({
      compacted: true,
      state: {
        status: 'compacted',
        cursorOrderSeq: 5,
        summaryUpdatedAt: 123
      }
    })
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

  it('dispatches agent dashboard routes through AgentSessionPresenter', async () => {
    const { runtime, agentSessionPresenter } = createRuntime()
    const context = {
      webContentsId: 88,
      windowId: 3
    }

    const agentsResult = await dispatchDeepchatRoute(runtime, 'sessions.getAgents', {}, context)
    const dashboardResult = await dispatchDeepchatRoute(
      runtime,
      'sessions.getUsageDashboard',
      {},
      context
    )
    const retryResult = await dispatchDeepchatRoute(
      runtime,
      'sessions.retryRtkHealthCheck',
      {},
      context
    )

    expect(agentSessionPresenter.getAgents).toHaveBeenCalledTimes(1)
    expect(agentSessionPresenter.getUsageDashboard).toHaveBeenCalledTimes(1)
    expect(agentSessionPresenter.retryRtkHealthCheck).toHaveBeenCalledTimes(1)
    expect(agentsResult).toEqual({
      agents: [expect.objectContaining({ id: 'deepchat' })]
    })
    expect(dashboardResult).toEqual({
      dashboard: expect.objectContaining({
        summary: expect.objectContaining({ messageCount: 1 })
      })
    })
    expect(retryResult).toEqual({ retried: true })
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

    const keyStatusResult = await dispatchDeepchatRoute(
      runtime,
      'providers.getKeyStatus',
      {
        providerId: 'openai'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const rateLimitStatusResult = await dispatchDeepchatRoute(
      runtime,
      'providers.getRateLimitStatus',
      {
        providerId: 'openai'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const updateRateLimitResult = await dispatchDeepchatRoute(
      runtime,
      'providers.updateRateLimit',
      {
        providerId: 'openai',
        enabled: true,
        qpsLimit: 2
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const embeddingDimensionsResult = await dispatchDeepchatRoute(
      runtime,
      'providers.getEmbeddingDimensions',
      {
        providerId: 'openai',
        modelId: 'text-embedding-3-small'
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const modelScopeSyncResult = await dispatchDeepchatRoute(
      runtime,
      'providers.syncModelScopeMcpServers',
      {
        providerId: 'modelscope',
        syncOptions: {
          page_number: 1,
          page_size: 50
        }
      },
      {
        webContentsId: 88,
        windowId: 3
      }
    )

    const acpDebugResult = await dispatchDeepchatRoute(
      runtime,
      'providers.runAcpDebugAction',
      {
        agentId: 'codex-acp',
        action: 'initialize',
        payload: {}
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
    expect(llmProviderPresenter.getKeyStatus).toHaveBeenCalledWith('openai')
    expect(llmProviderPresenter.getProviderRateLimitStatus).toHaveBeenCalledWith('openai')
    expect(llmProviderPresenter.updateProviderRateLimit).toHaveBeenCalledWith('openai', true, 2)
    expect(llmProviderPresenter.getDimensions).toHaveBeenCalledWith(
      'openai',
      'text-embedding-3-small'
    )
    expect(llmProviderPresenter.syncModelScopeMcpServers).toHaveBeenCalledWith('modelscope', {
      page_number: 1,
      page_size: 50
    })
    expect(llmProviderPresenter.runAcpDebugAction).toHaveBeenCalledWith({
      agentId: 'codex-acp',
      action: 'initialize',
      payload: {},
      webContentsId: 88
    })
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
    expect(keyStatusResult).toEqual({
      status: {
        remainNum: 42,
        limit_remaining: '42',
        usage: '8'
      }
    })
    expect(rateLimitStatusResult).toEqual({
      status: {
        config: {
          enabled: false,
          qpsLimit: 1
        },
        currentQps: 0,
        queueLength: 0,
        lastRequestTime: 0
      }
    })
    expect(updateRateLimitResult).toEqual({
      config: {
        enabled: true,
        qpsLimit: 2
      }
    })
    expect(embeddingDimensionsResult).toEqual({
      result: {
        data: {
          dimensions: 1536,
          normalized: true
        }
      }
    })
    expect(modelScopeSyncResult).toEqual({
      result: {
        success: true,
        message: 'ok',
        synced: 1,
        imported: 1,
        skipped: 0,
        errors: []
      }
    })
    expect(acpDebugResult).toEqual({
      result: {
        status: 'ok',
        sessionId: 'debug-session',
        events: [
          {
            id: 'event-1',
            kind: 'response',
            action: 'initialize',
            agentId: 'codex-acp',
            timestamp: 123,
            payload: {
              ok: true
            }
          }
        ]
      }
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

    const closeSettingsResult = await dispatchDeepchatRoute(
      runtime,
      'window.closeSettings',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const focusMainResult = await dispatchDeepchatRoute(
      runtime,
      'window.focusMain',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const notifySettingsReadyResult = await dispatchDeepchatRoute(
      runtime,
      'window.notifySettingsReady',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const pendingProviderInstallResult = await dispatchDeepchatRoute(
      runtime,
      'window.consumePendingSettingsProviderInstall',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const requeueProviderInstallResult = await dispatchDeepchatRoute(
      runtime,
      'window.requeuePendingSettingsProviderInstall',
      {
        preview: pendingProviderInstallResult.preview
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    const startGuidedOnboardingResult = await dispatchDeepchatRoute(
      runtime,
      'window.startGuidedOnboarding',
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
    expect(windowPresenter.getSettingsWindowId).toHaveBeenCalled()
    expect(windowPresenter.closeSettingsWindow).toHaveBeenCalled()
    expect(closeSettingsResult).toEqual({ closed: true })
    expect(windowPresenter.focusMainWindow).toHaveBeenCalledTimes(2)
    expect(focusMainResult).toEqual({ focused: true })
    expect(windowPresenter.notifySettingsReady).toHaveBeenCalledWith(42)
    expect(notifySettingsReadyResult).toEqual({ notified: true })
    expect(windowPresenter.consumePendingSettingsProviderInstall).toHaveBeenCalled()
    expect(pendingProviderInstallResult).toEqual({
      preview: {
        kind: 'builtin',
        id: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-secret',
        maskedApiKey: 'sk-s...cret',
        iconModelId: 'deepseek-chat',
        willOverwrite: true
      }
    })
    expect(windowPresenter.setPendingSettingsProviderInstall).toHaveBeenCalledWith(
      pendingProviderInstallResult.preview
    )
    expect(requeueProviderInstallResult).toEqual({ queued: true })
    expect(windowPresenter.sendToAllWindows).toHaveBeenCalledWith('dev:start-guided-onboarding')
    expect(startGuidedOnboardingResult).toEqual({
      started: true,
      focused: true
    })
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
    const fileSelection = await dispatchDeepchatRoute(
      runtime,
      'device.selectFiles',
      {
        filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
      },
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
    const resetDataResult = await dispatchDeepchatRoute(
      runtime,
      'device.resetDataByType',
      {
        resetType: 'chat'
      },
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
    const reorderEnvironmentsResult = await dispatchDeepchatRoute(
      runtime,
      'project.reorderEnvironments',
      {
        paths: ['C:/workspace', 'C:/other']
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const archiveEnvironmentResult = await dispatchDeepchatRoute(
      runtime,
      'project.archiveEnvironment',
      {
        path: 'C:/workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const restoreEnvironmentResult = await dispatchDeepchatRoute(
      runtime,
      'project.restoreEnvironment',
      {
        path: 'C:/workspace'
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )
    const removeEnvironmentResult = await dispatchDeepchatRoute(
      runtime,
      'project.removeEnvironment',
      {
        path: 'C:/workspace'
      },
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
    const pathExistsResult = await dispatchDeepchatRoute(
      runtime,
      'project.pathExists',
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
    expect(devicePresenter.selectFiles).toHaveBeenCalledWith({
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })
    expect(fileSelection).toEqual({
      canceled: false,
      filePaths: ['C:/workspace/skill.zip']
    })
    expect(devicePresenter.restartApp).toHaveBeenCalledTimes(1)
    expect(restartResult).toEqual({ restarted: true })
    expect(devicePresenter.resetDataByType).toHaveBeenCalledWith('chat')
    expect(resetDataResult).toEqual({ reset: true })
    expect(sanitizeResult).toEqual({ content: '<svg />' })

    expect(projectPresenter.getRecentProjects).toHaveBeenCalledWith(5)
    expect(recentProjects).toEqual({
      projects: [
        {
          path: 'C:/workspace',
          name: 'workspace',
          icon: null,
          lastAccessedAt: 123,
          exists: true
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
          exists: true,
          status: 'active',
          sortOrder: 2147483647,
          archivedAt: null,
          removedAt: null
        }
      ]
    })
    expect(projectPresenter.reorderEnvironments).toHaveBeenCalledWith(['C:/workspace', 'C:/other'])
    expect(reorderEnvironmentsResult).toEqual({ updated: true })
    expect(projectPresenter.archiveEnvironment).toHaveBeenCalledWith('C:/workspace')
    expect(archiveEnvironmentResult).toEqual({ updated: true })
    expect(projectPresenter.restoreEnvironment).toHaveBeenCalledWith('C:/workspace')
    expect(restoreEnvironmentResult).toEqual({ updated: true })
    expect(projectPresenter.removeEnvironment).toHaveBeenCalledWith('C:/workspace')
    expect(removeEnvironmentResult).toEqual({ clearedSessionIds: ['session-1'] })
    expect(projectPresenter.openDirectory).toHaveBeenCalledWith('C:/workspace')
    expect(openDirectoryResult).toEqual({ opened: true })
    expect(projectPresenter.pathExists).toHaveBeenCalledWith('C:/workspace')
    expect(pathExistsResult).toEqual({ exists: true })
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
    const clearSandboxResult = await dispatchDeepchatRoute(
      runtime,
      'browser.clearSandboxData',
      {},
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
    expect(yoBrowserPresenter.clearSandboxData).toHaveBeenCalledTimes(1)
    expect(clearSandboxResult).toEqual({ cleared: true })
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
