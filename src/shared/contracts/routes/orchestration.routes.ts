import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  OrchestrationCapabilitySchema,
  OrchestrationPolicySchema
} from '../../workflow/orchestrationPolicy'

const OrchestrationRouteIdSchema = z.string().trim().min(1).max(256)

export const orchestrationGetCapabilityRoute = defineRouteContract({
  name: 'orchestration.getCapability',
  input: z.union([
    z.object({ sessionId: OrchestrationRouteIdSchema }).strict(),
    z.object({ agentId: OrchestrationRouteIdSchema }).strict()
  ]),
  output: z.object({ capability: OrchestrationCapabilitySchema }).strict()
})

export const orchestrationSetPolicyRoute = defineRouteContract({
  name: 'orchestration.setPolicy',
  input: z
    .object({
      sessionId: OrchestrationRouteIdSchema,
      policy: OrchestrationPolicySchema
    })
    .strict(),
  output: z
    .object({
      applied: z.boolean(),
      policy: OrchestrationPolicySchema,
      capability: OrchestrationCapabilitySchema
    })
    .strict()
})
