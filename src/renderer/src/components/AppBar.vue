<template>
  <div
    class="flex flex-row h-9 min-h-9 relative overflow-hidden"
    :class="[!isFullscreened && isMacOS ? '' : ' rounded-t-none']"
    :dir="langStore.dir"
  >
    <div
      class="h-full shrink-0 w-0 flex-1 flex select-none text-center text-sm font-medium flex-row items-center justify-start window-drag-region"
    >
      <div v-if="!isFullscreened && isMacOS" class="shrink-0 w-20 h-full window-drag-region"></div>
      <div class="flex-1"></div>

      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-card/80 text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        :title="t('common.minimize')"
        @click="minimizeWindow"
      >
        <MinimizeIcon class="h-3! w-3!" />
      </Button>
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-card/80 text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        :title="isMaximized ? t('common.restore') : t('common.maximize')"
        @click="toggleMaximize"
      >
        <MaximizeIcon v-if="!isMaximized" class="h-3! w-3!" />
        <RestoreIcon v-else class="h-3! w-3!" />
      </Button>
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-red-700/80 hover:text-white text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        :title="t('common.close')"
        @click="closeWindow"
      >
        <CloseIcon class="h-3! w-3!" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import MaximizeIcon from './icons/MaximizeIcon.vue'
import RestoreIcon from './icons/RestoreIcon.vue'
import CloseIcon from './icons/CloseIcon.vue'
import MinimizeIcon from './icons/MinimizeIcon.vue'
import { usePresenter } from '@/composables/usePresenter'
import { Button } from '@shadcn/components/ui/button'
import { useLanguageStore } from '@/stores/language'
import { useI18n } from 'vue-i18n'
import { WINDOW_EVENTS } from '@/events'

const langStore = useLanguageStore()
const windowPresenter = usePresenter('windowPresenter')
const devicePresenter = usePresenter('devicePresenter')

const { t } = useI18n()

const isMacOS = ref(false)
const isMaximized = ref(false)
const isFullscreened = ref(false)

const { ipcRenderer } = window.electron

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

onMounted(() => {
  devicePresenter.getDeviceInfo().then((deviceInfo) => {
    isMacOS.value = deviceInfo.platform === 'darwin'
  })
  ipcRenderer?.on(WINDOW_EVENTS.WINDOW_MAXIMIZED, () => {
    isMaximized.value = true
  })
  ipcRenderer?.on(WINDOW_EVENTS.WINDOW_ENTER_FULL_SCREEN, () => {
    isFullscreened.value = true
  })
  ipcRenderer?.on(WINDOW_EVENTS.WINDOW_UNMAXIMIZED, () => {
    isMaximized.value = false
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
</script>

<style scoped>
.window-drag-region {
  -webkit-app-region: drag;
}

.window-no-drag-region {
  -webkit-app-region: no-drag;
}

button {
  -webkit-app-region: no-drag;
}
</style>
