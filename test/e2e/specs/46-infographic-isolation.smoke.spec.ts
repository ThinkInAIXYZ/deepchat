import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import { selectAgent, selectModel, sendMessage } from '../helpers/chat'
import { waitForAppReady, waitForGenerationDone } from '../helpers/wait'

// The icon is an inline SVG resource that AntV parses and inserts without sanitizing; its error
// handler marks whichever document it runs in.
const invalidSource = 'not a valid infographic definition'
const markdown = [
  '```infographic',
  invalidSource,
  '```',
  '',
  '```infographic',
  'infographic list-row-horizontal-icon-arrow',
  'data',
  '  title Isolation probe',
  '  items',
  '    - label Probe',
  '      desc inline svg icon',
  `      icon <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="x" onerror="document.documentElement.dataset.xss='1'"/><circle cx="5" cy="5" r="4"/></svg>`,
  '    - label Second',
  '      desc plain item',
  '```',
  ''
].join('\n')

test('infographic blocks render AntV output outside the app origin @smoke', async ({ app }) => {
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'fixture-model' }] }))
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    const chunk = (content: string, finishReason: string | null) => ({
      id: 'fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fixture-model',
      choices: [{ index: 0, delta: { content }, finish_reason: finishReason }]
    })
    if (!JSON.parse(body).stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'fixture-title',
          object: 'chat.completion',
          created: 1,
          model: 'fixture-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Infographic' },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify(chunk(markdown, null))}\n\n`)
    response.write(`data: ${JSON.stringify(chunk('', 'stop'))}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  try {
    await waitForAppReady(app.page)
    const providerId = await app.page.evaluate(async (baseUrl) => {
      const id = `custom-${crypto.randomUUID()}`
      await window.deepchat.invoke('providers.add', {
        provider: {
          id,
          name: 'Infographic fixture',
          apiType: 'openai-completions',
          baseUrl,
          apiKey: 'fixture-key',
          enable: true,
          custom: true
        }
      })
      await window.deepchat.invoke('models.addCustom', {
        providerId: id,
        model: {
          id: 'fixture-model',
          name: 'Fixture',
          enabled: true,
          vision: false,
          functionCall: false,
          reasoning: false,
          contextLength: 32000,
          maxTokens: 8000
        }
      })
      await window.deepchat.invoke('models.setStatus', {
        providerId: id,
        modelId: 'fixture-model',
        enabled: true
      })
      return id
    }, `http://127.0.0.1:${address.port}/v1`)
    await selectAgent(app.page)
    await selectModel(app.page, 'fixture-model', providerId)
    await sendMessage(app.page, 'Render the infographic fixture.')
    await waitForGenerationDone(app.page)

    await expect(app.page.locator('pre', { hasText: invalidSource })).toBeVisible()
    await expect(app.page.locator('iframe[src^="mcp-app://"]')).toHaveCount(1)
    const sandboxMarker = async () => {
      for (const frame of app.page.frames()) {
        if (!frame.url().startsWith('mcp-app://') && frame.url() !== 'about:blank') continue
        const state = await frame
          .evaluate(() => ({
            xss: document.documentElement.dataset.xss ?? null,
            svg: document.querySelectorAll('#root svg').length
          }))
          .catch(() => null)
        if (state?.svg) return { frame, state }
      }
      return null
    }
    await expect
      .poll(async () => (await sandboxMarker())?.state)
      .toEqual({ xss: '1', svg: expect.any(Number) })
    expect(await app.page.evaluate(() => document.documentElement.dataset.xss ?? null)).toBeNull()

    const sandbox = (await sandboxMarker())!.frame
    await sandbox.evaluate(() =>
      parent.postMessage(
        { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 10_000_000 } },
        '*'
      )
    )
    await expect
      .poll(async () => (await app.page.locator('iframe[src^="mcp-app://"]').boundingBox())?.height)
      .toBe(1600)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
