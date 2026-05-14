import type { GuidedOnboardingState, GuidedOnboardingStepId } from '@shared/contracts/routes'
import { resolveGuidedOnboardingStepTarget } from '@shared/guidedOnboarding'
import { persistGuidedOnboardingResumeIntent } from '@/lib/onboardingResume'
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
  router: Pick<Router, 'push'>
  currentRoute?: {
    name?: unknown
    params?: Record<string, unknown>
  }
  windowPresenter: {
    focusMainWindow?: () => Promise<boolean> | boolean
  }
}) {
  const { state, router, currentRoute, windowPresenter } = options
  const stepId = resolveGuidedOnboardingResumeStepId(state)
  const target = resolveGuidedOnboardingStepTarget(stepId)

  if (target?.surface === 'settings' && target.routeName) {
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

  if (stepId) {
    persistGuidedOnboardingResumeIntent({
      stepId,
      trigger: 'window-focus'
    })
  }

  await windowPresenter.focusMainWindow?.()
}
