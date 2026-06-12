import { describe, expect, it } from 'vitest'
import { resolveCurrentGuidedOnboardingStepId } from '@shared/guidedOnboarding'

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
