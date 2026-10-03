import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SessionReference } from '../../../src/shared/sessionReferences'
import { test, expect } from '../fixtures/electronApp'
import {
  selectAgent,
  selectModel,
  sendMessage,
  getActiveSessionId,
  openSessionById
} from '../helpers/chat'
import { waitForAppReady } from '../helpers/wait'

test('session references survive drafts and retrieve evidence without injecting history @smoke', async ({
  app
}) => {
  let sourceId = ''
  let sawReader = false
  let referenceRequest = ''
  let evidence = ''
  let holdNextStream = false
  let releaseStream: (() => void) | undefined
  const marker = 'violet-harbor-73'
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const input = JSON.parse(body)
    if (!input.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: 'title',
          object: 'chat.completion',
          created: 1,
          model: 'fixture-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Session fixture' },
              finish_reason: 'stop'
            }
          ]
        })
      )
      return
    }
    if (holdNextStream) {
      holdNextStream = false
      await new Promise<void>((resolve) => {
        releaseStream = resolve
      })
    }
    const toolResult = input.messages.findLast(
      (message: { role: string }) => message.role === 'tool'
    )
    let delta: object = { content: `Source evidence: ${marker}` }
    let finishReason = 'stop'
    if (toolResult) {
      evidence = JSON.stringify(toolResult)
      delta = { content: 'Reference evidence retrieved.' }
    } else if (JSON.stringify(input.messages).includes('Session reference metadata:')) {
      referenceRequest = JSON.stringify(input.messages)
      const reader = input.tools?.find((tool: { function: { name: string } }) =>
        tool.function.name.endsWith('read_session')
      )
      sawReader = !!reader
      delta = reader
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'read-reference',
                type: 'function',
                function: {
                  name: reader.function.name,
                  arguments: JSON.stringify({
                    sessionId: sourceId,
                    action: 'search',
                    query: 'violet'
                  })
                }
              }
            ]
          }
        : { content: 'Reader unavailable.' }
      finishReason = reader ? 'tool_calls' : 'stop'
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(
      `data: ${JSON.stringify({
        id: 'fixture-stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture-model',
        choices: [{ index: 0, delta, finish_reason: null }]
      })}\n\n`
    )
    response.end(
      `data: ${JSON.stringify({
        id: 'fixture-stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture-model',
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }]
      })}\n\ndata: [DONE]\n\n`
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  try {
    await waitForAppReady(app.page)
    const providerId = await app.page.evaluate(async (baseUrl) => {
      const id = `custom-${crypto.randomUUID()}`
      await window.deepchat.invoke('providers.add', {
        provider: {
          id,
          name: 'Reference fixture',
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
    }, `http://127.0.0.1:${port}/v1`)
    await selectAgent(app.page)
    await selectModel(app.page, 'fixture-model', providerId)
    await sendMessage(app.page, `The launch codename is ${marker}.`)
    await expect(app.page.getByTestId('chat-message-assistant')).toContainText(marker)
    await expect(app.page.getByTestId('chat-page-shell')).toHaveAttribute(
      'data-generating',
      'false'
    )
    sourceId = await getActiveSessionId(app.page)
    await app.page.evaluate(async (sessionId) => {
      await window.deepchat.invoke('sessions.rename', { sessionId, title: 'Launch research' })
    }, sourceId)
    await app.page.getByTestId('app-new-chat-button').click()
    const editor = app.page.getByTestId('chat-input-contenteditable')
    await expect(editor).toHaveCount(1)
    await editor.fill('@Launch')
    const candidate = app.page.getByRole('option', { name: /Launch research/ })
    await expect(candidate).toBeVisible()
    const artifacts = resolve('.amp/in/artifacts')
    mkdirSync(artifacts, { recursive: true })
    await app.page.screenshot({ path: resolve(artifacts, 'session-reference-candidates.png') })
    await candidate.click()
    const chip = editor.locator('[data-session-reference]')
    await expect(chip).toContainText('Launch research')
    await expect(app.page.getByTestId('chat-send-button')).toBeEnabled()
    await app.page.reload()
    await waitForAppReady(app.page)
    await selectAgent(app.page)
    await expect(chip).toContainText('Launch research')
    await expect(app.page.getByTestId('chat-send-button')).toBeEnabled()
    await chip.getByRole('button', { name: /Open|打开/ }).focus()
    await app.page.keyboard.press('Enter')
    await expect.poll(() => getActiveSessionId(app.page)).toBe(sourceId)
    await expect(app.page.getByTestId('sidebar-session-item')).toHaveCount(1)
    await app.page.getByTestId('app-new-chat-button').click()
    await expect(editor).toHaveCount(1)
    await expect(chip).toContainText('Launch research')
    await chip.getByRole('button', { name: /Delete|删除/ }).focus()
    await app.page.keyboard.press('Space')
    await expect(chip).toHaveCount(0)
    const sourceRow = app.page
      .locator(`[data-testid="sidebar-session-item"][data-session-id="${sourceId}"]`)
      .first()
    await sourceRow.dragTo(editor)
    await expect(chip).toContainText('Launch research')
    await app.page.screenshot({ path: resolve(artifacts, 'session-reference-composer.png') })
    await editor.focus()
    await app.page.keyboard.press('ControlOrMeta+a')
    const copied = await editor.evaluate((element) => {
      const clipboardData = new DataTransfer()
      element.dispatchEvent(
        new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData })
      )
      return {
        text: clipboardData.getData('text/plain'),
        html: clipboardData.getData('text/html')
      }
    })
    expect(copied.text).toBe(`[Session: Launch research (${sourceId})]`)
    expect(copied.html).toContain('data-session-reference')
    await editor.press('Backspace')
    await expect(chip).toHaveCount(0)
    await editor.evaluate((element, copied) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', copied.text)
      clipboardData.setData('text/html', copied.html)
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
      )
    }, copied)
    await expect(chip).toHaveText('Launch research')
    await app.page.getByTestId('chat-send-button').click()
    await expect(app.page.getByTestId('chat-message-assistant')).toContainText(
      'Reference evidence retrieved.'
    )
    expect(sawReader).toBe(true)
    expect(referenceRequest).toContain(sourceId)
    expect(referenceRequest).not.toContain('[Session: Launch research')
    expect(referenceRequest).not.toContain(marker)
    expect(evidence).toContain(marker)
    const targetId = await getActiveSessionId(app.page)
    const sentChip = app.page.getByTestId('user-message-inline-session')
    await expect(sentChip).toHaveText('Launch research')
    await app.page.screenshot({ path: resolve(artifacts, 'session-reference-result.png') })
    await sentChip.click()
    expect(await getActiveSessionId(app.page)).toBe(sourceId)
    await openSessionById(app.page, targetId)
    await expect(sentChip).toHaveText('Launch research')

    const crossId = await app.page.evaluate(
      async ({ providerId, projectDir }) => {
        const result = (await window.deepchat.invoke('sessions.create', {
          agentId: 'deepchat',
          message: '',
          providerId,
          modelId: 'fixture-model',
          projectDir
        })) as { session: { id: string } }
        await window.deepchat.invoke('sessions.rename', {
          sessionId: result.session.id,
          title: 'Cross-workspace notes'
        })
        return result.session.id
      },
      { providerId, projectDir: app.userDataDir }
    )
    await openSessionById(app.page, targetId)
    await expect(editor).toHaveCount(1)
    const candidates = await app.page.evaluate(async (sessionId) => {
      const { session } = (await window.deepchat.invoke('sessions.restore', { sessionId })) as {
        session: { projectDir: string | null }
      }
      return window.deepchat.invoke('sessions.searchReferenceCandidates', {
        projectDir: session.projectDir,
        query: 'Cross-workspace'
      })
    }, targetId)
    expect(candidates).toEqual({ items: [] })
    await app.page
      .locator(`[data-testid="sidebar-session-item"][data-session-id="${crossId}"]`)
      .first()
      .dragTo(editor)
    await expect(chip).toHaveText('Cross-workspace notes')
    expect(await getActiveSessionId(app.page)).toBe(targetId)
    await openSessionById(app.page, sourceId)
    await openSessionById(app.page, targetId)
    await expect(chip).toHaveText('Cross-workspace notes')
    await expect(app.page.getByTestId('chat-send-button')).toBeEnabled()

    // Keep a real turn active while editing queued references through the UI.
    await chip.getByRole('button', { name: /Delete|删除/ }).click()
    holdNextStream = true
    await sendMessage(app.page, 'Keep this turn open for queue editing.')
    await expect.poll(() => !!releaseStream).toBe(true)
    const itemId = await app.page.evaluate(
      async ({ sessionId, sourceId }) => {
        const { reference } = (await window.deepchat.invoke('sessions.resolveReference', {
          sessionId: sourceId
        })) as { reference: SessionReference }
        const text = 'Review this source after the current turn.'
        const { item } = (await window.deepchat.invoke('sessions.queuePendingInput', {
          sessionId,
          content: {
            text,
            files: [],
            inlineItems: [{ type: 'session', offset: text.length, ...reference }]
          }
        })) as { item: { id: string } }
        return item.id
      },
      { sessionId: targetId, sourceId }
    )
    const readQueue = () =>
      app.page.evaluate(
        (sessionId) => window.deepchat.invoke('sessions.listPendingInputs', { sessionId }),
        targetId
      )
    const queueRow = app.page.getByTestId('pending-row-main')
    await expect(queueRow).toContainText('Review this source')
    await queueRow.click()
    await app.page.getByTestId('pending-edit-textarea').fill('go')
    await app.page.getByTestId('pending-edit-textarea').press('Enter')
    await expect.poll(readQueue).toMatchObject({
      items: [
        { id: itemId, payload: { text: 'go', inlineItems: [{ sessionId: sourceId, offset: 2 }] } }
      ]
    })
    await queueRow.click()
    await app.page.getByTestId('pending-edit-textarea').fill('')
    await app.page.getByTestId('pending-edit-textarea').press('Enter')
    await expect(queueRow).toHaveText('Launch research')
    await expect.poll(readQueue).toMatchObject({
      items: [
        { id: itemId, payload: { text: '', inlineItems: [{ sessionId: sourceId, offset: 0 }] } }
      ]
    })
    await app.page.getByTestId('pending-rail').screenshot({
      path: resolve(artifacts, 'session-reference-queue.png')
    })
    await app.page.evaluate(
      ({ sessionId, itemId }) =>
        window.deepchat.invoke('sessions.deletePendingInput', { sessionId, itemId }),
      { sessionId: targetId, itemId }
    )
    releaseStream!()
    await expect(app.page.getByTestId('chat-page-shell')).toHaveAttribute(
      'data-generating',
      'false'
    )
    expect(app.pageErrors).toEqual([])
  } finally {
    releaseStream?.()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
