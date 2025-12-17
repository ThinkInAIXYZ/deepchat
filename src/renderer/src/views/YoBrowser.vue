<template>
  <div class="flex h-full flex-col bg-background text-foreground">
    <header class="space-y-2 border-b border-border/60 bg-card/80 px-4 py-3">
      <div class="flex items-center gap-2">
        <Button variant="outline" size="icon" class="h-9 w-9" @click="goBack">
          <Icon icon="lucide:arrow-left" class="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" class="h-9 w-9" @click="goForward">
          <Icon icon="lucide:arrow-right" class="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" class="h-9 w-9" @click="reloadPage">
          <Icon icon="lucide:refresh-ccw" class="h-4 w-4" />
        </Button>
        <form class="flex flex-1 items-center gap-2" @submit.prevent="navigate">
          <Input
            v-model="urlInput"
            type="text"
            class="w-full text-sm"
            placeholder="Enter a URL to browse"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
          />
        </form>
        <Button variant="secondary" class="h-9 px-3" @click="openTab">
          <Icon icon="lucide:plus" class="mr-1 h-4 w-4" />
          New Tab
        </Button>
        <Button variant="default" class="h-9 px-3" @click="navigate"> Go </Button>
      </div>
      <div class="flex items-center gap-2 overflow-x-auto">
        <button
          v-for="tab in yoBrowserStore.tabs"
          :key="tab.id"
          class="flex items-center gap-2 rounded-md border border-border/70 px-3 py-1 text-xs transition-colors"
          :class="
            tab.id === yoBrowserStore.activeTabId ? 'bg-primary/10 text-primary' : 'bg-card/60'
          "
          @click="activateTab(tab.id)"
        >
          <span class="truncate max-w-[220px]">{{ tab.title || tab.url || 'about:blank' }}</span>
          <Icon
            icon="lucide:x"
            class="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
            @click.stop="closeTab(tab.id)"
          />
        </button>
        <span v-if="yoBrowserStore.tabs.length === 0" class="text-xs text-muted-foreground">
          No tabs open. Use "New Tab" or enter a URL to start browsing.
        </span>
      </div>
    </header>
    <main
      class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
    >
      <Icon icon="lucide:globe-2" class="h-10 w-10 text-muted-foreground" />
      <p class="text-base font-medium text-foreground">Yo Browser is ready</p>
      <p class="max-w-xl text-center text-xs text-muted-foreground">
        Tabs are rendered in the dedicated Yo Browser window. Use this panel to open URLs, switch
        tabs, or close them. The active tab will stay in sync with the window.
      </p>
      <Button variant="ghost" size="sm" @click="refreshState">
        <Icon icon="lucide:refresh-ccw" class="mr-1 h-4 w-4" />
        Refresh Tabs
      </Button>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Icon } from '@iconify/vue'
import { useYoBrowserStore } from '@/stores/yoBrowser'
import { usePresenter } from '@/composables/usePresenter'

const yoBrowserStore = useYoBrowserStore()
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')

const activeTab = computed(
  () =>
    yoBrowserStore.tabs.find((tab) => tab.id === yoBrowserStore.activeTabId) ??
    yoBrowserStore.tabs[0] ??
    null
)

const urlInput = ref('')

watch(
  () => activeTab.value?.url,
  (url) => {
    if (url !== undefined) {
      urlInput.value = url === 'about:blank' ? '' : url
    }
  },
  { immediate: true }
)

const ensureTab = async () => {
  await yoBrowserPresenter.ensureWindow?.()
  if (!activeTab.value) {
    const tab = await yoBrowserPresenter.createTab()
    if (tab?.id) {
      yoBrowserStore.activeTabId = tab.id
      await yoBrowserStore.loadState()
    }
  }
}

const navigate = async () => {
  const target = urlInput.value.trim()
  await ensureTab()
  const tabId = yoBrowserStore.activeTabId
  if (!tabId || !target) return
  const nextUrl = target.startsWith('http') ? target : `https://${target}`
  await yoBrowserPresenter.navigateTab(tabId, nextUrl)
  await yoBrowserStore.loadState()
}

const openTab = async () => {
  await yoBrowserPresenter.ensureWindow?.()
  const tab = await yoBrowserPresenter.createTab()
  if (tab?.id) {
    yoBrowserStore.activeTabId = tab.id
    await yoBrowserPresenter.activateTab(tab.id)
  }
  await yoBrowserStore.loadState()
}

const activateTab = async (tabId: string) => {
  yoBrowserStore.activeTabId = tabId
  await yoBrowserPresenter.activateTab(tabId)
  await yoBrowserStore.loadState()
}

const closeTab = async (tabId: string) => {
  await yoBrowserPresenter.closeTab(tabId)
  if (yoBrowserStore.activeTabId === tabId) {
    yoBrowserStore.activeTabId = null
  }
  await yoBrowserStore.loadState()
}

const goBack = async () => {
  await ensureTab()
  await yoBrowserPresenter.goBack(yoBrowserStore.activeTabId || undefined)
}

const goForward = async () => {
  await ensureTab()
  await yoBrowserPresenter.goForward(yoBrowserStore.activeTabId || undefined)
}

const reloadPage = async () => {
  await ensureTab()
  await yoBrowserPresenter.reload(yoBrowserStore.activeTabId || undefined)
}

const refreshState = async () => {
  await yoBrowserStore.loadState()
}

onMounted(async () => {
  await yoBrowserStore.loadState()
  await ensureTab()
})
</script>
