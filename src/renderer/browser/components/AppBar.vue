<template>
  <div
    class="relative box-border flex h-9 min-h-9 items-center overflow-hidden rounded-t-[10px] border border-b-0 border-window-inner-border px-2"
    :class="[
      !isFullscreened && isMacOS ? '' : 'rounded-t-none',
      isMacOS ? 'bg-window-background' : 'bg-window-background/10'
    ]"
    :dir="langStore.dir"
  >
    <div class="absolute bottom-0 left-0 h-px w-full bg-border"></div>
    <div class="flex h-full w-full items-center gap-2 window-drag-region">
      <div v-if="!isFullscreened && isMacOS" class="h-full w-20 shrink-0 window-drag-region"></div>

      <div class="flex min-w-0 flex-1 items-center gap-2 px-1">
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-card/70">
          <Icon icon="lucide:globe" class="h-4 w-4 text-foreground/80" />
        </div>
        <div class="min-w-0">
          <div class="truncate text-sm font-medium text-foreground">
            {{ browserTitle }}
          </div>
          <div class="truncate text-[11px] text-muted-foreground">
            {{ browserSubtitle }}
          </div>
        </div>
      </div>

      <Button
        size="icon"
        class="window-no-drag-region h-8 w-8 shrink-0 bg-transparent shadow-none hover:bg-card/80"
        :title="t('settings.shortcuts.newWindow')"
        @click="openNewWindow"
      >
        <Icon icon="lucide:square-plus" class="h-4 w-4" />
      </Button>

      <Button
        v-if="!isMacOS"
        class="window-no-drag-region h-full w-12 shrink-0 rounded-none bg-transparent text-foreground shadow-none transition-all duration-200 hover:bg-card/80"
        :title="t('common.minimize')"
        @click="minimizeWindow"
      >
        <MinimizeIcon class="h-3! w-3!" />
      </Button>
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region h-full w-12 shrink-0 rounded-none bg-transparent text-foreground shadow-none transition-all duration-200 hover:bg-card/80"
        :title="isMaximized ? t('common.restore') : t('common.maximize')"
        @click="toggleMaximize"
      >
        <MaximizeIcon v-if="!isMaximized" class="h-3! w-3!" />
        <RestoreIcon v-else class="h-3! w-3!" />
      </Button>
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region h-full w-12 shrink-0 rounded-none bg-transparent text-foreground shadow-none transition-all duration-200 hover:bg-red-700/80 hover:text-white"
        :title="t('common.close')"
        @click="closeWindow"
      >
        <CloseIcon class="h-3! w-3!" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useLanguageStore } from '@/stores/language'
import { usePresenter } from '@/composables/usePresenter'
import { WINDOW_EVENTS } from '../lib/events'
import { useBrowserWindowStore } from '../stores/window'
import MinimizeIcon from './icons/MinimizeIcon.vue'
import MaximizeIcon from './icons/MaximizeIcon.vue'
import RestoreIcon from './icons/RestoreIcon.vue'
import CloseIcon from './icons/CloseIcon.vue'

const browserWindowStore = useBrowserWindowStore()
const devicePresenter = usePresenter('devicePresenter')
const windowPresenter = usePresenter('windowPresenter')
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
const langStore = useLanguageStore()
const { t } = useI18n()

const isMacOS = ref(false)
const isMaximized = ref(false)
const isFullscreened = ref(false)

const browserTitle = computed(
  () => browserWindowStore.browserWindow?.page.title || t('common.browser.name')
)
const browserSubtitle = computed(
  () => browserWindowStore.browserWindow?.page.url || t('common.browser.name')
)

const { ipcRenderer } = window.electron

const syncMaximizeState = async () => {
  const windowId = window.api.getWindowId()
  if (windowId != null) {
    isMaximized.value = Boolean(await windowPresenter.isMaximized(windowId))
  }
}

onMounted(() => {
  devicePresenter.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })

  void syncMaximizeState()

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
  ipcRenderer?.removeAllListeners(WINDOW_EVENTS.WINDOW_MAXIMIZED)
  ipcRenderer?.removeAllListeners(WINDOW_EVENTS.WINDOW_UNMAXIMIZED)
  ipcRenderer?.removeAllListeners(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN)
  ipcRenderer?.removeAllListeners(WINDOW_EVENTS.WINDOW_LEAVE_FULL_SCREEN)
})

const openNewWindow = async () => {
  try {
    await yoBrowserPresenter.openWindow('about:blank')
  } catch (error) {
    console.error('Failed to create browser window:', error)
  }
}

const minimizeWindow = () => {
  const id = window.api.getWindowId()
  if (id != null) {
    windowPresenter.minimize(id)
  }
}

const toggleMaximize = () => {
  const id = window.api.getWindowId()
  if (id != null) {
    windowPresenter.maximize(id)
  }
}

const closeWindow = () => {
  const id = window.api.getWindowId()
  if (id != null) {
    windowPresenter.close(id)
  }
}
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

.window-no-drag-region {
  -webkit-app-region: no-drag;
}
</style>
