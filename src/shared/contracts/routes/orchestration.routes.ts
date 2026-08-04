import { z } from 'zod'
import { defineRouteContract } from '../common'
import {
  OrchestrationCapabilitySchema,
  OrchestrationPolicySchema
} from '../../orchestration/policy'
import {
  LiveDelegationDetailSchema,
  LiveDelegationSummarySchema
} from '../../orchestration/liveDelegation'

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

export const orchestrationListLiveDelegationsRoute = defineRouteContract({
  name: 'orchestration.liveDelegation.list',
  input: z
    .object({
      parentSessionId: OrchestrationRouteIdSchema,
      limit: z.number().int().min(1).max(100)
    })
    .strict(),
  output: z
    .object({
      delegations: z.array(LiveDelegationSummarySchema).max(100)
    })
    .strict()
})

export const orchestrationInspectLiveDelegationRoute = defineRouteContract({
  name: 'orchestration.liveDelegation.inspect',
  input: z
    .object({
      parentSessionId: OrchestrationRouteIdSchema,
      delegationId: OrchestrationRouteIdSchema
    })
    .strict(),
  output: z.object({ delegation: LiveDelegationDetailSchema }).strict()
})

export const orchestrationInterruptLiveDelegationRoute = defineRouteContract({
  name: 'orchestration.liveDelegation.interrupt',
  input: z
    .object({
      parentSessionId: OrchestrationRouteIdSchema,
      delegationId: OrchestrationRouteIdSchema
    })
    .strict(),
  output: z.object({ delegation: LiveDelegationDetailSchema }).strict()
})
