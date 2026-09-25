import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import { test, expect } from '../fixtures/electronApp'
import { selectAgent } from '../helpers/chat'
import { waitForAppReady } from '../helpers/wait'

async function paste(target: Locator, formats: Record<string, string>) {
  return target.evaluate((element, values) => {
    const clipboardData = new DataTransfer()
    for (const [format, value] of Object.entries(values)) {
      clipboardData.setData(format, value)
    }
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
    element.dispatchEvent(event)
    return event.defaultPrevented
  }, formats)
}

test('unfocused composer accepts text, links, images and files once @smoke', async ({ app }) => {
  await waitForAppReady(app.page)
  await selectAgent(app.page, 'deepchat')
  const editor = app.page.getByTestId('chat-input-contenteditable')
  const heading = app.page.getByTestId('new-thread-page').locator('h1')
  const body = app.page.locator('body')
  await expect(editor).toBeVisible()

  await editor.fill('Draft: ')
  const newThreadPage = app.page.getByTestId('new-thread-page')
  const pageHeight = await newThreadPage.evaluate((element) => element.clientHeight)
  await newThreadPage.click({ position: { x: 16, y: pageHeight - 16 } })
  await expect(editor).not.toBeFocused()
  // Native paste can target the selection in the model button while the page has focus.
  await paste(app.page.getByTestId('app-model-switcher').locator('span').last(), {
    'text/plain': 'first  line\n<tag>second</tag>'
  })
  await expect(editor).toBeFocused()
  await expect(editor.locator('p')).toHaveText(['Draft: first  line', '<tag>second</tag>'])
  expect(
    await editor.locator('p').evaluateAll((nodes) => nodes.map((node) => node.textContent))
  ).toEqual(['Draft: first  line', '<tag>second</tag>'])

  await editor.press('ControlOrMeta+A')
  await paste(editor, { 'text/plain': 'Replacement' })
  await expect(editor).toHaveText('Replacement')

  await heading.click()
  await paste(body, {
    'text/plain': 'https://example.com/a?b=1#c',
    'text/html': '<a href="https://example.com/a?b=1#c">Page title</a>'
  })
  await expect(editor).toHaveText('Replacementhttps://example.com/a?b=1#c')

  await heading.click()
  await paste(body, { 'text/uri-list': 'https://example.com/uri' })
  await expect(editor).toHaveText('Replacementhttps://example.com/a?b=1#chttps://example.com/uri')

  await editor.fill('Links: ')
  await heading.click()
  await paste(body, { 'text/uri-list': 'https://example.com/one\r\nhttps://example.com/two' })
  await expect(editor).toHaveText('Links: https://example.com/one https://example.com/two')

  await editor.fill('Draft: ')
  await heading.click()
  await paste(body, { 'text/html': '<p>Rich text</p><p>Second line</p>' })
  await expect(editor.locator('p')).toHaveText(['Draft: Rich text', 'Second line'])

  await heading.click()
  expect(await paste(body, {})).toBe(false)
  await expect(editor).not.toBeFocused()

  const textPath = join(app.userDataDir, 'paste-fixture.txt')
  const imagePath = join(app.userDataDir, 'paste-fixture.png')
  writeFileSync(textPath, 'File paste fixture')
  writeFileSync(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64'
    )
  )
  await app.page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'paste-fixture-files'
    input.type = 'file'
    input.multiple = true
    input.hidden = true
    document.body.appendChild(input)
  })
  await app.page.locator('#paste-fixture-files').setInputFiles([textPath, imagePath])
  for (const [index, target] of [body, app.page.getByTestId('chat-input-editor')].entries()) {
    if (index > 0) {
      await editor.press('End')
      await app.page.getByTestId('app-main').focus()
      await expect(editor).not.toBeFocused()
      expect(
        await editor.evaluate((element) =>
          element.contains(document.getSelection()?.anchorNode ?? null)
        )
      ).toBe(true)
    }
    await target.evaluate((element) => {
      const input = document.querySelector<HTMLInputElement>('#paste-fixture-files')!
      const clipboardData = new DataTransfer()
      for (const file of Array.from(input.files!)) clipboardData.items.add(file)
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
      )
    })
    await expect(editor).toBeFocused()
    await expect(editor.locator('.file-chip')).toHaveCount((index + 1) * 2)
    await expect(editor.locator('.file-chip').filter({ hasText: 'paste-fixture.txt' })).toHaveCount(
      index + 1
    )
    await expect(editor.locator('.file-chip').filter({ hasText: 'paste-fixture.png' })).toHaveCount(
      index + 1
    )
  }
  await app.page.locator('#paste-fixture-files').evaluate((element) => element.remove())
  await expect(editor).toContainText('Draft: Rich text')
  await expect(editor).toContainText('Second line')

  const sessionId = await app.page.evaluate(async () => {
    const { session } = await window.deepchat.invoke('sessions.create', {
      agentId: 'deepchat',
      message: '',
      providerId: 'openai',
      modelId: 'gpt-4o-mini'
    })
    return session.id
  })
  await app.page
    .locator(`[data-testid="sidebar-session-item"][data-session-id="${sessionId}"]`)
    .click()
  const viewport = app.page.getByTestId('chat-page')
  await expect(viewport).toBeVisible()
  await expect(app.page.getByTestId('chat-session-loading-overlay')).toHaveCount(0)
  await editor.fill('Session draft: ')
  await viewport.focus()
  expect(await paste(viewport, { 'text/plain': 'pasted' })).toBe(true)
  await expect(editor).toBeFocused()
  await expect(editor).toHaveText('Session draft: pasted')

  await app.page.keyboard.press('ControlOrMeta+f')
  const search = app.page.locator('.chat-search-bar input')
  await expect(search).toBeFocused()
  expect(await paste(search, { 'text/plain': 'search text' })).toBe(false)
  await expect(search).toBeFocused()
  await expect(editor).toHaveText('Session draft: pasted')
})
