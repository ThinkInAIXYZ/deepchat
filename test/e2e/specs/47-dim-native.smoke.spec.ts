import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import {
  getActiveSessionId,
  getAssistantMessages,
  openSessionById,
  selectAgent,
  selectModel,
  sendMessage
} from '../helpers/chat'
import { waitForAppReady, waitForGenerationDone } from '../helpers/wait'

test('desktop chat uses persistent native dim sessions @smoke', async ({ app, launchApp }) => {
  const requests: Array<{ messages?: unknown[]; tools?: Array<{ function: { name: string } }> }> =
    []
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ data: [{ id: 'dim-desktop-fixture' }] }))
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    requests.push(body)
    const content = 'NATIVE_DIM_DESKTOP_REPLY'
    if (body.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'dim-desktop', object: 'chat.completion.chunk', created: 0, model: 'dim-desktop-fixture', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })}\n\ndata: [DONE]\n\n`
      )
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'dim-desktop',
          object: 'chat.completion',
          created: 0,
          model: 'dim-desktop-fixture',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 }
        })
      )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await waitForAppReady(app.page)
    const providerId = await app.page.evaluate(
      async (baseUrl) => {
        const id = `custom-${crypto.randomUUID()}`
        await window.deepchat.invoke('providers.add', {
          provider: {
            id,
            name: 'Native dim fixture',
            apiType: 'openai-completions',
            baseUrl,
            apiKey: 'dim-fixture-secret',
            enable: true,
            custom: true
          }
        })
        await window.deepchat.invoke('models.addCustom', {
          providerId: id,
          model: {
            id: 'dim-desktop-fixture',
            name: 'Native dim',
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
          modelId: 'dim-desktop-fixture',
          enabled: true
        })
        return id
      },
      `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
    )
    await selectAgent(app.page)
    await selectModel(app.page, 'dim-desktop-fixture', providerId)
    await sendMessage(app.page, 'NATIVE_DIM_FIRST_INPUT')
    await waitForGenerationDone(app.page)
    await expect(getAssistantMessages(app.page).last()).toContainText('NATIVE_DIM_DESKTOP_REPLY')
    const sessionId = await getActiveSessionId(app.page)
    const firstPage = await app.page.evaluate(
      (id) => window.deepchat.invoke('sessions.listMessagesPage', { sessionId: id }),
      sessionId
    )
    const original = firstPage.messages.map((message) => ({
      id: message.id,
      metadata: JSON.parse(message.metadata)
    }))
    expect(original.length).toBeGreaterThanOrEqual(2)
    expect(original.every((message) => message.metadata.dim?.sessionId)).toBe(true)
    const nativeId = original[0].metadata.dim.sessionId
    const names = requests.flatMap(
      (request) => request.tools?.map((tool) => tool.function.name) ?? []
    )
    expect(names.length).toBeGreaterThan(0)
    expect(names).not.toContain('run_code')
    expect(names).not.toContain('tool_search')
    await app.close()
    const reopened = await launchApp()
    await waitForAppReady(reopened.page)
    const sidebar = reopened.page.getByTestId('window-sidebar-toggle')
    if ((await sidebar.getAttribute('aria-expanded')) === 'false') await sidebar.click()
    await openSessionById(reopened.page, sessionId)
    await expect(getAssistantMessages(reopened.page).last()).toContainText(
      'NATIVE_DIM_DESKTOP_REPLY'
    )
    await sendMessage(reopened.page, 'NATIVE_DIM_AFTER_RESTART')
    await waitForGenerationDone(reopened.page)
    const restored = await reopened.page.evaluate(
      (id) => window.deepchat.invoke('sessions.listMessagesPage', { sessionId: id }),
      sessionId
    )
    expect(restored.messages.filter((message) => message.role === 'user')).toHaveLength(2)
    expect(restored.messages.filter((message) => message.role === 'assistant')).toHaveLength(2)
    expect(
      restored.messages.every((message) => JSON.parse(message.metadata).dim?.sessionId === nativeId)
    ).toBe(true)
    const continued = requests.findLast((request) =>
      JSON.stringify(request.messages).includes('NATIVE_DIM_AFTER_RESTART')
    )
    expect(JSON.stringify(continued?.messages)).toContain('NATIVE_DIM_FIRST_INPUT')
    expect(JSON.stringify(continued?.messages)).toContain('NATIVE_DIM_AFTER_RESTART')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
