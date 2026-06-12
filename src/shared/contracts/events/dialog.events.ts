import { dialogRequestSchema } from '../routes/dialog.routes'
import { defineEventContract } from '../common'
import { z } from 'zod'

export const dialogRequestedEvent = defineEventContract({
  name: 'dialog.requested',
  payload: dialogRequestSchema.extend({
    version: z.number().int()
  })
})
