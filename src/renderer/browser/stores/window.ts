import { computed, ref } from 'vue'
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

function resolveWindowId(payload: unknown): number | null {
  if (typeof payload === 'number') {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return null
  }

  if ('windowId' in payload && typeof payload.windowId === 'number') {
    return payload.windowId
  }

  if ('id' in payload && typeof payload.id === 'number') {
    return payload.id
  }

  if (
    'window' in payload &&
    payload.window &&
    typeof payload.window === 'object' &&
    'id' in payload.window &&
    typeof payload.window.id === 'number'
  ) {
    return payload.window.id
  }

  return null
}

export const useBrowserWindowStore = defineStore('browserWindow', () => {
  const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
  const windowId = ref<number | null>(null)
  const browserWindow = ref<BrowserWindowInfo | null>(null)
  const initialized = ref(false)

  const page = computed(() => browserWindow.value?.page ?? null)
  const isAboutBlank = computed(() => page.value?.url === 'about:blank')

  const loadState = async () => {
    if (windowId.value == null) return
    browserWindow.value = await yoBrowserPresenter.getWindowById(windowId.value)
  }

  const handleWindowEvent = async (_event: unknown, payload: unknown) => {
    const changedWindowId = resolveWindowId(payload)
    if (changedWindowId === null || changedWindowId === windowId.value) {
      await loadState()
    }
  }

  const init = async () => {
    if (initialized.value) return
    initialized.value = true
    windowId.value = window.api.getWindowId?.() ?? null
    await loadState()

    if (!window?.electron?.ipcRenderer) {
      return
    }

    WINDOW_EVENT_CHANNELS.forEach((channel) => {
      window.electron.ipcRenderer.on(channel, handleWindowEvent)
    })
  }

  return {
    windowId,
    browserWindow,
    page,
    isAboutBlank,
    init,
    loadState
  }
})
