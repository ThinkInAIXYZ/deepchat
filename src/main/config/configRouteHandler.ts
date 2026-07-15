import type { ConfigServicePort, Prompt } from '@shared/presenter'
import type {
  CreateDeepChatAgentInput,
  UpdateDeepChatAgentInput
} from '@shared/types/agent-interface'
import {
  configAddCustomPromptRoute,
  configAddManualAcpAgentRoute,
  configAddSystemPromptRoute,
  configClearDefaultSystemPromptRoute,
  configCreateDeepChatAgentRoute,
  configDeleteCustomPromptRoute,
  configDeleteDeepChatAgentRoute,
  configDeleteSystemPromptRoute,
  configGetAcpRegistryIconMarkupRoute,
  configGetAcpSharedMcpSelectionsRoute,
  configGetAcpStateRoute,
  configGetAgentMcpSelectionsRoute,
  configGetAwsBedrockCredentialRoute,
  configGetAzureApiVersionRoute,
  configGetDefaultProjectPathRoute,
  configGetDefaultSystemPromptRoute,
  configGetEntriesRoute,
  configGetFloatingButtonRoute,
  configGetGeminiSafetyRoute,
  configGetHooksNotificationsRoute,
  configGetKnowledgeConfigsRoute,
  configGetLanguageRoute,
  configGetMcpServersRoute,
  configGetProxySettingsRoute,
  configGetShortcutKeysRoute,
  configGetSkillDraftSuggestionsRoute,
  configGetSyncSettingsRoute,
  configGetSystemPromptsRoute,
  configGetThemeRoute,
  configGetUpdateChannelRoute,
  configGetVoiceAiConfigRoute,
  configEnsureAcpAgentInstalledRoute,
  configListAgentsRoute,
  configListAcpRegistryAgentsRoute,
  configListCustomPromptsRoute,
  configListManualAcpAgentsRoute,
  configOpenLoggingFolderRoute,
  configRefreshProviderDbRoute,
  configRefreshAcpRegistryRoute,
  configRemoveManualAcpAgentRoute,
  configRepairAcpAgentRoute,
  configResetDefaultSystemPromptRoute,
  configResetShortcutKeysRoute,
  configResolveDeepChatAgentConfigRoute,
  configSetAcpAgentEnabledRoute,
  configSetAcpAgentEnvOverrideRoute,
  configSetAcpEnabledRoute,
  configSetAcpSharedMcpSelectionsRoute,
  configSetAwsBedrockCredentialRoute,
  configSetAzureApiVersionRoute,
  configSetCustomPromptsRoute,
  configSetDefaultProjectPathRoute,
  configSetDefaultSystemPromptIdRoute,
  configSetDefaultSystemPromptRoute,
  configSetFloatingButtonRoute,
  configSetGeminiSafetyRoute,
  configSetHooksNotificationsRoute,
  configSetKnowledgeConfigsRoute,
  configSetLanguageRoute,
  configSetCustomProxyUrlRoute,
  configSetProxyModeRoute,
  configSetShortcutKeysRoute,
  configSetSkillDraftSuggestionsRoute,
  configSetSystemPromptsRoute,
  configSetThemeRoute,
  configSetUpdateChannelRoute,
  configTestHookCommandRoute,
  configUninstallAcpRegistryAgentRoute,
  configUpdateCustomPromptRoute,
  configUpdateDeepChatAgentRoute,
  configUpdateEntriesRoute,
  configUpdateManualAcpAgentRoute,
  configUpdateSyncSettingsRoute,
  configUpdateSystemPromptRoute,
  configUpdateVoiceAiConfigRoute
} from '@shared/contracts/routes'
import {
  applyConfigEntryChanges,
  applyVoiceAiConfigUpdates,
  readAcpState,
  readAwsBedrockCredential,
  readAzureApiVersion,
  readConfigEntries,
  readGeminiSafety,
  readLanguageState,
  readProxySettings,
  readSystemPromptState,
  readThemeState,
  readVoiceAiConfig
} from './configRouteSupport'
import type { SyncSettings } from '@/sync/settings'
import type { HookSettings } from '@/hook/config'
import type { HookTestResult } from '@shared/hooksNotifications'
import type { UpdateSettings } from '@/upgrade/settings'
import type { DesktopSettings } from '@/desktop/settings'
import type { ProjectService } from '@/project'
import type { LoggingService } from '@/app/logging'
import type { SkillSettingsPort } from '@/skill/settings'
import type { ProxySettings, ProxySettingMode } from '@/platform/proxySettings'

export async function dispatchConfigRoute(
  configService: ConfigServicePort,
  skillSettings: SkillSettingsPort,
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
        values: readConfigEntries(configService, input.keys)
      })
    }

    case configUpdateEntriesRoute.name: {
      const input = configUpdateEntriesRoute.input.parse(rawInput)
      return configUpdateEntriesRoute.output.parse({
        version: Date.now(),
        changedKeys: input.changes.map((change) => change.key),
        values: applyConfigEntryChanges(configService, input.changes)
      })
    }

    case configGetLanguageRoute.name: {
      configGetLanguageRoute.input.parse(rawInput)
      return configGetLanguageRoute.output.parse(readLanguageState(configService))
    }

    case configSetLanguageRoute.name: {
      const input = configSetLanguageRoute.input.parse(rawInput)
      configService.setLanguage(input.language)
      return configSetLanguageRoute.output.parse(readLanguageState(configService))
    }

    case configGetThemeRoute.name: {
      configGetThemeRoute.input.parse(rawInput)
      return configGetThemeRoute.output.parse(await readThemeState(configService))
    }

    case configSetThemeRoute.name: {
      const input = configSetThemeRoute.input.parse(rawInput)
      await configService.setTheme(input.theme)
      return configSetThemeRoute.output.parse(await readThemeState(configService))
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

    case configGetSkillDraftSuggestionsRoute.name: {
      configGetSkillDraftSuggestionsRoute.input.parse(rawInput)
      return configGetSkillDraftSuggestionsRoute.output.parse({
        enabled: skillSettings.isDraftSuggestionsEnabled()
      })
    }

    case configSetSkillDraftSuggestionsRoute.name: {
      const input = configSetSkillDraftSuggestionsRoute.input.parse(rawInput)
      skillSettings.setDraftSuggestionsEnabled(input.enabled)
      return configSetSkillDraftSuggestionsRoute.output.parse({
        enabled: skillSettings.isDraftSuggestionsEnabled()
      })
    }

    case configRefreshProviderDbRoute.name: {
      const input = configRefreshProviderDbRoute.input.parse(rawInput)
      return configRefreshProviderDbRoute.output.parse({
        result: await configService.refreshProviderDb(input.force ?? false)
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
        prompts: await configService.getCustomPrompts()
      })
    }

    case configSetCustomPromptsRoute.name: {
      const input = configSetCustomPromptsRoute.input.parse(rawInput)
      await configService.setCustomPrompts(input.prompts as Prompt[])
      return configSetCustomPromptsRoute.output.parse({
        prompts: await configService.getCustomPrompts()
      })
    }

    case configAddCustomPromptRoute.name: {
      const input = configAddCustomPromptRoute.input.parse(rawInput)
      await configService.addCustomPrompt(input.prompt as Prompt)
      return configAddCustomPromptRoute.output.parse({
        prompts: await configService.getCustomPrompts()
      })
    }

    case configUpdateCustomPromptRoute.name: {
      const input = configUpdateCustomPromptRoute.input.parse(rawInput)
      await configService.updateCustomPrompt(input.promptId, input.updates as Partial<Prompt>)
      return configUpdateCustomPromptRoute.output.parse({
        prompts: await configService.getCustomPrompts()
      })
    }

    case configDeleteCustomPromptRoute.name: {
      const input = configDeleteCustomPromptRoute.input.parse(rawInput)
      await configService.deleteCustomPrompt(input.promptId)
      return configDeleteCustomPromptRoute.output.parse({
        prompts: await configService.getCustomPrompts()
      })
    }

    case configGetSystemPromptsRoute.name: {
      configGetSystemPromptsRoute.input.parse(rawInput)
      const state = await readSystemPromptState(configService)
      return configGetSystemPromptsRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configSetSystemPromptsRoute.name: {
      const input = configSetSystemPromptsRoute.input.parse(rawInput)
      await configService.setSystemPrompts(input.prompts)
      const state = await readSystemPromptState(configService)
      return configSetSystemPromptsRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configAddSystemPromptRoute.name: {
      const input = configAddSystemPromptRoute.input.parse(rawInput)
      await configService.addSystemPrompt(input.prompt)
      const state = await readSystemPromptState(configService)
      return configAddSystemPromptRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configUpdateSystemPromptRoute.name: {
      const input = configUpdateSystemPromptRoute.input.parse(rawInput)
      await configService.updateSystemPrompt(input.promptId, input.updates)
      const state = await readSystemPromptState(configService)
      return configUpdateSystemPromptRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configDeleteSystemPromptRoute.name: {
      const input = configDeleteSystemPromptRoute.input.parse(rawInput)
      await configService.deleteSystemPrompt(input.promptId)
      const state = await readSystemPromptState(configService)
      return configDeleteSystemPromptRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configGetDefaultSystemPromptRoute.name: {
      configGetDefaultSystemPromptRoute.input.parse(rawInput)
      const state = await readSystemPromptState(configService)
      return configGetDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configSetDefaultSystemPromptRoute.name: {
      const input = configSetDefaultSystemPromptRoute.input.parse(rawInput)
      await configService.setDefaultSystemPrompt(input.prompt)
      const state = await readSystemPromptState(configService)
      return configSetDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configResetDefaultSystemPromptRoute.name: {
      configResetDefaultSystemPromptRoute.input.parse(rawInput)
      await configService.resetToDefaultPrompt()
      const state = await readSystemPromptState(configService)
      return configResetDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configClearDefaultSystemPromptRoute.name: {
      configClearDefaultSystemPromptRoute.input.parse(rawInput)
      await configService.clearSystemPrompt()
      const state = await readSystemPromptState(configService)
      return configClearDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configSetDefaultSystemPromptIdRoute.name: {
      const input = configSetDefaultSystemPromptIdRoute.input.parse(rawInput)
      await configService.setDefaultSystemPromptId(input.promptId)
      const state = await readSystemPromptState(configService)
      return configSetDefaultSystemPromptIdRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId,
        prompt: state.prompt
      })
    }

    case configGetAcpStateRoute.name: {
      configGetAcpStateRoute.input.parse(rawInput)
      return configGetAcpStateRoute.output.parse(await readAcpState(configService))
    }

    case configSetAcpEnabledRoute.name: {
      const input = configSetAcpEnabledRoute.input.parse(rawInput)
      await configService.setAcpEnabled(input.enabled)
      return configSetAcpEnabledRoute.output.parse({
        enabled: await configService.getAcpEnabled()
      })
    }

    case configListAcpRegistryAgentsRoute.name: {
      configListAcpRegistryAgentsRoute.input.parse(rawInput)
      return configListAcpRegistryAgentsRoute.output.parse({
        agents: await configService.listAcpRegistryAgents()
      })
    }

    case configRefreshAcpRegistryRoute.name: {
      const input = configRefreshAcpRegistryRoute.input.parse(rawInput)
      return configRefreshAcpRegistryRoute.output.parse({
        agents: await configService.refreshAcpRegistry(input.force ?? true)
      })
    }

    case configSetAcpAgentEnabledRoute.name: {
      const input = configSetAcpAgentEnabledRoute.input.parse(rawInput)
      await configService.setAcpAgentEnabled(input.agentId, input.enabled)
      return configSetAcpAgentEnabledRoute.output.parse({ ok: true })
    }

    case configSetAcpAgentEnvOverrideRoute.name: {
      const input = configSetAcpAgentEnvOverrideRoute.input.parse(rawInput)
      await configService.setAcpAgentEnvOverride(input.agentId, input.env)
      return configSetAcpAgentEnvOverrideRoute.output.parse({ ok: true })
    }

    case configEnsureAcpAgentInstalledRoute.name: {
      const input = configEnsureAcpAgentInstalledRoute.input.parse(rawInput)
      return configEnsureAcpAgentInstalledRoute.output.parse({
        installState: await configService.ensureAcpAgentInstalled(input.agentId)
      })
    }

    case configRepairAcpAgentRoute.name: {
      const input = configRepairAcpAgentRoute.input.parse(rawInput)
      return configRepairAcpAgentRoute.output.parse({
        installState: await configService.repairAcpAgent(input.agentId)
      })
    }

    case configUninstallAcpRegistryAgentRoute.name: {
      const input = configUninstallAcpRegistryAgentRoute.input.parse(rawInput)
      await configService.uninstallAcpRegistryAgent(input.agentId)
      return configUninstallAcpRegistryAgentRoute.output.parse({ ok: true })
    }

    case configListManualAcpAgentsRoute.name: {
      configListManualAcpAgentsRoute.input.parse(rawInput)
      return configListManualAcpAgentsRoute.output.parse({
        agents: await configService.listManualAcpAgents()
      })
    }

    case configAddManualAcpAgentRoute.name: {
      const input = configAddManualAcpAgentRoute.input.parse(rawInput)
      return configAddManualAcpAgentRoute.output.parse({
        agent: await configService.addManualAcpAgent(input)
      })
    }

    case configUpdateManualAcpAgentRoute.name: {
      const input = configUpdateManualAcpAgentRoute.input.parse(rawInput)
      return configUpdateManualAcpAgentRoute.output.parse({
        agent: await configService.updateManualAcpAgent(input.agentId, input.updates)
      })
    }

    case configRemoveManualAcpAgentRoute.name: {
      const input = configRemoveManualAcpAgentRoute.input.parse(rawInput)
      return configRemoveManualAcpAgentRoute.output.parse({
        removed: await configService.removeManualAcpAgent(input.agentId)
      })
    }

    case configListAgentsRoute.name: {
      const input = configListAgentsRoute.input.parse(rawInput)
      const idSet = input.ids ? new Set(input.ids) : null
      const agents = (await configService.listAgents()).filter((agent) => {
        const agentType = agent.agentType ?? agent.type
        if (input.agentType && agentType !== input.agentType) {
          return false
        }

        if (idSet && !idSet.has(agent.id)) {
          return false
        }

        return true
      })

      return configListAgentsRoute.output.parse({ agents })
    }

    case configCreateDeepChatAgentRoute.name: {
      const input = configCreateDeepChatAgentRoute.input.parse(rawInput)
      return configCreateDeepChatAgentRoute.output.parse({
        agent: await configService.createDeepChatAgent(input as CreateDeepChatAgentInput)
      })
    }

    case configUpdateDeepChatAgentRoute.name: {
      const input = configUpdateDeepChatAgentRoute.input.parse(rawInput)
      return configUpdateDeepChatAgentRoute.output.parse({
        agent: await configService.updateDeepChatAgent(
          input.agentId,
          input.updates as UpdateDeepChatAgentInput
        )
      })
    }

    case configDeleteDeepChatAgentRoute.name: {
      const input = configDeleteDeepChatAgentRoute.input.parse(rawInput)
      return configDeleteDeepChatAgentRoute.output.parse(
        await configService.deleteDeepChatAgentWithCleanup(input.agentId)
      )
    }

    case configResolveDeepChatAgentConfigRoute.name: {
      const input = configResolveDeepChatAgentConfigRoute.input.parse(rawInput)
      return configResolveDeepChatAgentConfigRoute.output.parse({
        config: await configService.resolveDeepChatAgentConfig(input.agentId)
      })
    }

    case configGetAgentMcpSelectionsRoute.name: {
      const input = configGetAgentMcpSelectionsRoute.input.parse(rawInput)
      return configGetAgentMcpSelectionsRoute.output.parse({
        selections: await configService.getAgentMcpSelections(input.agentId)
      })
    }

    case configGetAcpSharedMcpSelectionsRoute.name: {
      configGetAcpSharedMcpSelectionsRoute.input.parse(rawInput)
      return configGetAcpSharedMcpSelectionsRoute.output.parse({
        selections: await configService.getAcpSharedMcpSelections()
      })
    }

    case configSetAcpSharedMcpSelectionsRoute.name: {
      const input = configSetAcpSharedMcpSelectionsRoute.input.parse(rawInput)
      await configService.setAcpSharedMcpSelections(input.selections)
      return configSetAcpSharedMcpSelectionsRoute.output.parse({
        selections: await configService.getAcpSharedMcpSelections()
      })
    }

    case configGetMcpServersRoute.name: {
      configGetMcpServersRoute.input.parse(rawInput)
      return configGetMcpServersRoute.output.parse({
        servers: await configService.getMcpServers()
      })
    }

    case configGetKnowledgeConfigsRoute.name: {
      configGetKnowledgeConfigsRoute.input.parse(rawInput)
      return configGetKnowledgeConfigsRoute.output.parse({
        configs: configService.getKnowledgeConfigs()
      })
    }

    case configSetKnowledgeConfigsRoute.name: {
      const input = configSetKnowledgeConfigsRoute.input.parse(rawInput)
      configService.setKnowledgeConfigs(input.configs)
      return configSetKnowledgeConfigsRoute.output.parse({
        configs: configService.getKnowledgeConfigs()
      })
    }

    case configGetAcpRegistryIconMarkupRoute.name: {
      const input = configGetAcpRegistryIconMarkupRoute.input.parse(rawInput)
      return configGetAcpRegistryIconMarkupRoute.output.parse({
        markup: (await configService.getAcpRegistryIconMarkup(input.agentId, input.iconUrl)) ?? ''
      })
    }

    case configGetVoiceAiConfigRoute.name: {
      configGetVoiceAiConfigRoute.input.parse(rawInput)
      return configGetVoiceAiConfigRoute.output.parse({
        config: readVoiceAiConfig(configService)
      })
    }

    case configUpdateVoiceAiConfigRoute.name: {
      const input = configUpdateVoiceAiConfigRoute.input.parse(rawInput)
      return configUpdateVoiceAiConfigRoute.output.parse({
        config: applyVoiceAiConfigUpdates(configService, input.updates)
      })
    }

    case configGetGeminiSafetyRoute.name: {
      const input = configGetGeminiSafetyRoute.input.parse(rawInput)
      return configGetGeminiSafetyRoute.output.parse({
        value: readGeminiSafety(configService, input.key)
      })
    }

    case configSetGeminiSafetyRoute.name: {
      const input = configSetGeminiSafetyRoute.input.parse(rawInput)
      configService.setSetting(`geminiSafety_${input.key}`, input.value)
      return configSetGeminiSafetyRoute.output.parse({
        value: readGeminiSafety(configService, input.key)
      })
    }

    case configGetAzureApiVersionRoute.name: {
      configGetAzureApiVersionRoute.input.parse(rawInput)
      return configGetAzureApiVersionRoute.output.parse({
        version: readAzureApiVersion(configService)
      })
    }

    case configSetAzureApiVersionRoute.name: {
      const input = configSetAzureApiVersionRoute.input.parse(rawInput)
      configService.setSetting('azureApiVersion', input.version)
      return configSetAzureApiVersionRoute.output.parse({
        version: readAzureApiVersion(configService)
      })
    }

    case configGetAwsBedrockCredentialRoute.name: {
      configGetAwsBedrockCredentialRoute.input.parse(rawInput)
      return configGetAwsBedrockCredentialRoute.output.parse({
        value: readAwsBedrockCredential(configService)
      })
    }

    case configSetAwsBedrockCredentialRoute.name: {
      const input = configSetAwsBedrockCredentialRoute.input.parse(rawInput)
      configService.setSetting(
        'awsBedrockCredential',
        JSON.stringify({ credential: input.credential })
      )
      return configSetAwsBedrockCredentialRoute.output.parse({
        value: readAwsBedrockCredential(configService)
      })
    }

    default:
      return undefined
  }
}
