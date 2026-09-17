import {
  syncHostCreatePairingCodeRoute,
  syncHostGetAuditRoute,
  syncHostGetStatusRoute,
  syncHostListDevicesRoute,
  syncHostRenameDeviceRoute,
  syncHostRevokeDeviceRoute,
  syncHostSetEnabledRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import type { SyncHostService } from './index'

/**
 * Renderer-facing control surface for host mode. Remote device traffic never uses these routes:
 * it arrives on the loopback endpoint and is authorized by device tokens.
 */
export type SyncHostRoutePort = Pick<
  SyncHostService,
  | 'getStatus'
  | 'getPairingCode'
  | 'setEnabled'
  | 'createPairingCode'
  | 'listDevices'
  | 'revokeDevice'
  | 'renameDevice'
  | 'getAuditEntries'
>

export function createSyncHostRoutes(deps: { host: SyncHostRoutePort }): DeepchatRouteMap {
  return createRouteMap([
    [
      syncHostGetStatusRoute.name,
      async (rawInput) => {
        syncHostGetStatusRoute.input.parse(rawInput)
        const status = await deps.host.getStatus()
        const pairing = deps.host.getPairingCode()
        return syncHostGetStatusRoute.output.parse({ status, pairing })
      }
    ],
    [
      syncHostSetEnabledRoute.name,
      async (rawInput) => {
        const input = syncHostSetEnabledRoute.input.parse(rawInput)
        const status = await deps.host.setEnabled(input.enabled)
        return syncHostSetEnabledRoute.output.parse({ status })
      }
    ],
    [
      syncHostCreatePairingCodeRoute.name,
      async (rawInput) => {
        syncHostCreatePairingCodeRoute.input.parse(rawInput)
        const pairing = deps.host.createPairingCode() ?? deps.host.getPairingCode()
        return syncHostCreatePairingCodeRoute.output.parse({ pairing })
      }
    ],
    [
      syncHostListDevicesRoute.name,
      async (rawInput) => {
        syncHostListDevicesRoute.input.parse(rawInput)
        return syncHostListDevicesRoute.output.parse({ devices: deps.host.listDevices() })
      }
    ],
    [
      syncHostRevokeDeviceRoute.name,
      async (rawInput) => {
        const input = syncHostRevokeDeviceRoute.input.parse(rawInput)
        return syncHostRevokeDeviceRoute.output.parse({
          revoked: await deps.host.revokeDevice(input.deviceId)
        })
      }
    ],
    [
      syncHostRenameDeviceRoute.name,
      async (rawInput) => {
        const input = syncHostRenameDeviceRoute.input.parse(rawInput)
        return syncHostRenameDeviceRoute.output.parse({
          renamed: await deps.host.renameDevice(input.deviceId, input.name)
        })
      }
    ],
    [
      syncHostGetAuditRoute.name,
      async (rawInput) => {
        syncHostGetAuditRoute.input.parse(rawInput)
        return syncHostGetAuditRoute.output.parse({ entries: deps.host.getAuditEntries() })
      }
    ]
  ])
}
