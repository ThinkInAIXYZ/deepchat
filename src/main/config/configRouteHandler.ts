import {
  configGetDefaultProjectPathRoute,
  configGetEntriesRoute,
  configGetFloatingButtonRoute,
  configGetHooksNotificationsRoute,
  configGetLanguageRoute,
  configGetProxySettingsRoute,
  configGetShortcutKeysRoute,
  configGetSyncSettingsRoute,
  configGetThemeRoute,
  configGetUpdateChannelRoute,
  configOpenLoggingFolderRoute,
  configResetShortcutKeysRoute,
  configSetCustomProxyUrlRoute,
  configSetDefaultProjectPathRoute,
  configSetFloatingButtonRoute,
  configSetHooksNotificationsRoute,
  configSetLanguageRoute,
  configSetProxyModeRoute,
  configSetShortcutKeysRoute,
  configSetThemeRoute,
  configSetUpdateChannelRoute,
  configTestHookCommandRoute,
  configUpdateEntriesRoute,
  configUpdateSyncSettingsRoute
} from '@shared/contracts/routes'
import type { HookTestResult } from '@shared/hooksNotifications'
import type { SyncSettings } from '@/sync/settings'
import type { HookSettings } from '@/hook/config'
import type { UpdateSettings } from '@/upgrade/settings'
import type { DesktopSettings } from '@/desktop/settings'
import type { ProjectService } from '@/project'
import type { LoggingService } from '@/app/logging'
import type { ProxySettings, ProxySettingMode } from '@/platform/proxySettings'
import type { SettingsStore } from './settingsStore'
import {
  applyConfigEntryChanges,
  readConfigEntries,
  readLanguageState,
  readProxySettings,
  readThemeState
} from './configRouteSupport'

export const CONFIG_ROUTE_NAMES = [
  configGetEntriesRoute.name,
  configUpdateEntriesRoute.name,
  configGetLanguageRoute.name,
  configSetLanguageRoute.name,
  configGetThemeRoute.name,
  configSetThemeRoute.name,
  configGetFloatingButtonRoute.name,
  configSetFloatingButtonRoute.name,
  configGetSyncSettingsRoute.name,
  configUpdateSyncSettingsRoute.name,
  configGetProxySettingsRoute.name,
  configSetProxyModeRoute.name,
  configSetCustomProxyUrlRoute.name,
  configOpenLoggingFolderRoute.name,
  configGetUpdateChannelRoute.name,
  configSetUpdateChannelRoute.name,
  configGetHooksNotificationsRoute.name,
  configSetHooksNotificationsRoute.name,
  configTestHookCommandRoute.name,
  configGetDefaultProjectPathRoute.name,
  configSetDefaultProjectPathRoute.name,
  configGetShortcutKeysRoute.name,
  configSetShortcutKeysRoute.name,
  configResetShortcutKeysRoute.name
] as const

export async function dispatchConfigRoute(
  settings: Pick<SettingsStore, 'get' | 'set'>,
  syncSettings: SyncSettings,
  hookSettings: HookSettings,
  updateSettings: UpdateSettings,
  desktopSettings: DesktopSettings,
  proxySettings: ProxySettings,
  applyProxyMode: (mode: ProxySettingMode) => void,
  applyCustomProxyUrl: (url: string) => void,
  projectService: ProjectService,
  logging: LoggingService,
  setFloatingButtonEnabled: (enabled: boolean) => void,
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
    case configGetLanguageRoute.name: {
      configGetLanguageRoute.input.parse(rawInput)
      return configGetLanguageRoute.output.parse(readLanguageState(desktopSettings))
    }
    case configSetLanguageRoute.name: {
      const input = configSetLanguageRoute.input.parse(rawInput)
      desktopSettings.setLanguage(input.language)
      return configSetLanguageRoute.output.parse(readLanguageState(desktopSettings))
    }
    case configGetThemeRoute.name: {
      configGetThemeRoute.input.parse(rawInput)
      return configGetThemeRoute.output.parse(await readThemeState(desktopSettings))
    }
    case configSetThemeRoute.name: {
      const input = configSetThemeRoute.input.parse(rawInput)
      desktopSettings.setTheme(input.theme)
      return configSetThemeRoute.output.parse(await readThemeState(desktopSettings))
    }
    case configGetFloatingButtonRoute.name: {
      configGetFloatingButtonRoute.input.parse(rawInput)
      return configGetFloatingButtonRoute.output.parse({
        enabled: desktopSettings.getFloatingButtonEnabled()
      })
    }
    case configSetFloatingButtonRoute.name: {
      const input = configSetFloatingButtonRoute.input.parse(rawInput)
      desktopSettings.setFloatingButtonEnabled(input.enabled)
      setFloatingButtonEnabled(input.enabled)
      return configSetFloatingButtonRoute.output.parse({
        enabled: desktopSettings.getFloatingButtonEnabled()
      })
    }
    case configGetSyncSettingsRoute.name: {
      configGetSyncSettingsRoute.input.parse(rawInput)
      return configGetSyncSettingsRoute.output.parse({
        enabled: syncSettings.getEnabled(),
        folderPath: syncSettings.getFolderPath()
      })
    }
    case configUpdateSyncSettingsRoute.name: {
      const input = configUpdateSyncSettingsRoute.input.parse(rawInput)
      if (typeof input.enabled === 'boolean') syncSettings.setEnabled(input.enabled)
      if (typeof input.folderPath === 'string') syncSettings.setFolderPath(input.folderPath)
      return configUpdateSyncSettingsRoute.output.parse({
        enabled: syncSettings.getEnabled(),
        folderPath: syncSettings.getFolderPath()
      })
    }
    case configGetProxySettingsRoute.name: {
      configGetProxySettingsRoute.input.parse(rawInput)
      return configGetProxySettingsRoute.output.parse(readProxySettings(proxySettings))
    }
    case configSetProxyModeRoute.name: {
      const input = configSetProxyModeRoute.input.parse(rawInput)
      proxySettings.setMode(input.mode)
      applyProxyMode(input.mode)
      return configSetProxyModeRoute.output.parse(readProxySettings(proxySettings))
    }
    case configSetCustomProxyUrlRoute.name: {
      const input = configSetCustomProxyUrlRoute.input.parse(rawInput)
      proxySettings.setCustomUrl(input.url)
      applyCustomProxyUrl(input.url)
      return configSetCustomProxyUrlRoute.output.parse(readProxySettings(proxySettings))
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
    case configGetShortcutKeysRoute.name: {
      configGetShortcutKeysRoute.input.parse(rawInput)
      return configGetShortcutKeysRoute.output.parse({ shortcuts: desktopSettings.getShortcutKeys() })
    }
    case configSetShortcutKeysRoute.name: {
      const input = configSetShortcutKeysRoute.input.parse(rawInput)
      desktopSettings.setShortcutKeys(input.shortcuts)
      return configSetShortcutKeysRoute.output.parse({ shortcuts: desktopSettings.getShortcutKeys() })
    }
    case configResetShortcutKeysRoute.name: {
      configResetShortcutKeysRoute.input.parse(rawInput)
      desktopSettings.resetShortcutKeys()
      return configResetShortcutKeysRoute.output.parse({ shortcuts: desktopSettings.getShortcutKeys() })
    }
    default:
      return undefined
  }
}
