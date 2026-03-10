<template>
  <div class="flex h-12 items-center gap-2 border-b border-border bg-card px-4 py-2">
    <Button variant="outline" size="icon" :disabled="!canGoBack" @click="goBack">
      <Icon icon="lucide:arrow-left" class="h-4 w-4" />
    </Button>
    <Button variant="outline" size="icon" :disabled="!canGoForward" @click="goForward">
      <Icon icon="lucide:arrow-right" class="h-4 w-4" />
    </Button>
    <Button variant="outline" size="icon" @click="reload">
      <Icon icon="lucide:refresh-ccw" class="h-4 w-4" />
    </Button>
    <form class="flex flex-1" @submit.prevent="navigate">
      <Input
        v-model="urlInput"
        type="text"
        class="flex-1 text-sm"
        :placeholder="t('common.browser.addressPlaceholder')"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
      />
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Icon } from '@iconify/vue'
import { usePresenter } from '@/composables/usePresenter'
import { useI18n } from 'vue-i18n'
import { useBrowserWindowStore } from '../stores/window'

const browserWindowStore = useBrowserWindowStore()
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
const { t } = useI18n()

const urlInput = ref('')
const canGoBack = ref(false)
const canGoForward = ref(false)
const isNavigating = ref(false)

const currentWindowId = computed(() => browserWindowStore.windowId)
const currentPage = computed(() => browserWindowStore.browserWindow?.page ?? null)

const syncUrlInput = (url?: string) => {
  if (!currentPage.value) {
    urlInput.value = ''
    return
  }

  if (url !== undefined) {
    urlInput.value = url === 'about:blank' ? '' : url
  }
}

watch(
  () => currentPage.value?.url,
  (url) => {
    syncUrlInput(url)
  },
  { immediate: true }
)

const refreshNavigationState = async () => {
  if (!currentWindowId.value) {
    canGoBack.value = false
    canGoForward.value = false
    return
  }

  try {
    const state = await yoBrowserPresenter.getNavigationState(currentWindowId.value)
    canGoBack.value = Boolean(state?.canGoBack)
    canGoForward.value = Boolean(state?.canGoForward)
  } catch (error) {
    console.warn('Failed to refresh navigation state', error)
    canGoBack.value = false
    canGoForward.value = false
  }
}

watch([currentWindowId, () => currentPage.value?.url], refreshNavigationState, {
  immediate: true
})

onMounted(() => {
  refreshNavigationState()
})

const normalizeUrl = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

const navigate = async () => {
  if (isNavigating.value || !currentWindowId.value) return

  const normalized = normalizeUrl(urlInput.value)
  if (!normalized) return

  isNavigating.value = true
  try {
    await yoBrowserPresenter.navigateWindow(currentWindowId.value, normalized)
    await browserWindowStore.loadState()
  } catch (error) {
    console.error('Failed to navigate', error)
  } finally {
    isNavigating.value = false
    refreshNavigationState()
  }
}

const goBack = async () => {
  if (!currentWindowId.value) return
  try {
    await yoBrowserPresenter.goBack(currentWindowId.value)
    await browserWindowStore.loadState()
  } catch (error) {
    console.error('Failed to go back', error)
  }
  refreshNavigationState()
}

const goForward = async () => {
  if (!currentWindowId.value) return
  try {
    await yoBrowserPresenter.goForward(currentWindowId.value)
    await browserWindowStore.loadState()
  } catch (error) {
    console.error('Failed to go forward', error)
  }
  refreshNavigationState()
}

const reload = async () => {
  if (!currentWindowId.value) return
  try {
    await yoBrowserPresenter.reload(currentWindowId.value)
    await browserWindowStore.loadState()
  } catch (error) {
    console.error('Failed to reload page', error)
  }
  refreshNavigationState()
}
</script>
