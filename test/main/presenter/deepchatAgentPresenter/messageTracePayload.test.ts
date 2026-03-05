import { describe, expect, it } from 'vitest'
import {
  buildPersistableMessageTracePayload,
  MESSAGE_TRACE_MAX_BYTES
} from '@/presenter/deepchatAgentPresenter/messageTracePayload'

describe('buildPersistableMessageTracePayload', () => {
  it('redacts sensitive headers/body with tail-4 mask strategy', () => {
    const result = buildPersistableMessageTracePayload({
      endpoint: 'https://api.example.com/v1/chat/completions',
      headers: {
        authorization: 'Bearer sk-very-secret-token',
        'x-api-key': 'plain-secret-key-1234',
        'content-type': 'application/json'
      },
      body: {
        token: 'body-token-9999',
        nested: {
          api_key: 'nested-secret-key-8888',
          normal: 'keep-me'
        }
      }
    })

    const headers = JSON.parse(result.headersJson) as Record<string, string>
    const body = JSON.parse(result.bodyJson) as {
      token: string
      nested: { api_key: string; normal: string }
    }

    expect(result.truncated).toBe(false)
    expect(headers.authorization).toMatch(/^Bearer \*+oken$/)
    expect(headers['x-api-key']).toMatch(/^\*+1234$/)
    expect(headers['content-type']).toBe('application/json')
    expect(body.token).toMatch(/^\*+9999$/)
    expect(body.nested.api_key).toMatch(/^\*+8888$/)
    expect(body.nested.normal).toBe('keep-me')
  })

  it('marks truncated and keeps payload within byte budget', () => {
    const maxBytes = 512
    const result = buildPersistableMessageTracePayload(
      {
        endpoint: 'https://api.example.com/v1/responses',
        headers: {
          'content-type': 'application/json'
        },
        body: {
          input: 'x'.repeat(MESSAGE_TRACE_MAX_BYTES)
        }
      },
      maxBytes
    )

    const totalBytes =
      Buffer.byteLength(result.endpoint, 'utf8') +
      Buffer.byteLength(result.headersJson, 'utf8') +
      Buffer.byteLength(result.bodyJson, 'utf8')

    expect(result.truncated).toBe(true)
    expect(totalBytes).toBeLessThanOrEqual(maxBytes)

    const parsedBody = JSON.parse(result.bodyJson) as { _truncated?: boolean } | null
    if (parsedBody !== null) {
      expect(parsedBody._truncated).toBe(true)
    }
  })
})
