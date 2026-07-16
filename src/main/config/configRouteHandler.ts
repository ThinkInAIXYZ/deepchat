import {
  configGetDefaultProjectPathRoute,
  configGetEntriesRoute,
  configGetHooksNotificationsRoute,
  configGetUpdateChannelRoute,
  configOpenLoggingFolderRoute,
  configSetDefaultProjectPathRoute,
  configSetHooksNotificationsRoute,
  configSetUpdateChannelRoute,
  configTestHookCommandRoute,
  configUpdateEntriesRoute
} from '@shared/contracts/routes'
import type { HookTestResult } from '@shared/hooksNotifications'
import type { HookSettings } from '@/hook/config'
import type { UpdateSettings } from '@/upgrade/settings'
import type { ProjectService } from '@/project'
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
  configSetUpdateChannelRoute.name,
  configGetHooksNotificationsRoute.name,
  configSetHooksNotificationsRoute.name,
  configTestHookCommandRoute.name,
  configGetDefaultProjectPathRoute.name,
  configSetDefaultProjectPathRoute.name
] as const

export async function dispatchConfigRoute(
  settings: Pick<SettingsStore, 'get' | 'set'>,
  hookSettings: HookSettings,
  updateSettings: UpdateSettings,
  projectService: ProjectService,
  logging: LoggingService,
  testHookCommand: (hookId: string) => Promise<HookTestResult>,
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
    case configGetHooksNotificationsRoute.name: {
      configGetHooksNotificationsRoute.input.parse(rawInput)
      return configGetHooksNotificationsRoute.output.parse({
        config: hookSettings.getHooksNotificationsConfig()
      })
    }
    case configSetHooksNotificationsRoute.name: {
      const input = configSetHooksNotificationsRoute.input.parse(rawInput)
      return configSetHooksNotificationsRoute.output.parse({
        config: hookSettings.setHooksNotificationsConfig(input.config)
      })
    }
    case configTestHookCommandRoute.name: {
      const input = configTestHookCommandRoute.input.parse(rawInput)
      return configTestHookCommandRoute.output.parse({
        result: await testHookCommand(input.hookId)
      })
    }
    case configGetDefaultProjectPathRoute.name: {
      configGetDefaultProjectPathRoute.input.parse(rawInput)
      return configGetDefaultProjectPathRoute.output.parse({
        path: projectService.getDefaultProjectPath()
      })
    }
    case configSetDefaultProjectPathRoute.name: {
      const input = configSetDefaultProjectPathRoute.input.parse(rawInput)
      projectService.setDefaultProjectPath(input.path)
      return configSetDefaultProjectPathRoute.output.parse({
        path: projectService.getDefaultProjectPath()
      })
    }
    default:
      return undefined
  }
}
