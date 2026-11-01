import { createServer } from 'node:net'
import type { ServerResponse } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import { openSettings } from '../helpers/settings'
import { startHttpsFixture } from '../helpers/httpsFixture'

type AuthFixture = { windows: number[]; restore(): void }

test.use({ privacyModeEnabled: true })

test('remote login windows preserve nonce checks, native close and account relaunch @smoke', async ({
  launchApp
}) => {
  const https = await startHttpsFixture(['ilinkai.weixin.qq.com'], (request, response) => {
    const body = request.url?.startsWith('/ilink/bot/get_bot_qrcode')
      ? { qrcode: 'fixture-qr', qrcode_img_content: 'https://liteapp.weixin.qq.com/fixture' }
      : request.url?.startsWith('/ilink/bot/get_qrcode_status')
        ? {
            status: 'confirmed',
            ilink_bot_id: 'native-fixture-bot',
            ilink_user_id: 'native-fixture-owner',
            bot_token: 'disposable-native-token'
          }
        : undefined
    response
      .writeHead(body ? 200 : 404, { 'content-type': 'application/json' })
      .end(JSON.stringify(body ?? {}))
  })
  let active = await launchApp().catch(async (error) => {
    await https.close()
    throw error
  })
  try {
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    await active.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
    }, https.proxyUrl)
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No callback port')
    await new Promise<void>((resolve) => server.close(() => resolve()))
    const redirectUri = `http://127.0.0.1:${address.port}/remote/feishu/auth/callback`
    await active.electronApp.evaluate(({ BrowserWindow }) => {
      const originalLoad = BrowserWindow.prototype.loadURL
      const fixture: AuthFixture = {
        windows: [],
        restore() {
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
            (sessionKey) =>
              window.deepchat.invoke('remoteControl.waitForFeishuAuth', { sessionKey }),
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
  } finally {
    try {
      await active.close()
    } finally {
      await https.close()
    }
  }
})

test('remote open activates an existing or newly created chat window @smoke', async ({
  launchApp
}) => {
  const messages: string[] = []
  const replies: string[] = []
  let held: ServerResponse | undefined
  let updateId = 0
  const flush = () => {
    if (!held || held.destroyed || !messages.length) return
    const response = held
    held = undefined
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        ok: true,
        result: messages.splice(0).map((text) => ({
          update_id: ++updateId,
          message: {
            message_id: updateId,
            chat: { id: 4242, type: 'private' },
            from: { id: 4242 },
            text
          }
        }))
      })
    )
  }
  const https = await startHttpsFixture(['api.telegram.org'], async (request, response) => {
    const method = request.url?.slice('/botdisposable-window-fixture/'.length)
    const reply = (result: unknown) =>
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: true, result }))
    if (method === 'getMe') reply({ id: 1, username: 'deepchat_fixture_bot' })
    else if (method === 'setMyCommands') reply(true)
    else if (method === 'sendMessage') {
      let body = ''
      for await (const chunk of request) body += chunk
      replies.push(JSON.parse(body).text)
      reply({ message_id: replies.length })
    } else if (method === 'getUpdates') {
      held = response
      response.once('close', () => {
        if (held === response) held = undefined
      })
      flush()
    } else response.writeHead(404).end()
  })
  const active = await launchApp().catch(async (error) => {
    await https.close()
    throw error
  })
  try {
    await waitForAppReady(active.page)
    await active.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
    }, https.proxyUrl)
    const settingsPage = await openSettings(active)
    const settings = {
      botToken: 'disposable-window-fixture',
      remoteEnabled: true,
      defaultAgentId: '',
      defaultWorkdir: ''
    }
    const send = async (text: string, expected: string) => {
      const previous = replies.length
      messages.push(text)
      flush()
      await expect.poll(() => replies.slice(previous).join('\n')).toContain(expected)
    }
    try {
      await settingsPage.evaluate(() =>
        window.deepchat.invoke('config.updateEntries', {
          changes: [
            { key: 'defaultModel', value: { providerId: 'openai', modelId: 'gpt-4o-mini' } }
          ]
        })
      )
      await settingsPage.evaluate(
        (settings) =>
          window.deepchat.invoke('remoteControl.saveChannelSettings', {
            channel: 'telegram',
            settings
          }),
        settings
      )
      const pairing = await settingsPage.evaluate(() =>
        window.deepchat.invoke('remoteControl.createChannelPairCode', { channel: 'telegram' })
      )
      await send(`/pair ${pairing.code}`, 'Pairing complete.')
      await send('/open', 'No bound session.')
      await send('/new Remote window fixture', 'Started a new session:')
      await send('/open', 'Opened on desktop:')
      const first = await active.page.evaluate(() =>
        window.deepchat.invoke('sessions.getActive', {})
      )
      expect(first.session?.title).toBe('Remote window fixture')
      const nativeWindow = await active.electronApp.browserWindow(active.page)
      await nativeWindow.evaluate((window) => window.destroy())

      await send('/open', 'Opened on desktop:')
      await expect
        .poll(
          () =>
            active.electronApp
              .windows()
              .filter((page) => page.url().includes('/renderer/index.html')).length
        )
        .toBe(1)
      const page = active.electronApp
        .windows()
        .find((page) => page.url().includes('/renderer/index.html'))!
      await waitForAppReady(page)
      await expect
        .poll(async () => {
          const { session } = await page.evaluate(() =>
            window.deepchat.invoke('sessions.getActive', {})
          )
          return session?.id
        })
        .toBe(first.session!.id)
      expect(
        (await settingsPage.evaluate(() => window.deepchat.invoke('sessions.getActive', {})))
          .session
      ).toBeNull()
    } finally {
      await settingsPage.evaluate(
        (settings) =>
          window.deepchat.invoke('remoteControl.saveChannelSettings', {
            channel: 'telegram',
            settings: { ...settings, remoteEnabled: false }
          }),
        settings
      )
    }
    expect(await active.close()).toBe('graceful')
  } finally {
    try {
      await active.close()
    } finally {
      await https.close()
    }
  }
})
