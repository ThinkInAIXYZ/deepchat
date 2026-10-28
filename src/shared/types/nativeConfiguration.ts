import type { SupportedLocale } from '@shared/locales'
import type { ShortcutKeySetting } from './desktop'
import type { FloatingButtonBounds } from './floating-widget'

export type NativeConfigurationSnapshot = {
  ownerId: string
  version: number
  language: SupportedLocale
  notificationsEnabled: boolean
  closeToQuit: boolean
  contentProtectionEnabled: boolean
  shortcutKeys: ShortcutKeySetting
  floatingButtonEnabled: boolean
  floatingButtonBounds: FloatingButtonBounds | null
  loggingEnabled: boolean
  privacyModeEnabled: boolean
  updateChannel: 'stable' | 'beta'
}
