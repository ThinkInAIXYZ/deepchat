import { z } from 'zod'
import { REQUESTED_LOCALES, type RequestedLocale } from '../locales'

export const ChatSettingMutationSchema = z.discriminatedUnion('id', [
  z.strictObject({ id: z.literal('copyWithCotEnabled'), value: z.boolean() }),
  z.strictObject({ id: z.literal('fontSizeLevel'), value: z.number().int().min(0).max(4) }),
  z.strictObject({ id: z.literal('language'), value: z.enum(REQUESTED_LOCALES) }),
  z.strictObject({ id: z.literal('theme'), value: z.enum(['dark', 'light', 'system']) })
])

export type ChatSettingMutation = z.infer<typeof ChatSettingMutationSchema>

export type ChatLanguage = RequestedLocale

export type ChatTheme = 'dark' | 'light' | 'system'

export type ChatSettingId = 'copyWithCotEnabled' | 'language' | 'theme' | 'fontSizeLevel'

export type ChatSettingValue = boolean | number | ChatLanguage | ChatTheme

export type ToggleChatSettingRequest = {
  setting: 'copyWithCotEnabled'
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
  | 'acp'
  | 'memory'
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
