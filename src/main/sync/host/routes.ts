import {
  syncHostCreatePairingCodeRoute,
  syncHostGetAuditRoute,
  syncHostGetStatusRoute,
  syncHostListDevicesRoute,
  syncHostRenameDeviceRoute,
  syncHostSetDeviceWritableRoute,
  syncHostRevokeDeviceRoute,
  syncHostSetEnabledRoute,
  syncHostPublishRoute
} from '@shared/contracts/routes'
import {
  createRouteMap,
  requireRendererCaller,
  type DeepchatRouteMap
} from '@/routes/routeRegistry'
import type { SyncHostService } from './index'

/**
 * Renderer-facing control surface for host mode. Remote device traffic never uses these routes:
 * it arrives on the loopback endpoint and is authorized by device tokens. Every handler asserts a
 * renderer caller: enabling host mode opens a network listener and pairing mints device tokens, so
 * these must not be reachable from the local control plane even if the surface list changes.
 */
export type SyncHostRoutePort = Pick<
  SyncHostService,
  | 'publishSnapshot'
  | 'getStatus'
  | 'getPairingCode'
  | 'setEnabled'
  | 'createPairingCode'
  | 'listDevices'
  | 'revokeDevice'
  | 'renameDevice'
  | 'setDeviceWritable'
  | 'getAuditEntries'
>

export function createSyncHostRoutes(deps: { host: SyncHostRoutePort }): DeepchatRouteMap {
  return createRouteMap([
    [
      syncHostPublishRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        syncHostPublishRoute.input.parse(rawInput)
        return syncHostPublishRoute.output.parse({ status: await deps.host.publishSnapshot() })
      }
    ],
    [
      syncHostGetStatusRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        syncHostGetStatusRoute.input.parse(rawInput)
        const status = await deps.host.getStatus()
        const pairing = deps.host.getPairingCode()
        return syncHostGetStatusRoute.output.parse({ status, pairing })
      }
    ],
    [
      syncHostSetEnabledRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = syncHostSetEnabledRoute.input.parse(rawInput)
        const status = await deps.host.setEnabled(input.enabled, {
          port: input.port,
          consent: input.consent,
          bidirectional: input.bidirectional,
          tunnel: input.tunnel
        })
        return syncHostSetEnabledRoute.output.parse({ status })
      }
    ],
    [
      syncHostCreatePairingCodeRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        syncHostCreatePairingCodeRoute.input.parse(rawInput)
        const pairing = deps.host.createPairingCode() ?? deps.host.getPairingCode()
        return syncHostCreatePairingCodeRoute.output.parse({ pairing })
      }
    ],
    [
      syncHostListDevicesRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        syncHostListDevicesRoute.input.parse(rawInput)
        return syncHostListDevicesRoute.output.parse({ devices: deps.host.listDevices() })
      }
    ],
    [
      syncHostRevokeDeviceRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = syncHostRevokeDeviceRoute.input.parse(rawInput)
        return syncHostRevokeDeviceRoute.output.parse({
          revoked: await deps.host.revokeDevice(input.deviceId)
        })
      }
    ],
    [
      syncHostRenameDeviceRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = syncHostRenameDeviceRoute.input.parse(rawInput)
        return syncHostRenameDeviceRoute.output.parse({
          renamed: await deps.host.renameDevice(input.deviceId, input.name)
        })
      }
    ],
    [
      syncHostSetDeviceWritableRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        const input = syncHostSetDeviceWritableRoute.input.parse(rawInput)
        return syncHostSetDeviceWritableRoute.output.parse({
          changed: await deps.host.setDeviceWritable(input.deviceId, input.writable)
        })
      }
    ],
    [
      syncHostGetAuditRoute.name,
      async (rawInput, context) => {
        requireRendererCaller(context)
        syncHostGetAuditRoute.input.parse(rawInput)
        return syncHostGetAuditRoute.output.parse({ entries: deps.host.getAuditEntries() })
      }
    ]
  ])
}
