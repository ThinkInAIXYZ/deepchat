import {
  configGetEntriesRoute,
  configOpenLoggingFolderRoute,
  configUpdateEntriesRoute
} from '@shared/contracts/routes'
import type { LoggingService } from '@/app/logging'
import type { SettingsStore } from './settingsStore'
import {
  applyConfigEntryChanges,
  readConfigEntries
} from './configRouteSupport'

export const CONFIG_ROUTE_NAMES = [
  configGetEntriesRoute.name,
  configUpdateEntriesRoute.name,
  configOpenLoggingFolderRoute.name
] as const

export async function dispatchConfigRoute(
  settings: Pick<SettingsStore, 'get' | 'set'>,
  logging: LoggingService,
  routeName: string,
  rawInput: unknown
): Promise<unknown> {
  switch (routeName) {
    case configGetEntriesRoute.name: {
      const input = configGetEntriesRoute.input.parse(rawInput)
      return configGetEntriesRoute.output.parse({
        version: Date.now(),
        values: readConfigEntries(settings, input.keys)
      })
    }
    case configUpdateEntriesRoute.name: {
      const input = configUpdateEntriesRoute.input.parse(rawInput)
      return configUpdateEntriesRoute.output.parse({
        version: Date.now(),
        changedKeys: input.changes.map((change) => change.key),
        values: applyConfigEntryChanges(settings, input.changes)
      })
    }
    case configOpenLoggingFolderRoute.name: {
      configOpenLoggingFolderRoute.input.parse(rawInput)
      await logging.openFolder()
      return configOpenLoggingFolderRoute.output.parse({ opened: true })
    }
    default:
      return undefined
  }
}
