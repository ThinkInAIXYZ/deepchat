<template>
  <div class="w-screen h-screen flex flex-col" :class="isWinMacOS ? '' : 'bg-background'">
    <AppBar ref="appBarRef" />
    <BrowserToolbar v-if="shouldShowToolbar" ref="toolbarRef" />
    <main
      class="content-container flex-1 relative overflow-hidden"
      :class="webContentBackgroundClass"
    >
      <!-- WebContentsView will be rendered here by the main process -->
      <!-- Show placeholder when browser tab is about:blank -->
      <BrowserPlaceholder v-if="shouldShowPlaceholder" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppBar from './components/AppBar.vue'
import BrowserToolbar from './components/BrowserToolbar.vue'
import BrowserPlaceholder from './components/BrowserPlaceholder.vue'
import { useDeviceVersion } from '@/composables/useDeviceVersion'
import { useTabStore } from '@shell/stores/tab'
import { useElementSize } from '@vueuse/core'
import { useFontManager } from '@/composables/useFontManager'

const { setupFontListener } = useFontManager()
setupFontListener()

// Detect platform to apply proper styling
const { isWinMacOS } = useDeviceVersion()
const tabStore = useTabStore()

const windowId = ref<number | null>(null)
const appBarRef = ref<InstanceType<typeof AppBar> | null>(null)
const toolbarRef = ref<InstanceType<typeof BrowserToolbar> | null>(null)

const activeTab = computed(() => tabStore.tabs.find((tab) => tab.id === tabStore.currentTabId))
const isWebTabActive = computed(() => {
  const tab = activeTab.value
  if (!tab) return false
  return Boolean(!tab.url?.startsWith('local://') && tab.browserTabId)
})
const isAboutBlank = computed(() => {
  const tab = activeTab.value
  return tab?.url === 'about:blank'
})
const shouldShowToolbar = computed(() => isWebTabActive.value)
const shouldShowPlaceholder = computed(() => isWebTabActive.value && isAboutBlank.value)
const webContentBackgroundClass = computed(() => (isWebTabActive.value ? 'bg-white' : ''))

// Chrome height reporting — needed for browser windows (TabPresenter manages view bounds)
const appBarSize = useElementSize(computed(() => appBarRef.value?.$el ?? null))
const toolbarSize = useElementSize(computed(() => toolbarRef.value?.$el ?? null))

const chromeHeight = computed(() => {
  const appBarHeight = appBarSize.height.value || 36
  const toolbarHeight = shouldShowToolbar.value ? toolbarSize.height.value || 0 : 0
  return appBarHeight + toolbarHeight
})

const sendChromeHeight = (height: number) => {
  if (windowId.value == null) return
  window.electron.ipcRenderer.send('shell:chrome-height', { height })
}

watch(
  chromeHeight,
  (height) => {
    sendChromeHeight(height)
  },
  { immediate: true }
)

onMounted(async () => {
  windowId.value = window.api.getWindowId?.() ?? null
  await nextTick()
  sendChromeHeight(chromeHeight.value)
})
</script>

<style>
html,
body {
  background-color: transparent;
}
</style>
