import { test, expect } from '../fixtures/electronApp'
import { createSmokeToken } from '../helpers/testData'
import { waitForAppReady } from '../helpers/wait'

test('browser typed routes load status and destroy without legacy IPC @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const sessionId = `e2e-browser-${createSmokeToken('route').toLowerCase()}`
  const title = `DeepChat Browser ${sessionId}`
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html><head><title>${title}</title></head><body><h1>${sessionId}</h1></body></html>`
  )}`

  const result = await app.page.evaluate(
    async ({ sessionId, url }) => {
      const events: Array<{ reason: string; initialized: boolean }> = []
      const unsubscribe = window.deepchat.on('browser.status.changed', (payload) => {
        if (payload.sessionId !== sessionId) {
          return
        }

        events.push({
          reason: payload.reason,
          initialized: Boolean(payload.status?.initialized)
        })
      })

      try {
        const loaded = await window.deepchat.invoke('browser.loadUrl', {
          sessionId,
          url,
          timeoutMs: 15_000
        })
        let afterLoad = await window.deepchat.invoke('browser.getStatus', { sessionId })

        for (let index = 0; index < 20 && afterLoad.status.page?.status !== 'ready'; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          afterLoad = await window.deepchat.invoke('browser.getStatus', { sessionId })
        }

        await window.deepchat.invoke('browser.destroy', { sessionId })
        const afterDestroy = await window.deepchat.invoke('browser.getStatus', { sessionId })

        await new Promise((resolve) => setTimeout(resolve, 300))

        return {
          afterDestroy,
          afterLoad,
          events,
          loaded
        }
      } finally {
        unsubscribe()
        await window.deepchat.invoke('browser.destroy', { sessionId }).catch(() => undefined)
      }
    },
    { sessionId, url }
  )

  expect(result.loaded.status.initialized).toBe(true)
  expect(result.loaded.status.page?.url).toBe(url)
  expect(result.afterLoad.status.initialized).toBe(true)
  expect(result.afterLoad.status.page?.status).toBe('ready')
  expect(result.afterLoad.status.page?.title).toBe(title)
  expect(result.afterDestroy.status).toMatchObject({
    initialized: false,
    page: null,
    visible: false
  })
  expect(result.events.map((event) => event.reason)).toEqual(
    expect.arrayContaining(['created', 'updated', 'closed'])
  )
})
