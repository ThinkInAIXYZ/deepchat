import type { DeepchatRouteName } from '@shared/contracts/routes'
import type { LocalControlScope } from '@shared/contracts/localControl'

export type RendererRouteCaller = Readonly<{
  kind: 'renderer'
  webContentsId: number
  windowId: number | null
}>

export type HumanCliRouteCaller = Readonly<{
  kind: 'cli'
  principal: 'human'
  connectionId: string
  scopes: readonly LocalControlScope[]
}>

export type AgentCliRouteCaller = Readonly<{
  kind: 'cli'
  principal: 'agent'
  connectionId: string
  tokenId: string
  scopes: readonly LocalControlScope[]
  conversationId: string
  expiresAt: number
}>

export type CliRouteCaller = HumanCliRouteCaller | AgentCliRouteCaller

export type InternalRouteCaller = Readonly<{
  kind: 'internal'
  component: 'scheduler' | 'migration' | 'agent-cli'
}>

export type RouteCaller = RendererRouteCaller | CliRouteCaller | InternalRouteCaller

export type RouteContext = Readonly<{
  caller: RouteCaller
}>

export function createRendererRouteCaller(
  webContentsId: number,
  windowId: number | null
): RendererRouteCaller {
  return {
    kind: 'renderer',
    webContentsId,
    windowId
  }
}

export function createRendererRouteContext(
  webContentsId: number,
  windowId: number | null
): RouteContext {
  return {
    caller: createRendererRouteCaller(webContentsId, windowId)
  }
}

export function requireRendererCaller(context: RouteContext): RendererRouteCaller {
  if (context.caller.kind !== 'renderer') {
    throw new Error('Route requires a renderer caller')
  }
  return context.caller
}

export type DeepchatRouteHandler = (rawInput: unknown, context: RouteContext) => Promise<unknown>

export type DeepchatRouteMap = ReadonlyMap<DeepchatRouteName, DeepchatRouteHandler>

export function createRouteMap(
  entries: ReadonlyArray<readonly [DeepchatRouteName, DeepchatRouteHandler]>
): DeepchatRouteMap {
  const routes = new Map<DeepchatRouteName, DeepchatRouteHandler>()
  for (const [routeName, handler] of entries) {
    if (routes.has(routeName)) {
      throw new Error(`Duplicate deepchat route: ${routeName}`)
    }
    routes.set(routeName, handler)
  }
  return routes
}

export function createRouteRegistry(routeMaps: readonly DeepchatRouteMap[]): DeepchatRouteMap {
  const routes = new Map<DeepchatRouteName, DeepchatRouteHandler>()
  for (const routeMap of routeMaps) {
    for (const [routeName, handler] of routeMap) {
      if (routes.has(routeName)) {
        throw new Error(`Duplicate deepchat route: ${routeName}`)
      }
      routes.set(routeName, handler)
    }
  }
  return routes
}
