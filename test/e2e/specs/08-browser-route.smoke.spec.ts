import { test, expect } from '../fixtures/electronApp'
import { createSmokeToken } from '../helpers/testData'
import { waitForAppReady } from '../helpers/wait'
import { openSettings } from '../helpers/settings'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { Socket } from 'node:net'

test('browser typed routes load status and destroy without legacy IPC @smoke', async ({ app }) => {
  await waitForAppReady(app.page)
  const titlePrefix = `DeepChat Browser ${createSmokeToken('route').toLowerCase()}`
  const browser = await app.page.evaluateHandle(
    async ({ titlePrefix }) => {
      const created = await window.deepchat.invoke('sessions.create', {
        agentId: 'deepchat',
        message: '',
        providerId: 'openai',
        modelId: 'gpt-4o-mini'
      })
      const sessionId = created.session.id
      await window.deepchat.invoke('sessions.activate', { sessionId })
      const title = `${titlePrefix} ${sessionId}`
      const url = `data:text/html;charset=utf-8,${encodeURIComponent(
        `<!doctype html><html><head><title>${title}</title></head><body><h1>${sessionId}</h1></body></html>`
      )}`
      const events: Array<{ reason: string; initialized: boolean }> = []
      const unsubscribe = window.deepchat.on('browser.status.changed', (payload) => {
        if (payload.sessionId === sessionId)
          events.push({ reason: payload.reason, initialized: Boolean(payload.status?.initialized) })
      })
      try {
        const loaded = await window.deepchat.invoke('browser.loadUrl', {
          sessionId,
          url,
          timeoutMs: 15_000
        })
        let afterLoad = await window.deepchat.invoke('browser.getStatus', { sessionId })
        for (let index = 0; index < 20 && afterLoad.status.page?.status !== 'ready'; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          afterLoad = await window.deepchat.invoke('browser.getStatus', { sessionId })
        }
        await window.deepchat.invoke('browser.attachCurrentWindow', { sessionId })
        await window.deepchat.invoke('browser.updateCurrentWindowBounds', {
          sessionId,
          bounds: { x: 20, y: 80, width: 400, height: 300 },
          visible: true
        })
        return { sessionId, title, url, loaded, afterLoad, events, unsubscribe }
      } catch (error) {
        unsubscribe()
        await window.deepchat.invoke('browser.destroy', { sessionId }).catch(() => undefined)
        await window.deepchat.invoke('sessions.delete', { sessionId }).catch(() => undefined)
        throw error
      }
    },
    { titlePrefix }
  )
  try {
    await app.page.evaluate(() => window.deepchat.invoke('window.focusMain', {}))
    const nativeWindow = await app.electronApp.browserWindow(app.page)
    await app.electronApp.evaluate(({ app }) => {
      if (process.platform === 'darwin') app.show()
      app.focus({ steal: true })
    })
    await nativeWindow.evaluate((window) => {
      window.show()
      window.focus()
    })
    await expect
      .poll(() => nativeWindow.evaluate((window) => window.isVisible() && window.isFocused()))
      .toBe(true)
    const result = await browser.evaluate(async (browser) => {
      const { sessionId } = browser
      const focused = await window.deepchat.invoke('browser.focusContent', { sessionId })
      await window.deepchat.invoke('sessions.deactivate', {})
      const inactiveFocus = await window.deepchat.invoke('browser.focusContent', { sessionId })
      await window.deepchat.invoke('browser.destroy', { sessionId })
      const afterDestroy = await window.deepchat.invoke('browser.getStatus', { sessionId })
      await new Promise((resolve) => setTimeout(resolve, 300))
      return {
        afterDestroy,
        afterLoad: browser.afterLoad,
        events: browser.events,
        loaded: browser.loaded,
        title: browser.title,
        url: browser.url,
        focused,
        inactiveFocus
      }
    })
    expect(result.focused).toEqual({ focused: true })
    expect(result.inactiveFocus).toEqual({ focused: false })
    expect(result.loaded.status.initialized).toBe(true)
    expect(result.loaded.status.page?.url).toBe(result.url)
    expect(result.afterLoad.status.initialized).toBe(true)
    expect(result.afterLoad.status.page?.status).toBe('ready')
    expect(result.afterLoad.status.page?.title).toBe(result.title)
    expect(result.afterDestroy.status).toMatchObject({
      initialized: false,
      page: null,
      visible: false
    })
    expect(result.events.map((event) => event.reason)).toEqual(
      expect.arrayContaining(['created', 'updated', 'closed'])
    )
  } finally {
    await browser.evaluate(async ({ sessionId, unsubscribe }) => {
      unsubscribe()
      await window.deepchat.invoke('browser.destroy', { sessionId }).catch(() => undefined)
      await window.deepchat.invoke('sessions.delete', { sessionId }).catch(() => undefined)
    })
    await browser.dispose()
  }
})

test('Browser pages retire held HTTP and WebSocket work on destroy, quit and Core loss @smoke', async ({
  launchApp
}) => {
  const started = new Set<string>()
  const closed = new Set<string>()
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    const route = request.url ?? ''
    if (route.startsWith('/page/')) {
      const mode = route.split('/').at(-1)
      response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html>
        <title>Owned Browser ${mode}</title><body>Browser retirement</body><script>
        window.pending = [
          fetch('/headers/${mode}').then(response => response.text()).catch(() => {}),
          fetch('/body/${mode}').then(response => response.text()).catch(() => {})
        ]
        window.socket = new WebSocket('ws://' + location.host + '/socket/${mode}')
        window.onbeforeunload = () => 'Keep this page open'
        </script>`)
      return
    }
    if (!route.startsWith('/headers/') && !route.startsWith('/body/')) {
      response.writeHead(404).end()
      return
    }
    started.add(route)
    response.once('close', () => closed.add(route))
    if (route.startsWith('/body/')) {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.write('held response body')
    }
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key']
    if (!key) {
      socket.destroy()
      return
    }
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
    const route = request.url ?? ''
    started.add(route)
    socket.once('close', () => closed.add(route))
    socket.on('error', () => {})
    socket.on('data', (frame: Buffer) => {
      if ((frame[0] & 0x0f) === 8) socket.end(Buffer.from([0x88, 0]))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let active: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    for (const mode of ['destroy', 'quit', 'failure'] as const) {
      active = await launchApp()
      expect(active.ownsUserDataDir).toBe(true)
      await waitForAppReady(active.page)
      const appProcess = active.electronApp.process()
      const settings = mode === 'failure' ? await openSettings(active) : undefined
      const { session } = await active.page.evaluate(() =>
        window.deepchat.invoke('sessions.create', {
          agentId: 'deepchat',
          message: '',
          providerId: 'openai',
          modelId: 'gpt-4o-mini'
        })
      )
      const loaded = await active.page.evaluate(
        (input) => window.deepchat.invoke('browser.loadUrl', input),
        { sessionId: session.id, url: `${origin}/page/${mode}`, timeoutMs: 15_000 }
      )
      expect(loaded.status.initialized).toBe(true)
      const routes = [`/headers/${mode}`, `/body/${mode}`, `/socket/${mode}`]
      await expect.poll(() => routes.every((route) => started.has(route))).toBe(true)
      expect(routes.some((route) => closed.has(route))).toBe(false)
      if (mode === 'destroy') {
        await active.page.evaluate(
          (sessionId) => window.deepchat.invoke('browser.destroy', { sessionId }),
          session.id
        )
        expect(
          await active.page.evaluate(
            (sessionId) => window.deepchat.invoke('browser.getStatus', { sessionId }),
            session.id
          )
        ).toMatchObject({ status: { initialized: false } })
        expect(appProcess.exitCode).toBeNull()
      } else if (settings) {
        await active.electronApp.evaluate(({ webContents }, url) => {
          const target = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL() === url)
          if (!target) throw new Error('Owned settings renderer is missing')
          const original = webContents.fromId
          webContents.fromId = (id) => {
            if (id === target.id) throw new Error('Native renderer registration was refused')
            return original.call(webContents, id)
          }
        }, settings.url())
        const pending = settings
          .evaluate(() =>
            window.deepchat.invoke('sessions.create', {
              agentId: 'deepchat',
              providerId: 'openai',
              modelId: 'gpt-4o-mini',
              message: ''
            })
          )
          .catch(() => undefined)
        await expect.poll(() => appProcess.exitCode).toBe(1)
        await pending
      } else expect(await active.close()).toBe('graceful')
      await expect.poll(() => routes.every((route) => closed.has(route))).toBe(true)
      await test.info().attach(`browser-retirement-${mode}`, {
        body: JSON.stringify({ mode, closed: routes.filter((route) => closed.has(route)) }),
        contentType: 'application/json'
      })
      if (mode === 'destroy') expect(await active.close()).toBe('graceful')
      active = await launchApp()
      await waitForAppReady(active.page)
      expect(
        await active.page.evaluate(
          (sessionId) => window.deepchat.invoke('browser.getStatus', { sessionId }),
          session.id
        )
      ).toMatchObject({ status: { initialized: false } })
      expect(
        (
          await active.page.evaluate(() => window.deepchat.invoke('sessions.listLightweight', {}))
        ).items.some((item) => item.id === session.id)
      ).toBe(true)
      expect(await active.close()).toBe('graceful')
    }
  } finally {
    await active?.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
