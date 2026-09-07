import { test, expect } from '../fixtures/electronApp'
import {
  createNewChat,
  getAssistantMessages,
  getUserMessages,
  selectAgent,
  selectModel,
  sendMessage
} from '../helpers/chat'
import {
  createExactReplyPrompt,
  createSmokeToken,
  E2E_TARGET_MODEL_ID,
  E2E_TARGET_PROVIDER_ID
} from '../helpers/testData'
import { waitForAppReady, waitForGenerationDone } from '../helpers/wait'

type ScrollProbe = Window & {
  __deepchatScrollWrites?: Array<number | 'scroll' | 'scrollBy' | 'scrollTo'>
}

test('ChatPage keeps exclusive scrollbar ownership @smoke', async ({ app }) => {
  test.skip(
    process.env.RUN_PROVIDER_INTEGRATION !== 'true',
    'Set RUN_PROVIDER_INTEGRATION=true to run the real ChatPage scroll check.'
  )

  const firstToken = createSmokeToken('E2E_SCROLL_ONE')
  const secondToken = createSmokeToken('E2E_SCROLL_TWO')

  await waitForAppReady(app.page)
  await selectAgent(app.page)
  await createNewChat(app.page)
  await selectModel(app.page, E2E_TARGET_MODEL_ID, E2E_TARGET_PROVIDER_ID)

  await sendMessage(app.page, createExactReplyPrompt(firstToken))
  await waitForGenerationDone(app.page)
  await sendMessage(app.page, createExactReplyPrompt(secondToken))
  await waitForGenerationDone(app.page)

  await expect(getUserMessages(app.page)).toHaveCount(2)
  await expect(getAssistantMessages(app.page)).toHaveCount(2)

  const viewport = app.page.getByTestId('chat-page')
  await viewport.evaluate((element) => {
    const rows = element.querySelectorAll<HTMLElement>(
      '[data-testid="chat-message-user"], [data-testid="chat-message-assistant"]'
    )
    rows.forEach((row) => {
      row.style.minHeight = '360px'
    })
  })
  await app.page.waitForTimeout(250)

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
  await searchInput.fill(firstToken)
  await expect(app.page.locator('[data-chat-search-active]')).toHaveCount(1)

  const navigationWrites = await viewport.evaluate(
    () => (window as ScrollProbe).__deepchatScrollWrites ?? []
  )
  expect(navigationWrites.length).toBeLessThanOrEqual(1)
})
