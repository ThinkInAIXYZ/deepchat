import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  onboardingCompleteRoute,
  onboardingGetStateRoute,
  onboardingResetRoute,
  onboardingSetStepStatusRoute,
  onboardingStartRoute,
  type GuidedOnboardingStepId
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createOnboardingClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getState() {
    const result = await bridge.invoke(onboardingGetStateRoute.name, {})
    return result.state
  }

  async function start(options: { force?: boolean; stepId?: GuidedOnboardingStepId } = {}) {
    const result = await bridge.invoke(onboardingStartRoute.name, options)
    return result.state
  }

  async function setStepStatus(input: {
    stepId: GuidedOnboardingStepId
    status: 'in_progress' | 'completed' | 'skipped'
  }) {
    const result = await bridge.invoke(onboardingSetStepStatusRoute.name, input)
    return result.state
  }

  async function complete(input: { force?: boolean } = {}) {
    const result = await bridge.invoke(onboardingCompleteRoute.name, input)
    return result.state
  }

  async function reset() {
    const result = await bridge.invoke(onboardingResetRoute.name, {})
    return result.state
  }

  return {
    getState,
    start,
    setStepStatus,
    complete,
    reset
  }
}

export type OnboardingClient = ReturnType<typeof createOnboardingClient>
