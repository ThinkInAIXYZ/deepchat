import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BrowserTabInfo } from '@shared/types/browser'
import { YO_BROWSER_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'

export const useYoBrowserStore = defineStore('yoBrowser', () => {
  const yoBrowserPresenter = usePresenter('yoBrowserPresenter')

  const currentPage = ref<BrowserTabInfo | null>(null)
  const isVisible = ref(false)
  const canGoBack = ref(false)
  const canGoForward = ref(false)

  const tabs = computed(() => (currentPage.value ? [currentPage.value] : []))
  const activeTabId = computed(() => currentPage.value?.id ?? null)
  const tabCount = computed(() => (currentPage.value ? 1 : 0))
  const hasWindow = computed(() => Boolean(currentPage.value) || isVisible.value)

  const refreshNavigationState = async () => {
    try {
      const state = await yoBrowserPresenter.getNavigationState(activeTabId.value ?? undefined)
      canGoBack.value = Boolean(state?.canGoBack)
      canGoForward.value = Boolean(state?.canGoForward)
    } catch {
      canGoBack.value = false
      canGoForward.value = false
    }
  }

  const loadState = async () => {
    const [active, visible] = await Promise.all([
      yoBrowserPresenter.getActiveTab(),
      yoBrowserPresenter.isVisible()
    ])

    currentPage.value = active || null
    isVisible.value = Boolean(visible)
    await refreshNavigationState()
  }

  const handleTabCreated = (_event: unknown, tab: BrowserTabInfo) => {
    currentPage.value = tab
    void refreshNavigationState()
  }

  const handleTabClosed = () => {
    currentPage.value = null
    canGoBack.value = false
    canGoForward.value = false
    isVisible.value = false
  }

  const handleTabActivated = (_event: unknown, tabId: string) => {
    if (currentPage.value) {
      currentPage.value = {
        ...currentPage.value,
        isActive: currentPage.value.id === tabId
      }
    }
    void refreshNavigationState()
  }

  const handleTabNavigated = (
    _event: unknown,
    payload: {
      tabId: string
      url: string
    }
  ) => {
    if (currentPage.value && currentPage.value.id === payload.tabId) {
      currentPage.value = {
        ...currentPage.value,
        url: payload.url,
        updatedAt: Date.now()
      }
    }
    void refreshNavigationState()
  }

  const handleTabUpdated = (_event: unknown, tab: BrowserTabInfo) => {
    currentPage.value = tab
    void refreshNavigationState()
  }

  const handleTabCountChanged = async () => {
    await loadState()
  }

  const handleVisibilityChanged = (_event: unknown, visible: boolean) => {
    isVisible.value = visible
  }

  const show = async () => {
    await yoBrowserPresenter.show(true)
    await loadState()
  }

  const hide = async () => {
    await yoBrowserPresenter.hide()
    await loadState()
  }

  const toggleVisibility = async (): Promise<boolean> => {
    const visible = await yoBrowserPresenter.toggleVisibility()
    isVisible.value = Boolean(visible)
    await loadState()
    return isVisible.value
  }

  const openTab = async (tabId: string): Promise<void> => {
    await yoBrowserPresenter.activateTab(tabId)
    await yoBrowserPresenter.show(true)
    await loadState()
  }

  onMounted(async () => {
    await loadState()
    if (window?.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_CREATED, handleTabCreated)
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_CLOSED, handleTabClosed)
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_ACTIVATED, handleTabActivated)
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_NAVIGATED, handleTabNavigated)
      window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.TAB_UPDATED, handleTabUpdated)
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
      window.electron.ipcRenderer.removeListener(YO_BROWSER_EVENTS.TAB_UPDATED, handleTabUpdated)
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
    currentPage,
    tabs,
    isVisible,
    activeTabId,
    tabCount,
    hasWindow,
    canGoBack,
    canGoForward,
    show,
    hide,
    toggleVisibility,
    openTab,
    loadState
  }
})
