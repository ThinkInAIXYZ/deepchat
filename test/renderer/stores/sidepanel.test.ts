import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

describe('sidepanel store', () => {
  const setupSidepanelStore = async (innerWidth: number) => {
    vi.resetModules()
    vi.doUnmock('pinia')

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: innerWidth
    })

    const storageRef = ref(520)

    vi.doMock('@vueuse/core', () => ({
      useStorage: () => storageRef,
      useEventListener: (
        target: EventTarget,
        event: string,
        listener: EventListenerOrEventListenerObject
      ) => {
        target.addEventListener(event, listener)
        return () => target.removeEventListener(event, listener)
      }
    }))

    const { createPinia, setActivePinia } = await vi.importActual<typeof import('pinia')>('pinia')
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

  it('reclamps width when the viewport shrinks', async () => {
    const { store, storageRef } = await setupSidepanelStore(1200)

    store.setWidth(640)
    expect(storageRef.value).toBe(640)

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 500
    })

    window.dispatchEvent(new Event('resize'))

    expect(storageRef.value).toBe(310)
    expect(store.width).toBe(310)
  })

  it('opens one MCP App preview and returns it inline when closed', async () => {
    const { store } = await setupSidepanelStore(1200)

    store.openMcpAppPreview('conversation:message:block')

    expect(store.open).toBe(true)
    expect(store.activeTab).toBe('mcp-app')
    expect(store.mcpAppPreviewOwnerId).toBe('conversation:message:block')

    store.closeMcpAppPreview('another-owner')
    expect(store.activeTab).toBe('mcp-app')

    store.closeMcpAppPreview('conversation:message:block')

    expect(store.open).toBe(false)
    expect(store.activeTab).toBe('workspace')
    expect(store.mcpAppPreviewOwnerId).toBeNull()
  })
})
