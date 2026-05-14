import { guidedOnboardingStepIds, type GuidedOnboardingStepId } from '@shared/contracts/routes'

export const GUIDED_ONBOARDING_RESUME_STORAGE_KEY = '__deepchat_guided_onboarding_resume'
export const GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT =
  'deepchat:guided-onboarding-resume-requested'

const GUIDED_ONBOARDING_STEP_IDS: GuidedOnboardingStepId[] = [...guidedOnboardingStepIds]

const GUIDED_ONBOARDING_RESUME_TRIGGERS = ['window-focus', 'step-completed'] as const

export type GuidedOnboardingResumeTrigger = (typeof GUIDED_ONBOARDING_RESUME_TRIGGERS)[number]

export type GuidedOnboardingResumeIntent = {
  stepId: GuidedOnboardingStepId
  trigger: GuidedOnboardingResumeTrigger
  createdAt: number
}

export type GuidedOnboardingResumeRequestDetail = {
  trigger: GuidedOnboardingResumeTrigger
}

const canUseSessionStorage = () =>
  typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'

const isGuidedOnboardingStepId = (value: unknown): value is GuidedOnboardingStepId =>
  typeof value === 'string' && GUIDED_ONBOARDING_STEP_IDS.includes(value as GuidedOnboardingStepId)

const isGuidedOnboardingResumeTrigger = (value: unknown): value is GuidedOnboardingResumeTrigger =>
  typeof value === 'string' &&
  GUIDED_ONBOARDING_RESUME_TRIGGERS.includes(value as GuidedOnboardingResumeTrigger)

export function readGuidedOnboardingResumeIntent(): GuidedOnboardingResumeIntent | null {
  if (!canUseSessionStorage()) {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<GuidedOnboardingResumeIntent>
    if (
      !isGuidedOnboardingStepId(parsed.stepId) ||
      !isGuidedOnboardingResumeTrigger(parsed.trigger)
    ) {
      return null
    }

    return {
      stepId: parsed.stepId,
      trigger: parsed.trigger,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now()
    }
  } catch {
    return null
  }
}

export function persistGuidedOnboardingResumeIntent(input: {
  stepId: GuidedOnboardingStepId
  trigger: GuidedOnboardingResumeTrigger
}) {
  if (!canUseSessionStorage()) {
    return
  }

  try {
    window.sessionStorage.setItem(
      GUIDED_ONBOARDING_RESUME_STORAGE_KEY,
      JSON.stringify({
        ...input,
        createdAt: Date.now()
      } satisfies GuidedOnboardingResumeIntent)
    )
  } catch {
    // Ignore storage write failures in non-persistent environments.
  }
}

export function clearGuidedOnboardingResumeIntent() {
  if (!canUseSessionStorage()) {
    return
  }

  try {
    window.sessionStorage.removeItem(GUIDED_ONBOARDING_RESUME_STORAGE_KEY)
  } catch {
    // Ignore storage cleanup failures in non-persistent environments.
  }
}

export function requestGuidedOnboardingResume(trigger: GuidedOnboardingResumeTrigger) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent<GuidedOnboardingResumeRequestDetail>(GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT, {
      detail: { trigger }
    })
  )
}
