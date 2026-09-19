import { semanticNotificationDeliverySchema } from '../../notifications/semanticNotification.js'
import { defineEventContract } from '../common.js'

export const semanticNotificationEvent = defineEventContract({
  name: 'notification.semantic',
  payload: semanticNotificationDeliverySchema
})
