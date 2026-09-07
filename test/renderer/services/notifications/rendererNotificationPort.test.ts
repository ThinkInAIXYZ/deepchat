import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

const loadPort = async (notify: ReturnType<typeof vi.fn>) => {
  vi.resetModules()
  vi.doMock('@renderer-notifications/rendererNotificationRuntime', () => ({
    rendererNotificationManager: { notify }
  }))
  return import('@renderer-notifications/rendererNotificationPort')
}

describe('rendererNotificationPort', () => {
  it('reports whether a notification was accepted', async () => {
    const notify = vi.fn()
    const { notifyRenderer } = await loadPort(notify)
    const request = {
      kind: 'success',
      code: 'test.saved',
      title: 'Saved'
    } as const

    expect(notifyRenderer(request)).toBe(true)
    expect(notify).toHaveBeenCalledWith(request, undefined)
  })

  it('keeps presenter failures out of business control flow', async () => {
    const failure = new Error('presenter unavailable')
    const notify = vi.fn(() => {
      throw failure
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { notifyRenderer } = await loadPort(notify)

    expect(
      notifyRenderer({
        kind: 'error',
        code: 'test.failed',
        title: 'Failed'
      })
    ).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      '[RendererNotificationPort] notification failed',
      failure
    )
  })
})
