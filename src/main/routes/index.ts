import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  IAgentSessionPresenter,
  IConfigPresenter,
  IDevicePresenter,
  IFilePresenter,
  ILlmProviderPresenter,
  IProjectPresenter,
  ITabPresenter,
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
  chatStopStreamRoute,
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
  projectListEnvironmentsRoute,
  projectListRecentRoute,
  projectOpenDirectoryRoute,
  projectSelectDirectoryRoute,
  providersListModelsRoute,
  providersTestConnectionRoute,
  sessionsActivateRoute,
  sessionsCreateRoute,
  sessionsDeactivateRoute,
  sessionsGetActiveRoute,
  sessionsListRoute,
  sessionsRestoreRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  systemOpenSettingsRoute,
  tabCaptureCurrentAreaRoute,
  tabNotifyRendererActivatedRoute,
  tabNotifyRendererReadyRoute,
  tabStitchImagesWithWatermarkRoute,
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

export type MainKernelRouteRuntime = {
  configPresenter: IConfigPresenter
  llmProviderPresenter: ILlmProviderPresenter
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
}

export function createMainKernelRouteRuntime(deps: {
  configPresenter: IConfigPresenter
  llmProviderPresenter: ILlmProviderPresenter
  agentSessionPresenter: IAgentSessionPresenter
  windowPresenter: IWindowPresenter
  devicePresenter: IDevicePresenter
  projectPresenter: IProjectPresenter
  filePresenter: IFilePresenter
  workspacePresenter: IWorkspacePresenter
  yoBrowserPresenter: IYoBrowserPresenter
  tabPresenter: ITabPresenter
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
    tabPresenter: deps.tabPresenter
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

  const providerResult = await dispatchProviderRoute(
    {
      configPresenter: runtime.configPresenter,
      llmProviderPresenter: runtime.llmProviderPresenter
    },
    routeName,
    rawInput
  )
  if (providerResult !== undefined) {
    return providerResult
  }

  const modelResult = await dispatchModelRoute(
    {
      configPresenter: runtime.configPresenter,
      llmProviderPresenter: runtime.llmProviderPresenter
    },
    routeName,
    rawInput
  )
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
