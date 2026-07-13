import type { GuidedOnboardingState, GuidedOnboardingStepId } from '@shared/contracts/routes'
import { resolveGuidedOnboardingStepTarget } from '@shared/guidedOnboarding'
import { createOnboardingClient } from '@api/OnboardingClient'
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
  router: Pick<Router, 'hasRoute' | 'push'>
  currentRoute?: {
    name?: unknown
    params?: Record<string, unknown>
  }
  windowClient: {
    focusMainWindow?: () => Promise<boolean> | boolean
  }
}) {
  const { router, currentRoute, windowClient } = options
  let { state } = options
  let stepId = resolveGuidedOnboardingResumeStepId(state)

  // If the caller passed a stale/null state, the local handler likely failed
  // its IPC call (or never received a response). Re-read from the backend so a
  // transient renderer hiccup cannot force the helper into the fallback branch
  // that focuses the main window instead of advancing within settings.
  if (!stepId) {
    try {
      state = await createOnboardingClient().getState()
      stepId = resolveGuidedOnboardingResumeStepId(state)
    } catch (error) {
      console.warn('[GuidedOnboarding] Failed to refresh state from backend:', error)
    }
  }

  const target = resolveGuidedOnboardingStepTarget(stepId)

  if (target?.surface === 'settings' && target.routeName) {
    const mainRouteName =
      target.routeName === 'settings-mcp'
        ? 'plugins-mcp'
        : target.routeName === 'settings-skills'
          ? 'plugins-skills'
          : null
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

  if (stepId) {
    persistGuidedOnboardingResumeIntent({
      stepId,
      trigger: 'window-focus'
    })
  }

  await windowClient.focusMainWindow?.()
}
