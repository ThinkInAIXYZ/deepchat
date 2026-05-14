import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YoBrowserActivityPayload } from '@shared/types/browser'

let activityListener: ((payload: YoBrowserActivityPayload) => void) | null = null

const makePayload = (
  overrides: Partial<YoBrowserActivityPayload> = {}
): YoBrowserActivityPayload => ({
  id: overrides.id ?? 'activity-1',
  sessionId: 'session-a',
  windowId: 1,
  kind: overrides.kind ?? 'pointer',
  action: overrides.action ?? 'mouse_click',
  phase: overrides.phase ?? 'started',
  timestamp: Date.now(),
  ...overrides
})

describe('BrowserActivityOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    activityListener = null
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
    window.yoBrowserOverlay = {
      onActivityChanged: vi.fn((listener) => {
        activityListener = listener
        return vi.fn()
      })
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const setup = async () => {
    const BrowserActivityOverlay = (
      await import('../../../src/renderer/browser-overlay/BrowserActivityOverlay.vue')
    ).default
    return mount(BrowserActivityOverlay)
  }

  it('shows only the halo for browser activity', async () => {
    const wrapper = await setup()

    activityListener?.(
      makePayload({
        point: { x: 42, y: 84 }
      })
    )
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.halo.active').exists()).toBe(true)
    expect(wrapper.find('.agent-pointer').exists()).toBe(false)
    expect(wrapper.find('.scroll-cue').exists()).toBe(false)
    expect(wrapper.find('.vision-frame').exists()).toBe(false)
    expect(wrapper.find('.keyboard-cue').exists()).toBe(false)

    activityListener?.(makePayload({ phase: 'completed' }))
    await vi.advanceTimersByTimeAsync(900)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.halo.active').exists()).toBe(false)
  })

  it('keeps the halo alive until the safety ttl expires', async () => {
    const wrapper = await setup()

    activityListener?.(
      makePayload({
        id: 'keyboard-1',
        kind: 'keyboard',
        action: 'key'
      })
    )
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.halo.active').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(2500)
    await vi.advanceTimersByTimeAsync(900)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.halo.active').exists()).toBe(false)
  })

  it('keeps the halo on until all pending activities finish', async () => {
    const wrapper = await setup()

    activityListener?.(makePayload({ id: 'activity-a' }))
    activityListener?.(makePayload({ id: 'activity-b', kind: 'vision', action: 'screenshot' }))
    await wrapper.vm.$nextTick()

    activityListener?.(makePayload({ id: 'activity-a', phase: 'completed' }))
    await vi.advanceTimersByTimeAsync(900)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.halo.active').exists()).toBe(true)

    activityListener?.(
      makePayload({
        id: 'activity-b',
        kind: 'vision',
        action: 'screenshot',
        phase: 'completed'
      })
    )
    await vi.advanceTimersByTimeAsync(900)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.halo.active').exists()).toBe(false)
  })
})
