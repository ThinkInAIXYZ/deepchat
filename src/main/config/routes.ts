import {
  settingsActivityListRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  type DeepchatRouteName,
  type SettingsActivityInput
} from '@shared/contracts/routes'
import {
  createRouteMap,
  type DeepchatRouteHandler,
  type DeepchatRouteMap
} from '@/routes/routeRegistry'
import { CONFIG_ROUTE_NAMES, dispatchConfigRoute } from './configRouteHandler'
import { createSettingsRouteAdapter } from './settingsAdapter'
import { createSettingsRouteHandler } from './settingsHandler'
import type { UpdateSettings } from '@/upgrade/settings'
import type { DesktopSettings } from '@/desktop/settings'
import type { LoggingService } from '@/app/logging'
import type { FontSettings } from '@/desktop/fontSettings'
import type { DeepChatDefaults } from '@/agent/deepchat/defaults'
import type { PrivacySettingsPort } from '@/app/privacy'
import type { AgentTraceSettingsPort } from '@/agent/traceSettings'
import type { SettingsStore } from '@/config/settingsStore'

export function createConfigRoutes(deps: {
  settings: Pick<SettingsStore, 'get' | 'set'>
  agentDefaults: DeepChatDefaults
  privacy: PrivacySettingsPort
  traceSettings: AgentTraceSettingsPort
  updateSettings: UpdateSettings
  desktopSettings: DesktopSettings
  fonts: FontSettings
  applyContentProtection(enabled: boolean): void
  logging: LoggingService
  recordActivity(input: SettingsActivityInput): void
  listActivities(limit?: number): Promise<unknown[]>
}): DeepchatRouteMap {
  const entries: Array<readonly [DeepchatRouteName, DeepchatRouteHandler]> = []
  for (const routeName of CONFIG_ROUTE_NAMES) {
    entries.push([
      routeName,
      async (rawInput) => {
        const result = await dispatchConfigRoute(
          deps.settings,
          deps.updateSettings,
          deps.logging,
          routeName,
          rawInput
        )
        if (result === undefined) throw new Error(`Unhandled config route: ${routeName}`)
        return result
      }
    ])
  }

  const settings = createSettingsRouteHandler(
    createSettingsRouteAdapter(
      deps.agentDefaults,
      deps.privacy,
      deps.traceSettings,
      deps.desktopSettings,
      deps.fonts,
      deps.logging,
      deps.applyContentProtection
    )
  )
  entries.push(
    [settingsGetSnapshotRoute.name, async (rawInput) => settings.getSnapshot(rawInput)],
    [settingsListSystemFontsRoute.name, async (rawInput) => settings.listSystemFonts(rawInput)],
    [
      settingsUpdateRoute.name,
      async (rawInput) => {
        const input = settingsUpdateRoute.input.parse(rawInput)
        const result = settings.update(input)
        for (const change of input.changes) {
          deps.recordActivity({
            category:
              change.key === 'privacyModeEnabled'
                ? 'privacy'
                : change.key === 'fontSizeLevel' ||
                    change.key === 'fontFamily' ||
                    change.key === 'codeFontFamily' ||
                    change.key === 'artifactsEffectEnabled' ||
                    change.key === 'contentProtectionEnabled'
                  ? 'appearance'
                  : 'system',
            action:
              typeof change.value === 'boolean'
                ? change.value
                  ? 'enabled'
                  : 'disabled'
                : 'updated',
            targetType: 'setting',
            targetId: change.key,
            targetLabel: change.key,
            routeName:
              change.key === 'privacyModeEnabled' ? 'settings-database' : 'settings-common',
            summaryKey: 'settings.controlCenter.activity.settingUpdated',
            summaryParams: { key: change.key }
          })
        }
        return result
      }
    ],
    [
      settingsActivityListRoute.name,
      async (rawInput) => {
        const input = settingsActivityListRoute.input.parse(rawInput)
        return settingsActivityListRoute.output.parse({
          activities: await deps.listActivities(input.limit)
        })
      }
    ]
  )
  return createRouteMap(entries)
}
