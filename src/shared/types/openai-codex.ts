export type OpenAICodexAuthState =
  | 'disabled'
  | 'signed-out'
  | 'pending-browser'
  | 'pending-device'
  | 'authenticated'
  | 'error'

export type OpenAICodexAuthStatus = {
  state: OpenAICodexAuthState
  authenticated: boolean
  accountId?: string
  accountLabel?: string
  planType?: string
  expiresAt?: number
  storage: 'safeStorage' | 'file' | 'none'
  device?: {
    userCode: string
    verificationUri: string
    expiresAt: number
    interval?: number
  }
  error?: string
}
