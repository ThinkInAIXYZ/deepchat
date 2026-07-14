import { describe, expect, it } from 'vitest'
import {
  MemoryReindexFailure,
  toMemoryReindexError
} from '@/presenter/memoryPresenter/infra/reindexResult'

describe('memory reindex error projection', () => {
  it('keeps only a sanitized and bounded Error.message', () => {
    const error = new Error(
      `request failed at https://example.com/embeddings?api_key=secret with Bearer token-value apiKey=key-value access_token=access-value ${'x'.repeat(600)}`
    )
    error.stack = 'stack with another-secret'

    const projected = toMemoryReindexError(error)

    expect(projected.message).toContain('[URL]')
    expect(projected.message).toContain('Bearer [REDACTED]')
    expect(projected.message).toContain('apiKey=[REDACTED]')
    expect(projected.message).toContain('access_token=[REDACTED]')
    expect(projected.message).not.toContain('secret')
    expect(projected.message).not.toContain('another-secret')
    expect(projected.message.length).toBeLessThanOrEqual(500)
  })

  it('classifies retryable HTTP, network, explicit client, and restart errors', () => {
    expect(
      toMemoryReindexError(Object.assign(new Error('server failed'), { statusCode: 503 }))
    ).toMatchObject({ retryable: true })
    expect(toMemoryReindexError(new Error('ECONNRESET'))).toMatchObject({ retryable: true })
    expect(
      toMemoryReindexError(Object.assign(new Error('invalid model'), { statusCode: 400 }))
    ).toMatchObject({ retryable: false })
    expect(toMemoryReindexError(new Error('cleanup pending-restart'))).toMatchObject({
      retryable: false
    })
  })

  it('redacts canonical OpenAI API key errors', () => {
    const projected = toMemoryReindexError(
      new Error('Incorrect API key provided: sk-proj-secretvalue123456789')
    )

    expect(projected.message).toBe('Incorrect API key provided: [REDACTED]')
    expect(projected.message).not.toContain('sk-proj-')
  })

  it('projects stable internal failure codes for renderer localization', () => {
    expect(
      toMemoryReindexError(
        new MemoryReindexFailure('vector-store-unavailable', '[Memory] native lease failed')
      )
    ).toEqual({
      message: '[Memory] native lease failed',
      retryable: true,
      code: 'vector-store-unavailable'
    })
  })

  it('does not stringify unknown objects', () => {
    expect(toMemoryReindexError({ apiKey: 'secret' })).toEqual({
      message: 'Unknown reindex error',
      retryable: true
    })
  })
})
