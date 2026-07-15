import type { ConfigServicePort } from '@shared/presenter'
import {
  DEEPCHAT_ROUTE_CATALOG,
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
import { dispatchConfigRoute } from './configRouteHandler'
import { recordConfigRouteActivity } from './activity'
import { createSettingsRouteAdapter } from './settingsAdapter'
import { createSettingsRouteHandler } from './settingsHandler'
import type { SyncSettings } from '@/sync/settings'
import type { HookSettings } from '@/hook/config'
import type { HookTestResult } from '@shared/hooksNotifications'
import type { UpdateSettings } from '@/upgrade/settings'
import type { DesktopSettings } from '@/desktop/settings'
import type { ProjectService } from '@/project'
import type { LoggingService } from '@/app/logging'

const AGENT_CHANGE_ROUTES = new Set<DeepchatRouteName>([
  'config.setAcpEnabled',
  'config.setAcpAgentEnabled',
  'config.uninstallAcpRegistryAgent',
  'config.updateManualAcpAgent',
  'config.removeManualAcpAgent',
  'config.updateDeepChatAgent',
  'config.deleteDeepChatAgent'
])

export function createConfigRoutes(deps: {
  config: ConfigServicePort
  syncSettings: SyncSettings
  hookSettings: HookSettings
  updateSettings: UpdateSettings
  desktopSettings: DesktopSettings
  applyContentProtection(enabled: boolean): void
  projectService: ProjectService
  logging: LoggingService
  setFloatingButtonEnabled(enabled: boolean): void
  testHookCommand(hookId: string): Promise<HookTestResult>
  recordActivity(input: SettingsActivityInput): void
  listActivities(limit?: number): Promise<unknown[]>
  reconcileSchedulerAfterAgentChange(): Promise<void>
}): DeepchatRouteMap {
  const entries: Array<readonly [DeepchatRouteName, DeepchatRouteHandler]> = []
  for (const routeName of Object.keys(DEEPCHAT_ROUTE_CATALOG) as DeepchatRouteName[]) {
    if (!routeName.startsWith('config.')) continue
    entries.push([
      routeName,
      async (rawInput) => {
        const result = await dispatchConfigRoute(
          deps.config,
          deps.syncSettings,
          deps.hookSettings,
          deps.updateSettings,
          deps.desktopSettings,
          deps.projectService,
          deps.logging,
          deps.setFloatingButtonEnabled,
          deps.testHookCommand,
          routeName,
          rawInput
        )
        if (result === undefined) throw new Error(`Unhandled config route: ${routeName}`)
        recordConfigRouteActivity(deps.recordActivity, routeName, rawInput)
        if (AGENT_CHANGE_ROUTES.has(routeName)) {
          try {
            await deps.reconcileSchedulerAfterAgentChange()
          } catch (error) {
            console.warn('[CronJobs] Failed to reconcile jobs after agent change:', error)
          }
        }
        return result
      }
    ])
  }

  const settings = createSettingsRouteHandler(
    createSettingsRouteAdapter(
      deps.config,
      deps.desktopSettings,
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
