<template>
  <div class="w-screen h-screen flex flex-col" :class="isWinMacOS ? '' : 'bg-background'">
    <AppBar ref="appBarRef" :window-type="windowType" />
    <BrowserToolbar v-if="shouldShowToolbar" ref="toolbarRef" />
    <main class="content-container flex-1 relative overflow-hidden">
      <!-- WebContentsView will be rendered here by the main process -->
      <!-- Show placeholder when browser tab is about:blank -->
      <BrowserPlaceholder v-if="shouldShowPlaceholder" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppBar from './components/AppBar.vue'
import BrowserToolbar from './components/BrowserToolbar.vue'
import BrowserPlaceholder from './components/BrowserPlaceholder.vue'
import { useDeviceVersion } from '@/composables/useDeviceVersion'
import { useMcpStore } from '@/stores/mcp'
import { useTabStore } from '@shell/stores/tab'
import { useElementSize } from '@vueuse/core'
import { useFontManager } from '@/composables/useFontManager'

const { setupFontListener } = useFontManager()
setupFontListener()

// Detect platform to apply proper styling
const { isWinMacOS } = useDeviceVersion()
const router = useRouter()
const mcpStore = useMcpStore()
const tabStore = useTabStore()

const windowType = ref<'chat' | 'browser'>('chat')
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
const shouldShowToolbar = computed(() => windowType.value === 'browser' && isWebTabActive.value)
const shouldShowPlaceholder = computed(
  () => windowType.value === 'browser' && isWebTabActive.value && isAboutBlank.value
)

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
  window.electron.ipcRenderer.once('shell-window:type', (_event, type: 'chat' | 'browser') => {
    windowType.value = type === 'browser' ? 'browser' : 'chat'
  })

  // Check for pending MCP install from localStorage (cold start scenario)
  try {
    const pendingMcpInstall = localStorage.getItem('pending-mcp-install')
    if (pendingMcpInstall) {
      console.log('Found pending MCP install in localStorage (cold start):', pendingMcpInstall)
      // Clear the localStorage immediately to prevent re-processing
      localStorage.removeItem('pending-mcp-install')

      // Parse and process the MCP configuration
      const mcpConfig = JSON.parse(pendingMcpInstall)

      if (!mcpConfig?.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
        console.error('Invalid MCP install config, missing mcpServers')
        return
      }

      // Enable MCP if not already enabled
      if (!mcpStore.mcpEnabled) {
        await mcpStore.setMcpEnabled(true)
      }

      // Set the MCP install cache
      mcpStore.setMcpInstallCache(JSON.stringify(mcpConfig))

      // Navigate to MCP settings page
      const currentRoute = router.currentRoute.value
      if (currentRoute.name !== 'settings-mcp') {
        await router.push({ name: 'settings-mcp' })
      } else {
        await router.replace({
          name: 'settings-mcp',
          query: { ...currentRoute.query }
        })
      }

      console.log('MCP install deeplink processed successfully from cold start')
    }
  } catch (error) {
    console.error('Error processing pending MCP install from cold start:', error)
    // Clear potentially corrupted data
    localStorage.removeItem('pending-mcp-install')
  }
})
</script>

<style>
html,
body {
  background-color: transparent;
}
</style>
