export const CHATGPT_PROVIDER_ID = 'chatgpt'

export const CHATGPT_ISSUER = 'https://auth.openai.com'
export const CHATGPT_AUTHORIZE_URL = `${CHATGPT_ISSUER}/api/accounts/authorize`
export const CHATGPT_TOKEN_URL = `${CHATGPT_ISSUER}/api/accounts/oauth/token`
export const CHATGPT_DISCOVERY_URL = `${CHATGPT_ISSUER}/.well-known/openid-configuration`

/** The resource the plan grant is issued for, and the only inference origin. */
export const CHATGPT_API_BASE_URL = 'https://api.openai.com/v1'

/** First-time registration entrypoint; never stored or used for token exchange. */
export const CHATGPT_DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
export const CHATGPT_AGENT_NAME = 'DeepChat'

export const CHATGPT_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
/** All three are needed to renew and use the plan grant. */
export const CHATGPT_PLAN_SCOPES = [
  'chatgpt.tokens.use.direct',
  'resource.invoke',
  'offline_access'
] as const

export const CHATGPT_REDIRECT_HOST = '127.0.0.1'
export const CHATGPT_REDIRECT_PORT = 1455
export const CHATGPT_REDIRECT_PATH = '/auth/callback'

export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage'

export const CHATGPT_BROWSER_TIMEOUT_MS = 10 * 60 * 1000
export const CHATGPT_REQUEST_TIMEOUT_MS = 30 * 1000
export const CHATGPT_REFRESH_SKEW_MS = 60 * 1000
export const CHATGPT_REVOKE_RETRY_DELAYS_MS = [250, 1000] as const

/** Refresh errors after which the stored refresh token can never succeed again. */
export const CHATGPT_UNUSABLE_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused'
])
