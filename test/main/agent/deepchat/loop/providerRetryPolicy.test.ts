import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyProviderFailure,
  PROVIDER_RETRY_MAX_SERVER_DELAY_MS,
  resolveProviderRetryDelay,
  waitForProviderRetry
} from '@/agent/deepchat/loop/providerRetryPolicy'

describe('provider retry policy', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies abort and context-overflow precedence', () => {
    expect(
      classifyProviderFailure({
        signalAborted: true,
        contextOverflow: true,
        errorEvent: {
          type: 'error',
          error_message: 'rate limited',
          failure: { statusCode: 429, retryable: true }
        }
      }).classification
    ).toBe('aborted')
    expect(
      classifyProviderFailure({
        signalAborted: false,
        contextOverflow: true,
        errorEvent: {
          type: 'error',
          error_message: 'context length exceeded',
          failure: { statusCode: 400 }
        }
      }).classification
    ).toBe('context_overflow')
  })

  it.each([
    [{ statusCode: 401 }, 'invalid API key'],
    [{ statusCode: 402 }, 'payment required'],
    [{ statusCode: 404 }, 'model not found'],
    [{ statusCode: 429, code: 'insufficient_quota' }, 'quota exceeded'],
    [{ code: 'content_filter', retryable: false }, 'content filtered']
  ])('classifies permanent failures before retry signals', (failure, message) => {
    expect(
      classifyProviderFailure({
        signalAborted: false,
        contextOverflow: false,
        errorEvent: { type: 'error', error_message: message, failure }
      }).classification
    ).toBe('permanent')
  })

  it.each([
    [{ statusCode: 408 }, 'request timeout'],
    [{ statusCode: 409 }, 'conflict'],
    [{ statusCode: 429 }, 'rate limited'],
    [{ statusCode: 503 }, 'unavailable'],
    [{ code: 'ECONNRESET' }, 'socket reset'],
    [{ code: 'provider_request_timeout' }, 'request timed out'],
    [{ retryable: true }, 'SDK retryable']
  ])('classifies transient structured failures', (failure, message) => {
    expect(
      classifyProviderFailure({
        signalAborted: false,
        contextOverflow: false,
        errorEvent: { type: 'error', error_message: message, failure }
      }).classification
    ).toBe('transient')
  })

  it('honors x-should-retry and defaults unknown failures to no retry', () => {
    expect(
      classifyProviderFailure({
        signalAborted: false,
        contextOverflow: false,
        errorEvent: {
          type: 'error',
          error_message: 'server says no',
          failure: {
            statusCode: 503,
            retryHeaders: { 'x-should-retry': 'false' }
          }
        }
      }).classification
    ).toBe('permanent')
    expect(
      classifyProviderFailure({
        signalAborted: false,
        contextOverflow: false,
        error: new Error('unrecognized provider failure')
      }).classification
    ).toBe('unknown')
  })

  it('uses bounded cause-chain text fallback', () => {
    const inner = Object.assign(new Error('fetch failed'), { code: 'E_UNKNOWN' })
    const outer = new Error('wrapper', { cause: inner })

    expect(
      classifyProviderFailure({
        signalAborted: false,
        contextOverflow: false,
        error: outer
      }).classification
    ).toBe('transient')
  })

  it('treats premature EOF as transient', () => {
    expect(
      classifyProviderFailure({
        signalAborted: false,
        contextOverflow: false,
        prematureEof: true
      }).classification
    ).toBe('transient')
  })

  it('parses Retry-After milliseconds, seconds, and HTTP dates without adding jitter', () => {
    expect(
      resolveProviderRetryDelay({
        metadata: { retryHeaders: { 'retry-after-ms': '1500' } },
        retryIndex: 0,
        random: () => 1
      })
    ).toEqual({ kind: 'retry', delayMs: 1500, source: 'server' })
    expect(
      resolveProviderRetryDelay({
        metadata: { retryHeaders: { 'retry-after': '2.5' } },
        retryIndex: 0,
        random: () => 1
      })
    ).toEqual({ kind: 'retry', delayMs: 2500, source: 'server' })
    expect(
      resolveProviderRetryDelay({
        metadata: { retryHeaders: { 'retry-after': 'Thu, 01 Jan 2026 00:00:45 GMT' } },
        retryIndex: 0,
        nowMs: Date.parse('Thu, 01 Jan 2026 00:00:00 GMT')
      })
    ).toEqual({ kind: 'retry', delayMs: 45_000, source: 'server' })
  })

  it('rejects server delays above the policy limit', () => {
    expect(
      resolveProviderRetryDelay({
        metadata: { retryHeaders: { 'retry-after-ms': '60001' } },
        retryIndex: 0
      })
    ).toEqual({ kind: 'reject', serverDelayMs: PROVIDER_RETRY_MAX_SERVER_DELAY_MS + 1 })
    expect(
      resolveProviderRetryDelay({
        metadata: { retryHeaders: { 'retry-after': '9'.repeat(400) } },
        retryIndex: 0
      })
    ).toEqual({ kind: 'reject', serverDelayMs: PROVIDER_RETRY_MAX_SERVER_DELAY_MS + 1 })
  })

  it('uses capped exponential backoff with downward jitter', () => {
    expect(resolveProviderRetryDelay({ retryIndex: 0, random: () => 0 })).toEqual({
      kind: 'retry',
      delayMs: 500,
      source: 'backoff'
    })
    expect(resolveProviderRetryDelay({ retryIndex: 1, random: () => 1 })).toEqual({
      kind: 'retry',
      delayMs: 750,
      source: 'backoff'
    })
    expect(resolveProviderRetryDelay({ retryIndex: 20, random: () => 0 })).toEqual({
      kind: 'retry',
      delayMs: 8_000,
      source: 'backoff'
    })
  })

  it('cancels retry backoff with the caller reason', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const reason = new DOMException('Run aborted', 'AbortError')
    const waiting = waitForProviderRetry(5_000, controller.signal)

    controller.abort(reason)

    await expect(waiting).rejects.toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  })
})
