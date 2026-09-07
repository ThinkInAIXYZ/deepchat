import { APICallError } from '@ai-sdk/provider'
import { describe, expect, it, vi } from 'vitest'
import {
  createProviderHttpErrorFromResponse,
  extractProviderFailureMetadata,
  ProviderHttpError,
  sanitizeProviderFailureMetadata
} from '@/provider/providerFailure'

describe('provider failure metadata', () => {
  it('extracts retry signals without retaining unsafe AI SDK error fields', () => {
    const cause = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })
    const error = new APICallError({
      message: 'rate limited',
      url: 'https://provider.example.com/chat',
      requestBodyValues: { secret: 'request-secret' },
      statusCode: 429,
      responseHeaders: {
        Authorization: 'Bearer response-secret',
        'Retry-After': '2',
        'Retry-After-Ms': '1500',
        'X-Should-Retry': 'true',
        'X-Trace-Secret': 'trace-secret'
      },
      responseBody: '{"secret":"response-secret"}',
      isRetryable: true,
      cause
    })

    const metadata = extractProviderFailureMetadata(error)

    expect(metadata).toEqual({
      statusCode: 429,
      code: 'ECONNRESET',
      retryable: true,
      retryHeaders: {
        'retry-after': '2',
        'retry-after-ms': '1500',
        'x-should-retry': 'true'
      }
    })
    expect(JSON.stringify(metadata)).not.toContain('secret')
    expect(JSON.stringify(metadata)).not.toContain('provider.example.com')
  })

  it('rejects invalid status, code, and header values at the serialization boundary', () => {
    expect(
      sanitizeProviderFailureMetadata({
        statusCode: 700,
        code: 'not a safe code',
        retryable: false,
        retryHeaders: {
          'retry-after': '2\r\nx-secret: leaked',
          'retry-after-ms': '9'.repeat(300),
          'x-should-retry': 'false',
          authorization: 'Bearer secret'
        }
      })
    ).toEqual({
      retryable: false,
      retryHeaders: { 'x-should-retry': 'false' }
    })
  })

  it('preserves only safe HTTP failure fields on custom provider errors', () => {
    const error = new ProviderHttpError('request failed', {
      statusCode: 503,
      code: 'provider_unavailable',
      headers: new Headers({
        'retry-after': '4',
        'set-cookie': 'session=secret'
      })
    })

    expect(extractProviderFailureMetadata(error)).toEqual({
      statusCode: 503,
      code: 'provider_unavailable',
      retryHeaders: { 'retry-after': '4' }
    })
    expect(JSON.stringify(error.failure)).not.toContain('session')
  })

  it('cancels an unread failed response body', () => {
    const cancel = vi.fn().mockResolvedValue(undefined)

    const error = createProviderHttpErrorFromResponse(
      'request failed',
      {
        status: 502,
        headers: new Headers({ 'retry-after': '1' }),
        body: { cancel } as unknown as ReadableStream
      },
      'upstream_error'
    )

    expect(error.failure).toEqual({
      statusCode: 502,
      code: 'upstream_error',
      retryHeaders: { 'retry-after': '1' }
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('bounds cyclic cause traversal', () => {
    const error = Object.assign(new Error('outer'), { code: 'ETIMEDOUT' }) as Error & {
      cause?: unknown
    }
    error.cause = error

    expect(extractProviderFailureMetadata(error)).toEqual({ code: 'ETIMEDOUT' })
  })
})
