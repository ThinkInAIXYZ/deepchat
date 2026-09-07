import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'
import { AcpAuthRunStateSchema } from '../routes/acp-auth.routes'

export const acpAuthOutputEvent = defineEventContract({
  name: 'acpAuth.output',
  payload: z.object({
    challengeId: z.string().min(1),
    runId: z.string().min(1),
    data: z.string().max(65_536),
    version: TimestampMsSchema
  })
})

export const acpAuthStateChangedEvent = defineEventContract({
  name: 'acpAuth.stateChanged',
  payload: z.object({
    challengeId: z.string().min(1),
    runId: z.string().min(1).optional(),
    state: AcpAuthRunStateSchema,
    error: z.string().optional(),
    version: TimestampMsSchema
  })
})
