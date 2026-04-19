import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { IAgentSessionPresenter, IConfigPresenter, IWindowPresenter } from '@shared/presenter'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import {
  chatSendMessageRoute,
  chatStopStreamRoute,
  sessionsCreateRoute,
  sessionsListRoute,
  sessionsRestoreRoute,
  hasDeepchatRouteContract,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  systemOpenSettingsRoute
} from '@shared/contracts/routes'
import { createSettingsRouteAdapter } from './settings/settingsAdapter'
import { createSettingsRouteHandler } from './settings/settingsHandler'

export type MainKernelRouteRuntime = {
  configPresenter: IConfigPresenter
  agentSessionPresenter: IAgentSessionPresenter
  windowPresenter: IWindowPresenter
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

  const settingsHandler = createSettingsRouteHandler(
    createSettingsRouteAdapter(runtime.configPresenter)
  )

  switch (routeName) {
    case settingsGetSnapshotRoute.name: {
      return settingsHandler.getSnapshot(rawInput)
    }

    case settingsListSystemFontsRoute.name: {
      return await settingsHandler.listSystemFonts(rawInput)
    }

    case settingsUpdateRoute.name: {
      return settingsHandler.update(rawInput)
    }

    case sessionsCreateRoute.name: {
      const input = sessionsCreateRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.createSession(
        input,
        context.webContentsId
      )
      return sessionsCreateRoute.output.parse({ session })
    }

    case sessionsRestoreRoute.name: {
      const input = sessionsRestoreRoute.input.parse(rawInput)
      const session = await runtime.agentSessionPresenter.getSession(input.sessionId)
      const messages = session
        ? await runtime.agentSessionPresenter.getMessages(input.sessionId)
        : []
      return sessionsRestoreRoute.output.parse({ session, messages })
    }

    case sessionsListRoute.name: {
      const input = sessionsListRoute.input.parse(rawInput)
      const sessions = await runtime.agentSessionPresenter.getSessionList(input)
      return sessionsListRoute.output.parse({ sessions })
    }

    case chatSendMessageRoute.name: {
      const input = chatSendMessageRoute.input.parse(rawInput)
      await runtime.agentSessionPresenter.sendMessage(input.sessionId, input.content)
      return chatSendMessageRoute.output.parse({ accepted: true })
    }

    case chatStopStreamRoute.name: {
      const input = chatStopStreamRoute.input.parse(rawInput)
      let targetSessionId = input.sessionId ?? null

      if (!targetSessionId && input.requestId) {
        const message = await runtime.agentSessionPresenter.getMessage(input.requestId)
        targetSessionId = message?.sessionId ?? null
      }

      if (!targetSessionId) {
        return chatStopStreamRoute.output.parse({ stopped: false })
      }

      await runtime.agentSessionPresenter.cancelGeneration(targetSessionId)
      return chatStopStreamRoute.output.parse({ stopped: true })
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
