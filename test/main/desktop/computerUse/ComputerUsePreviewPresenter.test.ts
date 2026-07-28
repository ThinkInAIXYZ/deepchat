import { EventEmitter } from 'node:events'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MockBrowserWindow extends EventEmitter {
  destroyed = false

  constructor(readonly id: number) {
    super()
  }

  isDestroyed() {
    return this.destroyed
  }
}

describe('ComputerUsePreviewPresenter', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setup = async (nativeSurface: 'native-overlay' | 'renderer-canvas' = 'renderer-canvas') => {
    const windows = new Map<number, MockBrowserWindow>([[7, new MockBrowserWindow(7)]])
    vi.doMock('electron', () => ({
      BrowserWindow: {
        fromId: (id: number) => windows.get(id) ?? null
      }
    }))
    vi.doMock('@shared/logger', () => ({
      default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    }))

    const { ComputerUsePreviewPresenter } =
      await import('@/desktop/computerUse/ComputerUsePreviewPresenter')
    let actionHandler:
      | ((action: 'activate' | 'dismiss' | 'superseded', target: Record<string, unknown>) => void)
      | null = null
    let nextClaimSequence = 0
    const coordinator = {
      register: vi.fn(
        (
          _source: 'computer-use',
          handler: (
            action: 'activate' | 'dismiss' | 'superseded',
            target: Record<string, unknown>
          ) => void
        ) => {
          actionHandler = handler
          return vi.fn()
        }
      ),
      initialize: vi.fn(async () => nativeSurface === 'native-overlay'),
      claim: vi.fn(() => ++nextClaimSequence),
      releaseClaim: vi.fn(),
      dismiss: vi.fn(() => true),
      prepare: vi.fn(() => nativeSurface),
      present: vi.fn(() => true),
      hide: vi.fn(),
      removeTarget: vi.fn()
    }
    const windowPresenter = {
      sendToWindow: vi.fn(() => true)
    }
    const presenter = new ComputerUsePreviewPresenter(
      windowPresenter as never,
      coordinator as never
    )

    return {
      presenter,
      coordinator,
      windowPresenter,
      windows,
      getActionHandler: () => actionHandler
    }
  }

  const call = (
    toolCallId: string,
    options: {
      runId?: string
      pid?: number
      windowId?: number
      toolName?: string
    } = {}
  ) => ({
    conversationId: 'session-1',
    runId: options.runId ?? 'run-1',
    toolCallId,
    toolName: options.toolName ?? 'get_window_state',
    args: {
      pid: options.pid ?? 12,
      window_id: options.windowId ?? 34
    },
    source: {
      serverName: 'cua-driver',
      ownerPluginId: 'com.deepchat.plugins.cua'
    }
  })

  const createPng = async (width = 960, height = 600, red = 20) =>
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: red, g: 40, b: 60 }
      }
    })
      .png()
      .toBuffer()

  const completeWithImage = async (
    presenter: {
      completed: (call: ReturnType<typeof call>, result: never) => void
    },
    currentCall: ReturnType<typeof call>,
    image: Buffer,
    mimeType = 'image/png'
  ) => {
    presenter.completed(currentCall, {
      toolCallId: currentCall.toolCallId,
      content: [
        {
          type: 'image',
          mimeType,
          data: image.toString('base64')
        }
      ],
      isError: false
    } as never)
  }

  it('allows post-click capture only for the eligible current non-dismissed target', async () => {
    const { presenter } = await setup()
    await presenter.setPreviewMode('session-1', 'eligible', 7)
    presenter.started(call('snapshot'))
    const click = call('click', { toolName: 'click' })

    expect(presenter.shouldCaptureAfterClick(click)).toBe(true)
    expect(
      presenter.shouldCaptureAfterClick(call('right-click', { toolName: 'right_click' }))
    ).toBe(false)
    expect(
      presenter.shouldCaptureAfterClick(call('stale-target', { toolName: 'click', windowId: 35 }))
    ).toBe(false)

    await presenter.setPreviewMode('session-1', 'suspended', 7)
    expect(presenter.shouldCaptureAfterClick(click)).toBe(false)

    await presenter.setPreviewMode('session-1', 'eligible', 7)
    expect(presenter.dismissPreview('session-1', 'run-1')).toBe(true)
    expect(presenter.shouldCaptureAfterClick(click)).toBe(false)
  })

  it('releases preview state when the host closes without renderer cleanup', async () => {
    const { presenter, coordinator, windows } = await setup()
    await presenter.setPreviewMode('session-1', 'eligible', 7)
    presenter.started(call('snapshot'))

    const host = windows.get(7)!
    host.destroyed = true
    host.emit('closed')

    expect(coordinator.releaseClaim).toHaveBeenCalledWith({
      source: 'computer-use',
      sessionId: 'session-1',
      runId: 'run-1'
    })
    expect(presenter.shouldCaptureAfterClick(call('click', { toolName: 'click' }))).toBe(false)
    await expect(presenter.setPreviewMode('session-1', 'stopped', 7)).resolves.toEqual({
      updated: false,
      surface: 'none'
    })
  })

  it('publishes a bounded Canvas frame only after a valid current snapshot', async () => {
    const { presenter, coordinator, windowPresenter } = await setup()
    await expect(presenter.setPreviewMode('session-1', 'eligible', 7)).resolves.toEqual({
      updated: true,
      surface: 'none'
    })
    const currentCall = call('tool-1')

    presenter.started(currentCall)

    expect(coordinator.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'computer-use',
        sessionId: 'session-1',
        runId: 'run-1',
        epoch: 1
      }),
      expect.objectContaining({ id: 7 })
    )
    expect(
      windowPresenter.sendToWindow.mock.calls.some(
        ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
      )
    ).toBe(false)

    await completeWithImage(presenter, currentCall, await createPng())

    await vi.waitFor(() =>
      expect(
        windowPresenter.sendToWindow.mock.calls.some(
          ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
        )
      ).toBe(true)
    )
    const frameEnvelope = windowPresenter.sendToWindow.mock.calls
      .map(([, , envelope]) => envelope as { name: string; payload: Record<string, unknown> })
      .find((envelope) => envelope.name === 'computerUse.preview.frame')
    expect(frameEnvelope?.payload).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        runId: 'run-1',
        epoch: 1,
        sequence: 1,
        width: 480,
        height: 300,
        mimeType: 'image/jpeg',
        data: expect.any(Uint8Array)
      })
    )
    expect((frameEnvelope?.payload.data as Uint8Array).byteLength).toBeLessThanOrEqual(512 * 1024)
    expect(coordinator.present).not.toHaveBeenCalled()
  })

  it('clears the old target epoch and rejects an out-of-order result', async () => {
    const { presenter, windowPresenter } = await setup()
    await presenter.setPreviewMode('session-1', 'eligible', 7)
    const first = call('tool-1')
    presenter.started(first)
    await completeWithImage(presenter, first, await createPng())
    await vi.waitFor(() =>
      expect(
        windowPresenter.sendToWindow.mock.calls.filter(
          ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
        )
      ).toHaveLength(1)
    )

    const stale = call('tool-2', { windowId: 35 })
    const current = call('tool-3', { windowId: 35 })
    presenter.started(stale)
    presenter.started(current)
    await completeWithImage(presenter, stale, await createPng(320, 200, 80))
    await new Promise((resolve) => setImmediate(resolve))

    expect(
      windowPresenter.sendToWindow.mock.calls.filter(
        ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
      )
    ).toHaveLength(1)
    expect(
      windowPresenter.sendToWindow.mock.calls.some(([, , envelope]) => {
        const event = envelope as { name?: string; payload?: { epoch?: number } }
        return event.name === 'computerUse.preview.surface.changed' && event.payload?.epoch === 2
      })
    ).toBe(true)

    await completeWithImage(presenter, current, await createPng(320, 200, 100))
    await vi.waitFor(() =>
      expect(
        windowPresenter.sendToWindow.mock.calls.filter(
          ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
        )
      ).toHaveLength(2)
    )
    const frames = windowPresenter.sendToWindow.mock.calls
      .map(([, , envelope]) => envelope as { name: string; payload: { epoch?: number } })
      .filter((envelope) => envelope.name === 'computerUse.preview.frame')
    expect(frames[1].payload.epoch).toBe(2)
  })

  it('keeps native snapshot bytes out of renderer events', async () => {
    const { presenter, coordinator, windowPresenter } = await setup('native-overlay')
    await presenter.setPreviewMode('session-1', 'eligible', 7)
    const currentCall = call('tool-native')
    presenter.started(currentCall)

    await completeWithImage(presenter, currentCall, await createPng(320, 200))
    await vi.waitFor(() => expect(coordinator.present).toHaveBeenCalledOnce())

    expect(
      windowPresenter.sendToWindow.mock.calls.some(
        ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
      )
    ).toBe(false)
  })

  it('rejects malformed images and keeps the last valid same-target frame', async () => {
    const { presenter, windowPresenter } = await setup()
    await presenter.setPreviewMode('session-1', 'eligible', 7)
    const validCall = call('tool-valid')
    presenter.started(validCall)
    await completeWithImage(presenter, validCall, await createPng(320, 200))
    await vi.waitFor(() =>
      expect(
        windowPresenter.sendToWindow.mock.calls.filter(
          ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
        )
      ).toHaveLength(1)
    )

    const invalidCall = call('tool-invalid')
    presenter.started(invalidCall)
    presenter.completed(invalidCall, {
      toolCallId: invalidCall.toolCallId,
      content: [
        {
          type: 'image',
          mimeType: 'image/png',
          data: 'not-base64!'
        }
      ],
      isError: false
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(
      windowPresenter.sendToWindow.mock.calls.filter(
        ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
      )
    ).toHaveLength(1)
  })

  it('enforces image bounds without upscaling the last valid frame', async () => {
    const { presenter, windowPresenter } = await setup()
    await presenter.setPreviewMode('session-1', 'eligible', 7)
    const validCall = call('tool-small')
    presenter.started(validCall)
    await completeWithImage(presenter, validCall, await createPng(120, 80))
    await vi.waitFor(() =>
      expect(
        windowPresenter.sendToWindow.mock.calls.filter(
          ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
        )
      ).toHaveLength(1)
    )

    const frame = windowPresenter.sendToWindow.mock.calls
      .map(([, , envelope]) => envelope as { name: string; payload: Record<string, unknown> })
      .find((envelope) => envelope.name === 'computerUse.preview.frame')
    expect(frame?.payload).toEqual(expect.objectContaining({ width: 120, height: 80 }))

    const jpegCall = call('tool-jpeg')
    presenter.started(jpegCall)
    const jpeg = await sharp(await createPng(160, 90))
      .jpeg()
      .toBuffer()
    await completeWithImage(presenter, jpegCall, jpeg, 'image/jpeg')
    await vi.waitFor(() =>
      expect(
        windowPresenter.sendToWindow.mock.calls.filter(
          ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
        )
      ).toHaveLength(2)
    )

    const unsupportedCall = call('tool-unsupported')
    presenter.started(unsupportedCall)
    await completeWithImage(presenter, unsupportedCall, await createPng(120, 80), 'image/webp')

    const oversizedCall = call('tool-oversized')
    presenter.started(oversizedCall)
    presenter.completed(oversizedCall, {
      toolCallId: oversizedCall.toolCallId,
      content: [
        {
          type: 'image',
          mimeType: 'image/png',
          data: 'A'.repeat(Math.ceil(((16 * 1024 * 1024 + 1) * 4) / 3))
        }
      ],
      isError: false
    })
    await new Promise((resolve) => setImmediate(resolve))

    const overDimensionCall = call('tool-dimension')
    presenter.started(overDimensionCall)
    await completeWithImage(presenter, overDimensionCall, await createPng(8193, 1))
    await new Promise((resolve) => setImmediate(resolve))

    expect(
      windowPresenter.sendToWindow.mock.calls.filter(
        ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
      )
    ).toHaveLength(2)
  })

  it('drops intermediate transforms and publishes only the latest overlapping snapshot', async () => {
    const { presenter, windowPresenter } = await setup()
    await presenter.setPreviewMode('session-1', 'eligible', 7)
    const first = call('tool-first')
    const intermediate = call('tool-intermediate')
    const latest = call('tool-latest')

    presenter.started(first)
    await completeWithImage(presenter, first, await createPng(480, 300, 20))
    presenter.started(intermediate)
    await completeWithImage(presenter, intermediate, await createPng(480, 300, 100))
    presenter.started(latest)
    await completeWithImage(presenter, latest, await createPng(480, 300, 220))

    await vi.waitFor(() =>
      expect(
        windowPresenter.sendToWindow.mock.calls.filter(
          ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
        )
      ).toHaveLength(1)
    )
    const frame = windowPresenter.sendToWindow.mock.calls
      .map(
        ([, , envelope]) =>
          envelope as { name: string; payload: { data: Uint8Array; sequence: number } }
      )
      .find((envelope) => envelope.name === 'computerUse.preview.frame')
    expect(frame).toBeDefined()
    const stats = await sharp(frame!.payload.data).stats()

    expect(frame!.payload.sequence).toBe(1)
    expect(stats.channels[0].mean).toBeGreaterThan(180)
  })

  it('retains the last valid frame after failed and aborted snapshot calls', async () => {
    const { presenter, windowPresenter } = await setup()
    await presenter.setPreviewMode('session-1', 'eligible', 7)
    const valid = call('tool-valid')
    presenter.started(valid)
    await completeWithImage(presenter, valid, await createPng(320, 200))
    await vi.waitFor(() =>
      expect(
        windowPresenter.sendToWindow.mock.calls.filter(
          ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
        )
      ).toHaveLength(1)
    )

    const failed = call('tool-failed')
    presenter.started(failed)
    presenter.failed(failed, new Error('snapshot failed'))
    const aborted = call('tool-aborted')
    presenter.started(aborted)
    presenter.failed(aborted, new DOMException('Aborted', 'AbortError'))
    await new Promise((resolve) => setImmediate(resolve))

    expect(
      windowPresenter.sendToWindow.mock.calls.filter(
        ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
      )
    ).toHaveLength(1)
  })

  it('dismisses only the current run and permits a later run', async () => {
    const { presenter, coordinator, windowPresenter } = await setup()
    await presenter.setPreviewMode('session-1', 'eligible', 7)
    const first = call('tool-1')
    presenter.started(first)

    expect(presenter.dismissPreview('session-1', 'run-1')).toBe(true)
    await completeWithImage(presenter, first, await createPng())
    await new Promise((resolve) => setImmediate(resolve))
    expect(
      windowPresenter.sendToWindow.mock.calls.some(
        ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
      )
    ).toBe(false)

    const second = call('tool-2', { runId: 'run-2' })
    presenter.started(second)
    await completeWithImage(presenter, second, await createPng(320, 200))
    await vi.waitFor(() =>
      expect(
        windowPresenter.sendToWindow.mock.calls.some(
          ([, , envelope]) => (envelope as { name?: string }).name === 'computerUse.preview.frame'
        )
      ).toBe(true)
    )
    expect(coordinator.dismiss).toHaveBeenCalledWith({
      source: 'computer-use',
      sessionId: 'session-1',
      runId: 'run-1'
    })
  })
})
