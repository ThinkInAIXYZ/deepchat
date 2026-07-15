import type { IConfigPresenter } from '@shared/presenter'
import {
  onboardingCompleteRoute,
  onboardingGetStateRoute,
  onboardingResetRoute,
  onboardingSetStepStatusRoute,
  onboardingStartRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'
import {
  completeGuidedOnboarding,
  readGuidedOnboardingState,
  resetGuidedOnboarding,
  setGuidedOnboardingStepStatus,
  startGuidedOnboarding
} from './state'

export function createOnboardingRoutes(
  config: Pick<IConfigPresenter, 'getSetting' | 'setSetting'>
): DeepchatRouteMap {
  return createRouteMap([
    [
      onboardingGetStateRoute.name,
      async (rawInput) => {
        onboardingGetStateRoute.input.parse(rawInput)
        return onboardingGetStateRoute.output.parse({ state: readGuidedOnboardingState(config) })
      }
    ],
    [
      onboardingStartRoute.name,
      async (rawInput) => {
        const input = onboardingStartRoute.input.parse(rawInput)
        return onboardingStartRoute.output.parse({ state: startGuidedOnboarding(config, input) })
      }
    ],
    [
      onboardingSetStepStatusRoute.name,
      async (rawInput) => {
        const input = onboardingSetStepStatusRoute.input.parse(rawInput)
        return onboardingSetStepStatusRoute.output.parse({
          state: setGuidedOnboardingStepStatus(config, input)
        })
      }
    ],
    [
      onboardingCompleteRoute.name,
      async (rawInput) => {
        const input = onboardingCompleteRoute.input.parse(rawInput)
        return onboardingCompleteRoute.output.parse({
          state: completeGuidedOnboarding(config, Date.now(), { force: input.force })
        })
      }
    ],
    [
      onboardingResetRoute.name,
      async (rawInput) => {
        onboardingResetRoute.input.parse(rawInput)
        return onboardingResetRoute.output.parse({ state: resetGuidedOnboarding(config) })
      }
    ]
  ])
}
