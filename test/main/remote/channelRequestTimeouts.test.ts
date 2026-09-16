import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscordClient } from '@/remote/channels/discord/discordClient'
import { QQBotClient } from '@/remote/channels/qqbot/qqbotClient'

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
})
