import {
  configGetHooksNotificationsRoute,
  configSetHooksNotificationsRoute,
  configTestHookCommandRoute,
  type DeepchatRouteName
} from '@shared/contracts/routes'
import type { HooksNotificationsSettings, HookTestResult } from '@shared/hooksNotifications'

export interface HookRoutesPort {
  getConfigSnapshot(): HooksNotificationsSettings
  updateConfig(config: HooksNotificationsSettings): HooksNotificationsSettings
  testHookCommand(hookId: string): Promise<HookTestResult>
}

export function createHookRoutes(deps: {
  service: HookRoutesPort
}): ReadonlyMap<DeepchatRouteName, (rawInput: unknown) => Promise<unknown>> {
  return new Map<DeepchatRouteName, (rawInput: unknown) => Promise<unknown>>([
    [
      configGetHooksNotificationsRoute.name,
      async (rawInput: unknown) => {
        configGetHooksNotificationsRoute.input.parse(rawInput)
        return configGetHooksNotificationsRoute.output.parse({
          config: deps.service.getConfigSnapshot()
        })
      }
    ],
    [
      configSetHooksNotificationsRoute.name,
      async (rawInput: unknown) => {
        const input = configSetHooksNotificationsRoute.input.parse(rawInput)
        return configSetHooksNotificationsRoute.output.parse({
          config: deps.service.updateConfig(input.config)
        })
      }
    ],
    [
      configTestHookCommandRoute.name,
      async (rawInput: unknown) => {
        const input = configTestHookCommandRoute.input.parse(rawInput)
        return configTestHookCommandRoute.output.parse({
          result: await deps.service.testHookCommand(input.hookId)
        })
      }
    ]
  ])
}
