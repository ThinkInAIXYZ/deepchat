type QQBotAccessTokenResponse = {
  access_token?: string
  expires_in?: string | number
}

type QQBotGatewayResponse = {
  url?: string
}

type QQBotMessageResponse = {
  id?: string
  timestamp?: string | number
}

export class QQBotApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'QQBotApiRequestError'
  }
}

const QQBOT_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const QQBOT_API_BASE_URL = 'https://api.sgroup.qq.com'
const QQBOT_TOKEN_REFRESH_WINDOW_MS = 60_000

const normalizeResponseError = async (response: Response): Promise<string> => {
  const fallback = `${response.status} ${response.statusText}`.trim()

  try {
    const data = (await response.json()) as {
      code?: number | string
      message?: string
      msg?: string
    }
    const message = data.message?.trim() || data.msg?.trim()
    if (message) {
      return message
    }

    if (data.code !== undefined) {
      return `QQBot API error ${String(data.code)}`
    }
  } catch {
    // Fall through to the fallback status text.
  }

  return fallback || 'QQBot API request failed.'
}

export class QQBotClient {
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0

  constructor(
    private readonly credentials: {
      appId: string
      clientSecret: string
    }
  ) {}

  async getAccessToken(forceRefresh: boolean = false): Promise<string> {
    if (
      !forceRefresh &&
      this.accessToken &&
      Date.now() < this.accessTokenExpiresAt - QQBOT_TOKEN_REFRESH_WINDOW_MS
    ) {
      return this.accessToken
    }

    const response = await fetch(QQBOT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        appId: this.credentials.appId,
        clientSecret: this.credentials.clientSecret
      })
    })

    if (!response.ok) {
      throw new QQBotApiRequestError(response.status, await normalizeResponseError(response))
    }

    const data = (await response.json()) as QQBotAccessTokenResponse
    const accessToken = data.access_token?.trim()
    const expiresIn = Number.parseInt(String(data.expires_in ?? ''), 10)

    if (!accessToken) {
      throw new Error('QQBot access token is missing from the token response.')
    }

    this.accessToken = accessToken
    this.accessTokenExpiresAt =
      Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0)

    return accessToken
  }

  async getGatewayUrl(): Promise<string> {
    const response = await this.request('/gateway', {
      method: 'GET'
    })

    const data = (await response.json()) as QQBotGatewayResponse
    const url = data.url?.trim()
    if (!url) {
      throw new Error('QQBot gateway URL is missing from the response.')
    }

    return url
  }

  async sendC2CMessage(target: {
    openId: string
    msgId: string
    msgSeq: number
    content: string
  }): Promise<QQBotMessageResponse> {
    const response = await this.request(`/v2/users/${encodeURIComponent(target.openId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: target.content,
        msg_type: 0,
        msg_id: target.msgId,
        msg_seq: target.msgSeq
      })
    })

    return (await response.json()) as QQBotMessageResponse
  }

  async sendGroupMessage(target: {
    groupOpenId: string
    msgId: string
    msgSeq: number
    content: string
  }): Promise<QQBotMessageResponse> {
    const response = await this.request(
      `/v2/groups/${encodeURIComponent(target.groupOpenId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: target.content,
          msg_type: 0,
          msg_id: target.msgId,
          msg_seq: target.msgSeq
        })
      }
    )

    return (await response.json()) as QQBotMessageResponse
  }

  private async request(path: string, init: RequestInit, retry: boolean = true): Promise<Response> {
    const accessToken = await this.getAccessToken(retry === false)
    const response = await fetch(`${QQBOT_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `QQBot ${accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers
      }
    })

    if (response.status === 401 && retry) {
      await this.getAccessToken(true)
      return await this.request(path, init, false)
    }

    if (!response.ok) {
      throw new QQBotApiRequestError(response.status, await normalizeResponseError(response))
    }

    return response
  }
}
