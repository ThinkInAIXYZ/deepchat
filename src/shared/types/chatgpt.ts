export type ChatGPTAuthState =
  | 'signed-out'
  | 'pending-browser'
  | 'authenticated'
  | 'plan-disabled'
  | 'reauth-required'
  | 'error'

export type ChatGPTNotice = 'welcome' | 'codexRetired'

export type ChatGPTAuthStatus = {
  state: ChatGPTAuthState
  /** Email from the validated ID token; a display label, never an identity. */
  email?: string
  planUsageEnabled: boolean
  storage: 'safeStorage' | 'file' | 'none'
  /** Sanitized; never contains tokens or authorization URLs. */
  error?: string
  notices: Record<ChatGPTNotice, boolean>
}

export type ChatGPTLogoutResult = {
  status: ChatGPTAuthStatus
  revocationConfirmed: boolean
}
