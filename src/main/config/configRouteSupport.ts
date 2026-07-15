import type { ConfigServicePort } from '@shared/presenter'
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
  configService: ConfigServicePort,
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
    assignValue('init_complete', configService.getSetting<boolean>('init_complete'))
  }
  if (shouldRead('assistantModel')) {
    assignValue(
      'assistantModel',
      configService.getSetting<{ providerId: string; modelId: string } | null>('assistantModel')
    )
  }
  if (shouldRead('preferredModel')) {
    assignValue(
      'preferredModel',
      configService.getSetting<{ providerId: string; modelId: string }>('preferredModel')
    )
  }
  if (shouldRead('defaultModel')) {
    assignValue(
      'defaultModel',
      configService.getSetting<{ providerId: string; modelId: string }>('defaultModel')
    )
  }
  if (shouldRead('default_system_prompt')) {
    assignValue('default_system_prompt', configService.getSetting<string>('default_system_prompt'))
  }
  if (shouldRead('maxFileSize')) {
    assignValue('maxFileSize', configService.getSetting<number>('maxFileSize'))
  }
  if (shouldRead('input_deepThinking')) {
    assignValue('input_deepThinking', configService.getSetting<boolean>('input_deepThinking'))
  }
  if (shouldRead('input_chatMode')) {
    assignValue('input_chatMode', configService.getSetting<string>('input_chatMode'))
  }
  if (shouldRead('think_collapse')) {
    assignValue('think_collapse', configService.getSetting<boolean>('think_collapse'))
  }
  if (shouldRead('artifact_think_collapse')) {
    assignValue(
      'artifact_think_collapse',
      configService.getSetting<boolean>('artifact_think_collapse')
    )
  }
  if (shouldRead('providerOrder')) {
    assignValue('providerOrder', configService.getSetting<string[]>('providerOrder'))
  }
  if (shouldRead('providerTimestamps')) {
    assignValue(
      'providerTimestamps',
      configService.getSetting<Record<string, number>>('providerTimestamps')
    )
  }
  if (shouldRead('sidebar_group_mode')) {
    assignValue('sidebar_group_mode', configService.getSetting<string>('sidebar_group_mode'))
  }
  if (shouldRead('input_enabledMcpTools')) {
    assignValue(
      'input_enabledMcpTools',
      configService.getSetting<string[]>('input_enabledMcpTools')
    )
  }

  return values
}

export function applyConfigEntryChanges(
  configService: ConfigServicePort,
  changes: ConfigEntryChange[]
): Partial<ConfigEntryValues> {
  for (const change of changes) {
    configService.setSetting(change.key, change.value)
  }

  const changedKeys = changes.map((change) => change.key)
  return readConfigEntries(configService, changedKeys)
}

export function readLanguageState(configService: ConfigServicePort): {
  requestedLanguage: string
  locale: string
  direction: 'auto' | 'rtl' | 'ltr'
} {
  const requestedLanguage = configService.getSetting<string>('language') || 'system'
  const locale = configService.getLanguage()

  return {
    requestedLanguage,
    locale,
    direction: RTL_LOCALES.has(locale) ? 'rtl' : 'auto'
  }
}

export async function readThemeState(configService: ConfigServicePort): Promise<{
  theme: 'dark' | 'light' | 'system'
  isDark: boolean
}> {
  const theme = (await configService.getTheme()) as 'dark' | 'light' | 'system'
  const isDark = await configService.getCurrentThemeIsDark()

  return {
    theme,
    isDark
  }
}

export function readSyncSettings(configService: ConfigServicePort): {
  enabled: boolean
  folderPath: string
} {
  return {
    enabled: configService.getSyncEnabled(),
    folderPath: configService.getSyncFolderPath()
  }
}

export function readProxySettings(configService: ConfigServicePort): {
  mode: 'system' | 'none' | 'custom'
  customProxyUrl: string
} {
  const rawMode = configService.getProxyMode()

  return {
    mode: rawMode === 'none' || rawMode === 'custom' ? rawMode : 'system',
    customProxyUrl: configService.getCustomProxyUrl()
  }
}

export function readVoiceAiConfig(configService: ConfigServicePort): {
  audioFormat: string
  model: string
  language: string
  temperature: number
  topP: number
  agentId: string
} {
  return {
    audioFormat:
      configService.getSetting<string>('voiceAI_audioFormat') ?? VOICE_AI_DEFAULTS.audioFormat,
    model: configService.getSetting<string>('voiceAI_model') ?? VOICE_AI_DEFAULTS.model,
    language: configService.getSetting<string>('voiceAI_language') ?? VOICE_AI_DEFAULTS.language,
    temperature:
      configService.getSetting<number>('voiceAI_temperature') ?? VOICE_AI_DEFAULTS.temperature,
    topP: configService.getSetting<number>('voiceAI_topP') ?? VOICE_AI_DEFAULTS.topP,
    agentId: configService.getSetting<string>('voiceAI_agentId') ?? VOICE_AI_DEFAULTS.agentId
  }
}

export function applyVoiceAiConfigUpdates(
  configService: ConfigServicePort,
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
    configService.setSetting('voiceAI_audioFormat', updates.audioFormat)
  }
  if (updates.model !== undefined) {
    configService.setSetting('voiceAI_model', updates.model)
  }
  if (updates.language !== undefined) {
    configService.setSetting('voiceAI_language', updates.language)
  }
  if (updates.temperature !== undefined) {
    configService.setSetting('voiceAI_temperature', updates.temperature)
  }
  if (updates.topP !== undefined) {
    configService.setSetting('voiceAI_topP', updates.topP)
  }
  if (updates.agentId !== undefined) {
    configService.setSetting('voiceAI_agentId', updates.agentId)
  }

  return readVoiceAiConfig(configService)
}

export function readAzureApiVersion(configService: ConfigServicePort): string {
  return configService.getSetting<string>('azureApiVersion') || '2024-02-01'
}

export function readGeminiSafety(configService: ConfigServicePort, key: string): string {
  return (
    configService.getSetting<string>(`geminiSafety_${key}`) || 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'
  )
}

export function readAwsBedrockCredential(configService: ConfigServicePort): unknown {
  const stored = configService.getSetting<unknown>('awsBedrockCredential')

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

export async function readSystemPromptState(configService: ConfigServicePort): Promise<{
  prompts: Awaited<ReturnType<ConfigServicePort['getSystemPrompts']>>
  defaultPromptId: string
  prompt: string
}> {
  const [prompts, defaultPromptId, prompt] = await Promise.all([
    configService.getSystemPrompts(),
    configService.getDefaultSystemPromptId(),
    configService.getDefaultSystemPrompt()
  ])

  return {
    prompts,
    defaultPromptId,
    prompt
  }
}

export async function readAcpState(configService: ConfigServicePort): Promise<{
  enabled: boolean
  agents: Awaited<ReturnType<ConfigServicePort['getAcpAgents']>>
}> {
  const [enabled, agents] = await Promise.all([
    configService.getAcpEnabled(),
    configService.getAcpAgents()
  ])

  return {
    enabled,
    agents
  }
}
