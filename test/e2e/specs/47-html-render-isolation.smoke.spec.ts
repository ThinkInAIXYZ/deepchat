import { createServer } from 'node:http'
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/electronApp'
import {
  createNewChat,
  getActiveSessionId,
  selectAgent,
  selectModel,
  sendMessage
} from '../helpers/chat'
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
try { top.location.href = '${origin}/leak/top_location' } catch {}
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

const panelShell = `<!doctype html><html><head></head><body>
<h1 id="panel">Panel</h1><main data-dc-sections></main>
</body></html>`

const toolCall = (id: string, name: string, args: object) => ({
  tool_calls: [
    { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
  ]
})

type FixtureReply = { delta: object; finishReason: string }
type FixtureInput = { origin: string; toolResults: string[] }

// Each streamed reply is picked by how many tool results the request already carries.
const startFixture = async (replies: Array<(input: FixtureInput) => FixtureReply>) => {
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
    const toolResults = (input.messages as Array<{ role: string; content: unknown }>)
      .filter((message) => message.role === 'tool')
      .map((message) => JSON.stringify(message.content))
    const reply = replies[toolResults.length]?.({ origin, toolResults }) ?? {
      delta: { content: 'Done.' },
      finishReason: 'stop'
    }
    const chunk = (value: object, finish: string | null) =>
      `data: ${JSON.stringify({
        id: 'fixture-stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture-model',
        choices: [{ index: 0, delta: value, finish_reason: finish }]
      })}\n\n`
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(chunk(reply.delta, null))
    response.end(`${chunk({}, reply.finishReason)}data: [DONE]\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  origin = `http://127.0.0.1:${port}`
  return {
    origin,
    leaks,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

// html_render is opt-in, so the chat runs on an agent with every agent tool enabled.
const startChat = async (page: Page, origin: string, prompt: string) => {
  await waitForAppReady(page)
  const { providerId, agentId } = await page.evaluate(async (baseUrl) => {
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
    const { agent } = await window.deepchat.invoke('config.createDeepChatAgent', {
      name: 'HTML render',
      enabled: true,
      config: { disabledAgentTools: [] }
    })
    return { providerId: id, agentId: agent.id }
  }, `${origin}/v1`)
  await selectAgent(page, agentId)
  await selectModel(page, 'fixture-model', providerId)
  await sendMessage(page, prompt)
  await waitForGenerationDone(page)
}

const findFrame = async (page: Page, selector: string) => {
  for (const frame of page.frames()) {
    if (!frame.url().startsWith('mcp-app://') && frame.url() !== 'about:blank') continue
    const found = await frame
      .evaluate((value) => document.querySelector(value) !== null, selector)
      .catch(() => false)
    if (found) return frame
  }
  return null
}

test('html_render pages run outside the app origin and cannot leave the sandbox @smoke', async ({
  app
}) => {
  const fixture = await startFixture([
    ({ origin }) => ({
      delta: toolCall('probe-page', 'html_render', {
        title: 'Isolation probe',
        html: probePage(origin)
      }),
      finishReason: 'tool_calls'
    }),
    () => ({
      delta: toolCall('busy-page', 'html_render', { title: 'Busy page', html: busyPage }),
      finishReason: 'tool_calls'
    })
  ])
  try {
    await startChat(app.page, fixture.origin, 'Render the probe pages.')

    const probeFrame = () => findFrame(app.page, '#probe')
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

    // Navigating the frame itself is blocked by CSP, which replaces the page with an error page,
    // so each attempt needs a fresh page: the fullscreen toggles below reload it.
    const instanceOf = async () => (await probeFrame())?.parentFrame()?.url() ?? null
    const seen = [await instanceOf()]
    await frame
      .evaluate((target) => {
        const link = document.createElement('a')
        link.href = target
        document.body.appendChild(link)
        link.click()
      }, `${fixture.origin}/leak/link_self`)
      .catch(() => undefined)

    // Entering and leaving fullscreen each reload the page on a freshly prepared sandbox instance.
    await app.page.getByTestId('html-render-surface').hover()
    await app.page.getByTestId('html-render-surface').getByRole('button').click()
    for (const toggle of [null, 'Escape']) {
      if (toggle) await app.page.keyboard.press(toggle)
      await expect
        .poll(async () => {
          const instance = await instanceOf()
          return instance !== null && !seen.includes(instance)
        })
        .toBe(true)
      seen.push(await instanceOf())
    }
    const current = (await probeFrame())!
    expect(await current.evaluate(() => document.documentElement.dataset.xss)).toBe('page')

    await current
      .evaluate((target) => {
        location.href = target
      }, `${fixture.origin}/leak/location`)
      .catch(() => undefined)
    await app.page.waitForTimeout(1000)
    expect(fixture.leaks).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('html_render sections with scripts replace by id and restore when the chat reopens @smoke', async ({
  app
}) => {
  const panelIdOf = (toolResults: string[]) => /panelId: ([A-Za-z0-9_-]+)/.exec(toolResults[0])![1]
  const section = (id: string, sectionId: string, html: string) => (input: FixtureInput) => ({
    delta: toolCall(id, 'html_render_section', {
      panelId: panelIdOf(input.toolResults),
      sectionId,
      html
    }),
    finishReason: 'tool_calls'
  })
  // Every section declares the same top-level const, as chart sections do, so a replaced or second
  // section only renders if its script runs again without a redeclaration error.
  const labelled = (label: string) =>
    `<p></p><script>const label = '${label}'; document.currentScript.previousElementSibling.textContent = label</script>`
  const fixture = await startFixture([
    () => ({
      delta: toolCall('panel-shell', 'html_render', { title: 'Panel', html: panelShell }),
      finishReason: 'tool_calls'
    }),
    section('section-kpi', 'kpi', labelled('first')),
    section('section-notes', 'notes', labelled('notes')),
    section('section-kpi-retry', 'kpi', labelled('retried'))
  ])
  try {
    await startChat(app.page, fixture.origin, 'Build the panel.')

    const sections = async () => {
      const frame = await findFrame(app.page, '#panel')
      return frame
        ? await frame
            .evaluate(() =>
              Array.from(
                document.querySelectorAll<HTMLElement>('[data-dc-section]'),
                (slot) => `${slot.dataset.dcSection}:${slot.querySelector('p')?.textContent}`
              ).join(',')
            )
            .catch(() => null)
        : null
    }
    await expect.poll(sections).toBe('kpi:retried,notes:notes')

    const sessionId = await getActiveSessionId(app.page)
    await createNewChat(app.page)
    await expect.poll(async () => (await findFrame(app.page, '#panel')) === null).toBe(true)
    await app.page.evaluate(
      (id) => window.deepchat.invoke('sessions.activate', { sessionId: id }),
      sessionId
    )
    await expect.poll(sections).toBe('kpi:retried,notes:notes')
  } finally {
    await fixture.close()
  }
})
