import { expect, it, vi } from 'vitest'
import { getYoBrowserUnpartitionedCookies } from '@/desktop/browser/yoBrowserSession'

const fixture = vi.hoisted(() => ({
  failDetach: false,
  closeRequested: () => {},
  finishClose: () => {}
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    session: {
      fromPartition: () => ({
        setPermissionRequestHandler() {},
        setUserAgent() {},
        webRequest: { onBeforeSendHeaders() {} }
      })
    },
    WebContentsView: class {
      webContents = new (class extends EventEmitter {
        destroyed = false
        debugger = {
          attach() {},
          isAttached: () => true,
          detach() {
            if (fixture.failDetach) throw new Error('Native detach refused')
          },
          sendCommand: async () => ({
            cookies: [
              { name: 'plain', value: 'fixture', domain: 'example.test', path: '/', session: true },
              { name: 'partitioned', partitionKey: { topLevelSite: 'https://example.test' } }
            ]
          })
        }
        isDestroyed() {
          return this.destroyed
        }
        close() {
          fixture.closeRequested()
        }
      })()
      constructor() {
        fixture.finishClose = () => {
          this.webContents.destroyed = true
          this.webContents.emit('destroyed')
        }
      }
    }
  }
})

it.each([false, true])(
  'joins temporary cookie-view destruction when detach fails: %s',
  async (failDetach) => {
    const entered = Promise.withResolvers<void>()
    fixture.failDetach = failDetach
    fixture.closeRequested = () => entered.resolve()
    let settled = false
    const reading = getYoBrowserUnpartitionedCookies().then(
      (cookies) => {
        settled = true
        return { cookies }
      },
      (error: unknown) => {
        settled = true
        return { error }
      }
    )
    try {
      await entered.promise
      await Promise.resolve()
      expect(settled).toBe(false)
      fixture.finishClose()
      const result = await reading
      if (failDetach) expect(result).toMatchObject({ error: new Error('Native detach refused') })
      else
        expect(result).toMatchObject({
          cookies: [{ name: 'plain', value: 'fixture', url: 'http://example.test/' }]
        })
    } finally {
      fixture.finishClose()
      await reading
    }
  }
)
