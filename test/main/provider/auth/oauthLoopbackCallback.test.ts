import { describe, expect, it } from 'vitest'
import http from 'node:http'
import {
  resolveOAuthLoopbackCallbackUrl,
  startOAuthLoopbackCallbackSession
} from '@/provider/auth/oauthLoopbackCallback'

describe('OAuth loopback callback', () => {
  it('shows success only after state and issuer validation succeed', async () => {
    const session = await startOAuthLoopbackCallbackSession({
      expectedState: 'expected',
      path: '/oauth/callback',
      validateParameters: (parameters) => {
        if (parameters.get('iss') !== 'https://issuer.example') {
          throw new Error('issuer mismatch')
        }
      }
    })
    const callback = session.waitForCallback()

    const response = await fetch(
      `${session.redirectUri}?code=code&state=expected&iss=${encodeURIComponent(
        'https://issuer.example'
      )}`
    )

    await expect(callback).resolves.toMatchObject({ code: 'code', state: 'expected' })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Authentication complete')
  })

  it('returns a generic failure page for an invalid callback without reflecting OAuth errors', async () => {
    const session = await startOAuthLoopbackCallbackSession({
      expectedState: 'expected',
      path: '/oauth/callback'
    })
    const callback = expect(session.waitForCallback()).rejects.toThrow('Invalid OAuth callback')

    const response = await fetch(
      `${session.redirectUri}?error=access_denied&error_description=private-detail&state=wrong`
    )

    await callback
    expect(response.status).toBe(400)
    const body = await response.text()
    expect(body).toContain('Authentication failed')
    expect(body).not.toContain('access_denied')
    expect(body).not.toContain('private-detail')
  })

  it('rejects pasted callback URLs with embedded credentials or fragments', () => {
    const redirectUri = 'http://localhost:9876/oauth/callback'

    expect(
      resolveOAuthLoopbackCallbackUrl(
        'http://user:secret@localhost:9876/oauth/callback?code=code&state=expected',
        'expected',
        redirectUri
      )
    ).toEqual({ kind: 'not-found' })
    expect(
      resolveOAuthLoopbackCallbackUrl(
        'http://localhost:9876/oauth/callback?code=code&state=expected#hidden',
        'expected',
        redirectUri
      )
    ).toEqual({ kind: 'not-found' })
  })

  it('returns a bounded error for a malformed Host header', async () => {
    const session = await startOAuthLoopbackCallbackSession({
      expectedState: 'expected',
      path: '/oauth/callback'
    })
    const redirect = new URL(session.redirectUri)
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = http.request(
        {
          hostname: '127.0.0.1',
          port: Number(redirect.port),
          path: redirect.pathname,
          headers: { Host: '[' }
        },
        (incoming) => {
          const chunks: Buffer[] = []
          incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          incoming.on('end', () => {
            resolve({
              status: incoming.statusCode || 0,
              body: Buffer.concat(chunks).toString('utf8')
            })
          })
        }
      )
      request.on('error', reject)
      request.end()
    })
    session.close()

    expect(response).toEqual({ status: 400, body: 'Invalid request' })
  })
})
