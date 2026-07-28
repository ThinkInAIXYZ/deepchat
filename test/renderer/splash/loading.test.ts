import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import Loading from '../../../src/renderer/splash/loading.vue'
import type {
  DatabaseUnlockProgressPayload,
  DatabaseUnlockRequestPayload
} from '../../../src/shared/contracts/databaseSecurity'

let unlockRequestListener: ((payload: DatabaseUnlockRequestPayload) => void) | undefined
let unlockProgressListener: ((payload: DatabaseUnlockProgressPayload) => void) | undefined
let debugModeListener: ((mode: 'loading' | 'system-unlock' | 'unlock') => void) | undefined
let wrapper: VueWrapper | undefined

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      key === 'settings.debug.splash.previewHint'
        ? 'Development preview — password submission is disabled.'
        : key
  })
}))

const mountLoading = () => {
  wrapper = mount(Loading)
  return wrapper
}

describe('splash loading', () => {
  beforeEach(() => {
    unlockRequestListener = undefined
    unlockProgressListener = undefined
    debugModeListener = undefined

    window.deepchatSplash = {
      onUpdate: vi.fn(() => vi.fn()),
      onUnlockRequest: vi.fn((listener) => {
        unlockRequestListener = listener
        return vi.fn()
      }),
      onUnlockProgress: vi.fn((listener) => {
        unlockProgressListener = listener
        return vi.fn()
      }),
      onDebugMode: vi.fn((listener) => {
        debugModeListener = listener
        return vi.fn()
      }),
      submitUnlock: vi.fn(),
      cancelUnlock: vi.fn()
    }
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('starts with the circular splash shell loading state', () => {
    const wrapper = mountLoading()

    expect(wrapper.get('.splash-shell').classes()).toContain('splash-shell')
    expect(wrapper.get('.loader-stage').attributes('aria-label')).toBe('DeepChat is starting')
    expect(wrapper.classes()).not.toContain('splash-shell--manual-unlock')
  })

  it('keeps the circular shell during system credential unlock', async () => {
    const wrapper = mountLoading()

    expect(unlockProgressListener).toBeTypeOf('function')
    unlockProgressListener?.({ active: true, safeStorageAvailable: true })
    await nextTick()

    expect(wrapper.get('.splash-shell').classes()).toContain('splash-shell')
    expect(wrapper.classes()).not.toContain('splash-shell--manual-unlock')
    expect(wrapper.get('.unlock-panel--system').text()).toContain('Unlocking local database')
  })

  it('renders a disabled manual-unlock development preview without IPC submission', async () => {
    const wrapper = mountLoading()

    debugModeListener?.('unlock')
    await nextTick()

    expect(wrapper.get('.unlock-input').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.unlock-button--primary').attributes('disabled')).toBeDefined()
    const cancelButton = wrapper.get('.unlock-button:not(.unlock-button--primary)')
    expect(cancelButton.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Development preview — password submission is disabled.')
    await wrapper.get('.unlock-panel').trigger('submit')
    await cancelButton.trigger('click')
    expect(window.deepchatSplash.submitUnlock).not.toHaveBeenCalled()
    expect(window.deepchatSplash.cancelUnlock).not.toHaveBeenCalled()
  })

  it('uses the manual-unlock shell after a manual unlock request', async () => {
    const wrapper = mountLoading()

    expect(unlockRequestListener).toBeTypeOf('function')
    unlockRequestListener?.({
      requestId: 'request-1',
      reason: 'manual-required',
      safeStorageAvailable: true
    })
    await nextTick()

    expect(wrapper.classes()).toContain('splash-shell--manual-unlock')
    expect(wrapper.get('.unlock-panel--manual').exists()).toBe(true)
  })
})
