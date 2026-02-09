export const HOOK_EVENT_NAMES = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
  'SessionEnd'
] as const

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number]

export const DEFAULT_IMPORTANT_HOOK_EVENTS: HookEventName[] = [
  'SessionStart',
  'SessionEnd',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop'
]

export type HookChannel = 'telegram' | 'discord' | 'confirmo' | 'command'

export interface HookCommandConfig {
  enabled: boolean
  command: string
}

export interface HookCommandsConfig {
  enabled: boolean
  events: Record<HookEventName, HookCommandConfig>
}

export interface TelegramNotificationsConfig {
  enabled: boolean
  botToken: string
  chatId: string
  threadId?: string
  events: HookEventName[]
}

export interface DiscordNotificationsConfig {
  enabled: boolean
  webhookUrl: string
  events: HookEventName[]
}

export interface ConfirmoNotificationsConfig {
  enabled: boolean
  events: HookEventName[]
}

export interface HooksNotificationsSettings {
  telegram: TelegramNotificationsConfig
  discord: DiscordNotificationsConfig
  confirmo: ConfirmoNotificationsConfig
  commands: HookCommandsConfig
}

export interface HookEventPayload {
  payloadVersion: 1
  event: HookEventName
  time: string
  isTest: boolean
  app: {
    version: string
    platform: string
  }
  session: {
    conversationId?: string
    agentId?: string | null
    workdir?: string | null
    providerId?: string
    modelId?: string
  }
  user?: {
    messageId?: string
    promptPreview?: string
  } | null
  tool?: {
    callId?: string
    name?: string
    paramsPreview?: string
    responsePreview?: string
    error?: string
  } | null
  permission?: Record<string, unknown> | null
  stop?: {
    reason?: string
    userStop?: boolean
  } | null
  usage?: Record<string, number> | null
  error?: {
    message?: string
    stack?: string
  } | null
}

export interface HookCommandResult {
  success: boolean
  durationMs: number
  exitCode?: number | null
  stdout?: string
  stderr?: string
  error?: string
}

export interface HookChannelResult {
  success: boolean
  durationMs: number
  statusCode?: number
  retryAfterMs?: number
  error?: string
}

export interface HookTestResult {
  success: boolean
  durationMs: number
  statusCode?: number
  retryAfterMs?: number
  exitCode?: number | null
  stdout?: string
  stderr?: string
  error?: string
}
