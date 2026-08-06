import { z } from 'zod'

export const OrchestrationPolicySchema = z.enum(['explicit', 'proactive'])
export type OrchestrationPolicy = z.infer<typeof OrchestrationPolicySchema>

export const OrchestrationCapabilityUnavailableReasonSchema = z.enum([
  'session_unavailable',
  'agent_unavailable',
  'deepchat_agent_required',
  'regular_parent_required',
  'agent_policy_unavailable',
  'subagents_disabled'
])
export type OrchestrationCapabilityUnavailableReason = z.infer<
  typeof OrchestrationCapabilityUnavailableReasonSchema
>

export const OrchestrationCapabilitySchema = z.discriminatedUnion('available', [
  z
    .object({
      available: z.literal(true)
    })
    .strict(),
  z
    .object({
      available: z.literal(false),
      reason: OrchestrationCapabilityUnavailableReasonSchema
    })
    .strict()
])
export type OrchestrationCapability = z.infer<typeof OrchestrationCapabilitySchema>

export const DEFAULT_ORCHESTRATION_POLICY: OrchestrationPolicy = 'explicit'

export function normalizeOrchestrationPolicy(value: unknown): OrchestrationPolicy {
  return OrchestrationPolicySchema.safeParse(value).data ?? DEFAULT_ORCHESTRATION_POLICY
}
