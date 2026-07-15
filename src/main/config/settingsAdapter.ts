import type { ConfigServicePort } from '@shared/presenter'
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

export const readSettingsSnapshot = (configService: ConfigServicePort): SettingsSnapshotValues => ({
  fontSizeLevel: configService.getSetting<number>('fontSizeLevel') ?? 1,
  fontFamily: configService.getFontFamily() ?? '',
  codeFontFamily: configService.getCodeFontFamily() ?? '',
  artifactsEffectEnabled: configService.getSetting<boolean>('artifactsEffectEnabled') ?? false,
  autoScrollEnabled: configService.getAutoScrollEnabled(),
  autoCompactionEnabled: configService.getAutoCompactionEnabled(),
  autoCompactionTriggerThreshold: configService.getAutoCompactionTriggerThreshold(),
  autoCompactionRetainRecentPairs: configService.getAutoCompactionRetainRecentPairs(),
  contentProtectionEnabled: configService.getContentProtectionEnabled(),
  privacyModeEnabled: configService.getPrivacyModeEnabled(),
  notificationsEnabled: configService.getNotificationsEnabled(),
  launchAtLoginEnabled: configService.getLaunchAtLoginEnabled(),
  traceDebugEnabled: configService.getSetting<boolean>('traceDebugEnabled') ?? false,
  copyWithCotEnabled: configService.getCopyWithCotEnabled(),
  loggingEnabled: configService.getLoggingEnabled()
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
  configService: ConfigServicePort,
  change: SettingsChange
): void => {
  switch (change.key) {
    case 'fontSizeLevel':
      configService.setSetting('fontSizeLevel', change.value)
      return
    case 'fontFamily':
      configService.setFontFamily(change.value)
      return
    case 'codeFontFamily':
      configService.setCodeFontFamily(change.value)
      return
    case 'artifactsEffectEnabled':
      configService.setSetting('artifactsEffectEnabled', change.value)
      return
    case 'autoScrollEnabled':
      configService.setAutoScrollEnabled(change.value)
      return
    case 'autoCompactionEnabled':
      configService.setAutoCompactionEnabled(change.value)
      return
    case 'autoCompactionTriggerThreshold':
      configService.setAutoCompactionTriggerThreshold(change.value)
      return
    case 'autoCompactionRetainRecentPairs':
      configService.setAutoCompactionRetainRecentPairs(change.value)
      return
    case 'contentProtectionEnabled':
      configService.setContentProtectionEnabled(change.value)
      return
    case 'privacyModeEnabled':
      configService.setPrivacyModeEnabled(change.value)
      return
    case 'notificationsEnabled':
      configService.setNotificationsEnabled(change.value)
      return
    case 'launchAtLoginEnabled':
      configService.setLaunchAtLoginEnabled(change.value)
      return
    case 'traceDebugEnabled':
      configService.setTraceDebugEnabled(change.value)
      return
    case 'copyWithCotEnabled':
      configService.setCopyWithCotEnabled(change.value)
      return
    case 'loggingEnabled':
      configService.setLoggingEnabled(change.value)
      return
  }
}

export function createSettingsRouteAdapter(configService: ConfigServicePort): SettingsRouteAdapter {
  return {
    readSnapshot: () => readSettingsSnapshot(configService),
    applyChange: (change) => {
      applySettingChange(configService, change)
    },
    listSystemFonts: async () => await configService.getSystemFonts()
  }
}
