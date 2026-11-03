import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

type ScrollProbe = Window & {
  __deepchatScrollWrites?: Array<number | 'scroll' | 'scrollBy' | 'scrollTo'>
}

test('ChatPage restores virtualized history and keeps exclusive scrollbar ownership @smoke', async ({
  launchApp
}, testInfo) => {
  const initial = await launchApp()
  expect(initial.ownsUserDataDir).toBe(true)
  await waitForAppReady(initial.page)
  const ids = await initial.page.evaluate(async () => {
    await window.deepchat.invoke('config.setLanguage', { language: 'en-US' })
    const ids: string[] = []
    for (let index = 0; index < 2; index += 1) {
      const { session } = await window.deepchat.invoke('sessions.create', {
        agentId: 'deepchat',
        message: '',
        providerId: 'openai',
        modelId: 'gpt-4o'
      })
      ids.push(session.id)
    }
    return ids
  })
  expect(await initial.close()).toBe('graceful')
  const securityPath = join(initial.userDataDir, 'database-security.json')
  if (existsSync(securityPath))
    expect(JSON.parse(readFileSync(securityPath, 'utf8')).metadata?.enabled).not.toBe(true)
  // Seed only the closed, disposable profile; application reads use the production transcript adapter.
  const db = new Database(join(initial.userDataDir, 'app_db', 'agent.db'))
  const firstToken = 'history-row-000'
  try {
    const insert = db.prepare(`INSERT INTO deepchat_messages
      (id, session_id, order_seq, role, content, status, is_context_edge, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'sent', 0, '{}', ?, ?)`)
    db.transaction(() => {
      const now = Date.now()
      for (const [sessionIndex, sessionId] of ids.entries()) {
        const count = sessionIndex === 0 ? 240 : 2
        for (let index = 0; index < count; index += 1) {
          const role = index % 2 === 0 ? 'user' : 'assistant'
          const text =
            sessionIndex === 0
              ? `history-row-${String(index).padStart(3, '0')}: ${'Persisted conversation evidence. '.repeat(20)}`
              : 'Second conversation evidence.'
          const content =
            role === 'user'
              ? JSON.stringify({ text, files: [], links: [], search: false, think: false })
              : JSON.stringify([
                  { type: 'content', content: text, status: 'success', timestamp: now + index }
                ])
          insert.run(
            `scroll-${sessionIndex}-${index}`,
            sessionId,
            index + 1,
            role,
            content,
            now + index,
            now + index
          )
        }
      }
    })()
  } finally {
    db.close()
  }
  const app = await launchApp()
  await waitForAppReady(app.page)
  const activate = (sessionId: string) =>
    app.page.evaluate(
      (sessionId) => window.deepchat.invoke('sessions.activate', { sessionId }),
      sessionId
    )
  await activate(ids[0])
  await expect(app.page.getByTestId('chat-page-shell')).toBeVisible()
  await expect(app.page.getByText('history-row-239:', { exact: false }).first()).toBeVisible()
  await expect(app.page.getByTestId('history-load-earlier')).toBeVisible()
  for (let page = 0; page < 4; page += 1) {
    const earlier = app.page.getByTestId('history-load-earlier')
    if ((await earlier.count()) === 0) break
    await earlier.click()
    await expect(app.page.getByTestId('history-loading-indicator')).toHaveCount(0)
  }
  await expect(app.page.getByTestId('history-load-earlier')).toHaveCount(0)
  const restored = await app.page.evaluate(
    (sessionId) => window.deepchat.invoke('sessions.restore', { sessionId, limit: 500 }),
    ids[0]
  )
  expect(restored.messages).toHaveLength(240)
  const rows = app.page.locator(
    '[data-testid="chat-message-user"], [data-testid="chat-message-assistant"]'
  )
  await expect.poll(() => rows.count()).toBeLessThan(240)
  const historyViewport = app.page.getByTestId('chat-page')
  await historyViewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(app.page.getByText(firstToken, { exact: false }).first()).toBeVisible()
  await historyViewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(app.page.getByText('history-row-239:', { exact: false }).first()).toBeVisible()
  await activate(ids[1])
  await expect(app.page.getByTestId('chat-message-assistant')).toContainText(
    'Second conversation evidence.'
  )
  await activate(ids[0])
  await expect(app.page.getByText('history-row-239:', { exact: false }).first()).toBeVisible()
  await app.page.screenshot({ path: testInfo.outputPath('restored-virtual-history.png') })

  const viewport = app.page.getByTestId('chat-page')
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  const viewportBox = await viewport.boundingBox()
  expect(viewportBox).not.toBeNull()
  await app.page.mouse.move(
    viewportBox!.x + viewportBox!.width / 2,
    viewportBox!.y + viewportBox!.height / 2
  )
  await app.page.mouse.wheel(0, -520)
  await app.page.waitForTimeout(250)

  const readingTop = await viewport.evaluate((element) => element.scrollTop)
  expect(readingTop).toBeGreaterThan(0)

  await viewport.evaluate((element) => {
    let current: object | null = element
    let descriptor: PropertyDescriptor | undefined
    while (current && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(current, 'scrollTop')
      if (!descriptor) {
        current = Object.getPrototypeOf(current)
      }
    }
    if (!descriptor?.get || !descriptor.set) {
      throw new Error('Unable to instrument the native scrollTop accessor.')
    }

    const nativeGet = descriptor.get
    const nativeSet = descriptor.set
    ;(window as ScrollProbe).__deepchatScrollWrites = []
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => nativeGet.call(element),
      set: (value: number) => {
        ;(window as ScrollProbe).__deepchatScrollWrites!.push(value)
        nativeSet.call(element, value)
      }
    })

    for (const method of ['scroll', 'scrollBy', 'scrollTo'] as const) {
      const nativeMethod = (element[method] as (...args: unknown[]) => void).bind(element)
      Object.defineProperty(element, method, {
        configurable: true,
        value: (...args: unknown[]) => {
          ;(window as ScrollProbe).__deepchatScrollWrites!.push(method)
          nativeMethod(...args)
        }
      })
    }
  })

  const editor = app.page
    .getByTestId('chat-input-editor')
    .locator('[contenteditable="true"]')
    .first()
  await editor.fill(Array.from({ length: 12 }, (_, index) => `draft ${index}`).join('\n'))
  await app.page.waitForTimeout(250)
  await viewport.evaluate((element) => {
    const firstRow = element.querySelector<HTMLElement>(
      '[data-testid="chat-message-user"], [data-testid="chat-message-assistant"]'
    )
    if (firstRow) firstRow.style.minHeight = '480px'
  })
  await app.page.waitForTimeout(250)

  const passiveResult = await viewport.evaluate((element) => ({
    scrollTop: element.scrollTop,
    writes: [...((window as ScrollProbe).__deepchatScrollWrites ?? [])]
  }))
  expect(passiveResult.writes).toEqual([])
  expect(Math.abs(passiveResult.scrollTop - readingTop)).toBeLessThanOrEqual(1)

  await app.page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
  const searchInput = app.page.locator('.chat-search-bar input').first()
  await expect(searchInput).toBeVisible()
  await searchInput.fill('history-row-220')
  await expect(app.page.locator('[data-chat-search-active]')).toHaveCount(1)

  const navigationWrites = await viewport.evaluate(
    () => (window as ScrollProbe).__deepchatScrollWrites ?? []
  )
  expect(navigationWrites.length).toBeLessThanOrEqual(1)
})
