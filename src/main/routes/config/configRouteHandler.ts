import type { IConfigPresenter, Prompt, ShortcutKeySetting } from '@shared/presenter'
import {
  configAddCustomPromptRoute,
  configAddSystemPromptRoute,
  configClearDefaultSystemPromptRoute,
  configDeleteCustomPromptRoute,
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
  configGetKnowledgeConfigsRoute,
  configGetLanguageRoute,
  configGetMcpServersRoute,
  configGetShortcutKeysRoute,
  configGetSyncSettingsRoute,
  configGetSystemPromptsRoute,
  configGetThemeRoute,
  configGetVoiceAiConfigRoute,
  configListAgentsRoute,
  configListCustomPromptsRoute,
  configResetDefaultSystemPromptRoute,
  configResetShortcutKeysRoute,
  configResolveDeepChatAgentConfigRoute,
  configSetAcpSharedMcpSelectionsRoute,
  configSetAwsBedrockCredentialRoute,
  configSetAzureApiVersionRoute,
  configSetCustomPromptsRoute,
  configSetDefaultProjectPathRoute,
  configSetDefaultSystemPromptIdRoute,
  configSetDefaultSystemPromptRoute,
  configSetFloatingButtonRoute,
  configSetGeminiSafetyRoute,
  configSetKnowledgeConfigsRoute,
  configSetLanguageRoute,
  configSetShortcutKeysRoute,
  configSetSystemPromptsRoute,
  configSetThemeRoute,
  configUpdateCustomPromptRoute,
  configUpdateEntriesRoute,
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
  readSyncSettings,
  readSystemPromptState,
  readThemeState,
  readVoiceAiConfig
} from './configRouteSupport'

export async function dispatchConfigRoute(
  configPresenter: IConfigPresenter,
  routeName: string,
  rawInput: unknown
): Promise<unknown> {
  switch (routeName) {
    case configGetEntriesRoute.name: {
      const input = configGetEntriesRoute.input.parse(rawInput)
      return configGetEntriesRoute.output.parse({
        version: Date.now(),
        values: readConfigEntries(configPresenter, input.keys)
      })
    }

    case configUpdateEntriesRoute.name: {
      const input = configUpdateEntriesRoute.input.parse(rawInput)
      return configUpdateEntriesRoute.output.parse({
        version: Date.now(),
        changedKeys: input.changes.map((change) => change.key),
        values: applyConfigEntryChanges(configPresenter, input.changes)
      })
    }

    case configGetLanguageRoute.name: {
      configGetLanguageRoute.input.parse(rawInput)
      return configGetLanguageRoute.output.parse(readLanguageState(configPresenter))
    }

    case configSetLanguageRoute.name: {
      const input = configSetLanguageRoute.input.parse(rawInput)
      configPresenter.setLanguage(input.language)
      return configSetLanguageRoute.output.parse(readLanguageState(configPresenter))
    }

    case configGetThemeRoute.name: {
      configGetThemeRoute.input.parse(rawInput)
      return configGetThemeRoute.output.parse(await readThemeState(configPresenter))
    }

    case configSetThemeRoute.name: {
      const input = configSetThemeRoute.input.parse(rawInput)
      await configPresenter.setTheme(input.theme)
      return configSetThemeRoute.output.parse(await readThemeState(configPresenter))
    }

    case configGetFloatingButtonRoute.name: {
      configGetFloatingButtonRoute.input.parse(rawInput)
      return configGetFloatingButtonRoute.output.parse({
        enabled: configPresenter.getFloatingButtonEnabled()
      })
    }

    case configSetFloatingButtonRoute.name: {
      const input = configSetFloatingButtonRoute.input.parse(rawInput)
      configPresenter.setFloatingButtonEnabled(input.enabled)
      return configSetFloatingButtonRoute.output.parse({
        enabled: configPresenter.getFloatingButtonEnabled()
      })
    }

    case configGetSyncSettingsRoute.name: {
      configGetSyncSettingsRoute.input.parse(rawInput)
      return configGetSyncSettingsRoute.output.parse(readSyncSettings(configPresenter))
    }

    case configUpdateSyncSettingsRoute.name: {
      const input = configUpdateSyncSettingsRoute.input.parse(rawInput)
      if (typeof input.enabled === 'boolean') {
        configPresenter.setSyncEnabled(input.enabled)
      }
      if (typeof input.folderPath === 'string') {
        configPresenter.setSyncFolderPath(input.folderPath)
      }
      return configUpdateSyncSettingsRoute.output.parse(readSyncSettings(configPresenter))
    }

    case configGetDefaultProjectPathRoute.name: {
      configGetDefaultProjectPathRoute.input.parse(rawInput)
      return configGetDefaultProjectPathRoute.output.parse({
        path: configPresenter.getDefaultProjectPath()
      })
    }

    case configSetDefaultProjectPathRoute.name: {
      const input = configSetDefaultProjectPathRoute.input.parse(rawInput)
      configPresenter.setDefaultProjectPath(input.path)
      return configSetDefaultProjectPathRoute.output.parse({
        path: configPresenter.getDefaultProjectPath()
      })
    }

    case configGetShortcutKeysRoute.name: {
      configGetShortcutKeysRoute.input.parse(rawInput)
      return configGetShortcutKeysRoute.output.parse({
        shortcuts: configPresenter.getShortcutKey()
      })
    }

    case configSetShortcutKeysRoute.name: {
      const input = configSetShortcutKeysRoute.input.parse(rawInput)
      configPresenter.setShortcutKey(input.shortcuts as ShortcutKeySetting)
      return configSetShortcutKeysRoute.output.parse({
        shortcuts: configPresenter.getShortcutKey()
      })
    }

    case configResetShortcutKeysRoute.name: {
      configResetShortcutKeysRoute.input.parse(rawInput)
      configPresenter.resetShortcutKeys()
      return configResetShortcutKeysRoute.output.parse({
        shortcuts: configPresenter.getShortcutKey()
      })
    }

    case configListCustomPromptsRoute.name: {
      configListCustomPromptsRoute.input.parse(rawInput)
      return configListCustomPromptsRoute.output.parse({
        prompts: await configPresenter.getCustomPrompts()
      })
    }

    case configSetCustomPromptsRoute.name: {
      const input = configSetCustomPromptsRoute.input.parse(rawInput)
      await configPresenter.setCustomPrompts(input.prompts as Prompt[])
      return configSetCustomPromptsRoute.output.parse({
        prompts: await configPresenter.getCustomPrompts()
      })
    }

    case configAddCustomPromptRoute.name: {
      const input = configAddCustomPromptRoute.input.parse(rawInput)
      await configPresenter.addCustomPrompt(input.prompt as Prompt)
      return configAddCustomPromptRoute.output.parse({
        prompts: await configPresenter.getCustomPrompts()
      })
    }

    case configUpdateCustomPromptRoute.name: {
      const input = configUpdateCustomPromptRoute.input.parse(rawInput)
      await configPresenter.updateCustomPrompt(input.promptId, input.updates as Partial<Prompt>)
      return configUpdateCustomPromptRoute.output.parse({
        prompts: await configPresenter.getCustomPrompts()
      })
    }

    case configDeleteCustomPromptRoute.name: {
      const input = configDeleteCustomPromptRoute.input.parse(rawInput)
      await configPresenter.deleteCustomPrompt(input.promptId)
      return configDeleteCustomPromptRoute.output.parse({
        prompts: await configPresenter.getCustomPrompts()
      })
    }

    case configGetSystemPromptsRoute.name: {
      configGetSystemPromptsRoute.input.parse(rawInput)
      const state = await readSystemPromptState(configPresenter)
      return configGetSystemPromptsRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configSetSystemPromptsRoute.name: {
      const input = configSetSystemPromptsRoute.input.parse(rawInput)
      await configPresenter.setSystemPrompts(input.prompts)
      const state = await readSystemPromptState(configPresenter)
      return configSetSystemPromptsRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configAddSystemPromptRoute.name: {
      const input = configAddSystemPromptRoute.input.parse(rawInput)
      await configPresenter.addSystemPrompt(input.prompt)
      const state = await readSystemPromptState(configPresenter)
      return configAddSystemPromptRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configUpdateSystemPromptRoute.name: {
      const input = configUpdateSystemPromptRoute.input.parse(rawInput)
      await configPresenter.updateSystemPrompt(input.promptId, input.updates)
      const state = await readSystemPromptState(configPresenter)
      return configUpdateSystemPromptRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configDeleteSystemPromptRoute.name: {
      const input = configDeleteSystemPromptRoute.input.parse(rawInput)
      await configPresenter.deleteSystemPrompt(input.promptId)
      const state = await readSystemPromptState(configPresenter)
      return configDeleteSystemPromptRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configGetDefaultSystemPromptRoute.name: {
      configGetDefaultSystemPromptRoute.input.parse(rawInput)
      const state = await readSystemPromptState(configPresenter)
      return configGetDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configSetDefaultSystemPromptRoute.name: {
      const input = configSetDefaultSystemPromptRoute.input.parse(rawInput)
      await configPresenter.setDefaultSystemPrompt(input.prompt)
      const state = await readSystemPromptState(configPresenter)
      return configSetDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configResetDefaultSystemPromptRoute.name: {
      configResetDefaultSystemPromptRoute.input.parse(rawInput)
      await configPresenter.resetToDefaultPrompt()
      const state = await readSystemPromptState(configPresenter)
      return configResetDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configClearDefaultSystemPromptRoute.name: {
      configClearDefaultSystemPromptRoute.input.parse(rawInput)
      await configPresenter.clearSystemPrompt()
      const state = await readSystemPromptState(configPresenter)
      return configClearDefaultSystemPromptRoute.output.parse({
        prompt: state.prompt,
        defaultPromptId: state.defaultPromptId
      })
    }

    case configSetDefaultSystemPromptIdRoute.name: {
      const input = configSetDefaultSystemPromptIdRoute.input.parse(rawInput)
      await configPresenter.setDefaultSystemPromptId(input.promptId)
      const state = await readSystemPromptState(configPresenter)
      return configSetDefaultSystemPromptIdRoute.output.parse({
        prompts: state.prompts,
        defaultPromptId: state.defaultPromptId,
        prompt: state.prompt
      })
    }

    case configGetAcpStateRoute.name: {
      configGetAcpStateRoute.input.parse(rawInput)
      return configGetAcpStateRoute.output.parse(await readAcpState(configPresenter))
    }

    case configListAgentsRoute.name: {
      const input = configListAgentsRoute.input.parse(rawInput)
      const idSet = input.ids ? new Set(input.ids) : null
      const agents = (await configPresenter.listAgents()).filter((agent) => {
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

    case configResolveDeepChatAgentConfigRoute.name: {
      const input = configResolveDeepChatAgentConfigRoute.input.parse(rawInput)
      return configResolveDeepChatAgentConfigRoute.output.parse({
        config: await configPresenter.resolveDeepChatAgentConfig(input.agentId)
      })
    }

    case configGetAgentMcpSelectionsRoute.name: {
      const input = configGetAgentMcpSelectionsRoute.input.parse(rawInput)
      return configGetAgentMcpSelectionsRoute.output.parse({
        selections: await configPresenter.getAgentMcpSelections(input.agentId)
      })
    }

    case configGetAcpSharedMcpSelectionsRoute.name: {
      configGetAcpSharedMcpSelectionsRoute.input.parse(rawInput)
      return configGetAcpSharedMcpSelectionsRoute.output.parse({
        selections: await configPresenter.getAcpSharedMcpSelections()
      })
    }

    case configSetAcpSharedMcpSelectionsRoute.name: {
      const input = configSetAcpSharedMcpSelectionsRoute.input.parse(rawInput)
      await configPresenter.setAcpSharedMcpSelections(input.selections)
      return configSetAcpSharedMcpSelectionsRoute.output.parse({
        selections: await configPresenter.getAcpSharedMcpSelections()
      })
    }

    case configGetMcpServersRoute.name: {
      configGetMcpServersRoute.input.parse(rawInput)
      return configGetMcpServersRoute.output.parse({
        servers: await configPresenter.getMcpServers()
      })
    }

    case configGetKnowledgeConfigsRoute.name: {
      configGetKnowledgeConfigsRoute.input.parse(rawInput)
      return configGetKnowledgeConfigsRoute.output.parse({
        configs: configPresenter.getKnowledgeConfigs()
      })
    }

    case configSetKnowledgeConfigsRoute.name: {
      const input = configSetKnowledgeConfigsRoute.input.parse(rawInput)
      configPresenter.setKnowledgeConfigs(input.configs)
      return configSetKnowledgeConfigsRoute.output.parse({
        configs: configPresenter.getKnowledgeConfigs()
      })
    }

    case configGetAcpRegistryIconMarkupRoute.name: {
      const input = configGetAcpRegistryIconMarkupRoute.input.parse(rawInput)
      return configGetAcpRegistryIconMarkupRoute.output.parse({
        markup: (await configPresenter.getAcpRegistryIconMarkup(input.agentId, input.iconUrl)) ?? ''
      })
    }

    case configGetVoiceAiConfigRoute.name: {
      configGetVoiceAiConfigRoute.input.parse(rawInput)
      return configGetVoiceAiConfigRoute.output.parse({
        config: readVoiceAiConfig(configPresenter)
      })
    }

    case configUpdateVoiceAiConfigRoute.name: {
      const input = configUpdateVoiceAiConfigRoute.input.parse(rawInput)
      return configUpdateVoiceAiConfigRoute.output.parse({
        config: applyVoiceAiConfigUpdates(configPresenter, input.updates)
      })
    }

    case configGetGeminiSafetyRoute.name: {
      const input = configGetGeminiSafetyRoute.input.parse(rawInput)
      return configGetGeminiSafetyRoute.output.parse({
        value: readGeminiSafety(configPresenter, input.key)
      })
    }

    case configSetGeminiSafetyRoute.name: {
      const input = configSetGeminiSafetyRoute.input.parse(rawInput)
      configPresenter.setSetting(`geminiSafety_${input.key}`, input.value)
      return configSetGeminiSafetyRoute.output.parse({
        value: readGeminiSafety(configPresenter, input.key)
      })
    }

    case configGetAzureApiVersionRoute.name: {
      configGetAzureApiVersionRoute.input.parse(rawInput)
      return configGetAzureApiVersionRoute.output.parse({
        version: readAzureApiVersion(configPresenter)
      })
    }

    case configSetAzureApiVersionRoute.name: {
      const input = configSetAzureApiVersionRoute.input.parse(rawInput)
      configPresenter.setSetting('azureApiVersion', input.version)
      return configSetAzureApiVersionRoute.output.parse({
        version: readAzureApiVersion(configPresenter)
      })
    }

    case configGetAwsBedrockCredentialRoute.name: {
      configGetAwsBedrockCredentialRoute.input.parse(rawInput)
      return configGetAwsBedrockCredentialRoute.output.parse({
        value: readAwsBedrockCredential(configPresenter)
      })
    }

    case configSetAwsBedrockCredentialRoute.name: {
      const input = configSetAwsBedrockCredentialRoute.input.parse(rawInput)
      configPresenter.setSetting(
        'awsBedrockCredential',
        JSON.stringify({ credential: input.credential })
      )
      return configSetAwsBedrockCredentialRoute.output.parse({
        value: readAwsBedrockCredential(configPresenter)
      })
    }

    default:
      return undefined
  }
}
