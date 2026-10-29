import { createCoreController } from '../../harness/core/controller'
import type { OAuthService } from '../../harness/core/oauth'
import { createCoreMaintenance } from '../../harness/core/maintenance'
import { createCoreSettings } from '../../harness/core/settings'
import { createCoreRuntime } from '../../harness/core/runtime'
import { spawnFileWatcherHost } from './fileWatcherHost'
import { listFileOpenApps, openFileWithApp } from '../workspace/openInApp'
import { createCoreProviders } from '../../harness/core/providers'
import { createCoreData } from '../../harness/core/data'

import { SyncReplicaStore } from '@/sync/replica/store'

import { AutomaticSync } from '@/sync/replica/automatic'
import { SyncPeerService } from '../sync/peer'

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
  type SafeLogError
} from '@/logging/mainLogEvents'

import {
  approvalClosedEvent,
  approvalRequestedEvent,
  settingsChangedEvent,
  sessionsTapeInspectorHeadChangedEvent
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

import type { WorkspaceServicePort } from '@shared/types/workspace'
import type { SkillMetadataSnapshotPort, SkillServicePort } from '@shared/types/skill'
import type { SkillSyncServicePort } from '@shared/types/skillSync'

import type {
  IShortcutPresenter,
  IWindowPresenter,
  IYoBrowserPresenter
} from '@shared/types/desktop'
import type { DialogServicePort } from '@shared/types/dialog'
import type { KnowledgeServicePort } from '@shared/types/knowledge'

import {
  RutisAgentInvocationAdmission,
  DEFAULT_AGENT_INVOCATION_CAPACITY,
  DEFAULT_AGENT_INVOCATION_MAX_PENDING
} from '@/agent/invocationAdmission'
import { HarnessRuntime } from '../harness/runtime'
import { RutisMemoryVectorStores } from '../harness/memory-vector'

import type { ProviderDatabase } from '../provider/data/database'

import type { ProviderSettings } from '../provider/settings'
import type { SettingsStore } from '../config/settingsStore'
import type { SecretStore } from '../config/secretStore'
import { providerDbLoader, type ProviderDbBootstrap } from '../provider/providerDbLoader'
import { isInsecureTlsAllowed } from '../lib/insecureTls'
import { proxyConfig, ProxyMode } from '../platform/proxy'
import { DeviceService } from '../device'
import { UpgradeService } from '../upgrade'

import { OcrRuntimeService } from '@/ocr/ocrRuntimeService'
import { SafeStorageOcrCacheKeyProvider } from '@/ocr/ocrCacheKeyProvider'

import { McpService } from '../mcp'

import { credentialCrypto, secureCredentialCrypto } from './credentialCrypto'

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
import { DesktopConfigurationHost } from '../desktop/configurationHost'
import { DesktopConfigurationProjection } from '../desktop/configurationProjection'
import { DesktopRemoteAuthWindows } from '../desktop/remoteAuthWindows'
import { DesktopImageActions } from '../desktop/imageActions'
import { TabPresenter } from '../desktop/tab'
import type { DesktopSessionBinding } from '@/desktop/sessionBinding'
import { TrayPresenter } from '../desktop/tray'
import { createGitHubCopilotAuthorization } from '../provider/auth'
import { FloatingButtonPresenter } from '../desktop/floatingButton'
import { YoBrowserPresenter } from '../desktop/browser/YoBrowserPresenter'
import { ComputerUsePreviewPresenter } from '@/desktop/computerUse/ComputerUsePreviewPresenter'
import { AgentPreviewCoordinator } from '@/desktop/preview/AgentPreviewCoordinator'

import { RendererPerformanceLogService } from './rendererPerformanceLogService'
import type { PrivacySettings } from './privacy'
import type { ProxySettings } from '@/platform/proxySettings'
import type { McpSettings } from '@/mcp/settings'
import type { McpAppSandboxRegistry, McpAppDesktopPort } from '@/mcp/apps/sandboxRegistry'
import type { AcpCatalogSettings } from '@/agent/acp/catalog/settings'
import { ToolService } from '../tool'

import { createDesktopRoutes } from '../desktop/routes'

import { createDeviceRoutes } from '../device/routes'

import { createUpgradeRoutes } from '../upgrade/routes'

import { SyncHostService } from '../sync/host'

import { AppSettingsService } from './settingsService'

import { registerClipboardIpc } from './clipboardIpc'
import { createRendererIpcAuthorizer } from './rendererIpcSecurity'
import { ApprovalBroker } from '@/approval'
import {
  CommandPermissionService,
  FilePermissionService,
  SettingsPermissionService
} from '../tool/permission'

import { HookService } from '../hook'

import { SchedulerService } from '../scheduler'

import { spawnSchedulerHost } from './schedulerHost'
import type { AppSessionService } from '@/agent/shared/appSessionService'

import type { SessionQuery } from '@/session/query'

import type { SessionLifecycle } from '@/session/lifecycle'
import type { DeepChatAgentHarness } from '@/agent/deepchat/harness'
import type { RunJournalObservation } from '@/agent/deepchat/runtime/types'

import { isAcpRegistryIconUrl } from '@/agent/acp/catalog/acpRegistryConstants'

import type {
  MemoryIngestionDrainOutcome,
  MemoryIngestionObserver
} from '@/agent/deepchat/memory/memoryIngestionObserver'
import { type MemoryServicePort } from '../memory'
import { ProjectService } from '../project'
import type { SettingsDatabase } from '@/settings/data/database'

import { type LiveDelegationLifecycleObservation } from '@/orchestration/liveDelegationService'

import type { RemoteServiceLike } from '../remote/ports'
import { type PluginServicePort } from '../plugin'
import type { PluginToolPolicyStore } from '@/plugin/toolPolicyStore'

import type { AgentDatabase } from '@/agent/data/database'
import type { MainDatabase } from '../data/mainDatabase'
import { DatabaseSecurityService } from './databaseSecurity'

import type { SessionUiPort } from '../session/contracts'
import { StartupWorkloadCoordinator } from '../app/startupWorkloadCoordinator'

import { dispatchDeepchatRoute, type RouteDispatcher } from '@/routes'
import { registerDeepchatRoutes } from './routeIpc'

import { coordinateApplicationDataReset } from './applicationDataReset'
import { AgentCliTokenAuthority, ArtifactSpool } from '@/cli'

import { spawnBackgroundExecHost } from './backgroundExecHost'
import { spawnCodeModeHost } from './codeModeHost'
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

export interface MainProcessControl {
  resolveWorkspacePreviewRequest(url: string): Promise<string | null>
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
  let windowPresenter: IWindowPresenter
  let providerSettings: ProviderSettings
  let deviceService: DeviceService
  let upgradeService: UpgradeService
  let shortcutPresenter: IShortcutPresenter
  let ocrRuntimeService: OcrRuntimeService
  let mcpService: McpService
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
  let sessionLifecycle: SessionLifecycle
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
  let appSessionService: AppSessionService
  let routeDispatcher: RouteDispatcher | undefined
  let appLifecycleState: 'starting' | 'running' | 'stopping' | 'stopped' = 'starting'
  const isStopping = () => appLifecycleState === 'stopping' || appLifecycleState === 'stopped'
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
  const artifactSpool = new ArtifactSpool({
    directory: path.join(app.getPath('userData'), 'local-control', 'artifacts'),
    consumeAgentBytes: (tokenId, bytes) => agentCliTokenAuthority.consumeBytes(tokenId, bytes),
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
  const { tapeInspectorHeadWatcher, settingsDatabase } = coreData
  const desktopConfigurationHost = new DesktopConfigurationHost(
    app.getPath('userData'),
    setMainLoggingEnabled,
    restartApplication
  )
  const coreSettings = createCoreSettings({
    profile: dependencies,
    homeDirectory: app.getPath('home'),
    desktop: {
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
    publishEvent: publishDeepchatEvent,
    logging: desktopConfigurationHost,
    enumerateFonts: () => desktopConfigurationHost.listSystemFonts(),
    publishNativeSnapshot: (snapshot) => nativeSettings.apply(snapshot),
    nextVersion: nextSettingsVersion,
    assertActive: () => {
      databaseRequests.assertRouteAllowed('settings.update')
      if (databaseRequests.state !== 'running')
        throw new Error(`App database maintenance is ${databaseRequests.state}`)
    }
  })
  const { desktopSettings, skillSettings } = coreSettings
  appSettingsService = coreSettings.appSettingsService

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
    unsubscribeProviderDbCatalog
  } = coreProviders
  deviceService = new DeviceService()
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
  nativeSettings = new DesktopConfigurationProjection(
    appSettingsService.readNativeSnapshot(),
    () => nativeTheme.shouldUseDarkColors,
    (bounds) => appSettingsService.setFloatingButtonBounds(bounds)
  )
  shortcutPresenter = new ShortcutPresenter(nativeSettings, windowPresenter, publishDeepchatEvent)
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
    settings: coreSettings,
    workspaceDesktop: {
      revealFile: async (filePath) => shell.showItemInFolder(filePath),
      openFile: (filePath) => shell.openPath(filePath),
      listFileOpenApps,
      openFileWithApp
    },
    spawnFileWatcherHost: (kind, signal) =>
      spawnFileWatcherHost(
        path.join(app.getAppPath(), 'out/main/fileWatcherUtilityHost.js'),
        kind,
        signal
      ),
    artifactSpool,
    resolveRouteDispatcher: () => routeDispatcher,
    startupWorkloadCoordinator,
    startupRunId: dependencies.startupRunId,
    initializeFloatingButton,
    ocrCacheKeyProvider: new SafeStorageOcrCacheKeyProvider(
      path.join(app.getPath('userData'), 'ocr', 'cache-key.json')
    ),
    approvalPresentation: {
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
        if (
          !readyTarget ||
          readyTarget.kind !== 'main' ||
          readyTarget.windowId !== target.windowId
        ) {
          return
        }
        await semanticNotificationTargets.sendDeepchatEvent(
          readyTarget,
          approvalClosedEvent.name,
          payload
        )
      }
    },
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
      sendSettingsNavigation: async (windowId, navigation) =>
        windowPresenter.sendSettingsNavigation(windowId, navigation)
    },
    pluginSettingsWindow,
    remoteAuthWindows,
    remoteSessionWindow: {
      select: async () => {
        if (isStopping()) return null
        const chatWindows = windowPresenter
          .getAllWindows()
          .filter(
            (window) =>
              !window.isDestroyed() &&
              !window.webContents.isDestroyed() &&
              tabPresenter.getWindowType(window.id) === 'chat'
          )
        const focusedWindow = windowPresenter.getFocusedWindow()
        const targetWindow =
          chatWindows.find((window) => window.id === focusedWindow?.id) ?? chatWindows[0]
        const windowId =
          targetWindow?.id ?? (await windowPresenter.createAppWindow({ initialRoute: 'chat' }))
        if (isStopping()) return null
        const window = windowPresenter.getAllWindows().find((window) => window.id === windowId)
        if (
          !window ||
          window.isDestroyed() ||
          window.webContents.isDestroyed() ||
          tabPresenter.getWindowType(window.id) !== 'chat'
        )
          return null
        return { windowId: window.id, webContentsId: window.webContents.id }
      },
      present: async (target) => {
        if (isStopping()) return false
        const window = windowPresenter
          .getAllWindows()
          .find((window) => window.id === target.windowId)
        if (
          !window ||
          window.isDestroyed() ||
          window.webContents.isDestroyed() ||
          window.webContents.id !== target.webContentsId ||
          tabPresenter.getWindowType(window.id) !== 'chat'
        )
          return false
        windowPresenter.show(window.id, true)
        return true
      }
    },
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
    agentCliTokenAuthority,
    sessionUiPort,
    publishEvent: publishDeepchatEvent,
    isStopping,
    mcpReadinessChanged: (ready) => deeplinkService.observeMcpReadiness(ready),
    reportStartupFailure: (component, category, failure) => {
      reportMainStartupComponentFailure(
        failure?.startupRunId ?? dependencies.startupRunId,
        component,
        category
      )
      if (failure) reportNativeMainError(failure.message, failure.error)
    }
  })
  const { cliServer, cliLauncherService, cliAuditLog, cliMutationGuard } = coreRuntime
  commandPermissionService = coreRuntime.commandPermissionService
  filePermissionService = coreRuntime.filePermissionService
  settingsPermissionService = coreRuntime.settingsPermissionService
  approvalBroker = coreRuntime.approvalBroker
  ocrRuntimeService = coreRuntime.ocrRuntimeService
  handleApprovalRendererUnavailable = (webContentsId) => {
    cliMutationGuard.cancelRenderer(webContentsId)
  }
  const { replicaEndpoint, backgroundExec, fileWatcherService, ensureSkillServicesInitialized } =
    coreRuntime
  projectService = coreRuntime.projectService
  syncPeerService = coreRuntime.syncPeerService
  syncReplica = coreRuntime.syncReplica
  automaticSync = coreRuntime.automaticSync
  syncHostService = coreRuntime.syncHostService
  knowledgeService = coreRuntime.knowledgeService
  mcpService = coreRuntime.mcpService
  workspaceService = coreRuntime.workspaceService
  skillService = coreRuntime.skillService
  skillSyncService = coreRuntime.skillSyncService
  toolService = coreRuntime.toolService
  pluginService = coreRuntime.pluginService
  hookService = coreRuntime.hookService
  memoryService = coreRuntime.memoryService
  remoteService = coreRuntime.remoteService
  cronJobs = coreRuntime.cronJobs
  const coreExecution = coreRuntime.execution
  agentSettings.start()
  deepChatAgentHarness = coreExecution.deepChatAgentHarness
  memoryIngestionObserver = coreExecution.memoryIngestionObserver
  sessionQuery = coreExecution.sessionQuery
  desktopSessionBinding = coreExecution.desktopSessionBinding
  sessionLifecycle = coreExecution.sessionLifecycle
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

  async function initializeFloatingButton() {
    try {
      await floatingButtonPresenter.initialize()
      logger.info('FloatingButtonPresenter initialized successfully')
    } catch (error) {
      reportMainStartupComponentFailure(dependencies.startupRunId, 'floating_widget', 'resource')
      console.error('Failed to initialize FloatingButtonPresenter:', error)
    }
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
    await runDestroyStep('liveDelegationService.stop', () =>
      coreExecution.liveDelegationService.stop()
    )
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

  const maintenance = createCoreMaintenance({
    profile: dependencies,
    data: coreData,
    providers: coreProviders,
    settings: coreSettings,
    runtime: coreRuntime,
    databaseRequests,
    startupWorkloadCoordinator,
    native: {
      configurationHost: {
        pause: async () => desktopConfigurationHost.pause(),
        resume: async () => desktopConfigurationHost.resume(),
        stopWrites: async () => nativeSettings.stopWrites(),
        drainWrites: async () => await nativeSettings.drainWrites(),
        startWrites: async () => nativeSettings.startWrites()
      },
      remoteAuthWindows
    },
    isStopping,
    stopForCleanup
  })
  const { run: runDatabaseMaintenance, suspendSessionRuntimes } = maintenance

  function registerRoutes(): void {
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
    const deviceRoutes = createDeviceRoutes({
      device: deviceService,
      restartApplication,
      resetDataByType: (resetType) => resetApplicationData(resetType)
    })
    const upgradeRoutes = createUpgradeRoutes({
      upgrade: upgradeService,
      settings: appSettingsService
    })
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
    const controller = createCoreController({
      profile: dependencies,
      data: coreData,
      providers: coreProviders,
      settings: coreSettings,
      runtime: coreRuntime,
      bootstrap: {
        temporaryDirectory: app.getPath('temp'),
        isPackaged: app.isPackaged,
        appVersion: app.getVersion()
      },
      databaseRequests,
      startupWorkloadCoordinator,
      artifactSpool,
      maintenance,
      nativeRouteMaps: [desktopRoutes, deviceRoutes, upgradeRoutes, notificationRoutes],
      native: {
        isSettingsWindow: async (id) => id != null && windowPresenter.getSettingsWindowId() === id,
        isMainWindowContext: async (caller) =>
          windowPresenter.mainWindow?.webContents.id === caller.webContentsId,
        rendererPerformance: rendererPerformanceLogService,
        splash: dependencies.splash,
        pluginSettingsWindow,
        images: desktopImageActions,
        pickToolchainPath: () => deviceService.selectFiles({ multiple: false }),
        hasTrustedRenderer: async () =>
          (await semanticNotificationTargets.getExistingTargets()).some(
            (target) => target.kind === 'main'
          ),
        applyProxy: async (mode, url, resolve) => {
          proxyConfig.setCustomProxyUrl(url)
          proxyConfig.setProxyMode(mode as ProxyMode)
          return resolve ? await proxyConfig.resolveProxy() : false
        },
        copilotAuthorization: createGitHubCopilotAuthorization()
      },
      publishEvent: publishDeepchatEvent
    })
    routeDispatcher = controller.routeDispatcher
    oauthService = controller.oauthService
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

  const control: MainProcessControl = {
    resolveWorkspacePreviewRequest: (url) =>
      coreRuntime.workspaceService.resolvePreviewRequest(url),
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
  await coreRuntime.initializeStartup()

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
  coreRuntime.startStartupTasks()
  coreRuntime.scheduleBackgroundWork()
  return control
}
