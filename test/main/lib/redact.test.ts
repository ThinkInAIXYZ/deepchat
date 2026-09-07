import { describe, expect, it } from 'vitest'
import { redactBody, redactHeaders } from '@/lib/redact'

describe('redact', () => {
  it('masks sensitive headers while preserving tail 4 chars', () => {
    const redacted = redactHeaders({
      authorization: 'Bearer sk-this-is-a-secret',
      'x-api-key': 'myapikey-1234',
      'content-type': 'application/json'
    })

    expect(redacted.authorization).toMatch(/^Bearer \*+cret$/)
    expect(redacted['x-api-key']).toMatch(/^\*+1234$/)
    expect(redacted['content-type']).toBe('application/json')
  })

  it('masks sensitive body keys recursively', () => {
    const redacted = redactBody({
      token: 'abcde12345',
      nested: {
        client_secret: 'ordinary-tool-value',
        keep: 'safe'
      },
      arr: [{ api_key: 'zxcv9876' }, { value: 'ok' }]
    }) as {
      token: string
      nested: { client_secret: string; keep: string }
      arr: Array<{ api_key?: string; value?: string }>
    }

    expect(redacted.token).toBe('abcde12345')
    expect(redacted.nested.client_secret).toBe('ordinary-tool-value')
    expect(redacted.nested.keep).toBe('safe')
    expect(redacted.arr[0].api_key).toMatch(/^\*+9876$/)
    expect(redacted.arr[1].value).toBe('ok')
  })

  it('preserves token accounting and other diagnostic values', () => {
    const redacted = redactBody({
      input_tokens: 120,
      inputTokens: 120,
      output_tokens: 80,
      output_token: 80,
      outputToken: 80,
      reasoning_tokens: 30,
      max_tokens: 4_096,
      stop_reason: 'tool_use',
      signature: 'provider-replay-signature',
      nested: {
        accessToken: 'ordinary-tool-value',
        clientSecret: 'ordinary-tool-value'
      }
    }) as Record<string, unknown>

    expect(redacted).toMatchObject({
      input_tokens: 120,
      inputTokens: 120,
      output_tokens: 80,
      output_token: 80,
      outputToken: 80,
      reasoning_tokens: 30,
      max_tokens: 4_096,
      stop_reason: 'tool_use',
      signature: 'provider-replay-signature',
      nested: {
        accessToken: 'ordinary-tool-value',
        clientSecret: 'ordinary-tool-value'
      }
    })
  })

  it('preserves request URLs while masking embedded credentials', () => {
    const redacted = redactBody({
      image: new URL('https://user:password@example.com/image.png?width=640&apiKey=credential')
    }) as { image: string }

    const image = new URL(redacted.image)
    expect(image.username).not.toBe('user')
    expect(image.password).not.toBe('password')
    expect(image.searchParams.get('width')).toBe('640')
    expect(image.searchParams.get('apiKey')).toBe('***MASKED***')
  })
})
