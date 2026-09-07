import type { SemanticNotificationIntent } from '@shared/notifications'

export interface SemanticNotificationPublisher {
  occur(intent: SemanticNotificationIntent): void
  recover(intent: SemanticNotificationIntent): void
}
