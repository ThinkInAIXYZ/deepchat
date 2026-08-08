import logger from '@shared/logger'
import { projectEnvironmentsChangedEvent } from '@shared/contracts/events/project.events'
import {
  approvalClosedEvent,
  approvalRequestedEvent,
  liveDelegationChangedEvent,
  sessionsUpdatedEvent
} from '@shared/contracts/events'
import { performance } from 'node:perf_hooks'
import path from 'path'
import { DialogService } from '../desktop/dialog'
import { app, ipcMain } from 'electron'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import { createDeepchatEventEnvelope, type DeepchatEventName } from '@shared/contracts/events'
import { optimizer } from '@electron-toolkit/utils'
import { WindowPresenter } from '../desktop/window'
import { PluginSettingsWindow } from '../desktop/pluginSettingsWindow'
import { ShortcutPresenter } from '../desktop/shortcut'
import type { FileServicePort } from '@shared/types/file'
import type { WorkspaceServicePort } from '@shared/types/workspace'
import type { ToolServicePort } from '@shared/types/tool'
import type { AssistantMessageBlock } from '@shared/types/agent-interface'
import { projectFinalAssistantAnswer } from '@shared/lib/assistantDeliverySegments'
import type { SkillServicePort } from '@shared/types/skill'
import type { SkillSyncServicePort } from '@shared/types/skillSync'
import type { IConversationExporter } from '../exporter/interface'
import type {
  IShortcutPresenter,
  IWindowPresenter,
  IYoBrowserPresenter
} from '@shared/types/desktop'
import type { DialogServicePort } from '@shared/types/dialog'
import type { KnowledgeServicePort } from '@shared/types/knowledge'
import { ProviderRuntime } from '../provider'
import { AgentInvocationAdmission } from '@/agent/invocationAdmission'
import { ProviderImportService } from '../provider/providerImportService'
import { ProviderDatabase } from '../provider/data/database'
import { createProviderRoutes } from '../provider/routes'
import { ProviderSettings } from '../provider/settings'
import type { SettingsStore } from '../config/settingsStore'
import type { SecretStore } from '../config/secretStore'
import { providerDbLoader } from '../provider/providerDbLoader'
import { AcpProvider } from '../provider/providers/acpProvider'
import { proxyConfig, ProxyMode } from '../platform/proxy'
import { DeviceService } from '../device'
import { UpgradeService } from '../upgrade'
import { UpdateSettings } from '../upgrade/settings'
import { FileService } from '../file'
import { RuntimeHelper } from '@/lib/runtimeHelper'
import { AttachmentCapabilityRouter } from '@/ocr/attachmentCapabilityRouter'
import { OcrRuntimeService } from '@/ocr/ocrRuntimeService'
import { OcrSettings } from '@/ocr/ocrSettings'
import { createOcrRoutes } from '@/ocr/routes'
import { McpService } from '../mcp'
import { ImportMode, SyncService, type SyncImportDatabasePort } from '../sync'
import { SyncSettings } from '../sync/settings'
import { DeeplinkService } from '../deeplink'
import { createDeeplinkActions } from '../deeplink/actions'
import { NotificationService } from '../desktop/notification'
import {
  AggregatedWindowNotificationDiagnostics,
  ElectronWindowNotificationTargets,
  WindowNotificationRouter,
  createNotificationRoutes,
  type SemanticNotificationPublisher
} from '../notifications'
import { DesktopSettings } from '../desktop/settings'
import { FontSettings } from '../desktop/fontSettings'
import { TabPresenter } from '../desktop/tab'
import { DesktopSessionBinding } from '@/desktop/sessionBinding'
import { TrayPresenter } from '../desktop/tray'
import { OAuthService } from '../provider/auth'
import { FloatingButtonPresenter } from '../desktop/floatingButton'
import { YoBrowserPresenter } from '../desktop/browser/YoBrowserPresenter'
import { ComputerUsePreviewPresenter } from '@/desktop/computerUse/ComputerUsePreviewPresenter'
import { AgentPreviewCoordinator } from '@/desktop/preview/AgentPreviewCoordinator'
import { KnowledgeService } from '../knowledge'
import { WorkspaceService } from '../workspace'
import { FileWatcherService } from '../platform/fileWatcher'
import { LoggingService } from './logging'
import { RendererPerformanceLogService } from './rendererPerformanceLogService'
import type { PrivacySettings } from './privacy'
import type { ProxySettings } from '@/platform/proxySettings'
import type { McpSettings } from '@/mcp/settings'
import type { McpAppSandboxRegistry } from '@/mcp/apps/sandboxRegistry'
import type { AcpCatalogSettings } from '@/agent/acp/catalog/settings'
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
import { KnowledgeSettings } from '@/knowledge/settings'
import { PromptSettings } from '@/agent/promptSettings'
import { AgentSettings } from '@/agent/settings'
import { AgentLifecycleGate } from '@/agent/lifecycleGate'
import { SessionDeletionGate } from '@/session/deletionGate'
import { emitAcpAgentModelsChanged, emitAgentCatalogChanged } from '@/app/agentEvents'
import { emitModelsChanged } from '@/provider/eventPublishers'
import { createWorkspaceRoutes } from '../workspace/routes'
import { createDeviceRoutes } from '../device/routes'
import { createOnboardingRoutes } from '../onboarding/routes'
import { createUpgradeRoutes } from '../upgrade/routes'
import { createSyncRoutes } from '../sync/routes'
import { createPlatformRoutes } from '../platform/routes'
import { createHookRoutes } from '../hook/routes'
import { createAppSettingsRoutes } from './settingsRoutes'
import { createAppRoutes } from './routes'
import { ApprovalBroker, createApprovalRoutes } from '@/approval'
import {
  CommandPermissionService,
  FilePermissionService,
  SettingsPermissionService,
  ToolPermissionBroker
} from '../tool/permission'
import type { AgentToolDependencies } from '../tool/runtimePorts'

import { ConversationExporterService } from '../exporter'
import { createExporterRoutes } from '../exporter/routes'
import { SkillService } from '../skill'
import type { SkillSessionStatePort } from '../skill'
import { SkillSettings } from '../skill/settings'
import { SkillSyncService } from '../skill/sync'
import { HookService } from '../hook'
import { HookSettings } from '../hook/config'
import { SchedulerService, createCronJobRunSessionStarter } from '../scheduler'
import { AgentManager } from '@/agent/manager/agentManager'
import { createDeepChatAgentBackend } from '@/agent/manager/deepChatAgentBackend'
import { createDirectAcpAgentBackend } from '@/agent/manager/directAcpAgentBackend'
import { AppSessionService } from '@/agent/shared/appSessionService'
import { createSessionData } from '@/session/data'
import { MemoryDatabase } from '@/memory/data/database'
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
import { createDeepChatAgentHarness, type DeepChatAgentHarness } from '@/agent/deepchat/harness'
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
import { ProjectDatabase } from '@/project/data/database'
import { SettingsDatabase } from '@/settings/data/database'
import { SchedulerDatabase } from '@/scheduler/data/database'
import { AppDatabase } from '@/app/data/database'
import { createOrchestrationRoutes } from '@/orchestration/routes'
import { OrchestrationCapabilityResolver } from '@/orchestration/capability'
import { LiveDelegationDatabase } from '@/orchestration/data/database'
import { LiveDelegationRepository } from '@/orchestration/liveDelegationRepository'
import { LiveDelegationService } from '@/orchestration/liveDelegationService'
import { LiveDelegationSafetyCoordinator } from '@/orchestration/liveDelegationSafety'
import { LiveDelegationConsentAuthority } from '@/orchestration/liveDelegationConsent'
import { createProjectRoutes } from '../project/routes'
import { RemoteService } from '../remote'
import type { RemoteServiceLike } from '../remote/ports'
import { PluginService, type PluginServicePort } from '../plugin'
import { createPluginRoutes } from '../plugin/routes'
import { PluginRuntimeSupervisor } from '../plugin/runtimeSupervisor'
import { AgentRepository } from '../agent/repository'
import { AgentDatabase } from '@/agent/data/database'
import { DeepChatDefaults } from '../agent/deepchat/defaults'
import { AgentTraceSettings } from '../agent/traceSettings'
import type { MainDatabase } from '../data/mainDatabase'
import {
  DatabaseSecurityService,
  type DatabaseSecurityMigrationDatabasePort
} from './databaseSecurity'
import {
  normalizeDeepChatSubagentSlots,
  resolveDeepChatSubagentCapability
} from '@shared/lib/deepchatSubagents'
import type {
  AcpAsLlmProviderPermissionPort,
  AcpAsLlmProviderSessionControlPort,
  AcpProviderAdminPort,
  ProviderCatalogPort
} from '../provider/ports'
import type { SessionPermissionPort, SessionUiPort } from '../session/contracts'
import { StartupWorkloadCoordinator } from '../app/startupWorkloadCoordinator'
import type { StartupWorkloadTaskContext } from '../app/startupWorkloadCoordinator'
import { LegacyChatImportService } from './startupMigrations/legacyChatImportService'
import { UsageStatsService } from '../session/usageStatsService'
import type { SessionDataMigrationSQLitePort } from './startupMigrations/sessionDataMigrations'
import { SessionHistorySearch } from '@/session/sessionHistorySearch'
import { SessionTranslation } from '@/session/sessionTranslation'
import { createSessionRoutes } from '@/session/routes'
import { createAgentRoutes } from '@/agent/routes'
import { createPromptRoutes } from '@/agent/promptRoutes'
import { AgentSessionExportService } from '../exporter/agentSessionExporter'
import { createInMemoryServerFactory } from '../mcp/inMemoryServers/builder'
import {
  createRouteDispatcher,
  dispatchDeepchatRoute,
  registerDeepchatRoutes,
  type RouteDispatcher
} from '@/routes'
import { createNodeScheduler } from '@/routes/scheduler'
import { coordinateApplicationDataReset } from './applicationDataReset'
import {
  AgentCliCommandAccess,
  AgentCliTokenAuthority,
  ArtifactSpool,
  CliAudioTranscriptionService,
  CliAuditLog,
  CliComputeService,
  CliLauncherService,
  CliMutationGuard,
  CliOcrService,
  CliRequestPolicy,
  CliRunService,
  CliServer,
  CliSkillService,
  createArtifactRoutes,
  createCliComputeRoutes,
  createCliMcpAdminRoutes,
  createCliProviderModelAdminRoutes,
  createCliRoutes,
  resolveBundledCliDirectory
} from '@/cli'
import { AcpRegistryMigrationService } from '@/agent/acp/catalog/acpRegistryMigrationService'
import { killTerminal } from '@/agent/acp/launch/acpInitHelper'
import { rtkRuntimeService } from '@/agent/shared/process/rtkRuntimeService'
import { backgroundExecSessionManager } from '@/agent/shared/process/backgroundExecSessionManager'
import {
  runBuiltinMcpAllowlistCompatibilityMigration,
  runDisabledAgentToolCapabilityCleanupMigration,
  runMainlineNormalizationMigration
} from './startupMigrations/sessionDataMigrations'
import { activateAppOnMac } from '@/lib/activateApp'
import { SessionRuntimeEvents } from '@/session/runtimeEvents'
import { TypedEventHub } from '@/events/typedEventHub'
import { SessionEventRouter } from '@/events/sessionEventRouter'
import { createMemoryProviderBindings } from './memoryProviderBindings'
import {
  EpisodeRegistry,
  TimeoutNotificationScheduler,
  systemNotificationClock
} from '@shared/notifications'

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
  previousAppVersion?: string
  settingsStore: SettingsStore
  secretStore: SecretStore
  privacySettings: PrivacySettings
  proxySettings: ProxySettings
  mcpSettings: McpSettings
  mcpAppSandboxRegistry: McpAppSandboxRegistry
  acpCatalogSettings: AcpCatalogSettings
  database: MainDatabase
  settingsDatabase: SettingsDatabase
  providerDatabase: ProviderDatabase
  agentDatabase: AgentDatabase
  databaseSecurityService: DatabaseSecurityService
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  startupRunId: string
  requestUpdateInstall: (installAction: () => void) => Promise<void>
  onWindowCreated: (isMainWindow: boolean) => void
  splash: import('./splashWindow').SplashWindow
  bindControl: (control: MainProcessControl) => void
}) {
  const databaseSecurityService = dependencies.databaseSecurityService
  const startupWorkloadCoordinator = dependencies.startupWorkloadCoordinator
  const mainDatabase = dependencies.database
  const liveDelegationRepository = new LiveDelegationRepository(
    new LiveDelegationDatabase(mainDatabase)
  )
  const fileWatcherService = new FileWatcherService()
  let windowPresenter: IWindowPresenter
  let providerSettings: ProviderSettings
  let acpProviderAdminPort: AcpProviderAdminPort
  let exporter: IConversationExporter
  let deviceService: DeviceService
  let upgradeService: UpgradeService
  let shortcutPresenter: IShortcutPresenter
  let fileService: FileServicePort
  let ocrRuntimeService: OcrRuntimeService
  let ocrSettings: OcrSettings
  let mcpService: McpService
  let syncService: SyncService
  let deeplinkService: DeeplinkService
  let notificationService: NotificationService
  let tabPresenter: TabPresenter
  let trayPresenter: TrayPresenter
  let oauthService: OAuthService
  let floatingButtonPresenter: FloatingButtonPresenter
  let knowledgeService: KnowledgeServicePort
  let workspaceService: WorkspaceServicePort
  let toolService: ToolServicePort
  let deepChatAgentHarness: DeepChatAgentHarness
  let yoBrowserPresenter: IYoBrowserPresenter
  let computerUsePreviewPresenter: ComputerUsePreviewPresenter
  let agentPreviewCoordinator: AgentPreviewCoordinator
  let dialogService: DialogServicePort
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
  let approvalBroker: ApprovalBroker
  let toolPermissionBroker: ToolPermissionBroker
  let legacyChatImportService: LegacyChatImportService
  let usageStatsService: UsageStatsService
  let appSessionService: AppSessionService
  let sessionDataMigrationSQLite: SessionDataMigrationSQLitePort
  let sessionHistorySearch: SessionHistorySearch
  let agentSessionExportService: AgentSessionExportService
  let sessionTranslation: SessionTranslation
  let liveDelegationService: LiveDelegationService
  let acpAsLlmProviderSessionControl: AcpAsLlmProviderSessionControlPort
  let acpAsLlmProviderPermission: AcpAsLlmProviderPermissionPort
  let routeDispatcher: RouteDispatcher | undefined
  let cliComputeService: CliComputeService
  let cliAudioTranscriptionService: CliAudioTranscriptionService
  let cliOcrService: CliOcrService
  let cliSkillService: CliSkillService
  let cliMutationGuard: CliMutationGuard
  let cliRequestPolicy: CliRequestPolicy
  let cliRunService: CliRunService
  let hasInitialized = false
  let databaseMaintenanceState: 'running' | 'maintenance' | 'failed' = 'running'
  let appLifecycleState: 'starting' | 'running' | 'stopping' | 'stopped' = 'starting'
  let stopPromise: Promise<void> | null = null
  let pluginInitializationPromise: Promise<void> | null = null
  let skillInitializationPromise: Promise<void> | null = null
  let skillSyncScanPromise: Promise<void> | null = null

  windowPresenter = new WindowPresenter(
    {
      getCloseToQuit: () => dependencies.settingsStore.get<boolean>('closeToQuit') ?? false,
      getContentProtectionEnabled: () =>
        dependencies.settingsStore.get<boolean>('contentProtectionEnabled') ?? false
    },
    () => {
      restartApplication().catch((error) => logger.error('Application restart failed:', error))
    },
    dependencies.onWindowCreated,
    startupWorkloadCoordinator
  )
  // No CLI sessions can exist before AppSessionService is ready, so startup events retain the
  // renderer compatibility path. The installed resolver below fails closed for missing sessions.
  let resolveSessionRunId = (_sessionId: string): string | null | undefined => null
  let resolveBoundRendererIds = (_sessionId: string): readonly number[] => []
  const typedEventHub = new TypedEventHub({
    renderer: {
      broadcast: (envelope) => windowPresenter.sendToAllWindows(DEEPCHAT_EVENT_CHANNEL, envelope),
      send: (webContentsId, envelope) =>
        (windowPresenter as WindowPresenter).sendToWebContents(
          webContentsId,
          DEEPCHAT_EVENT_CHANNEL,
          envelope
        )
    },
    log: logger
  })
  const sessionEventRouter = new SessionEventRouter({
    hub: typedEventHub,
    resolveSessionRunId: (sessionId) => resolveSessionRunId(sessionId),
    getBoundRendererIds: (sessionId) => resolveBoundRendererIds(sessionId)
  })
  const agentCliTokenAuthority = new AgentCliTokenAuthority()
  const artifactSpool = new ArtifactSpool({
    directory: path.join(app.getPath('userData'), 'local-control', 'artifacts'),
    consumeAgentBytes: (tokenId, bytes) => agentCliTokenAuthority.consumeBytes(tokenId, bytes),
    log: logger
  })
  const cliAuditLog = new CliAuditLog({
    directory: path.join(app.getPath('userData'), 'local-control')
  })
  const cliServer = new CliServer({
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion(),
    dispatch: async (method, input, caller, signal) => {
      if (cliAudioTranscriptionService?.handlesRpc(method)) {
        assertRouteAllowedDuringDatabaseMaintenance(method)
        return await cliAudioTranscriptionService.dispatchRpc(method, input, caller, signal)
      }
      if (cliOcrService?.handlesRpc(method)) {
        assertRouteAllowedDuringDatabaseMaintenance(method)
        return await cliOcrService.dispatchRpc(method, input, caller, signal)
      }
      if (!routeDispatcher) throw new Error('CLI route dispatcher is not ready')
      signal.throwIfAborted()
      const output = await dispatchDeepchatRoute(routeDispatcher, method, input, { caller })
      signal.throwIfAborted()
      return output
    },
    dispatchStream: async (method, input, caller, requestId, signal, emit) => {
      if (cliRunService?.handlesStream(method)) {
        assertRouteAllowedDuringDatabaseMaintenance(method)
        return await cliRunService.dispatchStream(method, input, caller, signal, emit)
      }
      if (!cliComputeService) throw new Error('CLI compute service is not ready')
      assertRouteAllowedDuringDatabaseMaintenance(method)
      return await cliComputeService.dispatchStream(method, input, caller, requestId, signal, emit)
    },
    dispatchUpload: async (method, input, upload, caller, signal) => {
      assertRouteAllowedDuringDatabaseMaintenance(method)
      if (cliAudioTranscriptionService?.handlesUpload(method)) {
        return await cliAudioTranscriptionService.dispatchUpload(
          method,
          input,
          upload,
          caller,
          signal
        )
      }
      if (cliOcrService?.handlesUpload(method)) {
        return await cliOcrService.dispatchUpload(method, input, upload, caller, signal)
      }
      if (cliSkillService?.handlesUpload(method)) {
        return await cliSkillService.dispatchUpload(method, input, upload, caller, signal)
      }
      throw new Error(`CLI upload service is not ready for ${method}`)
    },
    authorize: async (input) => {
      if (!cliRequestPolicy) throw new Error('CLI request policy is not ready')
      return await cliRequestPolicy.authorize(input)
    },
    beginAgentRequest: (token) => agentCliTokenAuthority.beginRequest(token),
    artifactSpool,
    log: logger
  })
  const semanticNotificationScheduler = new TimeoutNotificationScheduler()
  const semanticNotificationEpisodes = new EpisodeRegistry(
    systemNotificationClock,
    semanticNotificationScheduler
  )
  let handleSemanticRendererUnavailable = (_webContentsId: number): void => undefined
  let handleApprovalRendererUnavailable = (_webContentsId: number): void => undefined
  const semanticNotificationTargets = new ElectronWindowNotificationTargets(
    windowPresenter,
    () => tabPresenter,
    (webContentsId) => {
      handleSemanticRendererUnavailable(webContentsId)
      handleApprovalRendererUnavailable(webContentsId)
    }
  )
  const semanticNotificationDiagnostics = new AggregatedWindowNotificationDiagnostics({
    scheduler: semanticNotificationScheduler,
    write: (event) => logger.warn('[NotificationRouter] delivery diagnostic', event)
  })
  const semanticNotificationRouter = new WindowNotificationRouter({
    clock: systemNotificationClock,
    scheduler: semanticNotificationScheduler,
    episodes: semanticNotificationEpisodes,
    targets: semanticNotificationTargets,
    diagnostics: semanticNotificationDiagnostics
  })
  handleSemanticRendererUnavailable = (webContentsId) => {
    void semanticNotificationRouter
      .availabilityChanged({ unavailableWebContentsIds: [webContentsId] })
      .catch((error) => {
        logger.warn('[NotificationRouter] renderer invalidation failed', error)
      })
  }
  const semanticNotifications: SemanticNotificationPublisher = {
    occur: (intent) => {
      void semanticNotificationRouter.occur(intent).catch((error) => {
        logger.warn('[NotificationRouter] occurrence failed', error)
      })
    },
    recover: (intent) => {
      void semanticNotificationRouter.recover(intent).catch((error) => {
        logger.warn('[NotificationRouter] recovery failed', error)
      })
    }
  }
  const publishDeepchatEvent = (name: DeepchatEventName, payload: unknown): void => {
    sessionEventRouter.publish(name, payload)
  }
  dependencies.mcpAppSandboxRegistry.setConsentPublisher((windowId, payload) => {
    windowPresenter.sendToWindow(
      windowId,
      DEEPCHAT_EVENT_CHANNEL,
      createDeepchatEventEnvelope('mcp.app.consent.request', payload)
    )
  })
  const unsubscribeStartupWorkload = startupWorkloadCoordinator.subscribe((payload) => {
    publishDeepchatEvent('startup.workload.changed', payload)
  })
  providerSettings = new ProviderSettings(
    dependencies.settingsStore,
    dependencies.privacySettings,
    dependencies.providerDatabase,
    publishDeepchatEvent,
    dependencies.previousAppVersion
  )

  const memoryDatabase = new MemoryDatabase(mainDatabase)
  const sessionData = createSessionData(
    mainDatabase,
    () => memoryDatabase.ingestionProjectionTable,
    {
      publishPendingInputsChanged: (sessionId) =>
        publishDeepchatEvent('sessions.pendingInputs.changed', {
          sessionId,
          version: Date.now()
        }),
      publishMessagesChanged: (sessionId, messages) =>
        publishDeepchatEvent('sessions.messages.changed', {
          sessionId,
          messages,
          version: Date.now()
        })
    }
  )
  const sessionRuntimeEvents = new SessionRuntimeEvents()
  const projectDatabase = new ProjectDatabase(mainDatabase)
  const agentDatabase = dependencies.agentDatabase
  const settingsDatabase = dependencies.settingsDatabase
  const providerDatabase = dependencies.providerDatabase
  const schedulerDatabase = new SchedulerDatabase(mainDatabase)
  const appDatabase = new AppDatabase(mainDatabase)
  const agentRepository = new AgentRepository(agentDatabase, sessionData.database, memoryDatabase)
  const agentLifecycle = new AgentLifecycleGate()
  const sessionDeletionGate = new SessionDeletionGate()
  const promptSettings = new PromptSettings(dependencies.settingsStore, {
    publishCustomPromptsChanged: (prompts) =>
      publishDeepchatEvent('config.customPrompts.changed', {
        prompts,
        version: Date.now()
      }),
    publishSystemPromptsChanged: (state) =>
      publishDeepchatEvent('config.systemPrompts.changed', {
        ...state,
        version: Date.now()
      })
  })
  appSessionService = new AppSessionService(projectDatabase, sessionData.database, () =>
    projectService.notifyEnvironmentProjectionChanged()
  )
  resolveSessionRunId = (sessionId) => {
    const visited = new Set<string>()
    let currentSessionId: string | null = sessionId
    while (currentSessionId && visited.size < 32 && !visited.has(currentSessionId)) {
      visited.add(currentSessionId)
      const session = appSessionService.get(currentSessionId)
      if (!session) return undefined
      if (session.metadata?.source === 'cli_run') return session.id
      currentSessionId = session.parentSessionId ?? null
    }
    return currentSessionId ? undefined : null
  }
  sessionDataMigrationSQLite = {
    get appSettingsTable() {
      return settingsDatabase.appSettingsTable
    },
    getDatabase: () => sessionData.database.getDatabase(),
    get newSessionsTable() {
      return sessionData.database.newSessionsTable
    },
    get newSessionActiveSkillsTable() {
      return sessionData.database.newSessionActiveSkillsTable
    },
    get newSessionDisabledAgentToolsTable() {
      return sessionData.database.newSessionDisabledAgentToolsTable
    },
    get deepchatSearchDocumentsTable() {
      return sessionData.database.deepchatSearchDocumentsTable
    },
    get deepchatUserMessagesTable() {
      return sessionData.database.deepchatUserMessagesTable
    },
    get deepchatUserMessageFilesTable() {
      return sessionData.database.deepchatUserMessageFilesTable
    },
    get deepchatUserMessageLinksTable() {
      return sessionData.database.deepchatUserMessageLinksTable
    },
    get deepchatAssistantBlocksTable() {
      return sessionData.database.deepchatAssistantBlocksTable
    }
  }
  legacyChatImportService = new LegacyChatImportService(
    appDatabase,
    sessionData.database,
    projectDatabase,
    memoryDatabase,
    sessionData.tapeStore,
    undefined,
    () => projectService.notifyEnvironmentProjectionChanged()
  )
  usageStatsService = new UsageStatsService(
    sessionData.database,
    providerSettings,
    dependencies.settingsStore
  )
  const desktopSettings = new DesktopSettings(
    dependencies.settingsStore,
    {
      refreshLanguage: () => {
        floatingButtonPresenter.refreshLanguage()
        void tabPresenter.refreshLanguage()
      },
      refreshTheme: () => floatingButtonPresenter.refreshTheme()
    },
    publishDeepchatEvent
  )
  const fontSettings = new FontSettings(dependencies.settingsStore, publishDeepchatEvent)
  const skillSettings = new SkillSettings(dependencies.settingsStore)
  const traceSettings = new AgentTraceSettings(dependencies.settingsStore)

  const acpSessionPersistence = new AcpSessionPersistence(
    agentDatabase,
    sessionData.database,
    projectDatabase,
    () => projectService.notifyEnvironmentProjectionChanged()
  )
  let providerRuntime!: ProviderRuntime
  oauthService = new OAuthService(
    {
      getProviderById: (providerId) => providerSettings.getProviderById(providerId),
      setProviderById: (providerId, provider) =>
        providerRuntime.setProviderById(providerId, provider)
    },
    publishDeepchatEvent
  )
  const agentSettings = new AgentSettings(
    dependencies.settingsStore,
    agentRepository,
    dependencies.acpCatalogSettings,
    () => dependencies.privacySettings.isEnabled(),
    app.getPath('userData'),
    {
      getModelConfig: (modelId, providerId) => providerSettings.getModelConfig(modelId, providerId),
      setAcpProviderEnabled: (enabled) => {
        const provider = providerSettings.getProviderById('acp')
        if (provider && provider.enable !== enabled) {
          providerRuntime.updateProviderAtomic('acp', { enable: enabled })
        }
      },
      clearAcpProviderModels: () => providerSettings.setProviderModels('acp', []),
      clearAcpProviderModelStatus: () => providerSettings.clearProviderModelStatusCache('acp'),
      refreshAcpProviderAgents: async (agentIds) => {
        const provider = providerRuntime.getProviderInstance('acp')
        if (!(provider instanceof AcpProvider)) {
          throw new Error('ACP provider is not initialized.')
        }
        await provider.refreshAgents(agentIds)
      }
    },
    {
      publishCatalogChanged: (agentIds) =>
        emitAgentCatalogChanged(agentSettings, publishDeepchatEvent, agentIds),
      publishAcpModelsChanged: () => {
        emitModelsChanged(publishDeepchatEvent, 'acp')
        emitAcpAgentModelsChanged(publishDeepchatEvent)
      },
      publishSessionsUpdated: () =>
        publishDeepchatEvent('sessions.updated', {
          sessionIds: [],
          reason: 'list-refreshed'
        })
    },
    (agentId) => memoryService.cleanupDeletedAgentResources(agentId),
    async (agentId) => {
      await ensureSkillServicesInitialized()
      await skillService.cleanupAgentSkills(agentId)
    },
    (agentId) => memoryService.onAgentMemoryMaintenanceConfigChanged(agentId),
    skillSettings,
    agentLifecycle
  )
  const acpRuntimeOwner = createAcpRuntimeOwner({
    providerConfig: providerSettings,
    agentSettings,
    mcpSettings: dependencies.mcpSettings,
    sessionPersistence: acpSessionPersistence,
    publishEvent: publishDeepchatEvent,
    registry: {
      getNpmRegistry: () => mcpService.getNpmRegistry(),
      getUvRegistry: () => mcpService.getUvRegistry()
    }
  })
  providerRuntime = new ProviderRuntime(
    providerSettings,
    desktopSettings,
    agentSettings,
    dependencies.mcpSettings,
    acpRuntimeOwner,
    acpSessionPersistence,
    publishDeepchatEvent
  )
  cliComputeService = new CliComputeService({
    providerSettings,
    providerRuntime,
    artifactSpool,
    mediaCacheDirectory: path.join(app.getPath('userData'), 'images'),
    log: logger
  })
  cliAudioTranscriptionService = new CliAudioTranscriptionService({
    providerSettings,
    providerRuntime,
    artifactSpool,
    log: logger
  })
  const agentDefaults = new DeepChatDefaults({
    settings: dependencies.settingsStore,
    publishSettingChanged: (key, value) =>
      publishDeepchatEvent('settings.changed', {
        changedKeys: [key],
        version: Date.now(),
        values: { [key]: value }
      })
  })
  const unsubscribeProviderDbCatalog = providerDbLoader.subscribeCatalogChanges((change) => {
    if (change.reason === 'updated') {
      providerRuntime.handleProviderDbUpdated()
    }
  })
  acpProviderAdminPort = providerRuntime
  acpAsLlmProviderSessionControl = providerRuntime
  acpAsLlmProviderPermission = providerRuntime
  const commandPermissionHandler = new CommandPermissionService()
  const resolveCliDirectory = () =>
    resolveBundledCliDirectory({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged
    })
  const cliLauncherService = new CliLauncherService({
    homeDirectory: app.getPath('home'),
    userDataDirectory: app.getPath('userData'),
    environmentPath: process.env.PATH,
    shell: process.env.SHELL,
    localAppDataDirectory: process.env.LOCALAPPDATA,
    resolveCliDirectory
  })
  const agentCliCommandAccess = new AgentCliCommandAccess({
    tokenAuthority: agentCliTokenAuthority,
    commandPermission: commandPermissionHandler,
    resolveCliDirectory
  })
  commandPermissionService = commandPermissionHandler
  filePermissionService = new FilePermissionService()
  settingsPermissionService = new SettingsPermissionService()
  approvalBroker = new ApprovalBroker({ log: logger })
  toolPermissionBroker = new ToolPermissionBroker({ approvalBroker })
  cliMutationGuard = new CliMutationGuard(approvalBroker, {
    getTarget: async () => {
      const focused = await semanticNotificationTargets.getFocusedTarget()
      const target =
        focused?.kind === 'main'
          ? focused
          : (await semanticNotificationTargets.getExistingTargets()).find(
              (candidate) => candidate.kind === 'main'
            )
      return target ? { windowId: target.windowId, webContentsId: target.webContentsId } : null
    },
    present: async (target, payload) => {
      const readyTarget = await semanticNotificationTargets.getTargetForWindow(target.windowId)
      if (
        !readyTarget ||
        readyTarget.kind !== 'main' ||
        readyTarget.webContentsId !== target.webContentsId
      ) {
        return false
      }
      windowPresenter.show(target.windowId, true)
      return await semanticNotificationTargets.sendDeepchatEvent(
        readyTarget,
        approvalRequestedEvent.name,
        payload
      )
    },
    close: async (target, payload) => {
      const readyTarget = await semanticNotificationTargets.getTargetByWebContents(
        target.webContentsId
      )
      if (!readyTarget || readyTarget.kind !== 'main' || readyTarget.windowId !== target.windowId) {
        return
      }
      await semanticNotificationTargets.sendDeepchatEvent(
        readyTarget,
        approvalClosedEvent.name,
        payload
      )
    }
  })
  handleApprovalRendererUnavailable = (webContentsId) => {
    cliMutationGuard.cancelRenderer(webContentsId)
  }
  cliRequestPolicy = new CliRequestPolicy({
    mutationGuard: cliMutationGuard,
    audit: (record) => cliAuditLog.record(record)
  })
  const liveDelegationConsent = new LiveDelegationConsentAuthority()
  deviceService = new DeviceService()
  const loggingService = new LoggingService(
    dependencies.settingsStore,
    () => {
      restartApplication().catch((error) => logger.error('Application restart failed:', error))
    },
    publishDeepchatEvent
  )
  const rendererPerformanceLogService = new RendererPerformanceLogService(
    dependencies.settingsStore
  )
  projectService = new ProjectService(
    projectDatabase,
    sessionData.database,
    deviceService,
    dependencies.settingsStore,
    (projectPath, version) =>
      publishDeepchatEvent('config.defaultProjectPath.changed', {
        path: projectPath,
        version
      }),
    (action, environmentPath, version) =>
      publishDeepchatEvent(projectEnvironmentsChangedEvent.name, {
        action,
        path: environmentPath,
        version
      })
  )
  exporter = new ConversationExporterService({
    sqlitePresenter: sessionData.database,
    settings: dependencies.settingsStore
  })
  const updateSettings = new UpdateSettings(dependencies.settingsStore)
  upgradeService = new UpgradeService(
    updateSettings,
    () => dependencies.privacySettings.isEnabled(),
    dependencies.requestUpdateInstall,
    publishDeepchatEvent
  )
  shortcutPresenter = new ShortcutPresenter(desktopSettings, windowPresenter, publishDeepchatEvent)
  fileService = new FileService(dependencies.settingsStore)
  ocrSettings = new OcrSettings(dependencies.settingsStore, publishDeepchatEvent)
  const runtimeHelper = RuntimeHelper.getInstance()
  runtimeHelper.initializeRuntimes()
  ocrRuntimeService = new OcrRuntimeService({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    nodeRuntimePath: runtimeHelper.getNodeRuntimePath(),
    tempBaseDir: app.getPath('temp'),
    userDataDir: app.getPath('userData')
  })
  cliOcrService = new CliOcrService({
    appVersion: app.getVersion(),
    ocrRuntime: ocrRuntimeService,
    artifactSpool,
    log: logger
  })
  const attachmentRouter = new AttachmentCapabilityRouter({
    extraction: ocrRuntimeService,
    getAutomaticOcrEnabled: () => ocrSettings.getAutomaticExtractionEnabled(),
    getBackendPreference: () => ocrSettings.getBackend(),
    getMaxFileSize: () => dependencies.settingsStore.get<number>('maxFileSize') ?? 30 * 1024 * 1024,
    onDiagnostic: (event) => {
      if (traceSettings.isEnabled()) {
        logger.info('[OCR] attachment representation resolved', event)
      }
    }
  })
  const syncSettings = new SyncSettings(
    dependencies.settingsStore,
    dependencies.secretStore,
    publishDeepchatEvent
  )
  const hookSettings = new HookSettings(dependencies.settingsStore)
  const knowledgeSettings = new KnowledgeSettings(
    dependencies.settingsStore,
    dependencies.mcpSettings
  )
  syncService = new SyncService(
    syncSettings,
    mainDatabase,
    settingsDatabase,
    providerDatabase,
    publishDeepchatEvent
  )
  notificationService = new NotificationService(desktopSettings, publishDeepchatEvent)
  trayPresenter = new TrayPresenter(desktopSettings, windowPresenter)
  dialogService = new DialogService(publishDeepchatEvent)
  agentPreviewCoordinator = new AgentPreviewCoordinator()
  yoBrowserPresenter = new YoBrowserPresenter(
    windowPresenter,
    publishDeepchatEvent,
    agentPreviewCoordinator
  )
  computerUsePreviewPresenter = new ComputerUsePreviewPresenter(
    windowPresenter,
    agentPreviewCoordinator
  )

  // Define the storage root for built-in knowledge databases.
  const dbDir = path.join(app.getPath('userData'), 'app_db')
  knowledgeService = new KnowledgeService({
    config: knowledgeSettings,
    storageRoot: dbDir,
    files: fileService,
    dialog: dialogService,
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
  const pluginRuntimeSupervisor = new PluginRuntimeSupervisor()
  mcpService = new McpService(
    providerSettings,
    agentSettings,
    promptSettings,
    dependencies.mcpSettings,
    dependencies.privacySettings,
    createInMemoryServerFactory({
      sqlitePresenter: sessionData.database,
      sessions: appSessionService,
      transcript: sessionData.transcript,
      settings: sessionData.settings,
      locale: desktopSettings,
      promptSettings,
      knowledgeSettings,
      knowledgeService: knowledgeService
    }),
    providerRuntime,
    () => deepChatAgentHarness.refreshToolRegistry(),
    semanticNotifications,
    publishDeepchatEvent,
    (data, options) => deviceService.cacheImage(data, options),
    pluginRuntimeSupervisor,
    computerUsePreviewPresenter,
    {
      registry: dependencies.mcpAppSandboxRegistry,
      permissionBroker: toolPermissionBroker,
      getPermissionMode: async (conversationId) =>
        sessionData.settings.get(conversationId)?.permission_mode ?? 'default',
      validateSource: (input) => {
        const message = sessionData.database.deepchatMessagesTable.get(input.messageId)
        return Boolean(
          message?.session_id === input.conversationId &&
          sessionData.database.deepchatAssistantBlocksTable.matchesMcpAppSource(
            input.messageId,
            input.blockId,
            input.descriptor,
            input.toolInput
          )
        )
      },
      persistModelContext: (messageId, blockId, descriptor, toolInput, context) =>
        sessionData.database.deepchatAssistantBlocksTable.updateMcpAppModelContext(
          messageId,
          blockId,
          descriptor,
          toolInput,
          context
        )
    }
  )
  const deeplinkActions = createDeeplinkActions({
    window: windowPresenter,
    config: providerSettings,
    mcp: mcpService,
    notifications: semanticNotifications
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

  const skillSessionStatePort: SkillSessionStatePort = {
    hasNewSession: async (conversationId) => Boolean(await sessionQuery.getSession(conversationId)),
    getPersistedNewSessionSkills: (conversationId) =>
      sessionData.database.newSessionsTable.getActiveSkills(conversationId),
    setPersistedNewSessionSkills: (conversationId, skills) => {
      sessionData.database.newSessionsTable.updateActiveSkills(conversationId, skills)
      projectDatabase.newEnvironmentsTable.syncForSession(conversationId)
      projectService.notifyEnvironmentProjectionChanged()
    },
    repairImportedLegacySessionSkills: async (conversationId) => {
      return await legacyChatImportService.repairImportedLegacySessionSkills(conversationId)
    }
  }
  skillService = new SkillService(
    skillSettings,
    skillSessionStatePort,
    fileWatcherService,
    publishDeepchatEvent,
    {
      isDeepChatAgent: async (agentId) =>
        (await agentSettings.getAgent(agentId))?.type === 'deepchat',
      listDeepChatAgents: async () =>
        (await agentSettings.listAgents())
          .filter((agent) => agent.type === 'deepchat')
          .map((agent) => ({
            id: agent.id,
            enabledSkillNames: agent.config?.enabledSkillNames,
            protected: agent.protected
          })),
      getSessionAgentId: async (sessionId) =>
        (await sessionQuery.getSession(sessionId))?.agentId ?? null,
      listSessions: async () =>
        (await sessionQuery.listSessions({ includeSubagents: true })).map((session) => ({
          id: session.id,
          agentId: session.agentId
        }))
    }
  )
  cliSkillService = new CliSkillService({
    skills: skillService,
    agentExists: async (agentId) => (await agentSettings.getAgent(agentId))?.type === 'deepchat',
    recordSettingsActivity: (input) => {
      void settingsDatabase.recordSettingsActivity(input).catch((error) => {
        logger.warn('[SettingsActivity] Failed to record CLI Skill activity:', error)
      })
    },
    log: logger
  })

  const agentInvocationAdmission = new AgentInvocationAdmission()
  const agentToolDependencies: AgentToolDependencies = {
    agentInvocationAdmission,
    sessions: {
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

        const agent = await agentSettings.getAgent(session.agentId)
        const agentType = await agentSettings.getAgentType(session.agentId)
        const permissionMode = await sessionAssignment.getPermissionMode(session.id)
        const generationSettings = await sessionAssignment.getSessionGenerationSettings(session.id)
        const disabledAgentTools = await sessionAssignment.getSessionDisabledAgentTools(session.id)
        const activeSkills = await skillService.getActiveSkills(session.id)
        const agentConfig = await agentSettings.resolveDeepChatAgentConfig(session.agentId)
        const availableSubagentSlots = normalizeDeepChatSubagentSlots(agentConfig.subagents)
        const subagentCapability = resolveDeepChatSubagentCapability({
          agentType,
          sessionKind: session.sessionKind,
          agentPolicyEnabled: agentConfig.subagentEnabled === true,
          slots: availableSubagentSlots
        })

        return {
          sessionId: session.id,
          agentId: session.agentId,
          agentName: agent?.name?.trim() || session.agentId,
          agentType,
          providerId: session.providerId,
          modelId: session.modelId,
          projectDir: session.projectDir ?? null,
          permissionMode,
          orchestrationPolicy: session.orchestrationPolicy,
          generationSettings,
          disabledAgentTools,
          activeSkills,
          sessionKind: session.sessionKind,
          parentSessionId: session.parentSessionId ?? null,
          subagentMeta: session.subagentMeta ?? null,
          subagentCapability,
          status: session.status
        }
      }
    },
    tape: {
      searchTape: async (conversationId, query, options) => {
        return await sessionQuery.searchTape(conversationId, query, options)
      },
      getTapeContext: async (conversationId, entryIds, options) => {
        return await sessionQuery.getTapeContext(conversationId, entryIds, options)
      }
    },
    memory: {
      isMemoryEnabled: (agentId) => memoryService.isEnabled(agentId),
      rememberMemory: async (agentId, input, sourceSession, model, beforeMutation) =>
        memoryService.rememberMemory(
          {
            kind: input.kind,
            category: input.category,
            content: input.content,
            importance: input.importance
          },
          { agentId, sourceSession },
          model,
          beforeMutation
        ),
      recallMemory: async (agentId, query, scopeContext) => {
        const items = await memoryService.recall(agentId, query, undefined, scopeContext)
        return items.map((item) => ({
          id: item.id,
          kind: item.kind,
          content: item.content
        }))
      },
      forgetMemory: async (agentId, memoryId, beforeMutation) =>
        await memoryService.forgetMemory(agentId, memoryId, beforeMutation)
    },
    cronJobs: {
      listCronJobs: async () => await cronJobs.list(),
      upsertCronJob: async (input, beforeMutation) =>
        (await cronJobs.upsert(input, beforeMutation)).job,
      deleteCronJob: async (id, beforeMutation) => {
        await cronJobs.delete(id, beforeMutation)
      },
      toggleCronJob: async (id, enabled, beforeMutation) =>
        (await cronJobs.toggle(id, enabled, beforeMutation)).job,
      runCronJobNow: async (id, beforeMutation) => (await cronJobs.runNow(id, beforeMutation)).run,
      listCronJobRuns: async (jobId, limit) => cronJobs.listRuns(jobId, limit),
      previewCronSchedule: async (input) => cronJobs.previewSchedule(input)
    },
    subagents: {
      createSubagentSession: async (input) => {
        const created = await sessionLifecycle.createSubagentSession(input)
        return await agentToolDependencies.sessions.resolveConversationSessionInfo(created.id)
      },
      linkSubagentTape: async (input) => await sessionAssignment.linkSubagentTape(input),
      sendConversationMessage: async (conversationId, content) => {
        await sessionTurn.sendMessage(conversationId, content)
      },
      cancelConversation: async (conversationId) => {
        await sessionTurn.cancelGeneration(conversationId)
      },
      subscribeSessionRuntimeUpdates: (listener) => sessionRuntimeEvents.subscribe(listener)
    },
    liveDelegation: createLivePort(() => liveDelegationService),
    skills: skillService,
    browser: yoBrowserPresenter.toolHandler,
    files: {
      getMimeType: (filePath) => fileService.getMimeType(filePath),
      prepareFileCompletely: (absPath, typeInfo, contentType) =>
        fileService.prepareFileCompletely(absPath, typeInfo, contentType)
    },
    provider: {
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
        providerRuntime.generateImageStandalone(providerId, prompt, modelId, imageOptions, options)
    },
    cacheImage: (data) => deviceService.cacheImage(data),
    desktop: {
      createSettingsWindow: () => windowPresenter.createSettingsWindow(),
      sendToWindow: (windowId, channel, ...args) =>
        windowPresenter.sendToWindow(windowId, channel, ...args),
      sendSettingsNavigation: (windowId, navigation) =>
        windowPresenter.sendSettingsNavigation(windowId, navigation)
    },
    permissions: {
      getApprovedFilePaths: (conversationId, requiredPermission) =>
        filePermissionService.getApprovedPaths(conversationId, requiredPermission),
      consumeSettingsApproval: (conversationId, toolName) =>
        settingsPermissionService.consumeApproval(conversationId, toolName)
    }
  }

  // Initialize the merged MCP and built-in Tool service.
  toolService = new ToolService({
    mcpService: mcpService,
    providerSettings: providerSettings,
    settings: dependencies.settingsStore,
    agentSettings,
    skillSettings,
    desktopSettings,
    commandPermissionHandler,
    commandEnvironment: agentCliCommandAccess,
    permissionBroker: toolPermissionBroker,
    liveDelegationConsent,
    agentTools: agentToolDependencies,
    effectObserver: {
      beforeToolAuthorization: async (observation, signal) => {
        const permissionMode = await liveDelegationService.beforeToolAuthorization(
          observation,
          signal
        )
        return permissionMode ? { permissionMode } : null
      },
      beforeToolExecution: async (observation, signal) => {
        await liveDelegationService.beforeToolExecution(observation, signal)
      }
    }
  })

  // Plugin activation is a shared startup barrier for Skill migration and MCP startup.
  const pluginSettingsWindow = new PluginSettingsWindow()
  pluginService = new PluginService({
    mcpSettings: dependencies.mcpSettings,
    mcpService: mcpService,
    skillService: skillService,
    settingsWindow: pluginSettingsWindow,
    runtimeSupervisor: pluginRuntimeSupervisor
  })

  // Initialize Skill Sync service
  skillSyncService = new SkillSyncService(skillService, skillSettings, publishDeepchatEvent)

  hookService = new HookService(hookSettings, {
    getSession: (sessionId) => sessionQuery.getSession(sessionId)
  })
  const providerCatalogPort: ProviderCatalogPort = {
    getProviderModels: (providerId) => providerSettings.getProviderModels(providerId),
    getCustomModels: (providerId) => providerSettings.getCustomModels(providerId),
    getAgentType: async (agentId) => await agentSettings.getAgentType(agentId)
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
      agentCliTokenAuthority.revokeConversation(sessionId)
      commandPermissionService.clearConversation(sessionId)
      filePermissionService.clearConversation(sessionId)
      settingsPermissionService.clearConversation(sessionId)
      toolPermissionBroker.cancelConversation(sessionId)
    },
    cloneSessionPermissions: (sourceSessionId, targetSessionId) => {
      // Tool approvals are one-time and intentionally never inherited.
      toolPermissionBroker.cancelConversation(targetSessionId)
      commandPermissionService.cloneConversation(sourceSessionId, targetSessionId)
      filePermissionService.cloneConversation(sourceSessionId, targetSessionId)
      settingsPermissionService.cloneConversation(sourceSessionId, targetSessionId)
    },
    approvePermission: async (sessionId, permission) => {
      if (permission.requestId && toolPermissionBroker.approve(permission.requestId, sessionId)) {
        return
      }
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

      // MCP execution uses the one-time request handled above.
    },
    denyPermission: async (sessionId, requestId) => {
      toolPermissionBroker.deny(requestId, sessionId)
    }
  }
  // Initialize agent memory layer (opt-in per agent; vectors stored separately from knowledge base)
  const memoryDbDir = path.join(dbDir, 'AgentMemory')
  MemoryVectorStore.recoverQuarantinedStores(memoryDbDir)
  const memoryVectorDbPaths = (agentId: string) =>
    createMemoryVectorStorePaths(memoryDbDir, agentId)
  memoryService = new MemoryService({
    repository: createLivePort(() => memoryDatabase.agentMemoryTable),
    directiveRepository: createLivePort(() => memoryDatabase.agentMemoryDirectiveTable),
    auditRepository: createLivePort(() => memoryDatabase.agentMemoryAuditTable),
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
    ...createMemoryProviderBindings(providerRuntime),
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
        ...(typeof context?.directiveId === 'string' ? { directiveId: context.directiveId } : {}),
        ...(typeof context?.sessionId === 'string' ? { sessionId: context.sessionId } : {}),
        ...(context?.createdIds?.length ? { createdIds: context.createdIds } : {})
      })
  })
  agentSettings.start()

  // Initialize new agent architecture presenters
  deepChatAgentHarness = createDeepChatAgentHarness({
    providerRuntime,
    providerSettings,
    agentSettings,
    database: sessionData.database,
    sessionData,
    toolService,
    hookObserver: hookService,
    publishEvent: publishDeepchatEvent,
    publishSessionUpdate: (update) => sessionRuntimeEvents.publish(update),
    providerCatalogPort,
    sessionPermissionPort,
    acpAsLlmProviderPermission: acpAsLlmProviderPermission,
    sessionUiPort,
    memoryPort: memoryService,
    getMemoryIngestionProjection: () => memoryDatabase.ingestionProjectionTable,
    cacheImage: (data) => deviceService.cacheImage(data),
    skillService: skillService,
    skillSettings,
    traceSettings,
    promptSettings,
    attachmentRouter,
    interactionContinuationAdmission: {
      resume: async (sessionId, signal) =>
        await liveDelegationService.beforeInteractionContinuation(sessionId, signal),
      suspend: (sessionId) => liveDelegationService.suspendInteractionContinuation(sessionId)
    }
  })
  const sessionTranscriptMutations = new SessionTranscriptMutations({
    transcript: sessionData.transcript,
    settings: sessionData.settings,
    pendingInputs: sessionData.pendingInputs,
    runtime: deepChatAgentHarness,
    runInTransaction: (operation) => sessionData.database.getDatabase().transaction(operation)()
  })
  memoryIngestionObserver = deepChatAgentHarness.memoryIngestionObserver
  acpAgentRuntime = new AcpAgentRuntime(
    acpRuntimeOwner,
    (input) => deepChatAgentHarness.createAcpAgentInstanceDependencies(input),
    sessionData.pendingInputs
  )
  agentManager = new AgentManager(agentRepository, appSessionService, {
    deepchat: createDeepChatAgentBackend({
      port: deepChatAgentHarness,
      runtime: deepChatAgentHarness.deepChatRuntime,
      transcript: sessionData.transcript,
      tape: sessionData.tape
    }),
    acp: createDirectAcpAgentBackend({
      runtime: acpAgentRuntime,
      sessionState: deepChatAgentHarness,
      transcript: sessionData.transcript,
      tape: sessionData.tape,
      deleteDurableSession: async (sessionId) => {
        await acpSessionPersistence.deleteSessions(sessionId)
      },
      resolveInput: async (sessionId, descriptor) => {
        const session = appSessionService.get(sessionId)
        if (!session || resolveAcpAgentAlias(session.agentId) !== descriptor.id) {
          throw new AgentUnavailableError(descriptor.id, 'invalid-config', 'acp')
        }
        const agent = (await agentSettings.getAcpAgents()).find(
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
    messages: createLivePort(() => sessionData.database.deepchatMessagesTable),
    searchResults: createLivePort(() => sessionData.database.deepchatMessageSearchResultsTable),
    traces: createLivePort(() => sessionData.database.deepchatMessageTracesTable),
    titles: providerRuntime,
    agentConfig: {
      getAssistantModel: async (agentId) => {
        const selection = await resolveAssistantModelSelection(
          {
            agentManager: agentManager,
            agentSettings
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
  resolveBoundRendererIds = (sessionId) =>
    desktopSessionBinding.getWebContentsIdsForSession(sessionId)
  tabPresenter = new TabPresenter(windowPresenter, desktopSessionBinding, () =>
    deeplinkService.processStartupUrl()
  )
  ;(windowPresenter as WindowPresenter).bindTabPresenter(tabPresenter)
  floatingButtonPresenter = new FloatingButtonPresenter(
    agentSettings,
    desktopSettings,
    sessionQuery,
    desktopSessionBinding,
    windowPresenter as WindowPresenter,
    tabPresenter
  )
  sessionAssignmentPolicy = new SessionAssignmentPolicy(
    {
      resolveAgent: (agentId) => {
        const descriptor = agentManager.resolveBackend(agentId).descriptor
        return { id: descriptor.id, kind: descriptor.kind }
      }
    },
    {
      getDefaultModel: () => agentSettings.getDefaultModel(),
      getDefaultProjectPath: () => projectService.getDefaultProjectPath(),
      resolveDeepChatAgentConfig: async (agentId) =>
        await agentSettings.resolveDeepChatAgentConfig(agentId)
    }
  )
  const clearNewAgentSessionSkills = skillService.clearNewAgentSessionSkills
  if (!clearNewAgentSessionSkills) {
    throw new Error('Skill presenter must provide session skill cleanup.')
  }
  sessionDeletion = new SessionDeletion({
    sessions: appSessionService,
    gate: sessionDeletionGate,
    orchestration: {
      prepareSessionDeletion: async (sessionId) =>
        await liveDelegationService.prepareSessionDeletion(sessionId)
    },
    runtime: {
      cleanupSessionBackends: async (sessionId) =>
        await agentManager.cleanupSessionBackends(sessionId)
    },
    state: deepChatAgentHarness,
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
      syncPath: (projectDir) => {
        projectDatabase.newEnvironmentsTable.syncPath(projectDir)
        projectService.notifyEnvironmentProjectionChanged()
      }
    },
    acp: acpAsLlmProviderSessionControl,
    agentLifecycle
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
      commitRetryMessage: (sessionId, sourceOrderSeq) =>
        sessionTranscriptMutations.commitRetryMessage(sessionId, sourceOrderSeq),
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
    deletionGate: sessionDeletionGate,
    permissions: sessionPermissionPort,
    agentLifecycle
  })
  cliRunService = new CliRunService({
    lifecycle: sessionLifecycle,
    turn: sessionTurn,
    projection: sessionQuery,
    sessions: appSessionService,
    eventHub: typedEventHub,
    log: logger
  })
  sessionHistorySearch = new SessionHistorySearch(sessionData.database, appSessionService)
  agentSessionExportService = new AgentSessionExportService({
    agentManager: agentManager,
    appSessionService,
    transcript: sessionData.transcript,
    providerSettings: providerSettings
  })
  sessionTranslation = new SessionTranslation({
    agentManager: agentManager,
    agentSettings,
    providerRuntime: providerRuntime
  })
  const orchestrationCapabilityResolver = new OrchestrationCapabilityResolver({
    sessions: agentToolDependencies.sessions,
    agents: agentSettings
  })
  const liveDelegationSafety = new LiveDelegationSafetyCoordinator({
    sessions: agentToolDependencies.sessions,
    assignmentPolicy: sessionAssignmentPolicy,
    assignment: sessionAssignment,
    permissions: sessionPermissionPort,
    executionSnapshots: deepChatAgentHarness
  })
  const createLiveDelegationService = (): LiveDelegationService =>
    new LiveDelegationService({
      repository: liveDelegationRepository,
      admission: agentInvocationAdmission,
      deletionGate: sessionDeletionGate,
      safety: liveDelegationSafety,
      consent: liveDelegationConsent,
      sessions: {
        ...agentToolDependencies.sessions,
        ...agentToolDependencies.subagents,
        findDelegationChild: async (parentSessionId, delegationId) => {
          const matches = appSessionService
            .list({ includeSubagents: true, parentSessionId })
            .filter(
              (session) => session.subagentMeta?.liveDelegation?.delegationId === delegationId
            )
          if (matches.length > 1) {
            throw new Error(`Multiple child Sessions share live delegation ${delegationId}.`)
          }
          return matches[0]
            ? await agentToolDependencies.sessions.resolveConversationSessionInfo(matches[0].id)
            : null
        },
        getAssistantResult: async (sessionId, messageId) => {
          const messages = sessionData.database.deepchatMessagesTable
          const identity = messageId
            ? messages.getAssistantIdentity(messageId)
            : messages.getLatestAssistantIdentity(sessionId)
          if (!identity || identity.session_id !== sessionId) return null

          const resultRows =
            sessionData.database.deepchatAssistantBlocksTable.listResultProjectionByMessageId(
              identity.id
            )
          if (resultRows.length > 0) {
            const answer = projectFinalAssistantAnswer(
              resultRows.map(
                (row): AssistantMessageBlock => ({
                  type: row.block_type,
                  status: row.status,
                  timestamp: row.updated_at,
                  content: row.text_content ?? undefined
                })
              )
            )
            return answer
              ? {
                  messageId: identity.id,
                  answerMarkdown: answer,
                  updatedAt: identity.updated_at
                }
              : null
          }

          const legacyMessage = await sessionQuery.getMessage(identity.id)
          if (!legacyMessage || legacyMessage.sessionId !== sessionId) return null
          try {
            const parsed = JSON.parse(legacyMessage.content) as AssistantMessageBlock[] | string
            const answer = Array.isArray(parsed)
              ? projectFinalAssistantAnswer(parsed)
              : typeof parsed === 'string'
                ? parsed.trim()
                : ''
            return answer
              ? { messageId: identity.id, answerMarkdown: answer, updatedAt: identity.updated_at }
              : null
          } catch {
            const answer = legacyMessage.content.trim()
            return answer
              ? { messageId: identity.id, answerMarkdown: answer, updatedAt: identity.updated_at }
              : null
          }
        }
      },
      onChanged: (parentSessionId, delegationId) => {
        sessionQuery.notify({ sessionIds: [parentSessionId], reason: 'updated' })
        try {
          publishDeepchatEvent(liveDelegationChangedEvent.name, {
            schemaVersion: 1,
            parentSessionId,
            delegation: liveDelegationService.getSummary(parentSessionId, delegationId)
          })
        } catch (error) {
          logger.warn('[LiveDelegationService] Failed to publish delegation projection', { error })
        }
      }
    })
  liveDelegationService = createLiveDelegationService()
  remoteService = new RemoteService({
    settings: dependencies.settingsStore,
    catalog: {
      getAgentType: (agentId) => agentSettings.getAgentType(agentId),
      listAgents: async () =>
        (await agentSettings.listAgents())
          .filter((agent) => agent.enabled !== false)
          .map((agent) => ({
            agentId: agent.id,
            agentName: agent.name || agent.id,
            agentType: agent.type,
            source: agent.source
          })),
      listModelProviders: async () => {
        const enabledProviders = providerSettings.getEnabledProviders()
        const enabledModelGroups = await providerSettings.getAllEnabledModels()
        const providerNameById = new Map(
          enabledProviders.map((provider) => [provider.id, provider.name])
        )
        return enabledModelGroups
          .filter((group) => providerNameById.has(group.providerId) && group.models.length > 0)
          .map((group) => ({
            providerId: group.providerId,
            providerName: providerNameById.get(group.providerId) ?? group.providerId,
            models: group.models.map((model) => ({
              modelId: model.id,
              modelName: model.name || model.id
            }))
          }))
      }
    },
    workspace: {
      getDefaultProjectPath: () => projectService.getDefaultProjectPath(),
      prepareFile: (filePath, type) => fileService.prepareFile(filePath, type)
    },
    lifecycle: sessionLifecycle,
    turn: {
      sendMessage: (...args) => sessionTurn.sendMessage(...args),
      respondToolInteraction: (...args) => sessionTurn.respondToolInteraction(...args),
      cancelGeneration: (sessionId) => sessionTurn.cancelGeneration(sessionId)
    },
    assignment: sessionAssignment,
    projection: sessionQuery,
    desktop: {
      openSession: (sessionId) => openRemoteSession(sessionId)
    },
    notifications: {
      showNotification: (options) => notificationService.showNotification(options)
    }
  })
  cronJobs = new SchedulerService({
    database: schedulerDatabase,
    agentSettings,
    sessionEvents: sessionRuntimeEvents,
    runSessionStarter: createCronJobRunSessionStarter({
      lifecycle: sessionLifecycle,
      turn: sessionTurn,
      agentCatalog: agentSettings
    }),
    remoteDeliveryPort: remoteService
  })

  desktopSettings.initializeTheme()

  function setupTray() {
    console.info('setupTray', !!trayPresenter)
    trayPresenter.init()
  }

  function init(mainRunId: string) {
    if (hasInitialized) {
      console.info('[Startup][Main] Main startup skipped because startup already ran')
      return
    }

    liveDelegationService.start()
    hasInitialized = true

    const providers = providerSettings.getProviders()
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
      id: 'main:skills-sync-scan',
      target: 'main',
      phase: 'background',
      resource: 'cpu',
      labelKey: 'startup.main.skillsSyncScan',
      runId: mainRunId,
      run: async (taskContext) => {
        await taskContext.yield()
        await initializeSkillSyncScan(taskContext.signal)
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

  async function initializeSkills(): Promise<void> {
    if (!skillSettings.isEnabled()) {
      logger.info('SkillService disabled by config')
      return
    }
    await ensureSkillServicesInitialized()
  }

  async function ensureSkillServicesInitialized(): Promise<void> {
    if (appLifecycleState === 'stopping' || appLifecycleState === 'stopped') {
      throw new Error(`Cannot initialize Skill services while app is ${appLifecycleState}`)
    }
    if (!skillInitializationPromise) {
      const initialization = (async () => {
        await initializePlugins()
        await skillService.initialize()
        logger.info('SkillService initialized')
        await skillSyncService.initialize()
      })()
      skillInitializationPromise = initialization
      void initialization.catch(() => {
        if (skillInitializationPromise === initialization) {
          skillInitializationPromise = null
        }
      })
    }
    await skillInitializationPromise
  }

  async function initializePlugins(): Promise<void> {
    if (!pluginInitializationPromise) {
      const initialization = pluginService.initialize()
      pluginInitializationPromise = initialization
      void initialization.catch(() => {
        if (pluginInitializationPromise === initialization) {
          pluginInitializationPromise = null
        }
      })
    }
    await pluginInitializationPromise
  }

  async function initializeSkillSyncScan(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || appLifecycleState === 'stopping' || appLifecycleState === 'stopped') {
      return
    }
    if (!skillSyncScanPromise) {
      const scan = (async () => {
        try {
          if (!skillSettings.isEnabled() || signal?.aborted) return
          await ensureSkillServicesInitialized()
          if (signal?.aborted) return
          await skillSyncService.scanAndDetectNewDiscoveries()
          logger.info('SkillSyncService background scan completed')
        } catch (error) {
          console.error('Failed to run SkillSyncService background scan:', error)
        }
      })()
      skillSyncScanPromise = scan
      void scan.finally(() => {
        if (skillSyncScanPromise === scan) {
          skillSyncScanPromise = null
        }
      })
    }
    await skillSyncScanPromise
  }

  async function initializeMcp() {
    try {
      await initializePlugins()
    } catch (error) {
      console.error('[PluginHost] Failed to initialize plugins:', error)
    }

    try {
      await mcpService.initialize()
      try {
        await pluginRuntimeSupervisor.reconcileAll()
      } catch (error) {
        console.error('[PluginHost] Failed to reconcile eager plugin runtimes:', error)
      }
      deepChatAgentHarness.refreshToolRegistry()
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
    const enabledProviders = providerSettings
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

      const providerModels = providerSettings.getProviderModels(providerId)
      const customModels = providerSettings.getCustomModels(providerId)
      providerSettings.getDbProviderModels(providerId)
      providerSettings.getBatchModelStatus(providerId, [
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
    await runDestroyStep('agentCliTokenAuthority.clear', () => agentCliTokenAuthority.clear())
    await runDestroyStep('cliServer.stop', () => cliServer.stop())
    await runDestroyStep('typedEventHub.close', () => typedEventHub.close())
    await runDestroyStep('cliMutationGuard.clear', () => cliMutationGuard.clear())
    await runDestroyStep('cliAuditLog.close', () => cliAuditLog.close())
    await runDestroyStep('artifactSpool.close', () => artifactSpool.close())
    await runDestroyStep('providerCatalog.unsubscribe', () => unsubscribeProviderDbCatalog())
    await runDestroyStep('liveDelegationService.stop', () => liveDelegationService.stop())
    await runDestroyStep('cronJobs.destroy', () => cronJobs.destroy())
    await runDestroyStep('remoteService.destroy', () => remoteService.destroy())
    await runDestroyStep('hookService.stop', () => hookService.stop())
    await runDestroyStep('sessionRuntimes.suspend', () => suspendSessionRuntimes())
    const pendingSkillInitialization = skillInitializationPromise
    if (pendingSkillInitialization) {
      await runDestroyStep('skillInitialization.drain', async () => {
        await pendingSkillInitialization
      })
    }
    const pendingPluginInitialization = pluginInitializationPromise
    if (pendingPluginInitialization) {
      await runDestroyStep('pluginInitialization.drain', async () => {
        await pendingPluginInitialization
      })
    }
    const pendingSkillSyncScan = skillSyncScanPromise
    if (pendingSkillSyncScan) {
      await runDestroyStep('skillSyncScan.drain', async () => {
        await pendingSkillSyncScan
      })
    }
    await runDestroyStep('pluginService.shutdown', () => pluginService.shutdown())
    await runDestroyStep('mcpApps.clear', () => dependencies.mcpAppSandboxRegistry.clear())
    await runDestroyStep('mcpService.shutdown', () => mcpService.shutdown())
    await runDestroyStep('semanticNotificationRouter.dispose', () =>
      semanticNotificationRouter.dispose()
    )
    await runDestroyStep('semanticNotificationTargets.dispose', () =>
      semanticNotificationTargets.dispose()
    )
    await runDestroyStep('semanticNotificationEpisodes.dispose', () =>
      semanticNotificationEpisodes.dispose()
    )
    await runDestroyStep('semanticNotificationDiagnostics.dispose', () =>
      semanticNotificationDiagnostics.dispose()
    )
    await runDestroyStep('computerUsePreviewPresenter.shutdown', () =>
      computerUsePreviewPresenter.shutdown()
    )
    await runDestroyStep('yoBrowserPresenter.shutdown', () => yoBrowserPresenter.shutdown())
    await runDestroyStep('agentPreviewCoordinator.shutdown', () =>
      agentPreviewCoordinator.shutdown()
    )
    await runDestroyStep('floatingButtonPresenter.destroy', () => floatingButtonPresenter.destroy())
    await runDestroyStep('windowPresenter.destroyFloatingChatWindow', () =>
      windowPresenter.destroyFloatingChatWindow()
    )
    await runDestroyStep('tabPresenter.destroy', () => tabPresenter.destroy())
    await runDestroyStep('windowPresenter.destroyWindows', () => {
      windowPresenter.closeSettingsWindow()
      for (const window of windowPresenter.getAllWindows()) {
        if (!window.isDestroyed()) window.destroy()
      }
    })
    await runDestroyStep('workspaceService.destroy', () => workspaceService.destroy())
    await runDestroyStep('skillSyncService.destroy', () => skillSyncService.destroy())
    await runDestroyStep('skillService.destroy', () => skillService.destroy())
    await runDestroyStep('fileWatcherService.destroy', () => fileWatcherService.destroy())
    await runDestroyStep('backgroundExecSessionManager.shutdown', () =>
      backgroundExecSessionManager.shutdown()
    )
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
    await runDestroyStep('ocrRuntimeService.close', () => ocrRuntimeService.close())
    await runDestroyStep('providerRuntime.shutdown', () => providerRuntime.shutdown())
    await runDestroyStep('acpRuntime.shutdown', () => acpRuntimeOwner.shutdown())
    await runDestroyStep('mainDatabase.close', () => mainDatabase.close())
    await runDestroyStep('shortcutPresenter.destroy', () => shortcutPresenter.destroy())
    await runDestroyStep('notificationService.clearAllNotifications', () =>
      notificationService.clearAllNotifications()
    )
    await runDestroyStep('trayPresenter.destroy', () => trayPresenter.destroy())
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

  function registerRoutes(): void {
    const providerQueryScheduler = createNodeScheduler()
    const providerRoutes = createProviderRoutes({
      providerSettings,
      providerRuntime,
      acpProviderAdminPort,
      providerImportService: new ProviderImportService({
        getProviders: () => providerSettings.getProviders(),
        getDefaultProviders: () => providerSettings.getDefaultProviders(),
        addCustomModel: (providerId, model) => providerSettings.addCustomModel(providerId, model),
        updateProvidersBatch: (batchUpdate) => providerRuntime.updateProvidersBatch(batchUpdate)
      }),
      oauthService,
      scheduler: providerQueryScheduler,
      recordSettingsActivity: (input) => settingsDatabase.recordSettingsActivity(input)
    })
    const toolRoutes = createToolRoutes(toolService)
    const pluginRoutes = createPluginRoutes(pluginService)
    const skillRoutes = createSkillRoutes({
      skillService,
      skillSyncService,
      skillSettings,
      agentSettings,
      ensureInitialized: ensureSkillServicesInitialized,
      recordSettingsActivity: (input) => settingsDatabase.recordSettingsActivity(input)
    })
    const mcpRoutes = createMcpRoutes({
      mcpService,
      mcpAppHost: (() => {
        if (!mcpService.appHost) {
          throw new Error('MCP Apps host is not configured')
        }
        return mcpService.appHost
      })(),
      isSettingsWindow: (windowId) =>
        windowId != null && windowPresenter.getSettingsWindowId() === windowId,
      recordSettingsActivity: (input) => settingsDatabase.recordSettingsActivity(input)
    })
    const remoteRoutes = createRemoteRoutes(remoteService)
    const schedulerRoutes = createSchedulerRoutes(cronJobs)
    const memoryRoutes = createMemoryRoutes({
      memoryService,
      getAgentType: (agentId) => agentSettings.getAgentType(agentId),
      getTapeInspection: () => sessionData.tapeStore,
      getAuditEntries: () => memoryDatabase.agentMemoryAuditTable
    })
    const desktopRoutes = createDesktopRoutes({
      windowPresenter,
      shortcutPresenter,
      browserPresenter: yoBrowserPresenter,
      computerUsePreviewPresenter,
      desktopSessionBinding,
      tabPresenter,
      dialogService,
      settings: desktopSettings,
      setFloatingButtonEnabled: (enabled) => floatingButtonPresenter.setEnabled(enabled),
      recordActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      }
    })
    const fileRoutes = createFileRoutes(fileService)
    const ocrRoutes = createOcrRoutes({ runtime: ocrRuntimeService })
    const knowledgeRoutes = createKnowledgeRoutes({
      service: knowledgeService,
      settings: knowledgeSettings,
      applyConfigChange: async () => {
        mcpService.handleConfigChanged()
        await knowledgeService.syncConfigChanges()
      },
      recordActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      }
    })
    const workspaceRoutes = createWorkspaceRoutes(workspaceService)
    const orchestrationRoutes = createOrchestrationRoutes({
      resolveCapability: (target) =>
        'sessionId' in target
          ? orchestrationCapabilityResolver.resolveSession(target.sessionId)
          : orchestrationCapabilityResolver.resolveDraft(target.agentId),
      getPolicy: (sessionId) => sessionAssignment.getOrchestrationPolicy(sessionId),
      setPolicy: (sessionId, policy) =>
        sessionAssignment.updateOrchestrationPolicy(sessionId, policy),
      liveDelegations: createLivePort(() => liveDelegationService)
    })
    const projectRoutes = createProjectRoutes({
      projectService,
      publishEnvironmentsChanged: (action, environmentPath, version) => {
        publishDeepchatEvent(projectEnvironmentsChangedEvent.name, {
          action,
          path: environmentPath,
          version
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
      agentSettings,
      scheduler: createNodeScheduler(),
      historySearch: sessionHistorySearch,
      exportService: agentSessionExportService,
      translation: sessionTranslation,
      usageStats: usageStatsService,
      rtkRuntime: rtkRuntimeService
    })
    const agentRoutes = createAgentRoutes({
      agentSettings,
      recordActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      },
      reconcileScheduler: async () => {
        await cronJobs.reconcileScheduler('agent-change')
      }
    })
    const promptRoutes = createPromptRoutes({
      settings: promptSettings,
      recordActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      }
    })
    const acpRoutes = createAcpRoutes()
    const deviceRoutes = createDeviceRoutes({
      device: deviceService,
      restartApplication,
      resetDataByType: (resetType) => resetApplicationData(resetType)
    })
    const onboardingRoutes = createOnboardingRoutes(dependencies.settingsStore)
    const upgradeRoutes = createUpgradeRoutes({ upgrade: upgradeService, settings: updateSettings })
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
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      }
    })
    const platformRoutes = createPlatformRoutes({
      proxySettings: dependencies.proxySettings,
      applyProxyMode: (mode) => {
        proxyConfig.setProxyMode(mode as ProxyMode)
        void proxyConfig.resolveProxy().then((resolved) => {
          if (resolved) (providerRuntime as ProviderRuntime).handleProxyResolved()
        })
      },
      applyCustomProxyUrl: (url) => {
        proxyConfig.setCustomProxyUrl(url)
        if (proxyConfig.getProxyMode() === ProxyMode.CUSTOM) void proxyConfig.resolveProxy()
      }
    })
    const hookRoutes = createHookRoutes({ service: hookService })
    const notificationRoutes = createNotificationRoutes({
      rendererReady: async (webContentsId) => {
        const ready = await semanticNotificationTargets.markRendererReady(webContentsId)
        if (ready) {
          await semanticNotificationRouter.availabilityChanged()
        }
        return ready
      },
      acknowledgePresentation: (episodeId, webContentsId) =>
        semanticNotificationRouter.acknowledgePresentation(episodeId, { webContentsId })
    })
    const appSettingsRoutes = createAppSettingsRoutes({
      settings: dependencies.settingsStore,
      agentDefaults,
      privacy: dependencies.privacySettings,
      traceSettings,
      desktopSettings,
      fonts: fontSettings,
      applyContentProtection: (enabled) =>
        (windowPresenter as WindowPresenter).applyContentProtection(enabled),
      logging: loggingService,
      ocr: ocrSettings,
      recordActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      },
      listActivities: (limit) => settingsDatabase.listSettingsActivity(limit)
    })
    const appRoutes = createAppRoutes({
      logging: loggingService,
      rendererPerformance: rendererPerformanceLogService,
      isMainWindowContext: (caller) =>
        windowPresenter.mainWindow?.webContents.id === caller.webContentsId,
      agentSettings,
      projects: projectService,
      databaseSecurity: databaseSecurityService,
      database: mainDatabase,
      startupSession: sessionQuery,
      desktopSession: desktopSessionBinding,
      startup: startupWorkloadCoordinator,
      ensureDefaultWorkspace: () => projectService.ensureDefaultWorkspace(),
      enableDatabaseEncryption: (password) =>
        runDatabaseMaintenance((database) =>
          databaseSecurityService.enableEncryption({ password, database, providerSettings })
        ),
      changeDatabasePassword: (currentPassword, newPassword) =>
        runDatabaseMaintenance((database) =>
          databaseSecurityService.changePassword({
            currentPassword,
            newPassword,
            database,
            providerSettings
          })
        ),
      disableDatabaseEncryption: (currentPassword) =>
        runDatabaseMaintenance((database) =>
          databaseSecurityService.disableEncryption({
            currentPassword,
            database,
            providerSettings
          })
        ),
      recordActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      },
      publishSessionsUpdated: (sessionIds) => {
        publishDeepchatEvent(sessionsUpdatedEvent.name, { sessionIds, reason: 'created' })
      },
      splash: dependencies.splash
    })
    const cliRoutes = createCliRoutes({
      appVersion: app.getVersion(),
      getStatus: () => cliServer.getStatus(),
      hasTrustedRenderer: async () =>
        (await semanticNotificationTargets.getExistingTargets()).some(
          (target) => target.kind === 'main'
        )
    })
    const approvalRoutes = createApprovalRoutes({
      resolve: (input, caller) => cliMutationGuard.resolve(input, caller)
    })
    const artifactRoutes = createArtifactRoutes(artifactSpool)
    const cliComputeRoutes = createCliComputeRoutes(cliComputeService)
    const cliProviderModelAdminRoutes = createCliProviderModelAdminRoutes({
      providerSettings,
      providerRuntime,
      scheduler: providerQueryScheduler,
      recordSettingsActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record CLI provider activity:', error)
        })
      }
    })
    const cliSkillRoutes = cliSkillService.createRoutes()
    const cliMcpAdminRoutes = createCliMcpAdminRoutes({
      mcp: mcpService,
      recordSettingsActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record CLI MCP activity:', error)
        })
      },
      log: logger
    })
    const cliRunRoutes = cliRunService.createRoutes()
    routeDispatcher = createRouteDispatcher({
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
        ocrRoutes,
        knowledgeRoutes,
        workspaceRoutes,
        orchestrationRoutes,
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
        notificationRoutes,
        appSettingsRoutes,
        appRoutes,
        approvalRoutes,
        cliRoutes,
        artifactRoutes,
        cliComputeRoutes,
        cliProviderModelAdminRoutes,
        cliSkillRoutes,
        cliMcpAdminRoutes,
        cliRunRoutes
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
      if (appLifecycleState !== 'running') return
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
      if (appLifecycleState === 'stopping' || appLifecycleState === 'stopped') return
      shortcutPresenter.registerShortcuts()
      upgradeService.handleAppFocus()
      void semanticNotificationRouter.availabilityChanged().catch((error) => {
        logger.warn('[NotificationRouter] focus reconciliation failed', error)
      })
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
    const service = new AcpRegistryMigrationService(
      dependencies.settingsStore,
      agentSettings,
      agentDatabase
    )
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
            { sqlitePresenter: sessionDataMigrationSQLite },
            taskContext
          )
      },
      'Failed to start normalization backfill:'
    )

    schedule(
      {
        id: 'main:disabled-agent-tool-capability-cleanup',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.disabledSearchToolCleanup',
        run: async (taskContext) =>
          runDisabledAgentToolCapabilityCleanupMigration(
            {
              sqlitePresenter: sessionDataMigrationSQLite,
              agentSettings
            },
            taskContext
          )
      },
      'Failed to start disabled agent tool capability cleanup:'
    )
  }

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise

    appLifecycleState = 'stopping'
    stopPromise = (async () => {
      windowPresenter.setApplicationQuitting(true)
      startupWorkloadCoordinator.cancelTarget('main')
      await runDestroyStep('acpInitTerminal.kill', () => killTerminal())
      try {
        await destroy()
      } finally {
        unsubscribeStartupWorkload()
        appLifecycleState = 'stopped'
      }
    })()
    return stopPromise
  }

  function assertRouteAllowedDuringDatabaseMaintenance(routeName: string): void {
    if (appLifecycleState === 'stopping' || appLifecycleState === 'stopped') {
      throw new Error(`App lifecycle is ${appLifecycleState}`)
    }
    if (databaseMaintenanceState === 'running') return
    if (
      routeName.startsWith('chat.') ||
      routeName.startsWith('sessions.') ||
      routeName.startsWith('orchestration.') ||
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
      await liveDelegationService.stop()
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
        getDatabasePath: () => mainDatabase.getDatabasePath(),
        checkpointAndClose: () => {
          const database = mainDatabase.getDatabase()
          if (database.open) {
            database.pragma('wal_checkpoint(TRUNCATE)')
          }
          mainDatabase.close()
        },
        close: () => mainDatabase.close(),
        reopen: () => reopenApplicationDatabase(),
        reopenWithPassword: (password) => {
          mainDatabase.reopenWithPassword(password)
        },
        isOpen: () => mainDatabase.getDatabase().open,
        importLegacyChatDb: (sourceDbPath, mode) =>
          legacyChatImportService.importFromSourceDb(sourceDbPath, mode)
      })
    } catch (error) {
      operationError = error
    }

    try {
      if (!mainDatabase.getDatabase().open) {
        reopenApplicationDatabase()
      }
      memoryIngestionObserver.resumeIngestion()
      memoryService.startBackgroundMaintenance()
      hookService.start()
      cronJobs.start()
      await remoteService.initialize()
      liveDelegationService = createLiveDelegationService()
      liveDelegationService.start()
      startupWorkloadCoordinator.createRun('main')
      scheduleBackgroundWork()
      databaseMaintenanceState = 'running'
    } catch (error) {
      databaseMaintenanceState = 'failed'
      await stop()
      throw error
    }

    if (operationError) throw operationError
    return operationResult as T
  }

  function reopenApplicationDatabase(): void {
    mainDatabase.reopen()
  }

  async function suspendSessionRuntimes(): Promise<void> {
    const results = await Promise.allSettled(
      appSessionService.list({ includeSubagents: true }).map(async (session) => {
        const sessionId = toAppSessionId(session.id)
        await Promise.all([
          deepChatAgentHarness.cleanupSession(sessionId),
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
    await coordinateApplicationDataReset(resetType, {
      cliLauncher: cliLauncherService,
      logger,
      stop,
      resetDataByType: (type) => deviceService.resetDataByType(type)
    })
  }

  async function restartApplication(): Promise<void> {
    await stop()
    await deviceService.restartApp()
  }

  async function openRemoteSession(sessionId: string): Promise<boolean> {
    const chatWindows = windowPresenter
      .getAllWindows()
      .filter((window) => tabPresenter.getWindowType(window.id) === 'chat')
    const focusedWindow = windowPresenter.getFocusedWindow()
    const targetWindow =
      focusedWindow && chatWindows.some((window) => window.id === focusedWindow.id)
        ? focusedWindow
        : chatWindows[0]

    if (targetWindow) {
      await desktopSessionBinding.activate(targetWindow.webContents.id, sessionId)
      windowPresenter.show(targetWindow.id, true)
      return true
    }

    const createdWindowId = await windowPresenter.createAppWindow({ initialRoute: 'chat' })
    const createdWindow = windowPresenter
      .getAllWindows()
      .find((window) => window.id === createdWindowId)
    if (!createdWindow) return false

    await desktopSessionBinding.activate(createdWindow.webContents.id, sessionId)
    windowPresenter.show(createdWindow.id, true)
    return true
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
      approvalBroker.clear()
      dependencies.mcpAppSandboxRegistry.clear()
    },
    confirmShutdown: async () => await knowledgeService.confirmShutdown(),
    cancelShutdown: () => windowPresenter.setApplicationQuitting(false),
    hasMainWindows: () => windowPresenter.getAllWindows().length > 0,
    stop
  }

  dependencies.bindControl(control)
  registerRoutes()
  deeplinkService.init()
  setupApplicationListeners()
  await runAcpRegistryMigration()
  await runBuiltinMcpAllowlistCompatibilityMigration({
    sqlitePresenter: sessionDataMigrationSQLite,
    agentSettings
  })
  // Migration must finish before any renderer or background runtime can read a manual Agent scope.
  // A failed migration is startup-fatal; continuing would persist an empty active-Skill selection.
  await initializeSkills()
  await agentSettings.retryPendingDeletedAgentSkillCleanup()

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
  appLifecycleState = 'running'
  try {
    await artifactSpool.initialize()
    await cliServer.start()
  } catch (error) {
    logger.error('[CLI] Failed to start local control server', error)
  }
  if (cliServer.getStatus().running) {
    try {
      await cliLauncherService.ensureInstalled()
    } catch (error) {
      logger.warn('[CLI] Failed to install or refresh the command launcher', error)
    }
  }
  init(dependencies.startupRunId)
  scheduleBackgroundWork()
  return control
}
