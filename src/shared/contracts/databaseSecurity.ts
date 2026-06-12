export const DATABASE_UNLOCK_REQUEST_CHANNEL = 'database-security:unlock-request'
export const DATABASE_UNLOCK_SUBMIT_CHANNEL = 'database-security:unlock-submit'
export const DATABASE_UNLOCK_CANCEL_CHANNEL = 'database-security:unlock-cancel'
export const DATABASE_UNLOCK_PROGRESS_CHANNEL = 'database-security:unlock-progress'

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
