import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MockBrowserWindow extends EventEmitter {
  readonly id = 7
  destroyed = false
  visible = true
  focused = true
  minimized = false

  isDestroyed() {
    return this.destroyed
  }

  isVisible() {
    return this.visible
  }

  isFocused() {
    return this.focused
  }

  isMinimized() {
    return this.minimized
  }

  getTitle() {
    return 'DeepChat'
  }

  getContentBounds() {
    return { x: 10, y: 20, width: 800, height: 600 }
  }

  getNativeWindowHandle() {
    return Buffer.alloc(process.platform === 'linux' ? 4 : 8)
  }
}

describe('AgentPreviewCoordinator', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const setup = async (startResult = true) => {
    const screen = new EventEmitter()
    const overlay = Object.assign(new EventEmitter(), {
      start: vi.fn(() => startResult),
      stop: vi.fn(() => true),
      attachHost: vi.fn(() => true),
      detachHost: vi.fn(() => true),
      setVisible: vi.fn(() => true),
      setMaxSize: vi.fn(() => true),
      pushImage: vi.fn(() => true),
      setActiveSession: vi.fn(() => true),
      removeImage: vi.fn(() => true)
    })

    vi.doMock('electron', () => ({
      app: {
        getName: () => 'DeepChat'
      },
      screen
    }))
    vi.doMock('@zerob13/nativekit', () => ({ overlay }))
    vi.doMock('@shared/logger', () => ({
      default: {
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    const { AgentPreviewCoordinator } = await import('@/desktop/preview/AgentPreviewCoordinator')
    const browserAction = vi.fn()
    const computerAction = vi.fn()
    const coordinator = new AgentPreviewCoordinator()
    coordinator.register('browser', browserAction)
    coordinator.register('computer-use', computerAction)

    const browserTarget = (epoch = 3) => {
      const claimSequence = coordinator.claim({
        source: 'browser',
        sessionId: 'session-1',
        runId: 'run-1'
      })
      return {
        source: 'browser' as const,
        windowId: 7,
        sessionId: 'session-1',
        runId: 'run-1',
        epoch,
        claimSequence
      }
    }

    return {
      coordinator,
      browserAction,
      computerAction,
      browserTarget,
      overlay,
      screen,
      host: new MockBrowserWindow()
    }
  }

  it('does not start NativeKit until initialization is requested', async () => {
    const { coordinator, overlay } = await setup()

    expect(overlay.start).not.toHaveBeenCalled()

    await expect(coordinator.initialize()).resolves.toBe(true)
    expect(overlay.start).toHaveBeenCalledOnce()
  })

  it('pushes a current JPEG before showing the native panel', async () => {
    const { coordinator, browserTarget, overlay, host } = await setup()
    const target = browserTarget()

    await expect(coordinator.initialize()).resolves.toBe(true)
    expect(overlay.start).toHaveBeenCalledWith({
      toolbar: {
        style: 'dark',
        buttons: [
          {
            id: 'open-panel',
            imageData: expect.stringMatching(/^data:image\/png;base64,/),
            tooltip: 'Open in side panel'
          },
          {
            id: 'close',
            imageData: expect.stringMatching(/^data:image\/png;base64,/),
            tooltip: 'Close'
          }
        ]
      }
    })
    expect(overlay.setMaxSize).toHaveBeenCalledWith(360)
    expect(overlay.setVisible).toHaveBeenCalledWith(false)
    expect(coordinator.prepare(target, host as never)).toBe('native-overlay')
    expect(overlay.setVisible).toHaveBeenLastCalledWith(false)

    expect(coordinator.present(target, Buffer.from('frame'))).toBe(true)

    expect(overlay.pushImage).toHaveBeenCalledWith({
      hostId: 'chat-window:7',
      presentationId: 'agent-preview:browser:7:session-1',
      sessionId: 'agent-preview:browser:session-1',
      imageData: `data:image/jpeg;base64,${Buffer.from('frame').toString('base64')}`
    })
    expect(overlay.setActiveSession).toHaveBeenCalledWith('agent-preview:browser:session-1')
    expect(overlay.setVisible).toHaveBeenLastCalledWith(true)
    expect(overlay.pushImage.mock.invocationCallOrder[0]).toBeLessThan(
      overlay.setActiveSession.mock.invocationCallOrder[0]
    )
    expect(overlay.setActiveSession.mock.invocationCallOrder[0]).toBeLessThan(
      overlay.setVisible.mock.invocationCallOrder.at(-1)!
    )

    coordinator.shutdown()
  })

  it('refreshes the same presentation without resetting native placement state', async () => {
    const { coordinator, browserTarget, overlay, host } = await setup()
    const target = browserTarget()

    await coordinator.initialize()
    coordinator.prepare(target, host as never)
    coordinator.present(target, Buffer.from('frame-1'))
    coordinator.prepare(target, host as never)
    expect(overlay.attachHost).toHaveBeenCalledOnce()

    overlay.attachHost.mockClear()
    overlay.detachHost.mockClear()
    overlay.removeImage.mockClear()
    overlay.setActiveSession.mockClear()
    overlay.setVisible.mockClear()

    expect(coordinator.present(target, Buffer.from('frame-2'))).toBe(true)

    expect(overlay.pushImage).toHaveBeenCalledTimes(2)
    expect(overlay.pushImage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentationId: 'agent-preview:browser:7:session-1',
        sessionId: 'agent-preview:browser:session-1'
      })
    )
    expect(overlay.attachHost).not.toHaveBeenCalled()
    expect(overlay.detachHost).not.toHaveBeenCalled()
    expect(overlay.removeImage).not.toHaveBeenCalled()
    expect(overlay.setActiveSession).not.toHaveBeenCalled()
    expect(overlay.setVisible).not.toHaveBeenCalled()

    coordinator.shutdown()
  })

  it('keeps NativeKit available after a transient frame push failure', async () => {
    const { coordinator, browserTarget, overlay, host } = await setup()
    const target = browserTarget()

    await coordinator.initialize()
    expect(coordinator.prepare(target, host as never)).toBe('native-overlay')
    expect(coordinator.present(target, Buffer.from('frame-1'))).toBe(true)

    overlay.pushImage.mockReturnValueOnce(false)
    expect(coordinator.present(target, Buffer.from('frame-2'))).toBe(false)
    expect(coordinator.isAvailable()).toBe(true)
    expect(overlay.stop).not.toHaveBeenCalled()
    expect(overlay.removeImage).not.toHaveBeenCalled()

    expect(coordinator.prepare(target, host as never)).toBe('native-overlay')
    expect(coordinator.present(target, Buffer.from('frame-3'))).toBe(true)

    coordinator.shutdown()
  })

  it('switches to the close-only Computer Use toolbar and ignores activation', async () => {
    const { coordinator, browserAction, browserTarget, computerAction, overlay, host } =
      await setup()
    const browser = browserTarget(4)
    await coordinator.initialize()
    coordinator.prepare(browser, host as never)
    coordinator.present(browser, Buffer.from('browser'))

    const claimSequence = coordinator.claim({
      source: 'computer-use',
      sessionId: 'session-1',
      runId: 'run-1'
    })
    const computer = {
      source: 'computer-use' as const,
      windowId: 7,
      sessionId: 'session-1',
      runId: 'run-1',
      epoch: 5,
      claimSequence
    }

    expect(coordinator.prepare(computer, host as never)).toBe('native-overlay')
    expect(browserAction).toHaveBeenCalledWith('superseded', browser)
    expect(overlay.start).toHaveBeenLastCalledWith({
      toolbar: {
        style: 'dark',
        buttons: [
          {
            id: 'close',
            imageData: expect.stringMatching(/^data:image\/png;base64,/),
            tooltip: 'Close'
          }
        ]
      }
    })

    overlay.emit('activate')
    overlay.emit('control', 'open-panel')
    expect(computerAction).not.toHaveBeenCalled()

    overlay.emit('control', 'close')
    expect(computerAction).toHaveBeenCalledWith('dismiss', computer)

    coordinator.shutdown()
  })

  it('keeps host movement native and maps Browser controls to the current target', async () => {
    const { coordinator, browserAction, browserTarget, overlay, host, screen } = await setup()
    const target = browserTarget(4)
    await coordinator.initialize()
    coordinator.prepare(target, host as never)
    coordinator.present(target, Buffer.from('frame'))

    host.focused = false
    host.emit('blur')
    expect(overlay.setVisible).toHaveBeenLastCalledWith(false)

    host.emit('move')
    screen.emit('display-metrics-changed')
    await vi.advanceTimersByTimeAsync(50)
    expect(overlay.attachHost).toHaveBeenCalledTimes(2)

    overlay.emit('activate')
    overlay.emit('control', 'open-panel')
    overlay.emit('control', 'unknown')
    overlay.emit('control', 'close')
    expect(browserAction).toHaveBeenNthCalledWith(1, 'activate', target)
    expect(browserAction).toHaveBeenNthCalledWith(2, 'activate', target)
    expect(browserAction).toHaveBeenNthCalledWith(3, 'dismiss', target)
    expect(browserAction).toHaveBeenCalledTimes(3)

    coordinator.shutdown()
  })

  it('disables preview when native startup fails', async () => {
    const { coordinator, browserTarget, overlay, host } = await setup(false)
    const target = browserTarget(1)

    await expect(coordinator.initialize()).resolves.toBe(false)
    expect(coordinator.prepare(target, host as never)).toBe('none')
    expect(overlay.attachHost).not.toHaveBeenCalled()
  })

  it('disables preview permanently when the first real host cannot attach', async () => {
    const { coordinator, browserTarget, overlay, host } = await setup()
    overlay.attachHost.mockReturnValue(false)
    await coordinator.initialize()

    expect(coordinator.prepare(browserTarget(1), host as never)).toBe('none')
    expect(coordinator.isAvailable()).toBe(false)
    await expect(coordinator.initialize()).resolves.toBe(false)
    expect(overlay.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps run dismissal scoped to the current source owner', async () => {
    const { coordinator, browserTarget, host } = await setup(false)
    const browser = browserTarget()
    await coordinator.initialize()
    coordinator.prepare(browser, host as never)

    expect(
      coordinator.dismiss({
        source: 'computer-use',
        sessionId: browser.sessionId,
        runId: browser.runId
      })
    ).toBe(false)
    expect(coordinator.isCurrent(browser)).toBe(true)
    expect(
      coordinator.dismiss({
        source: 'browser',
        sessionId: browser.sessionId,
        runId: browser.runId
      })
    ).toBe(true)
    expect(coordinator.isCurrent(browser)).toBe(false)
  })

  it('uses the matching session claim when another session owns the visible surface', async () => {
    const { coordinator, browserTarget, host } = await setup(false)
    const browser = browserTarget()
    await coordinator.initialize()
    coordinator.prepare(browser, host as never)

    const computerClaimSequence = coordinator.claim({
      source: 'computer-use',
      sessionId: 'session-2',
      runId: 'run-2'
    })
    coordinator.prepare(
      {
        source: 'computer-use',
        windowId: 7,
        sessionId: 'session-2',
        runId: 'run-2',
        epoch: 1,
        claimSequence: computerClaimSequence
      },
      host as never
    )

    expect(
      coordinator.dismiss({
        source: 'browser',
        sessionId: browser.sessionId,
        runId: browser.runId
      })
    ).toBe(true)
  })
})
