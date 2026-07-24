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

describe('AgentBrowserNativeOverlay', () => {
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

    const { AgentBrowserNativeOverlay } =
      await import('@/desktop/browser/AgentBrowserNativeOverlay')
    const onAction = vi.fn()
    const adapter = new AgentBrowserNativeOverlay(onAction)

    return {
      adapter,
      onAction,
      overlay,
      screen,
      host: new MockBrowserWindow()
    }
  }

  it('pushes a current JPEG before showing the native panel', async () => {
    const { adapter, overlay, host } = await setup()
    const target = {
      windowId: 7,
      sessionId: 'session-1',
      runId: 'run-1',
      captureEpoch: 3
    }

    await expect(adapter.initialize()).resolves.toBe(true)
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
    expect(adapter.prepare(target, host as never)).toBe(true)
    expect(overlay.setVisible).toHaveBeenLastCalledWith(false)

    expect(adapter.present(target, Buffer.from('frame'))).toBe(true)

    expect(overlay.pushImage).toHaveBeenCalledWith({
      hostId: 'chat-window:7',
      presentationId: 'agent-browser:7:session-1',
      sessionId: 'agent-browser:session-1',
      imageData: `data:image/jpeg;base64,${Buffer.from('frame').toString('base64')}`
    })
    expect(overlay.setActiveSession).toHaveBeenCalledWith('agent-browser:session-1')
    expect(overlay.setVisible).toHaveBeenLastCalledWith(true)
    expect(overlay.pushImage.mock.invocationCallOrder[0]).toBeLessThan(
      overlay.setActiveSession.mock.invocationCallOrder[0]
    )
    expect(overlay.setActiveSession.mock.invocationCallOrder[0]).toBeLessThan(
      overlay.setVisible.mock.invocationCallOrder.at(-1)!
    )

    adapter.shutdown()
  })

  it('refreshes the same presentation without resetting native placement state', async () => {
    const { adapter, overlay, host } = await setup()
    const target = {
      windowId: 7,
      sessionId: 'session-1',
      runId: 'run-1',
      captureEpoch: 3
    }

    await adapter.initialize()
    adapter.prepare(target, host as never)
    adapter.present(target, Buffer.from('frame-1'))

    overlay.attachHost.mockClear()
    overlay.detachHost.mockClear()
    overlay.removeImage.mockClear()
    overlay.setActiveSession.mockClear()
    overlay.setVisible.mockClear()

    expect(adapter.present(target, Buffer.from('frame-2'))).toBe(true)

    expect(overlay.pushImage).toHaveBeenCalledTimes(2)
    expect(overlay.pushImage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentationId: 'agent-browser:7:session-1',
        sessionId: 'agent-browser:session-1'
      })
    )
    expect(overlay.attachHost).not.toHaveBeenCalled()
    expect(overlay.detachHost).not.toHaveBeenCalled()
    expect(overlay.removeImage).not.toHaveBeenCalled()
    expect(overlay.setActiveSession).not.toHaveBeenCalled()
    expect(overlay.setVisible).not.toHaveBeenCalled()

    adapter.shutdown()
  })

  it('keeps host movement native and maps unscoped controls to the current target', async () => {
    const { adapter, onAction, overlay, host, screen } = await setup()
    const target = {
      windowId: 7,
      sessionId: 'session-1',
      runId: 'run-1',
      captureEpoch: 4
    }
    await adapter.initialize()
    adapter.prepare(target, host as never)
    adapter.present(target, Buffer.from('frame'))

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
    expect(onAction).toHaveBeenNthCalledWith(1, 'activate', target)
    expect(onAction).toHaveBeenNthCalledWith(2, 'activate', target)
    expect(onAction).toHaveBeenNthCalledWith(3, 'dismiss', target)
    expect(onAction).toHaveBeenCalledTimes(3)

    adapter.shutdown()
  })

  it('reports unavailable without attaching when native startup fails', async () => {
    const { adapter, overlay, host } = await setup(false)

    await expect(adapter.initialize()).resolves.toBe(false)
    expect(
      adapter.prepare(
        {
          windowId: 7,
          sessionId: 'session-1',
          runId: 'run-1',
          captureEpoch: 1
        },
        host as never
      )
    ).toBe(false)
    expect(overlay.attachHost).not.toHaveBeenCalled()
  })

  it('falls back permanently when the first real host cannot attach', async () => {
    const { adapter, overlay, host } = await setup()
    overlay.attachHost.mockReturnValue(false)
    await adapter.initialize()

    expect(
      adapter.prepare(
        {
          windowId: 7,
          sessionId: 'session-1',
          runId: 'run-1',
          captureEpoch: 1
        },
        host as never
      )
    ).toBe(false)
    expect(adapter.isAvailable()).toBe(false)
    await expect(adapter.initialize()).resolves.toBe(false)
    expect(overlay.stop).toHaveBeenCalledTimes(1)
  })
})
