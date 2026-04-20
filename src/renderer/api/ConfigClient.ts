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
  configGetLanguageRoute,
  configGetMcpServersRoute,
  configGetShortcutKeysRoute,
  configGetSyncSettingsRoute,
  configGetSystemPromptsRoute,
  configGetThemeRoute,
  configGetVoiceAiConfigRoute,
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
import type { Prompt, ShortcutKeySetting, SystemPrompt } from '@shared/presenter'
import { SettingsClient } from './SettingsClient'
import { getDeepchatBridge } from './core'

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

export class ConfigClient extends SettingsClient {
  constructor(bridge: DeepchatBridge = getDeepchatBridge()) {
    super(bridge)
  }

  async getSetting<K extends ConfigEntryKey>(key: K): Promise<ConfigEntryValues[K] | undefined> {
    return await this.getConfigEntry(key)
  }

  async setSetting<K extends ConfigEntryKey>(key: K, value: ConfigEntryValues[K]) {
    return await this.setConfigEntry(key, value)
  }

  async getLanguage() {
    const result = await this.bridge.invoke(configGetLanguageRoute.name, {})
    return result.locale
  }

  async getRequestedLanguage() {
    const result = await this.bridge.invoke(configGetLanguageRoute.name, {})
    return result.requestedLanguage
  }

  async getLanguageState() {
    return await this.bridge.invoke(configGetLanguageRoute.name, {})
  }

  async setLanguage(language: string) {
    return await this.bridge.invoke(configSetLanguageRoute.name, { language })
  }

  async getTheme() {
    const result = await this.bridge.invoke(configGetThemeRoute.name, {})
    return result.theme
  }

  async getCurrentThemeIsDark() {
    const result = await this.bridge.invoke(configGetThemeRoute.name, {})
    return result.isDark
  }

  async getThemeState() {
    return await this.bridge.invoke(configGetThemeRoute.name, {})
  }

  async setTheme(theme: 'dark' | 'light' | 'system') {
    const result = await this.bridge.invoke(configSetThemeRoute.name, { theme })
    return result.isDark
  }

  async getFloatingButtonEnabled() {
    const result = await this.bridge.invoke(configGetFloatingButtonRoute.name, {})
    return result.enabled
  }

  async setFloatingButtonEnabled(enabled: boolean) {
    return await this.bridge.invoke(configSetFloatingButtonRoute.name, { enabled })
  }

  async getSyncEnabled() {
    const result = await this.bridge.invoke(configGetSyncSettingsRoute.name, {})
    return result.enabled
  }

  async setSyncEnabled(enabled: boolean) {
    return await this.bridge.invoke(configUpdateSyncSettingsRoute.name, { enabled })
  }

  async getSyncFolderPath() {
    const result = await this.bridge.invoke(configGetSyncSettingsRoute.name, {})
    return result.folderPath
  }

  async setSyncFolderPath(folderPath: string) {
    return await this.bridge.invoke(configUpdateSyncSettingsRoute.name, { folderPath })
  }

  async getDefaultProjectPath() {
    const result = await this.bridge.invoke(configGetDefaultProjectPathRoute.name, {})
    return result.path
  }

  async setDefaultProjectPath(path: string | null) {
    return await this.bridge.invoke(configSetDefaultProjectPathRoute.name, { path })
  }

  async getShortcutKey(): Promise<ShortcutKeySetting> {
    const result = await this.bridge.invoke(configGetShortcutKeysRoute.name, {})
    return result.shortcuts
  }

  async setShortcutKey(shortcuts: ShortcutKeySetting) {
    return await this.bridge.invoke(configSetShortcutKeysRoute.name, { shortcuts })
  }

  async resetShortcutKeys() {
    return await this.bridge.invoke(configResetShortcutKeysRoute.name, {})
  }

  async getCustomPrompts(): Promise<Prompt[]> {
    const result = await this.bridge.invoke(configListCustomPromptsRoute.name, {})
    return result.prompts as unknown as Prompt[]
  }

  async setCustomPrompts(prompts: Prompt[]) {
    return await this.bridge.invoke(configSetCustomPromptsRoute.name, {
      prompts: prompts as any
    })
  }

  async addCustomPrompt(prompt: Prompt) {
    return await this.bridge.invoke(configAddCustomPromptRoute.name, {
      prompt: prompt as any
    })
  }

  async updateCustomPrompt(promptId: string, updates: Partial<Prompt>) {
    return await this.bridge.invoke(configUpdateCustomPromptRoute.name, {
      promptId,
      updates: updates as any
    })
  }

  async deleteCustomPrompt(promptId: string) {
    return await this.bridge.invoke(configDeleteCustomPromptRoute.name, { promptId })
  }

  async getSystemPrompts(): Promise<SystemPrompt[]> {
    const result = await this.bridge.invoke(configGetSystemPromptsRoute.name, {})
    return result.prompts as unknown as SystemPrompt[]
  }

  async getDefaultSystemPromptId() {
    const result = await this.bridge.invoke(configGetDefaultSystemPromptRoute.name, {})
    return result.defaultPromptId
  }

  async getDefaultSystemPrompt() {
    const result = await this.bridge.invoke(configGetDefaultSystemPromptRoute.name, {})
    return result.prompt
  }

  async setDefaultSystemPrompt(prompt: string) {
    return await this.bridge.invoke(configSetDefaultSystemPromptRoute.name, { prompt })
  }

  async resetToDefaultPrompt() {
    return await this.bridge.invoke(configResetDefaultSystemPromptRoute.name, {})
  }

  async clearSystemPrompt() {
    return await this.bridge.invoke(configClearDefaultSystemPromptRoute.name, {})
  }

  async setSystemPrompts(prompts: SystemPrompt[]) {
    return await this.bridge.invoke(configSetSystemPromptsRoute.name, {
      prompts: prompts as any
    })
  }

  async addSystemPrompt(prompt: SystemPrompt) {
    return await this.bridge.invoke(configAddSystemPromptRoute.name, {
      prompt: prompt as any
    })
  }

  async updateSystemPrompt(promptId: string, updates: Partial<SystemPrompt>) {
    return await this.bridge.invoke(configUpdateSystemPromptRoute.name, {
      promptId,
      updates: updates as any
    })
  }

  async deleteSystemPrompt(promptId: string) {
    return await this.bridge.invoke(configDeleteSystemPromptRoute.name, { promptId })
  }

  async setDefaultSystemPromptId(promptId: string) {
    return await this.bridge.invoke(configSetDefaultSystemPromptIdRoute.name, { promptId })
  }

  async getAcpEnabled() {
    const result = await this.bridge.invoke(configGetAcpStateRoute.name, {})
    return result.enabled
  }

  async getAcpAgents() {
    const result = await this.bridge.invoke(configGetAcpStateRoute.name, {})
    return result.agents
  }

  async resolveDeepChatAgentConfig(agentId: string) {
    const result = await this.bridge.invoke(configResolveDeepChatAgentConfigRoute.name, {
      agentId
    })
    return result.config
  }

  async getAgentMcpSelections(agentId: string) {
    const result = await this.bridge.invoke(configGetAgentMcpSelectionsRoute.name, {
      agentId
    })
    return result.selections
  }

  async getAcpSharedMcpSelections() {
    const result = await this.bridge.invoke(configGetAcpSharedMcpSelectionsRoute.name, {})
    return result.selections
  }

  async setAcpSharedMcpSelections(selections: string[]) {
    return await this.bridge.invoke(configSetAcpSharedMcpSelectionsRoute.name, {
      selections
    })
  }

  async getMcpServers() {
    const result = await this.bridge.invoke(configGetMcpServersRoute.name, {})
    return result.servers
  }

  async getAcpRegistryIconMarkup(agentId: string, iconUrl: string) {
    const result = await this.bridge.invoke(configGetAcpRegistryIconMarkupRoute.name, {
      agentId,
      iconUrl
    })
    return result.markup
  }

  async getVoiceAIConfig(): Promise<VoiceAIConfig> {
    const result = await this.bridge.invoke(configGetVoiceAiConfigRoute.name, {})
    return result.config
  }

  async updateVoiceAIConfig(updates: Partial<VoiceAIConfig>) {
    const result = await this.bridge.invoke(configUpdateVoiceAiConfigRoute.name, {
      updates
    })
    return result.config
  }

  async getAzureApiVersion() {
    const result = await this.bridge.invoke(configGetAzureApiVersionRoute.name, {})
    return result.version
  }

  async setAzureApiVersion(version: string) {
    return await this.bridge.invoke(configSetAzureApiVersionRoute.name, { version })
  }

  async getGeminiSafety(key: string) {
    const result = await this.bridge.invoke(configGetGeminiSafetyRoute.name, { key })
    return result.value
  }

  async setGeminiSafety(key: string, value: GeminiSafetyValue) {
    const result = await this.bridge.invoke(configSetGeminiSafetyRoute.name, { key, value })
    return result.value
  }

  async getAwsBedrockCredential() {
    const result = await this.bridge.invoke(configGetAwsBedrockCredentialRoute.name, {})
    return result.value
  }

  async setAwsBedrockCredential(credential: any) {
    const result = await this.bridge.invoke(configSetAwsBedrockCredentialRoute.name, {
      credential
    })
    return result.value
  }

  onLanguageChanged(
    listener: (payload: {
      requestedLanguage: string
      locale: string
      direction: 'auto' | 'rtl' | 'ltr'
      version: number
    }) => void
  ) {
    return this.bridge.on(configLanguageChangedEvent.name, listener)
  }

  onThemeChanged(
    listener: (payload: {
      theme: 'dark' | 'light' | 'system'
      isDark: boolean
      version: number
    }) => void
  ) {
    return this.bridge.on(configThemeChangedEvent.name, listener)
  }

  onSystemThemeChanged(listener: (payload: { isDark: boolean; version: number }) => void) {
    return this.bridge.on(configSystemThemeChangedEvent.name, listener)
  }

  onFloatingButtonChanged(listener: (payload: { enabled: boolean; version: number }) => void) {
    return this.bridge.on(configFloatingButtonChangedEvent.name, listener)
  }

  onSyncSettingsChanged(
    listener: (payload: { enabled: boolean; folderPath: string; version: number }) => void
  ) {
    return this.bridge.on(configSyncSettingsChangedEvent.name, listener)
  }

  onDefaultProjectPathChanged(
    listener: (payload: { path: string | null; version: number }) => void
  ) {
    return this.bridge.on(configDefaultProjectPathChangedEvent.name, listener)
  }

  onAgentsChanged(
    listener: (payload: {
      enabled: boolean
      agents: Awaited<ReturnType<ConfigClient['getAcpAgents']>>
      version: number
    }) => void
  ) {
    return this.bridge.on(configAgentsChangedEvent.name, listener)
  }

  onShortcutKeysChanged(
    listener: (payload: { shortcuts: ShortcutKeySetting; version: number }) => void
  ) {
    return this.bridge.on(configShortcutKeysChangedEvent.name, listener)
  }

  onSystemPromptsChanged(
    listener: (payload: {
      prompts: SystemPrompt[]
      defaultPromptId: string
      prompt: string
      version: number
    }) => void
  ) {
    return this.bridge.on(configSystemPromptsChangedEvent.name, listener)
  }

  onCustomPromptsChanged(listener: (payload: { prompts: Prompt[]; version: number }) => void) {
    return this.bridge.on(configCustomPromptsChangedEvent.name, (payload) => {
      listener({
        ...payload,
        prompts: payload.prompts as unknown as Prompt[]
      })
    })
  }
}
