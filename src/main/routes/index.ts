import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { IAgentSessionPresenter, IConfigPresenter, IWindowPresenter } from '@shared/presenter'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import {
  chatSendMessageRoute,
  chatStopStreamRoute,
  sessionsActivateRoute,
  sessionsCreateRoute,
  sessionsDeactivateRoute,
  sessionsGetActiveRoute,
  sessionsListRoute,
  sessionsRestoreRoute,
  hasDeepchatRouteContract,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  systemOpenSettingsRoute
} from '@shared/contracts/routes'
import { ChatService } from './chat/chatService'
import { createPresenterHotPathPorts } from './hotPathPorts'
import { createNodeScheduler } from './scheduler'
import { createSettingsRouteAdapter } from './settings/settingsAdapter'
import { createSettingsRouteHandler } from './settings/settingsHandler'
import { SessionService } from './sessions/sessionService'

export type MainKernelRouteRuntime = {
  settingsHandler: ReturnType<typeof createSettingsRouteHandler>
  sessionService: SessionService
  chatService: ChatService
  windowPresenter: IWindowPresenter
}

export function createMainKernelRouteRuntime(deps: {
  configPresenter: IConfigPresenter
  agentSessionPresenter: IAgentSessionPresenter
  windowPresenter: IWindowPresenter
}): MainKernelRouteRuntime {
  const scheduler = createNodeScheduler()
  const hotPathPorts = createPresenterHotPathPorts(deps.agentSessionPresenter)

  return {
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
    windowPresenter: deps.windowPresenter
  }
}

type RouteContext = {
  webContentsId: number
  windowId: number | null
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

  switch (routeName) {
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
