import logger from '@shared/logger'
import { performance } from 'node:perf_hooks'
import path from 'path'
import { DialogPresenter } from '../presenter/dialogPresenter/index'
import { app, ipcMain } from 'electron'
import { optimizer } from '@electron-toolkit/utils'
import { WindowPresenter } from '../presenter/windowPresenter'
import { ShortcutPresenter } from '../presenter/shortcutPresenter'
import {
  IDialogPresenter,
  IFilePresenter,
  IKnowledgePresenter,
  ILlmProviderPresenter,
  INotificationPresenter,
  IShortcutPresenter,
  ISQLitePresenter,
  ITabPresenter,
  IConversationExporter,
  IUpgradePresenter,
  IWindowPresenter,
  IWorkspacePresenter,
  IToolPresenter,
  IYoBrowserPresenter,
  ISkillPresenter,
  ISkillSyncPresenter,
  IProjectPresenter,
  IRemoteControlPresenter
} from '@shared/presenter'
import { LLMProviderPresenter } from '../presenter/llmProviderPresenter'
import { ConfigPresenter } from '../presenter/configPresenter'
import { AcpProvider } from '../presenter/llmProviderPresenter/providers/acpProvider'
import { proxyConfig, ProxyMode } from '../presenter/proxyConfig'
import { DevicePresenter } from '../presenter/devicePresenter'
import { UpgradePresenter } from '../presenter/upgradePresenter'
import { FilePresenter } from '../presenter/filePresenter/FilePresenter'
import { McpPresenter } from '../presenter/mcpPresenter'
import { SyncPresenter, type SyncImportDatabasePort } from '../presenter/syncPresenter'
import { DeeplinkPresenter } from '../presenter/deeplinkPresenter'
import { NotificationPresenter } from '../presenter/notificationPresenter'
import { TabPresenter } from '../presenter/tabPresenter'
import { DesktopSessionBinding } from '@/desktop/sessionBinding'
import { TrayPresenter } from '../presenter/trayPresenter'
import { OAuthPresenter } from '../presenter/oauthPresenter'
import { FloatingButtonPresenter } from '../presenter/floatingButtonPresenter'
import { YoBrowserPresenter } from '../presenter/browser/YoBrowserPresenter'
import { KnowledgePresenter } from '../presenter/knowledgePresenter'
import { WorkspacePresenter } from '../presenter/workspacePresenter'
import { ToolPresenter } from '../presenter/toolPresenter'
import {
  CommandPermissionService,
  FilePermissionService,
  SettingsPermissionService
} from '../presenter/permission'
import type { AgentToolRuntimePort } from '../presenter/toolPresenter/runtimePorts'

import { ConversationExporterService } from '../presenter/exporter'
import { SkillPresenter } from '../presenter/skillPresenter'
import type { SkillSessionStatePort } from '../presenter/skillPresenter'
import { SkillSyncPresenter } from '../presenter/skillSyncPresenter'
import { HooksNotificationsService } from '../presenter/hooksNotifications'
import { NewSessionHooksBridge } from '../presenter/hooksNotifications/newSessionBridge'
import { CronJobsService, createCronJobRunSessionStarter } from '../presenter/cronJobs'
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
import { SessionTurn } from '@/session/turn'
import { SessionLifecycle } from '@/session/lifecycle'
import { AgentRuntimePresenter } from '../presenter/agentRuntimePresenter'
import { AcpAgentRuntime } from '@/agent/acp/instance'
import type {
  MemoryIngestionDrainOutcome,
  MemoryIngestionObserver
} from '@/agent/deepchat/memory/memoryIngestionObserver'
import { MemoryPresenter, isSafeAgentId } from '../presenter/memoryPresenter'
import {
  createMemoryVectorStorePaths,
  MemoryVectorStore
} from '../presenter/memoryPresenter/infra/memoryVectorStore'
import { ProjectPresenter } from '../presenter/projectPresenter'
import { RemoteControlPresenter } from '../presenter/remoteControlPresenter'
import type { RemoteControlPresenterLike } from '../presenter/remoteControlPresenter/interface'
import { PluginPresenter } from '../presenter/pluginPresenter'
import { AgentRepository, BUILTIN_DEEPCHAT_AGENT_ID } from '../presenter/agentRepository'
import { ImportMode, type SQLitePresenter } from '../presenter/sqlitePresenter'
import {
  DatabaseSecurityPresenter,
  type DatabaseSecurityMigrationDatabasePort
} from '../presenter/databaseSecurityPresenter'
import { normalizeDeepChatSubagentSlots } from '@shared/lib/deepchatSubagents'
import { subscribeDeepChatInternalSessionUpdates } from '../presenter/agentRuntimePresenter/internalSessionEvents'
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
import { SessionHistorySearch } from '@/routes/sessions/sessionHistorySearch'
import { SessionTranslation } from '@/routes/sessions/sessionTranslation'
import { AgentSessionExportService } from '../presenter/exporter/agentSessionExporter'
import { createInMemoryServerFactory } from '../presenter/mcpPresenter/inMemoryServers/builder'
import { createMainKernelRouteRuntime, registerMainKernelRoutes } from '@/routes'
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
  configPresenter: ConfigPresenter
  sqlitePresenter: ISQLitePresenter
  databaseSecurityPresenter: DatabaseSecurityPresenter
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  startupRunId: string
  requestUpdateInstall: (installAction: () => void) => Promise<void>
  onWindowCreated: (isMainWindow: boolean) => void
  bindControl: (control: MainProcessControl) => void
}) {
  const configPresenter = dependencies.configPresenter
  const databaseSecurityPresenter = dependencies.databaseSecurityPresenter
  const startupWorkloadCoordinator = dependencies.startupWorkloadCoordinator
  const concreteSQLitePresenter = dependencies.sqlitePresenter as unknown as SQLitePresenter
  const sqlitePresenter = concreteSQLitePresenter
  let windowPresenter: IWindowPresenter
  let llmproviderPresenter: ILlmProviderPresenter
  let acpProviderAdminPort: AcpProviderAdminPort
  let exporter: IConversationExporter
  let devicePresenter: DevicePresenter
  let upgradePresenter: IUpgradePresenter
  let shortcutPresenter: IShortcutPresenter
  let filePresenter: IFilePresenter
  let mcpPresenter: McpPresenter
  let syncPresenter: SyncPresenter
  let deeplinkPresenter: DeeplinkPresenter
  let notificationPresenter: INotificationPresenter
  let tabPresenter: ITabPresenter
  let trayPresenter: TrayPresenter
  let oauthPresenter: OAuthPresenter
  let floatingButtonPresenter: FloatingButtonPresenter
  let knowledgePresenter: IKnowledgePresenter
  let workspacePresenter: IWorkspacePresenter
  let toolPresenter: IToolPresenter
  let yoBrowserPresenter: IYoBrowserPresenter
  let dialogPresenter: IDialogPresenter
  let skillPresenter: ISkillPresenter
  let skillSyncPresenter: ISkillSyncPresenter
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
  let memoryPresenter: MemoryPresenter
  let memoryIngestionObserver: MemoryIngestionObserver
  let projectPresenter: IProjectPresenter
  let remoteControlPresenter: IRemoteControlPresenter
  let remoteControlPresenterImpl: RemoteControlPresenterLike
  let pluginPresenter: PluginPresenter
  let hooksNotifications: HooksNotificationsService
  let cronJobs: CronJobsService
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
  configPresenter.setAgentRepository(agentRepository)
  configPresenter.setSQLitePresenter(sqlitePresenter)
  const sessionData = createSessionData(sqlitePresenter)
  appSessionService = new AppSessionService(sqlitePresenter)
  sessionDataMigrationSQLite = concreteSQLitePresenter
  legacyChatImportService = new LegacyChatImportService(concreteSQLitePresenter)
  usageStatsService = new UsageStatsService(concreteSQLitePresenter, configPresenter)

  // Initialize presenters and their dependencies.
  windowPresenter = new WindowPresenter(
    configPresenter,
    () => devicePresenter.restartApp(),
    dependencies.onWindowCreated,
    startupWorkloadCoordinator
  )
  const llmProviderPresenter = new LLMProviderPresenter(configPresenter, sqlitePresenter, {
    getNpmRegistry: () => mcpPresenter.getNpmRegistry(),
    getUvRegistry: () => mcpPresenter.getUvRegistry()
  })
  llmproviderPresenter = llmProviderPresenter
  acpProviderAdminPort = llmProviderPresenter
  acpAsLlmProviderSessionControl = llmProviderPresenter
  acpAsLlmProviderPermission = llmProviderPresenter
  const commandPermissionHandler = new CommandPermissionService()
  commandPermissionService = commandPermissionHandler
  filePermissionService = new FilePermissionService()
  settingsPermissionService = new SettingsPermissionService()
  devicePresenter = new DevicePresenter()
  exporter = new ConversationExporterService({
    sqlitePresenter: sqlitePresenter,
    configPresenter: configPresenter
  })
  upgradePresenter = new UpgradePresenter(configPresenter, dependencies.requestUpdateInstall)
  shortcutPresenter = new ShortcutPresenter(configPresenter, windowPresenter)
  filePresenter = new FilePresenter(configPresenter)
  syncPresenter = new SyncPresenter(configPresenter, sqlitePresenter)
  notificationPresenter = new NotificationPresenter(configPresenter)
  oauthPresenter = new OAuthPresenter(configPresenter)
  trayPresenter = new TrayPresenter(configPresenter, windowPresenter)
  dialogPresenter = new DialogPresenter()
  yoBrowserPresenter = new YoBrowserPresenter(windowPresenter)

  // Define dbDir for knowledge presenter
  const dbDir = path.join(app.getPath('userData'), 'app_db')
  knowledgePresenter = new KnowledgePresenter(
    configPresenter,
    dbDir,
    filePresenter,
    dialogPresenter,
    llmproviderPresenter
  )
  mcpPresenter = new McpPresenter(
    configPresenter,
    createInMemoryServerFactory({
      sqlitePresenter,
      sessions: appSessionService,
      transcript: sessionData.transcript,
      settings: sessionData.settings,
      configPresenter: configPresenter,
      knowledgePresenter: knowledgePresenter
    }),
    llmproviderPresenter,
    (data) => devicePresenter.cacheImage(data)
  )
  deeplinkPresenter = new DeeplinkPresenter(windowPresenter, configPresenter, mcpPresenter)

  // Initialize generic Workspace presenter (for all Agent modes)
  workspacePresenter = new WorkspacePresenter(filePresenter)

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

      const agent = await configPresenter.getAgent(session.agentId)
      const agentType = await configPresenter.getAgentType(session.agentId)
      const permissionMode = await sessionAssignment.getPermissionMode(session.id)
      const generationSettings = await sessionAssignment.getSessionGenerationSettings(session.id)
      const disabledAgentTools = await sessionAssignment.getSessionDisabledAgentTools(session.id)
      const activeSkills = await skillPresenter.getActiveSkills(session.id)
      const availableSubagentSlots =
        agentType === 'deepchat' && session.sessionKind === 'regular'
          ? normalizeDeepChatSubagentSlots(
              (await configPresenter.resolveDeepChatAgentConfig(session.agentId)).subagents
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
    isMemoryEnabled: (agentId) => memoryPresenter.isEnabled(agentId),
    rememberMemory: async (agentId, input, sourceSession, model) =>
      memoryPresenter.rememberMemory(
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
      const items = await memoryPresenter.recall(agentId, query)
      return items.map((item) => ({
        id: item.id,
        kind: item.kind,
        content: item.content
      }))
    },
    forgetMemory: async (agentId, memoryId) =>
      await memoryPresenter.forgetMemory(agentId, memoryId),
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
    getSkillPresenter: () => skillPresenter,
    getYoBrowserToolHandler: () => yoBrowserPresenter.toolHandler,
    getFilePresenter: () => ({
      getMimeType: (filePath) => filePresenter.getMimeType(filePath),
      prepareFileCompletely: (absPath, typeInfo, contentType) =>
        filePresenter.prepareFileCompletely(absPath, typeInfo, contentType)
    }),
    getLlmProviderPresenter: () => ({
      executeWithRateLimit: (providerId, options) =>
        llmproviderPresenter.executeWithRateLimit(providerId, options),
      generateCompletionStandalone: (
        providerId,
        messages,
        modelId,
        temperature,
        maxTokens,
        options
      ) =>
        llmproviderPresenter.generateCompletionStandalone(
          providerId,
          messages,
          modelId,
          temperature,
          maxTokens,
          options
        ),
      generateImageStandalone: (providerId, prompt, modelId, imageOptions, options) =>
        llmproviderPresenter.generateImageStandalone(
          providerId,
          prompt,
          modelId,
          imageOptions,
          options
        ),
      generateVideoStandalone: (providerId, prompt, modelId, videoOptions, options) =>
        llmproviderPresenter.generateVideoStandalone(
          providerId,
          prompt,
          modelId,
          videoOptions,
          options
        )
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

  // Initialize unified Tool presenter (for routing MCP and Agent tools)
  toolPresenter = new ToolPresenter({
    mcpPresenter: mcpPresenter,
    configPresenter: configPresenter,
    commandPermissionHandler,
    agentToolRuntime
  })

  const skillSessionStatePort: SkillSessionStatePort = {
    hasNewSession: async (conversationId) => {
      try {
        return Boolean(await sessionQuery.getSession(conversationId))
      } catch {
        return false
      }
    },
    getPersistedNewSessionSkills: (conversationId) =>
      sqlitePresenter.newSessionsTable?.getActiveSkills(conversationId) ?? [],
    setPersistedNewSessionSkills: (conversationId, skills) => {
      sqlitePresenter.newSessionsTable?.updateActiveSkills(conversationId, skills)
      sqlitePresenter.newEnvironmentsTable?.syncForSession(conversationId)
    },
    repairImportedLegacySessionSkills: async (conversationId) => {
      return await legacyChatImportService.repairImportedLegacySessionSkills(conversationId)
    }
  }

  // Initialize Skill presenter
  skillPresenter = new SkillPresenter(configPresenter, skillSessionStatePort)

  // Initialize official plugin host. Plugins are activated before MCP startup so managed
  // MCP servers are present when the regular MCP presenter starts enabled servers.
  pluginPresenter = new PluginPresenter({
    configPresenter: configPresenter,
    mcpPresenter: mcpPresenter,
    skillPresenter: skillPresenter
  })

  // Initialize Skill Sync presenter
  skillSyncPresenter = new SkillSyncPresenter(skillPresenter, configPresenter)

  // Initialize new agent architecture presenters first (needed by hooksNotifications)
  hooksNotifications = new HooksNotificationsService(configPresenter, {
    getSession: (sessionId) => sessionQuery.getSession(sessionId),
    getMessage: (messageId) => sessionQuery.getMessage(messageId)
  })
  cronJobs = new CronJobsService({
    sqlitePresenter: sqlitePresenter as unknown as SQLitePresenter,
    configPresenter: configPresenter
  })
  const newSessionHooksBridge = new NewSessionHooksBridge(hooksNotifications)
  const providerCatalogPort: ProviderCatalogPort = {
    getProviderModels: (providerId) => configPresenter.getProviderModels(providerId),
    getCustomModels: (providerId) => configPresenter.getCustomModels(providerId),
    getAgentType: async (agentId) => await configPresenter.getAgentType(agentId)
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
      mcpPresenter.clearSessionPermissions(sessionId)
    },
    cloneSessionPermissions: (sourceSessionId, targetSessionId) => {
      // MCP temporary approvals are intentionally never inherited.
      mcpPresenter.clearSessionPermissions(targetSessionId)
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
        await mcpPresenter.grantPermission(serverName, permissionType, false, sessionId)
      }
    }
  }
  // Initialize agent memory layer (opt-in per agent; vectors stored separately from knowledge base)
  const memoryDbDir = path.join(dbDir, 'AgentMemory')
  MemoryVectorStore.recoverQuarantinedStores(memoryDbDir)
  const memoryVectorDbPaths = (agentId: string) =>
    createMemoryVectorStorePaths(memoryDbDir, agentId)
  memoryPresenter = new MemoryPresenter({
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
      llmproviderPresenter.executeWithRateLimit(providerId, { signal: options.signal }),
    getEmbeddings: (providerId, modelId, texts, signal) =>
      llmproviderPresenter.getEmbeddings(providerId, modelId, texts, signal),
    getDimensions: (providerId, modelId, signal) =>
      llmproviderPresenter.getDimensions(providerId, modelId, signal),
    generateText: async (providerId, modelId, prompt) =>
      (await llmproviderPresenter.generateText(providerId, prompt, modelId, 0.2)).content ?? '',
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
  configPresenter.setDeepChatAgentDeleteCleanup((agentId) =>
    memoryPresenter.cleanupDeletedAgentResources(agentId)
  )
  configPresenter.setDeepChatAgentMemoryMaintenanceConfigChanged((agentId) => {
    if (agentId === BUILTIN_DEEPCHAT_AGENT_ID) {
      memoryPresenter.onBuiltinDeepChatMemoryMaintenanceConfigChanged()
      return
    }
    memoryPresenter.onAgentMemoryMaintenanceConfigChanged(agentId)
  })

  // Initialize new agent architecture presenters
  const agentRuntimePresenter = new AgentRuntimePresenter(
    llmproviderPresenter as unknown as ILlmProviderPresenter,
    configPresenter,
    sqlitePresenter,
    sessionData,
    toolPresenter,
    newSessionHooksBridge,
    {
      providerCatalogPort,
      sessionPermissionPort,
      acpAsLlmProviderPermission: acpAsLlmProviderPermission,
      sessionUiPort,
      memoryPort: memoryPresenter,
      cacheImage: (data) => devicePresenter.cacheImage(data),
      skillPresenter: skillPresenter
    }
  )
  memoryIngestionObserver = agentRuntimePresenter.memoryIngestionObserver
  acpAgentRuntime = new AcpAgentRuntime(
    (llmproviderPresenter as LLMProviderPresenter).getAcpRuntimeOwner(),
    (input) => agentRuntimePresenter.createAcpAgentInstanceDependencies(input),
    agentRuntimePresenter.getAcpPendingInputFacet()
  )
  agentManager = new AgentManager(agentRepository, appSessionService, {
    deepchat: createDeepChatAgentBackend({
      port: agentRuntimePresenter,
      runtime: agentRuntimePresenter.deepChatRuntime,
      transcript: sessionData.transcript,
      tape: sessionData.tape
    }),
    acp: createDirectAcpAgentBackend({
      runtime: acpAgentRuntime,
      sessionState: agentRuntimePresenter,
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
        const agent = (await configPresenter.getAcpAgents()).find(
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
    titles: llmproviderPresenter,
    agentConfig: {
      getAssistantModel: async (agentId) => {
        const selection = await resolveAssistantModelSelection(
          {
            agentManager: agentManager,
            configPresenter: configPresenter
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
    deeplinkPresenter.processStartupUrl()
  )
  ;(windowPresenter as WindowPresenter).bindTabPresenter(tabPresenter as TabPresenter)
  floatingButtonPresenter = new FloatingButtonPresenter(
    configPresenter,
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
      getDefaultModel: () => configPresenter.getDefaultModel(),
      getDefaultProjectPath: () => configPresenter.getDefaultProjectPath(),
      resolveDeepChatAgentConfig: async (agentId) =>
        await configPresenter.resolveDeepChatAgentConfig(agentId)
    }
  )
  const clearNewAgentSessionSkills = skillPresenter.clearNewAgentSessionSkills
  if (!clearNewAgentSessionSkills) {
    throw new Error('Skill presenter must provide session skill cleanup.')
  }
  sessionDeletion = new SessionDeletion({
    sessions: appSessionService,
    runtime: {
      cleanupSessionBackends: async (sessionId) =>
        await agentManager.cleanupSessionBackends(sessionId)
    },
    state: agentRuntimePresenter,
    permissions: sessionPermissionPort,
    skills: {
      clearNewAgentSessionSkills: async (sessionId) =>
        await clearNewAgentSessionSkills.call(skillPresenter, sessionId)
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
      clearMessages: (sessionId) => agentRuntimePresenter.clearMessages(sessionId),
      prepareRetryMessage: (sessionId, messageId) =>
        agentRuntimePresenter.prepareRetryMessage(sessionId, messageId),
      deleteMessage: (sessionId, messageId) =>
        agentRuntimePresenter.deleteMessage(sessionId, messageId),
      editUserMessage: (sessionId, messageId, text) =>
        agentRuntimePresenter.editUserMessage(sessionId, messageId, text)
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
        agentRuntimePresenter.forkSessionFromMessage(
          sourceSessionId,
          targetSessionId,
          targetMessageId
        )
    },
    skills: {
      setActiveSkills: async (sessionId, activeSkills) => {
        await skillPresenter.setActiveSkills(sessionId, activeSkills)
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
  cronJobs.setRunSessionStarter(
    createCronJobRunSessionStarter({
      lifecycle: sessionLifecycle,
      turn: sessionTurn,
      agentCatalog: configPresenter
    })
  )
  sessionHistorySearch = new SessionHistorySearch(sqlitePresenter, appSessionService)
  agentSessionExportService = new AgentSessionExportService({
    agentManager: agentManager,
    appSessionService,
    transcript: sessionData.transcript,
    configPresenter: configPresenter
  })
  sessionTranslation = new SessionTranslation({
    agentManager: agentManager,
    configPresenter: configPresenter,
    llmProviderPresenter: llmproviderPresenter
  })
  projectPresenter = new ProjectPresenter(sqlitePresenter, devicePresenter, configPresenter)
  remoteControlPresenterImpl = new RemoteControlPresenter({
    configPresenter: configPresenter,
    lifecycle: sessionLifecycle,
    turn: sessionTurn,
    assignment: sessionAssignment,
    projection: sessionQuery,
    desktop: desktopSessionBinding,
    filePresenter: filePresenter,
    agentManager: agentManager,
    windowPresenter: windowPresenter,
    tabPresenter: tabPresenter
  })
  remoteControlPresenter = remoteControlPresenterImpl
  cronJobs.setRemoteDeliveryPort(remoteControlPresenterImpl)

  ;(configPresenter as ConfigPresenter).startRuntime({
    refreshFloatingLanguage: () => floatingButtonPresenter.refreshLanguage(),
    refreshTabLanguage: async () => await (tabPresenter as TabPresenter).refreshLanguage(),
    refreshFloatingTheme: async () => await floatingButtonPresenter.refreshTheme(),
    restartApp: () => devicePresenter.restartApp(),
    applyContentProtection: (enabled) =>
      (windowPresenter as WindowPresenter).applyContentProtection(enabled),
    applyProxyMode: (mode) => {
      proxyConfig.setProxyMode(mode as ProxyMode)
      void proxyConfig.resolveProxy().then((resolved) => {
        if (resolved) (llmproviderPresenter as LLMProviderPresenter).handleProxyResolved()
      })
    },
    applyCustomProxyUrl: (url) => {
      proxyConfig.setCustomProxyUrl(url)
      if (proxyConfig.getProxyMode() === ProxyMode.CUSTOM) void proxyConfig.resolveProxy()
    },
    setFloatingButtonEnabled: (enabled) => floatingButtonPresenter.setEnabled(enabled),
    refreshAcpProviderAgents: async (agentIds) => {
      const provider = llmproviderPresenter.getProviderInstance('acp')
      if (provider) await (provider as AcpProvider).refreshAgents(agentIds)
    },
    replaceProviders: (providers) => llmproviderPresenter.setProviders(providers),
    applyProviderAtomicUpdate: (change) =>
      (llmproviderPresenter as LLMProviderPresenter).handleProviderAtomicUpdate(change),
    applyProviderBatchUpdate: (batchUpdate) =>
      (llmproviderPresenter as LLMProviderPresenter).handleProviderBatchUpdate(batchUpdate),
    testHookCommand: async (hookId) => await hooksNotifications.testHookCommand(hookId)
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

    const providers = configPresenter.getProviders()
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
      const { enableSkills } = configPresenter.getSkillSettings()
      if (!enableSkills) {
        logger.info('SkillPresenter disabled by config')
        return
      }
      await (skillPresenter as SkillPresenter).initialize()
      logger.info('SkillPresenter initialized')
      await skillSyncPresenter.initialize()
    } catch (error) {
      console.error('Failed to initialize SkillPresenter:', error)
    }
  }

  async function initializeSkillSyncScan() {
    try {
      const { enableSkills } = configPresenter.getSkillSettings()
      if (!enableSkills) {
        return
      }
      await skillSyncPresenter.initialize()
      await skillSyncPresenter.scanAndDetectNewDiscoveries()
      logger.info('SkillSyncPresenter background scan completed')
    } catch (error) {
      console.error('Failed to run SkillSyncPresenter background scan:', error)
    }
  }

  async function initializeMcp() {
    try {
      await pluginPresenter.initialize()
    } catch (error) {
      console.error('[PluginHost] Failed to initialize plugins:', error)
    }

    try {
      await mcpPresenter.initialize()
      agentRuntimePresenter.refreshToolRegistry()
      deeplinkPresenter.processPendingMcpInstall()
    } catch (error) {
      console.error('Failed to initialize McpPresenter:', error)
    }
  }

  async function initializeRemoteControl() {
    try {
      await remoteControlPresenterImpl.initialize()
    } catch (error) {
      console.error('RemoteControlPresenter.initialize failed:', error)
    }
  }

  async function initializeIdleProviderWarmup(taskContext: StartupWorkloadTaskContext) {
    const enabledProviders = configPresenter
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

      const providerModels = configPresenter.getProviderModels(providerId)
      const customModels = configPresenter.getCustomModels(providerId)
      configPresenter.getDbProviderModels(providerId)
      configPresenter.getBatchModelStatus(providerId, [
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
    try {
      await runDestroyStep('cronJobs.stop', () => cronJobs.stop())
    } catch (error) {
      console.error('CronJobsService.stop failed during main shutdown:', error)
    }

    try {
      await runDestroyStep('pluginPresenter.shutdown', () => pluginPresenter.shutdown())
    } catch (error) {
      console.error('PluginPresenter.shutdown failed during main shutdown:', error)
    }

    try {
      await runDestroyStep('mcpPresenter.shutdown', () => mcpPresenter.shutdown())
    } catch (error) {
      console.error('McpPresenter.shutdown failed during main shutdown:', error)
    }

    await runDestroyStep('destroyRemoteControl', () => destroyRemoteControl())
    floatingButtonPresenter.destroy()
    tabPresenter.destroy()
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
    await runDestroyStep('memoryPresenter.dispose', () => memoryPresenter.dispose())
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
    await runDestroyStep('acpRuntime.shutdown', () =>
      (llmproviderPresenter as LLMProviderPresenter).shutdownAcpRuntime()
    )
    await runDestroyStep('sqlitePresenter.close', () => sqlitePresenter.close())
    shortcutPresenter.destroy()
    notificationPresenter.clearAllNotifications()
    knowledgePresenter.destroy()
    await runDestroyStep('workspacePresenter.destroy', () =>
      (workspacePresenter as WorkspacePresenter).destroy()
    )
    await runDestroyStep('skillPresenter.destroy', () =>
      (skillPresenter as SkillPresenter).destroy()
    )
    ;(skillSyncPresenter as SkillSyncPresenter).destroy()
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
      await remoteControlPresenterImpl.destroy()
    } catch (error) {
      console.error('RemoteControlPresenter.destroy failed:', error)
    }
  }

  function registerRoutes(): void {
    const routeRuntime = createMainKernelRouteRuntime({
      appDataReset: {
        resetDataByType: (resetType) => resetApplicationData(resetType)
      },
      appDatabaseMaintenance: {
        assertRouteAllowed: (routeName) => assertRouteAllowedDuringDatabaseMaintenance(routeName),
        enableDatabaseEncryption: (password) =>
          runDatabaseMaintenance((database) =>
            databaseSecurityPresenter.enableEncryption({
              password,
              database,
              configPresenter
            })
          ),
        changeDatabasePassword: (currentPassword, newPassword) =>
          runDatabaseMaintenance((database) =>
            databaseSecurityPresenter.changePassword({
              currentPassword,
              newPassword,
              database,
              configPresenter
            })
          ),
        disableDatabaseEncryption: (currentPassword) =>
          runDatabaseMaintenance((database) =>
            databaseSecurityPresenter.disableEncryption({
              currentPassword,
              database,
              configPresenter
            })
          ),
        importFromSync: (backupFileName, importMode) =>
          runDatabaseMaintenance((database) =>
            syncPresenter.importFromSync(
              backupFileName,
              importMode ?? ImportMode.INCREMENT,
              database
            )
          ),
        pullLatestBackupFromCloud: (importMode) => pullLatestBackupFromCloud(importMode)
      },
      configPresenter,
      llmProviderPresenter: llmproviderPresenter,
      acpProviderAdminPort,
      sessionLifecyclePort: sessionLifecycle,
      sessionProjectionPort: sessionQuery,
      desktopSessionBinding,
      sessionTurnPort: sessionTurn,
      sessionAssignmentPort: sessionAssignment,
      sessionPermissionPort,
      skillPresenter,
      skillSyncPresenter,
      exporter,
      oauthPresenter,
      mcpPresenter,
      remoteControlPresenter,
      shortcutPresenter,
      syncPresenter,
      upgradePresenter,
      dialogPresenter,
      toolPresenter,
      sqlitePresenter,
      windowPresenter,
      devicePresenter,
      projectPresenter,
      filePresenter,
      knowledgePresenter,
      workspacePresenter,
      yoBrowserPresenter,
      tabPresenter,
      startupWorkloadCoordinator,
      pluginPresenter,
      databaseSecurityPresenter,
      memoryPresenter,
      cronJobs,
      usageStatsService,
      rtkRuntimeService,
      sessionHistorySearch,
      agentSessionExportService,
      sessionTranslation
    })
    registerMainKernelRoutes(ipcMain, () => routeRuntime)
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
      upgradePresenter.handleAppFocus()
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
    const service = new AcpRegistryMigrationService(configPresenter, sqlitePresenter)
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
            { sqlitePresenter: sessionDataMigrationSQLite, configPresenter, appSessionService },
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
            { sqlitePresenter: sessionDataMigrationSQLite, configPresenter, appSessionService },
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
    memoryPresenter.stopBackgroundMaintenance()

    let operationResult: T | undefined
    let operationError: unknown
    try {
      await cronJobs.stop()
      await remoteControlPresenterImpl.destroy()
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
          configPresenter.setSQLitePresenter(sqlitePresenter)
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
      memoryPresenter.startBackgroundMaintenance()
      cronJobs.start()
      await remoteControlPresenterImpl.initialize()
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
    configPresenter.setSQLitePresenter(sqlitePresenter)
  }

  async function suspendSessionRuntimes(): Promise<void> {
    const results = await Promise.allSettled(
      appSessionService.list({ includeSubagents: true }).map(async (session) => {
        const sessionId = toAppSessionId(session.id)
        await Promise.all([
          agentRuntimePresenter.deepChatRuntime.cleanupSession(sessionId),
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
    const download = await syncPresenter.downloadLatestBackupFromCloud()
    if (!download.success || !download.fileName) return download
    const backupFileName = download.fileName
    const result = await runDatabaseMaintenance((database) =>
      syncPresenter.importFromSync(backupFileName, importMode, database)
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
    handleDeepLink: async (url) => await deeplinkPresenter.handleDeepLink(url),
    clearPermissionCaches: () => {
      commandPermissionService.clearAll()
      filePermissionService.clearAll()
      settingsPermissionService.clearAll()
    },
    confirmShutdown: async () => await knowledgePresenter.beforeDestroy(),
    cancelShutdown: () => windowPresenter.setApplicationQuitting(false),
    hasMainWindows: () => windowPresenter.getAllWindows().length > 0,
    stop
  }

  dependencies.bindControl(control)
  registerRoutes()
  deeplinkPresenter.init()
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
  memoryPresenter.startBackgroundMaintenance()
  scheduleBackgroundWork()
  return control
}
