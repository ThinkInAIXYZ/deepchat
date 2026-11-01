import { createServer, type ServerResponse } from 'node:http'
import { startHttpsFixture } from '../helpers/httpsFixture'
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
  const responses: ServerResponse[] = []
  const https = await startHttpsFixture(['raw.githubusercontent.com'], (request, response) => {
    if (request.url?.includes('/PublicProviderConf/')) responses.push(response)
    else response.writeHead(404).end()
  })
  let active: Awaited<ReturnType<typeof launchApp>> | undefined
  let refresh: Promise<unknown> | undefined
  try {
    active = await launchApp()
    expect(active.ownsUserDataDir).toBe(true)
    await waitForAppReady(active.page)
    await active.page.evaluate(async (url) => {
      await window.deepchat.invoke('config.setCustomProxyUrl', { url })
      await window.deepchat.invoke('config.setProxyMode', { mode: 'custom' })
    }, https.proxyUrl)
    const profile = active.userDataDir
    const files = ['providers.json', 'meta.json'].map((name) => join(profile, 'provider-db', name))
    const readCache = () =>
      files.map((file) => (existsSync(file) ? readFileSync(file, 'utf8') : null))
    const original = readCache()
    refresh = active.page
      .evaluate(() => window.deepchat.invoke('config.refreshProviderDb', { force: true }))
      .catch(() => null)
    await expect.poll(() => responses.length).toBe(1)
    expect(responses[0].destroyed).toBe(false)
    expect(await active.close()).toBe('graceful')
    await refresh
    await expect.poll(() => responses[0].destroyed).toBe(true)
    expect(readCache()).toEqual(original)
    active = await launchApp()
    await waitForAppReady(active.page)
    const { catalog } = await active.page.evaluate(() =>
      window.deepchat.invoke('models.getProviderCatalog', { providerId: 'openai' })
    )
    expect(catalog.dbProviderModels.length).toBeGreaterThan(0)
    expect(await active.close()).toBe('graceful')
  } finally {
    try {
      await active?.close()
      await refresh
    } finally {
      await https.close()
    }
  }
})
