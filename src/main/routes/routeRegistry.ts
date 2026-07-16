import type { DeepchatRouteName } from '@shared/contracts/routes'

export type RouteContext = {
  webContentsId: number
  windowId: number | null
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
