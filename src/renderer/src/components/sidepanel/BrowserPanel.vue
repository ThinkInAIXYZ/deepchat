<template>
  <div class="flex h-full min-w-0 flex-1 flex-col bg-background">
    <div class="flex h-11 items-center gap-2 border-b px-3">
      <Button
        variant="outline"
        size="icon"
        class="h-7 w-7"
        :aria-label="t('common.browser.back')"
        :disabled="!canGoBack"
        @click="goBack"
      >
        <Icon icon="lucide:arrow-left" class="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        class="h-7 w-7"
        :aria-label="t('common.browser.forward')"
        :disabled="!canGoForward"
        @click="goForward"
      >
        <Icon icon="lucide:arrow-right" class="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        class="h-7 w-7"
        :aria-label="t('common.browser.reload')"
        @click="reloadPage"
      >
        <Icon icon="lucide:refresh-ccw" class="h-4 w-4" />
      </Button>
      <form class="flex min-w-0 flex-1" @submit.prevent="navigate">
        <Input
          v-model="urlInput"
          :aria-label="t('common.browser.addressLabel')"
          class="h-7 text-xs"
          :placeholder="t('common.browser.addressPlaceholder')"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
        />
      </form>
    </div>

    <div ref="containerRef" class="relative min-h-0 flex-1 overflow-hidden">
      <BrowserPlaceholder v-if="showPlaceholder" class="absolute inset-0" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Rectangle } from 'electron'
import { useResizeObserver } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import BrowserPlaceholder from '@browser/components/BrowserPlaceholder.vue'
import type { BrowserWindowInfo } from '@shared/types/browser'
import { usePresenter } from '@/composables/usePresenter'
import { YO_BROWSER_EVENTS } from '@/events'
import { useSidepanelStore } from '@/stores/ui/sidepanel'

const { t } = useI18n()
const sidepanelStore = useSidepanelStore()
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')

const containerRef = ref<HTMLElement | null>(null)
const hostWindowId = ref<number | null>(null)
const browserWindowId = ref<number | null>(null)
const currentUrl = ref('about:blank')
const urlInput = ref('')
const canGoBack = ref(false)
const canGoForward = ref(false)
const lastSyncedBounds = ref<Rectangle | null>(null)
let visibilityRunId = 0

const STABLE_RECT_SAMPLE_MS = 48
const STABLE_RECT_TIMEOUT_MS = 1500

const showPlaceholder = computed(() => currentUrl.value === 'about:blank')
const isBrowserPanelVisible = computed(
  () => sidepanelStore.open && sidepanelStore.activeTab === 'browser'
)

const isPresenterError = (value: unknown): value is { error: string } => {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'string'
  )
}

const callPresenter = async <T,>(
  action: string,
  promise: Promise<T | { error: string } | null>
): Promise<T | null> => {
  const result = await promise
  if (isPresenterError(result)) {
    console.error(`[BrowserPanel] ${action} failed`, result.error)
    return null
  }

  return result as T | null
}

const resolveWindowId = (payload: unknown): number | null => {
  if (typeof payload === 'number') {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return null
  }

  if ('windowId' in payload && typeof payload.windowId === 'number') {
    return payload.windowId
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

const isCurrentHostWindow = (windowId: number | null) => {
  return windowId != null && hostWindowId.value != null && windowId === hostWindowId.value
}

const captureContainerBounds = (): Rectangle | null => {
  if (!containerRef.value) {
    return null
  }

  const rect = containerRef.value.getBoundingClientRect()
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  }
}

const wait = async (ms: number) => {
  await new Promise((resolve) => window.setTimeout(resolve, ms))
}

const waitForStableRect = async (runId: number): Promise<Rectangle | null> => {
  let previousKey = ''
  let stableCount = 0
  const deadline = Date.now() + STABLE_RECT_TIMEOUT_MS

  while (runId === visibilityRunId && isBrowserPanelVisible.value) {
    const rect = captureContainerBounds()
    if (rect && rect.width > 0 && rect.height > 0) {
      const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
      stableCount = key === previousKey ? stableCount + 1 : 1
      previousKey = key
      if (stableCount >= 2) {
        return rect
      }
    } else {
      previousKey = ''
      stableCount = 0
    }

    if (Date.now() >= deadline) {
      console.warn('[BrowserPanel] stable rect wait timed out', {
        windowId: hostWindowId.value
      })
      return null
    }

    await wait(STABLE_RECT_SAMPLE_MS)
  }

  return null
}

const loadState = async () => {
  if (hostWindowId.value == null) {
    return
  }

  const browserWindow = await callPresenter<BrowserWindowInfo>(
    'getWindowById',
    yoBrowserPresenter.getWindowById(hostWindowId.value)
  )
  browserWindowId.value = browserWindow?.id ?? null
  currentUrl.value = browserWindow?.page.url || 'about:blank'
  urlInput.value = currentUrl.value === 'about:blank' ? '' : currentUrl.value

  if (browserWindowId.value == null) {
    canGoBack.value = false
    canGoForward.value = false
    return
  }

  const navigationState = await callPresenter<{ canGoBack: boolean; canGoForward: boolean }>(
    'getNavigationState',
    yoBrowserPresenter.getNavigationState(browserWindowId.value)
  )
  canGoBack.value = Boolean(navigationState?.canGoBack)
  canGoForward.value = Boolean(navigationState?.canGoForward)
}

const syncVisibleBounds = async () => {
  if (hostWindowId.value == null || browserWindowId.value == null || !isBrowserPanelVisible.value) {
    return
  }

  const rect = captureContainerBounds()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return
  }

  lastSyncedBounds.value = rect
  await callPresenter(
    'updateEmbeddedBounds',
    yoBrowserPresenter.updateEmbeddedBounds(hostWindowId.value, rect, true)
  )
}

const hideEmbedded = async () => {
  visibilityRunId += 1

  if (hostWindowId.value == null || browserWindowId.value == null) {
    return
  }

  const hiddenBounds = lastSyncedBounds.value ??
    captureContainerBounds() ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }

  await callPresenter(
    'updateEmbeddedBounds(hidden)',
    yoBrowserPresenter.updateEmbeddedBounds(hostWindowId.value, hiddenBounds, false)
  )
  await callPresenter('detachEmbedded', yoBrowserPresenter.detachEmbedded())
}

const ensureVisibleAttachment = async () => {
  if (hostWindowId.value == null || !isBrowserPanelVisible.value) {
    return
  }

  const runId = ++visibilityRunId
  await nextTick()

  const stableRect = await waitForStableRect(runId)
  if (
    stableRect == null ||
    runId !== visibilityRunId ||
    hostWindowId.value == null ||
    !isBrowserPanelVisible.value
  ) {
    return
  }

  const attachedWindowId = await callPresenter<number>(
    'attachEmbeddedToWindow',
    yoBrowserPresenter.attachEmbeddedToWindow(hostWindowId.value)
  )
  if (attachedWindowId == null || runId !== visibilityRunId) {
    return
  }

  browserWindowId.value = attachedWindowId
  lastSyncedBounds.value = stableRect
  await callPresenter(
    'updateEmbeddedBounds(visible)',
    yoBrowserPresenter.updateEmbeddedBounds(hostWindowId.value, stableRect, true)
  )
  await loadState()
}

const handleBrowserEvent = async (_event: unknown, payload: unknown) => {
  if (!isBrowserPanelVisible.value || !isCurrentHostWindow(resolveWindowId(payload))) {
    return
  }

  await loadState()
}

const handleOpenRequested = async (_event: unknown, payload: unknown) => {
  if (!isCurrentHostWindow(resolveWindowId(payload)) || !isBrowserPanelVisible.value) {
    return
  }

  console.info('[BrowserPanel] panel open requested', {
    windowId: hostWindowId.value
  })
  await loadState()
  await ensureVisibleAttachment()
}

const normalizeUrl = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

const navigate = async () => {
  if (hostWindowId.value == null) {
    return
  }

  const nextUrl = normalizeUrl(urlInput.value)
  if (!nextUrl) {
    return
  }

  if (browserWindowId.value == null) {
    await ensureVisibleAttachment()
  }

  if (browserWindowId.value == null) {
    return
  }

  const result = await callPresenter<void>(
    'navigateWindow',
    yoBrowserPresenter.navigateWindow(browserWindowId.value, nextUrl)
  )
  if (result === null) {
    return
  }

  await loadState()
}

const goBack = async () => {
  if (browserWindowId.value == null) {
    return
  }

  const result = await callPresenter<void>(
    'goBack',
    yoBrowserPresenter.goBack(browserWindowId.value)
  )
  if (result === null) {
    return
  }

  await loadState()
}

const goForward = async () => {
  if (browserWindowId.value == null) {
    return
  }

  const result = await callPresenter<void>(
    'goForward',
    yoBrowserPresenter.goForward(browserWindowId.value)
  )
  if (result === null) {
    return
  }

  await loadState()
}

const reloadPage = async () => {
  if (browserWindowId.value == null) {
    return
  }

  const result = await callPresenter<void>(
    'reload',
    yoBrowserPresenter.reload(browserWindowId.value)
  )
  if (result === null) {
    return
  }

  await loadState()
}

useResizeObserver(containerRef, () => {
  if (!isBrowserPanelVisible.value || browserWindowId.value == null) {
    return
  }

  void syncVisibleBounds()
})

watch(isBrowserPanelVisible, (visible) => {
  if (visible) {
    void loadState()
    void ensureVisibleAttachment()
    return
  }

  void hideEmbedded()
})

onMounted(async () => {
  hostWindowId.value = window.api.getWindowId?.() ?? null
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.OPEN_REQUESTED, handleOpenRequested)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_CREATED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_UPDATED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_CLOSED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_FOCUSED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED, handleBrowserEvent)

  await loadState()
  if (isBrowserPanelVisible.value) {
    await ensureVisibleAttachment()
  }
})

onBeforeUnmount(() => {
  void hideEmbedded()
  window.electron.ipcRenderer.removeListener(YO_BROWSER_EVENTS.OPEN_REQUESTED, handleOpenRequested)
  window.electron.ipcRenderer.removeListener(YO_BROWSER_EVENTS.WINDOW_CREATED, handleBrowserEvent)
  window.electron.ipcRenderer.removeListener(YO_BROWSER_EVENTS.WINDOW_UPDATED, handleBrowserEvent)
  window.electron.ipcRenderer.removeListener(YO_BROWSER_EVENTS.WINDOW_CLOSED, handleBrowserEvent)
  window.electron.ipcRenderer.removeListener(YO_BROWSER_EVENTS.WINDOW_FOCUSED, handleBrowserEvent)
  window.electron.ipcRenderer.removeListener(
    YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED,
    handleBrowserEvent
  )
})
</script>
