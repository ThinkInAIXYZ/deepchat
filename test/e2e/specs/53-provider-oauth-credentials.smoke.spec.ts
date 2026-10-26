import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { openSettings } from '../helpers/settings'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('Provider OAuth preserves legacy private files and durable logout @smoke', async ({
  launchApp
}) => {
  const first = await launchApp()
  expect(first.ownsUserDataDir).toBe(true)
  await waitForAppReady(first.page)
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
    if (storage === 'safeStorage') {
      await active.electronApp.evaluate(() => {
        const paths: string[] = []
        Object.assign(globalThis, { __oauthFixtureRequests: paths })
        globalThis.fetch = async (input) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          paths.push(url.pathname)
          if (url.pathname.endsWith('/.well-known/openid-configuration'))
            return Response.json({
              device_authorization_endpoint: 'https://auth.x.ai/device',
              token_endpoint: 'https://auth.x.ai/token',
              revocation_endpoint: 'https://auth.x.ai/oauth/revoke'
            })
          if (url.pathname.endsWith('/oauth/revoke')) return new Response(null, { status: 200 })
          throw new Error(`Unexpected fixture request: ${url.origin}${url.pathname}`)
        }
      })
      const loggedOut = await settings.evaluate(async () => [
        (await window.deepchat.invoke('oauth.openaiCodex.logout', {})).status,
        (await window.deepchat.invoke('oauth.xaiGrok.logout', {})).status
      ])
      expect(
        loggedOut.every((status) => status.state === 'signed-out' && !status.authenticated)
      ).toBe(true)
      expect(
        await active.electronApp.evaluate(
          () =>
            (
              globalThis as unknown as { __oauthFixtureRequests: string[] }
            ).__oauthFixtureRequests.filter((path) => path.endsWith('/oauth/revoke')).length
        )
      ).toBe(2)
      expect(fixtures.every((fixture) => !existsSync(fixture.file))).toBe(true)
    }
    expect(await active.close()).toBe('graceful')
  }
  const final = await launchApp()
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
})
