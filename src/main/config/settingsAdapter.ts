import type { DesktopSettings } from '@/desktop/settings'
import type { LoggingService } from '@/app/logging'
import type { FontSettings } from '@/desktop/fontSettings'
import type { DeepChatDefaults } from '@/agent/deepchat/defaults'
import type { PrivacySettingsPort } from '@/app/privacy'
import type { AgentTraceSettingsPort } from '@/agent/traceSettings'
import {
  SETTINGS_KEYS,
  type SettingsChange,
  type SettingsKey,
  type SettingsSnapshotValues
} from '@shared/contracts/routes'

const ALL_SETTINGS_KEYS: readonly SettingsKey[] = SETTINGS_KEYS

export interface SettingsRouteAdapter {
  readSnapshot(): SettingsSnapshotValues
  applyChange(change: SettingsChange): void
  listSystemFonts(): Promise<string[]>
}

export const readSettingsSnapshot = (
  agentDefaults: DeepChatDefaults,
  privacy: PrivacySettingsPort,
  traceSettings: AgentTraceSettingsPort,
  desktopSettings: DesktopSettings,
  fonts: FontSettings,
  logging: LoggingService
): SettingsSnapshotValues => ({
  fontSizeLevel: desktopSettings.getFontSizeLevel(),
  fontFamily: fonts.getFontFamily(),
  codeFontFamily: fonts.getCodeFontFamily(),
  artifactsEffectEnabled: desktopSettings.getArtifactsEffectEnabled(),
  autoScrollEnabled: desktopSettings.getAutoScrollEnabled(),
  autoCompactionEnabled: agentDefaults.getAutoCompactionEnabled(),
  autoCompactionTriggerThreshold: agentDefaults.getAutoCompactionTriggerThreshold(),
  autoCompactionRetainRecentPairs: agentDefaults.getAutoCompactionRetainRecentPairs(),
  contentProtectionEnabled: desktopSettings.getContentProtectionEnabled(),
  privacyModeEnabled: privacy.isEnabled(),
  notificationsEnabled: desktopSettings.getNotificationsEnabled(),
  launchAtLoginEnabled: desktopSettings.getLaunchAtLoginEnabled(),
  traceDebugEnabled: traceSettings.isEnabled(),
  copyWithCotEnabled: desktopSettings.getCopyWithCotEnabled(),
  loggingEnabled: logging.getEnabled()
})

export const pickSettingsSnapshot = (
  snapshot: SettingsSnapshotValues,
  keys?: SettingsKey[]
): Partial<SettingsSnapshotValues> => {
  const selectedKeys = keys && keys.length > 0 ? keys : ALL_SETTINGS_KEYS
  const result: Partial<SettingsSnapshotValues> = {}

  for (const key of selectedKeys) {
    ;(result as Record<SettingsKey, SettingsSnapshotValues[SettingsKey] | undefined>)[key] =
      snapshot[key]
  }

  return result
}

export const applySettingChange = (
  agentDefaults: DeepChatDefaults,
  privacy: PrivacySettingsPort,
  traceSettings: AgentTraceSettingsPort,
  desktopSettings: DesktopSettings,
  fonts: FontSettings,
  logging: LoggingService,
  applyContentProtection: (enabled: boolean) => void,
  change: SettingsChange
): void => {
  switch (change.key) {
    case 'fontSizeLevel':
      desktopSettings.setFontSizeLevel(change.value)
      return
    case 'fontFamily':
      fonts.setFontFamily(change.value)
      return
    case 'codeFontFamily':
      fonts.setCodeFontFamily(change.value)
      return
    case 'artifactsEffectEnabled':
      desktopSettings.setArtifactsEffectEnabled(change.value)
      return
    case 'autoScrollEnabled':
      desktopSettings.setAutoScrollEnabled(change.value)
      return
    case 'autoCompactionEnabled':
      agentDefaults.setAutoCompactionEnabled(change.value)
      return
    case 'autoCompactionTriggerThreshold':
      agentDefaults.setAutoCompactionTriggerThreshold(change.value)
      return
    case 'autoCompactionRetainRecentPairs':
      agentDefaults.setAutoCompactionRetainRecentPairs(change.value)
      return
    case 'contentProtectionEnabled':
      desktopSettings.setContentProtectionEnabled(change.value)
      applyContentProtection(change.value)
      return
    case 'privacyModeEnabled':
      privacy.setEnabled(change.value)
      return
    case 'notificationsEnabled':
      desktopSettings.setNotificationsEnabled(change.value)
      return
    case 'launchAtLoginEnabled':
      desktopSettings.setLaunchAtLoginEnabled(change.value)
      return
    case 'traceDebugEnabled':
      traceSettings.setEnabled(change.value)
      return
    case 'copyWithCotEnabled':
      desktopSettings.setCopyWithCotEnabled(change.value)
      return
    case 'loggingEnabled':
      logging.setEnabled(change.value)
      return
  }
}

export function createSettingsRouteAdapter(
  agentDefaults: DeepChatDefaults,
  privacy: PrivacySettingsPort,
  traceSettings: AgentTraceSettingsPort,
  desktopSettings: DesktopSettings,
  fonts: FontSettings,
  logging: LoggingService,
  applyContentProtection: (enabled: boolean) => void
): SettingsRouteAdapter {
  return {
    readSnapshot: () =>
      readSettingsSnapshot(agentDefaults, privacy, traceSettings, desktopSettings, fonts, logging),
    applyChange: (change) => {
      applySettingChange(
        agentDefaults,
        privacy,
        traceSettings,
        desktopSettings,
        fonts,
        logging,
        applyContentProtection,
        change
      )
    },
    listSystemFonts: async () => await fonts.getSystemFonts()
  }
}
