import { defineComponent, nextTick, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ComputerUsePreviewMode,
  ComputerUsePreviewModeResult
} from '@shared/types/computerUse'

const mountedWrappers: Array<{ unmount: () => void }> = []

const setup = async (
  surface: 'native-overlay' | 'renderer-canvas' = 'renderer-canvas',
  setPreviewMode?: (
    sessionId: string,
    mode: ComputerUsePreviewMode
  ) => Promise<ComputerUsePreviewModeResult>
) => {
  vi.resetModules()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({})
  })

  type SurfacePayload = {
    windowId: number
    sessionId: string
    runId: string
    epoch: number
    surface: 'native-overlay' | 'renderer-canvas' | 'none'
    version: number
  }
  type FramePayload = {
    sessionId: string
    runId: string
    epoch: number
    sequence: number
    width: number
    height: number
    mimeType: 'image/jpeg'
    data: Uint8Array
    timestamp: number
  }
  let surfaceHandler: ((payload: SurfacePayload) => void) | null = null
  let frameHandler: ((payload: FramePayload) => void) | null = null
  let windowStateHandler:
    | ((payload: { windowId: number | null; exists: boolean; isFocused: boolean }) => void)
    | null = null
  const stopFrameSubscription = vi.fn()
  const stopSurfaceSubscription = vi.fn()
  const stopWindowStateSubscription = vi.fn()
  const computerUseClient = {
    setPreviewMode: vi.fn(
      setPreviewMode ??
        (async (_sessionId: string, mode: 'eligible' | 'suspended' | 'stopped') => ({
          updated: true,
          surface: mode === 'eligible' ? surface : ('none' as const)
        }))
    ),
    dismissPreview: vi.fn(async () => true),
    onPreviewSurfaceChanged: vi.fn((handler: (payload: SurfacePayload) => void) => {
      surfaceHandler = handler
      return stopSurfaceSubscription
    }),
    onPreviewFrame: vi.fn((handler: (payload: FramePayload) => void) => {
      frameHandler = handler
      return stopFrameSubscription
    })
  }
  const windowClient = {
    getCurrentState: vi.fn(async () => ({ windowId: 1, exists: true, isFocused: true })),
    onCurrentStateChanged: vi.fn(
      (
        handler: (payload: { windowId: number | null; exists: boolean; isFocused: boolean }) => void
      ) => {
        windowStateHandler = handler
        return stopWindowStateSubscription
      }
    )
  }
  const sessionStore = reactive({
    sessions: [{ id: 'session-1', status: 'working' }]
  })

  vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({ name: 'Icon', template: '<span />' })
  }))
  vi.doMock('@api/ComputerUseClient', () => ({
    createComputerUseClient: () => computerUseClient
  }))
  vi.doMock('@api/WindowClient', () => ({ createWindowClient: () => windowClient }))
  vi.doMock('@/stores/ui/session', () => ({ useSessionStore: () => sessionStore }))

  const AgentComputerUsePiP = (await import('@/components/computerUse/AgentComputerUsePiP.vue'))
    .default
  const wrapper = mount(AgentComputerUsePiP, {
    props: { sessionId: 'session-1' },
    global: {
      stubs: {
        Button: defineComponent({
          name: 'Button',
          emits: ['click'],
          template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
        })
      }
    }
  })
  mountedWrappers.push(wrapper)
  await flushPromises()

  return {
    wrapper,
    computerUseClient,
    sessionStore,
    stopFrameSubscription,
    stopSurfaceSubscription,
    stopWindowStateSubscription,
    emitSurface: (payload: SurfacePayload) => surfaceHandler?.(payload),
    emitFrame: (payload: FramePayload) => frameHandler?.(payload),
    emitWindowState: (payload: { windowId: number | null; exists: boolean; isFocused: boolean }) =>
      windowStateHandler?.(payload)
  }
}

const surfacePayload = (
  overrides: Partial<{
    windowId: number
    sessionId: string
    runId: string
    epoch: number
    surface: 'native-overlay' | 'renderer-canvas' | 'none'
  }> = {}
) => ({
  windowId: overrides.windowId ?? 1,
  sessionId: overrides.sessionId ?? 'session-1',
  runId: overrides.runId ?? 'run-1',
  epoch: overrides.epoch ?? 1,
  surface: overrides.surface ?? ('renderer-canvas' as const),
  version: Date.now()
})

const framePayload = (
  overrides: Partial<{
    sessionId: string
    runId: string
    epoch: number
    sequence: number
    width: number
    height: number
    data: Uint8Array
  }> = {}
) => ({
  sessionId: overrides.sessionId ?? 'session-1',
  runId: overrides.runId ?? 'run-1',
  epoch: overrides.epoch ?? 1,
  sequence: overrides.sequence ?? 1,
  width: overrides.width ?? 480,
  height: overrides.height ?? 300,
  mimeType: 'image/jpeg' as const,
  data: overrides.data ?? new Uint8Array([1, 2, 3]),
  timestamp: Date.now()
})

afterEach(async () => {
  mountedWrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  await flushPromises()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AgentComputerUsePiP', () => {
  it('keeps the native path headless without subscribing to frame bytes', async () => {
    const { wrapper, computerUseClient, emitSurface } = await setup('native-overlay')

    emitSurface(surfacePayload({ surface: 'native-overlay' }))
    await nextTick()

    expect(wrapper.find('[data-testid="agent-computer-use-pip"]').exists()).toBe(false)
    expect(computerUseClient.onPreviewFrame).not.toHaveBeenCalled()
    expect(computerUseClient.setPreviewMode).toHaveBeenCalledWith('session-1', 'eligible')
  })

  it('shows the first decoded Canvas snapshot with Close as its only control', async () => {
    const drawImage = vi.fn()
    const bitmapClose = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage
    } as never)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: bitmapClose }))
    )
    const { wrapper, computerUseClient, emitSurface, emitFrame } = await setup()

    emitSurface(surfacePayload())
    await nextTick()
    expect(wrapper.get('[data-testid="agent-computer-use-pip"]').attributes('style')).toContain(
      'display: none'
    )

    emitFrame(framePayload())
    await flushPromises()

    const pip = wrapper.get('[data-testid="agent-computer-use-pip"]')
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 480, 300)
    expect(bitmapClose).toHaveBeenCalledOnce()
    expect(pip.attributes('style')).not.toContain('display: none')
    expect(pip.findAll('button')).toHaveLength(1)
    expect(pip.get('button').attributes('aria-label')).toBe('common.close')
    expect(wrapper.find('[aria-label="common.open"]').exists()).toBe(false)

    computerUseClient.dismissPreview.mockRejectedValueOnce(new Error('dismiss failed'))
    await pip.get('button').trigger('click')
    await flushPromises()

    expect(computerUseClient.dismissPreview).toHaveBeenCalledWith('session-1', 'run-1')
    expect(pip.attributes('style')).toContain('display: none')
  })

  it('keeps the current Canvas visible until a newer snapshot finishes decoding', async () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage
    } as never)
    let resolveSecondBitmap: ((bitmap: { close: () => void }) => void) | null = null
    vi.stubGlobal(
      'createImageBitmap',
      vi
        .fn()
        .mockResolvedValueOnce({ close: vi.fn() })
        .mockImplementationOnce(
          () =>
            new Promise<{ close: () => void }>((resolve) => {
              resolveSecondBitmap = resolve
            })
        )
    )
    const { wrapper, emitSurface, emitFrame } = await setup()

    emitSurface(surfacePayload())
    emitFrame(framePayload({ sequence: 1 }))
    await flushPromises()
    const pip = wrapper.get('[data-testid="agent-computer-use-pip"]')
    expect(pip.attributes('style')).not.toContain('display: none')

    emitFrame(framePayload({ sequence: 2 }))
    await nextTick()
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(pip.attributes('style')).not.toContain('display: none')

    resolveSecondBitmap?.({ close: vi.fn() })
    await flushPromises()
    expect(drawImage).toHaveBeenCalledTimes(2)
  })

  it('drops stale target epochs and waits for the first new-target frame', async () => {
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage
    } as never)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() }))
    )
    const { wrapper, emitSurface, emitFrame } = await setup()

    emitSurface(surfacePayload())
    emitFrame(framePayload({ sequence: 5 }))
    await flushPromises()
    expect(wrapper.get('[data-testid="agent-computer-use-pip"]').attributes('style')).not.toContain(
      'display: none'
    )

    emitSurface(surfacePayload({ epoch: 2 }))
    await nextTick()
    expect(wrapper.get('[data-testid="agent-computer-use-pip"]').attributes('style')).toContain(
      'display: none'
    )

    emitFrame(framePayload({ epoch: 1, sequence: 6 }))
    await flushPromises()
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="agent-computer-use-pip"]').attributes('style')).toContain(
      'display: none'
    )

    emitFrame(framePayload({ epoch: 2, sequence: 1 }))
    await flushPromises()
    expect(drawImage).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="agent-computer-use-pip"]').attributes('style')).not.toContain(
      'display: none'
    )
  })

  it('suspends on blur, releases frame subscriptions, and resumes on focus', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn()
    } as never)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() }))
    )
    const {
      wrapper,
      computerUseClient,
      stopFrameSubscription,
      emitSurface,
      emitFrame,
      emitWindowState
    } = await setup()
    emitSurface(surfacePayload())
    emitFrame(framePayload())
    await flushPromises()

    emitWindowState({ windowId: 1, exists: true, isFocused: false })
    await flushPromises()

    expect(wrapper.find('[data-testid="agent-computer-use-pip"]').exists()).toBe(false)
    expect(computerUseClient.setPreviewMode).toHaveBeenCalledWith('session-1', 'suspended')
    expect(stopFrameSubscription).toHaveBeenCalledOnce()

    emitWindowState({ windowId: 1, exists: true, isFocused: true })
    await flushPromises()

    expect(computerUseClient.setPreviewMode).toHaveBeenLastCalledWith('session-1', 'eligible')
    expect(computerUseClient.onPreviewFrame).toHaveBeenCalledTimes(2)
  })

  it('drags the fallback without forwarding input to the target application', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn()
    } as never)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() }))
    )
    const { wrapper, emitSurface, emitFrame } = await setup()
    emitSurface(surfacePayload())
    emitFrame(framePayload())
    await flushPromises()
    const pip = wrapper.get('[data-testid="agent-computer-use-pip"]')
    const initialStyle = pip.attributes('style')

    await pip.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 500, clientY: 400 })
    await pip.trigger('pointermove', { pointerId: 1, clientX: 400, clientY: 300 })
    await pip.trigger('pointerup', { pointerId: 1, clientX: 400, clientY: 300 })

    expect(pip.attributes('style')).not.toBe(initialStyle)
  })

  it('stops the previous session and releases subscriptions on teardown', async () => {
    const {
      wrapper,
      computerUseClient,
      sessionStore,
      stopFrameSubscription,
      stopSurfaceSubscription,
      stopWindowStateSubscription,
      emitSurface
    } = await setup()
    sessionStore.sessions.push({ id: 'session-2', status: 'working' })
    emitSurface(surfacePayload())
    await nextTick()

    await wrapper.setProps({ sessionId: 'session-2' })
    await flushPromises()
    expect(computerUseClient.setPreviewMode).toHaveBeenCalledWith('session-1', 'stopped')
    expect(computerUseClient.setPreviewMode).toHaveBeenCalledWith('session-2', 'eligible')
    expect(stopFrameSubscription).toHaveBeenCalledOnce()

    wrapper.unmount()
    mountedWrappers.splice(mountedWrappers.indexOf(wrapper), 1)
    await flushPromises()
    expect(computerUseClient.setPreviewMode).toHaveBeenCalledWith('session-2', 'stopped')
    expect(stopSurfaceSubscription).toHaveBeenCalledOnce()
    expect(stopWindowStateSubscription).toHaveBeenCalledOnce()
  })

  it('queues teardown behind an in-flight preview mode update', async () => {
    let resolveEligible: ((result: ComputerUsePreviewModeResult) => void) | undefined
    const setPreviewMode = vi.fn(async (_sessionId: string, mode: ComputerUsePreviewMode) => {
      if (mode === 'eligible') {
        return await new Promise<ComputerUsePreviewModeResult>((resolve) => {
          resolveEligible = resolve
        })
      }
      return { updated: true, surface: 'none' as const }
    })
    const { wrapper } = await setup('renderer-canvas', setPreviewMode)
    const callsBeforeUnmount = setPreviewMode.mock.calls.length
    expect(setPreviewMode).toHaveBeenLastCalledWith('session-1', 'eligible')

    wrapper.unmount()
    mountedWrappers.splice(mountedWrappers.indexOf(wrapper), 1)
    await nextTick()

    expect(setPreviewMode).toHaveBeenCalledTimes(callsBeforeUnmount)
    resolveEligible?.({ updated: true, surface: 'renderer-canvas' })
    await flushPromises()

    expect(setPreviewMode).toHaveBeenCalledTimes(callsBeforeUnmount + 1)
    expect(setPreviewMode).toHaveBeenLastCalledWith('session-1', 'stopped')
  })

  it('stops and releases the fallback when the Agent run terminates', async () => {
    const { wrapper, computerUseClient, sessionStore, emitSurface } = await setup()
    emitSurface(surfacePayload())
    await nextTick()

    sessionStore.sessions[0].status = 'completed'
    await flushPromises()

    expect(wrapper.find('[data-testid="agent-computer-use-pip"]').exists()).toBe(false)
    expect(computerUseClient.setPreviewMode).toHaveBeenLastCalledWith('session-1', 'stopped')
  })
})
