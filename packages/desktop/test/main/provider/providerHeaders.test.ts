import { describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_CUSTOM_HEADERS_MAX_COUNT,
  PROVIDER_CUSTOM_HEADER_VALUE_MAX_BYTES,
  validateProviderCustomHeaders,
  type ProviderCustomHeaders
} from '@shared/providerCustomHeaders'
import type { LLM_PROVIDER } from '@shared/types/provider'
import {
  buildProviderTraceHeaders,
  fetchWithProviderHeaders,
  MASKED_PROVIDER_CUSTOM_HEADER_VALUE
} from '@/provider/providerHeaders'

const createProvider = (customHeaders?: ProviderCustomHeaders): LLM_PROVIDER => ({
  id: 'gateway',
  name: 'Gateway',
  apiType: 'openai',
  apiKey: 'provider-key',
  baseUrl: 'https://gateway.example.com/v1',
  customHeaders,
  enable: true
})

describe('provider custom header validation', () => {
  it('accepts supplemental string headers and rejects unsafe records', () => {
    expect(validateProviderCustomHeaders({ 'X-Tenant-ID': 'team-a' })).toEqual({
      ok: true,
      value: { 'X-Tenant-ID': 'team-a' }
    })
    expect(validateProviderCustomHeaders({ Authorization: 'Bearer secret' })).toMatchObject({
      ok: false,
      code: 'reserved_name'
    })
    expect(
      validateProviderCustomHeaders({ 'X-Tenant-ID': 'team-a', 'x-tenant-id': 'team-b' })
    ).toMatchObject({ ok: false, code: 'duplicate_name' })
    expect(
      validateProviderCustomHeaders({ 'X-Tenant-ID': 'team-a\r\nX-Injected: yes' })
    ).toMatchObject({ ok: false, code: 'invalid_value' })
    expect(validateProviderCustomHeaders({ 'X-Retry-Count': 2 })).toMatchObject({
      ok: false,
      code: 'invalid_value'
    })
    expect(validateProviderCustomHeaders({ 'X-Latin-1': '\u00ff' })).toMatchObject({ ok: true })
    expect(validateProviderCustomHeaders({ 'X-Unicode': '\u0100' })).toMatchObject({
      ok: false,
      code: 'invalid_value'
    })
  })

  it('enforces header count, field, and total byte limits', () => {
    const tooManyHeaders = Object.fromEntries(
      Array.from({ length: PROVIDER_CUSTOM_HEADERS_MAX_COUNT + 1 }, (_, index) => [
        `X-Header-${index}`,
        'value'
      ])
    )
    expect(validateProviderCustomHeaders(tooManyHeaders)).toMatchObject({
      ok: false,
      code: 'too_many_headers'
    })
    expect(validateProviderCustomHeaders({ [`X-${'a'.repeat(128)}`]: 'value' })).toMatchObject({
      ok: false,
      code: 'name_too_long'
    })
    expect(
      validateProviderCustomHeaders({
        'X-Large': 'a'.repeat(PROVIDER_CUSTOM_HEADER_VALUE_MAX_BYTES + 1)
      })
    ).toMatchObject({ ok: false, code: 'value_too_large' })

    const oversizedRecord = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [
        `X-Large-${index}`,
        'a'.repeat(PROVIDER_CUSTOM_HEADER_VALUE_MAX_BYTES)
      ])
    )
    expect(validateProviderCustomHeaders(oversizedRecord)).toMatchObject({
      ok: false,
      code: 'headers_too_large'
    })
  })
})

describe('fetchWithProviderHeaders', () => {
  it('delegates unchanged when the provider has no custom headers', async () => {
    const provider = createProvider()
    const input = 'https://gateway.example.com/v1/chat/completions'
    const init = { method: 'POST', headers: { Authorization: 'Bearer provider-key' } }
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('{}', { status: 200 })
    )

    await fetchWithProviderHeaders(provider, input, init, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledWith(input, init)
  })

  it('merges custom headers only for the configured origin', async () => {
    const provider = createProvider({
      'X-Tenant-ID': 'team-a',
      'HTTP-Referer': 'https://custom.example.com'
    })
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('{}', { status: 200 })
    )

    await fetchWithProviderHeaders(
      provider,
      'https://gateway.example.com/v1/chat/completions',
      {
        headers: {
          Authorization: 'Bearer provider-key',
          'HTTP-Referer': 'https://default.example.com'
        }
      },
      fetchImpl
    )
    await fetchWithProviderHeaders(
      provider,
      'https://media.example.com/result.mp4',
      { headers: { Authorization: 'Bearer download-key' } },
      fetchImpl
    )

    const providerHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers)
    expect(providerHeaders.get('x-tenant-id')).toBe('team-a')
    expect(providerHeaders.get('http-referer')).toBe('https://custom.example.com')
    expect(providerHeaders.get('authorization')).toBe('Bearer provider-key')

    const mediaHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers)
    expect(mediaHeaders.has('x-tenant-id')).toBe(false)
    expect(mediaHeaders.get('authorization')).toBe('Bearer download-key')
  })

  it('preserves multi-value init headers with Request replacement semantics', async () => {
    const provider = createProvider({ 'X-Tenant-ID': 'team-a' })
    const input = new Request('https://gateway.example.com/v1/chat/completions', {
      headers: { 'X-Input': 'input' }
    })
    const headers = new Headers([
      ['Set-Cookie', 'one=1'],
      ['Set-Cookie', 'two=2'],
      ['X-Init', 'init']
    ])
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('{}', { status: 200 })
    )

    await fetchWithProviderHeaders(provider, input, { headers }, fetchImpl)

    const resolvedHeaders = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers)
    expect(resolvedHeaders.getSetCookie()).toEqual(['one=1', 'two=2'])
    expect(resolvedHeaders.get('x-init')).toBe('init')
    expect(resolvedHeaders.has('x-input')).toBe(false)
    expect(resolvedHeaders.get('x-tenant-id')).toBe('team-a')
  })

  it('retains custom headers on same-origin redirects', async () => {
    const provider = createProvider({ 'X-Tenant-ID': 'team-a' })
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: '/v1/redirected' }
        })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await fetchWithProviderHeaders(
      provider,
      'https://gateway.example.com/v1/chat/completions',
      { headers: { Authorization: 'Bearer provider-key' } },
      fetchImpl
    )

    const redirectedHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers)
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://gateway.example.com/v1/redirected')
    expect(redirectedHeaders.get('x-tenant-id')).toBe('team-a')
    expect(redirectedHeaders.get('authorization')).toBe('Bearer provider-key')
  })

  it.each([301, 302, 303])('rewrites POST to GET on %i redirects', async (status) => {
    const provider = createProvider({ 'X-Tenant-ID': 'team-a' })
    const fetchImpl = vi
      .fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response('{}', { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status,
          headers: { Location: '/v1/redirected' }
        })
      )

    await fetchWithProviderHeaders(
      provider,
      'https://gateway.example.com/v1/chat/completions',
      {
        method: 'POST',
        body: '{"prompt":"hello"}',
        headers: {
          'Content-Length': '18',
          'Content-Type': 'application/json'
        }
      },
      fetchImpl
    )

    const redirectInit = fetchImpl.mock.calls[1]?.[1]
    const redirectedHeaders = new Headers(redirectInit?.headers)
    expect(redirectInit?.method).toBe('GET')
    expect(redirectInit?.body).toBeUndefined()
    expect(redirectedHeaders.has('content-length')).toBe(false)
    expect(redirectedHeaders.has('content-type')).toBe(false)
    expect(redirectedHeaders.get('x-tenant-id')).toBe('team-a')
  })

  it('replays a replayable body across body-preserving redirects', async () => {
    const provider = createProvider({ 'X-Tenant-ID': 'team-a' })
    const fetchImpl = vi
      .fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response('{}', { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { Location: '/v1/redirected' } })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 308, headers: { Location: '/v1/final' } })
      )

    await fetchWithProviderHeaders(
      provider,
      'https://gateway.example.com/v1/chat/completions',
      { method: 'POST', body: 'payload' },
      fetchImpl
    )

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: 'payload' })
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({ method: 'POST', body: 'payload' })
  })

  it('preserves Request attributes after a redirect', async () => {
    const provider = createProvider({ 'X-Tenant-ID': 'team-a' })
    const fetchImpl = vi
      .fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response('{}', { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { Location: '/v1/redirected' } })
      )
    const request = new Request('https://gateway.example.com/v1/chat/completions', {
      method: 'POST',
      body: 'payload',
      cache: 'no-store',
      credentials: 'include',
      integrity: 'sha256-test',
      keepalive: true,
      mode: 'cors',
      referrer: 'https://app.example.com/settings',
      referrerPolicy: 'origin'
    })

    await fetchWithProviderHeaders(provider, request, undefined, fetchImpl)

    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      signal: request.signal
    })
  })

  it.each(['manual', 'error'] as const)('passes through redirect mode %s', async (redirect) => {
    const provider = createProvider({ 'X-Tenant-ID': 'team-a' })
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 302, headers: { Location: '/v1/redirected' } })
    )

    const response = await fetchWithProviderHeaders(
      provider,
      'https://gateway.example.com/v1/chat/completions',
      { redirect },
      fetchImpl
    )

    expect(response.status).toBe(302)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe(redirect)
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('x-tenant-id')).toBe('team-a')
  })

  it('sets duplex when a redirect retries a stream body', async () => {
    const provider = createProvider({ 'X-Tenant-ID': 'team-a' })
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('{}', { status: 200 })
    )
    fetchImpl.mockResolvedValueOnce(
      new Response(null, {
        status: 307,
        headers: { Location: '/v1/redirected' }
      })
    )
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('payload'))
        controller.close()
      }
    })
    const request = new Request('https://gateway.example.com/v1/chat/completions', {
      method: 'POST',
      body,
      duplex: 'half'
    })

    await fetchWithProviderHeaders(provider, request, undefined, fetchImpl)

    expect(fetchImpl.mock.calls[1]?.[1]?.duplex).toBe('half')
  })

  it('strips custom and credential headers on cross-origin redirects', async () => {
    const provider = createProvider({
      'X-Tenant-ID': 'team-a',
      'CF-Access-Client-Secret': 'gateway-secret'
    })
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://redirect.example.net/final' }
        })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await fetchWithProviderHeaders(
      provider,
      'https://gateway.example.com/v1/chat/completions',
      {
        headers: {
          Authorization: 'Bearer provider-key',
          'api-key': 'azure-key',
          'x-goog-api-key': 'google-key'
        }
      },
      fetchImpl
    )

    const redirectedHeaders = new Headers(fetchImpl.mock.calls[1][1]?.headers)
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://redirect.example.net/final')
    expect(redirectedHeaders.has('x-tenant-id')).toBe(false)
    expect(redirectedHeaders.has('cf-access-client-secret')).toBe(false)
    expect(redirectedHeaders.has('authorization')).toBe(false)
    expect(redirectedHeaders.has('api-key')).toBe(false)
    expect(redirectedHeaders.has('x-goog-api-key')).toBe(false)
  })
})

describe('provider request trace headers', () => {
  it('masks every configured name without leaking values across origins', () => {
    const provider = createProvider({
      'X-Tenant-ID': 'team-a',
      'CF-Access-Client-Secret': 'gateway-secret'
    })

    const providerTrace = buildProviderTraceHeaders(
      provider,
      'https://gateway.example.com/v1/responses',
      { Authorization: '***MASKED***' }
    )
    expect(providerTrace).toMatchObject({
      'x-tenant-id': MASKED_PROVIDER_CUSTOM_HEADER_VALUE,
      'cf-access-client-secret': MASKED_PROVIDER_CUSTOM_HEADER_VALUE
    })

    const externalTrace = buildProviderTraceHeaders(provider, 'https://media.example.com/result', {
      'CF-Access-Client-Secret': 'must-not-leak'
    })
    expect(externalTrace['cf-access-client-secret']).toBe(MASKED_PROVIDER_CUSTOM_HEADER_VALUE)
    expect(JSON.stringify({ providerTrace, externalTrace })).not.toContain('gateway-secret')
    expect(JSON.stringify({ providerTrace, externalTrace })).not.toContain('must-not-leak')
  })
})
