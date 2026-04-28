import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  IAgentSessionPresenter,
  IConfigPresenter,
  IDevicePresenter,
  IDialogPresenter,
  IFilePresenter,
  ILlmProviderPresenter,
  IMCPPresenter,
  IProjectPresenter,
  ISkillPresenter,
  ISyncPresenter,
  ITabPresenter,
  IToolPresenter,
  IUpgradePresenter,
  IWindowPresenter,
  IWorkspacePresenter,
  IYoBrowserPresenter
} from '@shared/presenter'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import {
  browserAttachCurrentWindowRoute,
  browserDestroyRoute,
  browserDetachRoute,
  browserGetStatusRoute,
  browserGoBackRoute,
  browserGoForwardRoute,
  browserLoadUrlRoute,
  browserReloadRoute,
  browserUpdateCurrentWindowBoundsRoute,
  chatRespondToolInteractionRoute,
  chatSendMessageRoute,
  chatSteerActiveTurnRoute,
  chatStopStreamRoute,
  computerUseCheckPermissionsRoute,
  computerUseGetStatusRoute,
  computerUseOpenPermissionGuideRoute,
  computerUseRestartMcpServerRoute,
  computerUseSetEnabledRoute,
  dialogErrorRoute,
  dialogRespondRoute,
  deviceGetAppVersionRoute,
  deviceGetInfoRoute,
  deviceRestartAppRoute,
  deviceSanitizeSvgRoute,
  deviceSelectDirectoryRoute,
  fileGetMimeTypeRoute,
  fileIsDirectoryRoute,
  filePrepareDirectoryRoute,
  filePrepareFileRoute,
  fileReadFileRoute,
  fileWriteImageBase64Route,
  hasDeepchatRouteContract,
  mcpAddServerRoute,
  mcpCallToolRoute,
  mcpCancelSamplingRequestRoute,
  mcpClearNpmRegistryCacheRoute,
  mcpGetClientsRoute,
  mcpGetEnabledRoute,
  mcpGetNpmRegistryStatusRoute,
  mcpGetPromptRoute,
  mcpGetServersRoute,
  mcpIsServerRunningRoute,
  mcpListPromptsRoute,
  mcpListResourcesRoute,
  mcpListToolDefinitionsRoute,
  mcpReadResourceRoute,
  mcpRefreshNpmRegistryRoute,
  mcpRemoveServerRoute,
  mcpSetAutoDetectNpmRegistryRoute,
  mcpSetCustomNpmRegistryRoute,
  mcpSetEnabledRoute,
  mcpSetServerEnabledRoute,
  mcpStartServerRoute,
  mcpStopServerRoute,
  mcpSubmitSamplingDecisionRoute,
  mcpUpdateServerRoute,
  modelsGetProviderCatalogRoute,
  pluginsDeleteRoute,
  pluginsDisableRoute,
  pluginsEnableRoute,
  pluginsGetRoute,
  pluginsInstallRoute,
  pluginsInvokeActionRoute,
  pluginsListRoute,
  projectListEnvironmentsRoute,
  projectListRecentRoute,
  projectOpenDirectoryRoute,
  projectSelectDirectoryRoute,
  providersListModelsRoute,
  providersListOllamaModelsRoute,
  providersListOllamaRunningModelsRoute,
  providersListSummariesRoute,
  providersTestConnectionRoute,
  sessionsActivateRoute,
  sessionsClearMessagesRoute,
  sessionsConvertPendingInputToSteerRoute,
  sessionsCreateRoute,
  sessionsDeleteMessageRoute,
  sessionsDeletePendingInputRoute,
  sessionsDeleteRoute,
  sessionsDeactivateRoute,
  sessionsEditUserMessageRoute,
  sessionsEnsureAcpDraftRoute,
  sessionsExportRoute,
  sessionsForkRoute,
  sessionsGetAcpSessionCommandsRoute,
  sessionsGetAcpSessionConfigOptionsRoute,
  sessionsGetActiveRoute,
  sessionsGetAgentsRoute,
  sessionsGetDisabledAgentToolsRoute,
  sessionsGetLightweightByIdsRoute,
  sessionsGetGenerationSettingsRoute,
  sessionsGetPermissionModeRoute,
  sessionsGetSearchResultsRoute,
  sessionsListLightweightRoute,
  sessionsListRoute,
  sessionsListMessageTracesRoute,
  sessionsListPendingInputsRoute,
  sessionsMoveQueuedInputRoute,
  sessionsQueuePendingInputRoute,
  sessionsRenameRoute,
  sessionsResumePendingQueueRoute,
  sessionsRetryMessageRoute,
  sessionsRestoreRoute,
  sessionsSearchHistoryRoute,
  sessionsSetAcpSessionConfigOptionRoute,
  sessionsSetModelRoute,
  sessionsSetPermissionModeRoute,
  sessionsSetProjectDirRoute,
  sessionsSetSubagentEnabledRoute,
  sessionsTogglePinnedRoute,
  sessionsTranslateTextRoute,
  sessionsUpdateDisabledAgentToolsRoute,
  sessionsUpdateGenerationSettingsRoute,
  sessionsUpdateQueuedInputRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  startupGetBootstrapRoute,
  skillsGetActiveRoute,
  skillsGetDirectoryRoute,
  skillsGetExtensionRoute,
  skillsGetFolderTreeRoute,
  skillsInstallFromFolderRoute,
  skillsInstallFromUrlRoute,
  skillsInstallFromZipRoute,
  skillsListMetadataRoute,
  skillsListScriptsRoute,
  skillsOpenFolderRoute,
  skillsSaveExtensionRoute,
  skillsSaveWithExtensionRoute,
  skillsSetActiveRoute,
  skillsUninstallRoute,
  skillsUpdateFileRoute,
  syncGetBackupStatusRoute,
  syncImportRoute,
  syncListBackupsRoute,
  syncOpenFolderRoute,
  syncStartBackupRoute,
  systemOpenSettingsRoute,
  tabCaptureCurrentAreaRoute,
  tabNotifyRendererActivatedRoute,
  tabNotifyRendererReadyRoute,
  tabStitchImagesWithWatermarkRoute,
  toolsListDefinitionsRoute,
  upgradeCheckRoute,
  upgradeClearMockRoute,
  upgradeGetStatusRoute,
  upgradeMockDownloadedRoute,
  upgradeOpenDownloadRoute,
  upgradeRestartToUpdateRoute,
  upgradeStartDownloadRoute,
  windowCloseCurrentRoute,
  windowCloseFloatingCurrentRoute,
  windowGetCurrentStateRoute,
  windowMinimizeCurrentRoute,
  windowPreviewFileRoute,
  windowToggleMaximizeCurrentRoute,
  workspaceExpandDirectoryRoute,
  workspaceGetGitDiffRoute,
  workspaceGetGitStatusRoute,
  workspaceOpenFileRoute,
  workspaceReadDirectoryRoute,
  workspaceReadFilePreviewRoute,
  workspaceRegisterRoute,
  workspaceResolveMarkdownLinkedFileRoute,
  workspaceRevealFileInFolderRoute,
  workspaceSearchFilesRoute,
  workspaceUnregisterRoute,
  workspaceUnwatchRoute,
  workspaceWatchRoute
} from '@shared/contracts/routes'
import { ChatService } from './chat/chatService'
import { dispatchConfigRoute } from './config/configRouteHandler'
import { createPresenterHotPathPorts } from './hotPathPorts'
import { dispatchModelRoute } from './models/modelRouteHandler'
import { dispatchProviderRoute } from './providers/providerRouteHandler'
import { createNodeScheduler } from './scheduler'
import { ProviderService } from './providers/providerService'
import { createSettingsRouteAdapter } from './settings/settingsAdapter'
import { createSettingsRouteHandler } from './settings/settingsHandler'
import { SessionService } from './sessions/sessionService'
import type { StartupWorkloadCoordinator } from '@/presenter/startupWorkloadCoordinator'
import type { ComputerUsePresenter } from '@/presenter/computerUsePresenter'
import type { PluginPresenter } from '@/presenter/pluginPresenter'

export type MainKernelRouteRuntime = {
  configPresenter: IConfigPresenter
  llmProviderPresenter: ILlmProviderPresenter
  agentSessionPresenter: IAgentSessionPresenter
  skillPresenter: ISkillPresenter
  mcpPresenter: IMCPPresenter
  syncPresenter: ISyncPresenter
  upgradePresenter: IUpgradePresenter
  dialogPresenter: IDialogPresenter
  toolPresenter: IToolPresenter
  settingsHandler: ReturnType<typeof createSettingsRouteHandler>
  sessionService: SessionService
  chatService: ChatService
  providerService: ProviderService
  windowPresenter: IWindowPresenter
  devicePresenter: IDevicePresenter
  projectPresenter: IProjectPresenter
  filePresenter: IFilePresenter
  workspacePresenter: IWorkspacePresenter
  yoBrowserPresenter: IYoBrowserPresenter
  tabPresenter: ITabPresenter
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  computerUsePresenter: ComputerUsePresenter
  pluginPresenter: PluginPresenter
}

export function createMainKernelRouteRuntime(deps: {
  configPresenter: IConfigPresenter
  llmProviderPresenter: ILlmProviderPresenter
  agentSessionPresenter: IAgentSessionPresenter
  skillPresenter: ISkillPresenter
  mcpPresenter: IMCPPresenter
  syncPresenter: ISyncPresenter
  upgradePresenter: IUpgradePresenter
  dialogPresenter: IDialogPresenter
  toolPresenter: IToolPresenter
  windowPresenter: IWindowPresenter
  devicePresenter: IDevicePresenter
  projectPresenter: IProjectPresenter
  filePresenter: IFilePresenter
  workspacePresenter: IWorkspacePresenter
  yoBrowserPresenter: IYoBrowserPresenter
  tabPresenter: ITabPresenter
  startupWorkloadCoordinator: StartupWorkloadCoordinator
  computerUsePresenter: ComputerUsePresenter
  pluginPresenter: PluginPresenter
}): MainKernelRouteRuntime {
  const scheduler = createNodeScheduler()
  const hotPathPorts = createPresenterHotPathPorts({
    agentSessionPresenter: deps.agentSessionPresenter as IAgentSessionPresenter & {
      clearSessionPermissions: (sessionId: string) => void | Promise<void>
    },
    configPresenter: deps.configPresenter,
    llmProviderPresenter: deps.llmProviderPresenter
  })

  return {
    configPresenter: deps.configPresenter,
    llmProviderPresenter: deps.llmProviderPresenter,
    agentSessionPresenter: deps.agentSessionPresenter,
    skillPresenter: deps.skillPresenter,
    mcpPresenter: deps.mcpPresenter,
    syncPresenter: deps.syncPresenter,
    upgradePresenter: deps.upgradePresenter,
    dialogPresenter: deps.dialogPresenter,
    toolPresenter: deps.toolPresenter,
    settingsHandler: createSettingsRouteHandler(createSettingsRouteAdapter(deps.configPresenter)),
    sessionService: new SessionService({
      sessionRepository: hotPathPorts.sessionRepository,
      messageRepository: hotPathPorts.messageRepository,
      scheduler
    }),
    chatService: new ChatService({
      sessionRepository: hotPathPorts.sessionRepository,
      messageRepository: hotPathPorts.messageRepository,
      providerExecutionPort: hotPathPorts.providerExecutionPort,
      providerCatalogPort: hotPathPorts.providerCatalogPort,
      sessionPermissionPort: hotPathPorts.sessionPermissionPort,
      scheduler
    }),
    providerService: new ProviderService({
      providerCatalogPort: hotPathPorts.providerCatalogPort,
      providerExecutionPort: hotPathPorts.providerExecutionPort,
      scheduler
    }),
    windowPresenter: deps.windowPresenter,
    devicePresenter: deps.devicePresenter,
    projectPresenter: deps.projectPresenter,
    filePresenter: deps.filePresenter,
    workspacePresenter: deps.workspacePresenter,
    yoBrowserPresenter: deps.yoBrowserPresenter,
    tabPresenter: deps.tabPresenter,
    startupWorkloadCoordinator: deps.startupWorkloadCoordinator,
    computerUsePresenter: deps.computerUsePresenter,
    pluginPresenter: deps.pluginPresenter
  }
}

type RouteContext = {
  webContentsId: number
  windowId: number | null
}

type WindowState = {
  windowId: number | null
  exists: boolean
  isMaximized: boolean
  isFullScreen: boolean
  isFocused: boolean
}

function readCurrentWindowState(
  runtime: MainKernelRouteRuntime,
  context: RouteContext
): WindowState {
  const window = context.windowId != null ? BrowserWindow.fromId(context.windowId) : null
  const exists = Boolean(window && !window.isDestroyed())

  return {
    windowId: context.windowId,
    exists,
    isMaximized: exists ? window!.isMaximized() : false,
    isFullScreen: exists ? window!.isFullScreen() : false,
    isFocused: exists ? runtime.windowPresenter.isMainWindowFocused(context.windowId!) : false
  }
}

async function readBrowserStatus(runtime: MainKernelRouteRuntime, sessionId: string) {
  return await runtime.yoBrowserPresenter.getBrowserStatus(sessionId)
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
  const getSettingsWindowId = (
    runtime.windowPresenter as IWindowPresenter & { getSettingsWindowId?: () => number | null }
  ).getSettingsWindowId

  if (context.windowId == null || typeof getSettingsWindowId !== 'function') {
    return false
  }

  return getSettingsWindowId.call(runtime.windowPresenter) === context.windowId
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
    routeName === mcpGetNpmRegistryStatusRoute.name ||
    routeName === computerUseGetStatusRoute.name ||
    routeName === computerUseCheckPermissionsRoute.name

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
  if (!hasDeepchatRouteContract(routeName)) {
    throw new Error(`Unknown deepchat route: ${routeName}`)
  }

  const configResult = await dispatchConfigRoute(runtime.configPresenter, routeName, rawInput)
  if (configResult !== undefined) {
    return configResult
  }

  const providerResult = await runTrackedRouteTask(runtime, routeName, context, async () => {
    return await dispatchProviderRoute(
      {
        configPresenter: runtime.configPresenter,
        llmProviderPresenter: runtime.llmProviderPresenter
      },
      routeName,
      rawInput
    )
  })
  if (providerResult !== undefined) {
    return providerResult
  }

  const modelResult = await runTrackedRouteTask(runtime, routeName, context, async () => {
    return await dispatchModelRoute(
      {
        configPresenter: runtime.configPresenter,
        llmProviderPresenter: runtime.llmProviderPresenter
      },
      routeName,
      rawInput
    )
  })
  if (modelResult !== undefined) {
    return modelResult
  }

  switch (routeName) {
    case windowGetCurrentStateRoute.name: {
      windowGetCurrentStateRoute.input.parse(rawInput)
      return windowGetCurrentStateRoute.output.parse({
        state: readCurrentWindowState(runtime, context)
      })
    }

    case windowMinimizeCurrentRoute.name: {
      windowMinimizeCurrentRoute.input.parse(rawInput)
      if (context.windowId != null) {
        runtime.windowPresenter.minimize(context.windowId)
      }
      return windowMinimizeCurrentRoute.output.parse({
        state: readCurrentWindowState(runtime, context)
      })
    }

    case windowToggleMaximizeCurrentRoute.name: {
      windowToggleMaximizeCurrentRoute.input.parse(rawInput)
      if (context.windowId != null) {
        runtime.windowPresenter.maximize(context.windowId)
      }
      return windowToggleMaximizeCurrentRoute.output.parse({
        state: readCurrentWindowState(runtime, context)
      })
    }

    case windowCloseCurrentRoute.name: {
      windowCloseCurrentRoute.input.parse(rawInput)
      if (context.windowId != null) {
        runtime.windowPresenter.close(context.windowId)
        return windowCloseCurrentRoute.output.parse({ closed: true })
      }
      return windowCloseCurrentRoute.output.parse({ closed: false })
    }

    case windowCloseFloatingCurrentRoute.name: {
      windowCloseFloatingCurrentRoute.input.parse(rawInput)
      const floatingWindow = runtime.windowPresenter.getFloatingChatWindow()?.getWindow() ?? null
      if (
        floatingWindow &&
        !floatingWindow.isDestroyed() &&
        floatingWindow.webContents.id === context.webContentsId
      ) {
        runtime.windowPresenter.hide(floatingWindow.id)
        return windowCloseFloatingCurrentRoute.output.parse({ closed: true })
      }
      return windowCloseFloatingCurrentRoute.output.parse({ closed: false })
    }

    case windowPreviewFileRoute.name: {
      const input = windowPreviewFileRoute.input.parse(rawInput)
      runtime.windowPresenter.previewFile(input.filePath)
      return windowPreviewFileRoute.output.parse({ previewed: true })
    }

    case deviceGetAppVersionRoute.name: {
      deviceGetAppVersionRoute.input.parse(rawInput)
      return deviceGetAppVersionRoute.output.parse({
        version: await runtime.devicePresenter.getAppVersion()
      })
    }

    case deviceGetInfoRoute.name: {
      deviceGetInfoRoute.input.parse(rawInput)
      return deviceGetInfoRoute.output.parse({
        info: await runtime.devicePresenter.getDeviceInfo()
      })
    }

    case deviceSelectDirectoryRoute.name: {
      deviceSelectDirectoryRoute.input.parse(rawInput)
      return deviceSelectDirectoryRoute.output.parse(
        await runtime.devicePresenter.selectDirectory()
      )
    }

    case deviceRestartAppRoute.name: {
      deviceRestartAppRoute.input.parse(rawInput)
      await runtime.devicePresenter.restartApp()
      return deviceRestartAppRoute.output.parse({ restarted: true })
    }

    case deviceSanitizeSvgRoute.name: {
      const input = deviceSanitizeSvgRoute.input.parse(rawInput)
      return deviceSanitizeSvgRoute.output.parse({
        content: await runtime.devicePresenter.sanitizeSvgContent(input.svgContent)
      })
    }

    case computerUseGetStatusRoute.name: {
      computerUseGetStatusRoute.input.parse(rawInput)
      return computerUseGetStatusRoute.output.parse({
        status: await runtime.computerUsePresenter.getStatus()
      })
    }

    case computerUseSetEnabledRoute.name: {
      const input = computerUseSetEnabledRoute.input.parse(rawInput)
      return computerUseSetEnabledRoute.output.parse({
        status: await runtime.computerUsePresenter.setEnabled(input.enabled)
      })
    }

    case computerUseOpenPermissionGuideRoute.name: {
      const input = computerUseOpenPermissionGuideRoute.input.parse(rawInput)
      await runtime.computerUsePresenter.openPermissionGuide(input.target)
      return computerUseOpenPermissionGuideRoute.output.parse({ opened: true })
    }

    case computerUseCheckPermissionsRoute.name: {
      computerUseCheckPermissionsRoute.input.parse(rawInput)
      return computerUseCheckPermissionsRoute.output.parse({
        permissions: await runtime.computerUsePresenter.checkPermissions()
      })
    }

    case computerUseRestartMcpServerRoute.name: {
      computerUseRestartMcpServerRoute.input.parse(rawInput)
      return computerUseRestartMcpServerRoute.output.parse({
        status: await runtime.computerUsePresenter.restartMcpServer()
      })
    }

    case pluginsListRoute.name: {
      pluginsListRoute.input.parse(rawInput)
      return pluginsListRoute.output.parse({
        plugins: await runtime.pluginPresenter.listPlugins()
      })
    }

    case pluginsGetRoute.name: {
      const input = pluginsGetRoute.input.parse(rawInput)
      return pluginsGetRoute.output.parse({
        plugin: await runtime.pluginPresenter.getPlugin(input.pluginId)
      })
    }

    case pluginsInstallRoute.name: {
      const input = pluginsInstallRoute.input.parse(rawInput)
      return pluginsInstallRoute.output.parse({
        result: await runtime.pluginPresenter.installOfficialPlugin(input.pluginId)
      })
    }

    case pluginsEnableRoute.name: {
      const input = pluginsEnableRoute.input.parse(rawInput)
      return pluginsEnableRoute.output.parse({
        result: await runtime.pluginPresenter.enablePlugin(input.pluginId)
      })
    }

    case pluginsDisableRoute.name: {
      const input = pluginsDisableRoute.input.parse(rawInput)
      return pluginsDisableRoute.output.parse({
        result: await runtime.pluginPresenter.disablePlugin(input.pluginId)
      })
    }

    case pluginsDeleteRoute.name: {
      const input = pluginsDeleteRoute.input.parse(rawInput)
      return pluginsDeleteRoute.output.parse({
        result: await runtime.pluginPresenter.deletePlugin(input.pluginId)
      })
    }

    case pluginsInvokeActionRoute.name: {
      const input = pluginsInvokeActionRoute.input.parse(rawInput)
      return pluginsInvokeActionRoute.output.parse({
        result: await runtime.pluginPresenter.invokeAction(
          input.pluginId,
          input.actionId,
          input.payload
        )
      })
    }

    case projectListRecentRoute.name: {
      const input = projectListRecentRoute.input.parse(rawInput)
      return projectListRecentRoute.output.parse({
        projects: await runtime.projectPresenter.getRecentProjects(input.limit ?? 20)
      })
    }

    case projectListEnvironmentsRoute.name: {
      projectListEnvironmentsRoute.input.parse(rawInput)
      return projectListEnvironmentsRoute.output.parse({
        environments: await runtime.projectPresenter.getEnvironments()
      })
    }

    case projectOpenDirectoryRoute.name: {
      const input = projectOpenDirectoryRoute.input.parse(rawInput)
      await runtime.projectPresenter.openDirectory(input.path)
      return projectOpenDirectoryRoute.output.parse({ opened: true })
    }

    case projectSelectDirectoryRoute.name: {
      projectSelectDirectoryRoute.input.parse(rawInput)
      return projectSelectDirectoryRoute.output.parse({
        path: await runtime.projectPresenter.selectDirectory()
      })
    }

    case fileGetMimeTypeRoute.name: {
      const input = fileGetMimeTypeRoute.input.parse(rawInput)
      return fileGetMimeTypeRoute.output.parse({
        mimeType: await runtime.filePresenter.getMimeType(input.path)
      })
    }

    case filePrepareFileRoute.name: {
      const input = filePrepareFileRoute.input.parse(rawInput)
      return filePrepareFileRoute.output.parse({
        file: await runtime.filePresenter.prepareFile(input.path, input.mimeType)
      })
    }

    case filePrepareDirectoryRoute.name: {
      const input = filePrepareDirectoryRoute.input.parse(rawInput)
      return filePrepareDirectoryRoute.output.parse({
        file: await runtime.filePresenter.prepareDirectory(input.path)
      })
    }

    case fileReadFileRoute.name: {
      const input = fileReadFileRoute.input.parse(rawInput)
      return fileReadFileRoute.output.parse({
        content: await runtime.filePresenter.readFile(input.path)
      })
    }

    case fileIsDirectoryRoute.name: {
      const input = fileIsDirectoryRoute.input.parse(rawInput)
      return fileIsDirectoryRoute.output.parse({
        isDirectory: await runtime.filePresenter.isDirectory(input.path)
      })
    }

    case fileWriteImageBase64Route.name: {
      const input = fileWriteImageBase64Route.input.parse(rawInput)
      return fileWriteImageBase64Route.output.parse({
        path: await runtime.filePresenter.writeImageBase64(input)
      })
    }

    case workspaceRegisterRoute.name: {
      const input = workspaceRegisterRoute.input.parse(rawInput)
      if (input.mode === 'workdir') {
        await runtime.workspacePresenter.registerWorkdir(input.workspacePath)
      } else {
        await runtime.workspacePresenter.registerWorkspace(input.workspacePath)
      }
      return workspaceRegisterRoute.output.parse({ registered: true })
    }

    case workspaceUnregisterRoute.name: {
      const input = workspaceUnregisterRoute.input.parse(rawInput)
      if (input.mode === 'workdir') {
        await runtime.workspacePresenter.unregisterWorkdir(input.workspacePath)
      } else {
        await runtime.workspacePresenter.unregisterWorkspace(input.workspacePath)
      }
      return workspaceUnregisterRoute.output.parse({ unregistered: true })
    }

    case workspaceWatchRoute.name: {
      const input = workspaceWatchRoute.input.parse(rawInput)
      await runtime.workspacePresenter.watchWorkspace(input.workspacePath)
      return workspaceWatchRoute.output.parse({ watching: true })
    }

    case workspaceUnwatchRoute.name: {
      const input = workspaceUnwatchRoute.input.parse(rawInput)
      await runtime.workspacePresenter.unwatchWorkspace(input.workspacePath)
      return workspaceUnwatchRoute.output.parse({ watching: false })
    }

    case workspaceReadDirectoryRoute.name: {
      const input = workspaceReadDirectoryRoute.input.parse(rawInput)
      return workspaceReadDirectoryRoute.output.parse({
        nodes: await runtime.workspacePresenter.readDirectory(input.path)
      })
    }

    case workspaceExpandDirectoryRoute.name: {
      const input = workspaceExpandDirectoryRoute.input.parse(rawInput)
      return workspaceExpandDirectoryRoute.output.parse({
        nodes: await runtime.workspacePresenter.expandDirectory(input.path)
      })
    }

    case workspaceRevealFileInFolderRoute.name: {
      const input = workspaceRevealFileInFolderRoute.input.parse(rawInput)
      await runtime.workspacePresenter.revealFileInFolder(input.path)
      return workspaceRevealFileInFolderRoute.output.parse({ revealed: true })
    }

    case workspaceOpenFileRoute.name: {
      const input = workspaceOpenFileRoute.input.parse(rawInput)
      await runtime.workspacePresenter.openFile(input.path)
      return workspaceOpenFileRoute.output.parse({ opened: true })
    }

    case workspaceReadFilePreviewRoute.name: {
      const input = workspaceReadFilePreviewRoute.input.parse(rawInput)
      return workspaceReadFilePreviewRoute.output.parse({
        preview: await runtime.workspacePresenter.readFilePreview(input.path)
      })
    }

    case workspaceResolveMarkdownLinkedFileRoute.name: {
      const input = workspaceResolveMarkdownLinkedFileRoute.input.parse(rawInput)
      return workspaceResolveMarkdownLinkedFileRoute.output.parse({
        resolution: await runtime.workspacePresenter.resolveMarkdownLinkedFile(input)
      })
    }

    case workspaceGetGitStatusRoute.name: {
      const input = workspaceGetGitStatusRoute.input.parse(rawInput)
      return workspaceGetGitStatusRoute.output.parse({
        state: await runtime.workspacePresenter.getGitStatus(input.workspacePath)
      })
    }

    case workspaceGetGitDiffRoute.name: {
      const input = workspaceGetGitDiffRoute.input.parse(rawInput)
      return workspaceGetGitDiffRoute.output.parse({
        diff: await runtime.workspacePresenter.getGitDiff(input.workspacePath, input.filePath)
      })
    }

    case workspaceSearchFilesRoute.name: {
      const input = workspaceSearchFilesRoute.input.parse(rawInput)
      return workspaceSearchFilesRoute.output.parse({
        nodes: await runtime.workspacePresenter.searchFiles(input.workspacePath, input.query)
      })
    }

    case browserGetStatusRoute.name: {
      const input = browserGetStatusRoute.input.parse(rawInput)
      return browserGetStatusRoute.output.parse({
        status: await readBrowserStatus(runtime, input.sessionId)
      })
    }

    case browserLoadUrlRoute.name: {
      const input = browserLoadUrlRoute.input.parse(rawInput)
      const browserPresenter = runtime.yoBrowserPresenter as IYoBrowserPresenter & {
        loadUrl: (
          sessionId: string,
          url: string,
          timeoutMs?: number,
          hostWindowId?: number
        ) => Promise<Awaited<ReturnType<IYoBrowserPresenter['getBrowserStatus']>>>
      }

      return browserLoadUrlRoute.output.parse({
        status: await browserPresenter.loadUrl(
          input.sessionId,
          input.url,
          input.timeoutMs,
          context.windowId ?? undefined
        )
      })
    }

    case browserAttachCurrentWindowRoute.name: {
      const input = browserAttachCurrentWindowRoute.input.parse(rawInput)
      if (context.windowId == null) {
        return browserAttachCurrentWindowRoute.output.parse({ attached: false })
      }

      return browserAttachCurrentWindowRoute.output.parse({
        attached: await runtime.yoBrowserPresenter.attachSessionBrowser(
          input.sessionId,
          context.windowId
        )
      })
    }

    case browserUpdateCurrentWindowBoundsRoute.name: {
      const input = browserUpdateCurrentWindowBoundsRoute.input.parse(rawInput)
      if (context.windowId == null) {
        return browserUpdateCurrentWindowBoundsRoute.output.parse({ updated: false })
      }

      await runtime.yoBrowserPresenter.updateSessionBrowserBounds(
        input.sessionId,
        context.windowId,
        input.bounds,
        input.visible
      )
      return browserUpdateCurrentWindowBoundsRoute.output.parse({ updated: true })
    }

    case browserDetachRoute.name: {
      const input = browserDetachRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.detachSessionBrowser(input.sessionId)
      return browserDetachRoute.output.parse({ detached: true })
    }

    case browserDestroyRoute.name: {
      const input = browserDestroyRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.destroySessionBrowser(input.sessionId)
      return browserDestroyRoute.output.parse({ destroyed: true })
    }

    case browserGoBackRoute.name: {
      const input = browserGoBackRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.goBack(input.sessionId)
      return browserGoBackRoute.output.parse({
        status: await readBrowserStatus(runtime, input.sessionId)
      })
    }

    case browserGoForwardRoute.name: {
      const input = browserGoForwardRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.goForward(input.sessionId)
      return browserGoForwardRoute.output.parse({
        status: await readBrowserStatus(runtime, input.sessionId)
      })
    }

    case browserReloadRoute.name: {
      const input = browserReloadRoute.input.parse(rawInput)
      await runtime.yoBrowserPresenter.reload(input.sessionId)
      return browserReloadRoute.output.parse({
        status: await readBrowserStatus(runtime, input.sessionId)
      })
    }

    case tabNotifyRendererReadyRoute.name: {
      tabNotifyRendererReadyRoute.input.parse(rawInput)
      await runtime.tabPresenter.onRendererTabReady(context.webContentsId)
      return tabNotifyRendererReadyRoute.output.parse({ notified: true })
    }

    case tabNotifyRendererActivatedRoute.name: {
      const input = tabNotifyRendererActivatedRoute.input.parse(rawInput)
      await runtime.tabPresenter.onRendererTabActivated(input.sessionId)
      return tabNotifyRendererActivatedRoute.output.parse({ notified: true })
    }

    case tabCaptureCurrentAreaRoute.name: {
      const input = tabCaptureCurrentAreaRoute.input.parse(rawInput)
      return tabCaptureCurrentAreaRoute.output.parse({
        imageData: await runtime.tabPresenter.captureTabArea(context.webContentsId, input.rect)
      })
    }

    case tabStitchImagesWithWatermarkRoute.name: {
      const input = tabStitchImagesWithWatermarkRoute.input.parse(rawInput)
      return tabStitchImagesWithWatermarkRoute.output.parse({
        imageData: await runtime.tabPresenter.stitchImagesWithWatermark(
          input.images,
          input.watermark
        )
      })
    }

    case settingsGetSnapshotRoute.name: {
      return runtime.settingsHandler.getSnapshot(rawInput)
    }

    case settingsListSystemFontsRoute.name: {
      return await runtime.settingsHandler.listSystemFonts(rawInput)
    }

    case settingsUpdateRoute.name: {
      return runtime.settingsHandler.update(rawInput)
    }

    case startupGetBootstrapRoute.name: {
      startupGetBootstrapRoute.input.parse(rawInput)
      const coordinator = (runtime as Partial<MainKernelRouteRuntime>).startupWorkloadCoordinator

      if (!coordinator) {
        const activeSessionId = runtime.agentSessionPresenter.getActiveSessionId(
          context.webContentsId
        )
        const activeSession = activeSessionId
          ? ((
              await runtime.agentSessionPresenter.getLightweightSessionsByIds([activeSessionId])
            )[0] ?? null)
          : null
        const [agents, acpEnabled] = await Promise.all([
          runtime.configPresenter.listAgents(),
          runtime.configPresenter.getAcpEnabled()
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
          defaultProjectPath: runtime.configPresenter.getDefaultProjectPath()
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
          const activeSessionId = runtime.agentSessionPresenter.getActiveSessionId(
            context.webContentsId
          )
          const activeSession = activeSessionId
            ? ((
                await runtime.agentSessionPresenter.getLightweightSessionsByIds([activeSessionId])
              )[0] ?? null)
            : null
          const [agents, acpEnabled] = await Promise.all([
            runtime.configPresenter.listAgents(),
            runtime.configPresenter.getAcpEnabled()
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
            defaultProjectPath: runtime.configPresenter.getDefaultProjectPath()
          }

          coordinator.replayTarget('main')
          return startupGetBootstrapRoute.output.parse({ bootstrap })
        }
      })
    }

    case sessionsCreateRoute.name: {
      const input = sessionsCreateRoute.input.parse(rawInput)
      const session = await runtime.sessionService.createSession(input, context)
      return sessionsCreateRoute.output.parse({ session })
    }

    case sessionsRestoreRoute.name: {
      const input = sessionsRestoreRoute.input.parse(rawInput)
      const { session, messages } = await runtime.sessionService.restoreSession(input.sessionId)
      return sessionsRestoreRoute.output.parse({ session, messages })
    }

    case sessionsListRoute.name: {
      const input = sessionsListRoute.input.parse(rawInput)
      const sessions = await runtime.sessionService.listSessions(input)
      return sessionsListRoute.output.parse({ sessions })
    }

    case sessionsListLightweightRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        const input = sessionsListLightweightRoute.input.parse(rawInput)
        const page = await runtime.agentSessionPresenter.getLightweightSessionList(input)
        return sessionsListLightweightRoute.output.parse(page)
      })
    }

    case sessionsGetLightweightByIdsRoute.name: {
      const input = sessionsGetLightweightByIdsRoute.input.parse(rawInput)
      const items = await runtime.agentSessionPresenter.getLightweightSessionsByIds(
        input.sessionIds
      )
      return sessionsGetLightweightByIdsRoute.output.parse({ items })
    }

    case sessionsActivateRoute.name: {
      const input = sessionsActivateRoute.input.parse(rawInput)
      await runtime.sessionService.activateSession(context, input.sessionId)
      return sessionsActivateRoute.output.parse({ activated: true })
    }

    case sessionsDeactivateRoute.name: {
      sessionsDeactivateRoute.input.parse(rawInput)
      await runtime.sessionService.deactivateSession(context)
      return sessionsDeactivateRoute.output.parse({ deactivated: true })
    }

    case sessionsGetActiveRoute.name: {
      sessionsGetActiveRoute.input.parse(rawInput)
      const session = await runtime.sessionService.getActiveSession(context)
      return sessionsGetActiveRoute.output.parse({ session })
    }

    case sessionsEnsureAcpDraftRoute.name: {
      const input = sessionsEnsureAcpDraftRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.ensureAcpDraftSession(input)
      return sessionsEnsureAcpDraftRoute.output.parse({ session })
    }

    case sessionsListPendingInputsRoute.name: {
      const input = sessionsListPendingInputsRoute.input.parse(rawInput)
      const items = await runtime.agentSessionPresenter.listPendingInputs(input.sessionId)
      return sessionsListPendingInputsRoute.output.parse({ items })
    }

    case sessionsQueuePendingInputRoute.name: {
      const input = sessionsQueuePendingInputRoute.input.parse(rawInput)
      const item = await runtime.agentSessionPresenter.queuePendingInput(
        input.sessionId,
        input.content
      )
      return sessionsQueuePendingInputRoute.output.parse({ item })
    }

    case sessionsUpdateQueuedInputRoute.name: {
      const input = sessionsUpdateQueuedInputRoute.input.parse(rawInput)
      const item = await runtime.agentSessionPresenter.updateQueuedInput(
        input.sessionId,
        input.itemId,
        input.content
      )
      return sessionsUpdateQueuedInputRoute.output.parse({ item })
    }

    case sessionsMoveQueuedInputRoute.name: {
      const input = sessionsMoveQueuedInputRoute.input.parse(rawInput)
      const items = await runtime.agentSessionPresenter.moveQueuedInput(
        input.sessionId,
        input.itemId,
        input.toIndex
      )
      return sessionsMoveQueuedInputRoute.output.parse({ items })
    }

    case sessionsConvertPendingInputToSteerRoute.name: {
      const input = sessionsConvertPendingInputToSteerRoute.input.parse(rawInput)
      const item = await runtime.agentSessionPresenter.convertPendingInputToSteer(
        input.sessionId,
        input.itemId
      )
      return sessionsConvertPendingInputToSteerRoute.output.parse({ item })
    }

    case sessionsDeletePendingInputRoute.name: {
      const input = sessionsDeletePendingInputRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.deletePendingInput(input.sessionId, input.itemId)
      return sessionsDeletePendingInputRoute.output.parse({ deleted: true })
    }

    case sessionsResumePendingQueueRoute.name: {
      const input = sessionsResumePendingQueueRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.resumePendingQueue(input.sessionId)
      return sessionsResumePendingQueueRoute.output.parse({ resumed: true })
    }

    case sessionsRetryMessageRoute.name: {
      const input = sessionsRetryMessageRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.retryMessage(input.sessionId, input.messageId)
      return sessionsRetryMessageRoute.output.parse({ retried: true })
    }

    case sessionsDeleteMessageRoute.name: {
      const input = sessionsDeleteMessageRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.deleteMessage(input.sessionId, input.messageId)
      return sessionsDeleteMessageRoute.output.parse({ deleted: true })
    }

    case sessionsEditUserMessageRoute.name: {
      const input = sessionsEditUserMessageRoute.input.parse(rawInput)
      const message = await runtime.agentSessionPresenter.editUserMessage(
        input.sessionId,
        input.messageId,
        input.text
      )
      return sessionsEditUserMessageRoute.output.parse({ message })
    }

    case sessionsForkRoute.name: {
      const input = sessionsForkRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.forkSession(
        input.sourceSessionId,
        input.targetMessageId,
        input.newTitle
      )
      return sessionsForkRoute.output.parse({ session })
    }

    case sessionsSearchHistoryRoute.name: {
      const input = sessionsSearchHistoryRoute.input.parse(rawInput)
      const hits = await runtime.agentSessionPresenter.searchHistory(input.query, input.options)
      return sessionsSearchHistoryRoute.output.parse({ hits })
    }

    case sessionsGetSearchResultsRoute.name: {
      const input = sessionsGetSearchResultsRoute.input.parse(rawInput)
      const results = await runtime.agentSessionPresenter.getSearchResults(
        input.messageId,
        input.searchId
      )
      return sessionsGetSearchResultsRoute.output.parse({ results })
    }

    case sessionsListMessageTracesRoute.name: {
      const input = sessionsListMessageTracesRoute.input.parse(rawInput)
      const traces = await runtime.agentSessionPresenter.listMessageTraces(input.messageId)
      return sessionsListMessageTracesRoute.output.parse({ traces })
    }

    case sessionsTranslateTextRoute.name: {
      const input = sessionsTranslateTextRoute.input.parse(rawInput)
      const text = await runtime.agentSessionPresenter.translateText(
        input.text,
        input.locale,
        input.agentId
      )
      return sessionsTranslateTextRoute.output.parse({ text })
    }

    case sessionsGetAgentsRoute.name: {
      sessionsGetAgentsRoute.input.parse(rawInput)
      const agents = await runtime.agentSessionPresenter.getAgents()
      return sessionsGetAgentsRoute.output.parse({ agents })
    }

    case sessionsRenameRoute.name: {
      const input = sessionsRenameRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.renameSession(input.sessionId, input.title)
      return sessionsRenameRoute.output.parse({ updated: true })
    }

    case sessionsTogglePinnedRoute.name: {
      const input = sessionsTogglePinnedRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.toggleSessionPinned(input.sessionId, input.pinned)
      return sessionsTogglePinnedRoute.output.parse({ updated: true })
    }

    case sessionsClearMessagesRoute.name: {
      const input = sessionsClearMessagesRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.clearSessionMessages(input.sessionId)
      return sessionsClearMessagesRoute.output.parse({ cleared: true })
    }

    case sessionsExportRoute.name: {
      const input = sessionsExportRoute.input.parse(rawInput)
      const result = await runtime.agentSessionPresenter.exportSession(
        input.sessionId,
        input.format
      )
      return sessionsExportRoute.output.parse(result)
    }

    case sessionsDeleteRoute.name: {
      const input = sessionsDeleteRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.deleteSession(input.sessionId)
      return sessionsDeleteRoute.output.parse({ deleted: true })
    }

    case sessionsGetAcpSessionCommandsRoute.name: {
      const input = sessionsGetAcpSessionCommandsRoute.input.parse(rawInput)
      const commands = await runtime.agentSessionPresenter.getAcpSessionCommands(input.sessionId)
      return sessionsGetAcpSessionCommandsRoute.output.parse({ commands })
    }

    case sessionsGetAcpSessionConfigOptionsRoute.name: {
      const input = sessionsGetAcpSessionConfigOptionsRoute.input.parse(rawInput)
      const state = await runtime.agentSessionPresenter.getAcpSessionConfigOptions(input.sessionId)
      return sessionsGetAcpSessionConfigOptionsRoute.output.parse({ state })
    }

    case sessionsSetAcpSessionConfigOptionRoute.name: {
      const input = sessionsSetAcpSessionConfigOptionRoute.input.parse(rawInput)
      const state = await runtime.agentSessionPresenter.setAcpSessionConfigOption(
        input.sessionId,
        input.configId,
        input.value
      )
      return sessionsSetAcpSessionConfigOptionRoute.output.parse({ state })
    }

    case sessionsGetPermissionModeRoute.name: {
      const input = sessionsGetPermissionModeRoute.input.parse(rawInput)
      const mode = await runtime.agentSessionPresenter.getPermissionMode(input.sessionId)
      return sessionsGetPermissionModeRoute.output.parse({ mode })
    }

    case sessionsSetPermissionModeRoute.name: {
      const input = sessionsSetPermissionModeRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.setPermissionMode(input.sessionId, input.mode)
      return sessionsSetPermissionModeRoute.output.parse({ updated: true })
    }

    case sessionsSetSubagentEnabledRoute.name: {
      const input = sessionsSetSubagentEnabledRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.setSessionSubagentEnabled(
        input.sessionId,
        input.enabled
      )
      return sessionsSetSubagentEnabledRoute.output.parse({ session })
    }

    case sessionsSetModelRoute.name: {
      const input = sessionsSetModelRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.setSessionModel(
        input.sessionId,
        input.providerId,
        input.modelId
      )
      return sessionsSetModelRoute.output.parse({ session })
    }

    case sessionsSetProjectDirRoute.name: {
      const input = sessionsSetProjectDirRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.setSessionProjectDir(
        input.sessionId,
        input.projectDir
      )
      return sessionsSetProjectDirRoute.output.parse({ session })
    }

    case sessionsGetGenerationSettingsRoute.name: {
      const input = sessionsGetGenerationSettingsRoute.input.parse(rawInput)
      const settings = await runtime.agentSessionPresenter.getSessionGenerationSettings(
        input.sessionId
      )
      return sessionsGetGenerationSettingsRoute.output.parse({ settings })
    }

    case sessionsGetDisabledAgentToolsRoute.name: {
      const input = sessionsGetDisabledAgentToolsRoute.input.parse(rawInput)
      const disabledAgentTools = await runtime.agentSessionPresenter.getSessionDisabledAgentTools(
        input.sessionId
      )
      return sessionsGetDisabledAgentToolsRoute.output.parse({ disabledAgentTools })
    }

    case sessionsUpdateDisabledAgentToolsRoute.name: {
      const input = sessionsUpdateDisabledAgentToolsRoute.input.parse(rawInput)
      const disabledAgentTools =
        await runtime.agentSessionPresenter.updateSessionDisabledAgentTools(
          input.sessionId,
          input.disabledAgentTools
        )
      return sessionsUpdateDisabledAgentToolsRoute.output.parse({ disabledAgentTools })
    }

    case sessionsUpdateGenerationSettingsRoute.name: {
      const input = sessionsUpdateGenerationSettingsRoute.input.parse(rawInput)
      const settings = await runtime.agentSessionPresenter.updateSessionGenerationSettings(
        input.sessionId,
        input.settings
      )
      return sessionsUpdateGenerationSettingsRoute.output.parse({ settings })
    }

    case skillsListMetadataRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        skillsListMetadataRoute.input.parse(rawInput)
        const skills = await runtime.skillPresenter.getMetadataList()
        return skillsListMetadataRoute.output.parse({ skills })
      })
    }

    case skillsGetDirectoryRoute.name: {
      skillsGetDirectoryRoute.input.parse(rawInput)
      const path = await runtime.skillPresenter.getSkillsDir()
      return skillsGetDirectoryRoute.output.parse({ path })
    }

    case skillsInstallFromFolderRoute.name: {
      const input = skillsInstallFromFolderRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.installFromFolder(input.folderPath, input.options)
      return skillsInstallFromFolderRoute.output.parse({ result })
    }

    case skillsInstallFromZipRoute.name: {
      const input = skillsInstallFromZipRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.installFromZip(input.zipPath, input.options)
      return skillsInstallFromZipRoute.output.parse({ result })
    }

    case skillsInstallFromUrlRoute.name: {
      const input = skillsInstallFromUrlRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.installFromUrl(input.url, input.options)
      return skillsInstallFromUrlRoute.output.parse({ result })
    }

    case skillsUninstallRoute.name: {
      const input = skillsUninstallRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.uninstallSkill(input.name)
      return skillsUninstallRoute.output.parse({ result })
    }

    case skillsUpdateFileRoute.name: {
      const input = skillsUpdateFileRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.updateSkillFile(input.name, input.content)
      return skillsUpdateFileRoute.output.parse({ result })
    }

    case skillsSaveWithExtensionRoute.name: {
      const input = skillsSaveWithExtensionRoute.input.parse(rawInput)
      const result = await runtime.skillPresenter.saveSkillWithExtension(
        input.name,
        input.content,
        input.config
      )
      return skillsSaveWithExtensionRoute.output.parse({ result })
    }

    case skillsGetFolderTreeRoute.name: {
      const input = skillsGetFolderTreeRoute.input.parse(rawInput)
      const nodes = await runtime.skillPresenter.getSkillFolderTree(input.name)
      return skillsGetFolderTreeRoute.output.parse({ nodes })
    }

    case skillsOpenFolderRoute.name: {
      skillsOpenFolderRoute.input.parse(rawInput)
      await runtime.skillPresenter.openSkillsFolder()
      return skillsOpenFolderRoute.output.parse({ opened: true })
    }

    case skillsGetExtensionRoute.name: {
      const input = skillsGetExtensionRoute.input.parse(rawInput)
      const config = await runtime.skillPresenter.getSkillExtension(input.name)
      return skillsGetExtensionRoute.output.parse({ config })
    }

    case skillsSaveExtensionRoute.name: {
      const input = skillsSaveExtensionRoute.input.parse(rawInput)
      await runtime.skillPresenter.saveSkillExtension(input.name, input.config)
      return skillsSaveExtensionRoute.output.parse({ saved: true })
    }

    case skillsListScriptsRoute.name: {
      const input = skillsListScriptsRoute.input.parse(rawInput)
      const scripts = await runtime.skillPresenter.listSkillScripts(input.name)
      return skillsListScriptsRoute.output.parse({ scripts })
    }

    case skillsGetActiveRoute.name: {
      const input = skillsGetActiveRoute.input.parse(rawInput)
      const skills = await runtime.skillPresenter.getActiveSkills(input.conversationId)
      return skillsGetActiveRoute.output.parse({ skills })
    }

    case skillsSetActiveRoute.name: {
      const input = skillsSetActiveRoute.input.parse(rawInput)
      const skills = await runtime.skillPresenter.setActiveSkills(
        input.conversationId,
        input.skills
      )
      return skillsSetActiveRoute.output.parse({ skills })
    }

    case mcpGetServersRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        mcpGetServersRoute.input.parse(rawInput)
        const servers = await runtime.mcpPresenter.getMcpServers()
        return mcpGetServersRoute.output.parse({ servers })
      })
    }

    case mcpGetEnabledRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        mcpGetEnabledRoute.input.parse(rawInput)
        const enabled = await runtime.mcpPresenter.getMcpEnabled()
        return mcpGetEnabledRoute.output.parse({ enabled })
      })
    }

    case mcpGetClientsRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        mcpGetClientsRoute.input.parse(rawInput)
        const clients = await runtime.mcpPresenter.getMcpClients()
        return mcpGetClientsRoute.output.parse({ clients })
      })
    }

    case mcpListToolDefinitionsRoute.name: {
      const input = mcpListToolDefinitionsRoute.input.parse(rawInput)
      const tools = await runtime.mcpPresenter.getAllToolDefinitions(input.enabledMcpTools)
      return mcpListToolDefinitionsRoute.output.parse({ tools })
    }

    case mcpListPromptsRoute.name: {
      mcpListPromptsRoute.input.parse(rawInput)
      const prompts = await runtime.mcpPresenter.getAllPrompts()
      return mcpListPromptsRoute.output.parse({ prompts })
    }

    case mcpListResourcesRoute.name: {
      mcpListResourcesRoute.input.parse(rawInput)
      const resources = await runtime.mcpPresenter.getAllResources()
      return mcpListResourcesRoute.output.parse({ resources })
    }

    case mcpCallToolRoute.name: {
      const input = mcpCallToolRoute.input.parse(rawInput)
      const result = await runtime.mcpPresenter.callTool(input.request)
      return mcpCallToolRoute.output.parse(result)
    }

    case mcpAddServerRoute.name: {
      const input = mcpAddServerRoute.input.parse(rawInput)
      const success = await runtime.mcpPresenter.addMcpServer(input.serverName, input.config)
      return mcpAddServerRoute.output.parse({ success })
    }

    case mcpUpdateServerRoute.name: {
      const input = mcpUpdateServerRoute.input.parse(rawInput)
      await runtime.mcpPresenter.updateMcpServer(input.serverName, input.config)
      return mcpUpdateServerRoute.output.parse({ updated: true })
    }

    case mcpRemoveServerRoute.name: {
      const input = mcpRemoveServerRoute.input.parse(rawInput)
      await runtime.mcpPresenter.removeMcpServer(input.serverName)
      return mcpRemoveServerRoute.output.parse({ removed: true })
    }

    case mcpSetServerEnabledRoute.name: {
      const input = mcpSetServerEnabledRoute.input.parse(rawInput)
      await runtime.mcpPresenter.setMcpServerEnabled(input.serverName, input.enabled)
      return mcpSetServerEnabledRoute.output.parse({ enabled: input.enabled })
    }

    case mcpSetEnabledRoute.name: {
      const input = mcpSetEnabledRoute.input.parse(rawInput)
      await runtime.mcpPresenter.setMcpEnabled(input.enabled)
      return mcpSetEnabledRoute.output.parse({ enabled: input.enabled })
    }

    case mcpIsServerRunningRoute.name: {
      const input = mcpIsServerRunningRoute.input.parse(rawInput)
      const running = await runtime.mcpPresenter.isServerRunning(input.serverName)
      return mcpIsServerRunningRoute.output.parse({ running })
    }

    case mcpStartServerRoute.name: {
      const input = mcpStartServerRoute.input.parse(rawInput)
      await runtime.mcpPresenter.startServer(input.serverName)
      return mcpStartServerRoute.output.parse({ started: true })
    }

    case mcpStopServerRoute.name: {
      const input = mcpStopServerRoute.input.parse(rawInput)
      await runtime.mcpPresenter.stopServer(input.serverName)
      return mcpStopServerRoute.output.parse({ stopped: true })
    }

    case mcpGetPromptRoute.name: {
      const input = mcpGetPromptRoute.input.parse(rawInput)
      const result = await runtime.mcpPresenter.getPrompt(input.prompt, input.args)
      return mcpGetPromptRoute.output.parse({ result })
    }

    case mcpReadResourceRoute.name: {
      const input = mcpReadResourceRoute.input.parse(rawInput)
      const resource = await runtime.mcpPresenter.readResource(input.resource)
      return mcpReadResourceRoute.output.parse({ resource })
    }

    case mcpSubmitSamplingDecisionRoute.name: {
      const input = mcpSubmitSamplingDecisionRoute.input.parse(rawInput)
      await runtime.mcpPresenter.submitSamplingDecision(input.decision)
      return mcpSubmitSamplingDecisionRoute.output.parse({ submitted: true })
    }

    case mcpCancelSamplingRequestRoute.name: {
      const input = mcpCancelSamplingRequestRoute.input.parse(rawInput)
      await runtime.mcpPresenter.cancelSamplingRequest(input.requestId, input.reason)
      return mcpCancelSamplingRequestRoute.output.parse({ cancelled: true })
    }

    case mcpGetNpmRegistryStatusRoute.name: {
      return await runTrackedRouteTask(runtime, routeName, context, async () => {
        mcpGetNpmRegistryStatusRoute.input.parse(rawInput)
        if (!runtime.mcpPresenter.getNpmRegistryStatus) {
          throw new Error('NPM registry status is not available')
        }
        const status = await runtime.mcpPresenter.getNpmRegistryStatus()
        return mcpGetNpmRegistryStatusRoute.output.parse({ status })
      })
    }

    case mcpRefreshNpmRegistryRoute.name: {
      mcpRefreshNpmRegistryRoute.input.parse(rawInput)
      if (!runtime.mcpPresenter.refreshNpmRegistry) {
        throw new Error('NPM registry refresh is not available')
      }
      const registry = await runtime.mcpPresenter.refreshNpmRegistry()
      return mcpRefreshNpmRegistryRoute.output.parse({ registry })
    }

    case mcpSetCustomNpmRegistryRoute.name: {
      const input = mcpSetCustomNpmRegistryRoute.input.parse(rawInput)
      if (!runtime.mcpPresenter.setCustomNpmRegistry) {
        throw new Error('Custom NPM registry is not available')
      }
      await runtime.mcpPresenter.setCustomNpmRegistry(input.registry)
      return mcpSetCustomNpmRegistryRoute.output.parse({ updated: true })
    }

    case mcpSetAutoDetectNpmRegistryRoute.name: {
      const input = mcpSetAutoDetectNpmRegistryRoute.input.parse(rawInput)
      if (!runtime.mcpPresenter.setAutoDetectNpmRegistry) {
        throw new Error('Auto detect NPM registry is not available')
      }
      await runtime.mcpPresenter.setAutoDetectNpmRegistry(input.enabled)
      return mcpSetAutoDetectNpmRegistryRoute.output.parse({ enabled: input.enabled })
    }

    case mcpClearNpmRegistryCacheRoute.name: {
      mcpClearNpmRegistryCacheRoute.input.parse(rawInput)
      if (!runtime.mcpPresenter.clearNpmRegistryCache) {
        throw new Error('NPM registry cache clearing is not available')
      }
      await runtime.mcpPresenter.clearNpmRegistryCache()
      return mcpClearNpmRegistryCacheRoute.output.parse({ cleared: true })
    }

    case syncGetBackupStatusRoute.name: {
      syncGetBackupStatusRoute.input.parse(rawInput)
      const status = await runtime.syncPresenter.getBackupStatus()
      return syncGetBackupStatusRoute.output.parse({ status })
    }

    case syncListBackupsRoute.name: {
      syncListBackupsRoute.input.parse(rawInput)
      const backups = await runtime.syncPresenter.listBackups()
      return syncListBackupsRoute.output.parse({ backups })
    }

    case syncStartBackupRoute.name: {
      syncStartBackupRoute.input.parse(rawInput)
      const backup = await runtime.syncPresenter.startBackup()
      return syncStartBackupRoute.output.parse({ backup })
    }

    case syncImportRoute.name: {
      const input = syncImportRoute.input.parse(rawInput)
      const result = await runtime.syncPresenter.importFromSync(input.backupFile, input.mode)
      return syncImportRoute.output.parse({ result })
    }

    case syncOpenFolderRoute.name: {
      syncOpenFolderRoute.input.parse(rawInput)
      await runtime.syncPresenter.openSyncFolder()
      return syncOpenFolderRoute.output.parse({ opened: true })
    }

    case upgradeGetStatusRoute.name: {
      upgradeGetStatusRoute.input.parse(rawInput)
      const snapshot = runtime.upgradePresenter.getUpdateStatus()
      return upgradeGetStatusRoute.output.parse({ snapshot })
    }

    case upgradeCheckRoute.name: {
      const input = upgradeCheckRoute.input.parse(rawInput)
      await runtime.upgradePresenter.checkUpdate(input.type)
      return upgradeCheckRoute.output.parse({ checked: true })
    }

    case upgradeOpenDownloadRoute.name: {
      const input = upgradeOpenDownloadRoute.input.parse(rawInput)
      await runtime.upgradePresenter.goDownloadUpgrade(input.type)
      return upgradeOpenDownloadRoute.output.parse({ opened: true })
    }

    case upgradeStartDownloadRoute.name: {
      upgradeStartDownloadRoute.input.parse(rawInput)
      const started = runtime.upgradePresenter.startDownloadUpdate()
      return upgradeStartDownloadRoute.output.parse({ started })
    }

    case upgradeMockDownloadedRoute.name: {
      upgradeMockDownloadedRoute.input.parse(rawInput)
      const updated = runtime.upgradePresenter.mockDownloadedUpdate()
      return upgradeMockDownloadedRoute.output.parse({ updated })
    }

    case upgradeClearMockRoute.name: {
      upgradeClearMockRoute.input.parse(rawInput)
      const updated = runtime.upgradePresenter.clearMockUpdate()
      return upgradeClearMockRoute.output.parse({ updated })
    }

    case upgradeRestartToUpdateRoute.name: {
      upgradeRestartToUpdateRoute.input.parse(rawInput)
      const restarted = runtime.upgradePresenter.restartToUpdate()
      return upgradeRestartToUpdateRoute.output.parse({ restarted })
    }

    case dialogRespondRoute.name: {
      const input = dialogRespondRoute.input.parse(rawInput)
      await runtime.dialogPresenter.handleDialogResponse(input)
      return dialogRespondRoute.output.parse({ handled: true })
    }

    case dialogErrorRoute.name: {
      const input = dialogErrorRoute.input.parse(rawInput)
      await runtime.dialogPresenter.handleDialogError(input.id)
      return dialogErrorRoute.output.parse({ handled: true })
    }

    case toolsListDefinitionsRoute.name: {
      const input = toolsListDefinitionsRoute.input.parse(rawInput)
      const tools = await runtime.toolPresenter.getAllToolDefinitions(input)
      return toolsListDefinitionsRoute.output.parse({ tools })
    }

    case providersListModelsRoute.name: {
      const input = providersListModelsRoute.input.parse(rawInput)
      return providersListModelsRoute.output.parse(
        await runtime.providerService.listModels(input.providerId)
      )
    }

    case providersTestConnectionRoute.name: {
      const input = providersTestConnectionRoute.input.parse(rawInput)
      return providersTestConnectionRoute.output.parse(
        await runtime.providerService.testConnection(input)
      )
    }

    case chatSendMessageRoute.name: {
      const input = chatSendMessageRoute.input.parse(rawInput)
      return chatSendMessageRoute.output.parse(
        await runtime.chatService.sendMessage(input.sessionId, input.content)
      )
    }

    case chatSteerActiveTurnRoute.name: {
      const input = chatSteerActiveTurnRoute.input.parse(rawInput)
      return chatSteerActiveTurnRoute.output.parse(
        await runtime.chatService.steerActiveTurn(input.sessionId, input.content)
      )
    }

    case chatStopStreamRoute.name: {
      const input = chatStopStreamRoute.input.parse(rawInput)
      return chatStopStreamRoute.output.parse(await runtime.chatService.stopStream(input))
    }

    case chatRespondToolInteractionRoute.name: {
      const input = chatRespondToolInteractionRoute.input.parse(rawInput)
      return chatRespondToolInteractionRoute.output.parse(
        await runtime.chatService.respondToolInteraction(input)
      )
    }

    case systemOpenSettingsRoute.name: {
      const input = systemOpenSettingsRoute.input.parse(rawInput)
      const navigation =
        input.routeName || input.params || input.section
          ? {
              routeName: input.routeName ?? 'settings-common',
              params: input.params,
              section: input.section
            }
          : undefined

      const windowId = await runtime.windowPresenter.createSettingsWindow(navigation)
      return systemOpenSettingsRoute.output.parse({ windowId })
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
