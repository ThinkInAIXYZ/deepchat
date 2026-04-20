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
import { BrowserClient } from '@api/BrowserClient'
import BrowserPlaceholder from './BrowserPlaceholder.vue'
import type { YoBrowserStatus } from '@shared/types/browser'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useSessionStore } from '@/stores/ui/session'

const props = defineProps<{
  sessionId: string | null
}>()

const { t } = useI18n()
const sidepanelStore = useSidepanelStore()
const sessionStore = useSessionStore()
const browserClient = new BrowserClient()

const containerRef = ref<HTMLElement | null>(null)
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
let stopOpenRequestedListener: (() => void) | null = null
let stopStatusChangedListener: (() => void) | null = null

const STABLE_RECT_SAMPLE_MS = 48
const STABLE_RECT_TIMEOUT_MS = 1500

const currentSessionId = computed(() => props.sessionId?.trim() || '')
const showPlaceholder = computed(
  () => !browserStatus.value.initialized || currentUrl.value === 'about:blank'
)
const isBrowserPanelVisible = computed(
  () => sidepanelStore.open && sidepanelStore.activeTab === 'browser'
)

const getSessionUiStatus = (sessionId: string) => {
  return sessionStore.sessions.find((session) => session.id === sessionId)?.status ?? null
}

const callBrowserAction = async <T>(action: string, run: () => Promise<T>): Promise<T | null> => {
  try {
    return await run()
  } catch (error) {
    console.error(`[BrowserPanel] ${action} failed`, error)
    return null
  }
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

const applyBrowserStatus = (status: YoBrowserStatus) => {
  browserStatus.value = status
  currentUrl.value = status.page?.url || 'about:blank'
  urlInput.value = currentUrl.value === 'about:blank' ? '' : currentUrl.value
  canGoBack.value = status.canGoBack
  canGoForward.value = status.canGoForward
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
      console.warn('[BrowserPanel] stable rect wait timed out')
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

  const status = await callBrowserAction('getStatus', () => browserClient.getStatus(sessionId))
  if (sessionId !== currentSessionId.value) {
    return
  }

  if (!status) {
    resetBrowserState()
    return
  }

  applyBrowserStatus(status)
}

const syncVisibleBounds = async () => {
  if (!currentSessionId.value || !browserStatus.value.initialized || !isBrowserPanelVisible.value) {
    return
  }

  const rect = captureContainerBounds()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return
  }

  lastSyncedBounds.value = rect
  await callBrowserAction('updateCurrentWindowBounds', () =>
    browserClient.updateCurrentWindowBounds(currentSessionId.value, rect, true)
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

  await callBrowserAction('updateCurrentWindowBounds(hidden)', () =>
    browserClient.updateCurrentWindowBounds(sessionId, hiddenBounds, false)
  )
  await callBrowserAction('detach', () => browserClient.detach(sessionId))
}

const ensureVisibleAttachment = async () => {
  if (!currentSessionId.value || !browserStatus.value.initialized || !isBrowserPanelVisible.value) {
    return
  }

  const runId = ++visibilityRunId
  await nextTick()

  const stableRect = await waitForStableRect(runId)
  if (stableRect == null || runId !== visibilityRunId || !isBrowserPanelVisible.value) {
    return
  }

  const attached = await callBrowserAction('attachCurrentWindow', () =>
    browserClient.attachCurrentWindow(currentSessionId.value)
  )
  if (!attached || runId !== visibilityRunId) {
    return
  }

  lastSyncedBounds.value = stableRect
  await callBrowserAction('updateCurrentWindowBounds(visible)', () =>
    browserClient.updateCurrentWindowBounds(currentSessionId.value, stableRect, true)
  )
  await loadState(currentSessionId.value)
}

const handleStatusChanged = async (payload: {
  sessionId: string
  reason: 'created' | 'updated' | 'closed' | 'focused' | 'visibility'
  status: YoBrowserStatus | null
  version: number
}) => {
  if (payload.sessionId !== currentSessionId.value) {
    return
  }

  await loadState(currentSessionId.value)
}

const handleOpenRequested = async (payload: {
  sessionId: string
  windowId: number
  url: string
  version: number
}) => {
  if (payload.sessionId !== currentSessionId.value) {
    return
  }

  console.info('[BrowserPanel] panel open requested', {
    windowId: payload.windowId,
    url: payload.url
  })

  if (payload.url) {
    urlInput.value = payload.url
  }

  await loadState(currentSessionId.value)
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

  const result = await callBrowserAction('loadUrl', () =>
    browserClient.loadUrl(currentSessionId.value, nextUrl)
  )
  if (result === null) {
    return
  }

  applyBrowserStatus(result)
  await loadState(currentSessionId.value)
}

const goBack = async () => {
  if (!currentSessionId.value || !browserStatus.value.initialized) {
    return
  }

  const result = await callBrowserAction('goBack', () =>
    browserClient.goBack(currentSessionId.value)
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

  const result = await callBrowserAction('goForward', () =>
    browserClient.goForward(currentSessionId.value)
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

  const result = await callBrowserAction('reload', () =>
    browserClient.reload(currentSessionId.value)
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
  await callBrowserAction('destroy', () => browserClient.destroy(sessionId))
}

const flushPendingSessionDestroys = async () => {
  for (const sessionId of Array.from(pendingBrowserDestroySessionIds)) {
    if (getSessionUiStatus(sessionId) === 'working') {
      continue
    }

    pendingBrowserDestroySessionIds.delete(sessionId)
    await callBrowserAction('destroy', () => browserClient.destroy(sessionId))
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
  stopOpenRequestedListener = browserClient.onOpenRequestedForCurrentWindow(handleOpenRequested)
  stopStatusChangedListener = browserClient.onStatusChanged(handleStatusChanged)

  if (currentSessionId.value) {
    await loadState(currentSessionId.value)
  }
  if (isBrowserPanelVisible.value) {
    await ensureVisibleAttachment()
  }
})

onBeforeUnmount(() => {
  void hideEmbedded(currentSessionId.value)
  stopOpenRequestedListener?.()
  stopOpenRequestedListener = null
  stopStatusChangedListener?.()
  stopStatusChangedListener = null
})
</script>
