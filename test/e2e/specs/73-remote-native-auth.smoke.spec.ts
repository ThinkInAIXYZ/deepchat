import { createServer } from 'node:net'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import { openSettings } from '../helpers/settings'

type AuthFixture = { windows: number[]; restore(): void }
type TelegramFixture = { replies: string[]; send(text: string): void; restore(): void }

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

test('remote open activates an existing or newly created chat window @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  await waitForAppReady(active.page)
  await active.electronApp.evaluate(() => {
    const originalFetch = globalThis.fetch
    const messages: string[] = []
    let flush = () => {}
    let updateId = 0
    const fixture: TelegramFixture = {
      replies: [],
      send(text) {
        messages.push(text)
        flush()
      },
      restore() {
        globalThis.fetch = originalFetch
      }
    }
    globalThis.fetch = async (input, init) => {
      const prefix = 'https://api.telegram.org/botdisposable-window-fixture/'
      const url = String(input)
      if (!url.startsWith(prefix)) return await originalFetch(input, init)
      const method = url.slice(prefix.length)
      if (method === 'getMe')
        return Response.json({ ok: true, result: { id: 1, username: 'deepchat_fixture_bot' } })
      if (method === 'setMyCommands') return Response.json({ ok: true, result: true })
      if (method === 'sendMessage') {
        fixture.replies.push((JSON.parse(String(init?.body)) as { text: string }).text)
        return Response.json({ ok: true, result: { message_id: fixture.replies.length } })
      }
      if (method !== 'getUpdates') throw new Error(`Unexpected Telegram request: ${method}`)
      return await new Promise<Response>((resolve, reject) => {
        const signal = init?.signal
        const abort = () => {
          signal?.removeEventListener('abort', abort)
          flush = () => {}
          reject(signal?.reason)
        }
        flush = () => {
          if (!messages.length) return
          signal?.removeEventListener('abort', abort)
          flush = () => {}
          resolve(
            Response.json({
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
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        else flush()
      })
    }
    ;(globalThis as typeof globalThis & { telegramFixture: TelegramFixture }).telegramFixture =
      fixture
  })
  const settingsPage = await openSettings(active)
  const settings = {
    botToken: 'disposable-window-fixture',
    remoteEnabled: true,
    defaultAgentId: '',
    defaultWorkdir: ''
  }
  const send = async (text: string, expected: string) => {
    const previous = await active.electronApp.evaluate((_electron, text) => {
      const fixture = (globalThis as typeof globalThis & { telegramFixture: TelegramFixture })
        .telegramFixture
      const count = fixture.replies.length
      fixture.send(text)
      return count
    }, text)
    await expect
      .poll(() =>
        active.electronApp.evaluate((_electron, previous) => {
          const fixture = (globalThis as typeof globalThis & { telegramFixture: TelegramFixture })
            .telegramFixture
          return fixture.replies.slice(previous).join('\n')
        }, previous)
      )
      .toContain(expected)
  }
  try {
    await settingsPage.evaluate(() =>
      window.deepchat.invoke('config.updateEntries', {
        changes: [{ key: 'defaultModel', value: { providerId: 'openai', modelId: 'gpt-4o-mini' } }]
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
    const first = await active.page.evaluate(() => window.deepchat.invoke('sessions.getActive', {}))
    expect(first.session?.title).toBe('Remote window fixture')
    const nativeWindow = await active.electronApp.browserWindow(active.page)
    await nativeWindow.evaluate((window) => window.destroy())

    await send('/open', 'Opened on desktop:')
    await expect
      .poll(
        () =>
          active.electronApp.windows().filter((page) => page.url().includes('/renderer/index.html'))
            .length
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
      (await settingsPage.evaluate(() => window.deepchat.invoke('sessions.getActive', {}))).session
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
    await active.electronApp.evaluate(() =>
      (
        globalThis as typeof globalThis & { telegramFixture: TelegramFixture }
      ).telegramFixture.restore()
    )
  }
  expect(await active.close()).toBe('graceful')
})
