import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { IWindowPresenter } from '@shared/types/desktop'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import {
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
  skillsListMetadataRoute
} from '@shared/contracts/routes'
import { createRouteRegistry, type DeepchatRouteMap, type RouteContext } from './routeRegistry'
import type { StartupWorkloadCoordinator } from '@/app/startupWorkloadCoordinator'

export type RouteDispatcher = {
  appDatabaseMaintenance: MainKernelAppDatabaseMaintenancePort
  routeRegistry: DeepchatRouteMap
  settingsWindow: Pick<IWindowPresenter, 'getSettingsWindowId'>
  startupWorkloadCoordinator: StartupWorkloadCoordinator
}

export interface MainKernelAppDatabaseMaintenancePort {
  assertRouteAllowed(routeName: string): void
}

export function createRouteDispatcher(deps: {
  appDatabaseMaintenance: MainKernelAppDatabaseMaintenancePort
  routeMaps: readonly DeepchatRouteMap[]
  settingsWindow: Pick<IWindowPresenter, 'getSettingsWindowId'>
  startupWorkloadCoordinator: StartupWorkloadCoordinator
}): RouteDispatcher {
  return {
    appDatabaseMaintenance: deps.appDatabaseMaintenance,
    routeRegistry: createRouteRegistry(deps.routeMaps),
    settingsWindow: deps.settingsWindow,
    startupWorkloadCoordinator: deps.startupWorkloadCoordinator
  }
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

function isSettingsWindowContext(dispatcher: RouteDispatcher, context: RouteContext): boolean {
  if (context.windowId == null) {
    return false
  }
  return dispatcher.settingsWindow.getSettingsWindowId() === context.windowId
}

function resolveTrackedRouteTask(
  dispatcher: RouteDispatcher,
  routeName: string,
  context: RouteContext
): StartupTrackedRouteTask | null {
  const isSettings = isSettingsWindowContext(dispatcher, context)

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
  dispatcher: RouteDispatcher,
  routeName: string,
  context: RouteContext,
  action: () => Promise<T>
): Promise<T> {
  const coordinator = dispatcher.startupWorkloadCoordinator
  const trackedTask = resolveTrackedRouteTask(dispatcher, routeName, context)
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
  dispatcher: RouteDispatcher,
  routeName: string,
  rawInput: unknown,
  context: RouteContext
): Promise<unknown> {
  dispatcher.appDatabaseMaintenance.assertRouteAllowed(routeName)
  if (!hasDeepchatRouteContract(routeName)) {
    throw new Error(`Unknown deepchat route: ${routeName}`)
  }

  const registeredRoute = dispatcher.routeRegistry.get(routeName)
  if (registeredRoute) {
    return await runTrackedRouteTask(dispatcher, routeName, context, async () => {
      return await registeredRoute(rawInput, context)
    })
  }

  throw new Error(`Unhandled deepchat route: ${routeName}`)
}

export function registerDeepchatRoutes(ipcMain: IpcMain, dispatcher: RouteDispatcher): void {
  ipcMain.removeHandler(DEEPCHAT_ROUTE_INVOKE_CHANNEL)
  ipcMain.handle(
    DEEPCHAT_ROUTE_INVOKE_CHANNEL,
    async (event: IpcMainInvokeEvent, routeName: string, rawInput: unknown) => {
      return await dispatchDeepchatRoute(dispatcher, routeName, rawInput, {
        webContentsId: event.sender.id,
        windowId: BrowserWindow.fromWebContents(event.sender)?.id ?? null
      })
    }
  )
}
