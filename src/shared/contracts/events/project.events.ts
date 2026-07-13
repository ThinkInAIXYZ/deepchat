import { z } from 'zod'
import { TimestampMsSchema, defineEventContract } from '../common'

export const projectEnvironmentsChangedEvent = defineEventContract({
  name: 'project:environments-changed',
  payload: z.object({
    action: z.enum(['reorder', 'archive', 'restore', 'remove']),
    path: z.string().nullable(),
    version: TimestampMsSchema
  })
})
