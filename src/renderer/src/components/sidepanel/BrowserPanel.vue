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
import BrowserPlaceholder from './BrowserPlaceholder.vue'
import type { YoBrowserStatus } from '@shared/types/browser'
import { usePresenter } from '@/composables/usePresenter'
import { YO_BROWSER_EVENTS } from '@/events'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useSessionStore } from '@/stores/ui/session'

const props = defineProps<{
  sessionId: string | null
}>()

const { t } = useI18n()
const sidepanelStore = useSidepanelStore()
const sessionStore = useSessionStore()
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')

const containerRef = ref<HTMLElement | null>(null)
const hostWindowId = ref<number | null>(null)
const browserStatus = ref<YoBrowserStatus>({
  initialized: false,
  page: null,
  canGoBack: false,
  canGoForward: false,
  visible: false,
  loading: false
})
const currentUrl = ref('about:blank')
const urlInput = ref('')
const canGoBack = ref(false)
const canGoForward = ref(false)
const lastSyncedBounds = ref<Rectangle | null>(null)
const pendingBrowserDestroySessionIds = new Set<string>()
let visibilityRunId = 0

const STABLE_RECT_SAMPLE_MS = 48
const STABLE_RECT_TIMEOUT_MS = 1500

const currentSessionId = computed(() => props.sessionId?.trim() || '')
const showPlaceholder = computed(
  () => !browserStatus.value.initialized || currentUrl.value === 'about:blank'
)
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

const callPresenter = async <T>(
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

const resolvePayloadSessionId = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const typedPayload = payload as { sessionId?: unknown }
  return typeof typedPayload.sessionId === 'string' ? typedPayload.sessionId : ''
}

const resolvePayloadWindowId = (payload: unknown): number | null => {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const typedPayload = payload as { windowId?: unknown }
  return typeof typedPayload.windowId === 'number' ? typedPayload.windowId : null
}

const resolvePayloadUrl = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const typedPayload = payload as { url?: unknown }
  return typeof typedPayload.url === 'string' ? typedPayload.url : ''
}

const getSessionUiStatus = (sessionId: string) => {
  return sessionStore.sessions.find((session) => session.id === sessionId)?.status ?? null
}

const resetBrowserState = () => {
  browserStatus.value = {
    initialized: false,
    page: null,
    canGoBack: false,
    canGoForward: false,
    visible: false,
    loading: false
  }
  currentUrl.value = 'about:blank'
  urlInput.value = ''
  canGoBack.value = false
  canGoForward.value = false
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

const loadState = async (sessionId: string = currentSessionId.value) => {
  if (!sessionId) {
    resetBrowserState()
    return
  }

  const status = await callPresenter<YoBrowserStatus>(
    'getBrowserStatus',
    yoBrowserPresenter.getBrowserStatus(sessionId)
  )
  if (sessionId !== currentSessionId.value) {
    return
  }

  if (!status) {
    resetBrowserState()
    return
  }

  browserStatus.value = status
  currentUrl.value = status.page?.url || 'about:blank'
  urlInput.value = currentUrl.value === 'about:blank' ? '' : currentUrl.value
  canGoBack.value = status.canGoBack
  canGoForward.value = status.canGoForward
}

const syncVisibleBounds = async () => {
  if (
    hostWindowId.value == null ||
    !currentSessionId.value ||
    !browserStatus.value.initialized ||
    !isBrowserPanelVisible.value
  ) {
    return
  }

  const rect = captureContainerBounds()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return
  }

  lastSyncedBounds.value = rect
  await callPresenter(
    'updateSessionBrowserBounds',
    yoBrowserPresenter.updateSessionBrowserBounds(
      currentSessionId.value,
      hostWindowId.value,
      rect,
      true
    )
  )
}

const hideEmbedded = async (sessionId: string = currentSessionId.value) => {
  visibilityRunId += 1

  if (!sessionId) {
    return
  }

  const hiddenBounds = lastSyncedBounds.value ??
    captureContainerBounds() ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }

  if (hostWindowId.value != null) {
    await callPresenter(
      'updateSessionBrowserBounds(hidden)',
      yoBrowserPresenter.updateSessionBrowserBounds(
        sessionId,
        hostWindowId.value,
        hiddenBounds,
        false
      )
    )
  }
  await callPresenter('detachSessionBrowser', yoBrowserPresenter.detachSessionBrowser(sessionId))
}

const ensureVisibleAttachment = async () => {
  if (
    hostWindowId.value == null ||
    !currentSessionId.value ||
    !browserStatus.value.initialized ||
    !isBrowserPanelVisible.value
  ) {
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

  const attached = await callPresenter<boolean>(
    'attachSessionBrowser',
    yoBrowserPresenter.attachSessionBrowser(currentSessionId.value, hostWindowId.value)
  )
  if (!attached || runId !== visibilityRunId) {
    return
  }

  lastSyncedBounds.value = stableRect
  await callPresenter(
    'updateSessionBrowserBounds(visible)',
    yoBrowserPresenter.updateSessionBrowserBounds(
      currentSessionId.value,
      hostWindowId.value,
      stableRect,
      true
    )
  )
  await loadState(currentSessionId.value)
}

const handleBrowserEvent = async (_event: unknown, payload: unknown) => {
  if (resolvePayloadSessionId(payload) !== currentSessionId.value) {
    return
  }

  await loadState(currentSessionId.value)
}

const handleOpenRequested = async (_event: unknown, payload: unknown) => {
  if (
    resolvePayloadSessionId(payload) !== currentSessionId.value ||
    hostWindowId.value == null ||
    resolvePayloadWindowId(payload) !== hostWindowId.value
  ) {
    return
  }

  const url = resolvePayloadUrl(payload)
  console.info('[BrowserPanel] panel open requested', {
    windowId: hostWindowId.value,
    url
  })

  // Update the URL input to reflect the requested URL
  if (url) {
    urlInput.value = url
  }

  await loadState(currentSessionId.value)

  // Wait for panel to be visible and DOM ready before attaching
  await nextTick()
  if (isBrowserPanelVisible.value) {
    await ensureVisibleAttachment()
  }
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
  if (!currentSessionId.value) {
    return
  }

  const nextUrl = normalizeUrl(urlInput.value)
  if (!nextUrl) {
    return
  }

  const result = await callPresenter<YoBrowserStatus>(
    'loadUrl',
    yoBrowserPresenter.loadUrl(currentSessionId.value, nextUrl)
  )
  if (result === null) {
    return
  }

  browserStatus.value = result
  await loadState(currentSessionId.value)
}

const goBack = async () => {
  if (!currentSessionId.value || !browserStatus.value.initialized) {
    return
  }

  const result = await callPresenter<void>(
    'goBack',
    yoBrowserPresenter.goBack(currentSessionId.value)
  )
  if (result === null) {
    return
  }

  await loadState(currentSessionId.value)
}

const goForward = async () => {
  if (!currentSessionId.value || !browserStatus.value.initialized) {
    return
  }

  const result = await callPresenter<void>(
    'goForward',
    yoBrowserPresenter.goForward(currentSessionId.value)
  )
  if (result === null) {
    return
  }

  await loadState(currentSessionId.value)
}

const reloadPage = async () => {
  if (!currentSessionId.value || !browserStatus.value.initialized) {
    return
  }

  const result = await callPresenter<void>(
    'reload',
    yoBrowserPresenter.reload(currentSessionId.value)
  )
  if (result === null) {
    return
  }

  await loadState(currentSessionId.value)
}

const cleanupInactiveSession = async (sessionId: string) => {
  if (!sessionId) {
    return
  }

  await hideEmbedded(sessionId)
  if (getSessionUiStatus(sessionId) === 'working') {
    pendingBrowserDestroySessionIds.add(sessionId)
    return
  }

  pendingBrowserDestroySessionIds.delete(sessionId)
  await callPresenter('destroySessionBrowser', yoBrowserPresenter.destroySessionBrowser(sessionId))
}

const flushPendingSessionDestroys = async () => {
  for (const sessionId of Array.from(pendingBrowserDestroySessionIds)) {
    if (getSessionUiStatus(sessionId) === 'working') {
      continue
    }

    pendingBrowserDestroySessionIds.delete(sessionId)
    await callPresenter(
      'destroySessionBrowser',
      yoBrowserPresenter.destroySessionBrowser(sessionId)
    )
  }
}

useResizeObserver(containerRef, () => {
  if (!isBrowserPanelVisible.value || !browserStatus.value.initialized) {
    return
  }

  void syncVisibleBounds()
})

watch(isBrowserPanelVisible, (visible) => {
  if (visible) {
    void loadState(currentSessionId.value)
    void ensureVisibleAttachment()
    return
  }

  void hideEmbedded(currentSessionId.value)
})

watch(
  () => props.sessionId,
  (nextSessionId, previousSessionId) => {
    if (previousSessionId && previousSessionId !== nextSessionId) {
      void cleanupInactiveSession(previousSessionId)
    }

    if (!nextSessionId) {
      resetBrowserState()
      return
    }

    void loadState(nextSessionId)
    if (isBrowserPanelVisible.value) {
      void ensureVisibleAttachment()
    }
  },
  { immediate: true }
)

watch(
  () => sessionStore.sessions.map((session) => `${session.id}:${session.status}`).join('|'),
  () => {
    void flushPendingSessionDestroys()
    if (currentSessionId.value) {
      void loadState(currentSessionId.value)
    }
  }
)

onMounted(async () => {
  hostWindowId.value = window.api.getWindowId?.() ?? null
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.OPEN_REQUESTED, handleOpenRequested)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_CREATED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_UPDATED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_CLOSED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_FOCUSED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED, handleBrowserEvent)

  if (currentSessionId.value) {
    await loadState(currentSessionId.value)
  }
  if (isBrowserPanelVisible.value) {
    await ensureVisibleAttachment()
  }
})

onBeforeUnmount(() => {
  void hideEmbedded(currentSessionId.value)
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
