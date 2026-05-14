export const GUIDED_ONBOARDING_VERSION = 4 as const

export const GUIDED_ONBOARDING_STEP_IDS = [
  'select-provider',
  'provider-api-key',
  'provider-model',
  'mcp',
  'skills',
  'switch-agent',
  'switch-model',
  'first-chat'
] as const

export const LEGACY_GUIDED_ONBOARDING_STEP_IDS = [
  'provider',
  'mcp',
  'skills',
  'plugins',
  'switch-model',
  'first-chat'
] as const

export type SharedGuidedOnboardingStepId = (typeof GUIDED_ONBOARDING_STEP_IDS)[number]
export type LegacyGuidedOnboardingStepId = (typeof LEGACY_GUIDED_ONBOARDING_STEP_IDS)[number]

export type GuidedOnboardingSettingsRouteName =
  | 'settings-provider'
  | 'settings-mcp'
  | 'settings-skills'

export type GuidedOnboardingStepTargetSurface = 'welcome' | 'settings' | 'chat'

export type GuidedOnboardingStepTarget = {
  stepId: SharedGuidedOnboardingStepId
  surface: GuidedOnboardingStepTargetSurface
  routeName: GuidedOnboardingSettingsRouteName | null
}

export const GUIDED_ONBOARDING_REQUIRED_STEP_IDS = [
  'select-provider',
  'switch-agent',
  'switch-model',
  'first-chat'
] as const

export const GUIDED_ONBOARDING_SKIPPABLE_STEP_IDS = [
  'provider-api-key',
  'provider-model',
  'mcp',
  'skills'
] as const

const GUIDED_ONBOARDING_SETTINGS_ROUTE_NAMES = {
  'select-provider': 'settings-provider',
  'provider-api-key': 'settings-provider',
  'provider-model': 'settings-provider',
  mcp: 'settings-mcp',
  skills: 'settings-skills'
} as const satisfies Partial<
  Record<SharedGuidedOnboardingStepId, GuidedOnboardingSettingsRouteName>
>

const GUIDED_ONBOARDING_CHAT_STEP_ID_SET = new Set<SharedGuidedOnboardingStepId>([
  'switch-agent',
  'switch-model',
  'first-chat'
])

const GUIDED_ONBOARDING_REQUIRED_STEP_ID_SET = new Set<SharedGuidedOnboardingStepId>(
  GUIDED_ONBOARDING_REQUIRED_STEP_IDS
)

const GUIDED_ONBOARDING_SKIPPABLE_STEP_ID_SET = new Set<SharedGuidedOnboardingStepId>(
  GUIDED_ONBOARDING_SKIPPABLE_STEP_IDS
)

export const isGuidedOnboardingStepId = (value: unknown): value is SharedGuidedOnboardingStepId =>
  typeof value === 'string' &&
  GUIDED_ONBOARDING_STEP_IDS.includes(value as SharedGuidedOnboardingStepId)

export const isLegacyGuidedOnboardingStepId = (
  value: unknown
): value is LegacyGuidedOnboardingStepId =>
  typeof value === 'string' &&
  LEGACY_GUIDED_ONBOARDING_STEP_IDS.includes(value as LegacyGuidedOnboardingStepId)

export const isGuidedOnboardingRequiredStepId = (
  stepId: SharedGuidedOnboardingStepId | null | undefined
): stepId is SharedGuidedOnboardingStepId =>
  Boolean(stepId && GUIDED_ONBOARDING_REQUIRED_STEP_ID_SET.has(stepId))

export const isGuidedOnboardingSkippableStepId = (
  stepId: SharedGuidedOnboardingStepId | null | undefined
): stepId is SharedGuidedOnboardingStepId =>
  Boolean(stepId && GUIDED_ONBOARDING_SKIPPABLE_STEP_ID_SET.has(stepId))

export const isGuidedOnboardingChatStepId = (
  stepId: SharedGuidedOnboardingStepId | null | undefined
): stepId is SharedGuidedOnboardingStepId =>
  Boolean(stepId && GUIDED_ONBOARDING_CHAT_STEP_ID_SET.has(stepId))

export const isGuidedOnboardingSettingsStepId = (
  stepId: SharedGuidedOnboardingStepId | null | undefined
): stepId is keyof typeof GUIDED_ONBOARDING_SETTINGS_ROUTE_NAMES =>
  Boolean(
    stepId && Object.prototype.hasOwnProperty.call(GUIDED_ONBOARDING_SETTINGS_ROUTE_NAMES, stepId)
  )

export const resolveGuidedOnboardingSettingsRouteName = (
  stepId: SharedGuidedOnboardingStepId | null | undefined
): GuidedOnboardingSettingsRouteName | null => {
  if (!isGuidedOnboardingSettingsStepId(stepId)) {
    return null
  }

  return GUIDED_ONBOARDING_SETTINGS_ROUTE_NAMES[stepId]
}

export const resolveGuidedOnboardingStepTarget = (
  stepId: SharedGuidedOnboardingStepId | null | undefined
): GuidedOnboardingStepTarget | null => {
  if (!stepId) {
    return null
  }

  const routeName = resolveGuidedOnboardingSettingsRouteName(stepId)
  if (routeName) {
    return {
      stepId,
      surface: 'settings',
      routeName
    }
  }

  if (isGuidedOnboardingChatStepId(stepId)) {
    return {
      stepId,
      surface: 'chat',
      routeName: null
    }
  }

  return null
}

export const getGuidedOnboardingStepIndex = (
  stepId: SharedGuidedOnboardingStepId | null | undefined
): number => {
  if (!stepId) {
    return -1
  }

  return GUIDED_ONBOARDING_STEP_IDS.indexOf(stepId)
}

export const getPreviousGuidedOnboardingStepId = (
  stepId: SharedGuidedOnboardingStepId | null | undefined
): SharedGuidedOnboardingStepId | null => {
  const index = getGuidedOnboardingStepIndex(stepId)
  return index > 0 ? GUIDED_ONBOARDING_STEP_IDS[index - 1] : null
}

export const getNextGuidedOnboardingStepId = (
  stepId: SharedGuidedOnboardingStepId | null | undefined
): SharedGuidedOnboardingStepId | null => {
  const index = getGuidedOnboardingStepIndex(stepId)
  return index >= 0 && index < GUIDED_ONBOARDING_STEP_IDS.length - 1
    ? GUIDED_ONBOARDING_STEP_IDS[index + 1]
    : null
}

export const resolveCurrentGuidedOnboardingStepId = <
  TStepStatus extends { id: SharedGuidedOnboardingStepId; status: string }
>(
  state:
    | {
        currentStepId: SharedGuidedOnboardingStepId | null
        steps: TStepStatus[]
      }
    | null
    | undefined
): SharedGuidedOnboardingStepId | null => {
  if (state?.currentStepId) {
    return state.currentStepId
  }

  const fallbackStep =
    state?.steps.find((step) => step.status === 'in_progress') ??
    state?.steps.find((step) => step.status === 'pending')

  return fallbackStep?.id ?? null
}
