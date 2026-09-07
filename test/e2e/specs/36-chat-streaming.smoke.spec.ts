import { createServer } from 'node:http'
import { test, expect } from '../fixtures/electronApp'
import { selectAgent, selectModel, sendMessage } from '../helpers/chat'
import { waitForAppReady, waitForGenerationDone } from '../helpers/wait'

test('local streaming preserves an editable composer and completes the response @smoke', async ({
  app
}) => {
  let releaseResponse = () => {}
  const released = new Promise<void>((resolve) => {
    releaseResponse = resolve
  })
  const markdown = Array.from(
    { length: 32 },
    (_, index) => `## Section ${index}\n\n${'Local streaming content. '.repeat(12)}\n\n`
  ).join('')
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
              message: { role: 'assistant', content: 'Local streaming' },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const emit = (content: string, finishReason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({
          id: 'fixture-stream',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture-model',
          choices: [{ index: 0, delta: { content }, finish_reason: finishReason }]
        })}\n\n`
      )
    emit(markdown)
    await released
    if (!response.destroyed) {
      emit('\n\nStream complete.', 'stop')
      response.end('data: [DONE]\n\n')
    }
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
          name: 'Streaming fixture',
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
    await sendMessage(app.page, 'Render the local streaming fixture.')
    const shell = app.page.getByTestId('chat-page-shell')
    await expect(shell).toHaveAttribute('data-generating', 'true')
    const completion = waitForGenerationDone(app.page)
    const editor = shell.getByTestId('chat-input-contenteditable')
    const draft = 'My next message stays editable during generation.'
    await editor.fill(draft)
    await expect(editor).toHaveText(draft)
    await expect(shell).toHaveAttribute('data-generating', 'true')
    releaseResponse()
    await completion
    await expect(app.page.getByTestId('chat-message-assistant')).toContainText('Stream complete.')
    await expect(editor).toHaveText(draft)
    expect(app.pageErrors).toEqual([])
  } finally {
    releaseResponse()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
