export const OPENAI_CODEX_PROVIDER_ID = 'openai-codex'
export const OPENAI_CODEX_API_TYPE = 'openai-codex'

const DEFAULT_AUTH_BASE_URL = 'https://auth.openai.com'
const DEFAULT_BACKEND_API_URL = 'https://chatgpt.com/backend-api'

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

function getPortEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : fallback
}

export const OPENAI_CODEX_CLIENT_ID =
  process.env.OPENAI_CODEX_CLIENT_ID?.trim() || 'app_EMoamEEZ73f0CkXaXp7hrann'

export const OPENAI_CODEX_AUTH_BASE_URL = normalizeBaseUrl(
  process.env.OPENAI_CODEX_AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL
)

export const OPENAI_CODEX_BACKEND_API_URL = normalizeBaseUrl(
  process.env.OPENAI_CODEX_BACKEND_API_URL || DEFAULT_BACKEND_API_URL
)

export const OPENAI_CODEX_API_BASE_URL = normalizeBaseUrl(
  process.env.OPENAI_CODEX_API_BASE_URL || `${OPENAI_CODEX_BACKEND_API_URL}/codex`
)

export const OPENAI_CODEX_AUTHORIZE_URL =
  process.env.OPENAI_CODEX_AUTHORIZE_URL?.trim() || `${OPENAI_CODEX_AUTH_BASE_URL}/oauth/authorize`

export const OPENAI_CODEX_TOKEN_URL =
  process.env.OPENAI_CODEX_TOKEN_URL?.trim() || `${OPENAI_CODEX_AUTH_BASE_URL}/oauth/token`

export const OPENAI_CODEX_REVOKE_URL =
  process.env.OPENAI_CODEX_REVOKE_URL?.trim() || `${OPENAI_CODEX_AUTH_BASE_URL}/oauth/revoke`

export const OPENAI_CODEX_REDIRECT_PORT = getPortEnv('OPENAI_CODEX_REDIRECT_PORT', 1455)
export const OPENAI_CODEX_REDIRECT_PATH = '/auth/callback'
export const OPENAI_CODEX_REDIRECT_URI =
  process.env.OPENAI_CODEX_REDIRECT_URI?.trim() ||
  `http://localhost:${OPENAI_CODEX_REDIRECT_PORT}${OPENAI_CODEX_REDIRECT_PATH}`

export const OPENAI_CODEX_SCOPE =
  process.env.OPENAI_CODEX_SCOPE?.trim() ||
  'openid profile email offline_access api.connectors.read api.connectors.invoke'

export const OPENAI_CODEX_ACCESS_TOKEN_ENV =
  process.env.OPENAI_CODEX_ACCESS_TOKEN?.trim() || process.env.CODEX_ACCESS_TOKEN?.trim() || ''

export const OPENAI_CODEX_BROWSER_TIMEOUT_MS = getNumberEnv(
  'OPENAI_CODEX_BROWSER_TIMEOUT_MS',
  10 * 60 * 1000
)

export const OPENAI_CODEX_TOKEN_REFRESH_SKEW_MS = getNumberEnv(
  'OPENAI_CODEX_TOKEN_REFRESH_SKEW_MS',
  60 * 1000
)

export const OPENAI_CODEX_AUTH_REQUEST_TIMEOUT_MS = getNumberEnv(
  'OPENAI_CODEX_AUTH_REQUEST_TIMEOUT_MS',
  30 * 1000
)

export function isOpenAICodexDisabled(): boolean {
  return getBooleanEnv('DEEPCHAT_OPENAI_CODEX_DISABLED') || getBooleanEnv('OPENAI_CODEX_DISABLED')
}
