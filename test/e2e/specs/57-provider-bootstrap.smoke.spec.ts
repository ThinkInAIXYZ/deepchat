import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test.use({ privacyModeEnabled: true })

test('Provider catalog and request metadata are ready from bootstrap @smoke', async ({ app }) => {
  const requests: Array<{ userAgent?: string; title?: string; referer?: string }> = []
  const server = createServer(async (request, response) => {
    requests.push({
      userAgent: request.headers['user-agent'],
      title: request.headers['x-title']?.toString(),
      referer: request.headers['http-referer']?.toString()
    })
    let body = ''
    for await (const chunk of request) body += chunk
    response.writeHead(200, { 'Content-Type': 'application/json' })
    if (request.url?.endsWith('/models')) {
      response.end(JSON.stringify({ data: [{ id: 'fixture-model', object: 'model' }] }))
    } else {
      response.end(
        JSON.stringify({
          id: 'bootstrap-fixture',
          object: 'chat.completion',
          created: 1,
          model: JSON.parse(body).model,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }
          ]
        })
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    await waitForAppReady(app.page)
    const { catalog } = await app.page.evaluate(() =>
      window.deepchat.invoke('models.getProviderCatalog', { providerId: 'openai' })
    )
    expect(catalog.dbProviderModels.length).toBeGreaterThan(0)
    const result = await app.page.evaluate(
      (baseUrl) =>
        window.deepchat.invoke('providers.validateDraft', {
          provider: {
            id: 'bootstrap-fixture',
            name: 'Bootstrap fixture',
            apiType: 'openai-compatible',
            apiKey: 'disposable-bootstrap-key',
            baseUrl,
            enable: false,
            custom: true
          },
          loadModels: false
        }),
      `http://127.0.0.1:${port}/v1`
    )
    expect(result.isOk).toBe(true)
    const version = await app.electronApp.evaluate(({ app }) => app.getVersion())
    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) {
      expect(request).toEqual({
        userAgent: `DeepChat/${version}`,
        title: 'DeepChat',
        referer: 'https://deepchatai.cn'
      })
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('shutdown cancels and drains catalog refresh without accepting a late response @smoke', async ({
  launchApp
}) => {
  const active = await launchApp()
  expect(active.ownsUserDataDir).toBe(true)
  const appProcess = active.electronApp.process()
  await waitForAppReady(active.page)
  const files = ['providers.json', 'meta.json'].map((name) =>
    join(active.userDataDir, 'provider-db', name)
  )
  const readCache = () =>
    files.map((file) => (existsSync(file) ? readFileSync(file, 'utf8') : null))
  const original = readCache()
  await active.electronApp.evaluate(() => {
    const originalFetch = globalThis.fetch
    const fixture = {
      entered: false,
      signal: undefined as AbortSignal | undefined,
      release: () => {}
    }
    globalThis.fetch = async (input, init) => {
      if (input.toString().includes('/PublicProviderConf/')) {
        fixture.entered = true
        fixture.signal = init?.signal ?? undefined
        return new Promise<Response>((resolve) => {
          fixture.release = () => {
            globalThis.fetch = originalFetch
            resolve(
              new Response(
                JSON.stringify({
                  providers: { late: { id: 'late', name: 'Late', models: [{ id: 'late-model' }] } }
                })
              )
            )
          }
        })
      }
      return originalFetch(input, init)
    }
    Object.assign(globalThis, { __providerCatalogFixture: fixture })
  })
  const refresh = active.page
    .evaluate(() => window.deepchat.invoke('config.refreshProviderDb', { force: true }))
    .catch(() => null)
  const release = () =>
    active.electronApp.evaluate(() => {
      const fixture = globalThis as unknown as { __providerCatalogFixture: { release(): void } }
      fixture.__providerCatalogFixture.release()
    })
  try {
    await expect
      .poll(() =>
        active.electronApp.evaluate(
          () =>
            (globalThis as unknown as { __providerCatalogFixture: { entered: boolean } })
              .__providerCatalogFixture.entered
        )
      )
      .toBe(true)
    await active.electronApp.evaluate(({ app }) => {
      setImmediate(() => app.quit())
    })
    await expect
      .poll(() =>
        active.electronApp.evaluate(
          () =>
            (globalThis as unknown as { __providerCatalogFixture: { signal?: AbortSignal } })
              .__providerCatalogFixture.signal?.aborted
        )
      )
      .toBe(true)
    expect(appProcess.exitCode).toBeNull()
    await release()
    await expect.poll(() => appProcess.exitCode).toBe(0)
  } finally {
    await release().catch(() => undefined)
  }
  await refresh
  expect(await active.close()).toBe('graceful')
  expect(readCache()).toEqual(original)
  const reopened = await launchApp()
  await waitForAppReady(reopened.page)
  const { catalog } = await reopened.page.evaluate(() =>
    window.deepchat.invoke('models.getProviderCatalog', { providerId: 'openai' })
  )
  expect(catalog.dbProviderModels.length).toBeGreaterThan(0)
  expect(await reopened.close()).toBe('graceful')
})
