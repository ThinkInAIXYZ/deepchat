import type { IConfigPresenter } from '@shared/presenter'
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
  configPresenter: IConfigPresenter
): SettingsSnapshotValues => ({
  fontSizeLevel: configPresenter.getSetting<number>('fontSizeLevel') ?? 1,
  fontFamily: configPresenter.getFontFamily() ?? '',
  codeFontFamily: configPresenter.getCodeFontFamily() ?? '',
  artifactsEffectEnabled: configPresenter.getSetting<boolean>('artifactsEffectEnabled') ?? false,
  autoScrollEnabled: configPresenter.getAutoScrollEnabled(),
  autoCompactionEnabled: configPresenter.getAutoCompactionEnabled(),
  autoCompactionTriggerThreshold: configPresenter.getAutoCompactionTriggerThreshold(),
  autoCompactionRetainRecentPairs: configPresenter.getAutoCompactionRetainRecentPairs(),
  contentProtectionEnabled: configPresenter.getContentProtectionEnabled(),
  privacyModeEnabled: configPresenter.getPrivacyModeEnabled(),
  notificationsEnabled: configPresenter.getNotificationsEnabled(),
  traceDebugEnabled: configPresenter.getSetting<boolean>('traceDebugEnabled') ?? false,
  copyWithCotEnabled: configPresenter.getCopyWithCotEnabled(),
  loggingEnabled: configPresenter.getLoggingEnabled()
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
  configPresenter: IConfigPresenter,
  change: SettingsChange
): void => {
  switch (change.key) {
    case 'fontSizeLevel':
      configPresenter.setSetting('fontSizeLevel', change.value)
      return
    case 'fontFamily':
      configPresenter.setFontFamily(change.value)
      return
    case 'codeFontFamily':
      configPresenter.setCodeFontFamily(change.value)
      return
    case 'artifactsEffectEnabled':
      configPresenter.setSetting('artifactsEffectEnabled', change.value)
      return
    case 'autoScrollEnabled':
      configPresenter.setAutoScrollEnabled(change.value)
      return
    case 'autoCompactionEnabled':
      configPresenter.setAutoCompactionEnabled(change.value)
      return
    case 'autoCompactionTriggerThreshold':
      configPresenter.setAutoCompactionTriggerThreshold(change.value)
      return
    case 'autoCompactionRetainRecentPairs':
      configPresenter.setAutoCompactionRetainRecentPairs(change.value)
      return
    case 'contentProtectionEnabled':
      configPresenter.setContentProtectionEnabled(change.value)
      return
    case 'privacyModeEnabled':
      configPresenter.setPrivacyModeEnabled(change.value)
      return
    case 'notificationsEnabled':
      configPresenter.setNotificationsEnabled(change.value)
      return
    case 'traceDebugEnabled':
      configPresenter.setTraceDebugEnabled(change.value)
      return
    case 'copyWithCotEnabled':
      configPresenter.setCopyWithCotEnabled(change.value)
      return
    case 'loggingEnabled':
      configPresenter.setLoggingEnabled(change.value)
      return
  }
}

export function createSettingsRouteAdapter(
  configPresenter: IConfigPresenter
): SettingsRouteAdapter {
  return {
    readSnapshot: () => readSettingsSnapshot(configPresenter),
    applyChange: (change) => {
      applySettingChange(configPresenter, change)
    },
    listSystemFonts: async () => await configPresenter.getSystemFonts()
  }
}
