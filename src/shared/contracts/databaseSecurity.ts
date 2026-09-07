export const DATABASE_UNLOCK_REQUEST_CHANNEL = 'database-security:unlock-request'
export const DATABASE_UNLOCK_SUBMIT_CHANNEL = 'database-security:unlock-submit'
export const DATABASE_UNLOCK_CANCEL_CHANNEL = 'database-security:unlock-cancel'
export const DATABASE_UNLOCK_PROGRESS_CHANNEL = 'database-security:unlock-progress'
export const DATABASE_RECOVERY_REQUEST_CHANNEL = 'database-security:recovery-request'
export const DATABASE_RECOVERY_SUBMIT_CHANNEL = 'database-security:recovery-submit'
export const DATABASE_RECOVERY_CANCEL_CHANNEL = 'database-security:recovery-cancel'

export type DatabaseUnlockReason =
  | 'manual-required'
  | 'safe-storage-unavailable'
  | 'system-key-missing'
  | 'invalid'

export type DatabaseUnlockRequestPayload = {
  requestId: string
  reason: DatabaseUnlockReason
  safeStorageAvailable: boolean
}

export type DatabaseUnlockProgressPayload = {
  active: boolean
  safeStorageAvailable: boolean
}

export const DATABASE_STARTUP_FAILURE_KINDS = [
  'true-corruption',
  'unreadable',
  'orphaned-sidecar'
] as const

export type DatabaseStartupFailureKind = (typeof DATABASE_STARTUP_FAILURE_KINDS)[number]

export type DatabaseRecoveryRequestPayload = {
  requestId: string
  kind: DatabaseStartupFailureKind
  preservedPath: string
  invalidPassword?: boolean
  quarantineFailed?: boolean
}

export type DatabaseRecoverySubmitPayload =
  | { requestId: string; action: 'start-empty' }
  | { requestId: string; action: 'password'; password: string }

export type DatabaseRecoveryChoice =
  | { action: 'start-empty' }
  | { action: 'password'; password: string }
