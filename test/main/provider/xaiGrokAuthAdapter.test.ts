import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLM_PROVIDER } from '@shared/types/provider'
import { createXaiGrokFetch } from '@/provider/xaiGrokAuthAdapter'

const auth = vi.hoisted(() => ({
  captureOperation: vi.fn<() => () => void>(),
  ensureAccessToken: vi.fn<() => Promise<string | null>>(),
  forceRefreshAccessToken: vi.fn<() => Promise<string>>()
}))
vi.mock('@/provider/auth/xaiGrok', () => ({ getGlobalXaiGrokAuth: () => auth }))
const provider: LLM_PROVIDER = {
  id: 'grok',
  name: 'Grok',
  apiType: 'grok',
  apiKey: 'fixture-api-key',
  baseUrl: 'https://api.x.ai/v1',
  enable: true
}

describe('Grok per-request credentials', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    auth.captureOperation.mockReturnValue(() => undefined)
    auth.ensureAccessToken.mockResolvedValue('oauth-token')
    auth.forceRefreshAccessToken.mockResolvedValue('refreshed-token')
  })

  it('prefers OAuth, retries once on 401 and overrides stale headers with the refreshed token', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    await createXaiGrokFetch(
      provider,
      { Authorization: 'stale-default' },
      fetch
    )('https://api.x.ai/v1/models', { headers: { Authorization: 'stale-request' } })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer oauth-token'
    )
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get('Authorization')).toBe(
      'Bearer refreshed-token'
    )
    expect(auth.forceRefreshAccessToken).toHaveBeenCalledOnce()
  })

  it('retains API-key fallback for an ordinary refresh failure', async () => {
    auth.ensureAccessToken.mockRejectedValue(new Error('refresh failed'))
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ ok: true }))
    await createXaiGrokFetch(provider, {}, fetch)('https://api.x.ai/v1/models')
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer fixture-api-key'
    )
  })

  it.each(['request abort', 'auth replacement'] as const)(
    'does not turn %s into API-key fallback',
    async (change) => {
      let finish!: (value: string) => void
      auth.ensureAccessToken.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      let current = true
      auth.captureOperation.mockReturnValue(() => {
        if (!current) throw new DOMException('Auth changed', 'AbortError')
      })
      const controller = new AbortController()
      const fetch = vi.fn<typeof globalThis.fetch>()
      const pending = createXaiGrokFetch(
        provider,
        {},
        fetch
      )('https://api.x.ai/v1/models', { signal: controller.signal })
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      if (change === 'request abort') controller.abort()
      else current = false
      finish('late-token')
      await rejected
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('rejects an interrupted auth owner before falling back to an API key', async () => {
    auth.ensureAccessToken.mockRejectedValue(new DOMException('Stopped', 'AbortError'))
    const fetch = vi.fn<typeof globalThis.fetch>()
    await expect(
      createXaiGrokFetch(provider, {}, fetch)('https://api.x.ai/v1/models')
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not refresh or retry after auth is revoked with a 401 response pending', async () => {
    let current = true
    auth.captureOperation.mockReturnValue(() => {
      if (!current) throw new DOMException('Auth changed', 'AbortError')
    })
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(async () => {
      current = false
      return new Response(null, { status: 401 })
    })
    await expect(
      createXaiGrokFetch(provider, {}, fetch)('https://api.x.ai/v1/models')
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(auth.forceRefreshAccessToken).not.toHaveBeenCalled()
  })
})
