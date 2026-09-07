import { semanticNotificationDeliverySchema } from '../../notifications/semanticNotification'
import { defineEventContract } from '../common'

export const semanticNotificationEvent = defineEventContract({
  name: 'notification.semantic',
  payload: semanticNotificationDeliverySchema
})
