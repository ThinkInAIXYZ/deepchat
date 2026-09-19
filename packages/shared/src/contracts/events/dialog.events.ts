import { dialogRequestSchema } from '../routes/dialog.routes.js'
import { defineEventContract } from '../common.js'
import { z } from 'zod'

export const dialogRequestedEvent = defineEventContract({
  name: 'dialog.requested',
  payload: dialogRequestSchema.extend({
    version: z.number().int()
  })
})
