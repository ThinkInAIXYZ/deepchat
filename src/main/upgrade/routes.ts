import type { IUpgradePresenter } from '@shared/presenter'
import {
  upgradeCheckRoute,
  upgradeClearMockRoute,
  upgradeGetStatusRoute,
  upgradeMockDownloadedRoute,
  upgradeOpenDownloadRoute,
  upgradeRestartToUpdateRoute,
  upgradeStartDownloadRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createUpgradeRoutes(upgrade: IUpgradePresenter): DeepchatRouteMap {
  return createRouteMap([
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
        return upgradeMockDownloadedRoute.output.parse({ updated: upgrade.mockDownloadedUpdate() })
      }
    ],
    [
      upgradeClearMockRoute.name,
      async (rawInput) => {
        upgradeClearMockRoute.input.parse(rawInput)
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
