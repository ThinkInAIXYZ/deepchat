import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscordClient } from '@/remote/channels/discord/discordClient'
import { QQBotClient } from '@/remote/channels/qqbot/qqbotClient'
import { WeixinIlinkClient } from '@/remote/channels/weixinIlink/weixinIlinkClient'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

const sentSignal = (fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): AbortSignal | null => {
  const init = (fetchMock.mock.calls[callIndex]?.[1] ?? {}) as RequestInit
  return (init.signal as AbortSignal | undefined) ?? null
}

describe('remote channel request timeouts', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('cancels an actual Weixin login poll and retires its QR session', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ qrcode: 'qr', qrcode_img_content: 'https://liteapp.weixin.qq.com/login' })
    )
    const session = await WeixinIlinkClient.startLogin({
      sessionKey: 'cancel-poll',
      signal: controller.signal
    })
    const entered = Promise.withResolvers<void>()
    fetchMock.mockImplementationOnce(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
          entered.resolve()
        })
    )
    const waiting = WeixinIlinkClient.waitForLogin({
      sessionKey: session.sessionKey,
      signal: controller.signal
    })
    const rejected = expect(waiting).rejects.toThrow()
    await entered.promise
    controller.abort()
    await rejected
    await expect(
      WeixinIlinkClient.waitForLogin({ sessionKey: session.sessionKey })
    ).resolves.toMatchObject({
      connected: false,
      messageKey: 'settings.remote.weixinIlink.loginSessionExpired'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('arms a timeout on Discord API requests without swallowing the caller signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: '123' }))
    const client = new DiscordClient({ botToken: 'token' })

    await (client as any).request('/users/@me', { method: 'GET' })
    const timeoutOnly = sentSignal(fetchMock)
    expect(timeoutOnly).toBeInstanceOf(AbortSignal)
    expect(timeoutOnly?.aborted).toBe(false)

    const controller = new AbortController()
    const callerSignal = controller.signal
    controller.abort()
    await (client as any).request('/users/@me', { method: 'GET', signal: callerSignal })

    const merged = sentSignal(fetchMock, 1)
    expect(merged).toBeInstanceOf(AbortSignal)
    expect(merged).not.toBe(callerSignal)
    expect(merged?.aborted).toBe(true)
  })

  it('arms a timeout on QQBot requests without swallowing the caller signal', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('getAppAccessToken')
        ? jsonResponse({ access_token: 'access', expires_in: 3600 })
        : jsonResponse({ id: 'msg-1' })
    )
    const client = new QQBotClient({ appId: 'app', clientSecret: 'secret' })

    await (client as any).request('/v2/users/open-id/messages', { method: 'POST' })
    const timeoutOnly = sentSignal(fetchMock, 1)
    expect(timeoutOnly).toBeInstanceOf(AbortSignal)
    expect(timeoutOnly?.aborted).toBe(false)

    const controller = new AbortController()
    const callerSignal = controller.signal
    controller.abort()
    await (client as any).request('/v2/users/open-id/messages', {
      method: 'POST',
      signal: callerSignal
    })

    const merged = sentSignal(fetchMock, 2)
    expect(merged).toBeInstanceOf(AbortSignal)
    expect(merged).not.toBe(callerSignal)
    expect(merged?.aborted).toBe(true)
  })

  it('propagates the caller signal to the QQBot token fetch', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('getAppAccessToken')
        ? jsonResponse({ access_token: 'access', expires_in: 3600 })
        : jsonResponse({ id: 'msg-1' })
    )
    const client = new QQBotClient({ appId: 'app', clientSecret: 'secret' })

    const controller = new AbortController()
    const callerSignal = controller.signal
    controller.abort()
    await (client as any).request('/v2/users/open-id/messages', {
      method: 'POST',
      signal: callerSignal
    })

    const tokenFetch = sentSignal(fetchMock, 0)
    expect(tokenFetch).toBeInstanceOf(AbortSignal)
    expect(tokenFetch).not.toBe(callerSignal)
    expect(tokenFetch?.aborted).toBe(true)
  })
})
