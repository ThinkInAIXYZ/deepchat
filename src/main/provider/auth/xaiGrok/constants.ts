export const XAI_GROK_PROVIDER_ID = 'grok'

const DEFAULT_ISSUER = 'https://auth.x.ai'
const DEFAULT_API_BASE_URL = 'https://api.x.ai/v1'

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function getBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function getNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const XAI_GROK_OAUTH_CLIENT_ID =
  process.env.XAI_GROK_OAUTH_CLIENT_ID?.trim() || 'b1a00492-073a-47ea-816f-4c329264a828'

export const XAI_GROK_OAUTH_ISSUER = normalizeBaseUrl(
  process.env.XAI_GROK_OAUTH_ISSUER || DEFAULT_ISSUER
)

export const XAI_GROK_OAUTH_DISCOVERY_URL =
  process.env.XAI_GROK_OAUTH_DISCOVERY_URL?.trim() ||
  `${XAI_GROK_OAUTH_ISSUER}/.well-known/openid-configuration`

export const XAI_GROK_OAUTH_SCOPE =
  process.env.XAI_GROK_OAUTH_SCOPE?.trim() ||
  'openid profile email offline_access grok-cli:access api:access'

export const XAI_GROK_API_BASE_URL = normalizeBaseUrl(
  process.env.XAI_GROK_API_BASE_URL || DEFAULT_API_BASE_URL
)

export const XAI_GROK_DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

export const XAI_GROK_OAUTH_USER_AGENT =
  process.env.XAI_GROK_OAUTH_USER_AGENT?.trim() || 'DeepChat/xai-grok-oauth'

// Access tokens are short-lived (~6h). Refresh up to one hour early so chat/cron
// workloads that touch Grok infrequently stay warm.
export const XAI_GROK_TOKEN_REFRESH_SKEW_MS = getNumberEnv(
  'XAI_GROK_TOKEN_REFRESH_SKEW_MS',
  60 * 60 * 1000
)

export const XAI_GROK_AUTH_REQUEST_TIMEOUT_MS = getNumberEnv(
  'XAI_GROK_AUTH_REQUEST_TIMEOUT_MS',
  30 * 1000
)

export const XAI_GROK_DEVICE_CODE_DEFAULT_INTERVAL_MS = getNumberEnv(
  'XAI_GROK_DEVICE_CODE_DEFAULT_INTERVAL_MS',
  5 * 1000
)

export const XAI_GROK_DEVICE_CODE_MIN_INTERVAL_MS = 1000
export const XAI_GROK_DEVICE_CODE_SLOW_DOWN_INCREMENT_MS = 5 * 1000

export const XAI_GROK_ACCESS_TOKEN_ENV =
  process.env.XAI_GROK_ACCESS_TOKEN?.trim() || process.env.XAI_ACCESS_TOKEN?.trim() || ''

export function isXaiGrokOAuthDisabled(): boolean {
  return (
    getBooleanEnv('DEEPCHAT_XAI_GROK_OAUTH_DISABLED') ||
    getBooleanEnv('XAI_GROK_OAUTH_DISABLED') ||
    getBooleanEnv('DEEPCHAT_GROK_OAUTH_DISABLED')
  )
}

export function isTrustedXaiOAuthEndpoint(endpoint: string): boolean {
  return isTrustedXaiEndpoint(endpoint)
}

export function isTrustedXaiApiEndpoint(endpoint: string): boolean {
  return isTrustedXaiEndpoint(endpoint)
}

function isTrustedXaiEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') {
      return false
    }
    return url.hostname === 'x.ai' || url.hostname.endsWith('.x.ai')
  } catch {
    return false
  }
}
