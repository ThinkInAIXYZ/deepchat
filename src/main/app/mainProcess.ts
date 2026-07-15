import { app, ipcMain } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import logger, { setLoggingEnabled } from '@shared/logger'
import { eventBus } from '@/eventbus'
import { FLOATING_BUTTON_EVENTS, TRAY_EVENTS, WINDOW_EVENTS } from '@/events'
import { AcpRegistryMigrationService } from '@/agent/acp/catalog/acpRegistryMigrationService'
import { killTerminal } from '@/agent/acp/launch/acpInitHelper'
import { rtkRuntimeService } from '@/agent/shared/process/rtkRuntimeService'
import { createMainKernelRouteRuntime, registerMainKernelRoutes } from '@/routes'
import { Presenter } from '@/presenter'
import { ConfigPresenter } from '@/presenter/configPresenter'
import { DatabaseSecurityPresenter } from '@/presenter/databaseSecurityPresenter'
import { proxyConfig } from '@/presenter/proxyConfig'
import {
  runDisabledSearchToolCleanupMigration,
  runMainlineNormalizationMigration
} from '@/presenter/startupMigrations/sessionDataMigrations'
import type { StartupWorkloadCoordinator } from '@/presenter/startupWorkloadCoordinator'
import { DatabaseInitializer } from './databaseInitializer'
import { registerProtocols } from './protocols'
import { SplashWindow } from './splashWindow'

export async function startMainProcess(
  startupWorkloadCoordinator: StartupWorkloadCoordinator,
  startupRunId: string,
  requestUpdateInstall: (installAction: () => void) => Promise<void>
): Promise<Presenter> {
  const splashWindow = new SplashWindow()
  let presenter: Presenter | undefined
  let database: Awaited<ReturnType<DatabaseInitializer['initialize']>> | undefined

  await splashWindow.create()

  try {
    electronApp.setAppUserModelId('com.wefonk.deepchat')
    const configPresenter = new ConfigPresenter()
    setLoggingEnabled(configPresenter.getLoggingEnabled())
    proxyConfig.initFromConfig(configPresenter.getProxyMode(), configPresenter.getCustomProxyUrl())

    const databaseSecurityPresenter = new DatabaseSecurityPresenter()
    const securityStatus = databaseSecurityPresenter.getStatus()
    splashWindow.showDatabaseUnlockProgress(
      {
        active: securityStatus.enabled,
        safeStorageAvailable: securityStatus.safeStorageAvailable
      },
      { skipDelay: securityStatus.enabled }
    )
    const password = await databaseSecurityPresenter.resolveStartupPassword((request) =>
      splashWindow.requestDatabaseUnlock(request)
    )
    splashWindow.showDatabaseUnlockProgress({
      active: false,
      safeStorageAvailable: databaseSecurityPresenter.getStatus().safeStorageAvailable
    })

    const databaseInitializer = new DatabaseInitializer({ password })
    database = await databaseInitializer.initialize()
    await databaseInitializer.migrate()
    await registerProtocols()

    const activePresenter = new Presenter({
      configPresenter,
      sqlitePresenter: database,
      databaseSecurityPresenter,
      startupWorkloadCoordinator,
      requestUpdateInstall
    })
    presenter = activePresenter
    const routeRuntime = createRouteRuntime(activePresenter)
    registerMainKernelRoutes(ipcMain, () => routeRuntime)
    presenter.deeplinkPresenter.init()
    presenter.init(startupRunId)

    setupApplicationListeners(presenter)

    const acpRegistryMigration = new AcpRegistryMigrationService(configPresenter, database)
    await runAcpRegistryMigration(acpRegistryMigration)

    if (presenter.windowPresenter.getAllWindows().length === 0) {
      const windowId = await presenter.windowPresenter.createAppWindow({ initialRoute: 'chat' })
      if (!windowId) {
        throw new Error('Failed to create initial app window')
      }
    }

    presenter.shortcutPresenter.registerShortcuts()
    presenter.setupTray()
    presenter.cronJobs.start()
    presenter.memoryPresenter.startBackgroundMaintenance()
    scheduleBackgroundWork(presenter)

    await splashWindow.close()
    return presenter
  } catch (error) {
    await splashWindow.close()
    if (presenter) {
      await stopMainProcess(presenter)
    } else {
      database?.close()
    }
    throw error
  }
}

function createRouteRuntime(presenter: Presenter) {
  return createMainKernelRouteRuntime({
    configPresenter: presenter.configPresenter,
    llmProviderPresenter: presenter.llmproviderPresenter,
    acpProviderAdminPort: presenter.acpProviderAdminPort,
    sessionLifecyclePort: presenter.sessionLifecycle,
    sessionProjectionPort: presenter.sessionQuery,
    desktopSessionBinding: presenter.desktopSessionBinding,
    sessionTurnPort: presenter.sessionTurn,
    sessionAssignmentPort: presenter.sessionAssignment,
    sessionPermissionPort: presenter.sessionPermissionPort,
    skillPresenter: presenter.skillPresenter,
    skillSyncPresenter: presenter.skillSyncPresenter,
    exporter: presenter.exporter,
    oauthPresenter: presenter.oauthPresenter,
    mcpPresenter: presenter.mcpPresenter,
    remoteControlPresenter: presenter.remoteControlPresenter,
    shortcutPresenter: presenter.shortcutPresenter,
    syncPresenter: presenter.syncPresenter,
    upgradePresenter: presenter.upgradePresenter,
    dialogPresenter: presenter.dialogPresenter,
    toolPresenter: presenter.toolPresenter,
    sqlitePresenter: presenter.sqlitePresenter,
    windowPresenter: presenter.windowPresenter,
    devicePresenter: presenter.devicePresenter,
    projectPresenter: presenter.projectPresenter,
    filePresenter: presenter.filePresenter,
    knowledgePresenter: presenter.knowledgePresenter,
    workspacePresenter: presenter.workspacePresenter,
    yoBrowserPresenter: presenter.yoBrowserPresenter,
    tabPresenter: presenter.tabPresenter,
    startupWorkloadCoordinator: presenter.startupWorkloadCoordinator,
    pluginPresenter: presenter.pluginPresenter,
    databaseSecurityPresenter: presenter.databaseSecurityPresenter,
    memoryPresenter: presenter.memoryPresenter,
    cronJobs: presenter.cronJobs,
    usageStatsService: presenter.usageStatsService,
    rtkRuntimeService,
    sessionHistorySearch: presenter.sessionHistorySearch,
    agentSessionExportService: presenter.agentSessionExportService,
    sessionTranslation: presenter.sessionTranslation
  })
}

export async function stopMainProcess(presenter: Presenter): Promise<void> {
  presenter.windowPresenter.setApplicationQuitting(true)
  presenter.windowPresenter.destroyFloatingChatWindow()
  presenter.startupWorkloadCoordinator.cancelTarget('main')

  try {
    killTerminal()
  } catch (error) {
    logger.warn('Failed to stop ACP init terminal:', error)
  }

  try {
    await presenter.destroy()
  } finally {
    presenter.trayPresenter.destroy()
  }
}

function setupApplicationListeners(presenter: Presenter): void {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('activate', () => {
    if (presenter.windowPresenter.restoreMainWindowHiddenByClose()) {
      return
    }

    if (presenter.windowPresenter.getAllWindows().length === 0) {
      void presenter.windowPresenter.createAppWindow({ initialRoute: 'chat' })
    }
  })

  app.on('did-resign-active', () => {
    setTimeout(() => {
      if (app.isHidden()) {
        presenter.windowPresenter.clearMainWindowHiddenByClose()
      }
    }, 0)
  })

  eventBus.on(FLOATING_BUTTON_EVENTS.ENABLED_CHANGED, async (enabled: boolean) => {
    try {
      await presenter.floatingButtonPresenter.setEnabled(enabled)
    } catch (error) {
      console.error('Failed to set floating button enabled state:', error)
    }
  })

  eventBus.on(TRAY_EVENTS.CHECK_FOR_UPDATES, async () => {
    try {
      const settingsWindowId = await presenter.windowPresenter.createSettingsWindow()
      if (settingsWindowId == null) {
        console.warn('Failed to open settings window for update check')
        return
      }

      presenter.windowPresenter.sendSettingsNavigation(settingsWindowId, {
        routeName: 'settings-about'
      })
      presenter.windowPresenter.sendSettingsCheckForUpdates(settingsWindowId)
    } catch (error) {
      console.error('Failed to route tray update check to settings window:', error)
    }
  })

  eventBus.on(TRAY_EVENTS.SHOW_HIDDEN_WINDOW, (mustShow: boolean) => {
    const allWindows = presenter.windowPresenter.getAllWindows()
    if (allWindows.length === 0) {
      void presenter.windowPresenter.createAppWindow({ initialRoute: 'chat' })
      return
    }

    const targetWindow = presenter.windowPresenter.getFocusedWindow() || allWindows[0]
    if (targetWindow.isDestroyed()) {
      void presenter.windowPresenter.createAppWindow({ initialRoute: 'chat' })
      return
    }

    if (targetWindow.isVisible() && !mustShow) {
      presenter.windowPresenter.hide(targetWindow.id)
    } else {
      presenter.windowPresenter.show(targetWindow.id)
      targetWindow.focus()
    }
  })

  app.on('browser-window-focus', () => {
    presenter.shortcutPresenter.registerShortcuts()
    eventBus.sendToMain(WINDOW_EVENTS.APP_FOCUS)
  })

  app.on('browser-window-blur', () => {
    setTimeout(() => {
      const isAnyWindowFocused = presenter.windowPresenter
        .getAllWindows()
        .some((window) => !window.isDestroyed() && window.isFocused())

      if (!isAnyWindowFocused) {
        presenter.shortcutPresenter.unregisterShortcuts()
        eventBus.sendToMain(WINDOW_EVENTS.APP_BLUR)
      }
    }, 50)
  })
}

async function runAcpRegistryMigration(service: AcpRegistryMigrationService): Promise<void> {
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

function scheduleBackgroundWork(presenter: Presenter): void {
  const schedule = (
    task: Parameters<StartupWorkloadCoordinator['scheduleTask']>[0],
    errorMessage: string
  ) => {
    void presenter.startupWorkloadCoordinator.scheduleTask(task).catch((error) => {
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
      run: async () => presenter.legacyChatImportService.start(false)
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
      run: async (taskContext) => presenter.usageStatsService.startBackfill(taskContext)
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
          {
            sqlitePresenter: presenter.sessionDataMigrationSQLite,
            configPresenter: presenter.configPresenter,
            appSessionService: presenter.appSessionService
          },
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
          {
            sqlitePresenter: presenter.sessionDataMigrationSQLite,
            configPresenter: presenter.configPresenter,
            appSessionService: presenter.appSessionService
          },
          taskContext
        )
    },
    'Failed to start disabled search tool cleanup:'
  )
}
