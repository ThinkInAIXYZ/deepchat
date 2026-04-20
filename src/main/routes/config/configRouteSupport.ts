import type { IConfigPresenter } from '@shared/presenter'
import type { ConfigEntryChange, ConfigEntryKey, ConfigEntryValues } from '@shared/contracts/routes'

const RTL_LOCALES = new Set(['fa-IR', 'he-IL'])

const VOICE_AI_DEFAULTS = {
  audioFormat: 'mp3',
  model: 'voiceai-tts-v1-latest',
  language: 'en',
  temperature: 1,
  topP: 0.8,
  agentId: ''
} as const

export function readConfigEntries(
  configPresenter: IConfigPresenter,
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
    assignValue('init_complete', configPresenter.getSetting<boolean>('init_complete'))
  }
  if (shouldRead('preferredModel')) {
    assignValue(
      'preferredModel',
      configPresenter.getSetting<{ providerId: string; modelId: string }>('preferredModel')
    )
  }
  if (shouldRead('defaultModel')) {
    assignValue(
      'defaultModel',
      configPresenter.getSetting<{ providerId: string; modelId: string }>('defaultModel')
    )
  }
  if (shouldRead('default_system_prompt')) {
    assignValue(
      'default_system_prompt',
      configPresenter.getSetting<string>('default_system_prompt')
    )
  }
  if (shouldRead('input_deepThinking')) {
    assignValue('input_deepThinking', configPresenter.getSetting<boolean>('input_deepThinking'))
  }
  if (shouldRead('input_chatMode')) {
    assignValue('input_chatMode', configPresenter.getSetting<string>('input_chatMode'))
  }
  if (shouldRead('think_collapse')) {
    assignValue('think_collapse', configPresenter.getSetting<boolean>('think_collapse'))
  }
  if (shouldRead('artifact_think_collapse')) {
    assignValue(
      'artifact_think_collapse',
      configPresenter.getSetting<boolean>('artifact_think_collapse')
    )
  }
  if (shouldRead('providerOrder')) {
    assignValue('providerOrder', configPresenter.getSetting<string[]>('providerOrder'))
  }
  if (shouldRead('providerTimestamps')) {
    assignValue(
      'providerTimestamps',
      configPresenter.getSetting<Record<string, number>>('providerTimestamps')
    )
  }
  if (shouldRead('sidebar_group_mode')) {
    assignValue('sidebar_group_mode', configPresenter.getSetting<string>('sidebar_group_mode'))
  }
  if (shouldRead('input_enabledMcpTools')) {
    assignValue(
      'input_enabledMcpTools',
      configPresenter.getSetting<string[]>('input_enabledMcpTools')
    )
  }

  return values
}

export function applyConfigEntryChanges(
  configPresenter: IConfigPresenter,
  changes: ConfigEntryChange[]
): Partial<ConfigEntryValues> {
  for (const change of changes) {
    configPresenter.setSetting(change.key, change.value)
  }

  const changedKeys = changes.map((change) => change.key)
  return readConfigEntries(configPresenter, changedKeys)
}

export function readLanguageState(configPresenter: IConfigPresenter): {
  requestedLanguage: string
  locale: string
  direction: 'auto' | 'rtl' | 'ltr'
} {
  const requestedLanguage = configPresenter.getSetting<string>('language') || 'system'
  const locale = configPresenter.getLanguage()

  return {
    requestedLanguage,
    locale,
    direction: RTL_LOCALES.has(locale) ? 'rtl' : 'auto'
  }
}

export async function readThemeState(configPresenter: IConfigPresenter): Promise<{
  theme: 'dark' | 'light' | 'system'
  isDark: boolean
}> {
  const theme = (await configPresenter.getTheme()) as 'dark' | 'light' | 'system'
  const isDark = await configPresenter.getCurrentThemeIsDark()

  return {
    theme,
    isDark
  }
}

export function readSyncSettings(configPresenter: IConfigPresenter): {
  enabled: boolean
  folderPath: string
} {
  return {
    enabled: configPresenter.getSyncEnabled(),
    folderPath: configPresenter.getSyncFolderPath()
  }
}

export function readVoiceAiConfig(configPresenter: IConfigPresenter): {
  audioFormat: string
  model: string
  language: string
  temperature: number
  topP: number
  agentId: string
} {
  return {
    audioFormat:
      configPresenter.getSetting<string>('voiceAI_audioFormat') ?? VOICE_AI_DEFAULTS.audioFormat,
    model: configPresenter.getSetting<string>('voiceAI_model') ?? VOICE_AI_DEFAULTS.model,
    language: configPresenter.getSetting<string>('voiceAI_language') ?? VOICE_AI_DEFAULTS.language,
    temperature:
      configPresenter.getSetting<number>('voiceAI_temperature') ?? VOICE_AI_DEFAULTS.temperature,
    topP: configPresenter.getSetting<number>('voiceAI_topP') ?? VOICE_AI_DEFAULTS.topP,
    agentId: configPresenter.getSetting<string>('voiceAI_agentId') ?? VOICE_AI_DEFAULTS.agentId
  }
}

export function applyVoiceAiConfigUpdates(
  configPresenter: IConfigPresenter,
  updates: Partial<{
    audioFormat: string
    model: string
    language: string
    temperature: number
    topP: number
    agentId: string
  }>
): {
  audioFormat: string
  model: string
  language: string
  temperature: number
  topP: number
  agentId: string
} {
  if (updates.audioFormat !== undefined) {
    configPresenter.setSetting('voiceAI_audioFormat', updates.audioFormat)
  }
  if (updates.model !== undefined) {
    configPresenter.setSetting('voiceAI_model', updates.model)
  }
  if (updates.language !== undefined) {
    configPresenter.setSetting('voiceAI_language', updates.language)
  }
  if (updates.temperature !== undefined) {
    configPresenter.setSetting('voiceAI_temperature', updates.temperature)
  }
  if (updates.topP !== undefined) {
    configPresenter.setSetting('voiceAI_topP', updates.topP)
  }
  if (updates.agentId !== undefined) {
    configPresenter.setSetting('voiceAI_agentId', updates.agentId)
  }

  return readVoiceAiConfig(configPresenter)
}

export function readAzureApiVersion(configPresenter: IConfigPresenter): string {
  return configPresenter.getSetting<string>('azureApiVersion') || '2024-02-01'
}

export function readGeminiSafety(configPresenter: IConfigPresenter, key: string): string {
  return (
    configPresenter.getSetting<string>(`geminiSafety_${key}`) || 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
  )
}

export function readAwsBedrockCredential(configPresenter: IConfigPresenter): unknown {
  const stored = configPresenter.getSetting<unknown>('awsBedrockCredential')

  if (typeof stored !== 'string') {
    return stored
  }

  try {
    const parsed = JSON.parse(stored) as { credential?: unknown } | unknown
    if (parsed && typeof parsed === 'object' && 'credential' in parsed) {
      return (parsed as { credential?: unknown }).credential
    }
    return parsed
  } catch {
    return stored
  }
}

export async function readSystemPromptState(configPresenter: IConfigPresenter): Promise<{
  prompts: Awaited<ReturnType<IConfigPresenter['getSystemPrompts']>>
  defaultPromptId: string
  prompt: string
}> {
  const [prompts, defaultPromptId, prompt] = await Promise.all([
    configPresenter.getSystemPrompts(),
    configPresenter.getDefaultSystemPromptId(),
    configPresenter.getDefaultSystemPrompt()
  ])

  return {
    prompts,
    defaultPromptId,
    prompt
  }
}

export async function readAcpState(configPresenter: IConfigPresenter): Promise<{
  enabled: boolean
  agents: Awaited<ReturnType<IConfigPresenter['getAcpAgents']>>
}> {
  const [enabled, agents] = await Promise.all([
    configPresenter.getAcpEnabled(),
    configPresenter.getAcpAgents()
  ])

  return {
    enabled,
    agents
  }
}

export function readModelCapabilities(
  configPresenter: IConfigPresenter,
  providerId: string,
  modelId: string
): {
  supportsReasoning: boolean | null
  reasoningPortrait: ReturnType<NonNullable<IConfigPresenter['getReasoningPortrait']>>
  thinkingBudgetRange: ReturnType<NonNullable<IConfigPresenter['getThinkingBudgetRange']>> | null
  supportsSearch: boolean | null
  searchDefaults: ReturnType<NonNullable<IConfigPresenter['getSearchDefaults']>> | null
  supportsTemperatureControl: boolean | null
  temperatureCapability: boolean | null
} {
  const supportsReasoning =
    typeof configPresenter.supportsReasoningCapability === 'function'
      ? configPresenter.supportsReasoningCapability(providerId, modelId)
      : null
  const reasoningPortrait =
    typeof configPresenter.getReasoningPortrait === 'function'
      ? configPresenter.getReasoningPortrait(providerId, modelId)
      : null
  const thinkingBudgetRange =
    typeof configPresenter.getThinkingBudgetRange === 'function'
      ? configPresenter.getThinkingBudgetRange(providerId, modelId)
      : null
  const supportsSearch =
    typeof configPresenter.supportsSearchCapability === 'function'
      ? configPresenter.supportsSearchCapability(providerId, modelId)
      : null
  const searchDefaults =
    typeof configPresenter.getSearchDefaults === 'function'
      ? configPresenter.getSearchDefaults(providerId, modelId)
      : null
  const supportsTemperatureControl =
    typeof configPresenter.supportsTemperatureControl === 'function'
      ? configPresenter.supportsTemperatureControl(providerId, modelId)
      : null
  const temperatureCapability =
    typeof configPresenter.getTemperatureCapability === 'function'
      ? (configPresenter.getTemperatureCapability(providerId, modelId) ?? null)
      : null

  return {
    supportsReasoning,
    reasoningPortrait,
    thinkingBudgetRange,
    supportsSearch,
    searchDefaults,
    supportsTemperatureControl,
    temperatureCapability
  }
}
