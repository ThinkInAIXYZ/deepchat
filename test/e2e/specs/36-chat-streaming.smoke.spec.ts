import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test, expect } from '../fixtures/electronApp'
import { selectAgent, selectModel, sendMessage } from '../helpers/chat'
import { openSettings } from '../helpers/settings'
import { waitForAppReady, waitForGenerationDone } from '../helpers/wait'

test('local streaming preserves an editable composer and completes the response @smoke', async ({
  app
}) => {
  let releaseResponse = () => {}
  const released = new Promise<void>((resolve) => {
    releaseResponse = resolve
  })
  let releaseBackground = () => {}
  const backgroundReleased = new Promise<void>((resolve) => {
    releaseBackground = resolve
  })
  let streamCount = 0
  const table = '| File | Result |\n| --- | --- |\n| First cell | Last cell |\n\n'
  const markdown =
    table +
    Array.from(
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
    streamCount += 1
    await (streamCount === 1 ? released : backgroundReleased)
    if (!response.destroyed) {
      emit('\n\nStream complete.', 'stop')
      response.end('data: [DONE]\n\n')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  try {
    await waitForAppReady(app.page)
    await app.page.evaluate(async () => {
      await window.deepchat.invoke('config.setLanguage', { language: 'en-US' })
    })
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
    const status = shell.getByTestId('chat-generation-status')
    await expect(status).toHaveAttribute('role', 'status')
    await expect(status).toHaveAttribute('aria-live', 'polite')
    await expect(status).toHaveText(/Running|运行中/)
    const completion = waitForGenerationDone(app.page)
    void completion.catch(() => {})
    const editor = shell.getByTestId('chat-input-contenteditable')
    const draft = 'My next message stays editable during generation.'
    await editor.fill(draft)
    await expect(editor).toHaveText(draft)
    await expect(shell).toHaveAttribute('data-generating', 'true')
    releaseResponse()
    await completion
    await expect(app.page.getByTestId('chat-message-assistant')).toContainText('Stream complete.')
    await expect(editor).toHaveText(draft)
    await expect(status).toHaveText(/Generation is complete|生成已完成|生成完成/)
    const renderedTable = app.page.getByRole('table').filter({ hasText: 'First cell' })
    await expect(renderedTable).toBeVisible()
    const cellInsets = await renderedTable.locator('th, td').evaluateAll((cells) =>
      cells.map((cell) => {
        const style = getComputedStyle(cell)
        return [style.paddingInlineStart, style.paddingInlineEnd].map(parseFloat)
      })
    )
    expect(cellInsets).toHaveLength(4)
    expect(cellInsets.every((insets) => insets.every((inset) => inset >= 8))).toBe(true)
    const attachmentPath = join(app.userDataDir, 'keyboard-removal.txt')
    writeFileSync(attachmentPath, 'This attachment must not be sent.')
    for (const key of ['Enter', 'Space']) {
      const chooser = app.page.waitForEvent('filechooser')
      await app.page.getByRole('button', { name: /^(Attach|添加附件)$/ }).focus()
      await app.page.keyboard.press('Enter')
      await (await chooser).setFiles(attachmentPath)
      const remove = shell
        .getByTestId('attachment-shelf')
        .getByRole('button', { name: 'Delete keyboard-removal.txt', exact: true })
      await remove.focus()
      await app.page.keyboard.press(key)
      await expect(remove).toHaveCount(0)
      await expect(editor).toBeFocused()
      await expect(editor).toHaveText(draft)
      await expect(app.page.getByTestId('chat-message-user')).toHaveCount(1)
    }
    await openSettings(app)
    const previousPages = new Set(app.electronApp.windows())
    await app.electronApp.evaluate(({ Menu }) => {
      const fileMenu = Menu.getApplicationMenu()?.items.find((item) =>
        item.submenu?.items.some((entry) => /New Window/i.test(entry.label))
      )
      const command = fileMenu?.submenu?.items.find((entry) => /New Window/i.test(entry.label))
      if (!command) throw new Error('New Window command is unavailable')
      command.click()
    })
    await expect
      .poll(
        () =>
          app.electronApp
            .windows()
            .filter(
              (page) => !previousPages.has(page) && page.url().includes('/renderer/index.html')
            ).length
      )
      .toBe(1)
    const second = app.electronApp
      .windows()
      .find((page) => !previousPages.has(page) && page.url().includes('/renderer/index.html'))!
    await waitForAppReady(second)
    const cli = (args: string[]) =>
      promisify(execFile)(process.execPath, [resolve('out/cli/deepchat.mjs'), ...args], {
        env: { ...process.env, DEEPCHAT_E2E_USER_DATA_DIR: app.userDataDir },
        timeout: 30_000
      })
    const started = JSON.parse(
      (
        await cli([
          'agent',
          'run',
          '--prompt',
          'Complete after the chat window is destroyed.',
          '--provider',
          providerId,
          '--model',
          'fixture-model',
          '--json'
        ])
      ).stdout
    )
    expect(started.ok).toBe(true)
    await expect.poll(() => streamCount).toBe(2)
    await second.evaluate(
      (sessionId) => window.deepchat.invoke('sessions.activate', { sessionId }),
      started.result.runId
    )
    await expect(second.getByTestId('chat-page-shell')).toHaveAttribute('data-generating', 'true')
    await expect(app.page.getByTestId('chat-message-user')).toContainText(
      'Render the local streaming fixture.'
    )
    await expect(editor).toHaveText(draft)
    const watch = cli(['run', 'watch', '--run', started.result.runId, '--jsonl'])
    void watch.catch(() => {})
    let observed = ''
    watch.child.stdout?.on('data', (chunk) => {
      observed += chunk
    })
    await expect.poll(() => observed).toContain('runs.snapshot')
    const chatWindow = await app.electronApp.browserWindow(app.page)
    expect(
      await chatWindow.evaluate((window) => {
        window.destroy()
        return window.isDestroyed()
      })
    ).toBe(true)
    releaseBackground()
    const events = (await watch).stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'sessions.status.changed',
        data: expect.objectContaining({ sessionId: started.result.runId, status: 'idle' })
      })
    )
    const settled = JSON.parse(
      (await cli(['run', 'get', '--run', started.result.runId, '--json'])).stdout
    )
    expect(settled.result.phase).toBe('terminal')
    expect(settled.result.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'sent',
      text: expect.stringContaining('Stream complete.')
    })
    await expect(second.getByTestId('chat-message-assistant')).toContainText('Stream complete.')
    await expect(second.getByTestId('chat-page-shell')).toHaveAttribute('data-generating', 'false')
    expect(app.pageErrors).toEqual([])
  } finally {
    releaseResponse()
    releaseBackground()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
