import { z } from 'zod'
import { defineRouteContract } from '../common'
import { GUIDED_ONBOARDING_STEP_IDS, GUIDED_ONBOARDING_VERSION } from '../../guidedOnboarding'

export const guidedOnboardingVersion = GUIDED_ONBOARDING_VERSION
export const guidedOnboardingStepIds = GUIDED_ONBOARDING_STEP_IDS

export const guidedOnboardingStepIdSchema = z.enum(guidedOnboardingStepIds)

export const guidedOnboardingStepStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'skipped'
])

export const guidedOnboardingStatusSchema = z.enum(['idle', 'active', 'completed'])

export const guidedOnboardingStepStateSchema = z.object({
  id: guidedOnboardingStepIdSchema,
  required: z.boolean(),
  status: guidedOnboardingStepStatusSchema,
  startedAt: z.number().int().nonnegative().nullable(),
  completedAt: z.number().int().nonnegative().nullable(),
  skippedAt: z.number().int().nonnegative().nullable()
})

export const guidedOnboardingStateSchema = z.object({
  version: z.literal(guidedOnboardingVersion),
  status: guidedOnboardingStatusSchema,
  startedAt: z.number().int().nonnegative().nullable(),
  completedAt: z.number().int().nonnegative().nullable(),
  lastActiveAt: z.number().int().nonnegative(),
  currentStepId: guidedOnboardingStepIdSchema.nullable(),
  steps: z.array(guidedOnboardingStepStateSchema)
})

export const onboardingGetStateRoute = defineRouteContract({
  name: 'onboarding.getState',
  input: z.object({}),
  output: z.object({
    state: guidedOnboardingStateSchema
  })
})

export const onboardingStartRoute = defineRouteContract({
  name: 'onboarding.start',
  input: z.object({
    force: z.boolean().optional(),
    stepId: guidedOnboardingStepIdSchema.optional()
  }),
  output: z.object({
    state: guidedOnboardingStateSchema
  })
})

export const onboardingSetStepStatusRoute = defineRouteContract({
  name: 'onboarding.setStepStatus',
  input: z.object({
    stepId: guidedOnboardingStepIdSchema,
    status: z.enum(['in_progress', 'completed', 'skipped'])
  }),
  output: z.object({
    state: guidedOnboardingStateSchema
  })
})

export const onboardingCompleteRoute = defineRouteContract({
  name: 'onboarding.complete',
  input: z.object({
    force: z.boolean().optional()
  }),
  output: z.object({
    state: guidedOnboardingStateSchema
  })
})

export const onboardingResetRoute = defineRouteContract({
  name: 'onboarding.reset',
  input: z.object({}),
  output: z.object({
    state: guidedOnboardingStateSchema
  })
})

export type GuidedOnboardingStepId = z.infer<typeof guidedOnboardingStepIdSchema>
export type GuidedOnboardingStepStatus = z.infer<typeof guidedOnboardingStepStatusSchema>
export type GuidedOnboardingStatus = z.infer<typeof guidedOnboardingStatusSchema>
export type GuidedOnboardingStepState = z.infer<typeof guidedOnboardingStepStateSchema>
export type GuidedOnboardingState = z.infer<typeof guidedOnboardingStateSchema>
