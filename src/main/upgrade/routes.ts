import { app } from 'electron'
import type { UpgradeService } from './index'
import type { UpdateSettings } from './settings'
import {
  configGetUpdateChannelRoute,
  configSetUpdateChannelRoute,
  upgradeCheckRoute,
  upgradeClearMockRoute,
  upgradeGetStatusRoute,
  upgradeMockDownloadedRoute,
  upgradeOpenDownloadRoute,
  upgradeRestartToUpdateRoute,
  upgradeStartDownloadRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createUpgradeRoutes(deps: {
  upgrade: Pick<
    UpgradeService,
    | 'getUpdateStatus'
    | 'checkUpdate'
    | 'goDownloadUpgrade'
    | 'startDownloadUpdate'
    | 'mockDownloadedUpdate'
    | 'clearMockUpdate'
    | 'restartToUpdate'
  >
  settings: UpdateSettings
}): DeepchatRouteMap {
  const { upgrade } = deps
  return createRouteMap([
    [
      configGetUpdateChannelRoute.name,
      async (rawInput) => {
        configGetUpdateChannelRoute.input.parse(rawInput)
        return configGetUpdateChannelRoute.output.parse({ channel: deps.settings.getChannel() })
      }
    ],
    [
      configSetUpdateChannelRoute.name,
      async (rawInput) => {
        const input = configSetUpdateChannelRoute.input.parse(rawInput)
        deps.settings.setChannel(input.channel)
        return configSetUpdateChannelRoute.output.parse({ channel: deps.settings.getChannel() })
      }
    ],
    [
      upgradeGetStatusRoute.name,
      async (rawInput) => {
        upgradeGetStatusRoute.input.parse(rawInput)
        return upgradeGetStatusRoute.output.parse({ snapshot: upgrade.getUpdateStatus() })
      }
    ],
    [
      upgradeCheckRoute.name,
      async (rawInput) => {
        const input = upgradeCheckRoute.input.parse(rawInput)
        await upgrade.checkUpdate(input.type)
        return upgradeCheckRoute.output.parse({ checked: true })
      }
    ],
    [
      upgradeOpenDownloadRoute.name,
      async (rawInput) => {
        const input = upgradeOpenDownloadRoute.input.parse(rawInput)
        await upgrade.goDownloadUpgrade(input.type)
        return upgradeOpenDownloadRoute.output.parse({ opened: true })
      }
    ],
    [
      upgradeStartDownloadRoute.name,
      async (rawInput) => {
        upgradeStartDownloadRoute.input.parse(rawInput)
        return upgradeStartDownloadRoute.output.parse({ started: upgrade.startDownloadUpdate() })
      }
    ],
    [
      upgradeMockDownloadedRoute.name,
      async (rawInput) => {
        upgradeMockDownloadedRoute.input.parse(rawInput)
        if (!import.meta.env.DEV || app.isPackaged) {
          return upgradeMockDownloadedRoute.output.parse({ updated: false })
        }
        return upgradeMockDownloadedRoute.output.parse({ updated: upgrade.mockDownloadedUpdate() })
      }
    ],
    [
      upgradeClearMockRoute.name,
      async (rawInput) => {
        upgradeClearMockRoute.input.parse(rawInput)
        if (!import.meta.env.DEV || app.isPackaged) {
          return upgradeClearMockRoute.output.parse({ updated: false })
        }
        return upgradeClearMockRoute.output.parse({ updated: upgrade.clearMockUpdate() })
      }
    ],
    [
      upgradeRestartToUpdateRoute.name,
      async (rawInput) => {
        upgradeRestartToUpdateRoute.input.parse(rawInput)
        return upgradeRestartToUpdateRoute.output.parse({ restarted: upgrade.restartToUpdate() })
      }
    ]
  ])
}
