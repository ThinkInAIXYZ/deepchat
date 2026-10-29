import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { createRendererRouteContext, type RouteContext } from '@/routes/routeRegistry'
import type { AuthorizeRendererIpc } from './rendererIpcSecurity'

export function registerDeepchatRoutes(
  ipcMain: IpcMain,
  invoke: (
    routeName: string,
    input: unknown,
    context: RouteContext,
    assertCallerActive: () => void
  ) => Promise<unknown>,
  authorize: AuthorizeRendererIpc
): void {
  ipcMain.removeHandler(DEEPCHAT_ROUTE_INVOKE_CHANNEL)
  ipcMain.handle(
    DEEPCHAT_ROUTE_INVOKE_CHANNEL,
    async (event: IpcMainInvokeEvent, routeName: string, rawInput: unknown) => {
      const assertCallerActive = () => authorize(event, routeName)
      assertCallerActive()
      return await invoke(
        routeName,
        rawInput,
        createRendererRouteContext(
          event.sender.id,
          BrowserWindow.fromWebContents(event.sender)?.id ?? null
        ),
        assertCallerActive
      )
    }
  )
}
