import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BrowserWindowInfo } from '@shared/types/browser'
import { YO_BROWSER_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'

const WINDOW_EVENT_CHANNELS = [
  YO_BROWSER_EVENTS.WINDOW_CREATED,
  YO_BROWSER_EVENTS.WINDOW_UPDATED,
  YO_BROWSER_EVENTS.WINDOW_CLOSED,
  YO_BROWSER_EVENTS.WINDOW_FOCUSED,
  YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED,
  YO_BROWSER_EVENTS.WINDOW_COUNT_CHANGED
]

export const useYoBrowserStore = defineStore('yoBrowser', () => {
  const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
  const windows = ref<BrowserWindowInfo[]>([])
  const activeWindowId = ref<number | null>(null)

  const windowCount = computed(() => windows.value.length)
  const hasWindow = computed(() => windows.value.length > 0)
  const activeWindow = computed(
    () => windows.value.find((item) => item.id === activeWindowId.value) ?? null
  )

  const loadState = async () => {
    const snapshot = await yoBrowserPresenter.getBrowserContext()
    windows.value = Array.isArray(snapshot?.windows) ? snapshot.windows : []
    activeWindowId.value = snapshot?.activeWindowId ?? null
  }

  const handleStateChanged = async () => {
    await loadState()
  }

  const openLatestOrCreate = async () => {
    const targetWindowId = activeWindow.value?.id ?? windows.value[0]?.id ?? null

    if (targetWindowId != null) {
      await yoBrowserPresenter.focusWindow(targetWindowId)
    } else {
      await yoBrowserPresenter.openWindow('about:blank')
    }

    await loadState()
  }

  const openWindow = async (windowId: number) => {
    await yoBrowserPresenter.focusWindow(windowId)
    await loadState()
  }

  onMounted(async () => {
    await loadState()
    if (!window?.electron?.ipcRenderer) {
      return
    }

    WINDOW_EVENT_CHANNELS.forEach((channel) => {
      window.electron.ipcRenderer.on(channel, handleStateChanged)
    })
  })

  onBeforeUnmount(() => {
    if (!window?.electron?.ipcRenderer) {
      return
    }

    WINDOW_EVENT_CHANNELS.forEach((channel) => {
      window.electron.ipcRenderer.removeListener(channel, handleStateChanged)
    })
  })

  return {
    windows,
    activeWindowId,
    activeWindow,
    windowCount,
    hasWindow,
    openLatestOrCreate,
    openWindow,
    loadState
  }
})
