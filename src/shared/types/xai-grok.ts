export type XaiGrokAuthState =
  | 'disabled'
  | 'signed-out'
  | 'pending-device'
  | 'authenticated'
  | 'error'

export type XaiGrokAuthStatus = {
  state: XaiGrokAuthState
  authenticated: boolean
  accountId?: string
  accountLabel?: string
  expiresAt?: number
  userCode?: string
  verificationUri?: string
  verificationUriComplete?: string
  storage: 'safeStorage' | 'file' | 'none'
  error?: string
}
