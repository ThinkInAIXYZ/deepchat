export type OpenAICodexAuthState =
  | 'disabled'
  | 'signed-out'
  | 'pending-browser'
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
  error?: string
}
