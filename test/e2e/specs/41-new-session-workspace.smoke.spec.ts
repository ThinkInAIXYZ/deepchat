import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createDeepchatEventEnvelope } from '../../../src/shared/contracts/events'
import { DEEPCHAT_EVENT_CHANNEL } from '../../../src/shared/contracts/channels'
import { test, expect } from '../fixtures/electronApp'
import {
  createNewChat,
  getActiveSessionId,
  selectAgent,
  selectModel,
  sendMessage
} from '../helpers/chat'
import { waitForAppReady, waitForGenerationDone } from '../helpers/wait'

test('new-session files and native browser survive the first message @smoke', async ({ app }) => {
  const workspace = join(app.userDataDir, 'workspace-fixture')
  const filePath = join(workspace, 'README.md')
  mkdirSync(workspace)
  writeFileSync(filePath, '# Workspace evidence\n\nThe draft preview survives sending.\n')
  const server = createServer(async (request, response) => {
    if (request.url === '/page') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end('<title>Draft browser</title><input value="Retained page state">')
      return
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    const choice = { index: 0, finish_reason: 'stop' }
    const result = { id: 'fixture', created: 1, model: 'fixture-model' }
    if (!input.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          ...result,
          object: 'chat.completion',
          choices: [{ ...choice, message: { role: 'assistant', content: 'Workspace session' } }]
        })
      )
    } else {
      response
        .writeHead(200, { 'Content-Type': 'text/event-stream' })
        .end(
          `data: ${JSON.stringify({ ...result, object: 'chat.completion.chunk', choices: [{ ...choice, delta: { role: 'assistant', content: 'Workspace accepted.' } }] })}\n\ndata: [DONE]\n\n`
        )
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const pageUrl = `http://127.0.0.1:${port}/page`
  try {
    await waitForAppReady(app.page)
    await app.page.evaluate(async (path) => {
      await window.deepchat.invoke('config.setLanguage', { language: 'en-US' })
      await window.deepchat.invoke('config.setDefaultProjectPath', { path })
    }, workspace)
    await selectAgent(app.page)
    const panel = app.page.getByTestId('chat-side-panel-shell')
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(0)
    // Exercise the native shortcut event without depending on host-window focus.
    await app.electronApp.evaluate(
      ({ webContents }, { url, channel, event }) => {
        const contents = webContents.getAllWebContents().find((target) => target.getURL() === url)
        if (!contents) throw new Error('Chat renderer not found')
        contents.send(channel, event)
      },
      {
        url: app.page.url(),
        channel: DEEPCHAT_EVENT_CHANNEL,
        event: createDeepchatEventEnvelope('appRuntime.shortcutRequested', {
          action: 'toggleWorkspace'
        })
      }
    )
    const file = panel.locator('[data-workspace-path]').filter({ hasText: 'README.md' })
    await expect(file).toBeVisible()
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(panel.locator('aside')).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(0)
    await app.page.getByTestId('new-thread-workspace-toggle').click()
    await expect(panel.locator('aside')).not.toHaveAttribute('aria-hidden', 'true')
    await expect(file).toBeVisible()
    await file.click({ button: 'right' })
    await app.page.getByRole('menuitem', { name: 'Insert into input' }).click()
    await expect(app.page.getByTestId('chat-input-contenteditable')).toContainText('README.md')
    await file.click()
    await expect(panel).toContainText('The draft preview survives sending.')
    await panel.getByRole('button', { name: 'Yo Browser', exact: true }).click()
    await panel.getByRole('textbox', { name: 'Address bar' }).fill(pageUrl)
    await panel.getByRole('textbox', { name: 'Address bar' }).press('Enter')
    const draftId = (await panel.getAttribute('data-session-id')) ?? ''
    expect(draftId).not.toBe('')
    await expect
      .poll(async () =>
        app.page.evaluate(async (sessionId) => {
          const { status } = await window.deepchat.invoke('browser.getStatus', { sessionId })
          return status.page?.title
        }, draftId)
      )
      .toBe('Draft browser')
    const browserId = await app.page.evaluate(async (sessionId) => {
      const { status } = await window.deepchat.invoke('browser.getStatus', { sessionId })
      return status.page?.id
    }, draftId)
    await app.electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
      if (!page) throw new Error('Native browser page not found')
      await page.executeJavaScript(
        'document.querySelector("input").value = "Edited before sending"'
      )
    }, pageUrl)
    const providerId = await app.page.evaluate(async (baseUrl) => {
      const id = `custom-${crypto.randomUUID()}`
      await window.deepchat.invoke('providers.add', {
        provider: {
          id,
          name: 'Workspace fixture',
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
    }, `http://127.0.0.1:${port}/v1`)
    await selectModel(app.page, 'fixture-model', providerId)
    await sendMessage(app.page, 'Review this workspace.')
    await waitForGenerationDone(app.page)
    expect(await getActiveSessionId(app.page)).toBe(draftId)
    const { status } = await app.page.evaluate(
      async (sessionId) => window.deepchat.invoke('browser.getStatus', { sessionId }),
      draftId
    )
    expect(status.page).toMatchObject({ id: browserId, url: pageUrl })
    expect(
      await app.electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
        return await page?.executeJavaScript('document.querySelector("input").value')
      }, pageUrl)
    ).toBe('Edited before sending')
    await panel.getByRole('button', { name: 'Workspace', exact: true }).click()
    await expect(panel).toContainText('The draft preview survives sending.')
    await createNewChat(app.page)
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(0)
    await expect(app.page.getByTestId('new-thread-workspace-toggle')).toBeVisible()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})
