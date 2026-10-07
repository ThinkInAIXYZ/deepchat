import type { useSessionStore } from '../../../src/renderer/src/stores/ui/session'
import { test, expect } from '../fixtures/electronApp'
import { waitForAppReady } from '../helpers/wait'

test('Chat rows stay below their header throughout expansion @smoke', async ({ app }) => {
  const { page } = app
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await waitForAppReady(page)
  await page.waitForFunction(() => {
    const pinia = Reflect.get(document.getElementById('app')!, '__vue_app__').config
      .globalProperties.$pinia
    return pinia._s.get('session').hasLoadedInitialPage
  })
  // Seed only the presentation state; this regression needs real layout and CSS transitions.
  await page.evaluate(() => {
    const pinia = Reflect.get(document.getElementById('app')!, '__vue_app__').config
      .globalProperties.$pinia
    const store = pinia._s.get('session') as ReturnType<typeof useSessionStore>
    pinia._s.get('sidebar').setCollapsed(false)
    store.sessions = Array.from({ length: 5 }, (_, index) => ({
      id: `chat-expansion-${index}`,
      title: `Chat expansion ${index}`,
      agentId: 'deepchat',
      status: 'none',
      projectDir: '',
      isPinned: false,
      isDraft: false,
      sessionKind: 'regular',
      parentSessionId: null,
      subagentMeta: null,
      orchestrationPolicy: 'explicit',
      toolModeOverride: null,
      createdAt: Date.now() - index,
      updatedAt: Date.now() - index
    }))
    store.hasMore = false
  })
  const header = page.locator('[data-group-id="__chat__"]')
  const rows = page.locator('[data-session-id^="chat-expansion-"]')
  await expect(rows).toHaveCount(5)

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    // Start sampling in the same task as expansion: Playwright's actionability wait
    // otherwise misses the first frames of the incorrect viewport-origin animation.
    const samples = await header.evaluate(async (button) => {
      const header = button as HTMLButtonElement
      header.click()
      const samples: Array<{ count: number; minimumGap: number }> = []
      for (let frame = 0; frame < 30; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const bottom = button.parentElement!.getBoundingClientRect().bottom
        const rows = [...document.querySelectorAll('[data-session-id^="chat-expansion-"]')]
        samples.push({
          count: rows.length,
          minimumGap: Math.min(...rows.map((row) => row.getBoundingClientRect().top - bottom))
        })
      }
      return samples
    })
    expect(samples.every(({ count }) => count === 5)).toBe(true)
    expect(Math.min(...samples.map(({ minimumGap }) => minimumGap))).toBeGreaterThanOrEqual(-1)
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(rows.first()).toBeVisible()
  }
  expect(app.pageErrors).toEqual([])
})
