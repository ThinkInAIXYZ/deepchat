import type { SettingsStore } from '@/config/settingsStore'
import type { PromptSettings } from '@/agent/promptSettings'
import type { AgentSettingsPort } from '@/agent/settings'
import type { ProxySettings } from '@/platform/proxySettings'
import type { DesktopSettings } from '@/desktop/settings'
import type { ConfigEntryChange, ConfigEntryKey, ConfigEntryValues } from '@shared/contracts/routes'

const RTL_LOCALES = new Set(['fa-IR', 'he-IL'])

export function readConfigEntries(
  settings: Pick<SettingsStore, 'get'>,
  keys?: ConfigEntryKey[]
): Partial<ConfigEntryValues> {
  const selectedKeys = keys && keys.length > 0 ? keys : undefined
  const values: Partial<ConfigEntryValues> = {}
  const assignValue = <K extends ConfigEntryKey>(
    key: K,
    value: ConfigEntryValues[K] | undefined
  ) => {
    if (value !== undefined) {
      values[key] = value
    }
  }

  const shouldRead = (key: ConfigEntryKey) => !selectedKeys || selectedKeys.includes(key)

  if (shouldRead('init_complete')) {
    assignValue('init_complete', settings.get<boolean>('init_complete'))
  }
  if (shouldRead('assistantModel')) {
    assignValue(
      'assistantModel',
      settings.get<{ providerId: string; modelId: string } | null>('assistantModel')
    )
  }
  if (shouldRead('preferredModel')) {
    assignValue(
      'preferredModel',
      settings.get<{ providerId: string; modelId: string }>('preferredModel')
    )
  }
  if (shouldRead('defaultModel')) {
    assignValue(
      'defaultModel',
      settings.get<{ providerId: string; modelId: string }>('defaultModel')
    )
  }
  if (shouldRead('default_system_prompt')) {
    assignValue('default_system_prompt', settings.get<string>('default_system_prompt'))
  }
  if (shouldRead('maxFileSize')) {
    assignValue('maxFileSize', settings.get<number>('maxFileSize'))
  }
  if (shouldRead('input_deepThinking')) {
    assignValue('input_deepThinking', settings.get<boolean>('input_deepThinking'))
  }
  if (shouldRead('input_chatMode')) {
    assignValue('input_chatMode', settings.get<string>('input_chatMode'))
  }
  if (shouldRead('think_collapse')) {
    assignValue('think_collapse', settings.get<boolean>('think_collapse'))
  }
  if (shouldRead('artifact_think_collapse')) {
    assignValue('artifact_think_collapse', settings.get<boolean>('artifact_think_collapse'))
  }
  if (shouldRead('providerOrder')) {
    assignValue('providerOrder', settings.get<string[]>('providerOrder'))
  }
  if (shouldRead('providerTimestamps')) {
    assignValue('providerTimestamps', settings.get<Record<string, number>>('providerTimestamps'))
  }
  if (shouldRead('sidebar_group_mode')) {
    assignValue('sidebar_group_mode', settings.get<string>('sidebar_group_mode'))
  }
  if (shouldRead('input_enabledMcpTools')) {
    assignValue('input_enabledMcpTools', settings.get<string[]>('input_enabledMcpTools'))
  }

  return values
}

export function applyConfigEntryChanges(
  settings: Pick<SettingsStore, 'get' | 'set'>,
  changes: ConfigEntryChange[]
): Partial<ConfigEntryValues> {
  for (const change of changes) {
    settings.set(change.key, change.value)
  }

  const changedKeys = changes.map((change) => change.key)
  return readConfigEntries(settings, changedKeys)
}

export function readLanguageState(desktopSettings: DesktopSettings): {
  requestedLanguage: string
  locale: string
  direction: 'auto' | 'rtl' | 'ltr'
} {
  const requestedLanguage = desktopSettings.getRequestedLanguage()
  const locale = desktopSettings.getLanguage()

  return {
    requestedLanguage,
    locale,
    direction: RTL_LOCALES.has(locale) ? 'rtl' : 'auto'
  }
}

export async function readThemeState(desktopSettings: DesktopSettings): Promise<{
  theme: 'dark' | 'light' | 'system'
  isDark: boolean
}> {
  const theme = desktopSettings.getTheme()
  const isDark = desktopSettings.getCurrentThemeIsDark()

  return {
    theme,
    isDark
  }
}

export function readProxySettings(proxySettings: ProxySettings): {
  mode: 'system' | 'none' | 'custom'
  customProxyUrl: string
} {
  return {
    mode: proxySettings.getMode(),
    customProxyUrl: proxySettings.getCustomUrl()
  }
}

export async function readSystemPromptState(promptSettings: PromptSettings): Promise<{
  prompts: Awaited<ReturnType<PromptSettings['getSystemPrompts']>>
  defaultPromptId: string
  prompt: string
}> {
  const [prompts, defaultPromptId, prompt] = await Promise.all([
    promptSettings.getSystemPrompts(),
    promptSettings.getDefaultSystemPromptId(),
    promptSettings.getDefaultSystemPrompt()
  ])

  return {
    prompts,
    defaultPromptId,
    prompt
  }
}

export async function readAcpState(agentSettings: AgentSettingsPort): Promise<{
  enabled: boolean
  agents: Awaited<ReturnType<AgentSettingsPort['getAcpAgents']>>
}> {
  const [enabled, agents] = await Promise.all([
    agentSettings.getAcpEnabled(),
    agentSettings.getAcpAgents()
  ])

  return {
    enabled,
    agents
  }
}
