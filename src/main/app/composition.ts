import { createCoreRuntime } from '../../harness/core/runtime'
import { WorkspaceService } from '../workspace'
import { FileWatcherService } from '../platform/fileWatcher'
import { createCoreProviders } from '../../harness/core/providers'
import { createCoreData } from '../../harness/core/data'
import { createLivePort } from '../../harness/core/execution'
import { randomUUID } from 'node:crypto'
import { SyncReplicaStore } from '@/sync/replica/store'

import { AutomaticSync } from '@/sync/replica/automatic'
import { SyncPeerService } from '../sync/peer'
import { createSyncPeerRoutes } from '../sync/peer/routes'

import logger from '@shared/logger'
import {
  mainLogger,
  reportMainStartupComponentFailure,
  reportNativeMainError,
  setMainLoggingEnabled
} from '@/logging'
import {
  classifyMainLogError,
  normalizeMainLogRunStopReason,
  type MainLogRunStopReason,
  type MainLogShutdownReason,
  type MainLogStartupComponent,
  type MainLogStartupComponentFailureCategory,
  type SafeLogError
} from '@/logging/mainLogEvents'
import { projectEnvironmentsChangedEvent } from '@shared/contracts/events/project.events'
import {
  approvalClosedEvent,
  approvalRequestedEvent,
  settingsChangedEvent,
  sessionsTapeInspectorHeadChangedEvent,
  sessionsUpdatedEvent
} from '@shared/contracts/events'
import path from 'path'
import { pathToFileURL } from 'node:url'
import { DialogService } from '../desktop/dialog'
import {
  safeStorage,
  shell,
  app,
  ipcMain,
  powerMonitor,
  nativeTheme,
  nativeImage,
  net,
  webContents as electronWebContents
} from 'electron'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import { createDeepchatEventEnvelope, type DeepchatEventName } from '@shared/contracts/events'
import { optimizer } from '@electron-toolkit/utils'
import { WindowPresenter } from '../desktop/window'
import { PluginSettingsWindow } from '../desktop/pluginSettingsWindow'
import { ShortcutPresenter } from '../desktop/shortcut'
import type { FileServicePort } from '@shared/types/file'
import type { ToolchainKind } from '@shared/types/toolchains'
import type { WorkspaceServicePort } from '@shared/types/workspace'
import type { SkillMetadataSnapshotPort, SkillServicePort } from '@shared/types/skill'
import type { SkillSyncServicePort } from '@shared/types/skillSync'
import type { IConversationExporter } from '../exporter/interface'
import type {
  IShortcutPresenter,
  IWindowPresenter,
  IYoBrowserPresenter
} from '@shared/types/desktop'
import type { DialogServicePort } from '@shared/types/dialog'
import type { KnowledgeServicePort } from '@shared/types/knowledge'
import type { ProviderRuntime } from '../provider'
import {
  RutisAgentInvocationAdmission,
  DEFAULT_AGENT_INVOCATION_CAPACITY,
  DEFAULT_AGENT_INVOCATION_MAX_PENDING
} from '@/agent/invocationAdmission'
import { HarnessRuntime } from '../harness/runtime'
import { RutisMemoryVectorStores } from '../harness/memory-vector'
import { ProviderImportService } from '../provider/providerImportService'
import type { ProviderDatabase } from '../provider/data/database'
import { createProviderRoutes } from '../provider/routes'
import type { ProviderSettings } from '../provider/settings'
import type { SettingsStore } from '../config/settingsStore'
import type { SecretStore } from '../config/secretStore'
import { providerDbLoader, type ProviderDbBootstrap } from '../provider/providerDbLoader'
import { isInsecureTlsAllowed } from '../lib/insecureTls'
import { proxyConfig, ProxyMode } from '../platform/proxy'
import { DeviceService } from '../device'
import { UpgradeService } from '../upgrade'
import { UpdateSettings } from '../upgrade/settings'

import { getShellEnvironment } from '@/agent/shared/process/shellEnvHelper'
import { mergeDetectionEnv, ToolchainService } from '@/toolchains'
import { ToolchainResolutionError } from '@/toolchains/errors'
import { createToolchainRoutes } from '@/toolchains/routes'
import { AttachmentCapabilityRouter } from '@/ocr/attachmentCapabilityRouter'
import { OcrRuntimeService } from '@/ocr/ocrRuntimeService'
import { SafeStorageOcrCacheKeyProvider } from '@/ocr/ocrCacheKeyProvider'
import { OcrSettings } from '@/ocr/ocrSettings'
import { createOcrRoutes } from '@/ocr/routes'
import { McpService } from '../mcp'

import { credentialCrypto, secureCredentialCrypto } from './credentialCrypto'
import {
  ImportMode,
  SyncService,
  type SyncImportDatabasePort,
  type SyncImportResult
} from '../sync'
import type { DatabaseSecurityStatus } from '@shared/contracts/routes'
import type { DatabaseRepairReport } from '@shared/types/databaseSchema'
import { DatabaseRequestGate } from './databaseRequestGate'

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
import { DesktopConfigurationHost } from '../desktop/configurationHost'
import { DesktopConfigurationProjection } from '../desktop/configurationProjection'
import { DesktopRemoteAuthWindows } from '../desktop/remoteAuthWindows'
import { DesktopImageActions } from '../desktop/imageActions'
import { FontSettings } from '../desktop/fontSettings'
import { TabPresenter } from '../desktop/tab'
import type { DesktopSessionBinding } from '@/desktop/sessionBinding'
import { TrayPresenter } from '../desktop/tray'
import { OAuthService } from '../provider/auth'
import { FloatingButtonPresenter } from '../desktop/floatingButton'
import { YoBrowserPresenter } from '../desktop/browser/YoBrowserPresenter'
import { ComputerUsePreviewPresenter } from '@/desktop/computerUse/ComputerUsePreviewPresenter'
import { AgentPreviewCoordinator } from '@/desktop/preview/AgentPreviewCoordinator'

import { LoggingService } from './logging'
import { RendererPerformanceLogService } from './rendererPerformanceLogService'
import type { PrivacySettings } from './privacy'
import type { ProxySettings } from '@/platform/proxySettings'
import type { McpSettings } from '@/mcp/settings'
import type { McpAppSandboxRegistry, McpAppDesktopPort } from '@/mcp/apps/sandboxRegistry'
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

import { createWorkspaceRoutes } from '../workspace/routes'
import { createDeviceRoutes } from '../device/routes'
import { createOnboardingRoutes } from '../onboarding/routes'
import { createUpgradeRoutes } from '../upgrade/routes'
import { createSyncRoutes } from '../sync/routes'
import { SyncHostService } from '../sync/host'
import { createSyncHostRoutes } from '../sync/host/routes'
import { createPlatformRoutes } from '../platform/routes'
import { createHookRoutes } from '../hook/routes'
import { createAppSettingsRoutes } from './settingsRoutes'
import { AppSettingsService } from './settingsService'
import type { SettingsActivityInput } from '@shared/contracts/routes'
import { createAppRoutes } from './routes'
import { registerClipboardIpc } from './clipboardIpc'
import { createRendererIpcAuthorizer } from './rendererIpcSecurity'
import { ApprovalBroker, createApprovalRoutes } from '@/approval'
import {
  CommandPermissionService,
  FilePermissionService,
  SettingsPermissionService,
  ToolPermissionBroker
} from '../tool/permission'

import { createExporterRoutes } from '../exporter/routes'

import { SkillSettings } from '../skill/settings'

import { HookService } from '../hook'

import { SchedulerService } from '../scheduler'

import { spawnSchedulerHost } from './schedulerHost'
import {
  TOOL_SURFACE_PRODUCTION_ROLLOUT_POLICY_V1,
  ToolSurfaceRolloutOwner
} from '@/agent/deepchat/runtime/toolSurfaceRollout'
import type { AppSessionService } from '@/agent/shared/appSessionService'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { SessionQuery } from '@/session/query'
import type { SessionAssignment } from '@/session/assignment'
import type { SessionTurn } from '@/session/turn'
import type { SessionLifecycle } from '@/session/lifecycle'
import type { DeepChatAgentHarness } from '@/agent/deepchat/harness'
import type { RunJournalObservation } from '@/agent/deepchat/runtime/types'
import type { AcpAgentRuntime } from '@/agent/acp/instance'
import { isAcpRegistryIconUrl } from '@/agent/acp/catalog/acpRegistryConstants'
import { createAcpRoutes } from '@/agent/acp/routes'
import type {
  MemoryIngestionDrainOutcome,
  MemoryIngestionObserver
} from '@/agent/deepchat/memory/memoryIngestionObserver'
import { type MemoryServicePort } from '../memory'
import { ProjectService } from '../project'
import type { SettingsDatabase } from '@/settings/data/database'
import { createOrchestrationRoutes } from '@/orchestration/routes'
import {
  type LiveDelegationService,
  type LiveDelegationLifecycleObservation
} from '@/orchestration/liveDelegationService'
import { LiveDelegationConsentAuthority } from '@/orchestration/liveDelegationConsent'
import { createProjectRoutes } from '../project/routes'

import type { RemoteServiceLike } from '../remote/ports'
import { type PluginServicePort } from '../plugin'
import type { PluginToolPolicyStore } from '@/plugin/toolPolicyStore'
import { createPluginRoutes } from '../plugin/routes'

import type { AgentDatabase } from '@/agent/data/database'
import { AgentTraceSettings } from '../agent/traceSettings'
import type { MainDatabase } from '../data/mainDatabase'
import {
  DatabaseSecurityService,
  type DatabaseSecurityMigrationDatabasePort
} from './databaseSecurity'

import type { AcpProviderAdminPort } from '../provider/ports'
import type { SessionPermissionPort, SessionUiPort } from '../session/contracts'
import {
  isStartupWorkloadCancellation,
  scheduleObservedStartupTask,
  StartupWorkloadCoordinator
} from '../app/startupWorkloadCoordinator'
import type { StartupWorkloadTaskContext } from '../app/startupWorkloadCoordinator'
import type { LegacyChatImportService } from './startupMigrations/legacyChatImportService'
import type { UsageStatsService } from '../session/usageStatsService'
import type { SessionDataMigrationSQLitePort } from './startupMigrations/sessionDataMigrations'
import type { SessionHistorySearch } from '@/session/sessionHistorySearch'
import type { SessionTranslation } from '@/session/sessionTranslation'
import { createSessionRoutes } from '@/session/routes'
import { createAgentRoutes } from '@/agent/routes'
import { createPromptRoutes } from '@/agent/promptRoutes'

import type { AgentSessionExportService } from '../exporter/agentSessionExporter'

import { createRouteDispatcher, dispatchDeepchatRoute, type RouteDispatcher } from '@/routes'
import { registerDeepchatRoutes } from './routeIpc'
import { createNodeScheduler } from '@/routes/scheduler'
import { coordinateApplicationDataReset } from './applicationDataReset'
import {
  AgentCliCommandAccess,
  AgentCliTokenAuthority,
  ArtifactSpool,
  type CliAudioTranscriptionService,
  CliAuditLog,
  type CliComputeService,
  CliLauncherService,
  CliMutationGuard,
  CliOcrService,
  ProgrammaticToolDispatcher,
  ProgrammaticToolParentRegistry,
  CliRequestPolicy,
  type CliRunService,
  CliServer,
  CliSkillService,
  createArtifactRoutes,
  createCliComputeRoutes,
  createCliMcpAdminRoutes,
  createCliProviderModelAdminRoutes,
  createCliRoutes,
  resolveBundledCliDirectory
} from '@/cli'
import { CliRequestError } from '@/cli/errors'
import { AcpRegistryMigrationService } from '@/agent/acp/catalog/acpRegistryMigrationService'

import { spawnBackgroundExecHost } from './backgroundExecHost'
import { spawnCodeModeHost } from './codeModeHost'
import {
  runBuiltinMcpAllowlistCompatibilityMigration,
  runDisabledAgentToolCapabilityCleanupMigration,
  runMainlineNormalizationMigration
} from './startupMigrations/sessionDataMigrations'
import { activateAppOnMac } from '@/lib/activateApp'
import { TypedEventHub } from '@/events/typedEventHub'
import { SessionEventRouter } from '@/events/sessionEventRouter'

import { MainShutdownCoordinator, type MainShutdownActionClaim } from './mainShutdownCoordinator'
import { elapsedMonotonicMs, readMonotonicNow } from '@/lib/monotonicTime'
import {
  EpisodeRegistry,
  TimeoutNotificationScheduler,
  systemNotificationClock
} from '@shared/notifications'

type ApplicationDatabaseMaintenancePort = SyncImportDatabasePort &
  DatabaseSecurityMigrationDatabasePort

type DatabaseImportCommand =
  | { kind: 'import-backup-file'; filePath: string; mode: 'increment' | 'overwrite' }
  | { kind: 'import-backup'; fileName: string; mode: 'increment' | 'overwrite' }

type DatabaseEncryptionCommand =
  | { kind: 'enable-encryption'; password: string }
  | { kind: 'change-password'; currentPassword: string; newPassword: string }
  | { kind: 'disable-encryption'; currentPassword: string }

type DatabaseRepairCommand = { kind: 'repair-schema' }
type DatabaseMaintenanceCommand =
  | DatabaseImportCommand
  | DatabaseEncryptionCommand
  | DatabaseRepairCommand
type DatabaseMaintenanceResult = SyncImportResult | DatabaseSecurityStatus | DatabaseRepairReport

export interface MainProcessControl {
  focusPrimaryWindow(): void
  handleDeepLink(url: string): Promise<void>
  clearPermissionCaches(): void
  confirmShutdown(): Promise<boolean>
  cancelShutdown(): void
  hasMainWindows(): boolean
  stop(reason: MainLogShutdownReason): Promise<MainShutdownActionClaim | undefined>
  stopForCleanup(): Promise<void>
}

function classifyRunError(stopReason: MainLogRunStopReason): SafeLogError {
  switch (stopReason) {
    case 'journal_error':
      return { category: 'persistence' }
    case 'provider_error':
      return { category: 'provider' }
    case 'post_dispatch_permission':
      return { category: 'permission' }
    case 'context_window':
    case 'max_tokens':
    case 'max_tool_calls':
    case 'max_turn_requests':
    case 'max_turns':
      return { category: 'resource' }
    default:
      return { category: 'unknown' }
  }
}

function emitRunJournalObservation(observation: RunJournalObservation): void {
  if (observation.type === 'started') {
    if (observation.runKind === 'loop') {
      mainLogger.emit('agent.run.started', {
        runId: observation.runId,
        sessionId: observation.sessionId,
        messageId: observation.messageId,
        runKind: 'loop',
        initialRequestSeq: observation.initialRequestSeq
      })
    } else {
      mainLogger.emit('agent.run.started', {
        runId: observation.runId,
        sessionId: observation.sessionId,
        messageId: observation.messageId,
        runKind: 'deferred_tool'
      })
    }
    return
  }

  const stopReason = normalizeMainLogRunStopReason(observation.stopReason, observation.outcome)
  if (observation.runKind === 'loop') {
    if (observation.outcome === 'error') {
      mainLogger.emit('agent.run.terminal', {
        runId: observation.runId,
        sessionId: observation.sessionId,
        messageId: observation.messageId,
        runKind: 'loop',
        outcome: 'error',
        stopReason,
        ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
        logicalRounds: observation.logicalRounds,
        toolCalls: observation.toolCalls,
        error: classifyRunError(stopReason)
      })
      return
    }
    mainLogger.emit('agent.run.terminal', {
      runId: observation.runId,
      sessionId: observation.sessionId,
      messageId: observation.messageId,
      runKind: 'loop',
      outcome: observation.outcome,
      stopReason,
      ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
      logicalRounds: observation.logicalRounds,
      toolCalls: observation.toolCalls
    })
    return
  }

  if (observation.outcome === 'error') {
    mainLogger.emit('agent.run.terminal', {
      runId: observation.runId,
      sessionId: observation.sessionId,
      messageId: observation.messageId,
      runKind: 'deferred_tool',
      outcome: 'error',
      stopReason,
      ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
      error: classifyRunError(stopReason)
    })
    return
  }
  mainLogger.emit('agent.run.terminal', {
    runId: observation.runId,
    sessionId: observation.sessionId,
    messageId: observation.messageId,
    runKind: 'deferred_tool',
    outcome: observation.outcome,
    stopReason,
    ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs })
  })
}

function emitLiveDelegationObservation(observation: LiveDelegationLifecycleObservation): void {
  switch (observation.type) {
    case 'turn_queued':
      mainLogger.emit('orchestration.delegation.turn.queued', observation)
      break
    case 'child_bound':
      mainLogger.emit('orchestration.delegation.child.bound', observation)
      break
    case 'turn_started':
      mainLogger.emit('orchestration.delegation.turn.started', observation)
      break
    case 'turn_suspended':
      mainLogger.emit('orchestration.delegation.turn.suspended', observation)
      break
    case 'turn_resumed':
      mainLogger.emit('orchestration.delegation.turn.resumed', observation)
      break
    case 'turn_terminal':
      if (observation.status === 'failed') {
        mainLogger.emit('orchestration.delegation.turn.terminal', {
          parentSessionId: observation.parentSessionId,
          ...(observation.childSessionId ? { childSessionId: observation.childSessionId } : {}),
          delegationId: observation.delegationId,
          turnId: observation.turnId,
          status: observation.status,
          ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
          error: { category: observation.errorCategory }
        })
      } else {
        mainLogger.emit('orchestration.delegation.turn.terminal', {
          parentSessionId: observation.parentSessionId,
          ...(observation.childSessionId ? { childSessionId: observation.childSessionId } : {}),
          delegationId: observation.delegationId,
          turnId: observation.turnId,
          status: observation.status,
          ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs })
        })
      }
      break
    case 'reconciliation_terminal':
      if (observation.outcome === 'failed' || observation.outcome === 'quarantined') {
        mainLogger.emit('orchestration.delegation.reconciliation.terminal', {
          parentSessionId: observation.parentSessionId,
          ...(observation.childSessionId ? { childSessionId: observation.childSessionId } : {}),
          delegationId: observation.delegationId,
          turnId: observation.turnId,
          outcome: observation.outcome,
          error: { category: observation.errorCategory }
        })
      } else {
        mainLogger.emit('orchestration.delegation.reconciliation.terminal', {
          parentSessionId: observation.parentSessionId,
          ...(observation.childSessionId ? { childSessionId: observation.childSessionId } : {}),
          delegationId: observation.delegationId,
          turnId: observation.turnId,
          outcome: observation.outcome
        })
      }
      break
    case 'stale_result_rejected':
      mainLogger.emit('orchestration.delegation.stale_result.rejected', observation)
      break
    case 'observations_dropped':
      mainLogger.emit('orchestration.delegation.observations.dropped', observation)
      break
  }
}

export async function createMainProcessControl(dependencies: {
  previousAppVersion?: string
  currentAppVersion: string
  providerCatalogBootstrap: ProviderDbBootstrap
  settingsStore: SettingsStore
  secretStore: SecretStore
  privacySettings: PrivacySettings
  proxySettings: ProxySettings
  mcpSettings: McpSettings
  pluginToolPolicies: PluginToolPolicyStore
  mcpAppSandboxRegistry: McpAppSandboxRegistry
  mcpAppDesktop: McpAppDesktopPort
  acpCatalogSettings: AcpCatalogSettings
  database: MainDatabase
  closeProfile(): void
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
  let syncPeerService: SyncPeerService
  let syncHostService: SyncHostService
  let syncReplica: SyncReplicaStore | undefined
  let automaticSync: AutomaticSync | undefined
  const syncActiveSessions = new Set<string>()
  let deeplinkService: DeeplinkService
  let notificationService: NotificationService
  let tabPresenter: TabPresenter
  let trayPresenter: TrayPresenter
  let oauthService: OAuthService
  let floatingButtonPresenter: FloatingButtonPresenter
  let knowledgeService: KnowledgeServicePort
  let workspaceService: WorkspaceServicePort
  let toolService: ToolService
  let deepChatAgentHarness: DeepChatAgentHarness
  let yoBrowserPresenter: IYoBrowserPresenter
  let computerUsePreviewPresenter: ComputerUsePreviewPresenter
  let agentPreviewCoordinator: AgentPreviewCoordinator
  let dialogService: DialogServicePort
  let skillService: SkillServicePort & SkillMetadataSnapshotPort
  let skillSyncService: SkillSyncServicePort
  let sessionQuery: SessionQuery
  let desktopSessionBinding: DesktopSessionBinding
  let sessionAssignment: SessionAssignment
  let sessionTurn: SessionTurn
  let sessionLifecycle: SessionLifecycle
  let sessionPermissionPort: SessionPermissionPort
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
  let routeDispatcher: RouteDispatcher | undefined
  let cliComputeService: CliComputeService
  let cliAudioTranscriptionService: CliAudioTranscriptionService
  let cliOcrService: CliOcrService
  let cliSkillService: CliSkillService
  let cliMutationGuard: CliMutationGuard
  let cliRequestPolicy: CliRequestPolicy
  let cliRunService: CliRunService
  let hasInitialized = false
  let appLifecycleState: 'starting' | 'running' | 'stopping' | 'stopped' = 'starting'
  const databaseRequests = new DatabaseRequestGate(() => {
    if (appLifecycleState === 'stopping' || appLifecycleState === 'stopped')
      throw new Error(`App lifecycle is ${appLifecycleState}`)
  })
  let nativeSettings: DesktopConfigurationProjection
  let appSettingsService: AppSettingsService
  let shutdownStepFailures = 0

  windowPresenter = new WindowPresenter(
    {
      getCloseToQuit: () => nativeSettings.getCloseToQuit(),
      getContentProtectionEnabled: () => nativeSettings.getContentProtectionEnabled()
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
  const toolSurfaceRollout = new ToolSurfaceRolloutOwner(TOOL_SURFACE_PRODUCTION_ROLLOUT_POLICY_V1)
  let programmaticToolDispatcher: ProgrammaticToolDispatcher
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
        return await databaseRequests.runRequest(method, () =>
          cliAudioTranscriptionService!.dispatchRpc(method, input, caller, signal)
        )
      }
      if (cliOcrService?.handlesRpc(method)) {
        return await databaseRequests.runRequest(method, () =>
          cliOcrService!.dispatchRpc(method, input, caller, signal)
        )
      }
      if (!routeDispatcher) throw new Error('CLI route dispatcher is not ready')
      signal.throwIfAborted()
      const output = await dispatchDeepchatRoute(routeDispatcher, method, input, { caller })
      signal.throwIfAborted()
      return output
    },
    dispatchProgrammaticTool: async (
      method,
      input,
      caller,
      operation,
      signal,
      takeSettlementOwnership
    ) => {
      return await databaseRequests.runRequest(method, () =>
        programmaticToolDispatcher.dispatch(
          method,
          input,
          caller,
          operation,
          signal,
          takeSettlementOwnership
        )
      )
    },
    completeProgrammaticToolPreDispatchFailure: (method, operation, error) => {
      programmaticToolDispatcher.completePreDispatchFailure(method, operation, error)
    },
    dispatchStream: async (method, input, caller, requestId, signal, emit) => {
      if (cliRunService?.handlesStream(method)) {
        databaseRequests.assertRouteAllowed(method)
        return await cliRunService.dispatchStream(method, input, caller, signal, emit)
      }
      if (!cliComputeService) throw new Error('CLI compute service is not ready')
      return await databaseRequests.runRequest(method, () =>
        cliComputeService.dispatchStream(method, input, caller, requestId, signal, emit)
      )
    },
    dispatchUpload: async (method, input, upload, caller, signal) => {
      return await databaseRequests.runRequest(method, async () => {
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
      })
    },
    authorize: async (input) => {
      if (!cliRequestPolicy) throw new Error('CLI request policy is not ready')
      return await databaseRequests.runAuthorization(input.entry.contract.name, () =>
        cliRequestPolicy.authorize(input)
      )
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
  let settingsRevision = 0
  const nextSettingsVersion = () => ++settingsRevision
  const publishDeepchatEvent = (name: DeepchatEventName, payload: unknown): void => {
    if (name === 'settings.changed') {
      payload = {
        ...settingsChangedEvent.payload.parse(payload),
        version: nextSettingsVersion()
      }
    }
    sessionEventRouter.publish(name, payload)
    if (name === 'sessions.status.changed') {
      const state = payload as { sessionId: string; status: string }
      if (state.status === 'generating' || state.status === 'running')
        syncActiveSessions.add(state.sessionId)
      else {
        syncActiveSessions.delete(state.sessionId)
        syncReplica?.wake()
      }
    }
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
  const coreData = createCoreData({
    profile: {
      database: mainDatabase,
      settingsStore: dependencies.settingsStore,
      privacySettings: dependencies.privacySettings,
      providerDatabase: dependencies.providerDatabase,
      agentDatabase: dependencies.agentDatabase,
      settingsDatabase: dependencies.settingsDatabase,
      currentAppVersion: dependencies.currentAppVersion,
      previousAppVersion: dependencies.previousAppVersion
    },
    profileDirectory: app.getPath('userData'),
    providerCatalogBootstrap: dependencies.providerCatalogBootstrap,
    publishEvent: publishDeepchatEvent,
    emitTapeHead: (webContentsId, pulse) => {
      typedEventHub.publish(sessionsTapeInspectorHeadChangedEvent.name, pulse, {
        kind: 'renderer',
        webContentsId
      })
    },
    onRendererDestroyed: (webContentsId, listener) => {
      const target = electronWebContents.fromId(webContentsId)
      if (!target || target.isDestroyed()) {
        queueMicrotask(listener)
        return () => {}
      }
      target.once('destroyed', listener)
      return () => target.removeListener('destroyed', listener)
    },
    projectEnvironmentChanged: () => projectService.notifyEnvironmentProjectionChanged()
  })
  providerSettings = coreData.providerSettings
  appSessionService = coreData.appSessionService
  resolveSessionRunId = coreData.resolveSessionRunId
  sessionDataMigrationSQLite = coreData.sessionDataMigrationSQLite
  legacyChatImportService = coreData.legacyChatImportService
  usageStatsService = coreData.usageStatsService
  const {
    memoryDatabase,
    sessionData,
    tapeInspectorHeadWatcher,
    agentDatabase,
    settingsDatabase,
    promptSettings
  } = coreData
  const programmaticToolParents = new ProgrammaticToolParentRegistry({
    tokenAuthority: agentCliTokenAuthority,
    executionJournal: sessionData.programmaticExecutionJournal
  })
  programmaticToolDispatcher = new ProgrammaticToolDispatcher({
    parents: programmaticToolParents,
    executeChild: async (input) => await toolService.callProgrammaticToolChild(input),
    authorizeChild: async ({
      caller,
      grant,
      childOrdinal,
      entry,
      arguments: childArguments,
      permission,
      signal
    }) => {
      const requestId = permission.requestId?.trim()
      if (!requestId) {
        throw new CliRequestError(
          'unavailable',
          'Programmatic Tool permission request is unavailable',
          { httpStatus: 503 }
        )
      }
      await cliMutationGuard.authorize({
        operation: 'tool.call',
        effect: permission.permissionType === 'read' ? 'read' : 'destructive',
        principal: caller.principal,
        connectionId: caller.connectionId,
        clientRequestId: `${grant.operation.providerToolCallId}:${childOrdinal}`,
        arguments: {
          target: entry.target.providerVisibleName,
          arguments: childArguments
        },
        displayData: {
          target: entry.target.providerVisibleName,
          ...(typeof permission.argumentsPreview === 'string'
            ? { argumentsPreview: permission.argumentsPreview }
            : {})
        },
        signal,
        timeoutMs: grant.quotas.maxDurationMs
      })
      if (!toolPermissionBroker.approve(requestId, grant.operation.sessionId)) {
        throw new CliRequestError(
          'unavailable',
          'Programmatic Tool permission request is no longer active',
          { httpStatus: 503 }
        )
      }
    },
    cancelChildPermission: (requestId, sessionId) => {
      toolPermissionBroker.cancel(requestId, sessionId)
    }
  })
  const desktopConfigurationHost = new DesktopConfigurationHost(
    app.getPath('userData'),
    setMainLoggingEnabled,
    restartApplication
  )
  const desktopSettings = new DesktopSettings(
    dependencies.settingsStore,
    {
      systemLocale: app.getLocale(),
      readTheme: async () => ({
        theme: nativeTheme.themeSource,
        isDark: nativeTheme.shouldUseDarkColors
      }),
      applyTheme: async (theme) => {
        nativeTheme.themeSource = theme
        return nativeTheme.shouldUseDarkColors
      },
      refreshLanguage: async (locale) => {
        floatingButtonPresenter.refreshLanguage(locale)
        await tabPresenter.refreshLanguage(locale)
      },
      refreshTheme: (isDark) => floatingButtonPresenter.refreshTheme(isDark),
      readLaunchAtLogin: async () => app.getLoginItemSettings().openAtLogin,
      setLaunchAtLogin: async (enabled) => {
        app.setLoginItemSettings({ openAtLogin: enabled })
        return app.getLoginItemSettings().openAtLogin
      },
      applyContentProtection: async (enabled) => {
        ;(windowPresenter as WindowPresenter).applyContentProtection(enabled)
        desktopConfigurationHost.requestRestart()
      },
      applyFloatingButtonEnabled: (enabled) => floatingButtonPresenter.setEnabled(enabled)
    },
    publishDeepchatEvent,
    () => appSettingsService.publishNativeSnapshot()
  )
  const fontSettings = new FontSettings(dependencies.settingsStore, publishDeepchatEvent, () =>
    desktopConfigurationHost.listSystemFonts()
  )
  const skillSettings = new SkillSettings(dependencies.settingsStore, app.getPath('home'))
  const traceSettings = new AgentTraceSettings(dependencies.settingsStore)

  const coreProviders = createCoreProviders({
    profile: {
      settingsStore: dependencies.settingsStore,
      privacySettings: dependencies.privacySettings,
      acpCatalogSettings: dependencies.acpCatalogSettings,
      mcpSettings: dependencies.mcpSettings,
      currentAppVersion: dependencies.currentAppVersion
    },
    data: coreData,
    artifactSpool,
    profileDirectory: app.getPath('userData'),
    homeDirectory: app.getPath('home'),
    temporaryDirectory: app.getPath('temp'),
    registryDirectory: path.join(
      app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath(),
      'resources',
      'acp-registry'
    ),
    crypto: credentialCrypto,
    openExternal: (url) => shell.openExternal(url),
    fetchRegistryIcon: async (url, signal) => {
      if (!isAcpRegistryIconUrl(url)) throw new Error('Unsupported ACP registry icon URL')
      signal.throwIfAborted()
      const response = await net.fetch(url, { signal })
      if (!response.ok) {
        throw new Error(`Failed to fetch icon: ${response.status} ${response.statusText}`)
      }
      const text = await response.text()
      signal.throwIfAborted()
      if (text.length > 1024 * 1024) throw new Error('ACP registry icon exceeds the size limit')
      return text
    },
    sendToRenderer: (webContentsId, name, payload) => {
      const target = electronWebContents.fromId(webContentsId)
      if (!target || target.isDestroyed()) return
      target.send(DEEPCHAT_EVENT_CHANNEL, createDeepchatEventEnvelope(name, payload))
    },
    onRendererDestroyed: (webContentsId, callback) => {
      const target = electronWebContents.fromId(webContentsId)
      if (!target || target.isDestroyed()) {
        queueMicrotask(callback)
        return () => {}
      }
      target.once('destroyed', callback)
      return () => target.removeListener('destroyed', callback)
    },
    publishEvent: publishDeepchatEvent,
    projectEnvironmentChanged: () => projectService.notifyEnvironmentProjectionChanged(),
    readLanguage: () => desktopSettings.getLanguage(),
    allowInsecureTls: isInsecureTlsAllowed(),
    registry: {
      getNpmRegistry: () => mcpService.getNpmRegistry(),
      getUvRegistry: () => mcpService.getUvRegistry()
    },
    memory: {
      cleanupDeletedAgentResources: (agentId) =>
        memoryService.cleanupDeletedAgentResources(agentId),
      onAgentMemoryMaintenanceConfigChanged: (agentId) =>
        memoryService.onAgentMemoryMaintenanceConfigChanged(agentId)
    },
    cleanupAgentSkills: async (agentId) => {
      await ensureSkillServicesInitialized()
      await skillService.cleanupAgentSkills(agentId)
    },
    skillSettings,
    assertAcpInstallAllowed: () =>
      databaseRequests.assertRouteAllowed('config.ensureAcpAgentInstalled')
  })
  const {
    providerRuntime,
    agentSettings,
    acpRuntimeOwner,
    acpAuthService,
    unsubscribeProviderDbCatalog,
    agentDefaults,
    commandShellService
  } = coreProviders
  cliComputeService = coreProviders.cliComputeService
  cliAudioTranscriptionService = coreProviders.cliAudioTranscriptionService
  oauthService = new OAuthService(
    {
      getGitHubCopilotSignInTarget: async (providerId) => {
        if (databaseRequests.state !== 'running')
          throw new Error(`App database maintenance is ${databaseRequests.state}`)
        return await providerRuntime.getGitHubCopilotSignInTarget(providerId)
      },
      commitGitHubCopilotCredential: async (target, apiKey) => {
        if (databaseRequests.state !== 'running')
          throw new Error(`App database maintenance is ${databaseRequests.state}`)
        await providerRuntime.commitGitHubCopilotCredential(target, apiKey)
      },
      invalidateGitHubCopilotSignIns: () => providerRuntime.invalidateGitHubCopilotSignIns()
    },
    coreProviders.accounts
  )
  acpProviderAdminPort = providerRuntime
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
    desktopConfigurationHost,
    publishDeepchatEvent,
    () => appSettingsService.publishNativeSnapshot()
  )
  const rendererPerformanceLogService = new RendererPerformanceLogService(
    () => nativeSettings.getLoggingEnabled(),
    app.getPath('userData')
  )
  const resolveProjectDirectory = (name: 'documents' | 'home'): string | null => {
    try {
      return app.getPath(name)
    } catch (error) {
      console.warn(
        `[ProjectService] Failed to resolve ${name === 'documents' ? 'Documents' : 'Home'} path:`,
        error
      )
      return null
    }
  }
  const updateSettings = new UpdateSettings(
    dependencies.settingsStore,
    dependencies.currentAppVersion
  )
  upgradeService = new UpgradeService(
    { getChannel: () => nativeSettings.getChannel() },
    () => nativeSettings.isPrivacyModeEnabled(),
    dependencies.requestUpdateInstall,
    publishDeepchatEvent,
    (observation) =>
      mainLogger.emit('app.update.operation.failed', {
        operation: observation.operation,
        error: { category: observation.errorCategory }
      })
  )
  const desktopImageActions = new DesktopImageActions(app.getPath('userData'))
  ocrSettings = new OcrSettings(dependencies.settingsStore, publishDeepchatEvent)
  const recordSettingsActivity = (input: SettingsActivityInput) => {
    void settingsDatabase.recordSettingsActivity(input).catch((error) => {
      console.warn('[SettingsActivity] Failed to record settings activity:', error)
    })
  }
  appSettingsService = new AppSettingsService({
    ownerId: randomUUID(),
    updateSettings,
    publishNativeSnapshot: (snapshot) => nativeSettings.apply(snapshot),
    agentDefaults,
    privacy: dependencies.privacySettings,
    traceSettings,
    desktopSettings,
    fonts: fontSettings,
    logging: loggingService,
    ocr: ocrSettings,
    recordActivity: recordSettingsActivity,
    publishEvent: publishDeepchatEvent,
    nextVersion: nextSettingsVersion,
    assertActive: () => {
      databaseRequests.assertRouteAllowed('settings.update')
      if (databaseRequests.state !== 'running')
        throw new Error(`App database maintenance is ${databaseRequests.state}`)
    }
  })
  nativeSettings = new DesktopConfigurationProjection(
    appSettingsService.readNativeSnapshot(),
    () => nativeTheme.shouldUseDarkColors,
    (bounds) => appSettingsService.setFloatingButtonBounds(bounds)
  )
  shortcutPresenter = new ShortcutPresenter(nativeSettings, windowPresenter, publishDeepchatEvent)
  const toolchainHomeDir = app.getPath('home')
  const toolchainService = ToolchainService.initialize({
    appPath: app.getAppPath(),
    userDataDir: app.getPath('userData'),
    env: mergeDetectionEnv(process.env, toolchainHomeDir, process.platform),
    allowProbe: () => !dependencies.privacySettings.isEnabled(),
    onProgress: (progress) =>
      publishDeepchatEvent('toolchains.progress', { ...progress, version: Date.now() }),
    onMissing: (missing) =>
      publishDeepchatEvent('toolchains.missing', { missing, version: Date.now() }),
    onStateChanged: (kind?: ToolchainKind) => {
      publishDeepchatEvent('toolchains.changed', { version: Date.now() })
      ocrRuntimeService?.refreshAvailability(kind)
      const state = ToolchainService.getInstance().getState()
      if (state.node.source === 'unconfigured' && state.uv.source === 'unconfigured') {
        return
      }
      void mcpService?.retryUnstartedEnabledServers().catch((error) => {
        logger.warn('[ToolchainService] Failed to retry MCP servers after PATH refresh', error)
      })
    }
  })
  if (process.platform !== 'win32') {
    void getShellEnvironment()
      .then((shellEnv) => {
        toolchainService.updateDetectionEnv(
          mergeDetectionEnv(shellEnv, toolchainHomeDir, process.platform)
        )
      })
      .catch((error) => {
        logger.warn('[ToolchainService] Failed to refresh login-shell PATH', error)
      })
  }
  ocrRuntimeService = new OcrRuntimeService({
    cacheKeyProvider: new SafeStorageOcrCacheKeyProvider(
      path.join(app.getPath('userData'), 'ocr', 'cache-key.json')
    ),
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    nodeRuntimePath: null,
    resolveNode: () => {
      const resolved = toolchainService.resolve('node', { purpose: 'ocr' })
      if (!resolved.version) {
        throw new ToolchainResolutionError(
          'node',
          'version_mismatch',
          'OCR Node version is unavailable'
        )
      }
      return { executable: resolved.node, version: resolved.version }
    },
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
  notificationService = new NotificationService(nativeSettings, publishDeepchatEvent)
  trayPresenter = new TrayPresenter(nativeSettings, windowPresenter)
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

  const deeplinkActions = createDeeplinkActions({
    window: windowPresenter,
    hasProvider: async (providerId) => {
      if (databaseRequests.state !== 'running')
        throw new Error(`App database maintenance is ${databaseRequests.state}`)
      return Boolean(providerSettings.getProviderById(providerId))
    },
    notifications: semanticNotifications
  })
  deeplinkService = new DeeplinkService(
    deeplinkActions.desktop,
    deeplinkActions.mcp,
    deeplinkActions.provider
  )

  // Initialize generic Workspace presenter (for all Agent modes)
  const pluginSettingsWindow = new PluginSettingsWindow()
  const remoteAuthWindows = new DesktopRemoteAuthWindows((event) =>
    remoteService.handleAuthWindowEvent(event)
  )
  const admissionDiagnostics = {
    observationsEnabled: () => mainLogger.isOutputEnabled(),
    observe: (
      observation: import('@shared/harness/admission').AgentInvocationAdmissionObservation
    ) => {
      switch (observation.type) {
        case 'queued':
          mainLogger.emit('agent.admission.queued', observation)
          break
        case 'granted':
          mainLogger.emit('agent.admission.granted', observation)
          break
        case 'released':
          mainLogger.emit('agent.admission.released', observation)
          break
        case 'rejected':
          mainLogger.emit('agent.admission.rejected', observation)
          break
        case 'closed':
          mainLogger.emit('agent.admission.closed', observation)
          break
      }
    }
  }
  const harnessRuntime = await HarnessRuntime.start({
    directory: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'harness')
      : path.join(app.getAppPath(), 'out', 'harness'),
    electronExecutable: process.execPath,
    capacity: DEFAULT_AGENT_INVOCATION_CAPACITY,
    maxPending: DEFAULT_AGENT_INVOCATION_MAX_PENDING,
    observe: admissionDiagnostics.observe
  })
  const agentInvocationAdmission = RutisAgentInvocationAdmission.create({
    runtime: harnessRuntime,
    diagnostics: admissionDiagnostics
  })
  console.info('[Harness] Rutis admission ready', agentInvocationAdmission.identity)
  // Initialize agent memory layer (opt-in per agent; vectors stored separately from knowledge base)
  const memoryDbDir = path.join(app.getPath('userData'), 'app_db', 'AgentMemory')
  const memoryVectorStores = new RutisMemoryVectorStores(harnessRuntime, {
    memoryDbDir,
    host: {
      appPath: app.getAppPath(),
      userDataPath: app.getPath('userData'),
      isPackaged: app.isPackaged
    }
  })
  const sessionUiPort: SessionUiPort = {
    refreshSessionUi: () => {
      try {
        void floatingButtonPresenter.refreshWidgetState()
      } catch (error) {
        console.warn('[Main] Failed to refresh floating widget state:', error)
      }
    }
  }
  const coreRuntime = await createCoreRuntime({
    profile: dependencies,
    data: coreData,
    providers: coreProviders,
    bootstrap: {
      profileDirectory: app.getPath('userData'),
      homeDirectory: app.getPath('home'),
      temporaryDirectory: app.getPath('temp'),
      appDataDirectory: app.getPath('appData'),
      documentsDirectory: resolveProjectDirectory('documents'),
      projectHomeDirectory: resolveProjectDirectory('home'),
      appPath: app.getAppPath(),
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      workingDirectory: process.cwd(),
      builtinSkillsDirectories: app.isPackaged
        ? [
            path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'skills'),
            path.join(process.resourcesPath, 'resources', 'skills'),
            path.join(process.resourcesPath, 'skills')
          ]
        : [path.join(app.getAppPath(), 'resources', 'skills')]
    },
    settings: { desktopSettings, appSettingsService, skillSettings, traceSettings },
    toolchains: toolchainService,
    fileWatcherService,
    permissions: {
      agentCliTokenAuthority,
      commandPermissionService,
      filePermissionService,
      settingsPermissionService,
      toolPermissionBroker
    },
    commandPermissionHandler,
    commandEnvironment: agentCliCommandAccess,
    liveDelegationConsent,
    databaseRequests,
    syncActiveSessions,
    importSnapshot: (filePath, mode) =>
      runDatabaseMaintenance({ kind: 'import-backup-file', filePath, mode }),
    assertSyncTokenStorageAvailable: () => {
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
        throw new Error('sync.error.safeStorageUnavailable')
    },
    semanticNotifications,
    dialog: dialogService,
    secureCrypto: secureCredentialCrypto,
    getProxyUrl: async () => proxyConfig.getProxyUrl(),
    whenProxyReady: async () => {
      await proxyConfig.whenReady()
    },
    openExternal: (url) => shell.openExternal(url),
    openPath: (filePath) => shell.openPath(filePath),
    selectDirectory: () => deviceService.selectDirectory(),
    cacheImage: (data, options) => deviceService.cacheImage(data, options),
    browser: yoBrowserPresenter.toolHandler,
    agentDesktop: {
      tempDirectory: app.getPath('temp'),
      profileTempDirectory: path.join(app.getPath('userData'), 'temp'),
      readImageSize: async (filePath, signal) => {
        signal?.throwIfAborted()
        const size = nativeImage.createFromPath(filePath).getSize()
        signal?.throwIfAborted()
        return { width: size.width, height: size.height }
      },
      createSettingsWindow: () => windowPresenter.createSettingsWindow(),
      sendToWindow: (windowId, channel, ...args) =>
        windowPresenter.sendToWindow(windowId, channel, ...args),
      sendSettingsNavigation: (windowId, navigation) =>
        windowPresenter.sendSettingsNavigation(windowId, navigation)
    },
    pluginSettingsWindow,
    remoteAuthWindows,
    openRemoteSession: (sessionId) => openRemoteSession(sessionId),
    showNotification: (options) => notificationService.showNotification(options),
    mcpPreview: computerUsePreviewPresenter,
    mcpApps: { registry: dependencies.mcpAppSandboxRegistry, desktop: dependencies.mcpAppDesktop },
    spawnBackgroundExecHost: (signal) =>
      spawnBackgroundExecHost(
        path.join(app.getAppPath(), 'out/main/backgroundExecUtilityHost.js'),
        signal
      ),
    spawnCodeModeHost: (signal) =>
      spawnCodeModeHost(path.join(app.getAppPath(), 'out/main/codeModeUtilityHost.js'), signal),
    spawnSchedulerHost,
    agentInvocationAdmission,
    memoryVectorStores,
    execution: {
      typedEventHub,
      resolveSessionRunId,
      onRendererDestroyed: (webContentsId, callback) => {
        const target = electronWebContents.fromId(webContentsId)
        if (!target || target.isDestroyed()) {
          queueMicrotask(callback)
          return () => {}
        }
        target.once('destroyed', callback)
        return () => target.removeListener('destroyed', callback)
      },
      destroySessionBrowser: (sessionId) => yoBrowserPresenter.destroySessionBrowser(sessionId),
      observeDelegation: emitLiveDelegationObservation,
      observationsEnabled: () => mainLogger.isOutputEnabled()
    },
    onSessionCompleted: (sessionId) => {
      const session = appSessionService.get(sessionId)
      if (session?.sessionKind !== 'regular' || resolveSessionRunId(sessionId) !== null) return
      void notificationService.showSessionCompletion(session).catch((error) => {
        logger.warn('[Notification] Failed to notify session completion', { sessionId, error })
      })
    },
    onSessionInactive: (sessionId) => {
      void yoBrowserPresenter.releaseInactivePreview(sessionId).catch((error) => {
        logger.warn('[YoBrowser] Failed to release inactive preview', { sessionId, error })
      })
    },
    runJournalObserver: emitRunJournalObservation,
    toolSurfaceRollout,
    agentCliTokenAuthority,
    programmaticToolParents,
    attachmentRouter,
    sessionUiPort,
    publishEvent: publishDeepchatEvent,
    isStopping: () => appLifecycleState === 'stopping' || appLifecycleState === 'stopped',
    mcpReadinessChanged: (ready) => deeplinkService.observeMcpReadiness(ready),
    reportStartupFailure: (component, category) =>
      reportMainStartupComponentFailure(dependencies.startupRunId, component, category)
  })
  const {
    syncSettings,
    knowledgeSettings,
    replicaEndpoint,
    backgroundExec,
    initializeSkills,
    ensureSkillServicesInitialized,
    initializeSkillSyncScan,
    initializeMcp,
    initializeRemoteControl
  } = coreRuntime
  projectService = coreRuntime.projectService
  exporter = coreRuntime.exporter
  fileService = coreRuntime.fileService
  syncService = coreRuntime.syncService
  syncPeerService = coreRuntime.syncPeerService
  syncReplica = coreRuntime.syncReplica
  automaticSync = coreRuntime.automaticSync
  syncHostService = coreRuntime.syncHostService
  knowledgeService = coreRuntime.knowledgeService
  mcpService = coreRuntime.mcpService
  workspaceService = new WorkspaceService(fileService, fileWatcherService, {
    publishInvalidated: (event) => publishDeepchatEvent('workspace.invalidated', event),
    publishWatchStatusChanged: (event) =>
      publishDeepchatEvent('workspace.watch.status.changed', event)
  })
  skillService = coreRuntime.skillService
  skillSyncService = coreRuntime.skillSyncService
  cliSkillService = coreRuntime.cliSkillService
  toolService = coreRuntime.toolService
  pluginService = coreRuntime.pluginService
  hookService = coreRuntime.hookService
  memoryService = coreRuntime.memoryService
  remoteService = coreRuntime.remoteService
  cronJobs = coreRuntime.cronJobs
  sessionPermissionPort = coreRuntime.sessionPermissionPort
  const coreExecution = coreRuntime.execution
  agentSettings.start()
  deepChatAgentHarness = coreExecution.deepChatAgentHarness
  memoryIngestionObserver = coreExecution.memoryIngestionObserver
  acpAgentRuntime = coreExecution.acpAgentRuntime
  sessionQuery = coreExecution.sessionQuery
  desktopSessionBinding = coreExecution.desktopSessionBinding
  sessionAssignment = coreExecution.sessionAssignment
  sessionTurn = coreExecution.sessionTurn
  sessionLifecycle = coreExecution.sessionLifecycle
  cliRunService = coreExecution.cliRunService
  sessionHistorySearch = coreExecution.sessionHistorySearch
  agentSessionExportService = coreExecution.agentSessionExportService
  sessionTranslation = coreExecution.sessionTranslation
  liveDelegationService = coreExecution.liveDelegationService
  const { createLiveDelegationService, orchestrationCapabilityResolver } = coreExecution
  resolveBoundRendererIds = (sessionId) =>
    desktopSessionBinding.getWebContentsIdsForSession(sessionId)
  tabPresenter = new TabPresenter(windowPresenter, desktopSessionBinding, () =>
    deeplinkService.processStartupUrl()
  )
  ;(windowPresenter as WindowPresenter).bindTabPresenter(tabPresenter)
  floatingButtonPresenter = new FloatingButtonPresenter(
    agentSettings,
    nativeSettings,
    sessionQuery,
    desktopSessionBinding,
    windowPresenter as WindowPresenter,
    tabPresenter
  )
  const onSystemResume = () => {
    if (appLifecycleState !== 'running' || databaseRequests.state !== 'running') return
    void cronJobs.handleSystemResume().catch((error) => {
      console.warn('[CronJobs] Failed to reconcile after system resume:', error)
    })
  }
  powerMonitor.on('resume', onSystemResume)

  await appSettingsService.initializeDesktop()
  const onSystemThemeUpdated = () => {
    if (appLifecycleState !== 'running' || databaseRequests.state !== 'running') return
    void appSettingsService.observeSystemTheme().catch((error) => {
      console.warn('[Settings] Failed to refresh system theme:', error)
    })
  }
  nativeTheme.on('updated', onSystemThemeUpdated)

  function setupTray() {
    console.info('setupTray', !!trayPresenter)
    trayPresenter.init()
  }

  function scheduleMainStartupTask(
    startupRunId: string,
    task: Omit<Parameters<StartupWorkloadCoordinator['scheduleTask']>[0], 'runId'>,
    errorMessage: string,
    failure: {
      component: MainLogStartupComponent
      category: MainLogStartupComponentFailureCategory
    }
  ): void {
    scheduleObservedStartupTask({
      coordinator: startupWorkloadCoordinator,
      startupRunId,
      task,
      onFailure: (failedStartupRunId, error) => {
        reportMainStartupComponentFailure(failedStartupRunId, failure.component, failure.category)
        reportNativeMainError(errorMessage, error)
      }
    })
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
    scheduleMainStartupTask(
      mainRunId,
      {
        id: 'main:floating-button',
        target: 'main',
        phase: 'deferred',
        resource: 'io',
        labelKey: 'startup.main.floatingButton',
        run: async () => {
          await initializeFloatingButton()
        }
      },
      'Failed to schedule floating button initialization:',
      { component: 'floating_widget', category: 'resource' }
    )

    scheduleMainStartupTask(
      mainRunId,
      {
        id: 'main:skills-sync-scan',
        target: 'main',
        phase: 'background',
        resource: 'cpu',
        labelKey: 'startup.main.skillsSyncScan',
        run: async (taskContext) => {
          await taskContext.yield()
          await initializeSkillSyncScan(taskContext.signal)
        }
      },
      'Failed to schedule SkillSyncService background scan:',
      { component: 'skill_sync', category: 'unknown' }
    )

    scheduleMainStartupTask(
      mainRunId,
      {
        id: 'main:mcp-init',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.mcpInit',
        run: async (taskContext) => {
          await taskContext.yield()
          await initializeMcp()
        }
      },
      'Failed to schedule MCP initialization:',
      { component: 'mcp', category: 'unknown' }
    )

    scheduleMainStartupTask(
      mainRunId,
      {
        id: 'main:remote-runtime',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.remoteRuntime',
        run: async (taskContext) => {
          await taskContext.yield()
          await initializeRemoteControl()
        }
      },
      'Failed to schedule remote runtime initialization:',
      { component: 'remote_runtime', category: 'unknown' }
    )

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
        if (isStartupWorkloadCancellation(error)) return
        console.error('Failed to schedule idle provider warmup:', error)
      })
  }

  async function initializeFloatingButton() {
    try {
      await floatingButtonPresenter.initialize()
      logger.info('FloatingButtonPresenter initialized successfully')
    } catch (error) {
      reportMainStartupComponentFailure(dependencies.startupRunId, 'floating_widget', 'resource')
      console.error('Failed to initialize FloatingButtonPresenter:', error)
    }
  }

  async function initializeIdleProviderWarmup(taskContext: StartupWorkloadTaskContext) {
    taskContext.signal.throwIfAborted()
    const [registryRefresh, catalogRefresh] = await Promise.allSettled([
      agentSettings.refreshAcpRegistry(false, {
        automatic: true,
        signal: taskContext.signal
      }),
      providerDbLoader.refreshIfNeeded(true, {
        automatic: true,
        signal: taskContext.signal
      })
    ])
    taskContext.signal.throwIfAborted()
    if (registryRefresh.status === 'rejected') throw registryRefresh.reason
    if (catalogRefresh.status === 'rejected') throw catalogRefresh.reason
    if (catalogRefresh.value.status === 'error') {
      console.warn('[ProviderDbLoader] Startup refresh failed:', catalogRefresh.value.message)
    }
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
    nativeTheme.off('updated', onSystemThemeUpdated)
    nativeSettings.stopWrites()
    await appSettingsService.stop()
    await nativeSettings.drainWrites()
    await runDestroyStep('agentCliTokenAuthority.clear', () => agentCliTokenAuthority.clear())
    await runDestroyStep('cliServer.stop', () => cliServer.stop())
    await runDestroyStep('oauthService.stop', () => oauthService.stop())
    await providerDbLoader.drain()
    await agentSettings.drain()
    await startupWorkloadCoordinator.cancelAndDrainTarget('main')
    await runDestroyStep('automaticSync.close', () => automaticSync!.close())
    await runDestroyStep('syncPeerService.stop', () => syncPeerService.stop())
    await runDestroyStep('syncHostService.stop', () => syncHostService.stop())
    await runDestroyStep('replicaEndpoint.close', () => replicaEndpoint.close())
    await runDestroyStep('syncReplica.close', () => syncReplica?.close())
    await runDestroyStep('tapeInspectorHeadWatcher.close', () => tapeInspectorHeadWatcher.close())
    await runDestroyStep('typedEventHub.close', () => typedEventHub.close())
    await runDestroyStep('cliMutationGuard.clear', () => cliMutationGuard.clear())
    await runDestroyStep('cliAuditLog.close', () => cliAuditLog.close())
    await runDestroyStep('artifactSpool.close', () => artifactSpool.close())
    await runDestroyStep('providerCatalog.unsubscribe', () => unsubscribeProviderDbCatalog())
    await runDestroyStep('liveDelegationService.stop', () => liveDelegationService.stop())
    await runDestroyStep('agentInvocationAdmission.close', () => agentInvocationAdmission.close())
    await runDestroyStep('agentInvocationAdmission.flushObservations', () =>
      agentInvocationAdmission.flushObservations()
    )
    await runDestroyStep('cronJobs.detachResume', () => {
      powerMonitor.off('resume', onSystemResume)
    })
    await runDestroyStep('cronJobs.destroy', () => cronJobs.destroy())
    await runDestroyStep('remoteService.destroy', () => remoteService.destroy())
    await runDestroyStep('remoteAuthWindows.closeAll', () => remoteAuthWindows.closeAll())
    await hookService.stop()
    await pluginService.contextHooks?.stop()
    await runDestroyStep('sessionRuntimes.suspend', () => suspendSessionRuntimes())
    await backgroundExec.shutdown()
    await toolService.shutdownCodeRuntime()
    await coreRuntime.drainInitialization(runDestroyStep)
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
    await runDestroyStep('memoryVectorStores.dispose', () => memoryVectorStores.dispose())
    await runDestroyStep('harnessRuntime.stop', () => harnessRuntime.stop())
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
    await databaseRequests.drainForShutdown()
    dependencies.closeProfile()
    await runDestroyStep('shortcutPresenter.destroy', () => shortcutPresenter.destroy())
    await runDestroyStep('notificationService.clearAllNotifications', () =>
      notificationService.clearAllNotifications()
    )
    await runDestroyStep('trayPresenter.destroy', () => trayPresenter.destroy())
  }

  async function runDestroyStep(stepName: string, step: () => void | Promise<void>): Promise<void> {
    const startedAt = readMonotonicNow()
    logger.info(`[Main] destroy.${stepName} begin`)
    try {
      await step()
      const durationMs = elapsedMonotonicMs(startedAt)
      logger.info(
        durationMs === undefined
          ? `[Main] destroy.${stepName} done`
          : `[Main] destroy.${stepName} done durationMs=${durationMs.toFixed(1)}`
      )
    } catch (error) {
      shutdownStepFailures += 1
      const durationMs = elapsedMonotonicMs(startedAt)
      logger.warn(
        durationMs === undefined
          ? `[Main] destroy.${stepName} failed`
          : `[Main] destroy.${stepName} failed durationMs=${durationMs.toFixed(1)}`,
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
    const pluginRoutes = createPluginRoutes(pluginService, pluginSettingsWindow)
    const skillRoutes = createSkillRoutes({
      tempDirectory: app.getPath('temp'),
      skillService,
      skillSyncService,
      skillSettings,
      ensureInitialized: ensureSkillServicesInitialized,
      assertSessionActiveSkillsMutable: async (conversationId) => {
        const state = await deepChatAgentHarness.getSessionState(conversationId)
        if (state?.status === 'generating') {
          throw new Error('Cannot change Session Skills while the session is generating.')
        }
      },
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
      isSettingsWindow: async (windowId) =>
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
      ownsDraftSession: (sessionId, webContentsId) =>
        sessionLifecycle.ownsDraftSession(sessionId, webContentsId),
      windowPresenter,
      shortcutPresenter,
      browserPresenter: yoBrowserPresenter,
      computerUsePreviewPresenter,
      desktopSessionBinding,
      tabPresenter,
      dialogService,
      settings: appSettingsService,
      appearance: appSettingsService,
      recordActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      }
    })
    const fileRoutes = createFileRoutes(fileService, desktopImageActions)
    const ocrRoutes = createOcrRoutes({ runtime: ocrRuntimeService })
    const toolchainRoutes = createToolchainRoutes({
      service: toolchainService,
      pickPath: () => deviceService.selectFiles({ multiple: false })
    })
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
      tapeInspectorHeadWatcher,
      sessionReferences: sessionData.sessionReferences
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
    const acpRoutes = createAcpRoutes({
      auth: acpAuthService,
      owner: acpRuntimeOwner,
      runtime: acpAgentRuntime,
      isMainWindowContext: async (caller) =>
        windowPresenter.mainWindow?.webContents.id === caller.webContentsId,
      importHistory: async (sessionId) => {
        const localId = toAppSessionId(sessionId)
        const instance = acpAgentRuntime.getHydrated(localId)
        if (!instance) throw new Error('ACP session is not initialized')
        await instance.runIdleOperation(async () => {
          const session = acpRuntimeOwner.getOrCreate().sessionController.getSession(localId)
          const snapshot =
            session &&
            (await acpRuntimeOwner
              .getOrCreate()
              .sessionController.getExtensions(localId, session.agentId))
          if (!session || !snapshot?.history) throw new Error('Read ACP history before importing')
          sessionData.transcript.importAcpHistory(
            sessionId,
            session.agentId,
            session.sessionId,
            snapshot.history
          )
          publishDeepchatEvent('sessions.messages.changed', {
            sessionId,
            messages: sessionData.transcript.getMessages(sessionId),
            version: Date.now()
          })
          publishDeepchatEvent('sessions.updated', { sessionIds: [sessionId], reason: 'updated' })
        })
      }
    })
    const deviceRoutes = createDeviceRoutes({
      device: deviceService,
      restartApplication,
      resetDataByType: (resetType) => resetApplicationData(resetType)
    })
    const onboardingRoutes = createOnboardingRoutes(dependencies.settingsStore)
    const upgradeRoutes = createUpgradeRoutes({
      upgrade: upgradeService,
      settings: appSettingsService
    })
    const exporterRoutes = createExporterRoutes(exporter)
    const syncRoutes = createSyncRoutes({
      sync: syncService,
      settings: syncSettings,
      importFromSync: (backupFileName, importMode) =>
        runDatabaseMaintenance({
          kind: 'import-backup',
          fileName: backupFileName,
          mode: importMode ?? ImportMode.INCREMENT
        }),
      pullLatestBackupFromCloud: (importMode) => pullLatestBackupFromCloud(importMode),
      recordActivity: (input) => {
        void settingsDatabase.recordSettingsActivity(input).catch((error) => {
          console.warn('[SettingsActivity] Failed to record settings activity:', error)
        })
      }
    })
    const syncHostRoutes = createSyncHostRoutes({ host: syncHostService })
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
      appSettings: appSettingsService,
      commandShell: commandShellService,
      publishEvent: publishDeepchatEvent,
      recordActivity: recordSettingsActivity,
      listActivities: (limit) => settingsDatabase.listSettingsActivity(limit)
    })
    const appRoutes = createAppRoutes({
      isPackaged: app.isPackaged,
      logging: { openFolder: () => appSettingsService.openLoggingFolder() },
      rendererPerformance: rendererPerformanceLogService,
      isMainWindowContext: async (caller) =>
        windowPresenter.mainWindow?.webContents.id === caller.webContentsId,
      agentSettings,
      projects: projectService,
      databaseSecurity: databaseSecurityService,
      database: {
        getDatabase: () => mainDatabase.getDatabase(),
        repairSchema: () => runDatabaseMaintenance({ kind: 'repair-schema' })
      },
      startupSession: sessionQuery,
      desktopSession: desktopSessionBinding,
      startup: startupWorkloadCoordinator,
      ensureDefaultWorkspace: () => projectService.ensureDefaultWorkspace(),
      enableDatabaseEncryption: (password) =>
        runDatabaseMaintenance({ kind: 'enable-encryption', password }),
      changeDatabasePassword: (currentPassword, newPassword) =>
        runDatabaseMaintenance({ kind: 'change-password', currentPassword, newPassword }),
      disableDatabaseEncryption: (currentPassword) =>
        runDatabaseMaintenance({ kind: 'disable-encryption', currentPassword }),
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
      appDatabaseMaintenance: databaseRequests,
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
        toolchainRoutes,
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
        syncHostRoutes,
        createSyncPeerRoutes(syncPeerService),
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
      isSettingsWindow: async (windowId) => windowPresenter.getSettingsWindowId() === windowId,
      startupWorkloadCoordinator
    })
    const authorizeRendererIpc = createRendererIpcAuthorizer({
      rendererDirectoryUrl: pathToFileURL(path.join(__dirname, '../renderer/')).href,
      developmentServerUrl: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
      pluginSettingsWindow
    })
    const dispatcher = routeDispatcher
    registerDeepchatRoutes(
      ipcMain,
      (routeName, input, context) => dispatchDeepchatRoute(dispatcher, routeName, input, context),
      authorizeRendererIpc
    )
    registerClipboardIpc(ipcMain, authorizeRendererIpc)
  }

  function setupApplicationListeners(): void {
    app.on('accessibility-support-changed', (_event, enabled) => {
      publishDeepchatEvent('appRuntime.accessibilityChanged', { enabled })
    })

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
      reportMainStartupComponentFailure(
        dependencies.startupRunId,
        'acp_registry_migration',
        'persistence'
      )
      console.error('Failed to migrate ACP registry references:', error)
    }

    try {
      await service.compensateEnabledRegistryAgentInstalls()
    } catch (error) {
      reportMainStartupComponentFailure(
        dependencies.startupRunId,
        'acp_install_compensation',
        'persistence'
      )
      console.error('Failed to compensate ACP install states:', error)
    }
  }

  function scheduleBackgroundWork(startupRunId: string): void {
    scheduleMainStartupTask(
      startupRunId,
      {
        id: 'main:legacy-import',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.legacyImport',
        run: async () => legacyChatImportService.start(false)
      },
      'Failed to start legacy import task:',
      { component: 'legacy_import', category: 'persistence' }
    )

    scheduleMainStartupTask(
      startupRunId,
      {
        id: 'main:usage-stats-backfill',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.usageStatsBackfill',
        run: async (taskContext) => usageStatsService.startBackfill(taskContext)
      },
      'Failed to start usage stats backfill:',
      { component: 'usage_stats_backfill', category: 'persistence' }
    )

    scheduleMainStartupTask(
      startupRunId,
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
      'Failed to start normalization backfill:',
      { component: 'sqlite_mainline_normalization', category: 'persistence' }
    )

    scheduleMainStartupTask(
      startupRunId,
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
      'Failed to start disabled agent tool capability cleanup:',
      { component: 'disabled_agent_tool_capability_cleanup', category: 'persistence' }
    )

    scheduleMainStartupTask(
      startupRunId,
      {
        id: 'main:toolchain-gc',
        target: 'main',
        phase: 'background',
        resource: 'io',
        labelKey: 'startup.main.toolchainGc',
        run: async (taskContext) => {
          await taskContext.yield()
          toolchainService.gcUnreachableTrees()
        }
      },
      'Failed to collect unused toolchain trees:',
      { component: 'toolchain_gc', category: 'resource' }
    )
  }

  const shutdownCoordinator = new MainShutdownCoordinator(
    async () => {
      shutdownStepFailures = 0
      appLifecycleState = 'stopping'
      desktopConfigurationHost.close()
      deeplinkService.observeMcpReadiness(false)
      databaseRequests.beginShutdown()
      providerDbLoader.stop()
      agentSettings.stop()
      deepChatAgentHarness.abortGenerations()
      backgroundExec.stop()
      toolService.stopCodeRuntime()
      databaseSecurityService.stop()
      dependencies.secretStore.pause()
      windowPresenter.setApplicationQuitting(true)
      startupWorkloadCoordinator.cancelTarget('main')
      await runDestroyStep('acpAuth.shutdown', () => acpAuthService.shutdown())
      try {
        await destroy()
      } finally {
        unsubscribeStartupWorkload()
        appLifecycleState = 'stopped'
      }
      return shutdownStepFailures === 0 ? 'completed' : 'failed'
    },
    {
      started: (reason) => mainLogger.emit('app.shutdown.started', { reason }),
      terminal: (observation) => {
        if (observation.outcome === 'completed') {
          mainLogger.emit('app.shutdown.terminal', {
            outcome: 'completed',
            ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs })
          })
          return
        }
        mainLogger.emit('app.shutdown.terminal', {
          outcome: 'failed',
          ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
          error: { category: 'unknown' }
        })
      },
      actionFailed: (observation) => {
        mainLogger.emit('app.shutdown.action.failed', {
          reason: observation.reason,
          ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
          error: classifyMainLogError(observation.error)
        })
      }
    }
  )

  function stop(reason: MainLogShutdownReason): Promise<MainShutdownActionClaim | undefined> {
    return shutdownCoordinator.request(reason)
  }

  function stopForCleanup(): Promise<void> {
    return shutdownCoordinator.cleanup()
  }

  function runDatabaseMaintenance(command: DatabaseImportCommand): Promise<SyncImportResult>
  function runDatabaseMaintenance(
    command: DatabaseEncryptionCommand
  ): Promise<DatabaseSecurityStatus>
  function runDatabaseMaintenance(command: DatabaseRepairCommand): Promise<DatabaseRepairReport>
  async function runDatabaseMaintenance(
    command: DatabaseMaintenanceCommand
  ): Promise<DatabaseMaintenanceResult> {
    if (['stopping', 'stopped'].includes(appLifecycleState)) {
      throw new Error(`App lifecycle is ${appLifecycleState}`)
    }
    const maintenanceState = databaseRequests.state
    if (maintenanceState !== 'running') {
      throw new Error(`App database maintenance is ${maintenanceState}`)
    }
    if (syncService.isBackupInProgress()) throw new Error('sync.tunnel.error.busy')
    try {
      return await databaseRequests.runMaintenance(() => performDatabaseMaintenance(command))
    } catch (error) {
      if (
        databaseRequests.state === 'failed' &&
        !['stopping', 'stopped'].includes(appLifecycleState)
      )
        await stopForCleanup()
      throw error
    }
  }

  async function performDatabaseMaintenance(
    command: DatabaseMaintenanceCommand
  ): Promise<DatabaseMaintenanceResult> {
    desktopConfigurationHost.pause()
    try {
      await providerRuntime.invalidateGitHubCopilotSignIns()
      await startupWorkloadCoordinator.cancelAndDrainTarget('main')
      await agentSettings.cancelAndDrainAcpWork()
      if (['stopping', 'stopped'].includes(appLifecycleState)) {
        throw new Error(`App lifecycle is ${appLifecycleState}`)
      }
    } catch (error) {
      if (databaseRequests.state === 'maintenance') {
        databaseRequests.resume()
        desktopConfigurationHost.resume()
        agentSettings.notifyAgentCatalogChanged()
      }
      throw error
    }

    let operationResult: DatabaseMaintenanceResult | undefined
    let operationError: unknown
    try {
      nativeSettings.stopWrites()
      await appSettingsService.stop()
      await nativeSettings.drainWrites()
      dependencies.secretStore.pause()
      replicaEndpoint.stop()
      await automaticSync?.pause()
      memoryService.stopBackgroundMaintenance()
      await liveDelegationService.stop()
      await cronJobs.stop()
      await remoteService.destroy()
      await remoteAuthWindows.closeAll()
      await hookService.stop()
      await pluginService.contextHooks?.stop()
      const drain = await memoryIngestionObserver.drainAndFence()
      if (drain.timedOut) {
        throw new Error(
          `Memory ingestion did not drain for sessions: ${drain.pendingSessions.join(', ')}`
        )
      }
      const pendingMaintenanceAgents = await memoryService.drainBackgroundMaintenance()
      if (pendingMaintenanceAgents.length > 0) {
        throw new Error(
          `Memory maintenance did not drain for agents: ${pendingMaintenanceAgents.join(', ')}`
        )
      }
      await suspendSessionRuntimes()
      await databaseRequests.drain()
      if (['stopping', 'stopped'].includes(appLifecycleState)) {
        throw new Error(`App lifecycle is ${appLifecycleState}`)
      }
      const database: ApplicationDatabaseMaintenancePort = {
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
      }
      switch (command.kind) {
        case 'import-backup-file':
          operationResult = await syncService.importBackupFile(
            command.filePath,
            command.mode,
            database
          )
          break
        case 'import-backup':
          operationResult = await syncService.importFromSync(
            command.fileName,
            command.mode,
            database
          )
          break
        case 'enable-encryption':
          operationResult = await databaseSecurityService.enableEncryption({
            password: command.password,
            database,
            providerSettings
          })
          break
        case 'change-password':
          operationResult = await databaseSecurityService.changePassword({
            currentPassword: command.currentPassword,
            newPassword: command.newPassword,
            database,
            providerSettings
          })
          break
        case 'disable-encryption':
          operationResult = await databaseSecurityService.disableEncryption({
            currentPassword: command.currentPassword,
            database,
            providerSettings
          })
          break
        case 'repair-schema':
          operationResult = await mainDatabase.repairSchema()
          break
        default:
          throw new Error('Unsupported database maintenance command')
      }
    } catch (error) {
      operationError = error
    }

    try {
      if (['stopping', 'stopped'].includes(appLifecycleState)) {
        throw new Error(`App lifecycle is ${appLifecycleState}`)
      }
      if (!mainDatabase.getDatabase().open) {
        reopenApplicationDatabase()
      }
      deepChatAgentHarness.reconcileAfterDatabaseReopen()
      dependencies.secretStore.resume()
      memoryIngestionObserver.resumeIngestion()
      memoryService.startBackgroundMaintenance()
      pluginService.contextHooks?.start()
      hookService.start()
      cronJobs.start()
      await remoteService.initialize()
      if (['stopping', 'stopped'].includes(appLifecycleState)) {
        await remoteService.destroy()
        await remoteAuthWindows.closeAll()
        throw new Error(`App lifecycle is ${appLifecycleState}`)
      }
      liveDelegationService = createLiveDelegationService()
      liveDelegationService.start()
      const startupRunId = startupWorkloadCoordinator.createRun('main')
      scheduleBackgroundWork(startupRunId)
      appSettingsService.start()
      databaseRequests.resume()
      await appSettingsService.publishSnapshot()
      await appSettingsService.observeSystemTheme()
      nativeSettings.startWrites()
      agentSettings.notifyAgentCatalogChanged()
      syncReplica?.wake()
      await automaticSync?.start()
      desktopConfigurationHost.resume()
    } catch (error) {
      if (!['stopping', 'stopped'].includes(appLifecycleState)) databaseRequests.fail()
      throw error
    }

    if (operationError) throw operationError
    if (operationResult === undefined) throw new Error('Database maintenance returned no result')
    return operationResult
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
    const result = await runDatabaseMaintenance({
      kind: 'import-backup',
      fileName: backupFileName,
      mode: importMode
    })
    return { ...result, fileName: backupFileName }
  }

  async function resetApplicationData(
    resetType: 'chat' | 'knowledge' | 'config' | 'all'
  ): Promise<void> {
    let actionClaim: MainShutdownActionClaim | undefined
    try {
      await coordinateApplicationDataReset(resetType, {
        cliLauncher: cliLauncherService,
        logger,
        stop: async () => {
          actionClaim = await stop('data_reset')
          if (!actionClaim) throw new Error('Application shutdown is already owned')
        },
        resetDataByType: (type) => {
          if (!actionClaim) throw new Error('Application shutdown claim is unavailable')
          return actionClaim.run(() => deviceService.resetDataByType(type))
        }
      })
    } catch (error) {
      actionClaim?.abandon()
      throw error
    }
  }

  async function restartApplication(): Promise<void> {
    const actionClaim = await stop('restart')
    if (!actionClaim) throw new Error('Application shutdown is already owned')
    await actionClaim.run(() => deviceService.restartApp())
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
    stop,
    stopForCleanup
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
  desktopConfigurationHost.resume()
  onSystemThemeUpdated()
  try {
    await artifactSpool.initialize()
    await cliServer.start()
  } catch (error) {
    reportMainStartupComponentFailure(dependencies.startupRunId, 'cli_control', 'unknown')
    logger.error('[CLI] Failed to start local control server', error)
  }
  try {
    await syncHostService.startIfEnabled()
  } catch (error) {
    reportMainStartupComponentFailure(dependencies.startupRunId, 'sync_host', 'unknown')
    logger.error('[SyncHost] Failed to start host mode', error)
  }
  try {
    await automaticSync?.start()
  } catch (error) {
    logger.error('[SyncReplica] Failed to start automatic sync', error)
  }
  if (cliServer.getStatus().running) {
    try {
      await cliLauncherService.ensureInstalled()
    } catch (error) {
      reportMainStartupComponentFailure(dependencies.startupRunId, 'cli_launcher', 'unknown')
      logger.warn('[CLI] Failed to install or refresh the command launcher', error)
    }
  }
  init(dependencies.startupRunId)
  scheduleBackgroundWork(dependencies.startupRunId)
  return control
}
