import type { FeishuBrand } from '@shared/presenter'

export const FEISHU_AUTH_CALLBACK_PATH = '/remote/feishu/auth/callback'
export const FEISHU_AUTH_DEFAULT_PORT = 32178
export const FEISHU_AUTH_SCOPE = ''

export class FeishuOAuthError extends Error {
  readonly exposeToUser = false

  constructor(message: string) {
    super(message)
    this.name = 'FeishuOAuthError'
  }
}

export interface FeishuOAuthCredentials {
  brand: FeishuBrand
  appId: string
  appSecret: string
  redirectUri: string
}

export interface FeishuOAuthUserInfo {
  openId: string
  unionId?: string
  name?: string
}

export interface FeishuPersonalAgentRegistrationStart {
  installUrl: string
  deviceCode: string
  userCode: string
  intervalSec: number
  expireInSec: number
}

export interface FeishuPersonalAgentRegistrationPoll {
  ok: boolean
  status: number
  data: Record<string, unknown>
}

type FeishuOAuthTokenResponse = {
  code?: number
  msg?: string
  error?: string
  error_description?: string
  data?: {
    access_token?: string
    token_type?: string
    scope?: string
  }
  access_token?: string
  token_type?: string
  scope?: string
}

type FeishuUserInfoResponse = {
  code?: number
  msg?: string
  error?: string
  error_description?: string
  data?: Record<string, unknown>
  open_id?: string
  union_id?: string
  name?: string
}

const FEISHU_ACCOUNTS_BASE_URL = 'https://accounts.feishu.cn'
const FEISHU_OPEN_BASE_URL = 'https://open.feishu.cn'
const LARK_ACCOUNTS_BASE_URL = 'https://accounts.larksuite.com'
const LARK_OPEN_BASE_URL = 'https://open.larksuite.com'
const FEISHU_PERSONAL_AGENT_REGISTRATION_PATH = '/oauth/v1/app/registration'
const FEISHU_REQUEST_TIMEOUT_MS = 10_000

const createFeishuFetchSignal = (signal?: AbortSignal): AbortSignal => {
  const timeoutSignal = AbortSignal.timeout(FEISHU_REQUEST_TIMEOUT_MS)
  return signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal
}

export const createDefaultFeishuAuthRedirectUri = (): string =>
  `http://127.0.0.1:${FEISHU_AUTH_DEFAULT_PORT}${FEISHU_AUTH_CALLBACK_PATH}`

export const resolveFeishuAuthDomains = (
  brand: FeishuBrand
): {
  accountsBaseUrl: string
  openBaseUrl: string
  developerConsoleUrl: string
  appCreationUrl: string
  echoBotTutorialUrl: string
} => {
  if (brand === 'lark') {
    return {
      accountsBaseUrl: LARK_ACCOUNTS_BASE_URL,
      openBaseUrl: LARK_OPEN_BASE_URL,
      developerConsoleUrl: `${LARK_OPEN_BASE_URL}/app`,
      appCreationUrl: `${LARK_OPEN_BASE_URL}/app`,
      echoBotTutorialUrl: `${LARK_OPEN_BASE_URL}/document/develop-an-echo-bot/introduction`
    }
  }

  return {
    accountsBaseUrl: FEISHU_ACCOUNTS_BASE_URL,
    openBaseUrl: FEISHU_OPEN_BASE_URL,
    developerConsoleUrl: `${FEISHU_OPEN_BASE_URL}/app`,
    appCreationUrl: `${FEISHU_OPEN_BASE_URL}/app`,
    echoBotTutorialUrl: `${FEISHU_OPEN_BASE_URL}/document/develop-an-echo-bot/introduction`
  }
}

export const buildFeishuAuthUrl = (credentials: FeishuOAuthCredentials, state: string): string => {
  const domains = resolveFeishuAuthDomains(credentials.brand)
  const params = new URLSearchParams({
    client_id: credentials.appId,
    redirect_uri: credentials.redirectUri,
    response_type: 'code',
    state
  })
  if (FEISHU_AUTH_SCOPE) {
    params.set('scope', FEISHU_AUTH_SCOPE)
  }

  return `${domains.accountsBaseUrl}/open-apis/authen/v1/authorize?${params.toString()}`
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {}
}

const recordString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

const normalizeIntervalSeconds = (value: unknown, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback
}

const readJsonRecord = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text()
  try {
    return asRecord(JSON.parse(text) as unknown)
  } catch {
    return { message: text.trim() || response.statusText }
  }
}

const feishuRegistrationAccountsBaseUrl = (brand: FeishuBrand): string =>
  brand === 'lark' ? LARK_ACCOUNTS_BASE_URL : FEISHU_ACCOUNTS_BASE_URL

const postFeishuRegistrationForm = async (
  baseUrl: string,
  body: Record<string, string>,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
  const response = await fetch(`${baseUrl}${FEISHU_PERSONAL_AGENT_REGISTRATION_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(body).toString(),
    signal: createFeishuFetchSignal(signal)
  })

  return {
    ok: response.ok,
    status: response.status,
    data: await readJsonRecord(response)
  }
}

const parseJsonResponse = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new FeishuOAuthError(fallbackMessage)
  }

  if (!response.ok) {
    const record = payload as { msg?: string; error_description?: string; error?: string }
    throw new FeishuOAuthError(
      record?.msg?.trim() ||
        record?.error_description?.trim() ||
        record?.error?.trim() ||
        `${fallbackMessage} (${response.status})`
    )
  }

  return payload as T
}

const assertFeishuApiSuccess = (
  payload: { code?: number; msg?: string; error?: string; error_description?: string },
  fallbackMessage: string
): void => {
  if (typeof payload.code === 'number' && payload.code !== 0) {
    throw new FeishuOAuthError(payload.msg?.trim() || fallbackMessage)
  }

  if (payload.error) {
    throw new FeishuOAuthError(
      payload.error_description?.trim() || payload.error.trim() || fallbackMessage
    )
  }
}

export const exchangeFeishuOAuthCode = async (
  credentials: FeishuOAuthCredentials,
  code: string,
  signal?: AbortSignal
): Promise<string> => {
  const domains = resolveFeishuAuthDomains(credentials.brand)
  const payload = await parseJsonResponse<FeishuOAuthTokenResponse>(
    await fetch(`${domains.openBaseUrl}/open-apis/authen/v2/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: credentials.appId,
        client_secret: credentials.appSecret,
        code,
        redirect_uri: credentials.redirectUri
      }),
      signal: createFeishuFetchSignal(signal)
    }),
    'Failed to exchange Feishu authorization code.'
  )

  assertFeishuApiSuccess(payload, 'Failed to exchange Feishu authorization code.')

  const accessToken = (payload.data?.access_token ?? payload.access_token ?? '').trim()
  if (!accessToken) {
    throw new FeishuOAuthError('Feishu authorization response did not include a user access token.')
  }

  return accessToken
}

export const fetchFeishuOAuthUserInfo = async (
  brand: FeishuBrand,
  accessToken: string,
  signal?: AbortSignal
): Promise<FeishuOAuthUserInfo> => {
  const domains = resolveFeishuAuthDomains(brand)
  const payload = await parseJsonResponse<FeishuUserInfoResponse>(
    await fetch(`${domains.openBaseUrl}/open-apis/authen/v1/user_info`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      signal: createFeishuFetchSignal(signal)
    }),
    'Failed to fetch Feishu user info.'
  )

  assertFeishuApiSuccess(payload, 'Failed to fetch Feishu user info.')

  const data = payload.data ?? payload
  const openId = String(data.open_id ?? '').trim()
  if (!openId) {
    throw new FeishuOAuthError('Feishu user info response did not include open_id.')
  }

  const unionId = String(data.union_id ?? '').trim()
  const name = String(data.name ?? '').trim()

  return {
    openId,
    ...(unionId ? { unionId } : {}),
    ...(name ? { name } : {})
  }
}

export const startFeishuPersonalAgentRegistration = async (
  signal?: AbortSignal
): Promise<FeishuPersonalAgentRegistrationStart> => {
  const response = await postFeishuRegistrationForm(
    FEISHU_ACCOUNTS_BASE_URL,
    {
      action: 'begin',
      archetype: 'PersonalAgent',
      auth_method: 'client_secret',
      request_user_info: 'open_id tenant_brand'
    },
    signal
  )

  if (!response.ok) {
    throw new FeishuOAuthError('Failed to start Feishu PersonalAgent registration.')
  }

  const installUrl = recordString(response.data, 'verification_uri_complete')
  const deviceCode = recordString(response.data, 'device_code')
  const userCode = recordString(response.data, 'user_code')
  if (!installUrl || !deviceCode) {
    throw new FeishuOAuthError('Feishu PersonalAgent registration response was incomplete.')
  }

  return {
    installUrl,
    deviceCode,
    userCode,
    intervalSec: normalizeIntervalSeconds(response.data.interval, 5),
    expireInSec: normalizeIntervalSeconds(
      response.data.expire_in ?? response.data.expires_in,
      5 * 60
    )
  }
}

export const pollFeishuPersonalAgentRegistration = async (
  brand: FeishuBrand,
  deviceCode: string,
  signal?: AbortSignal
): Promise<FeishuPersonalAgentRegistrationPoll> =>
  postFeishuRegistrationForm(
    feishuRegistrationAccountsBaseUrl(brand),
    {
      action: 'poll',
      device_code: deviceCode
    },
    signal
  )

export const readFeishuRegistrationString = recordString
export const asFeishuRegistrationRecord = asRecord
