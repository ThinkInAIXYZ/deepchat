import { createServer } from 'node:net'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

type AuthFixture = { windows: number[]; restore(): void }

test.use({ privacyModeEnabled: true })

test('remote login windows preserve nonce checks, native close and account relaunch @smoke', async ({
  launchApp
}) => {
  let active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  await waitForAppReady(active.page)
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No callback port')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  const redirectUri = `http://127.0.0.1:${address.port}/remote/feishu/auth/callback`

  await active.electronApp.evaluate(({ BrowserWindow }) => {
    const originalFetch = globalThis.fetch
    const originalLoad = BrowserWindow.prototype.loadURL
    const fixture: AuthFixture = {
      windows: [],
      restore() {
        globalThis.fetch = originalFetch
        BrowserWindow.prototype.loadURL = originalLoad
      }
    }
    BrowserWindow.prototype.loadURL = function (url, options) {
      if (
        url.startsWith('https://accounts.feishu.cn/') ||
        url.startsWith('https://liteapp.weixin.qq.com/')
      ) {
        fixture.windows.push(this.id)
        return originalLoad.call(this, 'data:text/html,<title>Remote auth fixture</title>')
      }
      return originalLoad.call(this, url, options)
    }
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('/ilink/bot/get_bot_qrcode')) {
        return Response.json({
          qrcode: 'fixture-qr',
          qrcode_img_content: 'https://liteapp.weixin.qq.com/fixture'
        })
      }
      if (url.includes('/ilink/bot/get_qrcode_status')) {
        return Response.json({
          status: 'confirmed',
          ilink_bot_id: 'native-fixture-bot',
          ilink_user_id: 'native-fixture-owner',
          bot_token: 'disposable-native-token'
        })
      }
      return await originalFetch(input, init)
    }
    ;(globalThis as typeof globalThis & { remoteAuthFixture: AuthFixture }).remoteAuthFixture =
      fixture
  })
  try {
    const startFeishu = () =>
      active.page.evaluate(
        (redirectUri) =>
          window.deepchat.invoke('remoteControl.startFeishuAuth', {
            appId: 'native-fixture',
            appSecret: 'disposable-native-secret',
            redirectUri
          }),
        redirectUri
      )
    const first = await startFeishu()
    const nodeAvailable = await active.electronApp.evaluate(({ BrowserWindow }) => {
      const fixture = (globalThis as typeof globalThis & { remoteAuthFixture: AuthFixture })
        .remoteAuthFixture
      return BrowserWindow.fromId(fixture.windows.at(-1)!)!.webContents.executeJavaScript(
        "typeof require !== 'undefined' || typeof process !== 'undefined'"
      )
    })
    expect(nodeAvailable).toBe(false)
    const waiting = active.page.evaluate(
      (sessionKey) => window.deepchat.invoke('remoteControl.waitForFeishuAuth', { sessionKey }),
      first.session.sessionKey
    )
    const callback = await fetch(`${redirectUri}?code=fixture-code&state=incorrect-nonce`)
    expect(callback.status).toBe(400)
    await callback.text()
    expect((await waiting).result).toMatchObject({
      authorized: false,
      messageKey: 'settings.remote.feishu.authStateMismatch'
    })

    const second = await startFeishu()
    await active.electronApp.evaluate(({ BrowserWindow }) => {
      const fixture = (globalThis as typeof globalThis & { remoteAuthFixture: AuthFixture })
        .remoteAuthFixture
      BrowserWindow.fromId(fixture.windows.at(-1)!)!.close()
    })
    expect(
      (
        await active.page.evaluate(
          (sessionKey) => window.deepchat.invoke('remoteControl.waitForFeishuAuth', { sessionKey }),
          second.session.sessionKey
        )
      ).result
    ).toMatchObject({ authorized: false, messageKey: 'settings.remote.feishu.authCancelled' })

    const login = await active.page.evaluate(() =>
      window.deepchat.invoke('remoteControl.startWeixinIlinkLogin', {})
    )
    expect(
      (
        await active.page.evaluate(
          (sessionKey) =>
            window.deepchat.invoke('remoteControl.waitForWeixinIlinkLogin', { sessionKey }),
          login.session.sessionKey
        )
      ).result
    ).toMatchObject({
      connected: true,
      account: { accountId: 'native-fixture-bot', ownerUserId: 'native-fixture-owner' }
    })
    await expect
      .poll(() =>
        active.electronApp.evaluate(({ BrowserWindow }) => {
          const fixture = (globalThis as typeof globalThis & { remoteAuthFixture: AuthFixture })
            .remoteAuthFixture
          return fixture.windows.some((id) => BrowserWindow.fromId(id) !== null)
        })
      )
      .toBe(false)
  } finally {
    await active.electronApp.evaluate(() =>
      (
        globalThis as typeof globalThis & { remoteAuthFixture: AuthFixture }
      ).remoteAuthFixture.restore()
    )
  }
  expect(await active.close()).toBe('graceful')
  active = await launchApp()
  await waitForAppReady(active.page)
  const settings = await active.page.evaluate(() =>
    window.deepchat.invoke('remoteControl.getChannelSettings', { channel: 'weixin-ilink' })
  )
  expect(settings.settings).toMatchObject({
    remoteEnabled: false,
    accounts: [{ accountId: 'native-fixture-bot', ownerUserId: 'native-fixture-owner' }]
  })
  expect(await active.close()).toBe('graceful')
})
