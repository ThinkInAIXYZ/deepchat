import { computed, ref } from 'vue'
import type { BrowserTabInfo } from '@shared/types/browser'
import { useYoBrowserAdapter } from '@/composables/yo-browser/useYoBrowserAdapter'

function upsertTab(tabs: BrowserTabInfo[], tab: BrowserTabInfo): BrowserTabInfo[] {
  const next = tabs.slice()
  const index = next.findIndex((item) => item.id === tab.id)
  if (index >= 0) {
    next[index] = tab
  } else {
    next.push(tab)
  }
  return next
}

export const useYoBrowserStoreService = () => {
  const yoBrowserAdapter = useYoBrowserAdapter()
  const tabs = ref<BrowserTabInfo[]>([])
  const isVisible = ref(false)
  const activeTabId = ref<string | null>(null)
  let listenersBound = false

  const tabCount = computed(() => tabs.value.length)
  const hasWindow = computed(() => tabs.value.length > 0 || isVisible.value)

  const loadState = async () => {
    const [list, visible] = await Promise.all([
      yoBrowserAdapter.listTabs(),
      yoBrowserAdapter.isVisible()
    ])
    if (Array.isArray(list)) {
      tabs.value = list
      activeTabId.value = list.find((item) => item.isActive)?.id ?? null
    }
    isVisible.value = Boolean(visible)
  }

  const handleTabCreated = (tab: BrowserTabInfo) => {
    tabs.value = upsertTab(tabs.value, tab)
    if (tab.isActive) {
      activeTabId.value = tab.id
    }
  }

  const handleTabClosed = (tabId: string) => {
    tabs.value = tabs.value.filter((tab) => tab.id !== tabId)
    if (activeTabId.value === tabId) {
      activeTabId.value = tabs.value[0]?.id ?? null
    }
    if (tabs.value.length === 0) {
      isVisible.value = false
    }
  }

  const handleTabActivated = (tabId: string) => {
    activeTabId.value = tabId
    tabs.value = tabs.value.map((tab) => ({ ...tab, isActive: tab.id === tabId }))
  }

  const handleTabNavigated = (payload: { tabId: string; url: string }) => {
    tabs.value = tabs.value.map((tab) =>
      tab.id === payload.tabId ? { ...tab, url: payload.url } : tab
    )
  }

  const handleTabUpdated = (tab: BrowserTabInfo) => {
    tabs.value = upsertTab(tabs.value, tab)
    if (tab.isActive) {
      activeTabId.value = tab.id
    }
  }

  const handleTabCountChanged = () => {
    void loadState()
  }

  const handleVisibilityChanged = (visible: boolean) => {
    isVisible.value = visible
  }

  const show = async () => {
    await yoBrowserAdapter.show(true)
    await loadState()
  }

  const hide = async () => {
    await yoBrowserAdapter.hide()
    await loadState()
  }

  const toggleVisibility = async (): Promise<boolean> => {
    const visible = await yoBrowserAdapter.toggleVisibility()
    isVisible.value = Boolean(visible)
    return isVisible.value
  }

  const openTab = async (tabId: string): Promise<void> => {
    await yoBrowserAdapter.activateTab(tabId)
    await yoBrowserAdapter.show(true)
    await loadState()
  }

  const bindEventListeners = () => {
    if (listenersBound) return () => undefined

    const unsubscribers = [
      yoBrowserAdapter.onTabCreated(handleTabCreated),
      yoBrowserAdapter.onTabClosed(handleTabClosed),
      yoBrowserAdapter.onTabActivated(handleTabActivated),
      yoBrowserAdapter.onTabNavigated(handleTabNavigated),
      yoBrowserAdapter.onTabUpdated(handleTabUpdated),
      yoBrowserAdapter.onTabCountChanged(handleTabCountChanged),
      yoBrowserAdapter.onWindowVisibilityChanged(handleVisibilityChanged)
    ]

    listenersBound = true

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      listenersBound = false
    }
  }

  return {
    tabs,
    isVisible,
    activeTabId,
    tabCount,
    hasWindow,
    show,
    hide,
    toggleVisibility,
    openTab,
    loadState,
    bindEventListeners
  }
}
