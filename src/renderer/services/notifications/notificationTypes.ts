export type NotificationUrgency = 'normal' | 'high' | 'critical'

export type TransientNotificationKind = 'success' | 'info' | 'warning' | 'error'

export type NotificationAction = Readonly<{
  label: string
  ariaLabel?: string
  onClick: () => void | Promise<void>
}>

type NotificationCopy = Readonly<{
  code: string
  title: string
  description?: string
}>

type SimpleTransientNotificationRequest = Readonly<
  NotificationCopy & {
    kind: TransientNotificationKind
    key?: never
    scope?: never
    entity?: never
  }
>

type IdentifiedTransientNotificationRequest = Readonly<
  NotificationCopy & {
    kind: TransientNotificationKind
    key: string
    scope?: string
    entity?: string
  }
>

export type TransientNotificationRequest =
  | SimpleTransientNotificationRequest
  | IdentifiedTransientNotificationRequest

export type ActionableNotificationRequest = Readonly<
  NotificationCopy & {
    kind: 'actionable'
    key: string
    scope?: string
    entity?: string
    urgency?: NotificationUrgency
    retention?: 'default' | 'until-resolved'
    action: NotificationAction
  }
>

export type ProgressNotificationRequest = Readonly<
  NotificationCopy & {
    kind: 'progress'
    operationId: string
    progress?: number
  }
>

export type NotificationRequest =
  | TransientNotificationRequest
  | ActionableNotificationRequest
  | ProgressNotificationRequest

export type NotificationKind = NotificationRequest['kind']

export type NotificationCloseReason =
  | 'auto'
  | 'dismissed'
  | 'action'
  | 'programmatic'
  | 'preempted'
  | 'max-lifetime'
  | 'surface-reclaimed'

export type NotificationProgrammaticCloseReason = Extract<
  NotificationCloseReason,
  'programmatic' | 'surface-reclaimed'
>

export type NotificationDiagnosticReason =
  | 'lower-priority'
  | 'candidate-replaced'
  | 'candidate-expired'
  | 'actionable-overflow'
  | 'actionable-expired'

export type NotificationDiagnosticEvent = Readonly<{
  code: string
  reason: NotificationDiagnosticReason
  priority: number
  scopeKind: 'scope' | 'key' | 'operation' | 'none'
}>

export interface NotificationDiagnostics {
  record(event: NotificationDiagnosticEvent): void
}

export const silentNotificationDiagnostics: NotificationDiagnostics = Object.freeze({
  record: () => undefined
})
