import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'

/** Memory update reasons used by the renderer to refresh scoped UI state. */
export const MemoryUpdateReasonSchema = z.enum([
  'extract',
  'delete',
  'clear',
  'persona-evolve',
  'persona-anchor',
  'persona-draft',
  'persona-approve',
  'persona-reject',
  'persona-rollback',
  'reindex'
])

/** Lightweight memory update notification; payload never includes memory content. */
export const memoryUpdatedEvent = defineEventContract({
  name: 'memory.updated',
  payload: z.object({
    agentId: z.string(),
    reason: MemoryUpdateReasonSchema,
    version: TimestampMsSchema
  })
})
