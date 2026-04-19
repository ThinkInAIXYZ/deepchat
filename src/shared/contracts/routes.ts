import type { z } from 'zod'
import type { RouteContract } from './common'
import { chatSendMessageRoute, chatStopStreamRoute } from './routes/chat.routes'
import { settingsGetSnapshotRoute, settingsUpdateRoute } from './routes/settings.routes'
import {
  sessionsCreateRoute,
  sessionsListRoute,
  sessionsRestoreRoute
} from './routes/sessions.routes'
import { systemOpenSettingsRoute } from './routes/system.routes'

export * from './routes/chat.routes'
export * from './routes/settings.routes'
export * from './routes/sessions.routes'
export * from './routes/system.routes'

export const DEEPCHAT_ROUTE_CATALOG = {
  [settingsGetSnapshotRoute.name]: settingsGetSnapshotRoute,
  [settingsUpdateRoute.name]: settingsUpdateRoute,
  [sessionsCreateRoute.name]: sessionsCreateRoute,
  [sessionsRestoreRoute.name]: sessionsRestoreRoute,
  [sessionsListRoute.name]: sessionsListRoute,
  [chatSendMessageRoute.name]: chatSendMessageRoute,
  [chatStopStreamRoute.name]: chatStopStreamRoute,
  [systemOpenSettingsRoute.name]: systemOpenSettingsRoute
} satisfies Record<string, RouteContract>

export type DeepchatRouteCatalog = typeof DEEPCHAT_ROUTE_CATALOG
export type DeepchatRouteName = keyof DeepchatRouteCatalog
export type DeepchatRouteContract<T extends DeepchatRouteName> = DeepchatRouteCatalog[T]
export type DeepchatRouteInput<T extends DeepchatRouteName> = z.input<
  DeepchatRouteContract<T>['input']
>
export type DeepchatRouteOutput<T extends DeepchatRouteName> = z.output<
  DeepchatRouteContract<T>['output']
>

export function hasDeepchatRouteContract(name: string): name is DeepchatRouteName {
  return name in DEEPCHAT_ROUTE_CATALOG
}

export function getDeepchatRouteContract<T extends DeepchatRouteName>(
  name: T
): DeepchatRouteContract<T> {
  return DEEPCHAT_ROUTE_CATALOG[name]
}
