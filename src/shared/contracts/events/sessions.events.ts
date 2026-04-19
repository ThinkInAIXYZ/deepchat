import { z } from 'zod'
import { EntityIdSchema, defineEventContract } from '../common'

export const sessionsUpdatedEvent = defineEventContract({
  name: 'sessions.updated',
  payload: z.object({
    sessionIds: z.array(EntityIdSchema),
    reason: z.enum(['created', 'activated', 'deactivated', 'list-refreshed', 'updated', 'deleted']),
    activeSessionId: EntityIdSchema.nullable().optional(),
    webContentsId: z.number().int().optional()
  })
})
