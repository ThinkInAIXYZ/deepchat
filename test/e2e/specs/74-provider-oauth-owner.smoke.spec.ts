import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type CopilotFixture = {
  mode: 'accept' | 'hold' | 'present'
  entered: boolean
  presented: boolean
  oauthRequests: number
  release(): void
}

test.use({ privacyModeEnabled: true })

test('Copilot sign-in preserves credentials and drains native authorization at quit @smoke', async ({
  launchApp
}) => {
  let active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const provider = (
    await active.page.evaluate(() => window.deepchat.invoke('providers.list', {}))
  ).providers.find((entry) => entry.apiType === 'github-copilot')
  if (!provider) throw new Error('Missing built-in GitHub Copilot provider')
  await active.page.evaluate(
    (provider) =>
      window.deepchat.invoke('providers.setById', { providerId: provider.id, provider }),
    { ...provider, apiKey: 'saved-disposable-token', enable: false }
  )

  const retirementReceipt = join(active.userDataDir, 'copilot-native-retirement.json')
  await active.electronApp.evaluate(({ BrowserWindow, clipboard, shell }, receiptPath) => {
    const originalFetch = globalThis.fetch
    const originalLoad = BrowserWindow.prototype.loadURL
    let release: (() => void) | undefined
    let windowClosed = false
    const fixture: CopilotFixture = {
      mode: 'accept',
      entered: false,
      presented: false,
      oauthRequests: 0,
      release() {
        release?.()
      }
    }
    const publishRetirement = () => {
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs')
      fs.writeFileSync(
        receiptPath,
        JSON.stringify({ closed: windowClosed, oauthRequests: fixture.oauthRequests })
      )
    }
    BrowserWindow.prototype.loadURL = function (url, options) {
      const loading = originalLoad.call(this, url, options)
      if (url.startsWith('data:') && url.includes('GitHub%20Copilot%20Device%20Authentication')) {
        if (fixture.mode === 'present') {
          fixture.presented = true
          this.once('closed', () => {
            windowClosed = true
            publishRetirement()
          })
        } else
          void loading.then(() => {
            if (!this.isDestroyed()) this.close()
          })
      }
      return loading
    }
    clipboard.writeText = () => {}
    shell.openExternal = async () => {}
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url === 'https://github.com/login/device/code')
        return Response.json({
          device_code: 'disposable-device',
          user_code: 'TEST-CODE',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 1
        })
      if (url === 'https://github.com/login/oauth/access_token') {
        fixture.oauthRequests++
        if (fixture.mode === 'present') publishRetirement()
        return Response.json({ access_token: 'new-disposable-token' })
      }
      if (url === 'https://api.github.com/copilot_internal/v2/token') {
        fixture.entered = true
        if (fixture.mode === 'hold')
          await new Promise<void>((resolve) => {
            release = resolve
          })
        return Response.json({ token: 'disposable-copilot-session', expires_at: 2_000_000_000 })
      }
      return await originalFetch(input, init)
    }
    ;(globalThis as typeof globalThis & { copilotFixture: CopilotFixture }).copilotFixture = fixture
  }, retirementReceipt)
  let pending: Promise<unknown> | undefined
  try {
    expect(
      await active.page.evaluate(
        (providerId) =>
          window.deepchat.invoke('oauth.githubCopilot.startDeviceFlowLogin', { providerId }),
        provider.id
      )
    ).toEqual({ success: true })
    const readProvider = async () =>
      (
        await active.page.evaluate(() => window.deepchat.invoke('providers.list', {}))
      ).providers.find((entry) => entry.id === provider.id)!
    expect((await readProvider()).apiKey).toBe('new-disposable-token')

    await active.electronApp.evaluate(() => {
      const fixture = (globalThis as typeof globalThis & { copilotFixture: CopilotFixture })
        .copilotFixture
      fixture.mode = 'hold'
      fixture.entered = false
    })
    const login = active.page.evaluate(
      (providerId) =>
        window.deepchat.invoke('oauth.githubCopilot.startDeviceFlowLogin', { providerId }),
      provider.id
    )
    const stale = expect(login).rejects.toThrow('configuration changed')
    await expect
      .poll(() =>
        active.electronApp.evaluate(
          () =>
            (globalThis as typeof globalThis & { copilotFixture: CopilotFixture }).copilotFixture
              .entered
        )
      )
      .toBe(true)
    const current = await readProvider()
    await active.page.evaluate(
      (provider) =>
        window.deepchat.invoke('providers.setById', { providerId: provider.id, provider }),
      { ...current, name: 'Current Copilot', apiKey: 'newer-disposable-token' }
    )
    await active.electronApp.evaluate(() =>
      (
        globalThis as typeof globalThis & { copilotFixture: CopilotFixture }
      ).copilotFixture.release()
    )
    await stale
    expect(await readProvider()).toMatchObject({
      name: 'Current Copilot',
      apiKey: 'newer-disposable-token',
      enable: false
    })
    await active.electronApp.evaluate(() => {
      const fixture = (globalThis as typeof globalThis & { copilotFixture: CopilotFixture })
        .copilotFixture
      fixture.mode = 'present'
      fixture.presented = false
    })
    pending = active.page
      .evaluate(
        (providerId) =>
          window.deepchat.invoke('oauth.githubCopilot.startDeviceFlowLogin', { providerId }),
        provider.id
      )
      .catch(() => undefined)
    await expect
      .poll(() =>
        active.electronApp.evaluate(
          () =>
            (globalThis as typeof globalThis & { copilotFixture: CopilotFixture }).copilotFixture
              .presented
        )
      )
      .toBe(true)
  } finally {
    await active.electronApp.evaluate(() =>
      (
        globalThis as typeof globalThis & { copilotFixture: CopilotFixture }
      ).copilotFixture.release()
    )
    expect(await active.close()).toBe('graceful')
    await pending
  }
  const retired = JSON.parse(readFileSync(retirementReceipt, 'utf8'))
  expect(retired).toEqual({ closed: true, oauthRequests: 2 })
  await test.info().attach('copilot-native-retirement', {
    body: JSON.stringify(retired),
    contentType: 'application/json'
  })
  active = await launchApp()
  await waitForAppReady(active.page)
  expect(
    (await active.page.evaluate(() => window.deepchat.invoke('providers.list', {}))).providers.find(
      (entry) => entry.id === provider.id
    )
  ).toMatchObject({ name: 'Current Copilot', apiKey: 'newer-disposable-token', enable: false })
  expect(await active.close()).toBe('graceful')
})
