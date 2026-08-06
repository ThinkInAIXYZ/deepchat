import {
  cliCapabilitiesRoute,
  cliDoctorRoute,
  cliStatusRoute,
  cliVersionRoute
} from '@shared/contracts/routes'
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_SURFACE_VERSION
} from '@shared/contracts/localControl'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import { listCliSurfaceCapabilities } from './surface'

export type CliRuntimeStatus = Readonly<{
  running: boolean
  pid: number
  startedAt: number
  uptimeMs: number
  endpointKind: 'unix' | 'pipe'
  activeConnections: number
  pendingRequests: number
  descriptorReady: boolean
}>

export function createCliRoutes(deps: {
  appVersion: string
  getStatus(): CliRuntimeStatus
  hasTrustedRenderer(): boolean | Promise<boolean>
}): DeepchatRouteMap {
  return createRouteMap([
    [
      cliStatusRoute.name,
      async (rawInput) => {
        cliStatusRoute.input.parse(rawInput)
        const { descriptorReady: _descriptorReady, ...status } = deps.getStatus()
        return cliStatusRoute.output.parse(status)
      }
    ],
    [
      cliVersionRoute.name,
      async (rawInput) => {
        cliVersionRoute.input.parse(rawInput)
        return cliVersionRoute.output.parse({
          appVersion: deps.appVersion,
          protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
          surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION
        })
      }
    ],
    [
      cliCapabilitiesRoute.name,
      async (rawInput) => {
        cliCapabilitiesRoute.input.parse(rawInput)
        return cliCapabilitiesRoute.output.parse({
          protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
          surfaceVersion: LOCAL_CONTROL_SURFACE_VERSION,
          capabilities: listCliSurfaceCapabilities()
        })
      }
    ],
    [
      cliDoctorRoute.name,
      async (rawInput) => {
        cliDoctorRoute.input.parse(rawInput)
        const status = deps.getStatus()
        const capabilities = listCliSurfaceCapabilities()
        const hasTrustedRenderer = await deps.hasTrustedRenderer()
        const checks = [
          {
            id: 'transport' as const,
            status: status.running ? ('ok' as const) : ('error' as const),
            message: status.running
              ? 'Local transport is accepting requests'
              : 'Local transport is stopped'
          },
          {
            id: 'descriptor' as const,
            status: status.descriptorReady ? ('ok' as const) : ('error' as const),
            message: status.descriptorReady
              ? 'Private discovery descriptor is available'
              : 'Private discovery descriptor is unavailable'
          },
          {
            id: 'surface' as const,
            status: capabilities.length > 0 ? ('ok' as const) : ('error' as const),
            message: `${capabilities.length} V1 methods are registered`
          },
          {
            id: 'renderer' as const,
            status: hasTrustedRenderer ? ('ok' as const) : ('warning' as const),
            message: hasTrustedRenderer
              ? 'A trusted renderer can present approvals'
              : 'No trusted renderer is currently available for approvals'
          }
        ]
        return cliDoctorRoute.output.parse({
          healthy: checks.every((check) => check.status !== 'error'),
          checks
        })
      }
    ]
  ])
}
