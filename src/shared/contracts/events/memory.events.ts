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
  'manual-edit',
  'directive-suggest',
  'directive-create',
  'directive-approve',
  'directive-reject',
  'directive-delete',
  'reindex'
])

export type MemoryUpdateReason = z.infer<typeof MemoryUpdateReasonSchema>

/**
 * Lightweight memory update notification; payload never includes memory content.
 * memoryId is content-free id-only context for targeted reconciliation.
 * Only extract events with both sessionId and createdIds describe chip-safe newly-created rows.
 * Other extract events are generic refresh signals for memory views.
 */
export const memoryUpdatedEvent = defineEventContract({
  name: 'memory.updated',
  payload: z.object({
    agentId: z.string(),
    reason: MemoryUpdateReasonSchema,
    version: TimestampMsSchema,
    memoryId: z.string().optional(),
    directiveId: z.string().optional(),
    sessionId: z.string().optional(),
    createdIds: z.array(z.string()).max(50).optional()
  })
})
