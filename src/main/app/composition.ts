import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  safeStorage,
  shell,
  webContents as electronWebContents
} from 'electron'
import { optimizer } from '@electron-toolkit/utils'
import logger from '@shared/logger'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import {
  approvalClosedEvent,
  approvalRequestedEvent,
  createDeepchatEventEnvelope,
  type DeepchatEventName
} from '@shared/contracts/events'
import {
  configGetAcpRegistryIconMarkupRoute,
  sessionsGetWidgetSnapshotRoute,
  sessionsOpenDesktopRoute
} from '@shared/contracts/routes'
import { NativeConfigurationSnapshotSchema } from '@shared/harness/configuration'
import {
  EpisodeRegistry,
  TimeoutNotificationScheduler,
  systemNotificationClock
} from '@shared/notifications'
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
import type { RunJournalObservation } from '@/agent/deepchat/runtime/types'
import type { LiveDelegationLifecycleObservation } from '@/orchestration/liveDelegationService'
import { isAcpRegistryIconUrl } from '@/agent/acp/catalog/acpRegistryConstants'
import {
  DEFAULT_AGENT_INVOCATION_CAPACITY,
  DEFAULT_AGENT_INVOCATION_MAX_PENDING
} from '@/agent/invocationAdmission'
import { CoreRuntimeConnection, createCoreProfileNative } from '../harness/core'
import { createCoreConfigurationNative } from '../harness/configuration'
import { CoreDesktopNative } from '../harness/desktop'
import { CoreBrowserNative } from '../harness/browser'
import { CoreHelperNative } from '../harness/helpers'
import { HarnessRuntime } from '../harness/runtime'
import type { CoreKernelNative } from '../../harness/core/kernel'
import { WindowPresenter } from '../desktop/window'
import { TabPresenter } from '../desktop/tab'
import { ShortcutPresenter } from '../desktop/shortcut'
import { NotificationService } from '../desktop/notification'
import { TrayPresenter } from '../desktop/tray'
import { FloatingButtonPresenter } from '../desktop/floatingButton'
import { DialogService } from '../desktop/dialog'
import { YoBrowserPresenter } from '../desktop/browser/YoBrowserPresenter'
import { ComputerUsePreviewPresenter } from '../desktop/computerUse/ComputerUsePreviewPresenter'
import { AgentPreviewCoordinator } from '../desktop/preview/AgentPreviewCoordinator'
import { PluginSettingsWindow } from '../desktop/pluginSettingsWindow'
import { DesktopRemoteAuthWindows } from '../desktop/remoteAuthWindows'
import { DesktopConfigurationHost } from '../desktop/configurationHost'
import { DesktopConfigurationProjection } from '../desktop/configurationProjection'
import { DesktopImageActions } from '../desktop/imageActions'
import { DeviceService } from '../device'
import { UpgradeService } from '../upgrade'
import { DeeplinkService } from '../deeplink'
import { createDeeplinkActions } from '../deeplink/actions'
import {
  AggregatedWindowNotificationDiagnostics,
  ElectronWindowNotificationTargets,
  WindowNotificationRouter,
  createNotificationRoutes,
  type SemanticNotificationPublisher
} from '../notifications'
import { createDesktopRoutes } from '../desktop/routes'
import { createDeviceRoutes } from '../device/routes'
import { createUpgradeRoutes } from '../upgrade/routes'
import { createRouteRegistry, type RouteContext } from '../routes/routeRegistry'
import type { DeepchatRouteName } from '@shared/contracts/routes'
import type { McpAppSandboxPort, McpAppDesktopPort } from '../mcp/apps/sandboxRegistry'
import { SafeStorageOcrCacheKeyProvider } from '../ocr/ocrCacheKeyProvider'
import { credentialCrypto, secureCredentialCrypto } from './credentialCrypto'
import { ProxyConfig, ProxyMode } from '../platform/proxy'
import { isInsecureTlsAllowed } from '../lib/insecureTls'
import { createGitHubCopilotAuthorization } from '../provider/auth'
import { spawnBackgroundExecHost } from './backgroundExecHost'
import { spawnCodeModeHost } from './codeModeHost'
import { spawnSchedulerHost } from './schedulerHost'
import { spawnFileWatcherHost } from './fileWatcherHost'
import { listFileOpenApps, openFileWithApp } from '../workspace/openInApp'
import { CliLauncherService, resolveBundledCliDirectory } from '../cli'
import { RendererPerformanceLogService } from './rendererPerformanceLogService'
import { registerClipboardIpc } from './clipboardIpc'
import { createRendererIpcAuthorizer, isRendererWindowCurrent } from './rendererIpcSecurity'
import { registerDeepchatRoutes } from './routeIpc'
import { coordinateApplicationDataReset } from './applicationDataReset'
import { MainShutdownCoordinator, type MainShutdownActionClaim } from './mainShutdownCoordinator'
import { activateAppOnMac } from '../lib/activateApp'
import { awaitWithAbort } from '../lib/awaitWithAbort'
import { elapsedMonotonicMs, readMonotonicNow } from '../lib/monotonicTime'

export interface MainProcessControl {
  readonly mcpAppSandbox: McpAppSandboxPort
  resolveWorkspacePreviewRequest(url: string): Promise<string | null>
  focusPrimaryWindow(): void
  handleDeepLink(url: string): Promise<void>
  clearPermissionCaches(): Promise<void>
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
  mcpAppDesktop: McpAppDesktopPort
  startupRunId: string
  requestUpdateInstall: (installAction: () => void) => Promise<void>
  onWindowCreated: (isMainWindow: boolean) => void
  splash: import('./splashWindow').SplashWindow
  bindControl: (control: MainProcessControl) => void
}): Promise<MainProcessControl> {
  let appLifecycleState: 'starting' | 'running' | 'stopping' | 'stopped' = 'starting'
  const isStopping = () => appLifecycleState === 'stopping' || appLifecycleState === 'stopped'
  let nativeSettings: DesktopConfigurationProjection
  let floatingButtonPresenter: FloatingButtonPresenter
  let windowPresenter: WindowPresenter
  let tabPresenter: TabPresenter
  let core: CoreRuntimeConnection | undefined
  const proxyConfig = new ProxyConfig((error) => core?.invalidateNative(error))
  let nativeDesktop: CoreDesktopNative | undefined
  let nativeBrowser: CoreBrowserNative | undefined
  let nativeHelpers: CoreHelperNative | undefined
  let cleanup: (() => Promise<void>) | undefined
  let shutdownStepFailures = 0
  const widgetRoutesReady = Promise.withResolvers<CoreRuntimeConnection>()
  void widgetRoutesReady.promise.catch(() => {})
  const publishDeepchatEvent = (name: DeepchatEventName, payload: unknown): void => {
    windowPresenter.sendToAllWindows(
      DEEPCHAT_EVENT_CHANNEL,
      createDeepchatEventEnvelope(name, payload)
    )
  }
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
  const harnessDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'harness')
    : path.join(app.getAppPath(), 'out', 'harness')
  process.env.DEEPCHAT_HARNESS_EXECUTABLE = path.join(
    harnessDirectory,
    `deepchat-harness-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
  )
  const harnessRuntime = await HarnessRuntime.start({
    directory: harnessDirectory,
    electronExecutable: process.execPath,
    capacity: DEFAULT_AGENT_INVOCATION_CAPACITY,
    maxPending: DEFAULT_AGENT_INVOCATION_MAX_PENDING,
    observe: admissionDiagnostics.observe
  })
  try {
    const desktopConfigurationHost = new DesktopConfigurationHost(
      app.getPath('userData'),
      setMainLoggingEnabled,
      restartApplication
    )
    const profileNative = createCoreProfileNative(
      {
        ...credentialCrypto,
        getBackend: async () =>
          process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
      },
      {
        setLoggingEnabled: async (enabled) => setMainLoggingEnabled(enabled),
        showDatabaseUnlockProgress: async (payload, options) =>
          dependencies.splash.showDatabaseUnlockProgress(payload, options),
        requestDatabaseUnlock: (payload) => dependencies.splash.requestDatabaseUnlock(payload),
        requestDatabaseRecovery: (payload) => dependencies.splash.requestDatabaseRecovery(payload),
        quit: async () => app.quit()
      },
      (observation) => mainLogger.emit('database.initialization.terminal', observation)
    )
    const configurationNative = createCoreConfigurationNative({
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
      publishNativeSnapshot: (snapshot) => nativeSettings.apply(snapshot)
    })
    const connection = await CoreRuntimeConnection.connect({
      runtime: harnessRuntime,
      temporaryDirectory: app.getPath('temp'),
      native: async (method, args) => {
        if (method === 'configuration') return await configurationNative(method, args)
        if (method === 'desktop' && nativeDesktop) return await nativeDesktop.invoke(args)
        if (method === 'browser' && nativeBrowser) return await nativeBrowser.invoke(args)
        if (method === 'helpers' && nativeHelpers) return await nativeHelpers.invoke(args)
        return await profileNative(method, args)
      },
      onFailure: (error) => {
        if (appLifecycleState === 'starting' || appLifecycleState === 'stopped') return
        reportNativeMainError('Core generation failed:', error)
        void stopForCleanup().then(
          () => app.exit(1),
          (retirementError) => {
            reportNativeMainError('Core failure retirement failed:', retirementError)
            app.exit(1)
          }
        )
      }
    })
    core = connection
    await connection.openProfile({
      userDataDirectory: app.getPath('userData'),
      homeDirectory: app.getPath('home'),
      currentAppVersion: app.getVersion(),
      systemLocale: app.getLocale(),
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged
    })
    nativeSettings = new DesktopConfigurationProjection(
      NativeConfigurationSnapshotSchema.parse(
        await connection.configure({ operation: 'nativeSnapshot' })
      ),
      () => nativeTheme.shouldUseDarkColors,
      async (bounds) => {
        await connection.configure({ operation: 'floatingBounds', bounds })
      }
    )
    windowPresenter = new WindowPresenter(
      {
        getCloseToQuit: () => nativeSettings.getCloseToQuit(),
        getContentProtectionEnabled: () => nativeSettings.getContentProtectionEnabled()
      },
      dependencies.onWindowCreated,
      async (action) => {
        if (!isStopping()) await connection.host.observeSettingsWindow(action)
      }
    )
    const semanticNotificationScheduler = new TimeoutNotificationScheduler()
    const semanticNotificationEpisodes = new EpisodeRegistry(
      systemNotificationClock,
      semanticNotificationScheduler
    )
    let handleSemanticRendererUnavailable = (_webContentsId: number): void => undefined
    const semanticNotificationTargets = new ElectronWindowNotificationTargets(
      windowPresenter,
      () => tabPresenter,
      (webContentsId) => {
        handleSemanticRendererUnavailable(webContentsId)
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
    const dialogService = new DialogService(publishDeepchatEvent)
    const getDialogParent = () => {
      const parent = windowPresenter.mainWindow
      if (isStopping() || !parent || parent.isDestroyed())
        throw new Error('Native dialog owner is unavailable')
      return parent
    }
    const deviceService = new DeviceService((options) =>
      dialogService.showOpenDialog(getDialogParent(), options)
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
    const upgradeService = new UpgradeService(
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
    const desktopImageActions = new DesktopImageActions(app.getPath('userData'), (options) =>
      dialogService.showSaveDialog(getDialogParent(), options)
    )
    const shortcutPresenter = new ShortcutPresenter(
      nativeSettings,
      windowPresenter,
      publishDeepchatEvent
    )
    const notificationService = new NotificationService(nativeSettings, publishDeepchatEvent)
    const trayPresenter = new TrayPresenter(nativeSettings, windowPresenter)
    const agentPreviewCoordinator = new AgentPreviewCoordinator()
    const yoBrowserPresenter = new YoBrowserPresenter(
      windowPresenter,
      publishDeepchatEvent,
      agentPreviewCoordinator
    )
    const computerUsePreviewPresenter = new ComputerUsePreviewPresenter(
      windowPresenter,
      agentPreviewCoordinator
    )

    const deeplinkActions = createDeeplinkActions({
      window: windowPresenter,
      hasProvider: (providerId) => connection.host.hasProvider(providerId),
      notifications: semanticNotifications
    })
    const deeplinkService = new DeeplinkService(
      deeplinkActions.desktop,
      deeplinkActions.mcp,
      deeplinkActions.provider
    )

    const pluginSettingsWindow = new PluginSettingsWindow()
    const remoteAuthWindows = new DesktopRemoteAuthWindows((event) =>
      nativeDesktop!.publishRemoteAuthWindow(event)
    )
    tabPresenter = new TabPresenter(
      windowPresenter,
      () => deeplinkService.processStartupUrl(),
      (parent, options) => dialogService.showSaveDialog(parent, options)
    )
    ;(windowPresenter as WindowPresenter).bindTabPresenter(tabPresenter)
    floatingButtonPresenter = new FloatingButtonPresenter(
      nativeSettings,
      windowPresenter as WindowPresenter,
      tabPresenter,
      {
        getSnapshot: async (context, assertActive, signal) =>
          sessionsGetWidgetSnapshotRoute.output.parse(
            await invokeWidgetRoute(
              sessionsGetWidgetSnapshotRoute.name,
              {},
              context,
              assertActive,
              signal
            )
          ).snapshot,
        getRegistryIconMarkup: async (agentId, iconUrl, context, assertActive, signal) =>
          configGetAcpRegistryIconMarkupRoute.output.parse(
            await invokeWidgetRoute(
              configGetAcpRegistryIconMarkupRoute.name,
              { agentId, iconUrl },
              context,
              assertActive,
              signal
            )
          ).markup,
        openSession: async (sessionId, context, assertActive, signal) =>
          sessionsOpenDesktopRoute.output.parse(
            await invokeWidgetRoute(
              sessionsOpenDesktopRoute.name,
              { sessionId },
              context,
              assertActive,
              signal
            )
          ).opened
      }
    )
    async function invokeWidgetRoute(
      routeName:
        | 'sessions.getWidgetSnapshot'
        | 'sessions.openDesktop'
        | 'config.getAcpRegistryIconMarkup',
      input: unknown,
      context: RouteContext,
      assertActive: () => void,
      signal: AbortSignal
    ): Promise<unknown> {
      assertActive()
      const owner = await awaitWithAbort(widgetRoutesReady.promise, signal)
      assertActive()
      return await owner.invokeRoute(routeName, input, context, assertActive)
    }
    const kernelNative: CoreKernelNative = {
      workspaceDesktop: {
        revealFile: async (filePath) => shell.showItemInFolder(filePath),
        openFile: (filePath) => shell.openPath(filePath),
        listFileOpenApps,
        openFileWithApp
      },
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
          if (!('windowId' in target)) return false
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
          if (!('windowId' in target)) return
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
      assertSyncTokenStorageAvailable: () => {
        if (
          process.platform === 'linux' &&
          safeStorage.getSelectedStorageBackend() === 'basic_text'
        )
          throw new Error('sync.error.safeStorageUnavailable')
      },
      semanticNotifications,
      secureCrypto: secureCredentialCrypto,
      getProxySnapshot: () => proxyConfig.getProxySnapshot(),
      openExternal: (url) => shell.openExternal(url),
      openPath: (filePath) => shell.openPath(filePath),
      selectDirectory: () => deviceService.selectDirectory(),
      cacheImage: (data, options) => deviceService.cacheImage(data, options),
      initializeFloatingButton,
      ocrCacheKeyProvider: new SafeStorageOcrCacheKeyProvider(
        path.join(app.getPath('userData'), 'ocr', 'cache-key.json')
      ),
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
      mcpAppDesktop: dependencies.mcpAppDesktop,
      publishMcpConsent: (windowId, payload) =>
        windowPresenter.sendToWindow(
          windowId,
          DEEPCHAT_EVENT_CHANNEL,
          createDeepchatEventEnvelope('mcp.app.consent.request', payload)
        ),
      sessionUiPort: {
        refreshSessionUi: () => {
          void floatingButtonPresenter.refreshWidgetState()
        }
      },
      mcpReadinessChanged: (ready) => deeplinkService.observeMcpReadiness(ready),
      reportStartupFailure: (component, category, failure) => {
        reportMainStartupComponentFailure(
          failure?.startupRunId ?? dependencies.startupRunId,
          component,
          category
        )
        if (failure) reportNativeMainError(failure.message, failure.error)
      },
      onSessionInactive: (sessionId) => {
        void yoBrowserPresenter
          .releaseInactivePreview(sessionId)
          .catch((error) =>
            logger.warn('[YoBrowser] Failed to release inactive preview', { sessionId, error })
          )
      },
      renderer: {
        broadcast: (envelope) => windowPresenter.sendToAllWindows(DEEPCHAT_EVENT_CHANNEL, envelope),
        send: (id, envelope) =>
          windowPresenter.sendToWebContents(id, DEEPCHAT_EVENT_CHANNEL, envelope)
      },
      onRendererDestroyed: (id, listener) => {
        const target = electronWebContents.fromId(id)
        if (!target || target.isDestroyed()) {
          queueMicrotask(listener)
          return () => {}
        }
        target.once('destroyed', listener)
        return () => target.removeListener('destroyed', listener)
      },
      sendToRenderer: (id, name, payload) => {
        const target = electronWebContents.fromId(id)
        if (target && !target.isDestroyed())
          target.send(DEEPCHAT_EVENT_CHANNEL, createDeepchatEventEnvelope(name, payload))
      },
      destroySessionBrowser: (id) => yoBrowserPresenter.destroySessionBrowser(id),
      observeDelegation: emitLiveDelegationObservation,
      runJournalObserver: emitRunJournalObservation,
      notifySessionCompletion: async (session) => {
        await notificationService.showSessionCompletion(session)
      },
      providerCrypto: credentialCrypto,
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
      configurationHost: {
        pause: async () => desktopConfigurationHost.pause(),
        resume: async () => desktopConfigurationHost.resume(),
        stopWrites: async () => nativeSettings.stopWrites(),
        drainWrites: () => nativeSettings.drainWrites(),
        startWrites: async () => nativeSettings.startWrites()
      },
      isSettingsWindow: async (id) => id != null && windowPresenter.getSettingsWindowId() === id,
      isMainWindowContext: async (caller) =>
        windowPresenter.mainWindow?.webContents.id === caller.webContentsId,
      rendererPerformance: rendererPerformanceLogService,
      splash: dependencies.splash,
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
      copilotAuthorization: createGitHubCopilotAuthorization(),
      sessionPresentation: {
        focusBrowser: async (sessionId, caller) =>
          !isStopping() &&
          isRendererWindowCurrent(caller) &&
          caller.windowId != null &&
          yoBrowserPresenter.focusSessionBrowser(sessionId, caller.windowId),
        setComputerUsePreview: async (sessionId, mode, caller) =>
          !isStopping() && isRendererWindowCurrent(caller) && caller.windowId != null
            ? await computerUsePreviewPresenter.setPreviewMode(sessionId, mode, caller.windowId)
            : { updated: false, surface: 'none' },
        dismissComputerUsePreview: async (sessionId, runId, caller) =>
          !isStopping() &&
          isRendererWindowCurrent(caller) &&
          computerUsePreviewPresenter.dismissPreview(sessionId, runId)
      }
    }
    nativeDesktop = new CoreDesktopNative(
      kernelNative,
      (event) => connection.deliverDesktopEvent(event),
      async () => {
        const results = await Promise.allSettled([
          remoteAuthWindows.closeAll(),
          pluginSettingsWindow.closeAll(),
          proxyConfig.close()
        ])
        const errors = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : []
        )
        if (errors.length)
          throw new AggregateError(errors, 'Native desktop resources did not retire')
      },
      (error) => connection.invalidateNative(error)
    )
    nativeBrowser = new CoreBrowserNative(
      yoBrowserPresenter.toolHandler,
      (event) => connection.deliverBrowserEvent(event),
      async () => {
        computerUsePreviewPresenter.shutdown()
        await yoBrowserPresenter.shutdown()
        await agentPreviewCoordinator.shutdown()
      },
      (error) => connection.invalidateNative(error)
    )
    nativeHelpers = new CoreHelperNative(
      {
        exec: (signal) =>
          spawnBackgroundExecHost(
            path.join(app.getAppPath(), 'out/main/backgroundExecUtilityHost.js'),
            signal
          ),
        code: (signal) =>
          spawnCodeModeHost(path.join(app.getAppPath(), 'out/main/codeModeUtilityHost.js'), signal),
        scheduler: spawnSchedulerHost,
        watcher: (kind, signal) =>
          spawnFileWatcherHost(
            path.join(app.getAppPath(), 'out/main/fileWatcherUtilityHost.js'),
            kind,
            signal
          )
      },
      (events) => connection.deliverNativeEvents(events),
      (error) => connection.invalidateNative(error)
    )
    const onSystemResume = () => {
      if (appLifecycleState !== 'running') return
      void connection.host
        .systemResume()
        .catch((error) => logger.warn('[Scheduler] System resume failed', error))
    }
    const onSystemThemeUpdated = () => {
      if (appLifecycleState !== 'running') return
      void connection
        .observeSystemTheme()
        .catch((error) => logger.warn('[Settings] System theme observation failed', error))
    }
    powerMonitor.on('resume', onSystemResume)
    nativeTheme.on('updated', onSystemThemeUpdated)
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
      const httpRetirement = proxyConfig.close()
      void httpRetirement.catch(() => {})
      nativeTheme.off('updated', onSystemThemeUpdated)
      powerMonitor.off('resume', onSystemResume)
      dialogService.destroy()
      desktopImageActions.stop()
      nativeSettings.stopWrites()
      await nativeSettings.drainWrites()
      const failures: unknown[] = []
      const retire = async (run: () => Promise<unknown>) => {
        try {
          await run()
        } catch (error) {
          failures.push(error)
        }
      }
      await retire(() => connection.beginShutdown())
      if (failures.length === 0) {
        if (process.platform === 'darwin') await retire(() => dialogService.drainNativeDialogs())
        floatingButtonPresenter.destroy()
        windowPresenter.closeSettingsWindow()
        for (const window of windowPresenter.getAllWindows()) {
          if (!window.isDestroyed()) window.destroy()
        }
        await retire(() => dialogService.drainNativeDialogs())
      }
      await retire(() => connection.stop())
      await retire(() => nativeHelpers!.close())
      await retire(() => nativeBrowser!.close())
      await retire(() => nativeDesktop!.close())
      await retire(() => connection.closeAfterHostExit())
      if (failures.length)
        throw new AggregateError(failures, 'Core and Native owners did not retire')
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
      await runDestroyStep('floatingButtonPresenter.destroy', () =>
        floatingButtonPresenter.destroy()
      )
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
      await runDestroyStep('shortcutPresenter.destroy', () => shortcutPresenter.destroy())
      await runDestroyStep('notificationService.clearAllNotifications', () =>
        notificationService.clearAllNotifications()
      )
      await runDestroyStep('trayPresenter.destroy', () => trayPresenter.destroy())
    }

    async function runDestroyStep(
      stepName: string,
      step: () => void | Promise<void>
    ): Promise<void> {
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
      const desktopRoutes = createDesktopRoutes({
        windowPresenter,
        shortcutPresenter,
        browserPresenter: yoBrowserPresenter,
        tabPresenter,
        dialogService
      })
      const deviceRoutes = createDeviceRoutes({
        device: deviceService,
        restartApplication,
        resetDataByType: (resetType) => resetApplicationData(resetType)
      })
      const upgradeRoutes = createUpgradeRoutes({
        upgrade: upgradeService
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
      const nativeRoutes = createRouteRegistry([
        desktopRoutes,
        deviceRoutes,
        upgradeRoutes,
        notificationRoutes
      ])
      const authorizeRendererIpc = createRendererIpcAuthorizer({
        rendererDirectoryUrl: pathToFileURL(path.join(__dirname, '../renderer/')).href,
        developmentServerUrl: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
        pluginSettingsWindow
      })
      registerDeepchatRoutes(
        ipcMain,
        async (name, input, context, assertCallerActive) => {
          assertCallerActive()
          if (isStopping()) throw new Error('Application is stopping')
          const handler = nativeRoutes.get(name as DeepchatRouteName)
          return handler
            ? await handler(input, context)
            : await connection.invokeRoute(name, input, context, assertCallerActive)
        },
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
        widgetRoutesReady.reject(new Error('Core business routes are stopping'))
        desktopConfigurationHost.close()
        deeplinkService.observeMcpReadiness(false)
        windowPresenter.setApplicationQuitting(true)
        try {
          await destroy()
        } finally {
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
              ...(observation.durationMs === undefined
                ? {}
                : { durationMs: observation.durationMs })
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

    let resetLauncher: CliLauncherService | undefined
    function getResetLauncher(): CliLauncherService {
      if (appLifecycleState !== 'stopped')
        throw new Error('Core must retire before launcher cleanup')
      return (resetLauncher ??= new CliLauncherService({
        homeDirectory: app.getPath('home'),
        userDataDirectory: app.getPath('userData'),
        environmentPath: process.env.PATH,
        shell: process.env.SHELL,
        localAppDataDirectory: process.env.LOCALAPPDATA,
        resolveCliDirectory: () =>
          resolveBundledCliDirectory({
            appPath: app.getAppPath(),
            resourcesPath: process.resourcesPath,
            isPackaged: app.isPackaged
          })
      }))
    }
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
          cliLauncher: {
            getStatus: () => getResetLauncher().getStatus(),
            removeOwnedLauncher: () => getResetLauncher().removeOwnedLauncher()
          },
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
      mcpAppSandbox: connection.mcpAppSandbox,
      resolveWorkspacePreviewRequest: (url) => connection.host.resolveWorkspacePreviewRequest(url),
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
      clearPermissionCaches: async () => {
        if (!isStopping()) await connection.host.clearPermissionCaches()
      },
      confirmShutdown: async () => {
        const request = await connection.host.getShutdownConfirmation()
        return request === null || (await dialogService.showDialog(request)) === 'confirm'
      },
      cancelShutdown: () => windowPresenter.setApplicationQuitting(false),
      hasMainWindows: () => windowPresenter.getAllWindows().length > 0,
      stop,
      stopForCleanup
    }

    cleanup = stopForCleanup
    dependencies.bindControl(control)
    registerRoutes()
    deeplinkService.init()
    setupApplicationListeners()
    const resourcesDirectory = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked')
      : app.getAppPath()
    await connection.configure({ operation: 'initialize' })
    await connection.assembleKernel({
      temporaryDirectory: app.getPath('temp'),
      appDataDirectory: app.getPath('appData'),
      documentsDirectory: resolveProjectDirectory('documents'),
      projectHomeDirectory: resolveProjectDirectory('home'),
      resourcesPath: process.resourcesPath,
      workingDirectory: process.cwd(),
      builtinSkillsDirectories: app.isPackaged
        ? [
            path.join(resourcesDirectory, 'resources', 'skills'),
            path.join(process.resourcesPath, 'resources', 'skills'),
            path.join(process.resourcesPath, 'skills')
          ]
        : [path.join(resourcesDirectory, 'resources', 'skills')],
      providerCatalogPath: path.join(resourcesDirectory, 'resources', 'model-db', 'providers.json'),
      allowInsecureTls: isInsecureTlsAllowed()
    })
    await connection.startKernel()
    widgetRoutesReady.resolve(connection)
    if (windowPresenter.getAllWindows().length === 0) {
      const windowId = await windowPresenter.createAppWindow({ initialRoute: 'chat' })
      if (!windowId) throw new Error('Failed to create initial app window')
    }
    shortcutPresenter.registerShortcuts()
    trayPresenter.init()
    appLifecycleState = 'running'
    onSystemThemeUpdated()
    void floatingButtonPresenter.refreshWidgetState()
    return control
  } catch (error) {
    if (cleanup) await cleanup()
    else {
      const results = await Promise.allSettled([
        proxyConfig.close(),
        nativeHelpers?.close(),
        nativeBrowser?.close(),
        nativeDesktop?.close()
      ])
      await harnessRuntime.stop()
      await core?.closeAfterHostExit()
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : []
      )
      if (failures.length)
        throw new AggregateError([error, ...failures], 'Core startup did not retire')
    }
    throw error
  }
}
