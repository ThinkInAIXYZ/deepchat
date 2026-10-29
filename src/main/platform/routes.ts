import {
  configGetProxySettingsRoute,
  configSetCustomProxyUrlRoute,
  configSetProxyModeRoute,
  type DeepchatRouteName
} from '@shared/contracts/routes'
import type { ProxySettings, ProxySettingMode } from './proxySettings'

export function createPlatformRoutes(deps: {
  proxySettings: ProxySettings
  applyProxyMode(mode: ProxySettingMode): void | Promise<void>
  applyCustomProxyUrl(url: string): void | Promise<void>
}): ReadonlyMap<DeepchatRouteName, (rawInput: unknown) => Promise<unknown>> {
  const read = () => ({
    mode: deps.proxySettings.getMode(),
    customProxyUrl: deps.proxySettings.getCustomUrl()
  })
  return new Map([
    [
      configGetProxySettingsRoute.name,
      async (rawInput: unknown) => {
        configGetProxySettingsRoute.input.parse(rawInput)
        return configGetProxySettingsRoute.output.parse(read())
      }
    ],
    [
      configSetProxyModeRoute.name,
      async (rawInput: unknown) => {
        const input = configSetProxyModeRoute.input.parse(rawInput)
        deps.proxySettings.setMode(input.mode)
        await deps.applyProxyMode(input.mode)
        return configSetProxyModeRoute.output.parse(read())
      }
    ],
    [
      configSetCustomProxyUrlRoute.name,
      async (rawInput: unknown) => {
        const input = configSetCustomProxyUrlRoute.input.parse(rawInput)
        deps.proxySettings.setCustomUrl(input.url)
        await deps.applyCustomProxyUrl(input.url)
        return configSetCustomProxyUrlRoute.output.parse(read())
      }
    ]
  ])
}
