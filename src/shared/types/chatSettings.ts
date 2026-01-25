export type ChatLanguage =
  | 'system'
  | 'zh-CN'
  | 'en-US'
  | 'zh-TW'
  | 'zh-HK'
  | 'ko-KR'
  | 'ru-RU'
  | 'ja-JP'
  | 'fr-FR'
  | 'fa-IR'
  | 'pt-BR'
  | 'da-DK'
  | 'he-IL'

export type ChatTheme = 'dark' | 'light' | 'system'

export type ChatSettingId =
  | 'soundEnabled'
  | 'copyWithCotEnabled'
  | 'language'
  | 'theme'
  | 'fontSizeLevel'

export type ChatSettingValue = boolean | number | ChatLanguage | ChatTheme

export type ToggleChatSettingRequest = {
  setting: 'soundEnabled' | 'copyWithCotEnabled'
  enabled: boolean
}

export type SetLanguageRequest = {
  language: ChatLanguage
}

export type SetThemeRequest = {
  theme: ChatTheme
}

export type SetFontSizeRequest = {
  level: number
}

export type ApplyChatSettingRequest =
  | ToggleChatSettingRequest
  | SetLanguageRequest
  | SetThemeRequest
  | SetFontSizeRequest

export type ApplyChatSettingSuccess = {
  ok: true
  id: ChatSettingId
  value: ChatSettingValue
  previousValue?: ChatSettingValue
  appliedAt: number
}

export type ApplyChatSettingErrorCode =
  | 'invalid_request'
  | 'skill_inactive'
  | 'unknown_setting'
  | 'apply_failed'

export type ApplyChatSettingFailure = {
  ok: false
  errorCode: ApplyChatSettingErrorCode
  message: string
  details?: unknown
}

export type ApplyChatSettingResult = ApplyChatSettingSuccess | ApplyChatSettingFailure

export type OpenChatSettingsSection =
  | 'common'
  | 'display'
  | 'provider'
  | 'mcp'
  | 'prompt'
  | 'skills'
  | 'knowledge-base'
  | 'database'
  | 'shortcut'
  | 'about'

export type OpenChatSettingsRequest = {
  section?: OpenChatSettingsSection
}

export type OpenChatSettingsErrorCode = 'invalid_request' | 'skill_inactive' | 'open_failed'

export type OpenChatSettingsFailure = {
  ok: false
  errorCode: OpenChatSettingsErrorCode
  message: string
  details?: unknown
}

export type OpenChatSettingsSuccess = {
  ok: true
  section?: OpenChatSettingsSection
  routeName?: string
  appliedAt: number
}

export type OpenChatSettingsResult = OpenChatSettingsSuccess | OpenChatSettingsFailure
