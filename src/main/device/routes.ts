import type { DeviceServicePort } from '@shared/types/device'
import {
  deviceGetAppVersionRoute,
  deviceGetInfoRoute,
  deviceRestartAppRoute,
  deviceResetDataByTypeRoute,
  deviceSanitizeSvgRoute,
  deviceSelectDirectoryRoute,
  deviceSelectFilesRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createDeviceRoutes(deps: {
  device: DeviceServicePort
  restartApplication(): Promise<void>
  resetDataByType(resetType: 'chat' | 'knowledge' | 'config' | 'all'): Promise<void>
}): DeepchatRouteMap {
  return createRouteMap([
    [
      deviceGetAppVersionRoute.name,
      async (rawInput) => {
        deviceGetAppVersionRoute.input.parse(rawInput)
        return deviceGetAppVersionRoute.output.parse({
          version: await deps.device.getAppVersion()
        })
      }
    ],
    [
      deviceGetInfoRoute.name,
      async (rawInput) => {
        deviceGetInfoRoute.input.parse(rawInput)
        return deviceGetInfoRoute.output.parse({ info: await deps.device.getDeviceInfo() })
      }
    ],
    [
      deviceSelectDirectoryRoute.name,
      async (rawInput) => {
        deviceSelectDirectoryRoute.input.parse(rawInput)
        return deviceSelectDirectoryRoute.output.parse(await deps.device.selectDirectory())
      }
    ],
    [
      deviceSelectFilesRoute.name,
      async (rawInput) => {
        const input = deviceSelectFilesRoute.input.parse(rawInput)
        return deviceSelectFilesRoute.output.parse(await deps.device.selectFiles(input))
      }
    ],
    [
      deviceRestartAppRoute.name,
      async (rawInput) => {
        deviceRestartAppRoute.input.parse(rawInput)
        await deps.restartApplication()
        return deviceRestartAppRoute.output.parse({ restarted: true })
      }
    ],
    [
      deviceResetDataByTypeRoute.name,
      async (rawInput) => {
        const input = deviceResetDataByTypeRoute.input.parse(rawInput)
        await deps.resetDataByType(input.resetType)
        return deviceResetDataByTypeRoute.output.parse({ reset: true })
      }
    ],
    [
      deviceSanitizeSvgRoute.name,
      async (rawInput) => {
        const input = deviceSanitizeSvgRoute.input.parse(rawInput)
        return deviceSanitizeSvgRoute.output.parse({
          content: await deps.device.sanitizeSvgContent(input.svgContent)
        })
      }
    ]
  ])
}
