import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

type CopilotFixture = {
  mode: 'accept' | 'hold'
  entered: boolean
  release(): void
}

test.use({ privacyModeEnabled: true })

test('Copilot sign-in acknowledges current credentials and rejects stale configuration @smoke', async ({
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

  await active.electronApp.evaluate(({ BrowserWindow, clipboard, shell }) => {
    const originalFetch = globalThis.fetch
    const originalLoad = BrowserWindow.prototype.loadURL
    let release: (() => void) | undefined
    const fixture: CopilotFixture = {
      mode: 'accept',
      entered: false,
      release() {
        release?.()
      }
    }
    BrowserWindow.prototype.loadURL = function (url, options) {
      const loading = originalLoad.call(this, url, options)
      if (url.startsWith('data:') && url.includes('GitHub%20Copilot%20Device%20Authentication')) {
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
      if (url === 'https://github.com/login/oauth/access_token')
        return Response.json({ access_token: 'new-disposable-token' })
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
  })
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
  } finally {
    await active.electronApp.evaluate(() =>
      (
        globalThis as typeof globalThis & { copilotFixture: CopilotFixture }
      ).copilotFixture.release()
    )
    expect(await active.close()).toBe('graceful')
  }
  active = await launchApp()
  await waitForAppReady(active.page)
  expect(
    (await active.page.evaluate(() => window.deepchat.invoke('providers.list', {}))).providers.find(
      (entry) => entry.id === provider.id
    )
  ).toMatchObject({ name: 'Current Copilot', apiKey: 'newer-disposable-token', enable: false })
  expect(await active.close()).toBe('graceful')
})
