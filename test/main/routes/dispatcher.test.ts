import type { ProviderSettingsPort } from '@/provider/settings'
import type { FileServicePort } from '@shared/types/file'
import type { SkillServicePort } from '@shared/types/skill'
import type { WorkspaceServicePort } from '@shared/types/workspace'
import type { SkillSyncServicePort } from '@shared/types/skillSync'
import type { RemoteServicePort } from '@shared/types/remote'
import type { IConversationExporter } from '@/exporter/interface'
import type { McpServicePort } from '@shared/types/mcp'
import type { ProviderRuntimePort } from '@shared/types/provider'
import type {
  IShortcutPresenter,
  ITabPresenter,
  IWindowPresenter,
  IYoBrowserPresenter
} from '@shared/types/desktop'
import type { MainDatabase } from '@/data/mainDatabase'
import type { TapeInspectionReader } from '@/tape/ports/capabilities'
import type { OAuthServicePort } from '@shared/types/oauth'
import type { DialogServicePort } from '@shared/types/dialog'
import type { DeviceServicePort } from '@shared/types/device'
import type { KnowledgeServicePort } from '@shared/types/knowledge'
import type { CronJob, CronJobRun } from '@shared/cronJobs'
import { projectEnvironmentsChangedEvent } from '@shared/contracts/events/project.events'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import { createDeepchatEventEnvelope, type DeepchatEventPublisher } from '@shared/contracts/events'
import type { ProviderInstallPreview } from '@shared/providerDeeplink'
import {
  createEmptyArchiveCandidateLifecyclePreview,
  createEmptyMemoryHealth,
  decodeMemoryPageCursor
} from '@shared/contracts/routes'
import { createRouteDispatcher, dispatchDeepchatRoute } from '@/routes'
import { createNodeScheduler } from '@/routes/scheduler'
import { ProviderImportService } from '@/provider/providerImportService'
import { createProviderRoutes } from '@/provider/routes'
import { createToolRoutes } from '@/tool/routes'
import { createPluginRoutes } from '@/plugin/routes'
import { createSkillRoutes } from '@/skill/routes'
import { createMcpRoutes } from '@/mcp/routes'
import { createRemoteRoutes } from '@/remote/routes'
import { createSchedulerRoutes } from '@/scheduler/routes'
import { createMemoryRoutes } from '@/memory/routes'
import { createDesktopRoutes } from '@/desktop/routes'
import { createFileRoutes } from '@/file/routes'
import { createKnowledgeRoutes } from '@/knowledge/routes'
import { createWorkspaceRoutes } from '@/workspace/routes'
import { createProjectRoutes } from '@/project/routes'
import { createSessionRoutes } from '@/session/routes'
import { createAgentRoutes } from '@/agent/routes'
import { createPromptRoutes } from '@/agent/promptRoutes'
import { createAcpRoutes } from '@/agent/acp/routes'
import { createDeviceRoutes } from '@/device/routes'
import { createOnboardingRoutes } from '@/onboarding/routes'
import { createExporterRoutes } from '@/exporter/routes'
import { createSyncRoutes } from '@/sync/routes'
import { createUpgradeRoutes } from '@/upgrade/routes'
import { createPlatformRoutes } from '@/platform/routes'
import { createHookRoutes } from '@/hook/routes'
import { createAppSettingsRoutes } from '@/app/settingsRoutes'
import { createAppRoutes } from '@/app/routes'
import { killTerminal, writeToTerminal } from '@/agent/acp/launch/acpInitHelper'

vi.mock('@/agent/acp/launch/acpInitHelper', () => ({
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
    floatingButtonEnabled: false,
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

  const providerSettings = {
    getSetting: vi.fn((key: keyof typeof settings) => settings[key]),
    setSetting: vi.fn((key: keyof typeof settings, value: unknown) => {
      ;(settings as Record<string, unknown>)[key] = value
    }),
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
    refreshProviderDb: vi.fn().mockResolvedValue({
      status: 'updated',
      lastUpdated: 123,
      providersCount: 2
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
    }),
    deleteDeepChatAgentWithCleanup: vi.fn().mockImplementation(async (agentId: string) => {
      const removed = await providerSettings.deleteDeepChatAgent(agentId)
      return { removed, cleanupPendingRestart: false }
    })
  } as unknown as ProviderSettingsPort

  const sessionSnapshot = {
    id: 'session-1',
    agentId: 'deepchat',
    title: 'Restored',
    projectDir: '/workspace',
    isPinned: false,
    isDraft: false,
    sessionKind: 'regular' as const,
    parentSessionId: null,
    subagentMeta: null,
    createdAt: 1,
    updatedAt: 2,
    status: 'idle' as const,
    providerId: 'openai',
    modelId: 'gpt-5.4'
  }
  const sessionLifecyclePort = {
    createSession: vi.fn().mockResolvedValue({ ...sessionSnapshot, title: 'New Chat' }),
    createDetachedSession: vi.fn().mockResolvedValue(sessionSnapshot),
    createSubagentSession: vi.fn().mockResolvedValue(sessionSnapshot),
    ensureAcpDraftSession: vi.fn().mockResolvedValue(sessionSnapshot),
    forkSession: vi.fn().mockResolvedValue(sessionSnapshot),
    deleteSession: vi.fn().mockResolvedValue(undefined)
  }
  const sessionProjectionPort = {
    getSession: vi.fn().mockResolvedValue(sessionSnapshot),
    listSessions: vi.fn().mockResolvedValue([]),
    listMessagesPage: vi.fn().mockResolvedValue({
      messages: [
        {
          id: 'message-1',
          sessionId: 'session-1',
          orderSeq: 1,
          role: 'user' as const,
          content: '{"text":"hello"}',
          status: 'sent' as const,
          isContextEdge: 0,
          metadata: '{}',
          createdAt: 1,
          updatedAt: 1
        }
      ],
      nextCursor: null,
      hasMore: false
    }),
    listLightweight: vi.fn().mockResolvedValue({
      sessions: [],
      nextCursor: null,
      hasMore: false
    }),
    getLightweightByIds: vi.fn().mockResolvedValue([]),
    getSearchResults: vi.fn().mockResolvedValue([]),
    getTapeContext: vi.fn().mockResolvedValue({ entries: [] }),
    listMessageTraces: vi.fn().mockResolvedValue([]),
    listMessageViewManifests: vi.fn().mockResolvedValue([]),
    exportMessageTapeReplaySlice: vi.fn().mockResolvedValue(null),
    renameSession: vi.fn().mockResolvedValue(undefined),
    toggleSessionPinned: vi.fn().mockResolvedValue(undefined),
    getMessage: vi.fn().mockResolvedValue({
      id: 'message-1',
      sessionId: 'session-1',
      orderSeq: 1,
      role: 'user' as const,
      content: '{"text":"hello"}',
      status: 'sent' as const,
      isContextEdge: 0,
      metadata: '{}',
      createdAt: 1,
      updatedAt: 1
    })
  }
  const desktopSessionBinding = {
    activate: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn().mockResolvedValue(undefined),
    getActive: vi.fn().mockResolvedValue(null),
    getActiveId: vi.fn(() => null)
  }
  const sessionTurnPort = {
    sendMessage: vi.fn().mockResolvedValue({
      requestId: 'message-2',
      messageId: 'message-2'
    }),
    steerActiveTurn: vi.fn().mockResolvedValue(undefined),
    listPendingInputs: vi.fn().mockResolvedValue([]),
    queuePendingInput: vi.fn().mockResolvedValue({}),
    updateQueuedInput: vi.fn().mockResolvedValue({}),
    moveQueuedInput: vi.fn().mockResolvedValue([]),
    convertPendingInputToSteer: vi.fn().mockResolvedValue({}),
    steerPendingInput: vi.fn().mockResolvedValue({}),
    deletePendingInput: vi.fn().mockResolvedValue(undefined),
    retryMessage: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editUserMessage: vi.fn().mockResolvedValue({}),
    getSessionCompactionState: vi.fn().mockResolvedValue({ status: 'idle' }),
    compactSession: vi.fn().mockResolvedValue({
      compacted: true,
      state: {
        status: 'compacted',
        cursorOrderSeq: 5,
        summaryUpdatedAt: 123
      }
    }),
    clearSessionMessages: vi.fn().mockResolvedValue(undefined),
    cancelGeneration: vi.fn().mockResolvedValue(undefined),
    respondToolInteraction: vi.fn().mockResolvedValue({ resumed: true })
  }
  const sessionAssignmentPort = {
    getAgentTransferImpact: vi.fn().mockResolvedValue({}),
    moveAgentSessions: vi.fn().mockResolvedValue({ movedSessionIds: [], deletedSessionIds: [] }),
    deleteAgentSessions: vi.fn().mockResolvedValue([]),
    moveSessionToAgent: vi.fn().mockResolvedValue(sessionSnapshot),
    getAcpSessionCommands: vi.fn().mockResolvedValue([]),
    getAcpSessionConfigOptions: vi.fn().mockResolvedValue(null),
    setAcpSessionConfigOption: vi.fn().mockResolvedValue(null),
    getPermissionMode: vi.fn().mockResolvedValue('full_access'),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setSessionModel: vi.fn().mockResolvedValue(sessionSnapshot),
    setSessionProjectDir: vi.fn().mockResolvedValue(sessionSnapshot),
    getSessionGenerationSettings: vi.fn().mockResolvedValue({
      systemPrompt: '',
      temperature: 0.7,
      contextLength: 32000,
      maxTokens: 4096,
      timeout: 5000
    }),
    getSessionDisabledAgentTools: vi.fn().mockResolvedValue([]),
    updateSessionDisabledAgentTools: vi.fn().mockResolvedValue([]),
    updateSessionGenerationSettings: vi
      .fn()
      .mockImplementation(async (_sessionId: string, settings: { timeout?: number }) => ({
        systemPrompt: '',
        temperature: 0.7,
        contextLength: 32000,
        maxTokens: 4096,
        timeout: settings.timeout ?? 5000
      }))
  }
  const sessionPermissionPort = {
    clearSessionPermissions: vi.fn()
  }

  let rateLimitConfig = {
    enabled: false,
    qpsLimit: 1
  }
  const providerRuntime = {
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
    refreshModels: vi.fn().mockResolvedValue(undefined)
  } as unknown as ProviderRuntimePort
  const acpProviderAdminPort = {
    warmupAcpProcess: vi.fn().mockResolvedValue(undefined),
    getAcpProcessConfigOptions: vi.fn().mockResolvedValue(null),
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
    })
  }

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
  const mcpService = {
    getNpmRegistryStatus: vi.fn().mockResolvedValue({
      currentRegistry: 'https://registry.npmjs.org/',
      isFromCache: false,
      autoDetectEnabled: true
    }),
    refreshNpmRegistry: vi.fn().mockResolvedValue('https://registry.npmjs.org/'),
    setCustomNpmRegistry: vi.fn().mockResolvedValue(undefined),
    setAutoDetectNpmRegistry: vi.fn().mockResolvedValue(undefined),
    clearNpmRegistryCache: vi.fn().mockResolvedValue(undefined),
    listMcpRouterServers: vi.fn().mockResolvedValue({ servers: [mcpRouterItem] }),
    installMcpRouterServer: vi.fn().mockResolvedValue(true),
    getMcpRouterApiKey: vi.fn().mockResolvedValue('router-key'),
    setMcpRouterApiKey: vi.fn().mockResolvedValue(undefined),
    isServerInstalled: vi.fn().mockResolvedValue(false),
    listInstalledServerIds: vi.fn().mockResolvedValue(['context7']),
    updateMcpRouterServersAuth: vi.fn().mockResolvedValue(undefined)
  } as unknown as McpServicePort
  const remoteService = {
    listRemoteChannels: vi.fn().mockResolvedValue([
      {
        id: 'telegram',
        titleKey: 'settings.remote.telegram.title',
        descriptionKey: 'settings.remote.telegram.description',
        supportsCronDelivery: true
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
  } as unknown as RemoteServicePort
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
    mainWindow: browserWindowState.windows.get(3),
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
    show: vi.fn((windowId: number) => {
      const window = browserWindowState.windows.get(windowId)
      if (window) {
        window.focused = true
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
  const dialogService = {
    handleDialogResponse: vi.fn().mockResolvedValue(undefined),
    handleDialogError: vi.fn().mockResolvedValue(undefined)
  }

  const deviceService = {
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
  } as unknown as DeviceServicePort
  const appDataReset = {
    resetDataByType: vi.fn().mockResolvedValue(undefined)
  }
  const enabledDatabaseSecurityStatus = {
    enabled: true,
    cipher: 'sqlcipher' as const,
    safeStorageAvailable: true,
    passwordStorage: 'safeStorage' as const,
    manualUnlockRequired: false,
    migrationInProgress: false
  }
  const appDatabaseMaintenance = {
    assertRouteAllowed: vi.fn(),
    enableDatabaseEncryption: vi.fn().mockResolvedValue(enabledDatabaseSecurityStatus),
    changeDatabasePassword: vi.fn().mockResolvedValue(enabledDatabaseSecurityStatus),
    disableDatabaseEncryption: vi.fn().mockResolvedValue({
      ...enabledDatabaseSecurityStatus,
      enabled: false,
      passwordStorage: 'none' as const
    }),
    importFromSync: vi.fn().mockResolvedValue({
      success: true,
      message: 'sync.success.importComplete'
    }),
    pullLatestBackupFromCloud: vi.fn().mockResolvedValue({
      success: true,
      message: 'sync.success.importComplete',
      fileName: 'backup-1.zip'
    })
  }
  const startupWorkloadCoordinator = {
    scheduleTask: vi.fn(async (task: { run: () => Promise<unknown> }) => await task.run()),
    getRunId: vi.fn(() => 'startup:test'),
    replayTarget: vi.fn()
  }
  const syncService = {
    getBackupStatus: vi.fn().mockResolvedValue({}),
    listBackups: vi.fn().mockResolvedValue([]),
    startBackup: vi.fn().mockResolvedValue(null),
    openSyncFolder: vi.fn().mockResolvedValue(undefined),
    testCloudConnection: vi.fn().mockResolvedValue({ success: true }),
    uploadLatestBackupToCloud: vi.fn().mockResolvedValue({ success: true, fileName: 'backup.zip' })
  }
  const syncSettings = {
    getEnabled: vi.fn(() => false),
    setEnabled: vi.fn(),
    getFolderPath: vi.fn(() => '/tmp/deepchat-sync'),
    setFolderPath: vi.fn(),
    getCloudConfig: vi.fn(() => ({
      enabled: false,
      endpoint: '',
      bucket: '',
      region: 'auto',
      prefix: 'deepchat-backups',
      accessKeyId: '',
      hasSecret: false,
      safeStorageAvailable: true
    })),
    setCloudConfig: vi.fn()
  }
  const hookSettings = {
    getHooksNotificationsConfig: vi.fn(() => hooksNotifications),
    setHooksNotificationsConfig: vi.fn((config: typeof hooksNotifications) => {
      hooksNotifications.hooks = [...config.hooks]
      return hooksNotifications
    })
  }
  const updateSettings = {
    getChannel: vi.fn(() => settings.updateChannel),
    setChannel: vi.fn((channel: 'stable' | 'beta') => {
      settings.updateChannel = channel
    })
  }
  const agentDefaults = {
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
    })
  }
  const skillSettings = {
    isEnabled: vi.fn(() => true),
    isDraftSuggestionsEnabled: vi.fn(() => settings.skillDraftSuggestionsEnabled),
    setDraftSuggestionsEnabled: vi.fn((enabled: boolean) => {
      settings.skillDraftSuggestionsEnabled = enabled
    })
  }
  const privacySettings = {
    isEnabled: vi.fn(() => settings.privacyModeEnabled),
    setEnabled: vi.fn((enabled: boolean) => {
      settings.privacyModeEnabled = enabled
    })
  }
  const traceSettings = {
    isEnabled: vi.fn(() => settings.traceDebugEnabled),
    setEnabled: vi.fn((enabled: boolean) => {
      settings.traceDebugEnabled = enabled
    })
  }
  const proxySettings = {
    getMode: vi.fn(() => settings.proxyMode),
    setMode: vi.fn((mode: 'system' | 'none' | 'custom') => {
      settings.proxyMode = mode
    }),
    getCustomUrl: vi.fn(() => settings.customProxyUrl),
    setCustomUrl: vi.fn((url: string) => {
      settings.customProxyUrl = url
    })
  }
  const applyProxyMode = vi.fn()
  const applyCustomProxyUrl = vi.fn()
  const desktopSettings = {
    getCopyWithCotEnabled: vi.fn(() => settings.copyWithCotEnabled),
    setCopyWithCotEnabled: vi.fn((enabled: boolean) => {
      settings.copyWithCotEnabled = enabled
    }),
    getFontSizeLevel: vi.fn(() => settings.fontSizeLevel),
    setFontSizeLevel: vi.fn((value: number) => {
      settings.fontSizeLevel = value
    }),
    getArtifactsEffectEnabled: vi.fn(() => settings.artifactsEffectEnabled),
    setArtifactsEffectEnabled: vi.fn((value: boolean) => {
      settings.artifactsEffectEnabled = value
    }),
    getAutoScrollEnabled: vi.fn(() => settings.autoScrollEnabled),
    setAutoScrollEnabled: vi.fn((value: boolean) => {
      settings.autoScrollEnabled = value
    }),
    getNotificationsEnabled: vi.fn(() => settings.notificationsEnabled),
    setNotificationsEnabled: vi.fn((value: boolean) => {
      settings.notificationsEnabled = value
    }),
    getLaunchAtLoginEnabled: vi.fn(() => settings.launchAtLoginEnabled),
    setLaunchAtLoginEnabled: vi.fn((value: boolean) => {
      settings.launchAtLoginEnabled = value
    }),
    getContentProtectionEnabled: vi.fn(() => settings.contentProtectionEnabled),
    setContentProtectionEnabled: vi.fn((value: boolean) => {
      settings.contentProtectionEnabled = value
    }),
    getFloatingButtonEnabled: vi.fn(() => settings.floatingButtonEnabled),
    setFloatingButtonEnabled: vi.fn((value: boolean) => {
      settings.floatingButtonEnabled = value
    }),
    getShortcutKeys: vi.fn(() => ({})),
    setShortcutKeys: vi.fn(),
    resetShortcutKeys: vi.fn()
  }
  const fontSettings = {
    getFontFamily: vi.fn(() => settings.fontFamily),
    setFontFamily: vi.fn((value?: string | null) => {
      settings.fontFamily = value ?? ''
    }),
    getCodeFontFamily: vi.fn(() => settings.codeFontFamily),
    setCodeFontFamily: vi.fn((value?: string | null) => {
      settings.codeFontFamily = value ?? ''
    }),
    getSystemFonts: vi.fn().mockResolvedValue(['Inter', 'JetBrains Mono'])
  }
  const applyContentProtection = vi.fn()
  const setFloatingButtonEnabled = vi.fn()
  const loggingService = {
    getEnabled: vi.fn(() => settings.loggingEnabled),
    setEnabled: vi.fn((value: boolean) => {
      settings.loggingEnabled = value
    }),
    openFolder: vi.fn().mockResolvedValue(undefined)
  }
  const testHookCommand = vi.fn().mockResolvedValue({
    success: true,
    durationMs: 10,
    exitCode: 0
  })

  const projectPresenter = {
    getDefaultProjectPath: vi.fn(() => settings.defaultProjectPath),
    setDefaultProjectPath: vi.fn((projectPath: string | null) => {
      settings.defaultProjectPath = projectPath
    }),
    ensureDefaultWorkspace: vi.fn().mockResolvedValue('C:/Users/test/Documents/DeepChat'),
    getSnapshotVersion: vi.fn(() => 1),
    getSnapshot: vi.fn().mockResolvedValue({
      version: 1,
      projects: [],
      environments: [],
      archivedEnvironments: [],
      removedEnvironments: [],
      defaultProjectPath: null
    }),
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
  }

  const fileService = {
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
  } as unknown as FileServicePort

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
  const knowledgeService = {
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
  } as unknown as KnowledgeServicePort

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
  const skillSyncService = {
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
  } as unknown as SkillSyncServicePort

  const oauthService = {
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
  } as unknown as OAuthServicePort
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
  const skillService = {
    readSkillFile: vi.fn().mockResolvedValue('---\nname: write-tests\n---\nUse tests well')
  } as unknown as SkillServicePort

  const workspaceService = {
    registerWorkspace: vi.fn().mockResolvedValue(undefined),
    unregisterWorkspace: vi.fn().mockResolvedValue(undefined),
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
  } as unknown as WorkspaceServicePort

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
    repairSchema: vi.fn().mockResolvedValue(databaseRepairReport),
    agentMemoryAuditTable: {
      listByAgent: vi.fn(() => [])
    }
  } as unknown as MainDatabase
  const tapeInspection: TapeInspectionReader = {
    getEffectiveMessageSourceSpan: vi.fn(() => []),
    listMemoryViewManifestsByAgent: vi.fn(() => [])
  }
  const cronJob = {
    id: 'cron-1',
    name: 'Cron smoke',
    description: null,
    enabled: true,
    status: 'ready' as const,
    cronExpr: '0 9 * * *',
    timezone: 'UTC',
    agentId: 'deepchat',
    nextRunAt: null,
    misfirePolicy: 'skip' as const,
    maxCatchUpRuns: null,
    scheduleError: null,
    taskPrompt: 'Summarize issues',
    taskSystemInstruction: null,
    taskOutputMode: 'final_message' as const,
    modelPolicy: 'follow_agent' as const,
    toolPolicy: 'follow_agent' as const,
    permissionPolicy: 'follow_agent' as const,
    runtime: {
      maxDurationMs: 3_600_000,
      maxTurns: 20,
      concurrencyPolicy: 'skip' as const
    },
    agentSnapshot: null,
    delivery: {
      targets: [],
      suppressSuccessNotification: false,
      notifyOnFailure: true
    },
    createdAt: 1,
    updatedAt: 2
  }
  const cronRun = {
    id: 'run-1',
    jobId: 'cron-1',
    sessionId: 'session-1',
    scheduledAt: 3,
    queuedAt: 3,
    startedAt: 4,
    completedAt: 5,
    status: 'completed' as const,
    reason: 'manual' as const,
    outputMessageId: null,
    outputPreview: null,
    error: null,
    claimedAt: 4,
    claimOwner: 'owner-1',
    createdAt: 3,
    updatedAt: 5
  }
  const cronDelivery = {
    id: 'delivery-1',
    jobId: 'cron-1',
    runId: 'run-1',
    targetType: 'remote' as const,
    target: {
      type: 'remote' as const,
      remoteId: 'telegram',
      channelId: 'telegram:-100:0',
      mode: 'summary' as const
    },
    status: 'success' as const,
    remoteMessageId: null,
    error: null,
    createdAt: 6,
    updatedAt: 6
  }
  const cronStatus = {
    state: 'idle' as const,
    pid: null,
    enabledJobCount: 1,
    nextRunAt: null,
    lastHeartbeatAt: null,
    lastError: null,
    restartAttempts: 0,
    updatedAt: 6
  }
  const cronJobs = {
    list: vi.fn(async () => ({ jobs: [cronJob], schedulerStatus: cronStatus })),
    upsert: vi.fn(async () => ({ job: cronJob, schedulerStatus: cronStatus })),
    delete: vi.fn(async () => cronStatus),
    toggle: vi.fn(async () => ({ job: cronJob, schedulerStatus: cronStatus })),
    runNow: vi.fn(async () => ({ job: cronJob, run: cronRun, schedulerStatus: cronStatus })),
    listRuns: vi.fn(() => [cronRun]),
    getRun: vi.fn(() => cronRun),
    listDeliveries: vi.fn(() => [cronDelivery]),
    getSchedulerStatus: vi.fn(() => cronStatus),
    reconcileScheduler: vi.fn(async () => cronStatus),
    restartScheduler: vi.fn(async () => cronStatus),
    validateSchedule: vi.fn(() => ({ valid: true, error: null, nextRunAt: 10 })),
    previewSchedule: vi.fn(() => ({ runs: [10, 20, 30], error: null }))
  }
  const usageStatsService = {
    getDashboard: vi.fn().mockResolvedValue({
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
        mostActiveDay: { date: '2026-06-11', messageCount: 1 }
      },
      calendar: [],
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
    })
  }
  const rtkRuntimeService = {
    retryHealthCheck: vi.fn().mockResolvedValue(undefined)
  }
  const sessionHistorySearch = {
    search: vi.fn().mockResolvedValue([
      {
        kind: 'session',
        sessionId: 'session-1',
        title: 'Search Hit',
        projectDir: null,
        updatedAt: 1
      }
    ])
  }
  const agentSessionExportService = {
    export: vi.fn().mockResolvedValue({ filename: 'session.md', content: '# Session' })
  }
  const sessionTranslation = {
    translate: vi.fn().mockResolvedValue('translated')
  }
  const toolService = {
    getAllToolDefinitions: vi.fn().mockResolvedValue([
      {
        type: 'function',
        source: 'agent',
        function: {
          name: 'read',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} }
        },
        server: {
          name: 'agent-filesystem',
          icons: '',
          description: 'Agent filesystem tools'
        }
      }
    ]),
    getConfigurableAgentToolDefinitions: vi.fn().mockResolvedValue([
      {
        type: 'function',
        source: 'agent',
        function: {
          name: 'read',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} }
        },
        server: {
          name: 'agent-filesystem',
          icons: '',
          description: 'Agent filesystem tools'
        }
      }
    ])
  }
  const pluginService = {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    listPlugins: vi.fn().mockResolvedValue([]),
    getPlugin: vi.fn().mockResolvedValue(undefined),
    enablePlugin: vi.fn(),
    disablePlugin: vi.fn(),
    invokeAction: vi.fn()
  }

  const publishDeepchatEvent: DeepchatEventPublisher = (name, payload) => {
    windowPresenter.sendToAllWindows(
      DEEPCHAT_EVENT_CHANNEL,
      createDeepchatEventEnvelope(name, payload)
    )
  }

  const providerRoutes = createProviderRoutes({
    providerSettings,
    providerRuntime,
    acpProviderAdminPort,
    providerImportService: new ProviderImportService(providerSettings as any),
    oauthService,
    scheduler: createNodeScheduler(),
    recordSettingsActivity: (input) => sqlitePresenter.recordSettingsActivity(input)
  })
  const toolRoutes = createToolRoutes(toolService)
  const pluginRoutes = createPluginRoutes(pluginService)
  const skillRoutes = createSkillRoutes({
    skillService,
    skillSyncService,
    skillSettings,
    recordSettingsActivity: (input) => sqlitePresenter.recordSettingsActivity(input)
  })
  const mcpRoutes = createMcpRoutes({
    mcpService,
    recordSettingsActivity: (input) => sqlitePresenter.recordSettingsActivity(input)
  })
  const remoteRoutes = createRemoteRoutes(remoteService)
  const schedulerRoutes = createSchedulerRoutes(cronJobs as any)
  const memoryService = {} as any
  const memoryRoutes = createMemoryRoutes({
    memoryService,
    getAgentType: (agentId) => providerSettings.getAgentType(agentId),
    getTapeInspection: () => tapeInspection,
    getAuditEntries: () => (sqlitePresenter as any).agentMemoryAuditTable
  })
  const desktopRoutes = createDesktopRoutes({
    windowPresenter,
    shortcutPresenter,
    browserPresenter: yoBrowserPresenter,
    tabPresenter,
    dialogService: dialogService as unknown as DialogServicePort,
    settings: desktopSettings as never,
    setFloatingButtonEnabled,
    recordActivity: (input) => {
      void sqlitePresenter.recordSettingsActivity(input)
    }
  })
  const fileRoutes = createFileRoutes(fileService)
  const knowledgeSettings = {
    getKnowledgeConfigs: vi.fn(() => knowledgeConfigs),
    setKnowledgeConfigs: vi.fn((configs: typeof knowledgeConfigs) => {
      knowledgeConfigs.splice(0, knowledgeConfigs.length, ...configs)
    })
  }
  const knowledgeRoutes = createKnowledgeRoutes({
    service: knowledgeService,
    settings: knowledgeSettings as never,
    applyConfigChange: vi.fn().mockResolvedValue(undefined),
    recordActivity: (input) => {
      void sqlitePresenter.recordSettingsActivity(input)
    }
  })
  const workspaceRoutes = createWorkspaceRoutes(workspaceService)
  const projectRoutes = createProjectRoutes({
    projectService: projectPresenter as any,
    publishEnvironmentsChanged: (action, path) => {
      publishDeepchatEvent(projectEnvironmentsChangedEvent.name, {
        action,
        path,
        version: Date.now()
      })
    }
  })
  const sessionRoutes = createSessionRoutes({
    lifecycle: sessionLifecyclePort,
    projection: sessionProjectionPort,
    desktop: desktopSessionBinding,
    turn: sessionTurnPort,
    assignment: sessionAssignmentPort,
    permission: sessionPermissionPort,
    agentSettings: providerSettings,
    scheduler: createNodeScheduler(),
    historySearch: sessionHistorySearch,
    exportService: agentSessionExportService,
    translation: sessionTranslation,
    usageStats: usageStatsService,
    rtkRuntime: rtkRuntimeService
  })
  const agentRoutes = createAgentRoutes({
    agentSettings: providerSettings,
    recordActivity: (input) => {
      void sqlitePresenter.recordSettingsActivity(input)
    },
    reconcileScheduler: async () => {
      await cronJobs.reconcileScheduler('agent-change')
    }
  })
  const promptSettings = {
    getCustomPrompts: vi.fn().mockResolvedValue([]),
    setCustomPrompts: vi.fn().mockResolvedValue(undefined),
    addCustomPrompt: vi.fn().mockResolvedValue(undefined),
    updateCustomPrompt: vi.fn().mockResolvedValue(undefined),
    deleteCustomPrompt: vi.fn().mockResolvedValue(undefined),
    getSystemPrompts: vi.fn().mockResolvedValue([]),
    setSystemPrompts: vi.fn().mockResolvedValue(undefined),
    addSystemPrompt: vi.fn().mockResolvedValue(undefined),
    updateSystemPrompt: vi.fn().mockResolvedValue(undefined),
    deleteSystemPrompt: vi.fn().mockResolvedValue(undefined),
    getDefaultSystemPromptId: vi.fn().mockResolvedValue('empty'),
    getDefaultSystemPrompt: vi.fn().mockResolvedValue(''),
    setDefaultSystemPrompt: vi.fn().mockResolvedValue(undefined),
    resetToDefaultPrompt: vi.fn().mockResolvedValue(undefined),
    clearSystemPrompt: vi.fn().mockResolvedValue(undefined),
    setDefaultSystemPromptId: vi.fn().mockResolvedValue(undefined)
  }
  const promptRoutes = createPromptRoutes({
    settings: promptSettings as never,
    recordActivity: (input) => {
      void sqlitePresenter.recordSettingsActivity(input)
    }
  })
  const acpRoutes = createAcpRoutes()
  const deviceRoutes = createDeviceRoutes({
    device: deviceService,
    resetDataByType: appDataReset.resetDataByType,
    restartApplication: deviceService.restartApp
  })
  const onboardingRoutes = createOnboardingRoutes({
    get: (key) => providerSettings.getSetting(key),
    set: (key, value) => providerSettings.setSetting(key, value)
  })
  const exporterRoutes = createExporterRoutes(exporter)
  const upgradeRoutes = createUpgradeRoutes({
    upgrade: {} as never,
    settings: updateSettings as never
  })
  const syncRoutes = createSyncRoutes({
    sync: syncService,
    settings: syncSettings as never,
    importFromSync: appDatabaseMaintenance.importFromSync,
    pullLatestBackupFromCloud: appDatabaseMaintenance.pullLatestBackupFromCloud,
    recordActivity: (input) => {
      void sqlitePresenter.recordSettingsActivity(input)
    }
  })
  const platformRoutes = createPlatformRoutes({
    proxySettings: proxySettings as never,
    applyProxyMode,
    applyCustomProxyUrl
  })
  const hookRoutes = createHookRoutes({
    settings: hookSettings as never,
    testCommand: testHookCommand
  })
  const appSettingsRoutes = createAppSettingsRoutes({
    settings: {
      get: (key) => providerSettings.getSetting(key),
      set: (key, value) => providerSettings.setSetting(key, value)
    },
    agentDefaults: agentDefaults as never,
    privacy: privacySettings as never,
    traceSettings: traceSettings as never,
    updateSettings: updateSettings as never,
    desktopSettings: desktopSettings as never,
    fonts: fontSettings as never,
    applyContentProtection,
    logging: loggingService as never,
    recordActivity: (input) => {
      void sqlitePresenter.recordSettingsActivity(input)
    },
    listActivities: (limit) => sqlitePresenter.listSettingsActivity(limit)
  })
  const appRoutes = createAppRoutes({
    logging: loggingService as never,
    agentSettings: providerSettings,
    projects: projectPresenter as never,
    databaseSecurity: {
      getStatus: vi.fn(() => enabledDatabaseSecurityStatus)
    } as any,
    database: sqlitePresenter,
    startupSession: sessionProjectionPort,
    desktopSession: desktopSessionBinding,
    startup: startupWorkloadCoordinator as any,
    ensureDefaultWorkspace: () => projectPresenter.ensureDefaultWorkspace(),
    enableDatabaseEncryption: appDatabaseMaintenance.enableDatabaseEncryption,
    changeDatabasePassword: appDatabaseMaintenance.changeDatabasePassword,
    disableDatabaseEncryption: appDatabaseMaintenance.disableDatabaseEncryption,
    recordActivity: (input) => {
      void sqlitePresenter.recordSettingsActivity(input)
    },
    publishSessionsUpdated: vi.fn()
  })

  return {
    settings,
    runtime: (() => {
      const runtime = createRouteDispatcher({
        appDatabaseMaintenance,
        routeMaps: [
          providerRoutes,
          toolRoutes,
          pluginRoutes,
          skillRoutes,
          mcpRoutes,
          remoteRoutes,
          schedulerRoutes,
          memoryRoutes,
          desktopRoutes,
          fileRoutes,
          knowledgeRoutes,
          workspaceRoutes,
          projectRoutes,
          sessionRoutes,
          agentRoutes,
          promptRoutes,
          acpRoutes,
          deviceRoutes,
          onboardingRoutes,
          upgradeRoutes,
          exporterRoutes,
          syncRoutes,
          platformRoutes,
          hookRoutes,
          appSettingsRoutes,
          appRoutes
        ],
        settingsWindow: windowPresenter,
        startupWorkloadCoordinator: startupWorkloadCoordinator as any
      })
      Object.defineProperties(runtime, {
        memoryService: {
          set: (value) => Object.assign(memoryService, value)
        },
        sqlitePresenter: {
          set: (value) => Object.assign(sqlitePresenter, value)
        }
      })
      return runtime
    })(),
    providerSettings,
    skillSettings,
    privacySettings,
    traceSettings,
    proxySettings,
    applyProxyMode,
    applyCustomProxyUrl,
    hookSettings,
    updateSettings,
    desktopSettings,
    fontSettings,
    applyContentProtection,
    loggingService,
    testHookCommand,
    providerRuntime,
    acpProviderAdminPort,
    sessionLifecyclePort,
    sessionProjectionPort,
    desktopSessionBinding,
    sessionTurnPort,
    sessionAssignmentPort,
    sessionPermissionPort,
    memoryService,
    skillService,
    skillSyncService,
    exporter,
    oauthService,
    mcpService,
    toolService,
    remoteService,
    shortcutPresenter,
    sqlitePresenter,
    tapeInspection,
    windowPresenter,
    deviceService,
    appDataReset,
    appDatabaseMaintenance,
    projectPresenter,
    fileService,
    knowledgeService,
    workspaceService,
    yoBrowserPresenter,
    tabPresenter,
    cronJobs,
    usageStatsService,
    rtkRuntimeService,
    sessionHistorySearch,
    agentSessionExportService,
    sessionTranslation
  }
}

describe('dispatchDeepchatRoute', () => {
  it('routes database imports through the App maintenance owner', async () => {
    const { runtime, appDatabaseMaintenance } = createRuntime()
    const context = { webContentsId: 42, windowId: 7 }

    await dispatchDeepchatRoute(
      runtime,
      'sync.import',
      { backupFile: 'backup-1.zip', mode: 'increment' },
      context
    )
    await dispatchDeepchatRoute(runtime, 'sync.pullFromCloud', { mode: 'overwrite' }, context)

    expect(appDatabaseMaintenance.importFromSync).toHaveBeenCalledWith('backup-1.zip', 'increment')
    expect(appDatabaseMaintenance.pullLatestBackupFromCloud).toHaveBeenCalledWith('overwrite')
  })

  it('routes database security migrations through the App maintenance owner', async () => {
    const { runtime, appDatabaseMaintenance } = createRuntime()
    const context = { webContentsId: 42, windowId: 7 }

    await dispatchDeepchatRoute(
      runtime,
      'databaseSecurity.enable',
      { password: 'secret-1' },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'databaseSecurity.changePassword',
      { currentPassword: 'secret-1', newPassword: 'secret-2' },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'databaseSecurity.disable',
      { currentPassword: 'secret-2' },
      context
    )

    expect(appDatabaseMaintenance.enableDatabaseEncryption).toHaveBeenCalledWith('secret-1')
    expect(appDatabaseMaintenance.changeDatabasePassword).toHaveBeenCalledWith(
      'secret-1',
      'secret-2'
    )
    expect(appDatabaseMaintenance.disableDatabaseEncryption).toHaveBeenCalledWith('secret-2')
  })

  it('checks App maintenance admission before dispatching runtime work', async () => {
    const { runtime, appDatabaseMaintenance, sessionProjectionPort } = createRuntime()
    appDatabaseMaintenance.assertRouteAllowed.mockImplementation((routeName: string) => {
      if (routeName.startsWith('sessions.')) throw new Error('maintenance')
    })

    await expect(
      dispatchDeepchatRoute(runtime, 'sessions.list', {}, { webContentsId: 42, windowId: 7 })
    ).rejects.toThrow('maintenance')

    expect(sessionProjectionPort.listSessions).not.toHaveBeenCalled()
  })

  it('routes tools.listDefinitions to the configurable Agent catalog', async () => {
    const { runtime, toolService } = createRuntime()
    const input = {
      chatMode: 'agent' as const,
      conversationId: 'session-1',
      disabledAgentTools: ['read']
    }

    const result = await dispatchDeepchatRoute(runtime, 'tools.listDefinitions', input, {
      webContentsId: 42,
      windowId: 7
    })

    expect(result).toMatchObject({
      tools: [{ source: 'agent', function: { name: 'read' } }]
    })
    expect(toolService.getConfigurableAgentToolDefinitions).toHaveBeenCalledWith(input)
    expect(toolService.getAllToolDefinitions).not.toHaveBeenCalled()
  })

  it('dispatches Cron Jobs routes through the runtime service', async () => {
    const { runtime, cronJobs } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    const listResult = await dispatchDeepchatRoute(runtime, 'cronJobs.list', {}, context)
    const upsertResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.upsert',
      {
        name: 'Cron smoke',
        enabled: true,
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        agentId: 'deepchat',
        nextRunAt: null,
        misfirePolicy: 'skip',
        maxCatchUpRuns: null,
        scheduleError: null,
        taskPrompt: 'Summarize issues',
        taskSystemInstruction: null,
        taskOutputMode: 'final_message',
        modelPolicy: 'follow_agent',
        toolPolicy: 'follow_agent',
        permissionPolicy: 'follow_agent',
        runtime: {
          maxDurationMs: 3_600_000,
          maxTurns: 20,
          concurrencyPolicy: 'skip'
        }
      },
      context
    )
    const toggleResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.toggle',
      {
        id: 'cron-1',
        enabled: false
      },
      context
    )
    const runNowResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.runNow',
      {
        id: 'cron-1'
      },
      context
    )
    const listRunsResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.listRuns',
      {
        jobId: 'cron-1',
        limit: 3
      },
      context
    )
    const getRunResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.getRun',
      {
        runId: 'run-1'
      },
      context
    )
    const listDeliveriesResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.listDeliveries',
      {
        runId: 'run-1'
      },
      context
    )
    const statusResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.getSchedulerStatus',
      {},
      context
    )
    const reconcileResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.reconcileScheduler',
      {
        reason: 'test'
      },
      context
    )
    const restartResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.restartScheduler',
      {},
      context
    )
    const deleteResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.delete',
      {
        id: 'cron-1'
      },
      context
    )
    const validateResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.validateSchedule',
      {
        cronExpr: '0 9 * * *',
        timezone: 'UTC'
      },
      context
    )
    const previewResult = await dispatchDeepchatRoute(
      runtime,
      'cronJobs.previewSchedule',
      {
        cronExpr: '0 9 * * *',
        timezone: 'UTC',
        count: 3
      },
      context
    )

    expect(listResult).toEqual({
      jobs: [expect.objectContaining({ id: 'cron-1' })],
      schedulerStatus: expect.objectContaining({ state: 'idle' })
    })
    expect(upsertResult).toEqual({
      job: expect.objectContaining({ id: 'cron-1' }),
      schedulerStatus: expect.objectContaining({ state: 'idle' })
    })
    expect(toggleResult).toEqual({
      job: expect.objectContaining({ id: 'cron-1' }),
      schedulerStatus: expect.objectContaining({ state: 'idle' })
    })
    expect(runNowResult).toEqual({
      job: expect.objectContaining({ id: 'cron-1' }),
      run: expect.objectContaining({ id: 'run-1', status: 'completed' }),
      schedulerStatus: expect.objectContaining({ state: 'idle' })
    })
    expect(listRunsResult).toEqual({
      runs: [expect.objectContaining({ id: 'run-1', sessionId: 'session-1' })]
    })
    expect(getRunResult).toEqual({
      run: expect.objectContaining({ id: 'run-1', sessionId: 'session-1' })
    })
    expect(listDeliveriesResult).toEqual({
      deliveries: [expect.objectContaining({ id: 'delivery-1', status: 'success' })]
    })
    expect(statusResult).toEqual({
      schedulerStatus: expect.objectContaining({ state: 'idle' })
    })
    expect(reconcileResult).toEqual({
      schedulerStatus: expect.objectContaining({ state: 'idle' })
    })
    expect(restartResult).toEqual({
      schedulerStatus: expect.objectContaining({ state: 'idle' })
    })
    expect(deleteResult).toEqual({
      schedulerStatus: expect.objectContaining({ state: 'idle' })
    })
    expect(validateResult).toEqual({ valid: true, error: null, nextRunAt: 10 })
    expect(previewResult).toEqual({ runs: [10, 20, 30], error: null })
    expect(cronJobs.toggle).toHaveBeenCalledWith('cron-1', false)
    expect(cronJobs.runNow).toHaveBeenCalledWith('cron-1')
    expect(cronJobs.listRuns).toHaveBeenCalledWith('cron-1', 3)
    expect(cronJobs.getRun).toHaveBeenCalledWith('run-1')
    expect(cronJobs.listDeliveries).toHaveBeenCalledWith('run-1')
    expect(cronJobs.reconcileScheduler).toHaveBeenCalledWith('test')
    expect(cronJobs.restartScheduler).toHaveBeenCalledTimes(1)
    expect(cronJobs.delete).toHaveBeenCalledWith('cron-1')
    expect(cronJobs.validateSchedule).toHaveBeenCalledWith({
      cronExpr: '0 9 * * *',
      timezone: 'UTC'
    })
    expect(cronJobs.previewSchedule).toHaveBeenCalledWith({
      cronExpr: '0 9 * * *',
      timezone: 'UTC',
      count: 3
    })
  })

  it('reconciles Cron Jobs after agent mutation routes', async () => {
    const { runtime, cronJobs } = createRuntime()
    const context = {
      webContentsId: 42,
      windowId: 7
    }

    await dispatchDeepchatRoute(
      runtime,
      'config.updateDeepChatAgent',
      {
        agentId: 'deepchat',
        updates: {
          enabled: false
        }
      },
      context
    )

    expect(cronJobs.reconcileScheduler).toHaveBeenCalledWith('agent-change')
  })

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
    const { runtime, fontSettings } = createRuntime()

    const result = await dispatchDeepchatRoute(
      runtime,
      'settings.listSystemFonts',
      {},
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(fontSettings.getSystemFonts).toHaveBeenCalledTimes(1)
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
    const { runtime, providerSettings } = createRuntime()
    const listByAgent = vi.fn()
    ;(runtime as any).sqlitePresenter = {
      agentMemoryAuditTable: {
        listByAgent
      }
    }
    vi.mocked(providerSettings.getAgentType)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('acp')

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
    const { runtime, providerSettings } = createRuntime()
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
    ;(runtime as any).memoryService = { getHealth }

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getHealth',
        { agentId: 'other' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ health: createEmptyMemoryHealth() })
    expect(getHealth).not.toHaveBeenCalled()

    vi.mocked(providerSettings.getAgentType).mockResolvedValueOnce('deepchat')
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
    const { runtime, providerSettings } = createRuntime()
    const lifecycle = {
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
    const archiveCandidateLifecycle = {
      ...lifecycle,
      decayTier: 'archive_candidate',
      archiveEligibility: {
        eligible: true,
        oldEnough: true,
        decayedEnough: true,
        neverAccessed: true,
        active: true,
        exempt: false,
        exemptReasons: [],
        gaps: {}
      }
    }
    const preview = {
      lifecycles: [archiveCandidateLifecycle],
      previewLimit: 25,
      scanLimit: 200,
      scanned: 1,
      previewTruncated: false,
      scanTruncated: false
    }
    const getLifecycle = vi.fn(() => lifecycle)
    const getArchiveCandidateLifecyclePreview = vi.fn(() => preview)
    ;(runtime as any).memoryService = { getLifecycle, getArchiveCandidateLifecyclePreview }

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getLifecycle',
        { agentId: 'other', memoryId: 'm1' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ lifecycle: null })
    expect(getLifecycle).not.toHaveBeenCalled()

    vi.mocked(providerSettings.getAgentType).mockResolvedValueOnce('deepchat')
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.getLifecycle',
        { agentId: 'deepchat', memoryId: 'm1' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ lifecycle })
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

    vi.mocked(providerSettings.getAgentType).mockResolvedValueOnce('deepchat')
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
    const { runtime, providerSettings, tapeInspection } = createRuntime()
    vi.mocked(providerSettings.getAgentType).mockResolvedValueOnce('deepchat')
    const listSessions = vi.fn()
    const listMemoryViewManifestsByAgent = vi
      .mocked(tapeInspection.listMemoryViewManifestsByAgent)
      .mockReturnValue([
        {
          sessionId: 's1',
          messageId: 'msg-old',
          entryId: 10,
          policyVersion: 1,
          tokenBudget: 900,
          estimatedTokens: 9,
          selectedCount: 1,
          selectedIds: ['old'],
          droppedCount: 1,
          queryHash: 'oldhash',
          createdAt: 100
        }
      ])
    ;(runtime as any).sqlitePresenter = {
      newSessionsTable: {
        list: listSessions
      }
    }

    const result = await dispatchDeepchatRoute(
      runtime,
      'memory.listViewManifests',
      { agentId: 'a', sessionId: 's1', messageId: 'msg-old', limit: 1 },
      { webContentsId: 42, windowId: 7 }
    )

    expect(listSessions).not.toHaveBeenCalled()
    expect(listMemoryViewManifestsByAgent).toHaveBeenCalledWith('a', {
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
          selectedIds: ['old'],
          droppedCount: 1,
          queryHash: 'oldhash'
        })
      ]
    })
  })

  it('returns Tape inspection manifest DTOs without exposing raw rows', async () => {
    const { runtime, providerSettings, tapeInspection } = createRuntime()
    vi.mocked(providerSettings.getAgentType).mockResolvedValueOnce('deepchat')
    vi.mocked(tapeInspection.listMemoryViewManifestsByAgent).mockReturnValue([
      {
        sessionId: 's1',
        messageId: 'msg-1',
        entryId: 30,
        policyVersion: 1,
        tokenBudget: 1000,
        estimatedTokens: 10,
        selectedCount: 6,
        selectedIds: ['m-string', 'm-object'],
        droppedCount: 0,
        queryHash: 'hash',
        createdAt: 300
      }
    ])
    const result = await dispatchDeepchatRoute(
      runtime,
      'memory.listViewManifests',
      { agentId: 'deepchat', sessionId: 's1', messageId: 'msg-1', limit: 1 },
      { webContentsId: 42, windowId: 7 }
    )

    expect(result).toEqual({
      manifests: [
        expect.objectContaining({
          selectedCount: 6,
          selectedIds: ['m-string', 'm-object']
        })
      ]
    })
    expect(result.manifests[0]).not.toHaveProperty('payload_json')
    expect(result.manifests[0]).not.toHaveProperty('meta_json')
  })

  it('reads memory source spans through the DTO-only Tape inspection port', async () => {
    const { runtime, tapeInspection } = createRuntime()
    const getManagementVisibleByIds = vi.fn().mockReturnValue([
      {
        id: 'memory-1',
        agent_id: 'deepchat',
        source_session: 's1',
        source_entry_ids: '[2,3]'
      }
    ])
    const getEffectiveMessageSourceSpan = vi
      .mocked(tapeInspection.getEffectiveMessageSourceSpan)
      .mockReturnValue([
        {
          entryId: 2,
          record: {
            role: 'user',
            orderSeq: 1,
            content: JSON.stringify({ text: 'source context' })
          }
        }
      ])
    ;(runtime as any).memoryService = { getManagementVisibleByIds }

    const result = await dispatchDeepchatRoute(
      runtime,
      'memory.getSourceSpan',
      { agentId: 'deepchat', memoryId: 'memory-1' },
      { webContentsId: 42, windowId: 7 }
    )

    expect(getEffectiveMessageSourceSpan).toHaveBeenCalledWith('s1', [2, 3])
    expect(result).toEqual({
      span: {
        sessionId: 's1',
        entries: [{ entryId: 2, role: 'user', content: 'source context', orderSeq: 1 }]
      }
    })
  })

  it('dispatches memory.getByIds with deepchat guard and input order projection', async () => {
    const { runtime } = createRuntime()
    const getByIds = vi.fn().mockReturnValue([
      {
        id: 'm2',
        agent_id: 'deepchat',
        user_scope: null,
        kind: 'semantic',
        category: 'project_fact',
        content: 'archived memory',
        importance: 0.7,
        lifecycle_state: 'archived',
        embedding_state: 'pending',
        embedding_id: null,
        embedding_dim: null,
        embedding_model: null,
        source_session: null,
        provenance_key: null,
        is_anchor: 0,
        superseded_by: null,
        created_at: 200,
        last_accessed: null,
        access_count: 0,
        decay_score: null,
        source_entry_ids: null,
        confidence: null,
        last_consolidated_at: null,
        conflict_state: null,
        conflict_with: null,
        persona_state: null
      },
      {
        id: 'm1',
        agent_id: 'deepchat',
        user_scope: null,
        kind: 'semantic',
        category: null,
        content: 'active memory',
        importance: 0.5,
        lifecycle_state: 'active',
        embedding_state: 'ready',
        embedding_id: null,
        embedding_dim: null,
        embedding_model: null,
        source_session: null,
        provenance_key: null,
        is_anchor: 0,
        superseded_by: null,
        created_at: 100,
        last_accessed: null,
        access_count: 0,
        decay_score: null,
        source_entry_ids: null,
        confidence: null,
        last_consolidated_at: null,
        conflict_state: null,
        conflict_with: null,
        persona_state: null
      }
    ])
    ;(runtime as any).memoryService = { getByIds }

    const guarded = await dispatchDeepchatRoute(
      runtime,
      'memory.getByIds',
      { agentId: 'other', memoryIds: ['m1'] },
      { webContentsId: 42, windowId: 7 }
    )
    expect(guarded).toEqual({ memories: [] })
    expect(getByIds).not.toHaveBeenCalled()

    const result = await dispatchDeepchatRoute(
      runtime,
      'memory.getByIds',
      { agentId: 'deepchat', memoryIds: ['m2', 'm1'] },
      { webContentsId: 42, windowId: 7 }
    )

    expect(getByIds).toHaveBeenCalledWith('deepchat', ['m2', 'm1'])
    expect(result).toEqual({
      memories: [
        expect.objectContaining({ id: 'm2', status: 'archived' }),
        expect.objectContaining({ id: 'm1', status: 'embedded' })
      ]
    })
  })

  it('dispatches memory.archive with deepchat guard', async () => {
    const { runtime } = createRuntime()
    const archiveUserMemory = vi.fn().mockResolvedValue(true)
    ;(runtime as any).memoryService = { archiveUserMemory }

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.archive',
        { agentId: 'other', memoryId: 'm1' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ ok: false })
    expect(archiveUserMemory).not.toHaveBeenCalled()

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.archive',
        { agentId: 'deepchat', memoryId: 'm1' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ ok: true })
    expect(archiveUserMemory).toHaveBeenCalledWith('deepchat', 'm1')
  })

  it('dispatches memory.reindex only when a new managed task can start', async () => {
    const { runtime, providerSettings } = createRuntime()
    const canReindex = vi.fn(() => true)
    const isReindexing = vi.fn(() => false)
    const reindexEmbeddings = vi.fn().mockResolvedValue(undefined)
    ;(runtime as any).memoryService = { canReindex, isReindexing, reindexEmbeddings }

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.reindex',
        { agentId: 'other' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ started: false })
    expect(canReindex).not.toHaveBeenCalled()
    expect(reindexEmbeddings).not.toHaveBeenCalled()

    canReindex.mockReturnValueOnce(false)
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.reindex',
        { agentId: 'deepchat' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ started: false })
    expect(canReindex).toHaveBeenCalledWith('deepchat')
    expect(reindexEmbeddings).not.toHaveBeenCalled()

    canReindex.mockReturnValue(true)
    isReindexing.mockReturnValueOnce(true)
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.reindex',
        { agentId: 'deepchat' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ started: false })
    expect(reindexEmbeddings).toHaveBeenCalledTimes(1)
    expect(reindexEmbeddings).toHaveBeenLastCalledWith('deepchat', true)

    isReindexing.mockReturnValueOnce(false)
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.reindex',
        { agentId: 'deepchat' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ started: true })
    expect(reindexEmbeddings).toHaveBeenCalledTimes(2)

    vi.mocked(providerSettings.getAgentType).mockResolvedValueOnce('acp')
    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.reindex',
        { agentId: 'deepchat' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ started: false })
    expect(reindexEmbeddings).toHaveBeenCalledTimes(2)
  })

  it('returns no memory view manifests for missing or non-DeepChat agents', async () => {
    const { runtime, providerSettings, tapeInspection } = createRuntime()
    const listMemoryViewManifestsByAgent = vi.mocked(tapeInspection.listMemoryViewManifestsByAgent)
    vi.mocked(providerSettings.getAgentType)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('acp')

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
    expect(listMemoryViewManifestsByAgent).not.toHaveBeenCalled()
  })

  it('dispatches bounded memory pages and returns an opaque keyset cursor', async () => {
    const { runtime } = createRuntime()
    const pageMemories = vi.fn(() => ({
      rows: [
        {
          id: 'm1',
          agent_id: 'deepchat',
          user_scope: null,
          kind: 'semantic',
          category: null,
          content: 'paged fact',
          importance: 0.5,
          lifecycle_state: 'active',
          embedding_state: 'ready',
          embedding_id: null,
          embedding_dim: null,
          embedding_model: null,
          source_session: null,
          provenance_key: null,
          is_anchor: 0,
          superseded_by: null,
          created_at: 1000,
          last_accessed: null,
          access_count: 0,
          decay_score: null,
          source_entry_ids: null,
          confidence: null,
          last_consolidated_at: null,
          conflict_state: null,
          conflict_with: null,
          persona_state: null,
          decision_revision: 1
        }
      ],
      nextCursor: { createdAt: 1000, id: 'm1' }
    }))
    ;(runtime as any).memoryService = { pageMemories }

    const result = await dispatchDeepchatRoute(
      runtime,
      'memory.page',
      { agentId: 'deepchat', limit: 25 },
      { webContentsId: 42, windowId: 7 }
    )

    expect(pageMemories).toHaveBeenCalledWith('deepchat', null, 25)
    expect(result.items.map((item) => item.id)).toEqual(['m1'])
    expect(decodeMemoryPageCursor(result.nextCursor!)).toEqual({
      v: 1,
      createdAt: 1000,
      id: 'm1'
    })
  })

  it('returns an empty memory page for a non-DeepChat agent', async () => {
    const { runtime } = createRuntime()
    const pageMemories = vi.fn()
    ;(runtime as any).memoryService = { pageMemories }

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'memory.page',
        { agentId: 'external-agent', limit: 25 },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ items: [], nextCursor: null })
    expect(pageMemories).not.toHaveBeenCalled()
  })

  it('does not expand all sessions when listing memory view manifests', async () => {
    const { runtime, providerSettings, tapeInspection } = createRuntime()
    vi.mocked(providerSettings.getAgentType).mockResolvedValueOnce('deepchat')
    const listSessions = vi.fn(() =>
      Array.from({ length: 1200 }, (_, index) => ({ id: `s-${index}` }))
    )
    const listMemoryViewManifestsByAgent = vi
      .mocked(tapeInspection.listMemoryViewManifestsByAgent)
      .mockReturnValue([
        {
          sessionId: 's-1199',
          messageId: 'msg-1',
          entryId: 1,
          policyVersion: 1,
          tokenBudget: 1000,
          estimatedTokens: 10,
          selectedCount: 1,
          selectedIds: ['m1'],
          droppedCount: 0,
          queryHash: 'hash',
          createdAt: 100
        }
      ])
    ;(runtime as any).sqlitePresenter = {
      newSessionsTable: {
        list: listSessions
      }
    }

    const result = await dispatchDeepchatRoute(
      runtime,
      'memory.listViewManifests',
      { agentId: 'a', limit: 100 },
      { webContentsId: 42, windowId: 7 }
    )

    expect(listSessions).not.toHaveBeenCalled()
    expect(listMemoryViewManifestsByAgent).toHaveBeenCalledWith('a', {
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

  it('applies typed settings updates through their owners', async () => {
    const {
      runtime,
      privacySettings,
      desktopSettings,
      applyContentProtection,
      loggingService,
      settings
    } = createRuntime()

    const result = await dispatchDeepchatRoute(
      runtime,
      'settings.update',
      {
        changes: [
          { key: 'fontSizeLevel', value: 4 },
          { key: 'privacyModeEnabled', value: true },
          { key: 'notificationsEnabled', value: false },
          { key: 'contentProtectionEnabled', value: true },
          { key: 'loggingEnabled', value: true }
        ]
      },
      {
        webContentsId: 42,
        windowId: 7
      }
    )

    expect(desktopSettings.setFontSizeLevel).toHaveBeenCalledWith(4)
    expect(privacySettings.setEnabled).toHaveBeenCalledWith(true)
    expect(desktopSettings.setNotificationsEnabled).toHaveBeenCalledWith(false)
    expect(desktopSettings.setContentProtectionEnabled).toHaveBeenCalledWith(true)
    expect(applyContentProtection).toHaveBeenCalledWith(true)
    expect(loggingService.setEnabled).toHaveBeenCalledWith(true)
    expect(settings.fontSizeLevel).toBe(4)
    expect(settings.privacyModeEnabled).toBe(true)
    expect(settings.notificationsEnabled).toBe(false)
    expect(settings.contentProtectionEnabled).toBe(true)
    expect(settings.loggingEnabled).toBe(true)
    expect(result).toEqual({
      version: expect.any(Number),
      changedKeys: [
        'fontSizeLevel',
        'privacyModeEnabled',
        'notificationsEnabled',
        'contentProtectionEnabled',
        'loggingEnabled'
      ],
      values: {
        fontSizeLevel: 4,
        privacyModeEnabled: true,
        notificationsEnabled: false,
        contentProtectionEnabled: true,
        loggingEnabled: true
      }
    })
  })

  it('dispatches built-in knowledge config routes through KnowledgeSettings', async () => {
    const { runtime, providerSettings } = createRuntime()
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
    expect(setResult).toEqual({
      configs: nextConfigs
    })
  })

  it('dispatches knowledge file routes through KnowledgeService', async () => {
    const { runtime, knowledgeService } = createRuntime()
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

    expect(knowledgeService.isSupported).toHaveBeenCalled()
    expect(knowledgeService.getSupportedLanguages).toHaveBeenCalled()
    expect(knowledgeService.getSeparatorsForLanguage).toHaveBeenCalledWith('markdown')
    expect(knowledgeService.getSupportedFileExtensions).toHaveBeenCalled()
    expect(knowledgeService.listFiles).toHaveBeenCalledWith('knowledge-1')
    expect(knowledgeService.similarityQuery).toHaveBeenCalledWith('knowledge-1', 'hello')
    expect(knowledgeService.validateFile).toHaveBeenCalledWith('/workspace/guide.md')
    expect(knowledgeService.addFile).toHaveBeenCalledWith('knowledge-1', '/workspace/guide.md')
    expect(knowledgeService.deleteFile).toHaveBeenCalledWith('knowledge-1', 'file-1')
    expect(knowledgeService.reAddFile).toHaveBeenCalledWith('knowledge-1', 'file-1')
    expect(knowledgeService.pauseAllRunningTasks).toHaveBeenCalledWith('knowledge-1')
    expect(knowledgeService.resumeAllPausedTasks).toHaveBeenCalledWith('knowledge-1')
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

  it('dispatches skill sync routes through SkillSyncService', async () => {
    const { runtime, skillSyncService } = createRuntime()
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

    expect(skillSyncService.scanExternalTools).toHaveBeenCalled()
    expect(skillSyncService.getNewDiscoveries).toHaveBeenCalled()
    expect(skillSyncService.acknowledgeDiscoveries).toHaveBeenCalled()
    expect(skillSyncService.getRegisteredTools).toHaveBeenCalled()
    expect(skillSyncService.previewImport).toHaveBeenCalledWith('codex', ['write-tests'])
    expect(skillSyncService.executeImport).toHaveBeenCalledWith([importPreview], {
      'write-tests': 'overwrite'
    })
    expect(skillSyncService.previewExport).toHaveBeenCalledWith(['write-tests'], 'codex', {
      inclusion: 'always'
    })
    expect(skillSyncService.executeExport).toHaveBeenCalledWith([exportPreview], {
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

  it('dispatches GitHub Copilot OAuth routes through OAuthService', async () => {
    const { runtime, oauthService } = createRuntime()
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

    expect(oauthService.startGitHubCopilotLogin).toHaveBeenCalledWith('github-copilot')
    expect(oauthService.startGitHubCopilotDeviceFlowLogin).toHaveBeenCalledWith('github-copilot')
    expect(loginResult).toEqual({ success: true })
    expect(deviceFlowResult).toEqual({ success: false })
  })

  it('dispatches OpenAI Codex OAuth routes through OAuthService', async () => {
    const { runtime, oauthService } = createRuntime()
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

    expect(oauthService.getOpenAICodexStatus).toHaveBeenCalledTimes(1)
    expect(oauthService.startOpenAICodexBrowserLogin).toHaveBeenCalledTimes(1)
    expect(oauthService.cancelOpenAICodexLogin).toHaveBeenCalledTimes(1)
    expect(oauthService.logoutOpenAICodex).toHaveBeenCalledTimes(1)
    expect(statusResult.status.state).toBe('signed-out')
    expect(browserResult.status.authenticated).toBe(true)
    expect(cancelResult.status.state).toBe('signed-out')
    expect(logoutResult.status.state).toBe('signed-out')
  })

  it('dispatches database schema repair through MainDatabase', async () => {
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

  it('dispatches skill file reads through SkillService', async () => {
    const { runtime, skillService } = createRuntime()
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

    expect(skillService.readSkillFile).toHaveBeenCalledWith('write-tests')
    expect(result).toEqual({
      content: '---\nname: write-tests\n---\nUse tests well'
    })
  })

  it('dispatches MCP Router marketplace routes through McpService', async () => {
    const { runtime, mcpService } = createRuntime()
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
    const installedIdsResult = await dispatchDeepchatRoute(
      runtime,
      'mcp.router.listInstalledServerIds',
      {
        source: 'mcprouter',
        sourceIds: ['context7', 'filesystem']
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

    expect(mcpService.listMcpRouterServers).toHaveBeenCalledWith(1, 20)
    expect(mcpService.getMcpRouterApiKey).toHaveBeenCalledTimes(1)
    expect(mcpService.setMcpRouterApiKey).toHaveBeenCalledWith('new-router-key')
    expect(mcpService.updateMcpRouterServersAuth).toHaveBeenCalledWith('new-router-key')
    expect(mcpService.isServerInstalled).toHaveBeenCalledWith('mcprouter', 'context7')
    expect(mcpService.listInstalledServerIds).toHaveBeenCalledWith('mcprouter', [
      'context7',
      'filesystem'
    ])
    expect(mcpService.installMcpRouterServer).toHaveBeenCalledWith('context7')
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
    expect(installedIdsResult).toEqual({ installedSourceIds: ['context7'] })
    expect(installResult).toEqual({ installed: true })
  })

  it('dispatches NPM registry routes through McpService', async () => {
    const { runtime, mcpService } = createRuntime()
    const context = { webContentsId: 42, windowId: 7 }

    await dispatchDeepchatRoute(runtime, 'mcp.getNpmRegistryStatus', {}, context)
    await dispatchDeepchatRoute(runtime, 'mcp.refreshNpmRegistry', {}, context)
    await dispatchDeepchatRoute(
      runtime,
      'mcp.setCustomNpmRegistry',
      { registry: 'https://registry.example.com/' },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'mcp.setAutoDetectNpmRegistry',
      { enabled: false },
      context
    )
    await dispatchDeepchatRoute(runtime, 'mcp.clearNpmRegistryCache', {}, context)

    expect(mcpService.getNpmRegistryStatus).toHaveBeenCalledTimes(1)
    expect(mcpService.refreshNpmRegistry).toHaveBeenCalledTimes(1)
    expect(mcpService.setCustomNpmRegistry).toHaveBeenCalledWith('https://registry.example.com/')
    expect(mcpService.setAutoDetectNpmRegistry).toHaveBeenCalledWith(false)
    expect(mcpService.clearNpmRegistryCache).toHaveBeenCalledTimes(1)
  })

  it('dispatches remote control routes through RemoteService', async () => {
    const { runtime, remoteService } = createRuntime()
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

    expect(remoteService.listRemoteChannels).toHaveBeenCalledTimes(1)
    expect(remoteService.getChannelSettings).toHaveBeenCalledWith('telegram')
    expect(remoteService.saveChannelSettings).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({
        remoteEnabled: true
      })
    )
    expect(remoteService.getChannelStatus).toHaveBeenCalledWith('telegram')
    expect(remoteService.getChannelBindings).toHaveBeenCalledWith('telegram')
    expect(remoteService.removeChannelBinding).toHaveBeenCalledWith('telegram', 'telegram:100:0')
    expect(remoteService.removeChannelPrincipal).toHaveBeenCalledWith('telegram', '123')
    expect(remoteService.getChannelPairingSnapshot).toHaveBeenCalledWith('telegram')
    expect(remoteService.createChannelPairCode).toHaveBeenCalledWith('telegram')
    expect(remoteService.clearChannelPairCode).toHaveBeenCalledWith('telegram')
    expect(remoteService.getTelegramStatus).toHaveBeenCalledTimes(1)
    expect(remoteService.getWeixinIlinkStatus).toHaveBeenCalledTimes(1)
    expect(remoteService.startWeixinIlinkLogin).toHaveBeenCalledWith({ force: true })
    expect(remoteService.waitForWeixinIlinkLogin).toHaveBeenCalledWith({
      sessionKey: 'weixin-session',
      timeoutMs: 480000
    })
    expect(remoteService.removeWeixinIlinkAccount).toHaveBeenCalledWith('account-1')
    expect(remoteService.restartWeixinIlinkAccount).toHaveBeenCalledWith('account-1')
    expect(restartResult).toEqual({ restarted: true })
  })

  it('dispatches DeepChat agent config routes through AgentSettings', async () => {
    const { runtime, providerSettings } = createRuntime()
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
    expect(providerSettings.createDeepChatAgent).toHaveBeenCalledWith({
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
    expect(providerSettings.updateDeepChatAgent).toHaveBeenCalledWith('writer', {
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
    expect(providerSettings.deleteDeepChatAgent).toHaveBeenCalledWith('writer')
    expect(deleteResult).toEqual({
      removed: true,
      cleanupPendingRestart: false
    })
  })

  it('dispatches proxy, logging, update channel, skill draft, provider DB, and hook routes', async () => {
    const {
      runtime,
      providerSettings,
      proxySettings,
      applyProxyMode,
      applyCustomProxyUrl,
      loggingService,
      hookSettings,
      updateSettings,
      skillSettings,
      testHookCommand
    } = createRuntime()
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
    expect(proxySettings.setMode).toHaveBeenCalledWith('custom')
    expect(applyProxyMode).toHaveBeenCalledWith('custom')
    expect(updatedMode).toEqual({
      mode: 'custom',
      customProxyUrl: ''
    })
    expect(proxySettings.setCustomUrl).toHaveBeenCalledWith('http://127.0.0.1:7890')
    expect(applyCustomProxyUrl).toHaveBeenCalledWith('http://127.0.0.1:7890')
    expect(updatedUrl).toEqual({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7890'
    })
    expect(loggingService.openFolder).toHaveBeenCalled()
    expect(loggingResult).toEqual({
      opened: true
    })
    expect(initialUpdateChannel).toEqual({
      channel: 'stable'
    })
    expect(updateSettings.setChannel).toHaveBeenCalledWith('beta')
    expect(updatedUpdateChannel).toEqual({
      channel: 'beta'
    })
    expect(initialSkillDraftSuggestions).toEqual({
      enabled: false
    })
    expect(skillSettings.setDraftSuggestionsEnabled).toHaveBeenCalledWith(true)
    expect(updatedSkillDraftSuggestions).toEqual({
      enabled: true
    })
    expect(providerSettings.refreshProviderDb).toHaveBeenCalledWith(true)
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
    expect(hookSettings.setHooksNotificationsConfig).toHaveBeenCalledWith({
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
    expect(testHookCommand).toHaveBeenCalledWith('hook-1')
    expect(hookTestResult).toEqual({
      result: {
        success: true,
        durationMs: 10,
        exitCode: 0
      }
    })
  })

  it('dispatches ACP config routes through AgentSettings', async () => {
    const { runtime, providerSettings } = createRuntime()
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

    expect(providerSettings.setAcpEnabled).toHaveBeenCalledWith(false)
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
    const { runtime, sessionLifecyclePort, sessionTurnPort } = createRuntime()

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

    expect(sessionLifecyclePort.createSession).toHaveBeenCalledWith(
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

    expect(sessionTurnPort.sendMessage).toHaveBeenCalledWith('session-1', 'follow up')

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

    expect(sessionTurnPort.steerActiveTurn).toHaveBeenCalledWith(
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

    expect(sessionTurnPort.compactSession).toHaveBeenCalledWith('session-1')
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
    const { runtime, sessionAssignmentPort } = createRuntime()

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

    expect(sessionAssignmentPort.updateSessionGenerationSettings).toHaveBeenCalledWith(
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
    expect(sessionAssignmentPort.getSessionGenerationSettings).toHaveBeenCalledWith('session-1')
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

  it('dispatches dashboard maintenance routes through explicit owners', async () => {
    const { runtime, providerSettings, usageStatsService, rtkRuntimeService } = createRuntime()
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

    expect(providerSettings.listAgents).toHaveBeenCalledTimes(1)
    expect(usageStatsService.getDashboard).toHaveBeenCalledTimes(1)
    expect(rtkRuntimeService.retryHealthCheck).toHaveBeenCalledTimes(1)
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

  it('dispatches moved session read routes through explicit owners', async () => {
    const {
      runtime,
      sessionProjectionPort,
      sessionHistorySearch,
      sessionTranslation,
      agentSessionExportService,
      providerSettings
    } = createRuntime()
    const context = { webContentsId: 88, windowId: 3 }

    await dispatchDeepchatRoute(
      runtime,
      'sessions.searchHistory',
      { query: 'release', options: { limit: 5 } },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'sessions.translateText',
      { text: 'hello', locale: 'fr-FR', agentId: 'deepchat' },
      context
    )
    await dispatchDeepchatRoute(
      runtime,
      'sessions.export',
      { sessionId: 'session-1', format: 'markdown' },
      context
    )
    sessionProjectionPort.getTapeContext.mockResolvedValueOnce({
      sessionId: 'session-1',
      sourceSessionId: 'acp-child',
      requestedEntryIds: [7],
      matchedEntryIds: [7],
      entries: []
    })
    const tapeContext = await dispatchDeepchatRoute(
      runtime,
      'sessions.getTapeContext',
      {
        sessionId: 'session-1',
        entryIds: [7],
        options: { before: 1, sourceSessionId: 'acp-child' }
      },
      context
    )
    const agents = await dispatchDeepchatRoute(runtime, 'sessions.getAgents', {}, context)

    expect(sessionHistorySearch.search).toHaveBeenCalledWith('release', { limit: 5 })
    expect(sessionTranslation.translate).toHaveBeenCalledWith('hello', 'fr-FR', 'deepchat')
    expect(agentSessionExportService.export).toHaveBeenCalledWith('session-1', 'markdown')
    expect(sessionProjectionPort.getTapeContext).toHaveBeenCalledWith('session-1', [7], {
      before: 1,
      sourceSessionId: 'acp-child'
    })
    expect(tapeContext).toEqual({
      context: expect.objectContaining({
        sessionId: 'session-1',
        sourceSessionId: 'acp-child'
      })
    })
    expect(providerSettings.listAgents).toHaveBeenCalled()
    expect(providerSettings.getAcpEnabled).toHaveBeenCalled()
    expect(agents).toEqual({ agents: [expect.objectContaining({ id: 'deepchat' })] })

    await expect(
      dispatchDeepchatRoute(
        runtime,
        'sessions.getTapeContext',
        {
          sessionId: 'session-1',
          entryIds: [7],
          options: { sourceSessionId: '   ' }
        },
        context
      )
    ).rejects.toThrow()
    expect(sessionProjectionPort.getTapeContext).toHaveBeenCalledTimes(1)
  })

  it('dispatches provider query and tool interaction routes through typed services', async () => {
    const { runtime, providerSettings, providerRuntime, acpProviderAdminPort, sessionTurnPort } =
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

    const acpWarmupResult = await dispatchDeepchatRoute(
      runtime,
      'providers.warmupAcpProcess',
      { agentId: 'codex-acp', workdir: '/repo' },
      { webContentsId: 88, windowId: 3 }
    )
    const acpConfigResult = await dispatchDeepchatRoute(
      runtime,
      'providers.getAcpProcessConfigOptions',
      { agentId: 'codex-acp', workdir: '/repo' },
      { webContentsId: 88, windowId: 3 }
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

    expect(providerSettings.getProviderModels).toHaveBeenCalledWith('openai')
    expect(providerRuntime.check).toHaveBeenCalledWith('openai', 'gpt-5.4')
    expect(providerRuntime.getKeyStatus).toHaveBeenCalledWith('openai')
    expect(providerRuntime.getProviderRateLimitStatus).toHaveBeenCalledWith('openai')
    expect(providerRuntime.updateProviderRateLimit).toHaveBeenCalledWith('openai', true, 2)
    expect(providerRuntime.getDimensions).toHaveBeenCalledWith('openai', 'text-embedding-3-small')
    expect(providerRuntime.syncModelScopeMcpServers).toHaveBeenCalledWith('modelscope', {
      page_number: 1,
      page_size: 50
    })
    expect(acpProviderAdminPort.runAcpDebugAction).toHaveBeenCalledWith({
      agentId: 'codex-acp',
      action: 'initialize',
      payload: {},
      webContentsId: 88
    })
    expect(acpProviderAdminPort.warmupAcpProcess).toHaveBeenCalledWith('codex-acp', '/repo')
    expect(acpProviderAdminPort.getAcpProcessConfigOptions).toHaveBeenCalledWith(
      'codex-acp',
      '/repo'
    )
    expect(sessionTurnPort.respondToolInteraction).toHaveBeenCalledWith(
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
    expect(acpWarmupResult).toEqual({ warmedUp: true })
    expect(acpConfigResult).toEqual({ state: null })
    expect(interactionResult).toEqual({
      accepted: true,
      resumed: true
    })
  })

  it('activates, deactivates, and reads the active session through typed routes', async () => {
    const { runtime, desktopSessionBinding } = createRuntime()
    desktopSessionBinding.getActive.mockResolvedValueOnce({
      id: 'session-1',
      agentId: 'deepchat',
      title: 'Restored',
      projectDir: '/workspace',
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
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

    expect(desktopSessionBinding.activate).toHaveBeenCalledWith(88, 'session-1')
    expect(desktopSessionBinding.deactivate).toHaveBeenCalledWith(88)
    expect(desktopSessionBinding.getActive).toHaveBeenCalledWith(88)
    expect(activateResult).toEqual({ activated: true })
    expect(deactivateResult).toEqual({ deactivated: true })
    expect(activeResult).toEqual({
      session: expect.objectContaining({
        id: 'session-1'
      })
    })
  })

  it('resolves stopStream by requestId when sessionId is omitted', async () => {
    const { runtime, sessionProjectionPort, sessionTurnPort, sessionPermissionPort } =
      createRuntime()

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

    expect(sessionProjectionPort.getMessage).toHaveBeenCalledWith('message-1')
    expect(sessionPermissionPort.clearSessionPermissions).toHaveBeenCalledWith('session-1')
    expect(sessionTurnPort.cancelGeneration).toHaveBeenCalledWith('session-1')
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
    const {
      runtime,
      deviceService,
      appDataReset,
      projectPresenter,
      fileService,
      workspaceService
    } = createRuntime()

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

    expect(deviceService.getAppVersion).toHaveBeenCalledTimes(1)
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
    expect(deviceService.selectFiles).toHaveBeenCalledWith({
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
    })
    expect(fileSelection).toEqual({
      canceled: false,
      filePaths: ['C:/workspace/skill.zip']
    })
    expect(deviceService.restartApp).toHaveBeenCalledTimes(1)
    expect(restartResult).toEqual({ restarted: true })
    expect(appDataReset.resetDataByType).toHaveBeenCalledWith('chat')
    expect(deviceService.resetDataByType).not.toHaveBeenCalled()
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

    expect(fileService.getMimeType).toHaveBeenCalledWith('/workspace/demo.txt')
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

    expect(workspaceService.registerWorkspace).toHaveBeenCalledTimes(2)
    expect(workspaceService.registerWorkspace).toHaveBeenNthCalledWith(1, '/workspace')
    expect(workspaceService.registerWorkspace).toHaveBeenNthCalledWith(2, '/workspace')
    expect(registerWorkspace).toEqual({ registered: true })
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
    expect(workspaceService.openFile).toHaveBeenCalledWith('/workspace/src/app.ts')
    expect(openFileResult).toEqual({ opened: true })
    expect(workspaceService.revealFileInFolder).toHaveBeenCalledWith('/workspace/src/app.ts')
    expect(revealResult).toEqual({ revealed: true })
    expect(workspaceService.unwatchWorkspace).toHaveBeenCalledWith('/workspace')
    expect(unwatchResult).toEqual({ watching: false })
    expect(workspaceService.unregisterWorkspace).toHaveBeenCalledWith('/workspace')
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
