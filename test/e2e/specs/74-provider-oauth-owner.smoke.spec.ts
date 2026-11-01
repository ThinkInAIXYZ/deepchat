import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'
import { startHttpsFixture } from '../helpers/httpsFixture'
import { readFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { join } from 'node:path'

type CopilotFixture = {
  mode: 'accept' | 'present'
  presented: boolean
  oauthRequests: number
}

test.use({ privacyModeEnabled: true })

test('Copilot sign-in preserves credentials and drains native authorization at quit @smoke', async ({
  launchApp
}) => {
  const heldValidation: ServerResponse[] = []
  const authorizations: Array<string | undefined> = []
  let holdValidation = false
  const respond = (response: ServerResponse) =>
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        token: 'disposable-copilot-session',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      })
    )
  const releaseValidation = () => {
    holdValidation = false
    for (const response of heldValidation.splice(0)) if (!response.destroyed) respond(response)
  }
  const https = await startHttpsFixture(['api.github.com'], (request, response) => {
    if (request.url !== '/copilot_internal/v2/token') {
      response.writeHead(404).end()
      return
    }
    authorizations.push(request.headers.authorization)
    if (holdValidation) heldValidation.push(response)
    else respond(response)
  })
  let cleanupApp: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    let active = await launchApp()
    cleanupApp = active
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    await active.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
    }, https.proxyUrl)
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
      let windowClosed = false
      const fixture: CopilotFixture = {
        mode: 'accept',
        presented: false,
        oauthRequests: 0
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
        return await originalFetch(input, init)
      }
      ;(globalThis as typeof globalThis & { copilotFixture: CopilotFixture }).copilotFixture =
        fixture
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
      expect(authorizations).toEqual(['token new-disposable-token'])

      holdValidation = true
      const login = active.page.evaluate(
        (providerId) =>
          window.deepchat.invoke('oauth.githubCopilot.startDeviceFlowLogin', { providerId }),
        provider.id
      )
      const stale = expect(login).rejects.toThrow('configuration changed')
      await expect.poll(() => heldValidation.length).toBe(1)
      const current = await readProvider()
      await active.page.evaluate(
        (provider) =>
          window.deepchat.invoke('providers.setById', { providerId: provider.id, provider }),
        { ...current, name: 'Current Copilot', apiKey: 'newer-disposable-token' }
      )
      releaseValidation()
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
      releaseValidation()
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
    cleanupApp = active
    await waitForAppReady(active.page)
    expect(
      (
        await active.page.evaluate(() => window.deepchat.invoke('providers.list', {}))
      ).providers.find((entry) => entry.id === provider.id)
    ).toMatchObject({ name: 'Current Copilot', apiKey: 'newer-disposable-token', enable: false })
    expect(await active.close()).toBe('graceful')
  } finally {
    releaseValidation()
    try {
      await cleanupApp?.close()
    } finally {
      await https.close()
    }
  }
})

test('Native authorization HTTP drains current and retired proxy pools at quit @smoke', async ({
  launchApp
}) => {
  const sockets = new Set<Socket>()
  const requests: ServerResponse[] = []
  const server = createServer((request, response) => {
    if (request.url === '/native-code') requests.push(response)
    else response.writeHead(404).end()
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let active: Awaited<ReturnType<typeof launchApp>> | undefined
  const pending: Promise<unknown>[] = []
  try {
    active = await launchApp()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    const provider = (
      await active.page.evaluate(() => window.deepchat.invoke('providers.list', {}))
    ).providers.find((entry) => entry.apiType === 'github-copilot')
    if (!provider) throw new Error('Missing built-in GitHub Copilot provider')
    await active.page.evaluate(
      async (provider) => {
        await window.deepchat.invoke('config.setProxyMode', { mode: 'none' })
        await window.deepchat.invoke('providers.setById', { providerId: provider.id, provider })
      },
      { ...provider, apiKey: 'unchanged-native-http-token', enable: false }
    )
    await active.electronApp.evaluate((_electron, origin) => {
      const original = globalThis.fetch
      globalThis.fetch = async (input, init) => {
        if (String(input) === 'https://github.com/login/device/code') {
          // Ignore caller abort so retirement must reach the actual transport.
          return await original(`${origin}/native-code`, { ...init, signal: undefined })
        }
        return await original(input, init)
      }
    }, origin)
    pending.push(
      active.page
        .evaluate(
          (providerId) =>
            window.deepchat.invoke('oauth.githubCopilot.startDeviceFlowLogin', { providerId }),
          provider.id
        )
        .catch(() => undefined)
    )
    await expect.poll(() => requests.length).toBe(1)
    await active.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
    }, origin)
    pending.push(
      active.page
        .evaluate(
          (providerId) =>
            window.deepchat.invoke('oauth.githubCopilot.startDeviceFlowLogin', { providerId }),
          provider.id
        )
        .catch(() => undefined)
    )
    await expect.poll(() => requests.length).toBe(2)
    const disconnected = requests.map(
      (response) => new Promise<void>((resolve) => response.once('close', resolve))
    )
    expect(await active.close()).toBe('graceful')
    await Promise.all(disconnected)
    await Promise.all(pending)
    expect(requests.every((response) => response.destroyed)).toBe(true)
    await test.info().attach('native-http-retirement', {
      body: JSON.stringify({
        requests: requests.length,
        disconnected: requests.every((response) => response.destroyed)
      }),
      contentType: 'application/json'
    })
    active = await launchApp()
    await waitForAppReady(active.page)
    expect(
      (
        await active.page.evaluate(() => window.deepchat.invoke('providers.list', {}))
      ).providers.find((entry) => entry.id === provider.id)
    ).toMatchObject({ apiKey: 'unchanged-native-http-token', enable: false })
    expect(await active.close()).toBe('graceful')
  } finally {
    for (const socket of sockets) socket.destroy()
    await active?.close()
    await Promise.all(pending)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
