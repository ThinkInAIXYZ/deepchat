import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BrowserTabInfo } from '@shared/types/browser'
import { YO_BROWSER_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'

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

export const useYoBrowserStore = defineStore('yoBrowser', () => {
  const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
  const tabs = ref<BrowserTabInfo[]>([])
  const isVisible = ref(false)
  const activeTabId = ref<string | null>(null)

  const tabCount = computed(() => tabs.value.length)
  const hasWindow = computed(() => tabs.value.length > 0 || isVisible.value)

  const loadState = async () => {
    const [list, visible] = await Promise.all([
      yoBrowserPresenter.listTabs(),
      yoBrowserPresenter.isVisible()
    ])
    if (Array.isArray(list)) {
      tabs.value = list
      activeTabId.value = list.find((item) => item.isActive)?.id ?? null
    }
    isVisible.value = Boolean(visible)
  }

  const handleTabCreated = (_event: unknown, tab: BrowserTabInfo) => {
    tabs.value = upsertTab(tabs.value, tab)
    if (tab.isActive) {
      activeTabId.value = tab.id
    }
  }

  const handleTabClosed = (_event: unknown, tabId: string) => {
    tabs.value = tabs.value.filter((t) => t.id !== tabId)
    if (activeTabId.value === tabId) {
      activeTabId.value = tabs.value[0]?.id ?? null
    }
    if (tabs.value.length === 0) {
      isVisible.value = false
    }
  }

  const handleTabActivated = (_event: unknown, tabId: string) => {
    activeTabId.value = tabId
    tabs.value = tabs.value.map((tab) => ({ ...tab, isActive: tab.id === tabId }))
  }

  const handleTabNavigated = (
    _event: unknown,
    payload: {
      tabId: string
      url: string
    }
  ) => {
    tabs.value = tabs.value.map((tab) =>
      tab.id === payload.tabId ? { ...tab, url: payload.url } : tab
    )
  }

  const handleTabCountChanged = async () => {
    await loadState()
  }

  const handleVisibilityChanged = (_event: unknown, visible: boolean) => {
    isVisible.value = visible
  }

  const show = async () => {
    await yoBrowserPresenter.show()
    await loadState()
  }

  const hide = async () => {
    await yoBrowserPresenter.hide()
    await loadState()
  }

  const toggleVisibility = async (): Promise<boolean> => {
    const visible = await yoBrowserPresenter.toggleVisibility()
    isVisible.value = Boolean(visible)
    return isVisible.value
  }

  onMounted(async () => {
    await loadState()
    if (window?.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_CREATED, handleTabCreated)
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_CLOSED, handleTabClosed)
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_ACTIVATED, handleTabActivated)
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_NAVIGATED, handleTabNavigated)
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_COUNT_CHANGED, handleTabCountChanged)
      window.electron.ipcRenderer.on(
        YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED,
        handleVisibilityChanged
      )
    }
  })

  onBeforeUnmount(() => {
    if (window?.electron?.ipcRenderer) {
      window.electron.ipcRenderer.removeListener(YO_BROWSER_EVENTS.TAB_CREATED, handleTabCreated)
      window.electron.ipcRenderer.removeListener(YO_BROWSER_EVENTS.TAB_CLOSED, handleTabClosed)
      window.electron.ipcRenderer.removeListener(
        YO_BROWSER_EVENTS.TAB_ACTIVATED,
        handleTabActivated
      )
      window.electron.ipcRenderer.removeListener(
        YO_BROWSER_EVENTS.TAB_NAVIGATED,
        handleTabNavigated
      )
      window.electron.ipcRenderer.removeListener(
        YO_BROWSER_EVENTS.TAB_COUNT_CHANGED,
        handleTabCountChanged
      )
      window.electron.ipcRenderer.removeListener(
        YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED,
        handleVisibilityChanged
      )
    }
  })

  return {
    tabs,
    isVisible,
    activeTabId,
    tabCount,
    hasWindow,
    show,
    hide,
    toggleVisibility,
    loadState
  }
})
