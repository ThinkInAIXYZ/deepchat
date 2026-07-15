import type { IConfigPresenter } from '@shared/presenter'
import type {
  GuidedOnboardingState,
  GuidedOnboardingStepId,
  GuidedOnboardingStepState
} from '@shared/contracts/routes'
import {
  guidedOnboardingStateSchema,
  guidedOnboardingStepIds,
  guidedOnboardingVersion
} from '@shared/contracts/routes'
import {
  GUIDED_ONBOARDING_STEP_IDS as SHARED_GUIDED_ONBOARDING_STEP_IDS,
  LEGACY_GUIDED_ONBOARDING_STEP_IDS,
  isLegacyGuidedOnboardingStepId,
  isGuidedOnboardingRequiredStepId,
  type LegacyGuidedOnboardingStepId
} from '@shared/guidedOnboarding'

export const GUIDED_ONBOARDING_STATE_KEY = 'guidedOnboardingState'

export const GUIDED_ONBOARDING_STEP_IDS: GuidedOnboardingStepId[] = [...guidedOnboardingStepIds]

type LegacyGuidedOnboardingStepState = Omit<GuidedOnboardingStepState, 'id' | 'required'> & {
  id: LegacyGuidedOnboardingStepId
}

type PreviousGuidedOnboardingStepId =
  | 'open-settings'
  | 'select-provider'
  | 'provider-api-key'
  | 'mcp'
  | 'skills'
  | 'switch-agent'
  | 'switch-model'
  | 'first-chat'

type PreviousGuidedOnboardingStepState = Omit<GuidedOnboardingStepState, 'id' | 'required'> & {
  id: PreviousGuidedOnboardingStepId
}

type Version3GuidedOnboardingStepId =
  | 'select-provider'
  | 'provider-api-key'
  | 'mcp'
  | 'skills'
  | 'switch-agent'
  | 'switch-model'
  | 'first-chat'

type Version3GuidedOnboardingStepState = Omit<GuidedOnboardingStepState, 'id' | 'required'> & {
  id: Version3GuidedOnboardingStepId
}

type StoredGuidedOnboardingStateCandidate = Omit<
  Partial<GuidedOnboardingState>,
  'version' | 'currentStepId' | 'steps'
> & {
  version?: number
  currentStepId?: unknown
  steps?: unknown
}

type ConfigPresenterPort = Pick<IConfigPresenter, 'getSetting' | 'setSetting'>

const createDefaultStepState = (id: GuidedOnboardingStepId): GuidedOnboardingStepState => ({
  id,
  required: isGuidedOnboardingRequiredStepId(id),
  status: 'pending',
  startedAt: null,
  completedAt: null,
  skippedAt: null
})

const createLegacyDefaultStepState = (
  id: LegacyGuidedOnboardingStepId
): LegacyGuidedOnboardingStepState => ({
  id,
  status: 'pending',
  startedAt: null,
  completedAt: null,
  skippedAt: null
})

const PREVIOUS_GUIDED_ONBOARDING_STEP_IDS = [
  'open-settings',
  'select-provider',
  'provider-api-key',
  'mcp',
  'skills',
  'switch-agent',
  'switch-model',
  'first-chat'
] as const satisfies readonly PreviousGuidedOnboardingStepId[]

const VERSION3_GUIDED_ONBOARDING_STEP_IDS = [
  'select-provider',
  'provider-api-key',
  'mcp',
  'skills',
  'switch-agent',
  'switch-model',
  'first-chat'
] as const satisfies readonly Version3GuidedOnboardingStepId[]

const isPreviousGuidedOnboardingStepId = (
  value: unknown
): value is PreviousGuidedOnboardingStepId =>
  typeof value === 'string' &&
  PREVIOUS_GUIDED_ONBOARDING_STEP_IDS.includes(value as PreviousGuidedOnboardingStepId)

const isVersion3GuidedOnboardingStepId = (
  value: unknown
): value is Version3GuidedOnboardingStepId =>
  typeof value === 'string' &&
  VERSION3_GUIDED_ONBOARDING_STEP_IDS.includes(value as Version3GuidedOnboardingStepId)

const createDefaultState = (now: number): GuidedOnboardingState => ({
  version: guidedOnboardingVersion,
  status: 'idle',
  startedAt: null,
  completedAt: null,
  lastActiveAt: now,
  currentStepId: null,
  steps: GUIDED_ONBOARDING_STEP_IDS.map((id) => createDefaultStepState(id))
})

const resolveStepMap = <TStepId extends string>(
  stepIds: readonly TStepId[],
  storedSteps: unknown
): Map<TStepId, Partial<GuidedOnboardingStepState>> => {
  if (!Array.isArray(storedSteps)) {
    return new Map()
  }

  return storedSteps.reduce<Map<TStepId, Partial<GuidedOnboardingStepState>>>((acc, candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return acc
    }

    const stepId = (candidate as { id?: unknown }).id
    if (!stepIds.includes(stepId as TStepId)) {
      return acc
    }

    acc.set(stepId as TStepId, candidate as Partial<GuidedOnboardingStepState>)
    return acc
  }, new Map())
}

const normalizeStepState = (
  stepId: GuidedOnboardingStepId,
  stored: Partial<GuidedOnboardingStepState> | undefined
): GuidedOnboardingStepState => {
  const fallback = createDefaultStepState(stepId)
  const status =
    stored?.status === 'pending' ||
    stored?.status === 'in_progress' ||
    stored?.status === 'completed' ||
    stored?.status === 'skipped'
      ? stored.status
      : fallback.status

  const timestampOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

  return {
    id: stepId,
    required: isGuidedOnboardingRequiredStepId(stepId),
    status,
    startedAt: timestampOrNull(stored?.startedAt),
    completedAt: timestampOrNull(stored?.completedAt),
    skippedAt: timestampOrNull(stored?.skippedAt)
  }
}

const normalizeLegacyStepState = (
  stepId: LegacyGuidedOnboardingStepId,
  stored: Partial<GuidedOnboardingStepState> | undefined
): LegacyGuidedOnboardingStepState => {
  const fallback = createLegacyDefaultStepState(stepId)
  const status =
    stored?.status === 'pending' ||
    stored?.status === 'in_progress' ||
    stored?.status === 'completed' ||
    stored?.status === 'skipped'
      ? stored.status
      : fallback.status

  const timestampOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

  return {
    id: stepId,
    status,
    startedAt: timestampOrNull(stored?.startedAt),
    completedAt: timestampOrNull(stored?.completedAt),
    skippedAt: timestampOrNull(stored?.skippedAt)
  }
}

const normalizePreviousStepState = (
  stepId: PreviousGuidedOnboardingStepId,
  stored: Partial<GuidedOnboardingStepState> | undefined
): PreviousGuidedOnboardingStepState => {
  const fallback = createDefaultStepState(stepId === 'open-settings' ? 'select-provider' : stepId)
  const status =
    stored?.status === 'pending' ||
    stored?.status === 'in_progress' ||
    stored?.status === 'completed' ||
    stored?.status === 'skipped'
      ? stored.status
      : fallback.status

  const timestampOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

  return {
    id: stepId,
    status,
    startedAt: timestampOrNull(stored?.startedAt),
    completedAt: timestampOrNull(stored?.completedAt),
    skippedAt: timestampOrNull(stored?.skippedAt)
  }
}

const normalizeVersion3StepState = (
  stepId: Version3GuidedOnboardingStepId,
  stored: Partial<GuidedOnboardingStepState> | undefined
): Version3GuidedOnboardingStepState => {
  const fallback = createDefaultStepState(stepId)
  const status =
    stored?.status === 'pending' ||
    stored?.status === 'in_progress' ||
    stored?.status === 'completed' ||
    stored?.status === 'skipped'
      ? stored.status
      : fallback.status

  const timestampOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

  return {
    id: stepId,
    status,
    startedAt: timestampOrNull(stored?.startedAt),
    completedAt: timestampOrNull(stored?.completedAt),
    skippedAt: timestampOrNull(stored?.skippedAt)
  }
}

const cloneStepStatus = (
  step: Pick<GuidedOnboardingStepState, 'startedAt' | 'completedAt' | 'skippedAt'>,
  status: GuidedOnboardingStepState['status']
): Partial<GuidedOnboardingStepState> => ({
  status,
  startedAt: step.startedAt,
  completedAt: status === 'completed' ? (step.completedAt ?? step.startedAt) : null,
  skippedAt: status === 'skipped' ? (step.skippedAt ?? step.completedAt ?? step.startedAt) : null
})

const setStepState = (
  stepMap: Map<GuidedOnboardingStepId, GuidedOnboardingStepState>,
  stepId: GuidedOnboardingStepId,
  overrides: Partial<GuidedOnboardingStepState>
) => {
  stepMap.set(stepId, {
    ...(stepMap.get(stepId) ?? createDefaultStepState(stepId)),
    ...overrides
  })
}

const migratePreviousState = (
  candidate: StoredGuidedOnboardingStateCandidate,
  now: number
): GuidedOnboardingState => {
  const fallback = createDefaultState(now)
  const previousStepMap = resolveStepMap(PREVIOUS_GUIDED_ONBOARDING_STEP_IDS, candidate.steps)
  const previousSteps = {
    'open-settings': normalizePreviousStepState(
      'open-settings',
      previousStepMap.get('open-settings')
    ),
    'select-provider': normalizePreviousStepState(
      'select-provider',
      previousStepMap.get('select-provider')
    ),
    'provider-api-key': normalizePreviousStepState(
      'provider-api-key',
      previousStepMap.get('provider-api-key')
    ),
    mcp: normalizePreviousStepState('mcp', previousStepMap.get('mcp')),
    skills: normalizePreviousStepState('skills', previousStepMap.get('skills')),
    'switch-agent': normalizePreviousStepState('switch-agent', previousStepMap.get('switch-agent')),
    'switch-model': normalizePreviousStepState('switch-model', previousStepMap.get('switch-model')),
    'first-chat': normalizePreviousStepState('first-chat', previousStepMap.get('first-chat'))
  }
  const status =
    candidate.status === 'active' || candidate.status === 'completed' || candidate.status === 'idle'
      ? candidate.status
      : fallback.status
  const previousCurrentStepId = isPreviousGuidedOnboardingStepId(candidate.currentStepId)
    ? candidate.currentStepId
    : null
  const steps = new Map<GuidedOnboardingStepId, GuidedOnboardingStepState>(
    GUIDED_ONBOARDING_STEP_IDS.map((stepId) => [stepId, createDefaultStepState(stepId)])
  )
  const laterProgressExists = [
    previousSteps['provider-api-key'],
    previousSteps.mcp,
    previousSteps.skills,
    previousSteps['switch-agent'],
    previousSteps['switch-model'],
    previousSteps['first-chat']
  ].some((step) => step.status !== 'pending')
  const progressedPastProviderModel =
    status === 'completed' ||
    previousCurrentStepId === 'mcp' ||
    previousCurrentStepId === 'skills' ||
    previousCurrentStepId === 'switch-agent' ||
    previousCurrentStepId === 'switch-model' ||
    previousCurrentStepId === 'first-chat' ||
    previousSteps.mcp.status !== 'pending' ||
    previousSteps.skills.status !== 'pending' ||
    previousSteps['switch-agent'].status !== 'pending' ||
    previousSteps['switch-model'].status !== 'pending' ||
    previousSteps['first-chat'].status !== 'pending'

  if (previousSteps['select-provider'].status !== 'pending') {
    setStepState(
      steps,
      'select-provider',
      cloneStepStatus(previousSteps['select-provider'], previousSteps['select-provider'].status)
    )
  } else if (laterProgressExists) {
    setStepState(steps, 'select-provider', {
      status: 'completed',
      startedAt:
        previousSteps['select-provider'].startedAt ??
        previousSteps['open-settings'].startedAt ??
        candidate.startedAt ??
        now,
      completedAt:
        previousSteps['open-settings'].completedAt ??
        previousSteps['select-provider'].completedAt ??
        previousSteps['select-provider'].startedAt ??
        previousSteps['open-settings'].startedAt ??
        candidate.startedAt ??
        now,
      skippedAt: null
    })
  } else if (
    previousCurrentStepId === 'open-settings' ||
    previousCurrentStepId === 'select-provider' ||
    previousSteps['open-settings'].status === 'completed' ||
    previousSteps['open-settings'].status === 'in_progress'
  ) {
    setStepState(steps, 'select-provider', {
      status: 'in_progress',
      startedAt:
        previousSteps['select-provider'].startedAt ??
        previousSteps['open-settings'].startedAt ??
        previousSteps['open-settings'].completedAt ??
        candidate.startedAt ??
        now,
      completedAt: null,
      skippedAt: null
    })
  }

  if (progressedPastProviderModel) {
    setStepState(steps, 'provider-model', {
      status: 'completed',
      startedAt:
        previousSteps['provider-api-key'].completedAt ??
        previousSteps['provider-api-key'].startedAt ??
        previousSteps['select-provider'].completedAt ??
        candidate.startedAt ??
        now,
      completedAt:
        previousSteps['provider-api-key'].completedAt ??
        previousSteps['provider-api-key'].skippedAt ??
        previousSteps['provider-api-key'].startedAt ??
        previousSteps['select-provider'].completedAt ??
        candidate.startedAt ??
        now,
      skippedAt: null
    })
  }

  for (const stepId of [
    'provider-api-key',
    'mcp',
    'skills',
    'switch-agent',
    'switch-model',
    'first-chat'
  ] as const) {
    const step = previousSteps[stepId]
    if (step.status === 'pending') {
      continue
    }

    setStepState(steps, stepId, {
      status: step.status,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      skippedAt: step.skippedAt
    })
  }

  const nextStateBase: GuidedOnboardingState = {
    version: guidedOnboardingVersion,
    status,
    startedAt:
      typeof candidate.startedAt === 'number' &&
      Number.isFinite(candidate.startedAt) &&
      candidate.startedAt >= 0
        ? candidate.startedAt
        : null,
    completedAt:
      typeof candidate.completedAt === 'number' &&
      Number.isFinite(candidate.completedAt) &&
      candidate.completedAt >= 0
        ? candidate.completedAt
        : null,
    lastActiveAt:
      typeof candidate.lastActiveAt === 'number' &&
      Number.isFinite(candidate.lastActiveAt) &&
      candidate.lastActiveAt >= 0
        ? candidate.lastActiveAt
        : now,
    currentStepId: null,
    steps: GUIDED_ONBOARDING_STEP_IDS.map(
      (stepId) => steps.get(stepId) ?? createDefaultStepState(stepId)
    )
  }

  const currentStepId =
    status === 'completed'
      ? null
      : previousCurrentStepId === 'open-settings'
        ? 'select-provider'
        : previousCurrentStepId && GUIDED_ONBOARDING_STEP_IDS.includes(previousCurrentStepId)
          ? previousCurrentStepId
          : findNextPendingStepId(nextStateBase)

  return guidedOnboardingStateSchema.parse({
    ...nextStateBase,
    currentStepId
  })
}

const migrateVersion3State = (
  candidate: StoredGuidedOnboardingStateCandidate,
  now: number
): GuidedOnboardingState => {
  const fallback = createDefaultState(now)
  const version3StepMap = resolveStepMap(VERSION3_GUIDED_ONBOARDING_STEP_IDS, candidate.steps)
  const version3Steps = {
    'select-provider': normalizeVersion3StepState(
      'select-provider',
      version3StepMap.get('select-provider')
    ),
    'provider-api-key': normalizeVersion3StepState(
      'provider-api-key',
      version3StepMap.get('provider-api-key')
    ),
    mcp: normalizeVersion3StepState('mcp', version3StepMap.get('mcp')),
    skills: normalizeVersion3StepState('skills', version3StepMap.get('skills')),
    'switch-agent': normalizeVersion3StepState('switch-agent', version3StepMap.get('switch-agent')),
    'switch-model': normalizeVersion3StepState('switch-model', version3StepMap.get('switch-model')),
    'first-chat': normalizeVersion3StepState('first-chat', version3StepMap.get('first-chat'))
  }
  const status =
    candidate.status === 'active' || candidate.status === 'completed' || candidate.status === 'idle'
      ? candidate.status
      : fallback.status
  const version3CurrentStepId = isVersion3GuidedOnboardingStepId(candidate.currentStepId)
    ? candidate.currentStepId
    : null
  const steps = new Map<GuidedOnboardingStepId, GuidedOnboardingStepState>(
    GUIDED_ONBOARDING_STEP_IDS.map((stepId) => [stepId, createDefaultStepState(stepId)])
  )
  const progressedPastProviderModel =
    status === 'completed' ||
    version3CurrentStepId === 'mcp' ||
    version3CurrentStepId === 'skills' ||
    version3CurrentStepId === 'switch-agent' ||
    version3CurrentStepId === 'switch-model' ||
    version3CurrentStepId === 'first-chat' ||
    version3Steps.mcp.status !== 'pending' ||
    version3Steps.skills.status !== 'pending' ||
    version3Steps['switch-agent'].status !== 'pending' ||
    version3Steps['switch-model'].status !== 'pending' ||
    version3Steps['first-chat'].status !== 'pending'

  for (const stepId of VERSION3_GUIDED_ONBOARDING_STEP_IDS) {
    const step = version3Steps[stepId]
    if (step.status === 'pending') {
      continue
    }

    setStepState(steps, stepId, {
      status: step.status,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      skippedAt: step.skippedAt
    })
  }

  if (progressedPastProviderModel) {
    setStepState(steps, 'provider-model', {
      status: 'completed',
      startedAt:
        version3Steps['provider-api-key'].completedAt ??
        version3Steps['provider-api-key'].skippedAt ??
        version3Steps['provider-api-key'].startedAt ??
        version3Steps['select-provider'].completedAt ??
        candidate.startedAt ??
        now,
      completedAt:
        version3Steps['provider-api-key'].completedAt ??
        version3Steps['provider-api-key'].skippedAt ??
        version3Steps['provider-api-key'].startedAt ??
        version3Steps['select-provider'].completedAt ??
        candidate.startedAt ??
        now,
      skippedAt: null
    })
  }

  const nextStateBase: GuidedOnboardingState = {
    version: guidedOnboardingVersion,
    status,
    startedAt:
      typeof candidate.startedAt === 'number' &&
      Number.isFinite(candidate.startedAt) &&
      candidate.startedAt >= 0
        ? candidate.startedAt
        : null,
    completedAt:
      typeof candidate.completedAt === 'number' &&
      Number.isFinite(candidate.completedAt) &&
      candidate.completedAt >= 0
        ? candidate.completedAt
        : null,
    lastActiveAt:
      typeof candidate.lastActiveAt === 'number' &&
      Number.isFinite(candidate.lastActiveAt) &&
      candidate.lastActiveAt >= 0
        ? candidate.lastActiveAt
        : now,
    currentStepId: null,
    steps: GUIDED_ONBOARDING_STEP_IDS.map(
      (stepId) => steps.get(stepId) ?? createDefaultStepState(stepId)
    )
  }

  const currentStepId =
    status === 'completed'
      ? null
      : version3CurrentStepId && GUIDED_ONBOARDING_STEP_IDS.includes(version3CurrentStepId)
        ? version3CurrentStepId
        : findNextPendingStepId(nextStateBase)

  return guidedOnboardingStateSchema.parse({
    ...nextStateBase,
    currentStepId
  })
}

const migrateLegacyState = (
  candidate: StoredGuidedOnboardingStateCandidate,
  now: number
): GuidedOnboardingState => {
  const fallback = createDefaultState(now)
  const legacyStepMap = resolveStepMap(LEGACY_GUIDED_ONBOARDING_STEP_IDS, candidate.steps)
  const legacySteps = {
    provider: normalizeLegacyStepState('provider', legacyStepMap.get('provider')),
    mcp: normalizeLegacyStepState('mcp', legacyStepMap.get('mcp')),
    skills: normalizeLegacyStepState('skills', legacyStepMap.get('skills')),
    plugins: normalizeLegacyStepState('plugins', legacyStepMap.get('plugins')),
    'switch-model': normalizeLegacyStepState('switch-model', legacyStepMap.get('switch-model')),
    'first-chat': normalizeLegacyStepState('first-chat', legacyStepMap.get('first-chat'))
  }
  const status =
    candidate.status === 'active' || candidate.status === 'completed' || candidate.status === 'idle'
      ? candidate.status
      : fallback.status
  const legacyCurrentStepId = isLegacyGuidedOnboardingStepId(candidate.currentStepId)
    ? candidate.currentStepId
    : null
  const steps = new Map<GuidedOnboardingStepId, GuidedOnboardingStepState>(
    SHARED_GUIDED_ONBOARDING_STEP_IDS.map((stepId) => [stepId, createDefaultStepState(stepId)])
  )
  const providerStartedAt = legacySteps.provider.startedAt ?? candidate.startedAt ?? now
  const switchStartedAt = legacySteps['switch-model'].startedAt ?? candidate.startedAt ?? now

  if (
    status === 'completed' ||
    legacySteps.provider.status === 'completed' ||
    legacyCurrentStepId === 'mcp' ||
    legacyCurrentStepId === 'skills' ||
    legacyCurrentStepId === 'plugins' ||
    legacyCurrentStepId === 'switch-model' ||
    legacyCurrentStepId === 'first-chat' ||
    legacySteps.mcp.status !== 'pending' ||
    legacySteps.skills.status !== 'pending' ||
    legacySteps.plugins.status !== 'pending' ||
    legacySteps['switch-model'].status !== 'pending' ||
    legacySteps['first-chat'].status !== 'pending'
  ) {
    setStepState(steps, 'select-provider', cloneStepStatus(legacySteps.provider, 'completed'))
    setStepState(steps, 'provider-api-key', cloneStepStatus(legacySteps.provider, 'completed'))
    setStepState(steps, 'provider-model', cloneStepStatus(legacySteps.provider, 'completed'))
  } else if (legacyCurrentStepId === 'provider' || legacySteps.provider.status === 'in_progress') {
    setStepState(steps, 'select-provider', {
      status: 'in_progress',
      startedAt: providerStartedAt,
      completedAt: null,
      skippedAt: null
    })
  }

  for (const stepId of ['mcp', 'skills'] as const) {
    const legacyStep = legacySteps[stepId]
    if (legacyStep.status !== 'pending') {
      setStepState(steps, stepId, cloneStepStatus(legacyStep, legacyStep.status))
    }
  }

  if (
    status === 'completed' ||
    legacySteps['switch-model'].status === 'completed' ||
    legacyCurrentStepId === 'first-chat' ||
    legacySteps['first-chat'].status !== 'pending'
  ) {
    setStepState(steps, 'switch-agent', cloneStepStatus(legacySteps['switch-model'], 'completed'))
    setStepState(steps, 'switch-model', cloneStepStatus(legacySteps['switch-model'], 'completed'))
  } else if (
    legacyCurrentStepId === 'switch-model' ||
    legacyCurrentStepId === 'plugins' ||
    legacySteps['switch-model'].status === 'in_progress'
  ) {
    setStepState(steps, 'switch-agent', {
      status: 'in_progress',
      startedAt: switchStartedAt,
      completedAt: null,
      skippedAt: null
    })
  }

  if (legacySteps['first-chat'].status !== 'pending') {
    setStepState(
      steps,
      'first-chat',
      cloneStepStatus(legacySteps['first-chat'], legacySteps['first-chat'].status)
    )
  }

  const nextStateBase: GuidedOnboardingState = {
    version: guidedOnboardingVersion,
    status,
    startedAt:
      typeof candidate.startedAt === 'number' &&
      Number.isFinite(candidate.startedAt) &&
      candidate.startedAt >= 0
        ? candidate.startedAt
        : null,
    completedAt:
      typeof candidate.completedAt === 'number' &&
      Number.isFinite(candidate.completedAt) &&
      candidate.completedAt >= 0
        ? candidate.completedAt
        : null,
    lastActiveAt:
      typeof candidate.lastActiveAt === 'number' &&
      Number.isFinite(candidate.lastActiveAt) &&
      candidate.lastActiveAt >= 0
        ? candidate.lastActiveAt
        : now,
    currentStepId: null,
    steps: SHARED_GUIDED_ONBOARDING_STEP_IDS.map(
      (stepId) => steps.get(stepId) ?? createDefaultStepState(stepId)
    )
  }

  const currentStepId =
    status === 'completed'
      ? null
      : legacyCurrentStepId === 'provider'
        ? 'select-provider'
        : legacyCurrentStepId === 'mcp'
          ? 'mcp'
          : legacyCurrentStepId === 'skills'
            ? 'skills'
            : legacyCurrentStepId === 'plugins' || legacyCurrentStepId === 'switch-model'
              ? 'switch-agent'
              : legacyCurrentStepId === 'first-chat'
                ? 'first-chat'
                : findNextPendingStepId(nextStateBase)

  return guidedOnboardingStateSchema.parse({
    ...nextStateBase,
    currentStepId
  })
}

const normalizeState = (raw: unknown, now: number): GuidedOnboardingState => {
  const fallback = createDefaultState(now)

  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const candidate = raw as StoredGuidedOnboardingStateCandidate

  if (candidate.version === 2) {
    return migratePreviousState(candidate, now)
  }

  if (candidate.version === 3) {
    return migrateVersion3State(candidate, now)
  }

  if (candidate.version !== guidedOnboardingVersion) {
    return migrateLegacyState(candidate, now)
  }

  const stepMap = resolveStepMap(SHARED_GUIDED_ONBOARDING_STEP_IDS, candidate.steps)
  const steps = SHARED_GUIDED_ONBOARDING_STEP_IDS.map((stepId) =>
    normalizeStepState(stepId, stepMap.get(stepId))
  )

  const currentStepId =
    typeof candidate.currentStepId === 'string' &&
    SHARED_GUIDED_ONBOARDING_STEP_IDS.includes(candidate.currentStepId as GuidedOnboardingStepId)
      ? (candidate.currentStepId as GuidedOnboardingStepId)
      : null

  const normalized: GuidedOnboardingState = {
    version: guidedOnboardingVersion,
    status:
      candidate.status === 'active' ||
      candidate.status === 'completed' ||
      candidate.status === 'idle'
        ? candidate.status
        : fallback.status,
    startedAt:
      typeof candidate.startedAt === 'number' &&
      Number.isFinite(candidate.startedAt) &&
      candidate.startedAt >= 0
        ? candidate.startedAt
        : null,
    completedAt:
      typeof candidate.completedAt === 'number' &&
      Number.isFinite(candidate.completedAt) &&
      candidate.completedAt >= 0
        ? candidate.completedAt
        : null,
    lastActiveAt:
      typeof candidate.lastActiveAt === 'number' &&
      Number.isFinite(candidate.lastActiveAt) &&
      candidate.lastActiveAt >= 0
        ? candidate.lastActiveAt
        : now,
    currentStepId,
    steps
  }

  return guidedOnboardingStateSchema.parse(normalized)
}

const findNextPendingStepId = (state: GuidedOnboardingState): GuidedOnboardingStepId | null =>
  state.steps.find((step) => step.status === 'pending')?.id ?? null

const persistState = (
  configPresenter: ConfigPresenterPort,
  state: GuidedOnboardingState
): GuidedOnboardingState => {
  configPresenter.setSetting(GUIDED_ONBOARDING_STATE_KEY, state)
  return state
}

export function readGuidedOnboardingState(
  configPresenter: ConfigPresenterPort,
  now = Date.now()
): GuidedOnboardingState {
  const stored = configPresenter.getSetting<unknown>(GUIDED_ONBOARDING_STATE_KEY)
  return normalizeState(stored, now)
}

export function startGuidedOnboarding(
  configPresenter: ConfigPresenterPort,
  options: {
    force?: boolean
    stepId?: GuidedOnboardingStepId
  } = {},
  now = Date.now()
): GuidedOnboardingState {
  const existing = readGuidedOnboardingState(configPresenter, now)

  if (existing.status === 'completed' && !options.force) {
    return existing
  }

  const baseState = options.force ? createDefaultState(now) : existing
  const requestedStepId =
    options.stepId && SHARED_GUIDED_ONBOARDING_STEP_IDS.includes(options.stepId)
      ? options.stepId
      : undefined
  const candidateStepId =
    requestedStepId ??
    baseState.currentStepId ??
    baseState.steps.find((step) => step.status === 'in_progress')?.id ??
    findNextPendingStepId(baseState)
  const candidateStep = candidateStepId
    ? baseState.steps.find((step) => step.id === candidateStepId)
    : undefined
  const nextStepId =
    candidateStep && (candidateStep.status === 'completed' || candidateStep.status === 'skipped')
      ? findNextPendingStepId(baseState)
      : candidateStepId

  const steps: GuidedOnboardingStepState[] = baseState.steps.map((step) => {
    if (step.id !== nextStepId) {
      return step
    }

    return {
      ...step,
      status:
        step.status === 'completed' || step.status === 'skipped'
          ? step.status
          : ('in_progress' as const),
      startedAt: step.startedAt ?? now,
      completedAt: step.status === 'completed' ? step.completedAt : null,
      skippedAt: step.status === 'skipped' ? step.skippedAt : null
    }
  })

  return persistState(configPresenter, {
    ...baseState,
    status: 'active',
    startedAt: baseState.startedAt ?? now,
    completedAt: null,
    lastActiveAt: now,
    currentStepId: nextStepId ?? null,
    steps
  })
}

export function setGuidedOnboardingStepStatus(
  configPresenter: ConfigPresenterPort,
  input: {
    stepId: GuidedOnboardingStepId
    status: 'in_progress' | 'completed' | 'skipped'
  },
  now = Date.now()
): GuidedOnboardingState {
  const currentState = readGuidedOnboardingState(configPresenter, now)
  const targetStep = currentState.steps.find((step) => step.id === input.stepId)

  if (!targetStep) {
    throw new Error(`Unknown onboarding step: ${input.stepId}`)
  }

  if (input.status === 'skipped' && targetStep.required) {
    throw new Error(`Cannot skip required onboarding step: ${input.stepId}`)
  }

  const nextSteps = currentState.steps.map((step) => {
    if (step.id !== input.stepId) {
      return step
    }

    if (input.status === 'in_progress') {
      return {
        ...step,
        status: 'in_progress' as const,
        startedAt: step.startedAt ?? now,
        completedAt: null,
        skippedAt: null
      }
    }

    if (input.status === 'completed') {
      return {
        ...step,
        status: 'completed' as const,
        startedAt: step.startedAt ?? now,
        completedAt: now,
        skippedAt: null
      }
    }

    return {
      ...step,
      status: 'skipped' as const,
      startedAt: step.startedAt,
      completedAt: null,
      skippedAt: now
    }
  })

  const nextStateBase: GuidedOnboardingState = {
    ...currentState,
    status: 'active',
    startedAt: currentState.startedAt ?? now,
    completedAt: null,
    lastActiveAt: now,
    currentStepId: input.status === 'in_progress' ? input.stepId : null,
    steps: nextSteps
  }

  const nextStepId =
    input.status === 'in_progress' ? input.stepId : findNextPendingStepId(nextStateBase)

  return persistState(configPresenter, {
    ...nextStateBase,
    currentStepId: nextStepId
  })
}

export function completeGuidedOnboarding(
  configPresenter: ConfigPresenterPort,
  now = Date.now(),
  options: {
    force?: boolean
  } = {}
): GuidedOnboardingState {
  const currentState = readGuidedOnboardingState(configPresenter, now)
  const incompleteRequiredStep = options.force
    ? null
    : currentState.steps.find((step) => step.required && step.status !== 'completed')

  if (incompleteRequiredStep) {
    throw new Error(`Cannot complete onboarding before required step: ${incompleteRequiredStep.id}`)
  }

  const finalizedSteps = currentState.steps.map((step) => {
    if (step.status === 'completed' || step.status === 'skipped') {
      return step
    }

    if (options.force && step.required) {
      return {
        ...step,
        status: 'completed' as const,
        startedAt: step.startedAt ?? now,
        completedAt: now,
        skippedAt: null
      }
    }

    return {
      ...step,
      status: 'skipped' as const,
      skippedAt: now,
      completedAt: null
    }
  })

  const nextState = persistState(configPresenter, {
    ...currentState,
    status: 'completed',
    startedAt: currentState.startedAt ?? now,
    completedAt: now,
    lastActiveAt: now,
    currentStepId: null,
    steps: finalizedSteps
  })

  configPresenter.setSetting('init_complete', true)
  return nextState
}

export function resetGuidedOnboarding(
  configPresenter: ConfigPresenterPort,
  now = Date.now()
): GuidedOnboardingState {
  return persistState(configPresenter, createDefaultState(now))
}
