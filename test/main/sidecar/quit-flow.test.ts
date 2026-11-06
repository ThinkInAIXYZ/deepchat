import { afterEach, describe, expect, it, vi } from 'vitest'
import { app, emitAppBeforeQuit, installElectronShimHooks } from '@/platform/node/electron'
import { SidecarLifecycle } from '@/sidecar/lifecycle'

afterEach(() => {
  app.removeAllListeners('before-quit')
})

describe('sidecar quit approval', () => {
  it('runs real before-quit listeners before notifying the shell', () => {
    const sendEvent = vi.fn()
    const lifecycle = new SidecarLifecycle(emitAppBeforeQuit)
    const quitRequested = vi.fn(() => lifecycle.notifyQuitRequested())
    installElectronShimHooks({ sendEvent, quitRequested })
    let approved = false
    const listener = vi.fn((event: { preventDefault: () => void }) => {
      if (!approved) {
        event.preventDefault()
      }
    })
    app.on('before-quit', listener)

    app.quit()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(sendEvent).not.toHaveBeenCalled()
    expect(quitRequested).not.toHaveBeenCalled()

    const shuttingDown = lifecycle.shutdown()
    approved = true
    app.quit()

    expect(listener).toHaveBeenCalledTimes(3)
    expect(sendEvent).toHaveBeenCalledOnce()
    expect(sendEvent).toHaveBeenCalledWith('app.quit.requested', {})
    expect(quitRequested).toHaveBeenCalledOnce()
    return expect(shuttingDown).resolves.toBeUndefined()
  })

  it('keeps app.exit immediate without a before-quit cycle', () => {
    const sendEvent = vi.fn()
    const quitRequested = vi.fn()
    const listener = vi.fn()
    installElectronShimHooks({ sendEvent, quitRequested })
    app.on('before-quit', listener)

    app.exit()

    expect(listener).not.toHaveBeenCalled()
    expect(sendEvent).toHaveBeenCalledWith('app.quit.requested', {})
    expect(quitRequested).toHaveBeenCalledOnce()
  })
})
