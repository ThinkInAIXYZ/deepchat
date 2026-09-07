import { test, expect } from '../fixtures/electronApp'
import { createSmokeToken } from '../helpers/testData'
import { waitForAppReady } from '../helpers/wait'

test('browser typed routes load status and destroy without legacy IPC @smoke', async ({ app }) => {
  await waitForAppReady(app.page)

  const titlePrefix = `DeepChat Browser ${createSmokeToken('route').toLowerCase()}`

  const result = await app.page.evaluate(
    async ({ titlePrefix }) => {
      const created = await window.deepchat.invoke('sessions.create', {
        agentId: 'deepchat',
        message: '',
        providerId: 'openai',
        modelId: 'gpt-4o-mini'
      })
      const sessionId = created.session.id
      const title = `${titlePrefix} ${sessionId}`
      const url = `data:text/html;charset=utf-8,${encodeURIComponent(
        `<!doctype html><html><head><title>${title}</title></head><body><h1>${sessionId}</h1></body></html>`
      )}`
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
          loaded,
          title,
          url
        }
      } finally {
        unsubscribe()
        await window.deepchat.invoke('browser.destroy', { sessionId }).catch(() => undefined)
        await window.deepchat.invoke('sessions.delete', { sessionId }).catch(() => undefined)
      }
    },
    { titlePrefix }
  )

  expect(result.loaded.status.initialized).toBe(true)
  expect(result.loaded.status.page?.url).toBe(result.url)
  expect(result.afterLoad.status.initialized).toBe(true)
  expect(result.afterLoad.status.page?.status).toBe('ready')
  expect(result.afterLoad.status.page?.title).toBe(result.title)
  expect(result.afterDestroy.status).toMatchObject({
    initialized: false,
    page: null,
    visible: false
  })
  expect(result.events.map((event) => event.reason)).toEqual(
    expect.arrayContaining(['created', 'updated', 'closed'])
  )
})
