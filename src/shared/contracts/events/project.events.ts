import { z } from 'zod'
import { RevisionSchema, defineEventContract } from '../common'

export const projectEnvironmentsChangedEvent = defineEventContract({
  name: 'project:environments-changed',
  payload: z.object({
    action: z.enum(['reorder', 'archive', 'restore', 'remove', 'select']),
    path: z.string().nullable(),
    version: RevisionSchema
  })
})
