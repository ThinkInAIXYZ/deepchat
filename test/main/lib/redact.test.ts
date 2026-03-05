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
        client_secret: 'foo-bar-5678',
        keep: 'safe'
      },
      arr: [{ api_key: 'zxcv9876' }, { value: 'ok' }]
    }) as {
      token: string
      nested: { client_secret: string; keep: string }
      arr: Array<{ api_key?: string; value?: string }>
    }

    expect(redacted.token).toMatch(/^\*+2345$/)
    expect(redacted.nested.client_secret).toMatch(/^\*+5678$/)
    expect(redacted.nested.keep).toBe('safe')
    expect(redacted.arr[0].api_key).toMatch(/^\*+9876$/)
    expect(redacted.arr[1].value).toBe('ok')
  })
})
