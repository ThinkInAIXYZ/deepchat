import {
  terminalAttachRoute,
  terminalInputRoute,
  terminalKillRoute,
  terminalResizeRoute,
  terminalRestartRoute
} from '@shared/contracts/routes'
import {
  createRouteMap,
  requireRendererCaller,
  type DeepchatRouteMap,
  type RendererRouteCaller,
  type RouteContext
} from '@/routes/routeRegistry'
import type { SessionTerminalService } from './sessionTerminalService'

export function createTerminalRoutes(dependencies: {
  terminals: SessionTerminalService
  isChatWindowContext(caller: RendererRouteCaller): boolean
  /** The caller window is showing the session, or owns it as an unsent draft. */
  isViewingSession(caller: RendererRouteCaller, sessionId: string): boolean
}): DeepchatRouteMap {
  const requireChatWindow = (context: RouteContext): RendererRouteCaller => {
    const caller = requireRendererCaller(context)
    if (!dependencies.isChatWindowContext(caller)) {
      throw new Error('Session terminal requires a chat window')
    }
    return caller
  }
  const requireViewing = (caller: RendererRouteCaller, sessionId: string) => {
    if (!dependencies.isViewingSession(caller, sessionId)) {
      throw new Error('[terminal:forbidden] Session is not open in this window')
    }
  }

  return createRouteMap([
    [
      terminalAttachRoute.name,
      async (rawInput, context) => {
        const caller = requireChatWindow(context)
        const { sessionId, ...input } = terminalAttachRoute.input.parse(rawInput)
        requireViewing(caller, sessionId)
        return terminalAttachRoute.output.parse(
          await dependencies.terminals.attach(sessionId, caller.webContentsId, input)
        )
      }
    ],
    [
      terminalRestartRoute.name,
      async (rawInput, context) => {
        const caller = requireChatWindow(context)
        const { sessionId, ...input } = terminalRestartRoute.input.parse(rawInput)
        requireViewing(caller, sessionId)
        return terminalRestartRoute.output.parse(
          await dependencies.terminals.restart(sessionId, caller.webContentsId, input)
        )
      }
    ],
    [
      terminalInputRoute.name,
      async (rawInput, context) => {
        const caller = requireChatWindow(context)
        const { terminalId, data } = terminalInputRoute.input.parse(rawInput)
        dependencies.terminals.write(terminalId, caller.webContentsId, data)
        return terminalInputRoute.output.parse({ sent: true })
      }
    ],
    [
      terminalResizeRoute.name,
      async (rawInput, context) => {
        const caller = requireChatWindow(context)
        const { terminalId, cols, rows } = terminalResizeRoute.input.parse(rawInput)
        return terminalResizeRoute.output.parse({
          resized: dependencies.terminals.resize(terminalId, caller.webContentsId, { cols, rows })
        })
      }
    ],
    [
      terminalKillRoute.name,
      async (rawInput, context) => {
        const caller = requireChatWindow(context)
        const { terminalId } = terminalKillRoute.input.parse(rawInput)
        return terminalKillRoute.output.parse({
          killed: dependencies.terminals.kill(terminalId, caller.webContentsId)
        })
      }
    ]
  ])
}
