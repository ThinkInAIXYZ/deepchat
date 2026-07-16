import {
  configGetHooksNotificationsRoute,
  configSetHooksNotificationsRoute,
  configTestHookCommandRoute,
  type DeepchatRouteName
} from '@shared/contracts/routes'
import type { HookTestResult } from '@shared/hooksNotifications'
import type { HookSettings } from './config'

export function createHookRoutes(deps: {
  settings: HookSettings
  testCommand(hookId: string): Promise<HookTestResult>
}): ReadonlyMap<DeepchatRouteName, (rawInput: unknown) => Promise<unknown>> {
  return new Map<DeepchatRouteName, (rawInput: unknown) => Promise<unknown>>([
    [
      configGetHooksNotificationsRoute.name,
      async (rawInput: unknown) => {
        configGetHooksNotificationsRoute.input.parse(rawInput)
        return configGetHooksNotificationsRoute.output.parse({
          config: deps.settings.getHooksNotificationsConfig()
        })
      }
    ],
    [
      configSetHooksNotificationsRoute.name,
      async (rawInput: unknown) => {
        const input = configSetHooksNotificationsRoute.input.parse(rawInput)
        return configSetHooksNotificationsRoute.output.parse({
          config: deps.settings.setHooksNotificationsConfig(input.config)
        })
      }
    ],
    [
      configTestHookCommandRoute.name,
      async (rawInput: unknown) => {
        const input = configTestHookCommandRoute.input.parse(rawInput)
        return configTestHookCommandRoute.output.parse({
          result: await deps.testCommand(input.hookId)
        })
      }
    ]
  ])
}
