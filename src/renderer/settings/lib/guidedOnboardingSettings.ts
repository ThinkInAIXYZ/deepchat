import type { GuidedOnboardingState, GuidedOnboardingStepId } from '@shared/contracts/routes'
import { resolveGuidedOnboardingStepTarget } from '@shared/guidedOnboarding'
import { createOnboardingClient } from '@api/OnboardingClient'
import type { Router } from 'vue-router'

const resolveGuidedOnboardingResumeStepId = (
  state: GuidedOnboardingState | null | undefined
): GuidedOnboardingStepId | null => {
  if (state?.status === 'active' && state.currentStepId) {
    return state.currentStepId
  }

  if (state?.status === 'completed') {
    return 'first-chat'
  }

  return null
}

export async function continueGuidedOnboardingFromSettings(options: {
  state: GuidedOnboardingState | null | undefined
  router: Pick<Router, 'hasRoute' | 'push'>
  currentRoute?: {
    name?: unknown
    params?: Record<string, unknown>
  }
  windowClient: {
    resumeGuidedOnboarding: () => Promise<{ requested: boolean; focused: boolean }>
  }
}) {
  const { router, currentRoute, windowClient } = options
  let { state } = options
  let stepId = resolveGuidedOnboardingResumeStepId(state)

  // Re-read stale or missing state before choosing the destination. This keeps
  // same-window Settings navigation and the typed main-window handoff aligned.
  if (!stepId) {
    try {
      state = await createOnboardingClient().getState()
      stepId = resolveGuidedOnboardingResumeStepId(state)
    } catch (error) {
      console.warn('[GuidedOnboarding] Failed to refresh state from backend:', error)
    }
  }

  const target = resolveGuidedOnboardingStepTarget(stepId)

  if (target?.surface === 'plugins' && target.routeName === 'plugins-skills') {
    if (router.hasRoute(target.routeName)) {
      await router.push({ name: target.routeName })
      return
    }

    await windowClient.resumeGuidedOnboarding()
    return
  }

  if (target?.surface === 'settings' && target.routeName) {
    const mainRouteName = target.routeName === 'settings-mcp' ? 'plugins-mcp' : null
    if (mainRouteName && router.hasRoute(mainRouteName)) {
      await router.push({ name: mainRouteName })
      return
    }

    const providerId = currentRoute?.params?.providerId

    await router.push({
      name: target.routeName,
      params:
        target.routeName === 'settings-provider' && typeof providerId === 'string'
          ? { providerId }
          : undefined
    })
    return
  }

  await windowClient.resumeGuidedOnboarding()
}
