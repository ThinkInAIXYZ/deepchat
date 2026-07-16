import { configResetShortcutKeysRoute, type SettingsActivityInput } from '@shared/contracts/routes'

export function recordConfigRouteActivity(
  recordActivity: (activity: SettingsActivityInput) => void,
  routeName: string,
  rawInput: unknown
): void {
  if (routeName !== configResetShortcutKeysRoute.name) return
  configResetShortcutKeysRoute.input.parse(rawInput)
  recordActivity({
    category: 'shortcut',
    action: 'reset',
    targetType: 'shortcut',
    targetLabel: 'Shortcuts',
    routeName: 'settings-shortcut',
    summaryKey: 'settings.controlCenter.activity.settingUpdated',
    summaryParams: { key: 'shortcuts' }
  })
}
