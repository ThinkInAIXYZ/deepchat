import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'
import { startHttpsFixture } from '../helpers/httpsFixture'

test.use({ privacyModeEnabled: true })

test('Provider OAuth preserves legacy private files and durable logout @smoke', async ({
  launchApp
}) => {
  const requests: Array<{
    host: string | undefined
    path: string | undefined
    method: string | undefined
    token: string | null
    clientId: string | null
  }> = []
  const https = await startHttpsFixture(['auth.openai.com', 'auth.x.ai'], (request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const form = new URLSearchParams(body)
      requests.push({
        host: request.headers.host,
        path: request.url,
        method: request.method,
        token: form.get('token'),
        clientId: form.get('client_id')
      })
      if (
        request.headers.host === 'auth.x.ai' &&
        request.url === '/.well-known/openid-configuration' &&
        request.method === 'GET'
      ) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            device_authorization_endpoint: 'https://auth.x.ai/device',
            token_endpoint: 'https://auth.x.ai/token',
            revocation_endpoint: 'https://auth.x.ai/oauth/revoke'
          })
        )
      } else if (request.url === '/oauth/revoke' && request.method === 'POST') {
        response.writeHead(200).end()
      } else {
        response.writeHead(404).end()
      }
    })
  })
  let cleanupApp: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const first = await launchApp()
    cleanupApp = first
    expect(first.ownsUserDataDir).toBe(true)
    await waitForAppReady(first.page)
    await first.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
    }, https.proxyUrl)
    const fixtures = ['openai-codex-auth', 'xai-grok-auth'].map((directory) => ({
      file: join(first.userDataDir, directory, 'credentials.json'),
      tokens: {
        accessToken: `disposable-${directory}-access`,
        refreshToken: `disposable-${directory}-refresh`,
        tokenType: 'Bearer',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        accountId: 'fixture-account-12345678',
        accountLabel: 'Fixture account',
        updatedAt: 42
      }
    }))
    const wrapped = await first.electronApp.evaluate(
      ({ safeStorage }, tokens) =>
        tokens.map((value) => safeStorage.encryptString(JSON.stringify(value)).toString('base64')),
      fixtures.map((fixture) => fixture.tokens)
    )
    expect(await first.close()).toBe('graceful')
    for (const fixture of fixtures) {
      mkdirSync(dirname(fixture.file), { recursive: true, mode: 0o700 })
      writeFileSync(
        fixture.file,
        JSON.stringify({ version: 1, storage: 'file', tokens: fixture.tokens, updatedAt: 42 }),
        { mode: 0o600 }
      )
    }

    for (const storage of ['file', 'safeStorage'] as const) {
      if (storage === 'safeStorage')
        fixtures.forEach((fixture, index) => {
          writeFileSync(
            fixture.file,
            JSON.stringify({ version: 1, storage, wrapped: wrapped[index], updatedAt: 42 }),
            { mode: 0o600 }
          )
        })
      const before = fixtures.map((fixture) => readFileSync(fixture.file, 'utf8'))
      const active = await launchApp()
      cleanupApp = active
      await waitForAppReady(active.page)
      const settings = await openSettings(active)
      const statuses = await settings.evaluate(async () => [
        (await window.deepchat.invoke('oauth.openaiCodex.getStatus', {})).status,
        (await window.deepchat.invoke('oauth.xaiGrok.getStatus', {})).status
      ])
      for (const status of statuses) {
        expect(status).toMatchObject({
          state: 'authenticated',
          authenticated: true,
          accountLabel: 'Fixture account'
        })
        expect(JSON.stringify(status)).not.toContain('disposable-')
      }
      await settings.evaluate(async () => {
        await window.deepchat.invoke('oauth.openaiCodex.cancelLogin', {})
        await window.deepchat.invoke('oauth.xaiGrok.cancelLogin', {})
      })
      expect(fixtures.map((fixture) => readFileSync(fixture.file, 'utf8'))).toEqual(before)
      expect(requests).toEqual([])
      if (storage === 'safeStorage') {
        const loggedOut = await settings.evaluate(async () => [
          (await window.deepchat.invoke('oauth.openaiCodex.logout', {})).status,
          (await window.deepchat.invoke('oauth.xaiGrok.logout', {})).status
        ])
        expect(
          loggedOut.every((status) => status.state === 'signed-out' && !status.authenticated)
        ).toBe(true)
        expect(requests.filter((request) => request.path === '/oauth/revoke')).toEqual([
          {
            host: 'auth.openai.com',
            path: '/oauth/revoke',
            method: 'POST',
            token: fixtures[0].tokens.refreshToken,
            clientId: expect.stringMatching(/\S/)
          },
          {
            host: 'auth.x.ai',
            path: '/oauth/revoke',
            method: 'POST',
            token: fixtures[1].tokens.refreshToken,
            clientId: expect.stringMatching(/\S/)
          }
        ])
        expect(requests.filter((request) => request.method === 'GET')).toEqual([
          {
            host: 'auth.x.ai',
            path: '/.well-known/openid-configuration',
            method: 'GET',
            token: null,
            clientId: null
          }
        ])
        expect(fixtures.every((fixture) => !existsSync(fixture.file))).toBe(true)
      }
      expect(await active.close()).toBe('graceful')
    }
    const final = await launchApp()
    cleanupApp = final
    await waitForAppReady(final.page)
    const settings = await openSettings(final)
    const statuses = await settings.evaluate(async () => [
      (await window.deepchat.invoke('oauth.openaiCodex.getStatus', {})).status,
      (await window.deepchat.invoke('oauth.xaiGrok.getStatus', {})).status
    ])
    expect(statuses.every((status) => status.state === 'signed-out' && !status.authenticated)).toBe(
      true
    )
    expect(await final.close()).toBe('graceful')
  } finally {
    try {
      await cleanupApp?.close()
    } finally {
      await https.close()
    }
  }
})
