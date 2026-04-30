import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  configAgentsChangedEvent,
  configCustomPromptsChangedEvent,
  configDefaultProjectPathChangedEvent,
  configFloatingButtonChangedEvent,
  configLanguageChangedEvent,
  configShortcutKeysChangedEvent,
  configSyncSettingsChangedEvent,
  configSystemPromptsChangedEvent,
  configSystemThemeChangedEvent,
  configThemeChangedEvent
} from '@shared/contracts/events'
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
  configUpdateSyncSettingsRoute,
  configUpdateSystemPromptRoute,
  configUpdateVoiceAiConfigRoute,
  type ConfigEntryKey,
  type ConfigEntryValues
} from '@shared/contracts/routes'
import type {
  BuiltinKnowledgeConfig,
  Prompt,
  ShortcutKeySetting,
  SystemPrompt
} from '@shared/presenter'
import type { Agent } from '@shared/types/agent-interface'
import { getDeepchatBridge } from './core'
import { createSettingsClient } from './SettingsClient'

type VoiceAIConfig = {
  audioFormat: string
  model: string
  language: string
  temperature: number
  topP: number
  agentId: string
}

type GeminiSafetyValue =
  | 'BLOCK_NONE'
  | 'BLOCK_ONLY_HIGH'
  | 'BLOCK_MEDIUM_AND_ABOVE'
  | 'BLOCK_LOW_AND_ABOVE'
  | 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'

function toPlainKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]): BuiltinKnowledgeConfig[] {
  return configs.map((config) => {
    const plainConfig: BuiltinKnowledgeConfig = {
      id: config.id,
      description: config.description,
      embedding: {
        providerId: config.embedding.providerId,
        modelId: config.embedding.modelId
      },
      dimensions: config.dimensions,
      normalized: config.normalized,
      fragmentsNumber: config.fragmentsNumber,
      enabled: config.enabled
    }

    if (config.rerank) {
      plainConfig.rerank = {
        providerId: config.rerank.providerId,
        modelId: config.rerank.modelId
      }
    }
    if (typeof config.chunkSize === 'number') {
      plainConfig.chunkSize = config.chunkSize
    }
    if (typeof config.chunkOverlap === 'number') {
      plainConfig.chunkOverlap = config.chunkOverlap
    }
    if (config.separators) {
      plainConfig.separators = [...config.separators]
    }

    return plainConfig
  })
}

export function createConfigClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  const settingsClient = createSettingsClient(bridge)

  async function getSetting<K extends ConfigEntryKey>(
    key: K
  ): Promise<ConfigEntryValues[K] | undefined> {
    return await settingsClient.getConfigEntry(key)
  }

  async function setSetting<K extends ConfigEntryKey>(key: K, value: ConfigEntryValues[K]) {
    return await settingsClient.setConfigEntry(key, value)
  }

  async function getLanguage() {
    const result = await bridge.invoke(configGetLanguageRoute.name, {})
    return result.locale
  }

  async function getRequestedLanguage() {
    const result = await bridge.invoke(configGetLanguageRoute.name, {})
    return result.requestedLanguage
  }

  async function getLanguageState() {
    return await bridge.invoke(configGetLanguageRoute.name, {})
  }

  async function setLanguage(language: string) {
    return await bridge.invoke(configSetLanguageRoute.name, { language })
  }

  async function getTheme() {
    const result = await bridge.invoke(configGetThemeRoute.name, {})
    return result.theme
  }

  async function getCurrentThemeIsDark() {
    const result = await bridge.invoke(configGetThemeRoute.name, {})
    return result.isDark
  }

  async function getThemeState() {
    return await bridge.invoke(configGetThemeRoute.name, {})
  }

  async function setTheme(theme: 'dark' | 'light' | 'system') {
    const result = await bridge.invoke(configSetThemeRoute.name, { theme })
    return result.isDark
  }

  async function getFloatingButtonEnabled() {
    const result = await bridge.invoke(configGetFloatingButtonRoute.name, {})
    return result.enabled
  }

  async function setFloatingButtonEnabled(enabled: boolean) {
    return await bridge.invoke(configSetFloatingButtonRoute.name, { enabled })
  }

  async function getSyncEnabled() {
    const result = await bridge.invoke(configGetSyncSettingsRoute.name, {})
    return result.enabled
  }

  async function setSyncEnabled(enabled: boolean) {
    return await bridge.invoke(configUpdateSyncSettingsRoute.name, { enabled })
  }

  async function getSyncFolderPath() {
    const result = await bridge.invoke(configGetSyncSettingsRoute.name, {})
    return result.folderPath
  }

  async function setSyncFolderPath(folderPath: string) {
    return await bridge.invoke(configUpdateSyncSettingsRoute.name, { folderPath })
  }

  async function getDefaultProjectPath() {
    const result = await bridge.invoke(configGetDefaultProjectPathRoute.name, {})
    return result.path
  }

  async function setDefaultProjectPath(path: string | null) {
    return await bridge.invoke(configSetDefaultProjectPathRoute.name, { path })
  }

  async function getShortcutKey(): Promise<ShortcutKeySetting> {
    const result = await bridge.invoke(configGetShortcutKeysRoute.name, {})
    return result.shortcuts
  }

  async function setShortcutKey(shortcuts: ShortcutKeySetting) {
    return await bridge.invoke(configSetShortcutKeysRoute.name, { shortcuts })
  }

  async function resetShortcutKeys() {
    return await bridge.invoke(configResetShortcutKeysRoute.name, {})
  }

  async function getCustomPrompts(): Promise<Prompt[]> {
    const result = await bridge.invoke(configListCustomPromptsRoute.name, {})
    return result.prompts as unknown as Prompt[]
  }

  async function setCustomPrompts(prompts: Prompt[]) {
    return await bridge.invoke(configSetCustomPromptsRoute.name, {
      prompts: prompts as any
    })
  }

  async function addCustomPrompt(prompt: Prompt) {
    return await bridge.invoke(configAddCustomPromptRoute.name, {
      prompt: prompt as any
    })
  }

  async function updateCustomPrompt(promptId: string, updates: Partial<Prompt>) {
    return await bridge.invoke(configUpdateCustomPromptRoute.name, {
      promptId,
      updates: updates as any
    })
  }

  async function deleteCustomPrompt(promptId: string) {
    return await bridge.invoke(configDeleteCustomPromptRoute.name, { promptId })
  }

  async function getSystemPrompts(): Promise<SystemPrompt[]> {
    const result = await bridge.invoke(configGetSystemPromptsRoute.name, {})
    return result.prompts as unknown as SystemPrompt[]
  }

  async function getDefaultSystemPromptId() {
    const result = await bridge.invoke(configGetDefaultSystemPromptRoute.name, {})
    return result.defaultPromptId
  }

  async function getDefaultSystemPrompt() {
    const result = await bridge.invoke(configGetDefaultSystemPromptRoute.name, {})
    return result.prompt
  }

  async function setDefaultSystemPrompt(prompt: string) {
    return await bridge.invoke(configSetDefaultSystemPromptRoute.name, { prompt })
  }

  async function resetToDefaultPrompt() {
    return await bridge.invoke(configResetDefaultSystemPromptRoute.name, {})
  }

  async function clearSystemPrompt() {
    return await bridge.invoke(configClearDefaultSystemPromptRoute.name, {})
  }

  async function setSystemPrompts(prompts: SystemPrompt[]) {
    return await bridge.invoke(configSetSystemPromptsRoute.name, {
      prompts: prompts as any
    })
  }

  async function addSystemPrompt(prompt: SystemPrompt) {
    return await bridge.invoke(configAddSystemPromptRoute.name, {
      prompt: prompt as any
    })
  }

  async function updateSystemPrompt(promptId: string, updates: Partial<SystemPrompt>) {
    return await bridge.invoke(configUpdateSystemPromptRoute.name, {
      promptId,
      updates: updates as any
    })
  }

  async function deleteSystemPrompt(promptId: string) {
    return await bridge.invoke(configDeleteSystemPromptRoute.name, { promptId })
  }

  async function setDefaultSystemPromptId(promptId: string) {
    return await bridge.invoke(configSetDefaultSystemPromptIdRoute.name, { promptId })
  }

  async function getAcpEnabled() {
    const result = await bridge.invoke(configGetAcpStateRoute.name, {})
    return result.enabled
  }

  async function getAcpAgents() {
    const result = await bridge.invoke(configGetAcpStateRoute.name, {})
    return result.agents
  }

  type AcpAgents = Awaited<ReturnType<typeof getAcpAgents>>

  async function listAgents(input?: {
    agentType?: 'deepchat' | 'acp'
    ids?: string[]
  }): Promise<Agent[]> {
    const result = await bridge.invoke(configListAgentsRoute.name, input ?? {})
    return result.agents
  }

  async function resolveDeepChatAgentConfig(agentId: string) {
    const result = await bridge.invoke(configResolveDeepChatAgentConfigRoute.name, {
      agentId
    })
    return result.config
  }

  async function getAgentMcpSelections(agentId: string) {
    const result = await bridge.invoke(configGetAgentMcpSelectionsRoute.name, {
      agentId
    })
    return result.selections
  }

  async function getAcpSharedMcpSelections() {
    const result = await bridge.invoke(configGetAcpSharedMcpSelectionsRoute.name, {})
    return result.selections
  }

  async function setAcpSharedMcpSelections(selections: string[]) {
    return await bridge.invoke(configSetAcpSharedMcpSelectionsRoute.name, {
      selections
    })
  }

  async function getMcpServers() {
    const result = await bridge.invoke(configGetMcpServersRoute.name, {})
    return result.servers
  }

  async function getKnowledgeConfigs(): Promise<BuiltinKnowledgeConfig[]> {
    const result = await bridge.invoke(configGetKnowledgeConfigsRoute.name, {})
    return result.configs as unknown as BuiltinKnowledgeConfig[]
  }

  async function setKnowledgeConfigs(configs: BuiltinKnowledgeConfig[]) {
    const result = await bridge.invoke(configSetKnowledgeConfigsRoute.name, {
      configs: toPlainKnowledgeConfigs(configs)
    })
    return result.configs as unknown as BuiltinKnowledgeConfig[]
  }

  async function getAcpRegistryIconMarkup(agentId: string, iconUrl: string) {
    const result = await bridge.invoke(configGetAcpRegistryIconMarkupRoute.name, {
      agentId,
      iconUrl
    })
    return result.markup
  }

  async function getVoiceAIConfig(): Promise<VoiceAIConfig> {
    const result = await bridge.invoke(configGetVoiceAiConfigRoute.name, {})
    return result.config
  }

  async function updateVoiceAIConfig(updates: Partial<VoiceAIConfig>) {
    const result = await bridge.invoke(configUpdateVoiceAiConfigRoute.name, {
      updates
    })
    return result.config
  }

  async function getAzureApiVersion() {
    const result = await bridge.invoke(configGetAzureApiVersionRoute.name, {})
    return result.version
  }

  async function setAzureApiVersion(version: string) {
    return await bridge.invoke(configSetAzureApiVersionRoute.name, { version })
  }

  async function getGeminiSafety(key: string) {
    const result = await bridge.invoke(configGetGeminiSafetyRoute.name, { key })
    return result.value
  }

  async function setGeminiSafety(key: string, value: GeminiSafetyValue) {
    const result = await bridge.invoke(configSetGeminiSafetyRoute.name, { key, value })
    return result.value
  }

  async function getAwsBedrockCredential() {
    const result = await bridge.invoke(configGetAwsBedrockCredentialRoute.name, {})
    return result.value
  }

  async function setAwsBedrockCredential(credential: any) {
    const result = await bridge.invoke(configSetAwsBedrockCredentialRoute.name, {
      credential
    })
    return result.value
  }

  function onLanguageChanged(
    listener: (payload: {
      requestedLanguage: string
      locale: string
      direction: 'auto' | 'rtl' | 'ltr'
      version: number
    }) => void
  ) {
    return bridge.on(configLanguageChangedEvent.name, listener)
  }

  function onThemeChanged(
    listener: (payload: {
      theme: 'dark' | 'light' | 'system'
      isDark: boolean
      version: number
    }) => void
  ) {
    return bridge.on(configThemeChangedEvent.name, listener)
  }

  function onSystemThemeChanged(listener: (payload: { isDark: boolean; version: number }) => void) {
    return bridge.on(configSystemThemeChangedEvent.name, listener)
  }

  function onFloatingButtonChanged(
    listener: (payload: { enabled: boolean; version: number }) => void
  ) {
    return bridge.on(configFloatingButtonChangedEvent.name, listener)
  }

  function onSyncSettingsChanged(
    listener: (payload: { enabled: boolean; folderPath: string; version: number }) => void
  ) {
    return bridge.on(configSyncSettingsChangedEvent.name, listener)
  }

  function onDefaultProjectPathChanged(
    listener: (payload: { path: string | null; version: number }) => void
  ) {
    return bridge.on(configDefaultProjectPathChangedEvent.name, listener)
  }

  function onAgentsChanged(
    listener: (payload: {
      enabled: boolean
      agents: AcpAgents
      agentIds?: string[]
      version: number
    }) => void
  ) {
    return bridge.on(configAgentsChangedEvent.name, listener)
  }

  function onShortcutKeysChanged(
    listener: (payload: { shortcuts: ShortcutKeySetting; version: number }) => void
  ) {
    return bridge.on(configShortcutKeysChangedEvent.name, listener)
  }

  function onSystemPromptsChanged(
    listener: (payload: {
      prompts: SystemPrompt[]
      defaultPromptId: string
      prompt: string
      version: number
    }) => void
  ) {
    return bridge.on(configSystemPromptsChangedEvent.name, listener)
  }

  function onCustomPromptsChanged(
    listener: (payload: { prompts: Prompt[]; version: number }) => void
  ) {
    return bridge.on(configCustomPromptsChangedEvent.name, (payload) => {
      listener({
        ...payload,
        prompts: payload.prompts as unknown as Prompt[]
      })
    })
  }

  return {
    ...settingsClient,
    getSetting,
    setSetting,
    getLanguage,
    getRequestedLanguage,
    getLanguageState,
    setLanguage,
    getTheme,
    getCurrentThemeIsDark,
    getThemeState,
    setTheme,
    getFloatingButtonEnabled,
    setFloatingButtonEnabled,
    getSyncEnabled,
    setSyncEnabled,
    getSyncFolderPath,
    setSyncFolderPath,
    getDefaultProjectPath,
    setDefaultProjectPath,
    getShortcutKey,
    setShortcutKey,
    resetShortcutKeys,
    getCustomPrompts,
    setCustomPrompts,
    addCustomPrompt,
    updateCustomPrompt,
    deleteCustomPrompt,
    getSystemPrompts,
    getDefaultSystemPromptId,
    getDefaultSystemPrompt,
    setDefaultSystemPrompt,
    resetToDefaultPrompt,
    clearSystemPrompt,
    setSystemPrompts,
    addSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt,
    setDefaultSystemPromptId,
    getAcpEnabled,
    getAcpAgents,
    listAgents,
    resolveDeepChatAgentConfig,
    getAgentMcpSelections,
    getAcpSharedMcpSelections,
    setAcpSharedMcpSelections,
    getMcpServers,
    getKnowledgeConfigs,
    setKnowledgeConfigs,
    getAcpRegistryIconMarkup,
    getVoiceAIConfig,
    updateVoiceAIConfig,
    getAzureApiVersion,
    setAzureApiVersion,
    getGeminiSafety,
    setGeminiSafety,
    getAwsBedrockCredential,
    setAwsBedrockCredential,
    onLanguageChanged,
    onThemeChanged,
    onSystemThemeChanged,
    onFloatingButtonChanged,
    onSyncSettingsChanged,
    onDefaultProjectPathChanged,
    onAgentsChanged,
    onShortcutKeysChanged,
    onSystemPromptsChanged,
    onCustomPromptsChanged
  }
}

export type ConfigClient = ReturnType<typeof createConfigClient>
