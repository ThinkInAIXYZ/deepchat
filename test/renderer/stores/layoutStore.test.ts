import { describe, it, expect } from 'vitest'
import { createLayoutStore } from '@/stores/layoutStore'

describe('createLayoutStore', () => {
  it('toggles thread sidebar and message navigation', () => {
    const store = createLayoutStore()

    expect(store.isThreadSidebarOpen.value).toBe(false)
    store.openThreadSidebar()
    expect(store.isThreadSidebarOpen.value).toBe(true)
    store.toggleThreadSidebar()
    expect(store.isThreadSidebarOpen.value).toBe(false)
    store.closeThreadSidebar()
    expect(store.isThreadSidebarOpen.value).toBe(false)

    expect(store.isMessageNavigationOpen.value).toBe(false)
    store.openMessageNavigation()
    expect(store.isMessageNavigationOpen.value).toBe(true)
    store.toggleMessageNavigation()
    expect(store.isMessageNavigationOpen.value).toBe(false)
    store.closeMessageNavigation()
    expect(store.isMessageNavigationOpen.value).toBe(false)
  })
})
