import { z } from 'zod'
import { semanticNotificationDeliverySchema } from '../../notifications/semanticNotification'
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

export const semanticNotificationEvent = defineEventContract({
  name: 'notification.semantic',
  payload: semanticNotificationDeliverySchema
})
