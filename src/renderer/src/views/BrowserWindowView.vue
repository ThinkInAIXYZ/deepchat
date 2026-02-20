<template>
  <div class="flex h-full w-full flex-col bg-background">
    <header
      class="flex h-10 min-h-10 items-center gap-2 border-b border-border px-2 window-drag-region"
    >
      <div v-if="!isFullscreened && isMacOS" class="h-full w-20 shrink-0 window-drag-region"></div>

      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0 window-no-drag-region"
        :title="t('common.browser.back')"
        :disabled="!canGoBack"
        @click="goBack"
      >
        <Icon icon="lucide:arrow-left" class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0 window-no-drag-region"
        :title="t('common.browser.forward')"
        :disabled="!canGoForward"
        @click="goForward"
      >
        <Icon icon="lucide:arrow-right" class="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0 window-no-drag-region"
        :title="t('common.browser.reload')"
        @click="reload"
      >
        <Icon
          :icon="isLoading ? 'lucide:loader-2' : 'lucide:refresh-ccw'"
          class="h-4 w-4"
          :class="{ 'animate-spin': isLoading }"
        />
      </Button>

      <form class="min-w-0 flex-1 window-no-drag-region" @submit.prevent="submitAddress">
        <Input
          v-model="addressInput"
          type="text"
          class="h-8 text-sm"
          :placeholder="t('common.browser.addressPlaceholder')"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
        />
      </form>

      <div class="flex-1 window-drag-region"></div>

      <Button
        v-if="!isMacOS"
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0 window-no-drag-region"
        :title="t('common.minimize')"
        @click="minimizeWindow"
      >
        <Icon icon="lucide:minus" class="h-4 w-4" />
      </Button>
      <Button
        v-if="!isMacOS"
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0 window-no-drag-region"
        :title="isMaximized ? t('common.restore') : t('common.maximize')"
        @click="toggleMaximize"
      >
        <Icon :icon="isMaximized ? 'lucide:copy' : 'lucide:square'" class="h-4 w-4" />
      </Button>
      <Button
        v-if="!isMacOS"
        variant="ghost"
        size="icon"
        class="h-8 w-8 shrink-0 window-no-drag-region hover:bg-red-700/80 hover:text-white"
        :title="t('common.close')"
        @click="closeWindow"
      >
        <Icon icon="lucide:x" class="h-4 w-4" />
      </Button>
    </header>

    <main class="relative h-0 grow">
      <webview
        ref="webviewRef"
        class="h-full w-full bg-white"
        :src="currentUrl"
        allowpopups
        @dom-ready="handleDomReady"
        @did-start-loading="handleDidStartLoading"
        @did-stop-loading="handleDidStopLoading"
        @did-navigate="handleDidNavigate"
        @did-navigate-in-page="handleDidNavigate"
        @page-title-updated="handleTitleUpdated"
      />

      <div
        v-if="showPlaceholder"
        class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-background text-muted-foreground"
      >
        <Icon icon="lucide:globe" class="mb-4 h-14 w-14 opacity-30" />
        <p class="text-lg font-medium">{{ t('common.browser.enterUrlToStart') }}</p>
        <p class="mt-2 text-sm opacity-60">{{ t('common.browser.enterUrlDescription') }}</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { usePresenter } from '@/composables/usePresenter'
import { WINDOW_EVENTS } from '@/events'

type WebviewTag = Electron.WebviewTag

const { t } = useI18n()

const windowPresenter = usePresenter('windowPresenter')
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
const devicePresenter = usePresenter('devicePresenter')
const route = useRoute()

const webviewRef = ref<WebviewTag | null>(null)
const addressInput = ref('')
const currentUrl = ref('about:blank')
const canGoBack = ref(false)
const canGoForward = ref(false)
const isLoading = ref(false)
const isMacOS = ref(false)
const isMaximized = ref(false)
const isFullscreened = ref(false)
const showPlaceholder = ref(true)
const registeredWebContentsId = ref<number | null>(null)

const { ipcRenderer } = window.electron

const normalizeUrl = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed === 'about:blank') return 'about:blank'
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

const updateNavigationState = () => {
  const webview = webviewRef.value
  if (!webview) {
    canGoBack.value = false
    canGoForward.value = false
    return
  }
  canGoBack.value = webview.canGoBack()
  canGoForward.value = webview.canGoForward()
}

const updateAddress = (url: string) => {
  currentUrl.value = url
  addressInput.value = url === 'about:blank' ? '' : url
  showPlaceholder.value = url === 'about:blank'
}

const getWindowId = () => window.api.getWindowId()

const minimizeWindow = () => {
  const id = getWindowId()
  if (id != null) {
    windowPresenter.minimize(id)
  }
}

const toggleMaximize = () => {
  const id = getWindowId()
  if (id != null) {
    windowPresenter.maximize(id)
  }
}

const closeWindow = () => {
  const id = getWindowId()
  if (id != null) {
    windowPresenter.close(id)
  }
}

const submitAddress = async () => {
  const webview = webviewRef.value
  if (!webview) return

  const targetUrl = normalizeUrl(addressInput.value)
  if (!targetUrl) return

  if (targetUrl === currentUrl.value && targetUrl !== 'about:blank') {
    webview.reload()
    return
  }

  try {
    await webview.loadURL(targetUrl)
  } catch (error) {
    console.warn('Failed to load URL:', targetUrl, error)
  }
}

const goBack = () => {
  const webview = webviewRef.value
  if (!webview || !webview.canGoBack()) return
  webview.goBack()
}

const goForward = () => {
  const webview = webviewRef.value
  if (!webview || !webview.canGoForward()) return
  webview.goForward()
}

const reload = () => {
  webviewRef.value?.reload()
}

const handleDidStartLoading = () => {
  isLoading.value = true
}

const handleDidStopLoading = () => {
  const webview = webviewRef.value
  isLoading.value = false
  if (!webview) return
  updateAddress(webview.getURL() || 'about:blank')
  updateNavigationState()
}

const handleDidNavigate = (event: Event) => {
  const detail = (event as unknown as { url?: string }).url
  if (typeof detail === 'string' && detail) {
    updateAddress(detail)
  }
  updateNavigationState()
}

const handleTitleUpdated = () => {
  updateNavigationState()
}

const handleDomReady = async () => {
  const webview = webviewRef.value
  if (!webview) return

  const contentsId = webview.getWebContentsId()
  registeredWebContentsId.value = contentsId
  await yoBrowserPresenter.registerBrowserWebContents(contentsId)

  const current = webview.getURL() || 'about:blank'
  updateAddress(current)
  updateNavigationState()
}

onMounted(async () => {
  devicePresenter.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })

  const id = getWindowId()
  if (id != null) {
    const maximized = await windowPresenter.isMaximized(id)
    isMaximized.value = Boolean(maximized)
  }

  const queryUrl = typeof route.query.url === 'string' ? normalizeUrl(route.query.url) : ''
  if (queryUrl) {
    updateAddress(queryUrl)
  } else {
    try {
      const activeTab = await yoBrowserPresenter.getActiveTab()
      if (activeTab?.url) {
        updateAddress(activeTab.url)
      }
    } catch (error) {
      console.warn('Failed to load browser state:', error)
    }
  }

  await nextTick()
  updateNavigationState()

  ipcRenderer?.on(WINDOW_EVENTS.WINDOW_MAXIMIZED, () => {
    isMaximized.value = true
  })
  ipcRenderer?.on(WINDOW_EVENTS.WINDOW_UNMAXIMIZED, () => {
    isMaximized.value = false
  })
  ipcRenderer?.on(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN, () => {
    isFullscreened.value = true
  })
  ipcRenderer?.on(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN, () => {
    isFullscreened.value = false
  })
})

onBeforeUnmount(() => {
  if (registeredWebContentsId.value != null) {
    void yoBrowserPresenter.unregisterBrowserWebContents(registeredWebContentsId.value)
  }

  ipcRenderer?.removeAllListeners(WINDOW_EVENTS.WINDOW_MAXIMIZED)
  ipcRenderer?.removeAllListeners(WINDOW_EVENTS.WINDOW_UNMAXIMIZED)
  ipcRenderer?.removeAllListeners(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN)
  ipcRenderer?.removeAllListeners(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN)
})
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

.window-no-drag-region {
  -webkit-app-region: no-drag;
}

button,
input {
  -webkit-app-region: no-drag;
}
</style>
