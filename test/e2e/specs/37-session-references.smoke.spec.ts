import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
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
    await app.page.screenshot({ path: resolve(artifacts, 'composer-experience-candidates.png') })
    await candidate.click()
    const chip = editor.locator('[data-session-reference]')
    await expect(chip).toContainText('Launch research')
    await expect(app.page.getByTestId('chat-send-button')).toBeEnabled()
    await app.page.reload()
    await waitForAppReady(app.page)
    await selectAgent(app.page)
    await expect(chip).toContainText('Launch research')
    await expect(app.page.getByTestId('chat-send-button')).toBeEnabled()
    await chip.getByRole('button', { name: /Preview|预览/ }).click()
    await app.page.getByRole('button', { name: /Open|打开/ }).click()
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
    await app.page.screenshot({ path: resolve(artifacts, 'composer-experience-composer.png') })
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
    await expect(
      app.page.getByTestId('chat-input-memory-host').getByTestId('chat-send-button')
    ).toBeDisabled()
    expect(sawReader).toBe(true)
    expect(referenceRequest).toContain(sourceId)
    expect(referenceRequest).not.toContain('[Session: Launch research')
    expect(referenceRequest).not.toContain(marker)
    expect(evidence).toContain(marker)
    const targetId = await getActiveSessionId(app.page)
    const sentChip = app.page.getByTestId('user-message-inline-session')
    await expect(sentChip).toHaveText('Launch research')
    await expect(app.page.locator('[data-hero-clone="chat-input"]')).toHaveCount(0)
    await app.page.screenshot({ path: resolve(artifacts, 'composer-experience-sent.png') })
    await sentChip.click()
    expect(await getActiveSessionId(app.page)).toBe(targetId)
    await app.page.getByRole('button', { name: /Open|打开/ }).click()
    await expect.poll(() => getActiveSessionId(app.page)).toBe(sourceId)
    await openSessionById(app.page, targetId)
    await expect(sentChip).toHaveText('Launch research')
    const sentUserMessage = app.page.getByTestId('chat-message-user').last()
    await sentUserMessage.hover()
    await sentUserMessage.getByRole('button', { name: /Edit|编辑/ }).click()
    await expect(
      sentUserMessage.getByRole('textbox').locator('[data-session-reference]')
    ).toHaveText('Launch research')
    await sentUserMessage.getByRole('textbox').press('Escape')
    await expect(sentChip).toHaveText('Launch research')

    const workspaceDir = resolve(app.userDataDir, 'composer-reference-workspace')
    mkdirSync(resolve(workspaceDir, 'src'), { recursive: true })
    mkdirSync(resolve(workspaceDir, 'test/src'), { recursive: true })
    writeFileSync(resolve(workspaceDir, 'src/foo.ts'), 'export const origin = "source"\n')
    writeFileSync(resolve(workspaceDir, 'test/src/foo.ts'), 'export const origin = "test"\n')
    const workspaceSessionId = await app.page.evaluate(
      async ({ providerId, projectDir }) => {
        const result = (await window.deepchat.invoke('sessions.create', {
          agentId: 'deepchat',
          message: '',
          providerId,
          modelId: 'fixture-model',
          projectDir
        })) as { session: { id: string } }
        return result.session.id
      },
      { providerId, projectDir: workspaceDir }
    )
    await openSessionById(app.page, workspaceSessionId)
    await expect(editor).toHaveCount(1)
    await editor.fill('@foo')
    const fileOptions = app.page.getByRole('option', { name: /foo\.ts/ })
    await expect(fileOptions).toHaveCount(2)
    await expect(fileOptions.nth(0)).toContainText('src/foo.ts')
    await expect(fileOptions.nth(0)).not.toContainText('test/src/foo.ts')
    await expect(fileOptions.nth(1)).toContainText('test/src/foo.ts')
    await app.page.screenshot({
      path: resolve(artifacts, 'composer-experience-file-picker.png')
    })
    await editor.press('Tab')
    const fileReference = editor.locator('[data-file-reference]')
    await expect(fileReference).toContainText('src/foo.ts')
    await editor.pressSequentially('and @foo')
    await expect(fileOptions).toHaveCount(2)
    await fileOptions.nth(1).click()
    await expect(fileReference).toHaveText(['src/foo.ts', 'test/src/foo.ts'])
    await app.page.reload()
    await waitForAppReady(app.page)
    await expect(fileReference).toHaveText(['src/foo.ts', 'test/src/foo.ts'])
    await app.page.getByTestId('chat-send-button').click()
    await expect(app.page.getByTestId('chat-page-shell')).toHaveAttribute(
      'data-generating',
      'false'
    )
    await expect(app.page.locator('[data-hero-clone="chat-input"]')).toHaveCount(0)
    const sentFileReference = app.page.getByTestId('user-message-file-reference')
    await expect(sentFileReference).toHaveText(['src/foo.ts', 'test/src/foo.ts'])

    await sentFileReference.nth(0).getByRole('button').focus()
    await app.page.keyboard.press('ControlOrMeta+f')
    const searchInput = app.page.locator('.chat-search-bar input')
    await searchInput.fill('foo.ts')
    await expect(sentFileReference.locator('[data-chat-search-match]')).toHaveCount(2)
    await expect(sentFileReference.nth(0).locator('[data-chat-search-active]')).toBeVisible()
    await searchInput.press('Enter')
    await expect(sentFileReference.nth(1).locator('[data-chat-search-active]')).toBeVisible()
    await app.page.screenshot({ path: resolve(artifacts, 'composer-review-reference-search.png') })
    await searchInput.press('Escape')

    const attachmentPath = resolve(app.userDataDir, 'composer-attachment.png')
    writeFileSync(
      attachmentPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
        'base64'
      )
    )
    await app.page
      .getByTestId('chat-input-box')
      .locator('input[type="file"]')
      .setInputFiles(attachmentPath)
    const shelf = app.page.getByTestId('attachment-shelf')
    await expect(shelf.getByTestId('chat-attachment-item')).toContainText('composer-attachment.png')
    await expect(shelf.getByTestId('attachment-representation-trigger')).toBeVisible()
    await expect(
      shelf.getByRole('button', {
        name: /Delete composer-attachment\.png|删除 composer-attachment\.png/
      })
    ).toBeVisible()
    await editor.fill('Attachment shelf editable before send.')
    await app.page.screenshot({
      path: resolve(artifacts, 'composer-experience-attachment-editable.png')
    })
    await app.page.getByTestId('chat-send-button').click()
    await expect(app.page.getByTestId('chat-page-shell')).toHaveAttribute(
      'data-generating',
      'false'
    )
    await expect(app.page.locator('[data-hero-clone="chat-input"]')).toHaveCount(0)
    const sentAttachment = app.page.getByTestId('chat-message-user').last()
    await expect(sentAttachment.getByTestId('chat-attachment-item')).toContainText(
      'composer-attachment.png'
    )
    await expect(sentAttachment.getByTestId('attachment-representation-trigger')).toHaveCount(0)
    await expect(
      sentAttachment.getByRole('button', {
        name: /Delete composer-attachment\.png|删除 composer-attachment\.png/
      })
    ).toHaveCount(0)

    const longMessage = Array.from(
      { length: 18 },
      (_, index) => `Section ${index + 1}: Composer verification 文本高度与展开行为。`
    ).join('\n')
    await editor.fill(longMessage)
    await editor.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await editor.pressSequentially(' @foo')
    await expect(fileOptions).toHaveCount(2)
    await fileOptions.nth(0).click()
    await expect(editor).toContainText(longMessage, { useInnerText: true })
    await app.page.getByTestId('chat-send-button').click()
    await expect(app.page.getByTestId('chat-page-shell')).toHaveAttribute(
      'data-generating',
      'false'
    )
    await expect(app.page.locator('[data-hero-clone="chat-input"]')).toHaveCount(0)
    const longUserMessage = app.page.getByTestId('chat-message-user').last()
    const longBody = longUserMessage.locator('[data-user-message-content-body="true"]')
    await expect(longBody).toHaveAttribute('data-user-message-collapsible', 'true')
    await expect(longBody).toHaveAttribute('data-user-message-expanded', 'false')
    await longUserMessage.locator('[data-user-message-toggle="true"]').focus()
    await app.page.keyboard.press('Shift+Tab')
    await expect(
      longUserMessage.getByTestId('user-message-file-reference').getByRole('button')
    ).toBeFocused()
    await expect(longBody).toHaveAttribute('data-user-message-expanded', 'true')
    await app.page.screenshot({ path: resolve(artifacts, 'composer-review-expanded-focus.png') })

    await app.page.setViewportSize({ width: 1280, height: 900 })
    await app.page.screenshot({
      path: resolve(artifacts, 'composer-experience-light-normal.png'),
      fullPage: false
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await app.page.locator('html').evaluate((element) => element.classList.contains('dark')))
        break
      await app.page.getByTestId('window-sidebar-theme-toggle').click()
    }
    await expect(app.page.locator('html')).toHaveClass(/dark/)
    await app.page.screenshot({
      path: resolve(artifacts, 'composer-experience-dark-normal.png'),
      fullPage: false
    })
    await app.page.setViewportSize({ width: 720, height: 820 })
    await app.page.screenshot({
      path: resolve(artifacts, 'composer-experience-dark-narrow.png'),
      fullPage: false
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await app.page.locator('html').evaluate((element) => element.classList.contains('light')))
        break
      await app.page.getByTestId('window-sidebar-theme-toggle').click()
    }
    await expect(app.page.locator('html')).not.toHaveClass(/dark/)
    await app.page.screenshot({
      path: resolve(artifacts, 'composer-experience-light-narrow.png'),
      fullPage: false
    })
    await app.page.setViewportSize({ width: 1280, height: 900 })
    await app.page.reload()
    await waitForAppReady(app.page)
    await openSessionById(app.page, targetId)

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
    await expect(chip).toHaveCount(0)
    await expect(
      app.page.getByTestId('chat-input-memory-host').getByTestId('chat-send-button')
    ).toBeDisabled()
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
        const text = 'Review  after the current turn.'
        const { item } = (await window.deepchat.invoke('sessions.queuePendingInput', {
          sessionId,
          content: {
            text,
            files: [],
            inlineItems: [{ type: 'session', offset: 7, ...reference }]
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
    await expect(queueRow).toContainText('Review Launch research after the current turn.')
    await queueRow.click()
    const queueEditor = app.page.getByTestId('pending-edit-textarea').getByRole('textbox')
    await expect(queueEditor).toHaveAttribute('contenteditable', 'true')
    expect(await queueEditor.evaluate((element) => element.tagName)).toBe('DIV')
    await queueEditor.press('End')
    await queueEditor.pressSequentially(' Please proceed.')
    await queueEditor.press('ControlOrMeta+Enter')
    await expect.poll(readQueue).toMatchObject({
      items: [
        {
          id: itemId,
          payload: {
            text: 'Review  after the current turn. Please proceed.',
            inlineItems: [{ sessionId: sourceId, offset: 7 }]
          }
        }
      ]
    })
    await queueRow.click()
    await app.page
      .getByTestId('pending-edit-textarea')
      .getByRole('button', { name: /Delete Launch research|删除 Launch research/ })
      .click()
    await queueEditor.press('ControlOrMeta+Enter')
    await expect(queueRow).toHaveText('Review after the current turn. Please proceed.')
    await expect.poll(readQueue).toMatchObject({
      items: [
        {
          id: itemId,
          payload: { text: 'Review  after the current turn. Please proceed.', inlineItems: [] }
        }
      ]
    })
    await app.page.getByTestId('pending-rail').screenshot({
      path: resolve(artifacts, 'composer-experience-queue.png')
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

    // Exercise native attachment rejection and the renderer's initial-draft handoff together.
    const recovery = await app.page.evaluate(
      async ({ providerId, sourceId, missingFile }) => {
        const { reference } = (await window.deepchat.invoke('sessions.resolveReference', {
          sessionId: sourceId
        })) as { reference: SessionReference }
        const pinia = Reflect.get(document.getElementById('app')!, '__vue_app__').config
          .globalProperties.$pinia
        const result = await pinia._s.get('session').createSession({
          agentId: 'deepchat',
          providerId,
          modelId: 'fixture-model',
          message: '',
          files: [{ name: 'missing.png', path: missingFile, mimeType: 'image/png' }],
          inlineItems: [{ type: 'session', offset: 0, ...reference }]
        })
        return result.initialTurn?.attachmentPreparation?.status
      },
      { providerId, sourceId, missingFile: resolve(app.userDataDir, 'missing.png') }
    )
    expect(recovery).toBe('needs_user_action')
    await expect(app.page.getByTestId('attachment-preparation-dialog')).toBeVisible()
    await app.page.getByRole('button', { name: /Keep draft|保留草稿/ }).click()
    await expect(chip).toHaveText('Launch research')
    await app.page.getByRole('button', { name: /(?:Delete|删除) missing.png/ }).click()
    await expect(editor.locator('[data-file-attachment]')).toHaveCount(0)
    await app.page.screenshot({ path: resolve(artifacts, 'composer-experience-recovery.png') })
    await app.page.getByTestId('chat-send-button').click()
    await expect(app.page.getByTestId('chat-message-assistant')).toContainText(
      'Reference evidence retrieved.'
    )
    await expect(sentChip).toHaveText('Launch research')
    await app.page.evaluate(
      (sessionId) => window.deepchat.invoke('sessions.delete', { sessionId }),
      sourceId
    )
    await sentChip.click()
    await app.page.getByRole('button', { name: /Open|打开/ }).click()
    const unavailable = app.page.getByText(
      /This session was deleted, reset, or is no longer available\.|该会话已删除、重置或不再可用。/
    )
    await expect(unavailable).toBeVisible()
    await expect(
      app.page.getByText(/^(Session reference unavailable|会话引用不可用)$/)
    ).toBeVisible()
    await app.page
      .locator('[data-sonner-toast]')
      .filter({ has: unavailable })
      .screenshot({
        path: resolve(artifacts, 'composer-experience-unavailable.png'),
        animations: 'disabled'
      })
    expect(app.pageErrors).toEqual([])
  } finally {
    releaseStream?.()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
