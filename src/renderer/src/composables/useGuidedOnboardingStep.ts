import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createOnboardingClient } from '@api/OnboardingClient'
import {
  GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT,
  requestGuidedOnboardingResume
} from '@/lib/onboardingResume'
import {
  getNextGuidedOnboardingStepId,
  getPreviousGuidedOnboardingStepId
} from '@shared/guidedOnboarding'
import type {
  GuidedOnboardingState,
  GuidedOnboardingStepId,
  GuidedOnboardingStepStatus
} from '@shared/contracts/routes'

export function useGuidedOnboardingStep(stepId: GuidedOnboardingStepId) {
  const onboardingClient = createOnboardingClient()
  const onboardingState = ref<GuidedOnboardingState | null>(null)
  const dismissed = ref(false)
  const stepState = computed(
    () => onboardingState.value?.steps.find((step) => step.id === stepId) ?? null
  )

  const currentStepId = computed<GuidedOnboardingStepId | null>(() => {
    if (onboardingState.value?.currentStepId) {
      return onboardingState.value.currentStepId
    }

    return onboardingState.value?.steps.find((step) => step.status === 'pending')?.id ?? null
  })
  const stepIndex = computed(() => {
    const index = onboardingState.value?.steps.findIndex((step) => step.id === stepId) ?? -1
    return index >= 0 ? index + 1 : 1
  })
  const totalSteps = computed(() => onboardingState.value?.steps.length ?? 1)
  const previousStepId = computed(() => getPreviousGuidedOnboardingStepId(stepId))
  const nextStepId = computed(() => getNextGuidedOnboardingStepId(stepId))
  const isRequired = computed(() => stepState.value?.required ?? false)
  const canSkip = computed(() => Boolean(stepState.value && !stepState.value.required))
  const canGoPrevious = computed(() => Boolean(previousStepId.value))
  const canGoNext = computed(() => Boolean(nextStepId.value))
  const showGuide = computed(
    () =>
      onboardingState.value?.status === 'active' &&
      currentStepId.value === stepId &&
      !dismissed.value
  )

  const finalizeIfNeeded = async (state: GuidedOnboardingState | null) => {
    if (
      state?.status === 'active' &&
      (state.currentStepId === null || state.currentStepId === undefined)
    ) {
      try {
        onboardingState.value = await onboardingClient.complete()
      } catch (error) {
        console.warn(`[GuidedOnboarding] Failed to finalize onboarding from step ${stepId}:`, error)
      }
    }

    return onboardingState.value
  }

  const syncState = async () => {
    try {
      onboardingState.value = await onboardingClient.getState()
    } catch (error) {
      console.warn(`[GuidedOnboarding] Failed to sync step ${stepId}:`, error)
    }
  }

  const recoverStateFromBackend = async (
    context: string
  ): Promise<GuidedOnboardingState | null> => {
    try {
      const refreshed = await onboardingClient.getState()
      onboardingState.value = refreshed
      return refreshed
    } catch (error) {
      console.warn(`[GuidedOnboarding] Failed to recover state after ${context}:`, error)
      return onboardingState.value
    }
  }

  const dismissGuide = () => {
    dismissed.value = true
  }

  const notifySiblingGuides = () => {
    requestGuidedOnboardingResume('step-completed')
  }

  const setStepStatus = async (
    status: Extract<GuidedOnboardingStepStatus, 'completed' | 'skipped'>
  ) => {
    try {
      onboardingState.value = await onboardingClient.setStepStatus({
        stepId,
        status
      })
      dismissed.value = false
      notifySiblingGuides()
      return finalizeIfNeeded(onboardingState.value)
    } catch (error) {
      console.warn(`[GuidedOnboarding] Failed to set step ${stepId} status to ${status}:`, error)
      return recoverStateFromBackend(`setStepStatus(${stepId}, ${status})`)
    }
  }

  const activateStep = async (targetStepId: GuidedOnboardingStepId) => {
    try {
      onboardingState.value = await onboardingClient.start({ stepId: targetStepId })
      dismissed.value = false
      notifySiblingGuides()
      return onboardingState.value
    } catch (error) {
      console.warn(`[GuidedOnboarding] Failed to activate step ${targetStepId}:`, error)
      return recoverStateFromBackend(`activateStep(${targetStepId})`)
    }
  }

  const activatePreviousStep = async () => {
    if (!previousStepId.value) {
      return onboardingState.value
    }

    return activateStep(previousStepId.value)
  }

  const activateNextStep = async () => {
    if (!nextStepId.value) {
      return onboardingState.value
    }

    return activateStep(nextStepId.value)
  }

  const forceComplete = async () => {
    try {
      onboardingState.value = await onboardingClient.complete({ force: true })
      dismissed.value = false
      notifySiblingGuides()
      return onboardingState.value
    } catch (error) {
      console.warn(`[GuidedOnboarding] Failed to force complete onboarding from ${stepId}:`, error)
      return recoverStateFromBackend(`forceComplete(${stepId})`)
    }
  }

  const completeStep = () => setStepStatus('completed')
  const skipStep = async () => {
    if (!canSkip.value) {
      return onboardingState.value
    }
    return setStepStatus('skipped')
  }

  const handleResumeRequested = () => {
    void syncState()
  }

  watch(
    () => currentStepId.value,
    (nextStepId, previousStepId) => {
      if (nextStepId !== previousStepId) {
        dismissed.value = false
      }
    }
  )

  onMounted(() => {
    void syncState()
    window.addEventListener(
      GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT,
      handleResumeRequested as EventListener
    )
  })

  onBeforeUnmount(() => {
    window.removeEventListener(
      GUIDED_ONBOARDING_RESUME_REQUESTED_EVENT,
      handleResumeRequested as EventListener
    )
  })

  return {
    onboardingState,
    currentStepId,
    stepState,
    stepIndex,
    totalSteps,
    previousStepId,
    nextStepId,
    isRequired,
    canSkip,
    canGoPrevious,
    canGoNext,
    showGuide,
    dismissGuide,
    completeStep,
    skipStep,
    activateStep,
    activatePreviousStep,
    activateNextStep,
    forceComplete,
    setStepStatus,
    syncState
  }
}
