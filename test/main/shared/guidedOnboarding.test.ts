import { describe, expect, it } from 'vitest'
import {
  resolveCurrentGuidedOnboardingStepId,
  resolveGuidedOnboardingStepTarget
} from '@shared/guidedOnboarding'

describe('resolveCurrentGuidedOnboardingStepId', () => {
  it('prefers in_progress over pending when currentStepId is empty', () => {
    const stepId = resolveCurrentGuidedOnboardingStepId({
      currentStepId: null,
      steps: [
        { id: 'select-provider', status: 'completed' },
        { id: 'provider-api-key', status: 'in_progress' },
        { id: 'provider-model', status: 'pending' }
      ]
    })

    expect(stepId).toBe('provider-api-key')
  })
})

describe('resolveGuidedOnboardingStepTarget', () => {
  it('routes Skills onboarding to the Plugins hub', () => {
    expect(resolveGuidedOnboardingStepTarget('skills')).toEqual({
      stepId: 'skills',
      surface: 'plugins',
      routeName: 'plugins-skills'
    })
  })
})
