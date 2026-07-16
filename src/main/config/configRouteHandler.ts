import {
  configGetEntriesRoute,
  configGetUpdateChannelRoute,
  configOpenLoggingFolderRoute,
  configSetUpdateChannelRoute,
  configUpdateEntriesRoute
} from '@shared/contracts/routes'
import type { UpdateSettings } from '@/upgrade/settings'
import type { LoggingService } from '@/app/logging'
import type { SettingsStore } from './settingsStore'
import {
  applyConfigEntryChanges,
  readConfigEntries
} from './configRouteSupport'

export const CONFIG_ROUTE_NAMES = [
  configGetEntriesRoute.name,
  configUpdateEntriesRoute.name,
  configOpenLoggingFolderRoute.name,
  configGetUpdateChannelRoute.name,
  configSetUpdateChannelRoute.name
] as const

export async function dispatchConfigRoute(
  settings: Pick<SettingsStore, 'get' | 'set'>,
  updateSettings: UpdateSettings,
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
    case configGetUpdateChannelRoute.name: {
      configGetUpdateChannelRoute.input.parse(rawInput)
      return configGetUpdateChannelRoute.output.parse({ channel: updateSettings.getChannel() })
    }
    case configSetUpdateChannelRoute.name: {
      const input = configSetUpdateChannelRoute.input.parse(rawInput)
      updateSettings.setChannel(input.channel)
      return configSetUpdateChannelRoute.output.parse({ channel: updateSettings.getChannel() })
    }
    default:
      return undefined
  }
}
