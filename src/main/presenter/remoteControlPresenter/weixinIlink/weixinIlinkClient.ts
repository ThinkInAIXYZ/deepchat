import { randomBytes, randomUUID } from 'node:crypto'

type WeixinIlinkQrCodeResponse = {
  qrcode?: string
  qrcode_img_content?: string
}

type WeixinIlinkQrStatusResponse = {
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect'
  bot_token?: string
  ilink_bot_id?: string
  ilink_user_id?: string
  baseurl?: string
  redirect_host?: string
}

export type WeixinIlinkMessageItem = {
  type?: number
  text_item?: {
    text?: string
  }
  voice_item?: {
    text?: string
  }
}

export type WeixinIlinkInboundApiMessage = {
  seq?: number
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  create_time_ms?: number
  message_type?: number
  message_state?: number
  item_list?: WeixinIlinkMessageItem[]
  context_token?: string
}

export type WeixinIlinkGetUpdatesResponse = {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinIlinkInboundApiMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

export type WeixinIlinkGetConfigResponse = {
  ret?: number
  errmsg?: string
  typing_ticket?: string
}

export type WeixinIlinkStartLoginResult = {
  sessionKey: string
  loginUrl: string | null
  message?: string
  messageKey?: string
}

export type WeixinIlinkWaitLoginResult = {
  connected: boolean
  accountId?: string
  ownerUserId?: string
  botToken?: string
  baseUrl?: string
  message?: string
  messageKey?: string
}

type ActiveWeixinIlinkLogin = {
  sessionKey: string
  qrcode: string
  loginUrl: string
  startedAt: number
  currentBaseUrl: string
}

export class WeixinIlinkApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly errcode?: number
  ) {
    super(message)
    this.name = 'WeixinIlinkApiError'
  }
}

const WEIXIN_ILINK_FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com'
const WEIXIN_ILINK_DEFAULT_BOT_TYPE = '3'
const WEIXIN_ILINK_LOGIN_TTL_MS = 5 * 60_000
const WEIXIN_ILINK_QR_POLL_TIMEOUT_MS = 35_000
const WEIXIN_ILINK_REQUEST_TIMEOUT_MS = 15_000
const WEIXIN_ILINK_LONG_POLL_TIMEOUT_MS = 35_000

const activeLogins = new Map<string, ActiveWeixinIlinkLogin>()

const ensureTrailingSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`)

const buildRandomWechatUin = (): string => {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf8').toString('base64')
}

const isFreshLogin = (login: ActiveWeixinIlinkLogin): boolean =>
  Date.now() - login.startedAt < WEIXIN_ILINK_LOGIN_TTL_MS

const purgeExpiredLogins = (): void => {
  for (const [sessionKey, login] of activeLogins) {
    if (!isFreshLogin(login)) {
      activeLogins.delete(sessionKey)
    }
  }
}

const normalizeHttpError = async (response: Response): Promise<string> => {
  const fallback =
    `${response.status} ${response.statusText}`.trim() || 'Weixin iLink API request failed.'
  try {
    const rawText = await response.text()
    if (!rawText.trim()) {
      return fallback
    }

    const data = JSON.parse(rawText) as {
      errmsg?: string
      message?: string
      errcode?: number | string
    }
    const message = data.errmsg?.trim() || data.message?.trim()
    if (message) {
      return message
    }

    if (data.errcode !== undefined) {
      return `Weixin iLink API error ${String(data.errcode)}`
    }
  } catch {
    // Fall through to the fallback status text.
  }

  return fallback
}

const withTimeout = async <T>(
  timeoutMs: number | undefined,
  operation: (signal?: AbortSignal) => Promise<T>
): Promise<T> => {
  const normalizedTimeoutMs =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0
  if (!normalizedTimeoutMs) {
    return await operation()
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs)
  try {
    return await operation(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

const fetchGetJson = async <T>(
  baseUrl: string,
  endpoint: string,
  timeoutMs?: number
): Promise<T> => {
  return await withTimeout(timeoutMs, async (signal) => {
    const response = await fetch(new URL(endpoint, ensureTrailingSlash(baseUrl)).toString(), {
      method: 'GET',
      ...(signal ? { signal } : {})
    })

    if (!response.ok) {
      throw new WeixinIlinkApiError(await normalizeHttpError(response), response.status)
    }

    return (await response.json()) as T
  })
}

const fetchPostJson = async <T>(params: {
  baseUrl: string
  endpoint: string
  body: Record<string, unknown>
  token?: string
  timeoutMs?: number
}): Promise<T> => {
  return await withTimeout(params.timeoutMs, async (signal) => {
    const payload = JSON.stringify(params.body)
    const response = await fetch(
      new URL(params.endpoint, ensureTrailingSlash(params.baseUrl)).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          AuthorizationType: 'ilink_bot_token',
          ...(params.token?.trim()
            ? {
                Authorization: `Bearer ${params.token.trim()}`
              }
            : {}),
          'X-WECHAT-UIN': buildRandomWechatUin()
        },
        body: payload,
        ...(signal ? { signal } : {})
      }
    )

    if (!response.ok) {
      throw new WeixinIlinkApiError(await normalizeHttpError(response), response.status)
    }

    const rawText = await response.text()
    return rawText.trim() ? (JSON.parse(rawText) as T) : ({} as T)
  })
}

export class WeixinIlinkClient {
  static readonly DEFAULT_BASE_URL = WEIXIN_ILINK_FIXED_BASE_URL

  constructor(
    private readonly credentials: {
      accountId: string
      botToken: string
      baseUrl: string
    }
  ) {}

  static async startLogin(input?: {
    sessionKey?: string
    force?: boolean
  }): Promise<WeixinIlinkStartLoginResult> {
    const sessionKey = input?.sessionKey?.trim() || randomUUID()
    purgeExpiredLogins()

    const existing = activeLogins.get(sessionKey)
    if (!input?.force && existing && isFreshLogin(existing)) {
      return {
        sessionKey,
        loginUrl: existing.loginUrl,
        messageKey: 'settings.remote.weixinIlink.loginWindowOpened'
      }
    }

    const response = await fetchGetJson<WeixinIlinkQrCodeResponse>(
      WEIXIN_ILINK_FIXED_BASE_URL,
      `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(WEIXIN_ILINK_DEFAULT_BOT_TYPE)}`,
      WEIXIN_ILINK_REQUEST_TIMEOUT_MS
    )
    const qrcode = response.qrcode?.trim() || ''
    const loginUrl = response.qrcode_img_content?.trim() || ''
    if (!qrcode || !loginUrl) {
      throw new Error('Weixin iLink QR login did not return a QR code.')
    }

    activeLogins.set(sessionKey, {
      sessionKey,
      qrcode,
      loginUrl,
      startedAt: Date.now(),
      currentBaseUrl: WEIXIN_ILINK_FIXED_BASE_URL
    })

    return {
      sessionKey,
      loginUrl,
      messageKey: 'settings.remote.weixinIlink.loginWindowOpened'
    }
  }

  static async waitForLogin(input: {
    sessionKey: string
    timeoutMs?: number
  }): Promise<WeixinIlinkWaitLoginResult> {
    purgeExpiredLogins()
    const login = activeLogins.get(input.sessionKey)
    if (!login || !isFreshLogin(login)) {
      activeLogins.delete(input.sessionKey)
      return {
        connected: false,
        messageKey: 'settings.remote.weixinIlink.loginSessionExpired'
      }
    }

    const timeoutMs =
      typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
        ? input.timeoutMs
        : 8 * 60_000
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      let response: WeixinIlinkQrStatusResponse
      try {
        response = await fetchGetJson<WeixinIlinkQrStatusResponse>(
          login.currentBaseUrl,
          `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(login.qrcode)}`,
          WEIXIN_ILINK_QR_POLL_TIMEOUT_MS
        )
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          response = {
            status: 'wait'
          }
        } else {
          throw error
        }
      }

      switch (response.status) {
        case 'wait':
        case 'scaned':
          break
        case 'scaned_but_redirect':
          if (response.redirect_host?.trim()) {
            login.currentBaseUrl = `https://${response.redirect_host.trim()}`
          }
          break
        case 'expired':
          activeLogins.delete(input.sessionKey)
          return {
            connected: false,
            messageKey: 'settings.remote.weixinIlink.loginSessionExpired'
          }
        case 'confirmed': {
          const accountId = response.ilink_bot_id?.trim()
          const botToken = response.bot_token?.trim()
          const ownerUserId = response.ilink_user_id?.trim()
          if (!accountId || !botToken || !ownerUserId) {
            activeLogins.delete(input.sessionKey)
            return {
              connected: false,
              messageKey: 'settings.remote.weixinIlink.loginResponseIncomplete'
            }
          }

          activeLogins.delete(input.sessionKey)
          return {
            connected: true,
            accountId,
            ownerUserId,
            botToken,
            baseUrl:
              response.baseurl?.trim() || login.currentBaseUrl || WEIXIN_ILINK_FIXED_BASE_URL,
            messageKey: 'settings.remote.weixinIlink.loginConnected'
          }
        }
        default:
          break
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }

    activeLogins.delete(input.sessionKey)
    return {
      connected: false,
      messageKey: 'settings.remote.weixinIlink.loginTimedOut'
    }
  }

  async getUpdates(
    getUpdatesBuf: string,
    timeoutMs: number = WEIXIN_ILINK_LONG_POLL_TIMEOUT_MS
  ): Promise<WeixinIlinkGetUpdatesResponse> {
    try {
      return await fetchPostJson<WeixinIlinkGetUpdatesResponse>({
        baseUrl: this.credentials.baseUrl,
        endpoint: 'ilink/bot/getupdates',
        body: {
          get_updates_buf: getUpdatesBuf
        },
        token: this.credentials.botToken,
        timeoutMs
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          ret: 0,
          msgs: [],
          get_updates_buf: getUpdatesBuf
        }
      }
      throw error
    }
  }

  async sendTextMessage(params: {
    toUserId: string
    text: string
    contextToken?: string | null
  }): Promise<void> {
    await fetchPostJson<Record<string, unknown>>({
      baseUrl: this.credentials.baseUrl,
      endpoint: 'ilink/bot/sendmessage',
      token: this.credentials.botToken,
      timeoutMs: WEIXIN_ILINK_REQUEST_TIMEOUT_MS,
      body: {
        msg: {
          from_user_id: '',
          to_user_id: params.toUserId,
          client_id: randomUUID(),
          message_type: 2,
          message_state: 2,
          item_list: [
            {
              type: 1,
              text_item: {
                text: params.text
              }
            }
          ],
          ...(params.contextToken?.trim()
            ? {
                context_token: params.contextToken.trim()
              }
            : {})
        }
      }
    })
  }

  async getConfig(params: {
    ilinkUserId: string
    contextToken?: string | null
  }): Promise<WeixinIlinkGetConfigResponse> {
    const response = await fetchPostJson<WeixinIlinkGetConfigResponse>({
      baseUrl: this.credentials.baseUrl,
      endpoint: 'ilink/bot/getconfig',
      token: this.credentials.botToken,
      timeoutMs: WEIXIN_ILINK_REQUEST_TIMEOUT_MS,
      body: {
        ilink_user_id: params.ilinkUserId,
        ...(params.contextToken?.trim()
          ? {
              context_token: params.contextToken.trim()
            }
          : {})
      }
    })

    if ((response.ret ?? 0) !== 0) {
      throw new WeixinIlinkApiError(response.errmsg?.trim() || 'Weixin iLink getConfig failed.')
    }

    return response
  }

  async sendTyping(params: {
    ilinkUserId: string
    typingTicket: string
    status: 1 | 2
  }): Promise<void> {
    const response = await fetchPostJson<{
      ret?: number
      errmsg?: string
    }>({
      baseUrl: this.credentials.baseUrl,
      endpoint: 'ilink/bot/sendtyping',
      token: this.credentials.botToken,
      timeoutMs: WEIXIN_ILINK_REQUEST_TIMEOUT_MS,
      body: {
        ilink_user_id: params.ilinkUserId,
        typing_ticket: params.typingTicket,
        status: params.status
      }
    })

    if ((response.ret ?? 0) !== 0) {
      throw new WeixinIlinkApiError(response.errmsg?.trim() || 'Weixin iLink sendTyping failed.')
    }
  }
}
