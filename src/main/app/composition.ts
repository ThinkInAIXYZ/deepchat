import logger from '@shared/logger'
import { projectEnvironmentsChangedEvent } from '@shared/contracts/events/project.events'
import { sessionsUpdatedEvent } from '@shared/contracts/events'
import { performance } from 'node:perf_hooks'
import path from 'path'
import { DialogPresenter } from '../presenter/dialogPresenter/index'
import { app, ipcMain } from 'electron'
import { optimizer } from '@electron-toolkit/utils'
import { WindowPresenter } from '../desktop/window'
import { PluginSettingsWindow } from '../desktop/pluginSettingsWindow'
import { ShortcutPresenter } from '../desktop/shortcut'
import {
  IDialogPresenter,
  FileServicePort,
  ProviderRuntimePort,
  IShortcutPresenter,
  ISQLitePresenter,
  ITabPresenter,
  IConversationExporter,
  IWindowPresenter,
  WorkspaceServicePort,
  ToolServicePort,
  IYoBrowserPresenter,
  SkillServicePort,
  SkillSyncServicePort
} from '@shared/presenter'
import type { KnowledgeServicePort } from '@shared/types/knowledge'
import { ProviderRuntime } from '../provider'
import { ProviderImportService } from '../provider/providerImportService'
import { createProviderRoutes } from '../provider/routes'
import { ConfigService } from '../config'
import type { SettingsStore } from '../config/settingsStore'
import type { SecretStore } from '../config/secretStore'
import { providerDbLoader } from '../config/providerDbLoader'
import { AcpProvider } from '../provider/providers/acpProvider'
import { proxyConfig, ProxyMode } from '../presenter/proxyConfig'
import { DevicePresenter } from '../presenter/devicePresenter'
import { UpgradeService } from '../upgrade'
import { UpdateSettings } from '../upgrade/settings'
import { FileService } from '../file'
import { McpService } from '../mcp'
import { SyncService, type SyncImportDatabasePort } from '../sync'
import { SyncSettings } from '../sync/settings'
import { DeeplinkService } from '../deeplink'
import { createDeeplinkActions } from '../deeplink/actions'
import { NotificationService } from '../desktop/notification'
import { DesktopSettings } from '../desktop/settings'
import { TabPresenter } from '../desktop/tab'
import { DesktopSessionBinding } from '@/desktop/sessionBinding'
import { TrayPresenter } from '../desktop/tray'
import { OAuthPresenter } from '../presenter/oauthPresenter'
import { FloatingButtonPresenter } from '../desktop/floatingButton'
import { YoBrowserPresenter } from '../desktop/browser/YoBrowserPresenter'
import { KnowledgeService } from '../knowledge'
import { WorkspaceService } from '../workspace'
import { FileWatcherService } from '../platform/fileWatcher'
import { ToolService } from '../tool'
import { createToolRoutes } from '../tool/routes'
import { createSkillRoutes } from '../skill/routes'
import { createMcpRoutes } from '../mcp/routes'
import { createRemoteRoutes } from '../remote/routes'
import { createSchedulerRoutes } from '../scheduler/routes'
import { createMemoryRoutes } from '../memory/routes'
import { createDesktopRoutes } from '../desktop/routes'
import { createFileRoutes } from '../file/routes'
import { createKnowledgeRoutes } from '../knowledge/routes'
import { createWorkspaceRoutes } from '../workspace/routes'
import { createDeviceRoutes } from '../device/routes'
import { createOnboardingRoutes } from '../onboarding/routes'
import { createUpgradeRoutes } from '../upgrade/routes'
import { createSyncRoutes } from '../sync/routes'
import { createConfigRoutes } from '../config/routes'
import { createAppRoutes } from './routes'
import {
  CommandPermissionService,
  FilePermissionService,
  SettingsPermissionService
} from '../presenter/permission'
import type { AgentToolRuntimePort } from '../tool/runtimePorts'

import { ConversationExporterService } from '../exporter'
import { createExporterRoutes } from '../exporter/routes'
import { SkillService } from '../skill'
import type { SkillSessionStatePort } from '../skill'
import { SkillSyncService } from '../skill/sync'
import { HookService } from '../hook'
import { HookSettings } from '../hook/config'
import { SchedulerService, createCronJobRunSessionStarter } from '../scheduler'
import { AgentManager } from '@/agent/manager/agentManager'
import { createDeepChatAgentBackend } from '@/agent/manager/deepChatAgentBackend'
import { createDirectAcpAgentBackend } from '@/agent/manager/directAcpAgentBackend'
import { AppSessionService } from '@/agent/shared/appSessionService'
import { createSessionData } from '@/session/data'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import { resolveAssistantModelSelection } from '@/agent/shared/assistantModelSelection'
import { AgentUnavailableError } from '@/agent/shared/agentCatalogCodec'
import { resolveAcpAgentAlias } from '@shared/utils/acpAgentAlias'
import { SessionQuery } from '@/session/query'
import { SessionAssignmentPolicy } from '@/session/assignmentPolicy'
import { SessionAssignment } from '@/session/assignment'
import { SessionDeletion } from '@/session/deletion'
import { SessionTranscriptMutations } from '@/session/transcriptMutations'
import { SessionTurn } from '@/session/turn'
import { SessionLifecycle } from '@/session/lifecycle'
import { DeepChatRuntimeCoordinator } from '@/agent/deepchat/runtime/deepChatRuntimeCoordinator'
import { AcpAgentRuntime } from '@/agent/acp/instance'
import { createAcpRuntimeOwner } from '@/agent/acp/createRuntimeOwner'
import { createAcpRoutes } from '@/agent/acp/routes'
import { AcpSessionPersistence } from '@/agent/acp/runtime'
import type {
  MemoryIngestionDrainOutcome,
  MemoryIngestionObserver
} from '@/agent/deepchat/memory/memoryIngestionObserver'
import { MemoryService, isSafeAgentId, type MemoryServicePort } from '../memory'
import { createMemoryVectorStorePaths, MemoryVectorStore } from '../memory/infra/memoryVectorStore'
import { ProjectService } from '../project'
import { createProjectRoutes } from '../project/routes'
import { RemoteService } from '../remote'
import type { RemoteServiceLike } from '../remote/ports'
import { PluginService, type PluginServicePort } from '../plugin'
import { createPluginRoutes } from '../plugin/routes'
import { AgentRepository, BUILTIN_DEEPCHAT_AGENT_ID } from '../agent/repository'
import { ImportMode, type SQLitePresenter } from '../presenter/sqlitePresenter'
import {
  DatabaseSecurityPresenter,
  type DatabaseSecurityMigrationDatabasePort
} from '../presenter/databaseSecurityPresenter'
import { normalizeDeepChatSubagentSlots } from '@shared/lib/deepchatSubagents'
import { subscribeDeepChatInternalSessionUpdates } from '@/agent/deepchat/runtime/internalSessionEvents'
import type {
  AcpAsLlmProviderPermissionPort,
  AcpAsLlmProviderSessionControlPort,
  AcpProviderAdminPort,
  ProviderCatalogPort,
  SessionPermissionPort,
  SessionUiPort
} from '../presenter/runtimePorts'
import {
  publishDeepchatEvent,
  setDeepchatEventWindowPresenter
} from '@/routes/publishDeepchatEvent'
import { StartupWorkloadCoordinator } from '../presenter/startupWorkloadCoordinator'
import type { StartupWorkloadTaskContext } from '../presenter/startupWorkloadCoordinator'
import { LegacyChatImportService } from '../presenter/startupMigrations/legacyChatImportService'
import { UsageStatsService } from '../presenter/usageStatsService'
import type { SessionDataMigrationSQLitePort } from '../presenter/startupMigrations/sessionDataMigrations'
import { SessionHistorySearch } from '@/session/sessionHistorySearch'
import { SessionTranslation } from '@/session/sessionTranslation'
import { createSessionRoutes } from '@/session/routes'
import { AgentSessionExportService } from '../exporter/agentSessionExporter'
import { createInMemoryServerFactory } from '../mcp/inMemoryServers/builder'
import { createRouteDispatcher, registerDeepchatRoutes } from '@/routes'
import { createNodeScheduler } from '@/routes/scheduler'
import { AcpRegistryMigrationService } from '@/agent/acp/catalog/acpRegistryMigrationService'
import { killTerminal } from '@/agent/acp/launch/acpInitHelper'
import { rtkRuntimeService } from '@/agent/shared/process/rtkRuntimeService'
import {
  runDisabledSearchToolCleanupMigration,
  runMainlineNormalizationMigration
} from '../presenter/startupMigrations/sessionDataMigrations'
import { activateAppOnMac } from '@/lib/activateApp'

type ApplicationDatabaseMaintenancePort = SyncImportDatabasePort &
  DatabaseSecurityMigrationDatabasePort

export interface MainProcessControl {
  focusPrimaryWindow(): void
  handleDeepLink(url: string): Promise<void>
  clearPermissionCaches(): void
  confirmShutdown(): Promise<boolean>
  cancelShutdown(): void
  hasMainWindows(): boolean
  stop(): Promise<void>
}

function createLivePort<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = resolve()
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

export async function createMainProcessControl(dependencies: {
  configService: ConfigService
  settingsStore: SettingsStore
  secretStore: SecretStore
  sqlitePresenter: ISQLitePresenter
  databaseSecurityPresenter: DatabaseSecurityPresenter
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  startupRunId: string
  requestUpdateInstall: (installAction: () => void) => Promise<void>
  onWindowCreated: (isMainWindow: boolean) => void
  bindControl: (control: MainProcessControl) => void
}) {
  const configService = dependencies.configService
  const databaseSecurityPresenter = dependencies.databaseSecurityPresenter
  const startupWorkloadCoordinator = dependencies.startupWorkloadCoordinator
  const concreteSQLitePresenter = dependencies.sqlitePresenter as unknown as SQLitePresenter
  const sqlitePresenter = concreteSQLitePresenter
  const fileWatcherService = new FileWatcherService()
  let windowPresenter: IWindowPresenter
  let acpProviderAdminPort: AcpProviderAdminPort
  let exporter: IConversationExporter
  let devicePresenter: DevicePresenter
  let upgradeService: UpgradeService
  let shortcutPresenter: IShortcutPresenter
  let fileService: FileServicePort
  let mcpService: McpService
  let syncService: SyncService
  let deeplinkService: DeeplinkService
  let notificationService: NotificationService
  let tabPresenter: ITabPresenter
  let trayPresenter: TrayPresenter
  let oauthPresenter: OAuthPresenter
  let floatingButtonPresenter: FloatingButtonPresenter
  let knowledgeService: KnowledgeServicePort
  let workspaceService: WorkspaceServicePort
  let toolService: ToolServicePort
  let deepChatRuntimeCoordinator: DeepChatRuntimeCoordinator
  let yoBrowserPresenter: IYoBrowserPresenter
  let dialogPresenter: IDialogPresenter
  let skillService: SkillServicePort
  let skillSyncService: SkillSyncServicePort
  let sessionQuery: SessionQuery
  let desktopSessionBinding: DesktopSessionBinding
  let sessionAssignmentPolicy: SessionAssignmentPolicy
  let sessionAssignment: SessionAssignment
  let sessionTurn: SessionTurn
  let sessionLifecycle: SessionLifecycle
  let sessionDeletion: SessionDeletion
  let sessionPermissionPort: SessionPermissionPort
  let agentManager: AgentManager
  let acpAgentRuntime: AcpAgentRuntime
  let memoryService: MemoryServicePort
  let memoryIngestionObserver: MemoryIngestionObserver
  let projectService: ProjectService
  let remoteService: RemoteServiceLike
  let pluginService: PluginServicePort
  let hookService: HookService
  let cronJobs: SchedulerService
  let commandPermissionService: CommandPermissionService
  let filePermissionService: FilePermissionService
  let settingsPermissionService: SettingsPermissionService
  let legacyChatImportService: LegacyChatImportService
  let usageStatsService: UsageStatsService
  let appSessionService: AppSessionService
  let sessionDataMigrationSQLite: SessionDataMigrationSQLitePort
  let sessionHistorySearch: SessionHistorySearch
  let agentSessionExportService: AgentSessionExportService
  let sessionTranslation: SessionTranslation
  let acpAsLlmProviderSessionControl: AcpAsLlmProviderSessionControlPort
  let acpAsLlmProviderPermission: AcpAsLlmProviderPermissionPort
  let hasInitialized = false
  let databaseMaintenanceState: 'running' | 'maintenance' | 'failed' = 'running'

  const agentRepository = new AgentRepository(sqlitePresenter as unknown as SQLitePresenter)
  configService.setAgentRepository(agentRepository)
  configService.setSQLitePresenter(sqlitePresenter)
  const sessionData = createSessionData(sqlitePresenter)
  appSessionService = new AppSessionService(sqlitePresenter)
  sessionDataMigrationSQLite = concreteSQLitePresenter
  legacyChatImportService = new LegacyChatImportService(concreteSQLitePresenter)
  usageStatsService = new UsageStatsService(concreteSQLitePresenter, configService)

  // Initialize presenters and their dependencies.
  windowPresenter = new WindowPresenter(
    configService,
    () => devicePresenter.restartApp(),
    dependencies.onWindowCreated,
    startupWorkloadCoordinator
  )
  const acpSessionPersistence = new AcpSessionPersistence(sqlitePresenter)
  const acpRuntimeOwner = createAcpRuntimeOwner({
    configService,
    sessionPersistence: acpSessionPersistence,
    publishEvent: publishDeepchatEvent,
    registry: {
      getNpmRegistry: () => mcpService.getNpmRegistry(),
      getUvRegistry: () => mcpService.getUvRegistry()
    }
  })
  const providerRuntime = new ProviderRuntime(configService, acpRuntimeOwner, acpSessionPersistence)
  const unsubscribeProviderDbCatalog = providerDbLoader.subscribeCatalogChanges((change) => {
    if (change.reason === 'updated') {
      providerRuntime.handleProviderDbUpdated()
    }
  })
  acpProviderAdminPort = providerRuntime
  acpAsLlmProviderSessionControl = providerRuntime
  acpAsLlmProviderPermission = providerRuntime
  const commandPermissionHandler = new CommandPermissionService()
  commandPermissionService = commandPermissionHandler
  filePermissionService = new FilePermissionService()
  settingsPermissionService = new SettingsPermissionService()
  devicePresenter = new DevicePresenter()
  projectService = new ProjectService(sqlitePresenter, devicePresenter, dependencies.settingsStore)
  exporter = new ConversationExporterService({
    sqlitePresenter: sqlitePresenter,
    settings: dependencies.settingsStore
  })
  const updateSettings = new UpdateSettings(dependencies.settingsStore)
  const desktopSettings = new DesktopSettings(dependencies.settingsStore)
  upgradeService = new UpgradeService(
    updateSettings,
    () => configService.getPrivacyModeEnabled(),
    dependencies.requestUpdateInstall
  )
  shortcutPresenter = new ShortcutPresenter(desktopSettings, configService, windowPresenter)
  fileService = new FileService(configService)
  const syncSettings = new SyncSettings(dependencies.settingsStore, dependencies.secretStore)
  const hookSettings = new HookSettings(dependencies.settingsStore)
  syncService = new SyncService(syncSettings, sqlitePresenter)
  notificationService = new NotificationService(desktopSettings)
  oauthPresenter = new OAuthPresenter(configService)
  trayPresenter = new TrayPresenter(configService, windowPresenter)
  dialogPresenter = new DialogPresenter()
  yoBrowserPresenter = new YoBrowserPresenter(windowPresenter)

  // Define the storage root for built-in knowledge databases.
  const dbDir = path.join(app.getPath('userData'), 'app_db')
  knowledgeService = new KnowledgeService({
    config: configService,
    storageRoot: dbDir,
    files: fileService,
    dialog: dialogPresenter,
    embeddings: providerRuntime,
    events: {
      publishFileUpdated: (file) =>
        publishDeepchatEvent('knowledge.file.updated', { ...file, version: Date.now() }),
      publishFileProgress: (fileId, progress) =>
        publishDeepchatEvent('knowledge.file.progress', {
          fileId,
          ...progress,
          version: Date.now()
        })
    }
  })
  mcpService = new McpService(
    configService,
    createInMemoryServerFactory({
      sqlitePresenter,
      sessions: appSessionService,
      transcript: sessionData.transcript,
      settings: sessionData.settings,
      configService: configService,
      knowledgeService: knowledgeService
    }),
    providerRuntime,
    () => deepChatRuntimeCoordinator.refreshToolRegistry(),
    (data) => devicePresenter.cacheImage(data)
  )
  const deeplinkActions = createDeeplinkActions({
    window: windowPresenter,
    config: configService,
    mcp: mcpService
  })
  deeplinkService = new DeeplinkService(
    deeplinkActions.desktop,
    deeplinkActions.mcp,
    deeplinkActions.provider
  )

  // Initialize generic Workspace presenter (for all Agent modes)
  workspaceService = new WorkspaceService(fileService, fileWatcherService, {
    publishInvalidated: (event) => publishDeepchatEvent('workspace.invalidated', event),
    publishWatchStatusChanged: (event) =>
      publishDeepchatEvent('workspace.watch.status.changed', event)
  })

  const agentToolRuntime: AgentToolRuntimePort = {
    resolveConversationWorkdir: async (conversationId) => {
      try {
        const session = await sessionQuery.getSession(conversationId)
        const normalized = session?.projectDir?.trim()
        if (normalized) {
          return normalized
        }
      } catch (error) {
        console.warn('[Main] Failed to resolve new session workdir:', {
          conversationId,
          error
        })
      }

      return null
    },
    resolveConversationSessionInfo: async (conversationId) => {
      const session = await sessionQuery.getSession(conversationId)
      if (!session) {
        return null
      }

      const agent = await configService.getAgent(session.agentId)
      const agentType = await configService.getAgentType(session.agentId)
      const permissionMode = await sessionAssignment.getPermissionMode(session.id)
      const generationSettings = await sessionAssignment.getSessionGenerationSettings(session.id)
      const disabledAgentTools = await sessionAssignment.getSessionDisabledAgentTools(session.id)
      const activeSkills = await skillService.getActiveSkills(session.id)
      const availableSubagentSlots =
        agentType === 'deepchat' && session.sessionKind === 'regular'
          ? normalizeDeepChatSubagentSlots(
              (await configService.resolveDeepChatAgentConfig(session.agentId)).subagents
            )
          : []

      return {
        sessionId: session.id,
        agentId: session.agentId,
        agentName: agent?.name?.trim() || session.agentId,
        agentType,
        providerId: session.providerId,
        modelId: session.modelId,
        projectDir: session.projectDir ?? null,
        permissionMode,
        generationSettings,
        disabledAgentTools,
        activeSkills,
        sessionKind: session.sessionKind,
        parentSessionId: session.parentSessionId ?? null,
        subagentEnabled: session.subagentEnabled,
        subagentMeta: session.subagentMeta ?? null,
        availableSubagentSlots
      }
    },
    getTapeInfo: async (conversationId) => {
      return await sessionQuery.getTapeInfo(conversationId)
    },
    searchTape: async (conversationId, query, options) => {
      return await sessionQuery.searchTape(conversationId, query, options)
    },
    getTapeContext: async (conversationId, entryIds, options) => {
      return await sessionQuery.getTapeContext(conversationId, entryIds, options)
    },
    listTapeAnchors: async (conversationId, options) => {
      return await sessionQuery.listTapeAnchors(conversationId, options)
    },
    handoffTape: async (conversationId, name, state) => {
      return await sessionQuery.handoffTape(conversationId, name, state)
    },
    isMemoryEnabled: (agentId) => memoryService.isEnabled(agentId),
    rememberMemory: async (agentId, input, sourceSession, model) =>
      memoryService.rememberMemory(
        {
          kind: input.kind,
          category: input.category,
          content: input.content,
          importance: input.importance
        },
        { agentId, sourceSession },
        model
      ),
    recallMemory: async (agentId, query) => {
      const items = await memoryService.recall(agentId, query)
      return items.map((item) => ({
        id: item.id,
        kind: item.kind,
        content: item.content
      }))
    },
    forgetMemory: async (agentId, memoryId) => await memoryService.forgetMemory(agentId, memoryId),
    listCronJobs: async () => await cronJobs.list(),
    upsertCronJob: async (input) => (await cronJobs.upsert(input)).job,
    deleteCronJob: async (id) => {
      await cronJobs.delete(id)
    },
    toggleCronJob: async (id, enabled) => (await cronJobs.toggle(id, enabled)).job,
    runCronJobNow: async (id) => (await cronJobs.runNow(id)).run,
    listCronJobRuns: async (jobId, limit) => cronJobs.listRuns(jobId, limit),
    previewCronSchedule: async (input) => cronJobs.previewSchedule(input),
    createSubagentSession: async (input) => {
      const created = await sessionLifecycle.createSubagentSession(input)
      return await agentToolRuntime.resolveConversationSessionInfo(created.id)
    },
    mergeSubagentTape: async (parentSessionId, childSessionId, meta) => {
      await sessionAssignment.mergeSubagentTape(parentSessionId, childSessionId, meta)
    },
    discardSubagentTape: async (parentSessionId, childSessionId, meta) => {
      await sessionAssignment.discardSubagentTape(parentSessionId, childSessionId, meta)
    },
    sendConversationMessage: async (conversationId, content) => {
      await sessionTurn.sendMessage(conversationId, content)
    },
    cancelConversation: async (conversationId) => {
      await sessionTurn.cancelGeneration(conversationId)
    },
    subscribeDeepChatSessionUpdates: (listener) =>
      subscribeDeepChatInternalSessionUpdates(listener),
    getSkillService: () => skillService,
    getYoBrowserToolHandler: () => yoBrowserPresenter.toolHandler,
    getFileService: () => ({
      getMimeType: (filePath) => fileService.getMimeType(filePath),
      prepareFileCompletely: (absPath, typeInfo, contentType) =>
        fileService.prepareFileCompletely(absPath, typeInfo, contentType)
    }),
    getProviderRuntime: () => ({
      executeWithRateLimit: (providerId, options) =>
        providerRuntime.executeWithRateLimit(providerId, options),
      generateCompletionStandalone: (
        providerId,
        messages,
        modelId,
        temperature,
        maxTokens,
        options
      ) =>
        providerRuntime.generateCompletionStandalone(
          providerId,
          messages,
          modelId,
          temperature,
          maxTokens,
          options
        ),
      generateImageStandalone: (providerId, prompt, modelId, imageOptions, options) =>
        providerRuntime.generateImageStandalone(providerId, prompt, modelId, imageOptions, options),
      generateVideoStandalone: (providerId, prompt, modelId, videoOptions, options) =>
        providerRuntime.generateVideoStandalone(providerId, prompt, modelId, videoOptions, options)
    }),
    cacheImage: (data) => devicePresenter.cacheImage(data),
    createSettingsWindow: () => windowPresenter.createSettingsWindow(),
    sendToWindow: (windowId, channel, ...args) =>
      windowPresenter.sendToWindow(windowId, channel, ...args),
    sendSettingsNavigation: (windowId, navigation) =>
      windowPresenter.sendSettingsNavigation(windowId, navigation),
    getApprovedFilePaths: (conversationId, requiredPermission) =>
      filePermissionService.getApprovedPaths(conversationId, requiredPermission),
    consumeSettingsApproval: (conversationId, toolName) =>
      settingsPermissionService.consumeApproval(conversationId, toolName)
  }

  // Initialize the merged MCP and built-in Tool service.
  toolService = new ToolService({
    mcpService: mcpService,
    configService: configService,
    commandPermissionHandler,
    agentToolRuntime
  })

  const skillSessionStatePort: SkillSessionStatePort = {
    hasNewSession: async (conversationId) => Boolean(await sessionQuery.getSession(conversationId)),
    getPersistedNewSessionSkills: (conversationId) =>
      sqlitePresenter.newSessionsTable.getActiveSkills(conversationId),
    setPersistedNewSessionSkills: (conversationId, skills) => {
      sqlitePresenter.newSessionsTable.updateActiveSkills(conversationId, skills)
      sqlitePresenter.newEnvironmentsTable.syncForSession(conversationId)
    },
    repairImportedLegacySessionSkills: async (conversationId) => {
      return await legacyChatImportService.repairImportedLegacySessionSkills(conversationId)
    }
  }

  // Initialize Skill service
  skillService = new SkillService(configService, skillSessionStatePort, fileWatcherService)

  // Initialize official plugin host. Plugins are activated before MCP startup so managed
  // MCP servers are present when the regular MCP presenter starts enabled servers.
  const pluginSettingsWindow = new PluginSettingsWindow()
  pluginService = new PluginService({
    configService: configService,
    mcpService: mcpService,
    skillService: skillService,
    settingsWindow: pluginSettingsWindow
  })

  // Initialize Skill Sync service
  skillSyncService = new SkillSyncService(skillService, configService)

  hookService = new HookService(hookSettings, {
    getSession: (sessionId) => sessionQuery.getSession(sessionId),
    getMessage: (messageId) => sessionQuery.getMessage(messageId)
  })
  const providerCatalogPort: ProviderCatalogPort = {
    getProviderModels: (providerId) => configService.getProviderModels(providerId),
    getCustomModels: (providerId) => configService.getCustomModels(providerId),
    getAgentType: async (agentId) => await configService.getAgentType(agentId)
  }
  const sessionUiPort: SessionUiPort = {
    refreshSessionUi: () => {
      try {
        void floatingButtonPresenter.refreshWidgetState()
      } catch (error) {
        console.warn('[Main] Failed to refresh floating widget state:', error)
      }
    }
  }
  sessionPermissionPort = {
    clearSessionPermissions: (sessionId) => {
      commandPermissionService.clearConversation(sessionId)
      filePermissionService.clearConversation(sessionId)
      settingsPermissionService.clearConversation(sessionId)
      mcpService.clearSessionPermissions(sessionId)
    },
    cloneSessionPermissions: (sourceSessionId, targetSessionId) => {
      // MCP temporary approvals are intentionally never inherited.
      mcpService.clearSessionPermissions(targetSessionId)
      commandPermissionService.cloneConversation(sourceSessionId, targetSessionId)
      filePermissionService.cloneConversation(sourceSessionId, targetSessionId)
      settingsPermissionService.cloneConversation(sourceSessionId, targetSessionId)
    },
    approvePermission: async (sessionId, permission) => {
      const permissionType = permission.permissionType
      const serverName = permission.serverName || ''
      const toolName = permission.toolName || ''

      if (permissionType === 'command') {
        const command = permission.command || permission.commandInfo?.command || ''
        const signature =
          permission.commandSignature ||
          permission.commandInfo?.signature ||
          (command ? commandPermissionService.extractCommandSignature(command) : '')
        if (signature) {
          commandPermissionService.approve(sessionId, signature, false)
        }
        return
      }

      if (
        serverName === 'agent-filesystem' &&
        Array.isArray(permission.paths) &&
        permission.paths.length > 0
      ) {
        filePermissionService.approve(sessionId, permission.paths, permissionType, false)
        return
      }

      if (serverName === 'deepchat-settings' && toolName) {
        settingsPermissionService.approve(sessionId, toolName, false)
        return
      }

      if (
        serverName &&
        (permissionType === 'read' || permissionType === 'write' || permissionType === 'all')
      ) {
        await mcpService.grantPermission(serverName, permissionType, false, sessionId)
      }
    }
  }
  // Initialize agent memory layer (opt-in per agent; vectors stored separately from knowledge base)
  const memoryDbDir = path.join(dbDir, 'AgentMemory')
  MemoryVectorStore.recoverQuarantinedStores(memoryDbDir)
  const memoryVectorDbPaths = (agentId: string) =>
    createMemoryVectorStorePaths(memoryDbDir, agentId)
  memoryService = new MemoryService({
    repository: createLivePort(() => sqlitePresenter.agentMemoryTable),
    auditRepository: createLivePort(() => sqlitePresenter.agentMemoryAuditTable),
    resolveAgentConfig: (agentId) => agentRepository.resolveDeepChatAgentConfig(agentId),
    resolveAgentDefaultModel: (agentId) => {
      const config = agentRepository.resolveDeepChatAgentConfig(agentId)
      const model = config.assistantModel ?? config.defaultModelPreset
      return model?.providerId && model?.modelId
        ? { providerId: model.providerId, modelId: model.modelId }
        : null
    },
    // Management memory APIs only read/write real DeepChat agents.
    isManagedAgent: (agentId) => agentRepository.getDeepChatAgentConfig(agentId) !== null,
    listManagedAgentConfigs: () => agentRepository.listResolvedDeepChatAgentConfigs(),
    listManagedMemoryAgentIds: () =>
      agentRepository
        .listAgents({ agentType: 'deepchat', enabled: true })
        .map((agent) => agent.id)
        .filter(
          (agentId) => agentRepository.resolveDeepChatAgentConfig(agentId).memoryEnabled === true
        ),
    executeWithRateLimit: (providerId, options) =>
      providerRuntime.executeWithRateLimit(providerId, { signal: options.signal }),
    getEmbeddings: (providerId, modelId, texts, signal) =>
      providerRuntime.getEmbeddings(providerId, modelId, texts, signal),
    getDimensions: (providerId, modelId, signal) =>
      providerRuntime.getDimensions(providerId, modelId, signal),
    generateText: async (providerId, modelId, prompt) =>
      (await providerRuntime.generateText(providerId, prompt, modelId, 0.2)).content ?? '',
    createVectorStore: (agentId, embedding, dimensions) => {
      if (!isSafeAgentId(agentId)) {
        throw new Error(`[Memory] refusing to open vector store for unsafe agentId: ${agentId}`)
      }
      return MemoryVectorStore.create(memoryVectorDbPaths(agentId), dimensions, embedding)
    },
    resetVectorStore: async (agentId) => {
      if (!isSafeAgentId(agentId)) {
        throw new Error(`[Memory] refusing to reset vector store for unsafe agentId: ${agentId}`)
      }
      MemoryVectorStore.destroyFiles(memoryVectorDbPaths(agentId))
    },
    markVectorStoreQuarantined: (agentId) => {
      if (!isSafeAgentId(agentId)) {
        throw new Error(
          `[Memory] refusing to quarantine vector store for unsafe agentId: ${agentId}`
        )
      }
      MemoryVectorStore.markQuarantined(memoryVectorDbPaths(agentId))
    },
    onMemoryChanged: (agentId, reason, context) =>
      publishDeepchatEvent('memory.updated', {
        agentId,
        reason,
        version: Date.now(),
        ...(typeof context?.memoryId === 'string' ? { memoryId: context.memoryId } : {}),
        ...(typeof context?.sessionId === 'string' ? { sessionId: context.sessionId } : {}),
        ...(context?.createdIds?.length ? { createdIds: context.createdIds } : {})
      })
  })
  configService.setDeepChatAgentDeleteCleanup((agentId) =>
    memoryService.cleanupDeletedAgentResources(agentId)
  )
  configService.setDeepChatAgentMemoryMaintenanceConfigChanged((agentId) => {
    if (agentId === BUILTIN_DEEPCHAT_AGENT_ID) {
      memoryService.onBuiltinDeepChatMemoryMaintenanceConfigChanged()
      return
    }
    memoryService.onAgentMemoryMaintenanceConfigChanged(agentId)
  })

  // Initialize new agent architecture presenters
  deepChatRuntimeCoordinator = new DeepChatRuntimeCoordinator(
    providerRuntime as unknown as ProviderRuntimePort,
    configService,
    sqlitePresenter,
    sessionData,
    toolService,
    {
      publishEvent: publishDeepchatEvent,
      providerCatalogPort,
      sessionPermissionPort,
      acpAsLlmProviderPermission: acpAsLlmProviderPermission,
      sessionUiPort,
      memoryPort: memoryService,
      cacheImage: (data) => devicePresenter.cacheImage(data),
      skillService: skillService
    },
    hookService
  )
  const sessionTranscriptMutations = new SessionTranscriptMutations({
    transcript: sessionData.transcript,
    settings: sessionData.settings,
    pendingInputs: sessionData.pendingInputs,
    runtime: deepChatRuntimeCoordinator
  })
  memoryIngestionObserver = deepChatRuntimeCoordinator.memoryIngestionObserver
  acpAgentRuntime = new AcpAgentRuntime(
    acpRuntimeOwner,
    (input) => deepChatRuntimeCoordinator.createAcpAgentInstanceDependencies(input),
    sessionData.pendingInputs
  )
  agentManager = new AgentManager(agentRepository, appSessionService, {
    deepchat: createDeepChatAgentBackend({
      port: deepChatRuntimeCoordinator,
      runtime: deepChatRuntimeCoordinator.deepChatRuntime,
      transcript: sessionData.transcript,
      tape: sessionData.tape
    }),
    acp: createDirectAcpAgentBackend({
      runtime: acpAgentRuntime,
      sessionState: deepChatRuntimeCoordinator,
      transcript: sessionData.transcript,
      tape: sessionData.tape,
      deleteDurableSession: async (sessionId) => {
        await sqlitePresenter.deleteAcpSessions(sessionId)
      },
      resolveInput: async (sessionId, descriptor) => {
        const session = appSessionService.get(sessionId)
        if (!session || resolveAcpAgentAlias(session.agentId) !== descriptor.id) {
          throw new AgentUnavailableError(descriptor.id, 'invalid-config', 'acp')
        }
        const agent = (await configService.getAcpAgents()).find(
          (candidate) => candidate.id === descriptor.id && candidate.source === descriptor.source
        )
        if (!agent || !agent.command.trim()) {
          throw new AgentUnavailableError(descriptor.id, 'invalid-config', 'acp')
        }
        return {
          sessionId: toAppSessionId(session.id),
          descriptor,
          agent,
          scope: session.sessionKind === 'subagent' ? 'subagent' : 'regular',
          workdir: session.projectDir?.trim() ?? ''
        }
      }
    })
  })
  sessionQuery = new SessionQuery({
    sessions: appSessionService,
    runtime: {
      getAgentKind: (agentId) => agentManager.resolveBackend(agentId).kind,
      snapshot: async (sessionId, options) =>
        await agentManager.resolveSessionHandle(toAppSessionId(sessionId)).handle.snapshot(options),
      snapshotIfHydrated: async (sessionId) =>
        await agentManager.snapshotIfHydrated(toAppSessionId(sessionId)),
      waitForFirstTurnReady: async (sessionId, options) =>
        await agentManager
          .resolveSessionHandle(toAppSessionId(sessionId))
          .handle.waitForFirstTurnReady(options)
    },
    transcript: sessionData.transcript,
    tape: sessionData.tape,
    messages: createLivePort(() => sqlitePresenter.deepchatMessagesTable),
    searchResults: createLivePort(() => sqlitePresenter.deepchatMessageSearchResultsTable),
    traces: createLivePort(() => sqlitePresenter.deepchatMessageTracesTable),
    titles: providerRuntime,
    agentConfig: {
      getAssistantModel: async (agentId) => {
        const selection = await resolveAssistantModelSelection(
          {
            agentManager: agentManager,
            configService: configService
          },
          agentId,
          '',
          ''
        )
        return selection.providerId && selection.modelId ? selection : null
      }
    },
    events: {
      publish: (payload) => publishDeepchatEvent('sessions.updated', payload)
    },
    ui: sessionUiPort
  })
  desktopSessionBinding = new DesktopSessionBinding(sessionQuery)
  tabPresenter = new TabPresenter(windowPresenter, desktopSessionBinding, () =>
    deeplinkService.processStartupUrl()
  )
  ;(windowPresenter as WindowPresenter).bindTabPresenter(tabPresenter as TabPresenter)
  floatingButtonPresenter = new FloatingButtonPresenter(
    configService,
    sessionQuery,
    desktopSessionBinding,
    windowPresenter as WindowPresenter,
    tabPresenter as TabPresenter
  )
  sessionAssignmentPolicy = new SessionAssignmentPolicy(
    {
      resolveAgent: (agentId) => {
        const descriptor = agentManager.resolveBackend(agentId).descriptor
        return { id: descriptor.id, kind: descriptor.kind }
      }
    },
    {
      getDefaultModel: () => configService.getDefaultModel(),
      getDefaultProjectPath: () => projectService.getDefaultProjectPath(),
      resolveDeepChatAgentConfig: async (agentId) =>
        await configService.resolveDeepChatAgentConfig(agentId)
    }
  )
  const clearNewAgentSessionSkills = skillService.clearNewAgentSessionSkills
  if (!clearNewAgentSessionSkills) {
    throw new Error('Skill presenter must provide session skill cleanup.')
  }
  sessionDeletion = new SessionDeletion({
    sessions: appSessionService,
    runtime: {
      cleanupSessionBackends: async (sessionId) =>
        await agentManager.cleanupSessionBackends(sessionId)
    },
    state: deepChatRuntimeCoordinator,
    permissions: sessionPermissionPort,
    skills: {
      clearNewAgentSessionSkills: async (sessionId) =>
        await clearNewAgentSessionSkills.call(skillService, sessionId)
    }
  })
  sessionAssignment = new SessionAssignment({
    sessions: appSessionService,
    runtime: {
      getSessionAgentKind: (sessionId) =>
        agentManager.resolveSessionBackend(sessionId).descriptor.kind,
      resolveSession: (sessionId) => agentManager.resolveSessionHandle(sessionId),
      resolveTransferSource: (sessionId) => agentManager.resolveTransferSource(sessionId),
      resolveDeepChatTransferTarget: (agentId) =>
        agentManager.resolveDeepChatTransferTarget(agentId),
      resolveSubagentFacet: (sessionId) => agentManager.resolveSubagentFacet(sessionId)
    },
    policy: sessionAssignmentPolicy,
    projection: sessionQuery,
    deletion: sessionDeletion,
    environment: {
      syncPath: (projectDir) => sqlitePresenter.newEnvironmentsTable.syncPath(projectDir)
    },
    acp: acpAsLlmProviderSessionControl
  })
  sessionTurn = new SessionTurn({
    sessions: appSessionService,
    runtime: {
      resolveSession: (sessionId) => {
        const { handle } = agentManager.resolveSessionHandle(sessionId)
        const turn = {
          pending: handle.pending,
          toolInteractions: handle.toolInteractions,
          send: (input: Parameters<typeof handle.send>[0]) => handle.send(input),
          cancel: () => handle.cancel(),
          snapshot: () => handle.snapshot()
        }
        return handle.kind === 'deepchat'
          ? {
              ...turn,
              kind: handle.kind,
              compaction: {
                getState: () => handle.deepchat.getCompactionState(),
                compact: () => handle.deepchat.compact()
              }
            }
          : { ...turn, kind: handle.kind }
      }
    },
    transcript: {
      hasMessages: (sessionId) => sessionData.transcript.hasMessages(sessionId),
      clearMessages: (sessionId) => sessionTranscriptMutations.clearMessages(sessionId),
      prepareRetryMessage: (sessionId, messageId) =>
        sessionTranscriptMutations.prepareRetryMessage(sessionId, messageId),
      deleteMessage: (sessionId, messageId) =>
        sessionTranscriptMutations.deleteMessage(sessionId, messageId),
      editUserMessage: (sessionId, messageId, text) =>
        sessionTranscriptMutations.editUserMessage(sessionId, messageId, text)
    },
    workdir: sessionAssignment,
    projection: sessionQuery
  })
  sessionLifecycle = new SessionLifecycle({
    sessions: appSessionService,
    runtime: {
      resolveSession: (sessionId) => {
        const { handle } = agentManager.resolveSessionHandle(sessionId)
        return {
          kind: handle.kind,
          initialize: (config) => handle.lifecycle.initialize(config),
          isInitialized: () => handle.lifecycle.isInitialized(),
          snapshot: () => handle.snapshot(),
          getGenerationSettings: () => handle.settings.getGenerationSettings(),
          setPermissionMode: (mode) => handle.settings.setPermissionMode(mode),
          close: () => handle.close()
        }
      }
    },
    transcript: {
      hasMessages: (sessionId) => sessionData.transcript.hasMessages(sessionId),
      forkSessionFromMessage: (sourceSessionId, targetSessionId, targetMessageId) =>
        sessionTranscriptMutations.forkSessionFromMessage(
          sourceSessionId,
          targetSessionId,
          targetMessageId
        )
    },
    skills: {
      setActiveSkills: async (sessionId, activeSkills) => {
        await skillService.setActiveSkills(sessionId, activeSkills)
      }
    },
    assignmentPolicy: sessionAssignmentPolicy,
    workdir: sessionAssignment,
    initialTurn: sessionTurn,
    projection: sessionQuery,
    desktop: desktopSessionBinding,
    deletion: sessionDeletion,
    permissions: sessionPermissionPort
  })
  sessionHistorySearch = new SessionHistorySearch(sqlitePresenter, appSessionService)
  agentSessionExportService = new AgentSessionExportService({
    agentManager: agentManager,
    appSessionService,
    transcript: sessionData.transcript,
    configService: configService
  })
  sessionTranslation = new SessionTranslation({
    agentManager: agentManager,
    configService: configService,
    providerRuntime: providerRuntime
  })
  remoteService = new RemoteService({
    configService: configService,
    projects: projectService,
    lifecycle: sessionLifecycle,
    turn: sessionTurn,
    assignment: sessionAssignment,
    projection: sessionQuery,
    desktop: desktopSessionBinding,
    fileService: fileService,
    agentManager: agentManager,
    windowPresenter: windowPresenter,
    tabPresenter: tabPresenter
  })
  cronJobs = new SchedulerService({
    sqlitePresenter: sqlitePresenter as unknown as SQLitePresenter,
    configService: configService,
    runSessionStarter: createCronJobRunSessionStarter({
      lifecycle: sessionLifecycle,
      turn: sessionTurn,
      agentCatalog: configService
    }),
    remoteDeliveryPort: remoteService
  })

  ;(configService as ConfigService).startRuntime({
    refreshFloatingLanguage: () => floatingButtonPresenter.refreshLanguage(),
    refreshTabLanguage: async () => await (tabPresenter as TabPresenter).refreshLanguage(),
    refreshFloatingTheme: async () => await floatingButtonPresenter.refreshTheme(),
    restartApp: () => devicePresenter.restartApp(),
    applyContentProtection: (enabled) =>
      (windowPresenter as WindowPresenter).applyContentProtection(enabled),
    applyProxyMode: (mode) => {
      proxyConfig.setProxyMode(mode as ProxyMode)
      void proxyConfig.resolveProxy().then((resolved) => {
        if (resolved) (providerRuntime as ProviderRuntime).handleProxyResolved()
      })
    },
    applyCustomProxyUrl: (url) => {
      proxyConfig.setCustomProxyUrl(url)
      if (proxyConfig.getProxyMode() === ProxyMode.CUSTOM) void proxyConfig.resolveProxy()
    },
    setFloatingButtonEnabled: (enabled) => floatingButtonPresenter.setEnabled(enabled),
    refreshAcpProviderAgents: async (agentIds) => {
      const provider = providerRuntime.getProviderInstance('acp')
      if (provider) await (provider as AcpProvider).refreshAgents(agentIds)
    },
    replaceProviders: (providers) => providerRuntime.setProviders(providers),
    applyProviderAtomicUpdate: (change) =>
      (providerRuntime as ProviderRuntime).handleProviderAtomicUpdate(change),
    applyProviderBatchUpdate: (batchUpdate) =>
      (providerRuntime as ProviderRuntime).handleProviderBatchUpdate(batchUpdate),
    handleMcpConfigChanged: () => {
      mcpService.handleConfigChanged()
      void knowledgeService.syncConfigChanges().catch((error) => {
        console.error('[RAG] Error syncing knowledge configs:', error)
      })
    }
  })

  setDeepchatEventWindowPresenter(windowPresenter)
  function setupTray() {
    console.info('setupTray', !!trayPresenter)
    trayPresenter.init()
  }

  function init(mainRunId: string) {
    if (hasInitialized) {
      console.info('[Startup][Main] Main startup skipped because startup already ran')
      return
    }

    hasInitialized = true

    const providers = configService.getProviders()
    console.info(`[Startup][Main] Main startup begin providers=${providers.length}`)
    void startupWorkloadCoordinator.scheduleTask({
      id: 'main:floating-button',
      target: 'main',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.main.floatingButton',
      runId: mainRunId,
      run: async () => {
        await initializeFloatingButton()
      }
    })

    void startupWorkloadCoordinator.scheduleTask({
      id: 'main:yo-browser',
      target: 'main',
      phase: 'background',
      resource: 'io',
      labelKey: 'startup.main.yoBrowser',
      runId: mainRunId,
      run: async () => {
        await initializeYoBrowser()
      }
    })

    void startupWorkloadCoordinator.scheduleTask({
      id: 'main:skills-init',
      target: 'main',
      phase: 'background',
      resource: 'cpu',
      labelKey: 'startup.main.skillsInit',
      runId: mainRunId,
      run: async () => {
        await initializeSkills()
      }
    })

    void startupWorkloadCoordinator.scheduleTask({
      id: 'main:skills-sync-scan',
      target: 'main',
      phase: 'background',
      resource: 'cpu',
      labelKey: 'startup.main.skillsSyncScan',
      runId: mainRunId,
      run: async (taskContext) => {
        await taskContext.yield()
        await initializeSkillSyncScan()
      }
    })

    void startupWorkloadCoordinator.scheduleTask({
      id: 'main:mcp-init',
      target: 'main',
      phase: 'background',
      resource: 'io',
      labelKey: 'startup.main.mcpInit',
      runId: mainRunId,
      run: async (taskContext) => {
        await taskContext.yield()
        await initializeMcp()
      }
    })

    void startupWorkloadCoordinator.scheduleTask({
      id: 'main:remote-runtime',
      target: 'main',
      phase: 'background',
      resource: 'io',
      labelKey: 'startup.main.remoteRuntime',
      runId: mainRunId,
      run: async (taskContext) => {
        await taskContext.yield()
        await initializeRemoteControl()
      }
    })

    void startupWorkloadCoordinator
      .whenIdle('main', async () => {
        await startupWorkloadCoordinator.scheduleTask({
          id: 'main:provider-warmup-idle',
          target: 'main',
          phase: 'background',
          resource: 'io',
          labelKey: 'startup.main.provider.warmup',
          visibleId: 'main.provider.warmup',
          dedupeKey: 'main.provider.warmup:idle',
          runId: mainRunId,
          run: async (taskContext) => {
            await initializeIdleProviderWarmup(taskContext)
          }
        })
      })
      .catch((error) => {
        console.error('Failed to schedule idle provider warmup:', error)
      })
  }

  async function initializeFloatingButton() {
    try {
      await floatingButtonPresenter.initialize()
      logger.info('FloatingButtonPresenter initialized successfully')
    } catch (error) {
      console.error('Failed to initialize FloatingButtonPresenter:', error)
    }
  }

  async function initializeYoBrowser() {
    try {
      await yoBrowserPresenter.initialize()
      logger.info('YoBrowserPresenter initialized')
    } catch (error) {
      console.error('Failed to initialize YoBrowserPresenter:', error)
    }
  }

  async function initializeSkills() {
    try {
      const { enableSkills } = configService.getSkillSettings()
      if (!enableSkills) {
        logger.info('SkillService disabled by config')
        return
      }
      await skillService.initialize()
      logger.info('SkillService initialized')
      await skillSyncService.initialize()
    } catch (error) {
      console.error('Failed to initialize SkillService:', error)
    }
  }

  async function initializeSkillSyncScan() {
    try {
      const { enableSkills } = configService.getSkillSettings()
      if (!enableSkills) {
        return
      }
      await skillSyncService.initialize()
      await skillSyncService.scanAndDetectNewDiscoveries()
      logger.info('SkillSyncService background scan completed')
    } catch (error) {
      console.error('Failed to run SkillSyncService background scan:', error)
    }
  }

  async function initializeMcp() {
    try {
      await pluginService.initialize()
    } catch (error) {
      console.error('[PluginHost] Failed to initialize plugins:', error)
    }

    try {
      await mcpService.initialize()
      deepChatRuntimeCoordinator.refreshToolRegistry()
      deeplinkService.processPendingMcpInstall()
    } catch (error) {
      console.error('Failed to initialize McpService:', error)
    }
  }

  async function initializeRemoteControl() {
    try {
      await remoteService.initialize()
    } catch (error) {
      console.error('RemoteService.initialize failed:', error)
    }
  }

  async function initializeIdleProviderWarmup(taskContext: StartupWorkloadTaskContext) {
    const enabledProviders = configService
      .getEnabledProviders()
      .map((provider) => provider.id)
      .filter((providerId, index, ids) => ids.indexOf(providerId) === index)

    if (enabledProviders.length === 0) {
      taskContext.reportProgress(1)
      return
    }

    console.info(
      `[Startup][Main] startup.provider.warmup.deferred begin providers=${enabledProviders.length}`
    )

    for (const [index, providerId] of enabledProviders.entries()) {
      if (taskContext.signal.aborted) {
        const error = new Error(`Provider warmup aborted for ${providerId}`)
        error.name = 'AbortError'
        throw error
      }

      const providerModels = configService.getProviderModels(providerId)
      const customModels = configService.getCustomModels(providerId)
      configService.getDbProviderModels(providerId)
      configService.getBatchModelStatus(providerId, [
        ...providerModels.map((model) => model.id),
        ...customModels.map((model) => model.id)
      ])

      taskContext.reportProgress((index + 1) / enabledProviders.length)
      await taskContext.yield()
    }

    console.info(
      `[Startup][Main] startup.provider.warmup.deferred done providers=${enabledProviders.length}`
    )
  }

  async function destroy(): Promise<void> {
    unsubscribeProviderDbCatalog()
    try {
      await runDestroyStep('cronJobs.stop', () => cronJobs.stop())
    } catch (error) {
      console.error('SchedulerService.stop failed during main shutdown:', error)
    }

    await runDestroyStep('hookService.stop', () => hookService.stop())

    try {
      await runDestroyStep('pluginService.shutdown', () => pluginService.shutdown())
    } catch (error) {
      console.error('PluginService.shutdown failed during main shutdown:', error)
    }

    try {
      await runDestroyStep('mcpService.shutdown', () => mcpService.shutdown())
    } catch (error) {
      console.error('McpService.shutdown failed during main shutdown:', error)
    }

    await runDestroyStep('destroyRemoteControl', () => destroyRemoteControl())
    floatingButtonPresenter.destroy()
    tabPresenter.destroy()
    await runDestroyStep('workspaceService.destroy', () => workspaceService.destroy())
    skillSyncService.destroy()
    await runDestroyStep('skillService.destroy', () => skillService.destroy())
    await runDestroyStep('fileWatcherService.destroy', () => fileWatcherService.destroy())
    // Fence new ingestion synchronously, then let Memory disposal abort provider-bound work before
    // awaiting the existing chains. This avoids both late SQLite writes and shutdown deadlocks.
    const memoryIngestionDrain = (() => {
      try {
        return memoryIngestionObserver.drainAndFence().then(
          (outcome) => ({ outcome }) as const,
          (error) => ({ error }) as const
        )
      } catch (error) {
        return Promise.resolve({ error } as const)
      }
    })()
    await runDestroyStep('memoryService.dispose', () => memoryService.dispose())
    let memoryIngestionDrainOutcome: MemoryIngestionDrainOutcome | undefined
    await runDestroyStep('memoryIngestionObserver.drainAndFence', async () => {
      const result = await memoryIngestionDrain
      if ('error' in result) throw result.error
      memoryIngestionDrainOutcome = result.outcome
    })
    if (memoryIngestionDrainOutcome?.timedOut) {
      logger.warn(
        `[Main] Memory ingestion drain timed out with ${memoryIngestionDrainOutcome.pendingSessions.length} pending session(s); late writes remain fenced.`
      )
    }
    await runDestroyStep('knowledgeService.destroy', () => knowledgeService.destroy())
    await runDestroyStep('providerRuntime.shutdown', () => providerRuntime.shutdown())
    await runDestroyStep('acpRuntime.shutdown', () => acpRuntimeOwner.shutdown())
    await runDestroyStep('sqlitePresenter.close', () => sqlitePresenter.close())
    shortcutPresenter.destroy()
    notificationService.clearAllNotifications()
  }

  async function runDestroyStep(stepName: string, step: () => void | Promise<void>): Promise<void> {
    const startedAt = performance.now()
    logger.info(`[Main] destroy.${stepName} begin`)
    try {
      await step()
      logger.info(
        `[Main] destroy.${stepName} done durationMs=${(performance.now() - startedAt).toFixed(1)}`
      )
    } catch (error) {
      logger.warn(
        `[Main] destroy.${stepName} failed durationMs=${(performance.now() - startedAt).toFixed(1)}`,
        error
      )
    }
  }

  async function destroyRemoteControl() {
    try {
      await remoteService.destroy()
    } catch (error) {
      console.error('RemoteService.destroy failed:', error)
    }
  }

  function registerRoutes(): void {
    const providerRoutes = createProviderRoutes({
      configService,
      providerRuntime,
      acpProviderAdminPort,
      providerImportService: new ProviderImportService(configService),
      oauthPresenter,
      scheduler: createNodeScheduler(),
      recordSettingsActivity: (input) => sqlitePresenter.recordSettingsActivity(input)
    })
    const toolRoutes = createToolRoutes(toolService)
    const pluginRoutes = createPluginRoutes(pluginService)
    const skillRoutes = createSkillRoutes({
      skillService,
      skillSyncService,
      recordSettingsActivity: (input) => sqlitePresenter.recordSettingsActivity(input)
    })
    const mcpRoutes = createMcpRoutes({
      mcpService,
      recordSettingsActivity: (input) => sqlitePresenter.recordSettingsActivity(input)
    })
    const remoteRoutes = createRemoteRoutes(remoteService)
    const schedulerRoutes = createSchedulerRoutes(cronJobs)
    const memoryRoutes = createMemoryRoutes({
      memoryService,
      getAgentType: (agentId) => configService.getAgentType(agentId),
      getTapeEntries: () => sqlitePresenter.deepchatTapeEntriesTable,
      getAuditEntries: () => sqlitePresenter.agentMemoryAuditTable
    })
    const desktopRoutes = createDesktopRoutes({
      windowPresenter,
      shortcutPresenter,
      browserPresenter: yoBrowserPresenter,
      tabPresenter,
      dialogPresenter
    })
    const fileRoutes = createFileRoutes(fileService)
    const knowledgeRoutes = createKnowledgeRoutes(knowledgeService)
    const workspaceRoutes = createWorkspaceRoutes(workspaceService)
    const projectRoutes = createProjectRoutes({
      projectService,
      publishEnvironmentsChanged: (action, environmentPath) => {
        publishDeepchatEvent(projectEnvironmentsChangedEvent.name, {
          action,
          path: environmentPath,
          version: Date.now()
        })
      }
    })
    const sessionRoutes = createSessionRoutes({
      lifecycle: sessionLifecycle,
      projection: sessionQuery,
      desktop: desktopSessionBinding,
      turn: sessionTurn,
      assignment: sessionAssignment,
      permission: sessionPermissionPort,
      config: configService,
      scheduler: createNodeScheduler(),
      historySearch: sessionHistorySearch,
      exportService: agentSessionExportService,
      translation: sessionTranslation,
      usageStats: usageStatsService,
      rtkRuntime: rtkRuntimeService
    })
    const acpRoutes = createAcpRoutes()
    const deviceRoutes = createDeviceRoutes({
      device: devicePresenter,
      resetDataByType: (resetType) => resetApplicationData(resetType)
    })
    const onboardingRoutes = createOnboardingRoutes(configService)
    const upgradeRoutes = createUpgradeRoutes(upgradeService)
    const exporterRoutes = createExporterRoutes(exporter)
    const syncRoutes = createSyncRoutes({
      sync: syncService,
      settings: syncSettings,
      importFromSync: (backupFileName, importMode) =>
        runDatabaseMaintenance((database) =>
          syncService.importFromSync(backupFileName, importMode ?? ImportMode.INCREMENT, database)
        ),
      pullLatestBackupFromCloud: (importMode) => pullLatestBackupFromCloud(importMode),
      recordActivity: (input) => {
        void sqlitePresenter.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      }
    })
    const configRoutes = createConfigRoutes({
      config: configService,
      syncSettings,
      hookSettings,
      updateSettings,
      desktopSettings,
      projectService,
      testHookCommand: (hookId) => hookService.testHookCommand(hookId),
      recordActivity: (input) => {
        void sqlitePresenter.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      },
      listActivities: (limit) => sqlitePresenter.listSettingsActivity(limit),
      reconcileSchedulerAfterAgentChange: async () => {
        await cronJobs.reconcileScheduler('agent-change')
      }
    })
    const appRoutes = createAppRoutes({
      config: configService,
      projects: projectService,
      databaseSecurity: databaseSecurityPresenter,
      database: sqlitePresenter,
      startupSession: sessionQuery,
      desktopSession: desktopSessionBinding,
      startup: startupWorkloadCoordinator,
      ensureDefaultWorkspace: () => projectService.ensureDefaultWorkspace(),
      enableDatabaseEncryption: (password) =>
        runDatabaseMaintenance((database) =>
          databaseSecurityPresenter.enableEncryption({ password, database, configService })
        ),
      changeDatabasePassword: (currentPassword, newPassword) =>
        runDatabaseMaintenance((database) =>
          databaseSecurityPresenter.changePassword({
            currentPassword,
            newPassword,
            database,
            configService
          })
        ),
      disableDatabaseEncryption: (currentPassword) =>
        runDatabaseMaintenance((database) =>
          databaseSecurityPresenter.disableEncryption({
            currentPassword,
            database,
            configService
          })
        ),
      recordActivity: (input) => {
        void sqlitePresenter.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      },
      publishSessionsUpdated: (sessionIds) => {
        publishDeepchatEvent(sessionsUpdatedEvent.name, { sessionIds, reason: 'created' })
      }
    })
    const routeDispatcher = createRouteDispatcher({
      appDatabaseMaintenance: {
        assertRouteAllowed: (routeName) => assertRouteAllowedDuringDatabaseMaintenance(routeName)
      },
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
        acpRoutes,
        deviceRoutes,
        onboardingRoutes,
        upgradeRoutes,
        exporterRoutes,
        syncRoutes,
        configRoutes,
        appRoutes
      ],
      settingsWindow: windowPresenter,
      startupWorkloadCoordinator
    })
    registerDeepchatRoutes(ipcMain, routeDispatcher)
  }

  function setupApplicationListeners(): void {
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    app.on('activate', () => {
      if (windowPresenter.restoreMainWindowHiddenByClose()) {
        return
      }

      if (windowPresenter.getAllWindows().length === 0) {
        void windowPresenter.createAppWindow({ initialRoute: 'chat' })
      }
    })

    app.on('did-resign-active', () => {
      setTimeout(() => {
        if (app.isHidden()) {
          windowPresenter.clearMainWindowHiddenByClose()
        }
      }, 0)
    })

    app.on('browser-window-focus', () => {
      shortcutPresenter.registerShortcuts()
      upgradeService.handleAppFocus()
    })

    app.on('browser-window-blur', () => {
      setTimeout(() => {
        const isAnyWindowFocused = windowPresenter
          .getAllWindows()
          .some((window) => !window.isDestroyed() && window.isFocused())

        if (!isAnyWindowFocused) {
          shortcutPresenter.unregisterShortcuts()
        }
      }, 50)
    })
  }

  async function runAcpRegistryMigration(): Promise<void> {
    const service = new AcpRegistryMigrationService(configService, sqlitePresenter)
    try {
      await service.runIfNeeded()
    } catch (error) {
      console.error('Failed to migrate ACP registry references:', error)
    }

    try {
      await service.compensateEnabledRegistryAgentInstalls()
    } catch (error) {
      console.error('Failed to compensate ACP install states:', error)
    }
  }

  function scheduleBackgroundWork(): void {
    const schedule = (
      task: Parameters<StartupWorkloadCoordinator['scheduleTask']>[0],
      errorMessage: string
    ) => {
      void startupWorkloadCoordinator.scheduleTask(task).catch((error) => {
        console.error(errorMessage, error)
      })
    }

    schedule(
      {
        id: 'main:legacy-import',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.legacyImport',
        run: async () => legacyChatImportService.start(false)
      },
      'Failed to start legacy import task:'
    )

    schedule(
      {
        id: 'main:rtk-health-check',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.rtkHealthCheck',
        run: async (taskContext) => {
          taskContext.reportProgress(0)
          await taskContext.yield()
          await rtkRuntimeService.startHealthCheck()
          taskContext.reportProgress(1)
        }
      },
      'Failed to start RTK health check:'
    )

    schedule(
      {
        id: 'main:usage-stats-backfill',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.usageStatsBackfill',
        run: async (taskContext) => usageStatsService.startBackfill(taskContext)
      },
      'Failed to start usage stats backfill:'
    )

    schedule(
      {
        id: 'main:sqlite-mainline-normalization',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.sqliteMainlineNormalization',
        run: async (taskContext) =>
          runMainlineNormalizationMigration(
            { sqlitePresenter: sessionDataMigrationSQLite, configService, appSessionService },
            taskContext
          )
      },
      'Failed to start normalization backfill:'
    )

    schedule(
      {
        id: 'main:disabled-search-tool-cleanup',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.disabledSearchToolCleanup',
        run: async (taskContext) =>
          runDisabledSearchToolCleanupMigration(
            { sqlitePresenter: sessionDataMigrationSQLite, configService, appSessionService },
            taskContext
          )
      },
      'Failed to start disabled search tool cleanup:'
    )
  }

  async function stop(): Promise<void> {
    windowPresenter.setApplicationQuitting(true)
    windowPresenter.destroyFloatingChatWindow()
    startupWorkloadCoordinator.cancelTarget('main')

    try {
      killTerminal()
    } catch (error) {
      logger.warn('Failed to stop ACP init terminal:', error)
    }

    try {
      await destroy()
    } finally {
      trayPresenter.destroy()
    }
  }

  function assertRouteAllowedDuringDatabaseMaintenance(routeName: string): void {
    if (databaseMaintenanceState === 'running') return
    if (
      routeName.startsWith('chat.') ||
      routeName.startsWith('sessions.') ||
      routeName.startsWith('remoteControl.') ||
      routeName.startsWith('cronJobs.')
    ) {
      throw new Error(`App database maintenance is ${databaseMaintenanceState}`)
    }
  }

  async function runDatabaseMaintenance<T>(
    operation: (database: ApplicationDatabaseMaintenancePort) => Promise<T>
  ): Promise<T> {
    if (databaseMaintenanceState !== 'running') {
      throw new Error(`App database maintenance is ${databaseMaintenanceState}`)
    }
    databaseMaintenanceState = 'maintenance'
    startupWorkloadCoordinator.cancelTarget('main')
    memoryService.stopBackgroundMaintenance()

    let operationResult: T | undefined
    let operationError: unknown
    try {
      await cronJobs.stop()
      await remoteService.destroy()
      await hookService.stop()
      const drain = await memoryIngestionObserver.drainAndFence()
      if (drain.timedOut) {
        throw new Error(
          `Memory ingestion did not drain for sessions: ${drain.pendingSessions.join(', ')}`
        )
      }
      await suspendSessionRuntimes()
      operationResult = await operation({
        getDatabasePath: () => sqlitePresenter.getDatabasePath(),
        checkpointAndClose: () => {
          const database = sqlitePresenter.getDatabase()
          if (database.open) {
            database.pragma('wal_checkpoint(TRUNCATE)')
          }
          sqlitePresenter.close()
        },
        close: () => sqlitePresenter.close(),
        reopen: () => reopenApplicationDatabase(),
        reopenWithPassword: (password) => {
          sqlitePresenter.reopenWithPassword(password)
          configService.setSQLitePresenter(sqlitePresenter)
        },
        isOpen: () => sqlitePresenter.getDatabase().open,
        importLegacyChatDb: (sourceDbPath, mode) =>
          sqlitePresenter.importLegacyChatDb(sourceDbPath, mode)
      })
    } catch (error) {
      operationError = error
    }

    try {
      if (!sqlitePresenter.getDatabase().open) {
        reopenApplicationDatabase()
      }
      memoryIngestionObserver.resumeIngestion()
      memoryService.startBackgroundMaintenance()
      hookService.start()
      cronJobs.start()
      await remoteService.initialize()
      startupWorkloadCoordinator.createRun('main')
      scheduleBackgroundWork()
      databaseMaintenanceState = 'running'
    } catch (error) {
      databaseMaintenanceState = 'failed'
      throw error
    }

    if (operationError) throw operationError
    return operationResult as T
  }

  function reopenApplicationDatabase(): void {
    sqlitePresenter.reopen()
    configService.setSQLitePresenter(sqlitePresenter)
  }

  async function suspendSessionRuntimes(): Promise<void> {
    const results = await Promise.allSettled(
      appSessionService.list({ includeSubagents: true }).map(async (session) => {
        const sessionId = toAppSessionId(session.id)
        await Promise.all([
          deepChatRuntimeCoordinator.deepChatRuntime.cleanupSession(sessionId),
          acpAgentRuntime.cleanupSession(sessionId)
        ])
      })
    )
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failure) throw failure.reason
  }

  async function pullLatestBackupFromCloud(
    importMode: 'increment' | 'overwrite' = ImportMode.INCREMENT
  ) {
    const download = await syncService.downloadLatestBackupFromCloud()
    if (!download.success || !download.fileName) return download
    const backupFileName = download.fileName
    const result = await runDatabaseMaintenance((database) =>
      syncService.importFromSync(backupFileName, importMode, database)
    )
    return { ...result, fileName: backupFileName }
  }

  async function resetApplicationData(
    resetType: 'chat' | 'knowledge' | 'config' | 'all'
  ): Promise<void> {
    await stop()
    await devicePresenter.resetDataByType(resetType)
  }

  const control: MainProcessControl = {
    focusPrimaryWindow: () => {
      const targetWindow = windowPresenter.getAllWindows()[0]
      if (!targetWindow || targetWindow.isDestroyed()) {
        return
      }

      if (targetWindow.isMinimized()) {
        targetWindow.restore()
      }
      targetWindow.show()
      targetWindow.focus()
      activateAppOnMac()
    },
    handleDeepLink: async (url) => await deeplinkService.handleDeepLink(url),
    clearPermissionCaches: () => {
      commandPermissionService.clearAll()
      filePermissionService.clearAll()
      settingsPermissionService.clearAll()
    },
    confirmShutdown: async () => await knowledgeService.confirmShutdown(),
    cancelShutdown: () => windowPresenter.setApplicationQuitting(false),
    hasMainWindows: () => windowPresenter.getAllWindows().length > 0,
    stop
  }

  dependencies.bindControl(control)
  registerRoutes()
  deeplinkService.init()
  init(dependencies.startupRunId)
  setupApplicationListeners()
  await runAcpRegistryMigration()

  if (windowPresenter.getAllWindows().length === 0) {
    const windowId = await windowPresenter.createAppWindow({ initialRoute: 'chat' })
    if (!windowId) {
      throw new Error('Failed to create initial app window')
    }
  }

  shortcutPresenter.registerShortcuts()
  setupTray()
  cronJobs.start()
  memoryService.startBackgroundMaintenance()
  scheduleBackgroundWork()
  return control
}
