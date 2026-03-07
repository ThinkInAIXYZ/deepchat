import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

describe('sidepanel store', () => {
  const setupSidepanelStore = async (innerWidth: number) => {
    vi.resetModules()

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: innerWidth
    })

    const storageRef = ref(520)

    vi.doMock('@vueuse/core', () => ({
      useStorage: () => storageRef
    }))

    setActivePinia(createPinia())

    const { useSidepanelStore } = await import('@/stores/ui/sidepanel')
    return {
      store: useSidepanelStore(),
      storageRef
    }
  }

  it('clamps width to the resolved maximum on narrow viewports', async () => {
    const { store, storageRef } = await setupSidepanelStore(500)

    store.setWidth(640)
    expect(storageRef.value).toBe(310)
    expect(store.width).toBe(310)
  })
})
