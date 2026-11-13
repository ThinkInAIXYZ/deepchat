export interface SessionToolNotificationFacts {
  readonly callId?: string
  readonly name?: string
  readonly params?: string
  readonly response?: string
  readonly error?: string
}

export type SessionToolNotification =
  | {
      readonly event: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure'
      readonly tool: SessionToolNotificationFacts
    }
  | {
      readonly event: 'PermissionRequest'
      readonly permission: Readonly<Record<string, unknown>>
      readonly tool: SessionToolNotificationFacts
    }

export interface SessionToolObserver {
  isObserved(event: SessionToolNotification['event']): boolean
  notify(notification: SessionToolNotification): void
}
