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
import { useResizeObserver } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { YO_BROWSER_EVENTS } from '@/events'
import { usePresenter } from '@/composables/usePresenter'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import BrowserPlaceholder from '../../../browser/components/BrowserPlaceholder.vue'

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

const showPlaceholder = computed(() => currentUrl.value === 'about:blank')

const handleBrowserEvent = async () => {
  await loadState()
}

const loadState = async () => {
  if (hostWindowId.value == null) {
    return
  }

  if (browserWindowId.value == null) {
    browserWindowId.value = await yoBrowserPresenter.attachEmbeddedToWindow(hostWindowId.value)
  }

  if (browserWindowId.value == null) {
    return
  }

  const browserWindow = await yoBrowserPresenter.getWindowById(browserWindowId.value)
  currentUrl.value = browserWindow?.page.url || 'about:blank'
  urlInput.value = currentUrl.value === 'about:blank' ? '' : currentUrl.value

  const navigationState = await yoBrowserPresenter.getNavigationState(browserWindowId.value)
  canGoBack.value = Boolean(navigationState?.canGoBack)
  canGoForward.value = Boolean(navigationState?.canGoForward)
}

const syncBounds = async () => {
  if (hostWindowId.value == null || !containerRef.value) {
    return
  }

  const rect = containerRef.value.getBoundingClientRect()
  await yoBrowserPresenter.updateEmbeddedBounds(
    hostWindowId.value,
    {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    },
    sidepanelStore.open && sidepanelStore.activeTab === 'browser'
  )
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

  browserWindowId.value = await yoBrowserPresenter.attachEmbeddedToWindow(hostWindowId.value)
  if (browserWindowId.value == null) {
    return
  }

  await yoBrowserPresenter.navigateWindow(browserWindowId.value, nextUrl)
  await loadState()
  await nextTick()
  await syncBounds()
}

const goBack = async () => {
  if (browserWindowId.value == null) {
    return
  }
  await yoBrowserPresenter.goBack(browserWindowId.value)
  await loadState()
}

const goForward = async () => {
  if (browserWindowId.value == null) {
    return
  }
  await yoBrowserPresenter.goForward(browserWindowId.value)
  await loadState()
}

const reloadPage = async () => {
  if (browserWindowId.value == null) {
    return
  }
  await yoBrowserPresenter.reload(browserWindowId.value)
  await loadState()
}

useResizeObserver(containerRef, () => {
  void syncBounds()
})

watch(
  () => [sidepanelStore.open, sidepanelStore.activeTab] as const,
  () => {
    void syncBounds()
  }
)

onMounted(async () => {
  hostWindowId.value = window.api.getWindowId?.() ?? null
  await loadState()
  await nextTick()
  await syncBounds()

  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_CREATED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_UPDATED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_CLOSED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_FOCUSED, handleBrowserEvent)
  window.electron.ipcRenderer.on(YO_BROWSER_EVENTS.WINDOW_VISIBILITY_CHANGED, handleBrowserEvent)
})

onBeforeUnmount(() => {
  void yoBrowserPresenter.detachEmbedded()
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
