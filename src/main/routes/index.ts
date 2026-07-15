import { BrowserWindow, app, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { IConfigPresenter, ISQLitePresenter, IWindowPresenter } from '@shared/presenter'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { sessionsUpdatedEvent } from '@shared/contracts/events'
import { publishDeepchatEvent } from './publishDeepchatEvent'
import {
  databaseSecurityChangePasswordRoute,
  databaseSecurityDisableRoute,
  databaseSecurityEnableRoute,
  databaseSecurityGetStatusRoute,
  databaseSecurityRepairSchemaRoute,
  debugCreateMockChatSessionRoute,
  hasDeepchatRouteContract,
  mcpGetClientsRoute,
  mcpGetEnabledRoute,
  mcpGetNpmRegistryStatusRoute,
  mcpGetServersRoute,
  modelsGetProviderCatalogRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListSummariesRoute,
  sessionsListLightweightRoute,
  startupGetBootstrapRoute,
  skillsListMetadataRoute,
  type DatabaseSecurityStatus,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import { createRouteRegistry, type DeepchatRouteMap, type RouteContext } from './routeRegistry'
import type { StartupWorkloadCoordinator } from '@/presenter/startupWorkloadCoordinator'
import type { DatabaseSecurityPresenter } from '@/presenter/databaseSecurityPresenter'
import type { SessionQuery } from '@/session/query'

export type MainKernelRouteRuntime = {
  appDatabaseMaintenance: MainKernelAppDatabaseMaintenancePort
  configPresenter: IConfigPresenter
  routeRegistry: DeepchatRouteMap
  startupSessionProjection: Pick<SessionQuery, 'getLightweightByIds'>
  startupDesktopSession: MainKernelDesktopSessionPort
  settingsWindow: Pick<IWindowPresenter, 'getSettingsWindowId'>
  sqlitePresenter: ISQLitePresenter
  ensureDefaultWorkspace(): Promise<string | null>
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  databaseSecurityPresenter: DatabaseSecurityPresenter
}

export interface MainKernelAppDatabaseMaintenancePort {
  assertRouteAllowed(routeName: string): void
  enableDatabaseEncryption(password: string): Promise<DatabaseSecurityStatus>
  changeDatabasePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<DatabaseSecurityStatus>
  disableDatabaseEncryption(currentPassword: string): Promise<DatabaseSecurityStatus>
}

export interface MainKernelDesktopSessionPort {
  getActiveId(webContentsId: number): string | null
}

export function createMainKernelRouteRuntime(deps: {
  appDatabaseMaintenance: MainKernelAppDatabaseMaintenancePort
  configPresenter: IConfigPresenter
  routeMaps: readonly DeepchatRouteMap[]
  startupSessionProjection: Pick<SessionQuery, 'getLightweightByIds'>
  startupDesktopSession: MainKernelDesktopSessionPort
  settingsWindow: Pick<IWindowPresenter, 'getSettingsWindowId'>
  sqlitePresenter?: ISQLitePresenter
  ensureDefaultWorkspace(): Promise<string | null>
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  databaseSecurityPresenter: DatabaseSecurityPresenter
}): MainKernelRouteRuntime {
  return {
    appDatabaseMaintenance: deps.appDatabaseMaintenance,
    configPresenter: deps.configPresenter,
    routeRegistry: createRouteRegistry(deps.routeMaps),
    startupSessionProjection: deps.startupSessionProjection,
    startupDesktopSession: deps.startupDesktopSession,
    settingsWindow: deps.settingsWindow,
    sqlitePresenter:
      deps.sqlitePresenter ??
      ({
        recordSettingsActivity: async (input: SettingsActivityInput) => ({
          id: 'noop',
          category: input.category,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          targetLabel: input.targetLabel ?? '',
          routeName: input.routeName ?? null,
          routeParams: input.routeParams ?? {},
          summaryKey: input.summaryKey,
          summaryParams: input.summaryParams ?? {},
          createdAt: Date.now()
        }),
        listSettingsActivity: async () => []
      } as unknown as ISQLitePresenter),
    ensureDefaultWorkspace: deps.ensureDefaultWorkspace,
    startupWorkloadCoordinator: deps.startupWorkloadCoordinator,
    databaseSecurityPresenter: deps.databaseSecurityPresenter
  }
}

function recordSettingsActivity(
  runtime: MainKernelRouteRuntime,
  activity: SettingsActivityInput
): void {
  void runtime.sqlitePresenter.recordSettingsActivity(activity).catch((error) => {
    console.warn('[SettingsActivity] Failed to record settings activity:', error)
  })
}

type StartupTrackedRouteTask = {
  target: 'main' | 'settings'
  visibleId:
    | 'main.bootstrap'
    | 'main.session.firstPage'
    | 'main.provider.warmup'
    | 'settings.providers.summary'
    | 'settings.provider.models'
    | 'settings.ollama'
    | 'settings.skills.catalog'
    | 'settings.mcp.runtime'
  phase: 'interactive' | 'deferred' | 'background'
  resource: 'cpu' | 'io'
  labelKey: string
  id: string
  dedupeKey?: string
}

function isSettingsWindowContext(runtime: MainKernelRouteRuntime, context: RouteContext): boolean {
  if (context.windowId == null) {
    return false
  }
  return runtime.settingsWindow.getSettingsWindowId() === context.windowId
}

function resolveTrackedRouteTask(
  runtime: MainKernelRouteRuntime,
  routeName: string,
  context: RouteContext
): StartupTrackedRouteTask | null {
  const isSettings = isSettingsWindowContext(runtime, context)

  if (routeName === providersListSummariesRoute.name && isSettings) {
    return {
      target: 'settings',
      visibleId: 'settings.providers.summary',
      phase: 'interactive',
      resource: 'io',
      labelKey: 'startup.settings.providers.summary',
      id: 'settings.providers.summary:route',
      dedupeKey: 'settings.providers.summary:route'
    }
  }

  if (routeName === modelsGetProviderCatalogRoute.name) {
    if (isSettings) {
      return {
        target: 'settings',
        visibleId: 'settings.provider.models',
        phase: 'deferred',
        resource: 'io',
        labelKey: 'startup.settings.provider.models',
        id: 'settings.provider.models:route'
      }
    }

    return {
      target: 'main',
      visibleId: 'main.provider.warmup',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.main.provider.warmup',
      id: 'main.provider.warmup:route'
    }
  }

  if (
    isSettings &&
    (routeName === providersListOllamaModelsRoute.name ||
      routeName === providersListOllamaRunningModelsRoute.name)
  ) {
    return {
      target: 'settings',
      visibleId: 'settings.ollama',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.settings.ollama',
      id: `settings.ollama:${routeName}`
    }
  }

  if (routeName === sessionsListLightweightRoute.name && !isSettings) {
    return {
      target: 'main',
      visibleId: 'main.session.firstPage',
      phase: 'interactive',
      resource: 'io',
      labelKey: 'startup.main.session.firstPage',
      id: 'main.session.firstPage:route',
      dedupeKey: 'main.session.firstPage:route'
    }
  }

  if (routeName === skillsListMetadataRoute.name && isSettings) {
    return {
      target: 'settings',
      visibleId: 'settings.skills.catalog',
      phase: 'deferred',
      resource: 'cpu',
      labelKey: 'startup.settings.skills.catalog',
      id: 'settings.skills.catalog:route'
    }
  }

  const isSettingsMcpRuntimeRoute =
    routeName === mcpGetServersRoute.name ||
    routeName === mcpGetEnabledRoute.name ||
    routeName === mcpGetClientsRoute.name ||
    routeName === mcpGetNpmRegistryStatusRoute.name

  if (isSettings && isSettingsMcpRuntimeRoute) {
    return {
      target: 'settings',
      visibleId: 'settings.mcp.runtime',
      phase: 'deferred',
      resource: 'io',
      labelKey: 'startup.settings.mcp.runtime',
      id: `settings.mcp.runtime:${routeName}`
    }
  }

  return null
}

async function runTrackedRouteTask<T>(
  runtime: MainKernelRouteRuntime,
  routeName: string,
  context: RouteContext,
  action: () => Promise<T>
): Promise<T> {
  const coordinator = (runtime as Partial<MainKernelRouteRuntime>).startupWorkloadCoordinator
  if (!coordinator) {
    return await action()
  }

  const trackedTask = resolveTrackedRouteTask(runtime, routeName, context)
  if (!trackedTask) {
    return await action()
  }

  return await coordinator.scheduleTask({
    id: trackedTask.id,
    target: trackedTask.target,
    phase: trackedTask.phase,
    resource: trackedTask.resource,
    labelKey: trackedTask.labelKey,
    visibleId: trackedTask.visibleId,
    dedupeKey: trackedTask.dedupeKey,
    runId: coordinator.getRunId(trackedTask.target),
    run: async () => {
      return await action()
    }
  })
}

export async function dispatchDeepchatRoute(
  runtime: MainKernelRouteRuntime,
  routeName: string,
  rawInput: unknown,
  context: RouteContext
): Promise<unknown> {
  runtime.appDatabaseMaintenance.assertRouteAllowed(routeName)
  if (!hasDeepchatRouteContract(routeName)) {
    throw new Error(`Unknown deepchat route: ${routeName}`)
  }

  const registeredRoute = runtime.routeRegistry.get(routeName)
  if (registeredRoute) {
    return await runTrackedRouteTask(runtime, routeName, context, async () => {
      return await registeredRoute(rawInput, context)
    })
  }

  switch (routeName) {
    case databaseSecurityGetStatusRoute.name: {
      databaseSecurityGetStatusRoute.input.parse(rawInput)
      return databaseSecurityGetStatusRoute.output.parse({
        status: runtime.databaseSecurityPresenter.getStatus()
      })
    }

    case databaseSecurityEnableRoute.name: {
      const input = databaseSecurityEnableRoute.input.parse(rawInput)
      const status = await runtime.appDatabaseMaintenance.enableDatabaseEncryption(input.password)
      recordSettingsActivity(runtime, {
        category: 'privacy',
        action: 'enabled',
        targetType: 'database-encryption',
        targetId: 'agent.db',
        targetLabel: 'SQLite database encryption',
        routeName: 'settings-database',
        summaryKey: 'settings.controlCenter.activity.settingUpdated',
        summaryParams: {
          key: 'databaseEncryption'
        }
      })
      return databaseSecurityEnableRoute.output.parse({ status })
    }

    case databaseSecurityChangePasswordRoute.name: {
      const input = databaseSecurityChangePasswordRoute.input.parse(rawInput)
      const status = await runtime.appDatabaseMaintenance.changeDatabasePassword(
        input.currentPassword,
        input.newPassword
      )
      recordSettingsActivity(runtime, {
        category: 'privacy',
        action: 'updated',
        targetType: 'database-encryption',
        targetId: 'agent.db',
        targetLabel: 'SQLite database encryption',
        routeName: 'settings-database',
        summaryKey: 'settings.controlCenter.activity.settingUpdated',
        summaryParams: {
          key: 'databaseEncryptionPassword'
        }
      })
      return databaseSecurityChangePasswordRoute.output.parse({ status })
    }

    case databaseSecurityDisableRoute.name: {
      const input = databaseSecurityDisableRoute.input.parse(rawInput)
      const status = await runtime.appDatabaseMaintenance.disableDatabaseEncryption(
        input.currentPassword
      )
      recordSettingsActivity(runtime, {
        category: 'privacy',
        action: 'disabled',
        targetType: 'database-encryption',
        targetId: 'agent.db',
        targetLabel: 'SQLite database encryption',
        routeName: 'settings-database',
        summaryKey: 'settings.controlCenter.activity.settingUpdated',
        summaryParams: {
          key: 'databaseEncryption'
        }
      })
      return databaseSecurityDisableRoute.output.parse({ status })
    }

    case databaseSecurityRepairSchemaRoute.name: {
      databaseSecurityRepairSchemaRoute.input.parse(rawInput)
      return databaseSecurityRepairSchemaRoute.output.parse({
        report: await runtime.sqlitePresenter.repairSchema()
      })
    }

    case startupGetBootstrapRoute.name: {
      startupGetBootstrapRoute.input.parse(rawInput)
      const coordinator = (runtime as Partial<MainKernelRouteRuntime>).startupWorkloadCoordinator

      if (!coordinator) {
        const activeSessionId = runtime.startupDesktopSession.getActiveId(context.webContentsId)
        const activeSession = activeSessionId
          ? ((await runtime.startupSessionProjection.getLightweightByIds([activeSessionId]))[0] ??
            null)
          : null
        const [agents, acpEnabled, defaultChatWorkspacePath] = await Promise.all([
          runtime.configPresenter.listAgents(),
          runtime.configPresenter.getAcpEnabled(),
          runtime.ensureDefaultWorkspace()
        ])

        const bootstrap = {
          startupRunId: `startup:${context.webContentsId}:${Date.now()}`,
          activeSessionId,
          activeSession,
          agents: agents
            .filter((agent) => agent.type === 'deepchat' || acpEnabled)
            .map((agent) => ({
              id: agent.id,
              name: agent.name,
              type: agent.type,
              agentType: agent.agentType,
              enabled: agent.enabled,
              protected: agent.protected,
              icon: agent.icon,
              description: agent.description,
              source: agent.source,
              avatar: agent.avatar
            })),
          defaultProjectPath: runtime.configPresenter.getDefaultProjectPath(),
          defaultChatWorkspacePath
        }

        return startupGetBootstrapRoute.output.parse({ bootstrap })
      }

      return await coordinator.scheduleTask({
        id: 'main.bootstrap:route',
        target: 'main',
        phase: 'interactive',
        resource: 'io',
        labelKey: 'startup.main.bootstrap',
        visibleId: 'main.bootstrap',
        dedupeKey: 'main.bootstrap:route',
        runId: coordinator.getRunId('main'),
        run: async () => {
          const startupRunId = coordinator.getRunId('main')
          const activeSessionId = runtime.startupDesktopSession.getActiveId(context.webContentsId)
          const activeSession = activeSessionId
            ? ((await runtime.startupSessionProjection.getLightweightByIds([activeSessionId]))[0] ??
              null)
            : null
          const [agents, acpEnabled, defaultChatWorkspacePath] = await Promise.all([
            runtime.configPresenter.listAgents(),
            runtime.configPresenter.getAcpEnabled(),
            runtime.ensureDefaultWorkspace()
          ])

          const bootstrap = {
            startupRunId,
            activeSessionId,
            activeSession,
            agents: agents
              .filter((agent) => agent.type === 'deepchat' || acpEnabled)
              .map((agent) => ({
                id: agent.id,
                name: agent.name,
                type: agent.type,
                agentType: agent.agentType,
                enabled: agent.enabled,
                protected: agent.protected,
                icon: agent.icon,
                description: agent.description,
                source: agent.source,
                avatar: agent.avatar
              })),
            defaultProjectPath: runtime.configPresenter.getDefaultProjectPath(),
            defaultChatWorkspacePath
          }

          coordinator.replayTarget('main')
          return startupGetBootstrapRoute.output.parse({ bootstrap })
        }
      })
    }

    case debugCreateMockChatSessionRoute.name: {
      debugCreateMockChatSessionRoute.input.parse(rawInput)
      if (!import.meta.env.DEV || app.isPackaged) {
        return debugCreateMockChatSessionRoute.output.parse({
          created: false,
          sessionId: null,
          title: null,
          messageCount: 0
        })
      }

      const { createDebugMockChatSession } = await import('./debug/createMockChatSession')
      const result = createDebugMockChatSession(runtime.sqlitePresenter.getDatabase())
      if (result.sessionId) {
        publishDeepchatEvent(sessionsUpdatedEvent.name, {
          sessionIds: [result.sessionId],
          reason: 'created'
        })
      }
      return debugCreateMockChatSessionRoute.output.parse(result)
    }
  }

  throw new Error(`Unhandled deepchat route: ${routeName}`)
}

export function registerMainKernelRoutes(
  ipcMain: IpcMain,
  getRuntime: () => MainKernelRouteRuntime | undefined
): void {
  ipcMain.removeHandler(DEEPCHAT_ROUTE_INVOKE_CHANNEL)
  ipcMain.handle(
    DEEPCHAT_ROUTE_INVOKE_CHANNEL,
    async (event: IpcMainInvokeEvent, routeName: string, rawInput: unknown) => {
      const runtime = getRuntime()
      if (!runtime) {
        throw new Error('Main kernel routes are not available before presenter initialization')
      }

      return await dispatchDeepchatRoute(runtime, routeName, rawInput, {
        webContentsId: event.sender.id,
        windowId: BrowserWindow.fromWebContents(event.sender)?.id ?? null
      })
    }
  )
}
