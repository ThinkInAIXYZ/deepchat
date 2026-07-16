import {
  configGetEntriesRoute,
  configUpdateEntriesRoute
} from '@shared/contracts/routes'
import type { SettingsStore } from './settingsStore'
import {
  applyConfigEntryChanges,
  readConfigEntries
} from './configRouteSupport'

export const CONFIG_ROUTE_NAMES = [
  configGetEntriesRoute.name,
  configUpdateEntriesRoute.name
] as const

export async function dispatchConfigRoute(
  settings: Pick<SettingsStore, 'get' | 'set'>,
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
    default:
      return undefined
  }
}
