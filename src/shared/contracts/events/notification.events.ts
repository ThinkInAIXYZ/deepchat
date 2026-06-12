import { z } from 'zod'
import { defineEventContract } from '../common'

export const notificationErrorEvent = defineEventContract({
  name: 'notification.error',
  payload: z.object({
    id: z.string(),
    title: z.string(),
    message: z.string(),
    type: z.string()
  })
})

export const databaseRepairSuggestedEvent = defineEventContract({
  name: 'databaseSecurity.repairSuggested',
  payload: z.object({
    title: z.string(),
    message: z.string(),
    reason: z.string(),
    dedupeKey: z.string()
  })
})
