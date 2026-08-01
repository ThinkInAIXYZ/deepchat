import { z } from 'zod'

export const SessionOrchestrationModeSchema = z.enum(['adaptive', 'workflow'])
export type SessionOrchestrationMode = z.infer<typeof SessionOrchestrationModeSchema>

export const WorkflowCapabilityUnavailableReasonSchema = z.enum([
  'session_unavailable',
  'agent_unavailable',
  'deepchat_agent_required',
  'regular_parent_required',
  'agent_policy_unavailable',
  'subagents_disabled'
])
export type WorkflowCapabilityUnavailableReason = z.infer<
  typeof WorkflowCapabilityUnavailableReasonSchema
>

export const WorkflowCapabilitySchema = z.discriminatedUnion('available', [
  z
    .object({
      available: z.literal(true)
    })
    .strict(),
  z
    .object({
      available: z.literal(false),
      reason: WorkflowCapabilityUnavailableReasonSchema
    })
    .strict()
])
export type WorkflowCapability = z.infer<typeof WorkflowCapabilitySchema>

export const DEFAULT_SESSION_ORCHESTRATION_MODE: SessionOrchestrationMode = 'adaptive'

export function normalizeSessionOrchestrationMode(value: unknown): SessionOrchestrationMode {
  return SessionOrchestrationModeSchema.safeParse(value).data ?? DEFAULT_SESSION_ORCHESTRATION_MODE
}
