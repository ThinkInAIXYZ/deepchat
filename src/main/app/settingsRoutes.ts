import {
  configGetUpdateChannelRoute,
  configSetUpdateChannelRoute,
  configGetLanguageRoute,
  configSetLanguageRoute,
  configGetThemeRoute,
  configSetThemeRoute,
  configGetFloatingButtonRoute,
  configSetFloatingButtonRoute,
  configGetShortcutKeysRoute,
  configSetShortcutKeysRoute,
  configResetShortcutKeysRoute,
  configGetEntriesRoute,
  configUpdateEntriesRoute,
  settingsActivityListRoute,
  settingsCheckCommandShellRoute,
  settingsGetCommandShellRoute,
  settingsGetPublicRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdatePublicRoute,
  settingsUpdateCommandShellRoute,
  settingsUpdateRoute,
  type ConfigEntryKey,
  type ConfigEntryValues,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import type { AppSettingsService } from './settingsService'
import type { SettingsStore } from '@/config/settingsStore'
import type { CommandShellService } from '@/agent/shared/process/commandShellService'
import type { DeepchatEventPublisher } from '@shared/contracts/events'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createAppSettingsRoutes(deps: {
  settings: Pick<SettingsStore, 'get' | 'set'>
  appSettings: Pick<
    AppSettingsService,
    | 'getSnapshot'
    | 'update'
    | 'listSystemFonts'
    | 'getLanguage'
    | 'setLanguage'
    | 'getTheme'
    | 'setTheme'
    | 'getFloatingButtonEnabled'
    | 'setFloatingButtonEnabled'
    | 'getShortcutKeys'
    | 'setShortcutKeys'
    | 'resetShortcutKeys'
    | 'getUpdateChannel'
    | 'setUpdateChannel'
  >
  commandShell: Pick<CommandShellService, 'getConfig' | 'setConfig' | 'checkGitBash'>
  publishEvent: DeepchatEventPublisher
  recordActivity(input: SettingsActivityInput): void
  listActivities(limit?: number): Promise<unknown[]>
}): DeepchatRouteMap {
  const readEntries = (keys?: ConfigEntryKey[]): Partial<ConfigEntryValues> => {
    const selectedKeys = keys?.length ? keys : undefined
    const values: Partial<ConfigEntryValues> = {}
    const read = <K extends ConfigEntryKey>(key: K): void => {
      if (selectedKeys && !selectedKeys.includes(key)) return
      const value = deps.settings.get<ConfigEntryValues[K]>(key)
      if (value !== undefined) values[key] = value
    }
    read('init_complete')
    read('assistantModel')
    read('preferredModel')
    read('defaultModel')
    read('default_system_prompt')
    read('maxFileSize')
    read('input_deepThinking')
    read('input_chatMode')
    read('think_collapse')
    read('providerOrder')
    read('providerTimestamps')
    read('configuredProviders')
    read('providerHealth')
    read('sidebar_group_mode')
    read('input_enabledMcpTools')
    return values
  }
  return createRouteMap([
    [
      configGetUpdateChannelRoute.name,
      async (rawInput) => {
        configGetUpdateChannelRoute.input.parse(rawInput)
        return configGetUpdateChannelRoute.output.parse({
          channel: await deps.appSettings.getUpdateChannel()
        })
      }
    ],
    [
      configSetUpdateChannelRoute.name,
      async (rawInput) => {
        const input = configSetUpdateChannelRoute.input.parse(rawInput)
        return configSetUpdateChannelRoute.output.parse({
          channel: await deps.appSettings.setUpdateChannel(input.channel)
        })
      }
    ],
    [
      configGetLanguageRoute.name,
      async (rawInput) => {
        configGetLanguageRoute.input.parse(rawInput)
        return configGetLanguageRoute.output.parse(await deps.appSettings.getLanguage())
      }
    ],
    [
      configSetLanguageRoute.name,
      async (rawInput) => {
        const input = configSetLanguageRoute.input.parse(rawInput)
        return configSetLanguageRoute.output.parse(
          await deps.appSettings.setLanguage(input.language)
        )
      }
    ],
    [
      configGetThemeRoute.name,
      async (rawInput) => {
        configGetThemeRoute.input.parse(rawInput)
        return configGetThemeRoute.output.parse(await deps.appSettings.getTheme())
      }
    ],
    [
      configSetThemeRoute.name,
      async (rawInput) => {
        const input = configSetThemeRoute.input.parse(rawInput)
        return configSetThemeRoute.output.parse(await deps.appSettings.setTheme(input.theme))
      }
    ],
    [
      configGetFloatingButtonRoute.name,
      async (rawInput) => {
        configGetFloatingButtonRoute.input.parse(rawInput)
        return configGetFloatingButtonRoute.output.parse({
          enabled: await deps.appSettings.getFloatingButtonEnabled()
        })
      }
    ],
    [
      configSetFloatingButtonRoute.name,
      async (rawInput) => {
        const input = configSetFloatingButtonRoute.input.parse(rawInput)
        return configSetFloatingButtonRoute.output.parse({
          enabled: await deps.appSettings.setFloatingButtonEnabled(input.enabled)
        })
      }
    ],
    [
      configGetShortcutKeysRoute.name,
      async (rawInput) => {
        configGetShortcutKeysRoute.input.parse(rawInput)
        return configGetShortcutKeysRoute.output.parse({
          shortcuts: await deps.appSettings.getShortcutKeys()
        })
      }
    ],
    [
      configSetShortcutKeysRoute.name,
      async (rawInput) => {
        const input = configSetShortcutKeysRoute.input.parse(rawInput)
        return configSetShortcutKeysRoute.output.parse({
          shortcuts: await deps.appSettings.setShortcutKeys(input.shortcuts)
        })
      }
    ],
    [
      configResetShortcutKeysRoute.name,
      async (rawInput) => {
        configResetShortcutKeysRoute.input.parse(rawInput)
        const shortcuts = await deps.appSettings.resetShortcutKeys()
        deps.recordActivity({
          category: 'shortcut',
          action: 'reset',
          targetType: 'shortcut',
          targetLabel: 'Shortcuts',
          routeName: 'settings-shortcut',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: { key: 'shortcuts' }
        })
        return configResetShortcutKeysRoute.output.parse({
          shortcuts
        })
      }
    ],
    [
      configGetEntriesRoute.name,
      async (rawInput) => {
        const input = configGetEntriesRoute.input.parse(rawInput)
        return configGetEntriesRoute.output.parse({
          version: Date.now(),
          values: readEntries(input.keys)
        })
      }
    ],
    [
      configUpdateEntriesRoute.name,
      async (rawInput) => {
        const input = configUpdateEntriesRoute.input.parse(rawInput)
        for (const change of input.changes) deps.settings.set(change.key, change.value)
        return configUpdateEntriesRoute.output.parse({
          version: Date.now(),
          changedKeys: input.changes.map((change) => change.key),
          values: readEntries(input.changes.map((change) => change.key))
        })
      }
    ],
    [
      settingsGetSnapshotRoute.name,
      async (rawInput) => {
        const input = settingsGetSnapshotRoute.input.parse(rawInput)
        return settingsGetSnapshotRoute.output.parse(await deps.appSettings.getSnapshot(input.keys))
      }
    ],
    [
      settingsGetPublicRoute.name,
      async (rawInput) => {
        const input = settingsGetPublicRoute.input.parse(rawInput)
        return settingsGetPublicRoute.output.parse(await deps.appSettings.getSnapshot(input.keys))
      }
    ],
    [
      settingsListSystemFontsRoute.name,
      async (rawInput) => {
        settingsListSystemFontsRoute.input.parse(rawInput)
        return settingsListSystemFontsRoute.output.parse({
          fonts: await deps.appSettings.listSystemFonts()
        })
      }
    ],
    [
      settingsGetCommandShellRoute.name,
      async (rawInput) => {
        settingsGetCommandShellRoute.input.parse(rawInput)
        return settingsGetCommandShellRoute.output.parse({
          config: deps.commandShell.getConfig()
        })
      }
    ],
    [
      settingsUpdateCommandShellRoute.name,
      async (rawInput) => {
        const input = settingsUpdateCommandShellRoute.input.parse(rawInput)
        const config = deps.commandShell.setConfig(input.config)
        const output = settingsUpdateCommandShellRoute.output.parse({ config })
        deps.recordActivity({
          category: 'agent',
          action: 'updated',
          targetType: 'setting',
          targetId: 'agentCommandShell',
          targetLabel: 'agentCommandShell',
          routeName: 'settings-common',
          summaryKey: 'settings.controlCenter.activity.settingUpdated',
          summaryParams: { key: 'agentCommandShell' }
        })
        deps.publishEvent('settings.commandShell.changed', {
          config: output.config,
          version: Date.now()
        })
        return output
      }
    ],
    [
      settingsCheckCommandShellRoute.name,
      async (rawInput) => {
        const input = settingsCheckCommandShellRoute.input.parse(rawInput)
        return settingsCheckCommandShellRoute.output.parse({
          gitBash: await deps.commandShell.checkGitBash({
            forceRefresh: input.forceRefresh
          })
        })
      }
    ],
    [
      settingsUpdateRoute.name,
      async (rawInput) => {
        const input = settingsUpdateRoute.input.parse(rawInput)
        return settingsUpdateRoute.output.parse(await deps.appSettings.update(input.changes))
      }
    ],
    [
      settingsUpdatePublicRoute.name,
      async (rawInput) => {
        const input = settingsUpdatePublicRoute.input.parse(rawInput)
        return settingsUpdatePublicRoute.output.parse(await deps.appSettings.update(input.changes))
      }
    ],
    [
      settingsActivityListRoute.name,
      async (rawInput) => {
        const input = settingsActivityListRoute.input.parse(rawInput)
        return settingsActivityListRoute.output.parse({
          activities: await deps.listActivities(input.limit)
        })
      }
    ]
  ])
}
