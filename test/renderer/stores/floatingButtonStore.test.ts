import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFloatingButtonStore } from '@/stores/floatingButton'
import { createDeferred } from '../utils/deferred'

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

const floatingButtonMocks = vi.hoisted(() => ({
  getFloatingButtonEnabled: vi.fn(),
  setFloatingButtonEnabled: vi.fn(),
  onFloatingButtonChanged: vi.fn(),
  listener: undefined as ((payload: { enabled: boolean; version: number }) => void) | undefined,
  removeListener: vi.fn()
}))

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => ({
    getFloatingButtonEnabled: floatingButtonMocks.getFloatingButtonEnabled,
    setFloatingButtonEnabled: floatingButtonMocks.setFloatingButtonEnabled,
    onFloatingButtonChanged: floatingButtonMocks.onFloatingButtonChanged
  })
}))

function mountFloatingButtonStore() {
  const pinia = createPinia()
  let store!: ReturnType<typeof useFloatingButtonStore>

  const Harness = defineComponent({
    setup() {
      store = useFloatingButtonStore()
      return () => h('div')
    }
  })

  const wrapper = mount(Harness, {
    global: {
      plugins: [pinia]
    }
  })

  mountedStores.push({ store, wrapper })
  return { store, wrapper }
}

let mountedStores: Array<{
  store: ReturnType<typeof useFloatingButtonStore>
  wrapper: VueWrapper
}> = []

describe('floating button store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    floatingButtonMocks.listener = undefined
    floatingButtonMocks.getFloatingButtonEnabled.mockResolvedValue(false)
    floatingButtonMocks.setFloatingButtonEnabled.mockResolvedValue(undefined)
    floatingButtonMocks.onFloatingButtonChanged.mockImplementation(
      (listener: (payload: { enabled: boolean; version: number }) => void) => {
        floatingButtonMocks.listener = listener
        return floatingButtonMocks.removeListener
      }
    )
  })

  afterEach(() => {
    for (const { store, wrapper } of mountedStores) {
      wrapper.unmount()
      store.$dispose()
    }
    mountedStores = []
  })

  it('keeps a listener update that arrives before the initial snapshot resolves', async () => {
    const snapshot = createDeferred<boolean>()
    floatingButtonMocks.getFloatingButtonEnabled.mockReturnValueOnce(snapshot.promise)

    const { store } = await mountFloatingButtonStore()
    await vi.waitFor(() =>
      expect(floatingButtonMocks.onFloatingButtonChanged).toHaveBeenCalledOnce()
    )

    floatingButtonMocks.listener?.({ enabled: true, version: 1 })
    snapshot.resolve(false)
    await flushPromises()

    expect(store.enabled).toBe(true)
  })

  it('restores the actual previous value when the newest local update fails', async () => {
    const { store } = await mountFloatingButtonStore()
    await flushPromises()
    store.enabled = true
    floatingButtonMocks.setFloatingButtonEnabled.mockRejectedValueOnce(new Error('write failed'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await store.setFloatingButtonEnabled(false)

    expect(store.enabled).toBe(true)
    consoleError.mockRestore()
  })

  it('cleans up the IPC listener with its owning scope', async () => {
    const { store, wrapper } = await mountFloatingButtonStore()
    await flushPromises()

    wrapper.unmount()
    store.$dispose()

    expect(floatingButtonMocks.removeListener).toHaveBeenCalledOnce()
  })
})
