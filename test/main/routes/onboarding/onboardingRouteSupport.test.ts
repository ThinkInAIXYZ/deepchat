import type { IConfigPresenter } from '@shared/presenter'
import {
  completeGuidedOnboarding,
  GUIDED_ONBOARDING_STATE_KEY,
  readGuidedOnboardingState,
  resetGuidedOnboarding,
  setGuidedOnboardingStepStatus,
  startGuidedOnboarding
} from '@/routes/onboarding/onboardingRouteSupport'

describe('onboardingRouteSupport', () => {
  const createConfigPresenter = () => {
    const store = new Map<string, unknown>()

    const presenter = {
      getSetting: vi.fn(<T>(key: string) => store.get(key) as T | undefined),
      setSetting: vi.fn((key: string, value: unknown) => {
        store.set(key, value)
      })
    } as unknown as IConfigPresenter

    return { presenter, store }
  }

  it('returns a normalized default state when nothing is stored', () => {
    const { presenter } = createConfigPresenter()

    const state = readGuidedOnboardingState(presenter, 100)

    expect(state.status).toBe('idle')
    expect(state.currentStepId).toBeNull()
    expect(state.steps.map((step) => [step.id, step.required, step.status])).toEqual([
      ['select-provider', true, 'pending'],
      ['provider-api-key', false, 'pending'],
      ['provider-model', false, 'pending'],
      ['mcp', false, 'pending'],
      ['skills', false, 'pending'],
      ['switch-agent', true, 'pending'],
      ['switch-model', true, 'pending'],
      ['first-chat', true, 'pending']
    ])
  })

  it('starts onboarding from the first required step', () => {
    const { presenter, store } = createConfigPresenter()

    const state = startGuidedOnboarding(presenter, {}, 200)

    expect(state.status).toBe('active')
    expect(state.currentStepId).toBe('select-provider')
    expect(state.steps.find((step) => step.id === 'select-provider')).toEqual(
      expect.objectContaining({
        status: 'in_progress',
        startedAt: 200
      })
    )
    expect(store.get(GUIDED_ONBOARDING_STATE_KEY)).toEqual(state)
  })

  it('rejects skipping a required step', () => {
    const { presenter } = createConfigPresenter()
    startGuidedOnboarding(presenter, {}, 300)

    expect(() =>
      setGuidedOnboardingStepStatus(
        presenter,
        {
          stepId: 'select-provider',
          status: 'skipped'
        },
        301
      )
    ).toThrow('Cannot skip required onboarding step: select-provider')
  })

  it('advances through required steps and allows skipping optional steps', () => {
    const { presenter } = createConfigPresenter()

    startGuidedOnboarding(presenter, {}, 400)
    const afterProviderSelect = setGuidedOnboardingStepStatus(
      presenter,
      { stepId: 'select-provider', status: 'completed' },
      401
    )
    const afterApiKeySkip = setGuidedOnboardingStepStatus(
      presenter,
      { stepId: 'provider-api-key', status: 'skipped' },
      402
    )
    const afterModelSkip = setGuidedOnboardingStepStatus(
      presenter,
      { stepId: 'provider-model', status: 'skipped' },
      403
    )
    const afterMcp = setGuidedOnboardingStepStatus(
      presenter,
      { stepId: 'mcp', status: 'completed' },
      404
    )
    const afterSkills = setGuidedOnboardingStepStatus(
      presenter,
      { stepId: 'skills', status: 'completed' },
      405
    )

    expect(afterProviderSelect.currentStepId).toBe('provider-api-key')
    expect(afterApiKeySkip.currentStepId).toBe('provider-model')
    expect(afterApiKeySkip.steps.find((step) => step.id === 'provider-api-key')).toEqual(
      expect.objectContaining({
        status: 'skipped',
        skippedAt: 402
      })
    )
    expect(afterModelSkip.currentStepId).toBe('mcp')
    expect(afterModelSkip.steps.find((step) => step.id === 'provider-model')).toEqual(
      expect.objectContaining({
        status: 'skipped',
        skippedAt: 403
      })
    )
    expect(afterMcp.currentStepId).toBe('skills')
    expect(afterSkills.currentStepId).toBe('switch-agent')
  })

  it('falls back to the next pending step when start targets a terminal step', () => {
    const { presenter } = createConfigPresenter()

    startGuidedOnboarding(presenter, {}, 450)
    setGuidedOnboardingStepStatus(
      presenter,
      { stepId: 'select-provider', status: 'completed' },
      451
    )
    setGuidedOnboardingStepStatus(presenter, { stepId: 'provider-api-key', status: 'skipped' }, 452)

    const state = startGuidedOnboarding(presenter, { stepId: 'provider-api-key' }, 453)

    expect(state.currentStepId).toBe('provider-model')
    expect(state.steps.find((step) => step.id === 'provider-model')).toEqual(
      expect.objectContaining({ status: 'in_progress' })
    )
  })

  it('completes onboarding and marks remaining optional steps skipped', () => {
    const { presenter, store } = createConfigPresenter()

    startGuidedOnboarding(presenter, {}, 500)
    setGuidedOnboardingStepStatus(
      presenter,
      { stepId: 'select-provider', status: 'completed' },
      501
    )
    setGuidedOnboardingStepStatus(presenter, { stepId: 'provider-api-key', status: 'skipped' }, 502)
    setGuidedOnboardingStepStatus(presenter, { stepId: 'provider-model', status: 'skipped' }, 503)
    setGuidedOnboardingStepStatus(presenter, { stepId: 'mcp', status: 'skipped' }, 504)
    setGuidedOnboardingStepStatus(presenter, { stepId: 'skills', status: 'skipped' }, 505)
    setGuidedOnboardingStepStatus(presenter, { stepId: 'switch-agent', status: 'completed' }, 506)
    setGuidedOnboardingStepStatus(presenter, { stepId: 'switch-model', status: 'completed' }, 507)
    setGuidedOnboardingStepStatus(presenter, { stepId: 'first-chat', status: 'completed' }, 508)

    const state = completeGuidedOnboarding(presenter, 509)

    expect(state.status).toBe('completed')
    expect(state.currentStepId).toBeNull()
    expect(state.completedAt).toBe(509)
    expect(
      state.steps.filter((step) => !step.required).every((step) => step.status === 'skipped')
    ).toBe(true)
    expect(store.get('init_complete')).toBe(true)
  })

  it('migrates the legacy provider and chat flow into the new eight-step sequence', () => {
    const { presenter, store } = createConfigPresenter()

    store.set(GUIDED_ONBOARDING_STATE_KEY, {
      version: 1,
      status: 'active',
      startedAt: 10,
      completedAt: null,
      lastActiveAt: 20,
      currentStepId: 'switch-model',
      steps: [
        {
          id: 'provider',
          required: true,
          status: 'completed',
          startedAt: 10,
          completedAt: 11,
          skippedAt: null
        },
        {
          id: 'mcp',
          required: false,
          status: 'skipped',
          startedAt: 12,
          completedAt: null,
          skippedAt: 13
        },
        {
          id: 'skills',
          required: false,
          status: 'completed',
          startedAt: 14,
          completedAt: 15,
          skippedAt: null
        },
        {
          id: 'plugins',
          required: false,
          status: 'skipped',
          startedAt: null,
          completedAt: null,
          skippedAt: 16
        },
        {
          id: 'switch-model',
          required: true,
          status: 'in_progress',
          startedAt: 17,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'first-chat',
          required: true,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        }
      ]
    })

    const state = readGuidedOnboardingState(presenter, 600)

    expect(state.version).toBe(4)
    expect(state.currentStepId).toBe('switch-agent')
    expect(state.steps.find((step) => step.id === 'select-provider')).toEqual(
      expect.objectContaining({ status: 'completed' })
    )
    expect(state.steps.find((step) => step.id === 'provider-api-key')).toEqual(
      expect.objectContaining({ status: 'completed' })
    )
    expect(state.steps.find((step) => step.id === 'provider-model')).toEqual(
      expect.objectContaining({ status: 'completed' })
    )
    expect(state.steps.find((step) => step.id === 'mcp')).toEqual(
      expect.objectContaining({ status: 'skipped' })
    )
    expect(state.steps.find((step) => step.id === 'skills')).toEqual(
      expect.objectContaining({ status: 'completed' })
    )
    expect(state.steps.find((step) => step.id === 'switch-agent')).toEqual(
      expect.objectContaining({ status: 'in_progress' })
    )
    expect(state.steps.find((step) => step.id === 'switch-model')).toEqual(
      expect.objectContaining({ status: 'pending' })
    )
  })

  it('migrates version 3 provider progress by inserting the provider-model step', () => {
    const { presenter, store } = createConfigPresenter()

    store.set(GUIDED_ONBOARDING_STATE_KEY, {
      version: 3,
      status: 'active',
      startedAt: 100,
      completedAt: null,
      lastActiveAt: 120,
      currentStepId: 'mcp',
      steps: [
        {
          id: 'select-provider',
          required: true,
          status: 'completed',
          startedAt: 100,
          completedAt: 101,
          skippedAt: null
        },
        {
          id: 'provider-api-key',
          required: false,
          status: 'completed',
          startedAt: 102,
          completedAt: 103,
          skippedAt: null
        },
        {
          id: 'mcp',
          required: false,
          status: 'in_progress',
          startedAt: 104,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'skills',
          required: false,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'switch-agent',
          required: true,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'switch-model',
          required: true,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        },
        {
          id: 'first-chat',
          required: true,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          skippedAt: null
        }
      ]
    })

    const state = readGuidedOnboardingState(presenter, 700)

    expect(state.version).toBe(4)
    expect(state.currentStepId).toBe('mcp')
    expect(state.steps.find((step) => step.id === 'provider-model')).toEqual(
      expect.objectContaining({ status: 'completed' })
    )
  })

  it('resets onboarding without clearing init_complete', () => {
    const { presenter, store } = createConfigPresenter()

    store.set('init_complete', true)
    startGuidedOnboarding(presenter, {}, 600)

    const state = resetGuidedOnboarding(presenter, 601)

    expect(state.status).toBe('idle')
    expect(state.currentStepId).toBeNull()
    expect(store.get('init_complete')).toBe(true)
  })
})
