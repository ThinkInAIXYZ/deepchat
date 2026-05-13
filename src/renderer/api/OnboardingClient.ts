import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  guidedOnboardingStateSchema,
  onboardingCompleteRoute,
  onboardingGetStateRoute,
  onboardingResetRoute,
  onboardingSetStepStatusRoute,
  onboardingStartRoute,
  type GuidedOnboardingState,
  type GuidedOnboardingStepId
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createOnboardingClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  const parseStateResponse = (
    routeName: string,
    result: unknown
  ): {
    state: GuidedOnboardingState
  } => {
    if (typeof result !== 'object' || result === null) {
      throw new Error(`[OnboardingClient] Invalid response shape from ${routeName}`)
    }

    const maybeState = (result as { state?: unknown }).state
    const parsedState = guidedOnboardingStateSchema.safeParse(maybeState)
    if (!parsedState.success) {
      throw new Error(`[OnboardingClient] Invalid state response from ${routeName}`)
    }

    return { state: parsedState.data }
  }

  async function getState() {
    try {
      const result = await bridge.invoke(onboardingGetStateRoute.name, {})
      return parseStateResponse(onboardingGetStateRoute.name, result).state
    } catch (error) {
      console.error(`[OnboardingClient] ${onboardingGetStateRoute.name} failed:`, error)
      throw error
    }
  }

  async function start(options: { force?: boolean; stepId?: GuidedOnboardingStepId } = {}) {
    try {
      const result = await bridge.invoke(onboardingStartRoute.name, options)
      return parseStateResponse(onboardingStartRoute.name, result).state
    } catch (error) {
      console.error(`[OnboardingClient] ${onboardingStartRoute.name} failed:`, error)
      throw error
    }
  }

  async function setStepStatus(input: {
    stepId: GuidedOnboardingStepId
    status: 'in_progress' | 'completed' | 'skipped'
  }) {
    try {
      const result = await bridge.invoke(onboardingSetStepStatusRoute.name, input)
      return parseStateResponse(onboardingSetStepStatusRoute.name, result).state
    } catch (error) {
      console.error(`[OnboardingClient] ${onboardingSetStepStatusRoute.name} failed:`, error)
      throw error
    }
  }

  async function complete(input: { force?: boolean } = {}) {
    try {
      const result = await bridge.invoke(onboardingCompleteRoute.name, input)
      return parseStateResponse(onboardingCompleteRoute.name, result).state
    } catch (error) {
      console.error(`[OnboardingClient] ${onboardingCompleteRoute.name} failed:`, error)
      throw error
    }
  }

  async function reset() {
    try {
      const result = await bridge.invoke(onboardingResetRoute.name, {})
      return parseStateResponse(onboardingResetRoute.name, result).state
    } catch (error) {
      console.error(`[OnboardingClient] ${onboardingResetRoute.name} failed:`, error)
      throw error
    }
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
