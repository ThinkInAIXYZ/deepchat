import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import { selectAgent, selectModel, sendMessage } from '../helpers/chat'
import { waitForAppReady, waitForGenerationDone } from '../helpers/wait'

const HOST_VIEW_MAX_HEIGHT = 1600

// The page marks every document it can reach, then tries each way out of the sandbox with the
// bootstrap's link handler suppressed. Requests that reach the fixture server are leaks.
const probePage = (origin: string) => `<!doctype html>
<html><head></head><body>
<div id="probe" style="height:120px">probe</div>
<script>
document.documentElement.dataset.xss = 'page'
try { top.document.documentElement.dataset.xss = 'top' } catch {}
window.addEventListener('click', (event) => event.stopImmediatePropagation(), true)
for (const target of ['_top', '_blank', '_parent']) {
  const link = document.createElement('a')
  link.href = '${origin}/leak/link' + target
  link.target = target
  document.body.appendChild(link)
  link.click()
}
try { window.open('${origin}/leak/open') } catch {}
fetch('${origin}/leak/fetch').catch(() => {})
new Image().src = '${origin}/leak/image'
</script>
</body></html>`

const busyPage = `<!doctype html><html><head></head><body><script>while (true) {}</script></body></html>`

const toolCall = (id: string, title: string, html: string) => ({
  tool_calls: [
    {
      index: 0,
      id,
      type: 'function',
      function: { name: 'html_render', arguments: JSON.stringify({ title, html }) }
    }
  ]
})

test('html_render pages run outside the app origin and cannot leave the sandbox @smoke', async ({
  app
}) => {
  const leaks: string[] = []
  let origin = ''
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith('/leak/')) {
      leaks.push(request.url)
      response.writeHead(204).end()
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    if (!input.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'fixture-title',
          object: 'chat.completion',
          created: 1,
          model: 'fixture-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'HTML render' },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }
    const toolResults = input.messages.filter(
      (message: { role: string }) => message.role === 'tool'
    ).length
    const [delta, finishReason] =
      toolResults === 0
        ? [toolCall('probe-page', 'Isolation probe', probePage(origin)), 'tool_calls']
        : toolResults === 1
          ? [toolCall('busy-page', 'Busy page', busyPage), 'tool_calls']
          : [{ content: 'Done.' }, 'stop']
    const chunk = (value: object, finish: string | null) =>
      `data: ${JSON.stringify({
        id: 'fixture-stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture-model',
        choices: [{ index: 0, delta: value, finish_reason: finish }]
      })}\n\n`
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(chunk(delta, null))
    response.end(`${chunk({}, finishReason)}data: [DONE]\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  origin = `http://127.0.0.1:${port}`
  try {
    await waitForAppReady(app.page)
    const providerId = await app.page.evaluate(async (baseUrl) => {
      const id = `custom-${crypto.randomUUID()}`
      await window.deepchat.invoke('providers.add', {
        provider: {
          id,
          name: 'HTML render fixture',
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
          functionCall: true,
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
    }, `${origin}/v1`)
    await selectAgent(app.page)
    await selectModel(app.page, 'fixture-model', providerId)
    await sendMessage(app.page, 'Render the probe pages.')
    await waitForGenerationDone(app.page)

    const probeFrame = async () => {
      for (const frame of app.page.frames()) {
        if (!frame.url().startsWith('mcp-app://') && frame.url() !== 'about:blank') continue
        const marked = await frame
          .evaluate(() => document.getElementById('probe') !== null)
          .catch(() => false)
        if (marked) return frame
      }
      return null
    }
    await expect.poll(async () => (await probeFrame()) !== null).toBe(true)
    const frame = (await probeFrame())!
    expect(await frame.evaluate(() => document.documentElement.dataset.xss)).toBe('page')
    expect(await app.page.evaluate(() => document.documentElement.dataset.xss ?? null)).toBeNull()

    // A busy page blocks only its own frame process; the chat stays responsive and the page falls
    // back to the load error once it misses initialization.
    await expect(app.page.getByTestId('html-render-error')).toBeVisible({ timeout: 20_000 })
    expect(await app.page.evaluate(() => 1)).toBe(1)

    await frame.evaluate(() =>
      parent.postMessage(
        { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 10_000_000 } },
        '*'
      )
    )
    const surface = app.page.getByTestId('html-render-surface').locator('iframe')
    await expect.poll(async () => (await surface.boundingBox())?.height).toBe(HOST_VIEW_MAX_HEIGHT)

    // CSP replaces the frame with an error page instead of loading the target, so this runs last.
    await frame
      .evaluate((target) => {
        const link = document.createElement('a')
        link.href = target
        document.body.appendChild(link)
        link.click()
      }, `${origin}/leak/link_self`)
      .catch(() => undefined)
    await app.page.waitForTimeout(1000)
    expect(leaks).toEqual([])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
