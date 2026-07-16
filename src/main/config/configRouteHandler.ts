import type { Prompt } from '@shared/presenter'
import {
  configAddCustomPromptRoute,
  configAddSystemPromptRoute,
  configClearDefaultSystemPromptRoute,
  configDeleteCustomPromptRoute,
  configDeleteSystemPromptRoute,
  configGetDefaultProjectPathRoute,
  configGetDefaultSystemPromptRoute,
  configGetEntriesRoute,
  configGetFloatingButtonRoute,
  configGetHooksNotificationsRoute,
  configGetKnowledgeConfigsRoute,
  configGetLanguageRoute,
  configGetProxySettingsRoute,
  configGetShortcutKeysRoute,
  configGetSyncSettingsRoute,
  configGetSystemPromptsRoute,
  configGetThemeRoute,
  configGetUpdateChannelRoute,
  configListCustomPromptsRoute,
  configOpenLoggingFolderRoute,
  configResetDefaultSystemPromptRoute,
  configResetShortcutKeysRoute,
  configSetCustomPromptsRoute,
  configSetDefaultProjectPathRoute,
  configSetDefaultSystemPromptIdRoute,
  configSetDefaultSystemPromptRoute,
  configSetFloatingButtonRoute,
  configSetHooksNotificationsRoute,
  configSetKnowledgeConfigsRoute,
  configSetLanguageRoute,
  configSetCustomProxyUrlRoute,
  configSetProxyModeRoute,
  configSetShortcutKeysRoute,
  configSetSystemPromptsRoute,
  configSetThemeRoute,
  configSetUpdateChannelRoute,
  configTestHookCommandRoute,
  configUpdateCustomPromptRoute,
  configUpdateEntriesRoute,
  configUpdateSyncSettingsRoute,
  configUpdateSystemPromptRoute
} from '@shared/contracts/routes'
import {
  applyConfigEntryChanges,
  readConfigEntries,
  readLanguageState,
  readProxySettings,
  readSystemPromptState,
  readThemeState
} from './configRouteSupport'
import type { SyncSettings } from '@/sync/settings'
import type { HookSettings } from '@/hook/config'
import type { HookTestResult } from '@shared/hooksNotifications'
import type { UpdateSettings } from '@/upgrade/settings'
import type { DesktopSettings } from '@/desktop/settings'
import type { ProjectService } from '@/project'
import type { LoggingService } from '@/app/logging'
import type { ProxySettings, ProxySettingMode } from '@/platform/proxySettings'
import type { KnowledgeSettings } from '@/knowledge/settings'
import type { PromptSettings } from '@/agent/promptSettings'
import type { SettingsStore } from '@/config/settingsStore'

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
  configResetShortcutKeysRoute.name,
  configListCustomPromptsRoute.name,
  configSetCustomPromptsRoute.name,
  configAddCustomPromptRoute.name,
  configUpdateCustomPromptRoute.name,
  configDeleteCustomPromptRoute.name,
  configGetSystemPromptsRoute.name,
  configSetSystemPromptsRoute.name,
  configAddSystemPromptRoute.name,
  configUpdateSystemPromptRoute.name,
  configDeleteSystemPromptRoute.name,
  configGetDefaultSystemPromptRoute.name,
  configSetDefaultSystemPromptRoute.name,
  configResetDefaultSystemPromptRoute.name,
  configClearDefaultSystemPromptRoute.name,
  configSetDefaultSystemPromptIdRoute.name,
  configGetKnowledgeConfigsRoute.name,
  configSetKnowledgeConfigsRoute.name
] as const

export async function dispatchConfigRoute(
  settings: Pick<SettingsStore, 'get' | 'set'>,
  syncSettings: SyncSettings,
  hookSettings: HookSettings,
  updateSettings: UpdateSettings,
  desktopSettings: DesktopSettings,
  knowledgeSettings: KnowledgeSettings,
  promptSettings: PromptSettings,
  proxySettings: ProxySettings,
  applyProxyMode: (mode: ProxySettingMode) => void,
  applyCustomProxyUrl: (url: string) => void,
  projectService: ProjectService,
  logging: LoggingService,
  setFloatingButtonEnabled: (enabled: boolean) => void,
  testHookCommand: (hookId: string) => Promise<HookTestResult>,
  handleKnowledgeConfigChanged: () => Promise<void>,
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
      if (typeof input.enabled === 'boolean') {
        syncSettings.setEnabled(input.enabled)
      }
      if (typeof input.folderPath === 'string') {
        syncSettings.setFolderPath(input.folderPath)
      }
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
      return configGetUpdateChannelRoute.output.parse({
        channel: updateSettings.getChannel()
      })
    }

    case configSetUpdateChannelRoute.name: {
      const input = configSetUpdateChannelRoute.input.parse(rawInput)
      updateSettings.setChannel(input.channel)
      return configSetUpdateChannelRoute.output.parse({
        channel: updateSettings.getChannel()
      })
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
      return configGetShortcutKeysRoute.output.parse({
        shortcuts: desktopSettings.getShortcutKeys()
      })
    }

    case configSetShortcutKeysRoute.name: {
      const input = configSetShortcutKeysRoute.input.parse(rawInput)
      desktopSettings.setShortcutKeys(input.shortcuts)
      return configSetShortcutKeysRoute.output.parse({
        shortcuts: desktopSettings.getShortcutKeys()
      })
    }

    case configResetShortcutKeysRoute.name: {
      configResetShortcutKeysRoute.input.parse(rawInput)
      desktopSettings.resetShortcutKeys()
      return configResetShortcutKeysRoute.output.parse({
        shortcuts: desktopSettings.getShortcutKeys()
      })
    }

    case configListCustomPromptsRoute.name: {
      configListCustomPromptsRoute.input.parse(rawInput)
      return configListCustomPromptsRoute.output.parse({
        prompts: await promptSettings.getCustomPrompts()
      })
    }

    case configSetCustomPromptsRoute.name: {
      const input = configSetCustomPromptsRoute.input.parse(rawInput)
      await promptSettings.setCustomPrompts(input.prompts as Prompt[])
      return configSetCustomPromptsRoute.output.parse({
        prompts: await promptSettings.getCustomPrompts()
      })
    }

    case configAddCustomPromptRoute.name: {
      const input = configAddCustomPromptRoute.input.parse(rawInput)
      await promptSettings.addCustomPrompt(input.prompt as Prompt)
      return configAddCustomPromptRoute.output.parse({
        prompts: await promptSettings.getCustomPrompts()
      })
    }

    case configUpdateCustomPromptRoute.name: {
      const input = configUpdateCustomPromptRoute.input.parse(rawInput)
      await promptSettings.updateCustomPrompt(input.promptId, input.updates as Partial<Prompt>)
      return configUpdateCustomPromptRoute.output.parse({
        prompts: await promptSettings.getCustomPrompts()
      })
    }

    case configDeleteCustomPromptRoute.name: {
      const input = configDeleteCustomPromptRoute.input.parse(rawInput)
      await promptSettings.deleteCustomPrompt(input.promptId)
      return configDeleteCustomPromptRoute.output.parse({
        prompts: await promptSettings.getCustomPrompts()
      })
    }

    case configGetSystemPromptsRoute.name: {
      configGetSystemPromptsRoute.input.parse(rawInput)
      const state = await readSystemPromptState(promptSettings)
      return configGetSystemPromptsRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configSetSystemPromptsRoute.name: {
      const input = configSetSystemPromptsRoute.input.parse(rawInput)
      await promptSettings.setSystemPrompts(input.prompts)
      const state = await readSystemPromptState(promptSettings)
      return configSetSystemPromptsRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configAddSystemPromptRoute.name: {
      const input = configAddSystemPromptRoute.input.parse(rawInput)
      await promptSettings.addSystemPrompt(input.prompt)
      const state = await readSystemPromptState(promptSettings)
      return configAddSystemPromptRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configUpdateSystemPromptRoute.name: {
      const input = configUpdateSystemPromptRoute.input.parse(rawInput)
      await promptSettings.updateSystemPrompt(input.promptId, input.updates)
      const state = await readSystemPromptState(promptSettings)
      return configUpdateSystemPromptRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configDeleteSystemPromptRoute.name: {
      const input = configDeleteSystemPromptRoute.input.parse(rawInput)
      await promptSettings.deleteSystemPrompt(input.promptId)
      const state = await readSystemPromptState(promptSettings)
      return configDeleteSystemPromptRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configGetDefaultSystemPromptRoute.name: {
      configGetDefaultSystemPromptRoute.input.parse(rawInput)
      const state = await readSystemPromptState(promptSettings)
      return configGetDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configSetDefaultSystemPromptRoute.name: {
      const input = configSetDefaultSystemPromptRoute.input.parse(rawInput)
      await promptSettings.setDefaultSystemPrompt(input.prompt)
      const state = await readSystemPromptState(promptSettings)
      return configSetDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configResetDefaultSystemPromptRoute.name: {
      configResetDefaultSystemPromptRoute.input.parse(rawInput)
      await promptSettings.resetToDefaultPrompt()
      const state = await readSystemPromptState(promptSettings)
      return configResetDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configClearDefaultSystemPromptRoute.name: {
      configClearDefaultSystemPromptRoute.input.parse(rawInput)
      await promptSettings.clearSystemPrompt()
      const state = await readSystemPromptState(promptSettings)
      return configClearDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configSetDefaultSystemPromptIdRoute.name: {
      const input = configSetDefaultSystemPromptIdRoute.input.parse(rawInput)
      await promptSettings.setDefaultSystemPromptId(input.promptId)
      const state = await readSystemPromptState(promptSettings)
      return configSetDefaultSystemPromptIdRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId,
        prompt: state.prompt
      })
    }

    case configGetKnowledgeConfigsRoute.name: {
      configGetKnowledgeConfigsRoute.input.parse(rawInput)
      return configGetKnowledgeConfigsRoute.output.parse({
        configs: knowledgeSettings.getKnowledgeConfigs()
      })
    }

    case configSetKnowledgeConfigsRoute.name: {
      const input = configSetKnowledgeConfigsRoute.input.parse(rawInput)
      knowledgeSettings.setKnowledgeConfigs(input.configs)
      await handleKnowledgeConfigChanged()
      return configSetKnowledgeConfigsRoute.output.parse({
        configs: knowledgeSettings.getKnowledgeConfigs()
      })
    }

    default:
      return undefined
  }
}
