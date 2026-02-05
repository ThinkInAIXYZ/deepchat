<template>
  <div class="flex flex-row h-9 min-h-9 relative overflow-hidden" :dir="langStore.dir">
    <div
      class="h-full shrink-0 w-0 flex-1 flex select-none text-center text-sm font-medium flex-row items-center justify-start window-drag-region"
    >
      <div v-if="!isFullscreened && isMacOS" class="shrink-0 w-20 h-full window-drag-region"></div>

      <!-- Spacer to push buttons to the right -->
      <div class="flex-1 window-drag-region"></div>

      <!-- Browser button -->
      <Button
        size="icon"
        class="window-no-drag-region shrink-0 w-10 bg-transparent shadow-none rounded-none hover:bg-card/80 text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        @click="onBrowserClick"
        @mouseenter="onOverlayMouseEnter('browser', t('common.browser.name'), $event)"
        @mouseleave="onOverlayMouseLeave('browser')"
      >
        <Icon icon="lucide:compass" class="w-4 h-4" />
      </Button>

      <!-- History button -->
      <Button
        size="icon"
        class="window-no-drag-region shrink-0 w-10 bg-transparent shadow-none rounded-none hover:bg-card/80 text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        @click="onHistoryClick"
        @mouseenter="onOverlayMouseEnter('history', t('common.history'), $event)"
        @mouseleave="onOverlayMouseLeave('history')"
      >
        <Icon icon="lucide:history" class="w-4 h-4" />
      </Button>

      <!-- Settings button -->
      <Button
        size="icon"
        class="window-no-drag-region shrink-0 w-10 bg-transparent shadow-none rounded-none hover:bg-card/80 text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        @click="openSettings"
        @mouseenter="onOverlayMouseEnter('settings', t('routes.settings'), $event)"
        @mouseleave="onOverlayMouseLeave('settings')"
      >
        <Icon icon="lucide:ellipsis" class="w-4 h-4" />
      </Button>

      <!-- Window controls (non-macOS only) -->
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-card/80 text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        @click="minimizeWindow"
        @mouseenter="onOverlayMouseEnter('minimize', t('common.minimize'), $event)"
        @mouseleave="onOverlayMouseLeave('minimize')"
      >
        <MinimizeIcon class="h-3! w-3!" />
      </Button>
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-card/80 text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        @click="toggleMaximize"
        @mouseenter="
          onOverlayMouseEnter(
            'toggle-maximize',
            isMaximized ? t('common.restore') : t('common.maximize'),
            $event
          )
        "
        @mouseleave="onOverlayMouseLeave('toggle-maximize')"
      >
        <MaximizeIcon v-if="!isMaximized" class="h-3! w-3!" />
        <RestoreIcon v-else class="h-3! w-3!" />
      </Button>
      <Button
        v-if="!isMacOS"
        class="window-no-drag-region shrink-0 w-12 bg-transparent shadow-none rounded-none hover:bg-red-700/80 hover:text-white text-xs font-medium text-foreground flex items-center justify-center transition-all duration-200 group"
        @click="closeWindow"
        @mouseenter="onOverlayMouseEnter('close-window', t('common.close'), $event)"
        @mouseleave="onOverlayMouseLeave('close-window')"
      >
        <CloseIcon class="h-3! w-3!" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import MaximizeIcon from './icons/MaximizeIcon.vue'
import RestoreIcon from './icons/RestoreIcon.vue'
import CloseIcon from './icons/CloseIcon.vue'
import MinimizeIcon from './icons/MinimizeIcon.vue'
import { usePresenter } from '@/composables/usePresenter'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'
import { useLanguageStore } from '@/stores/language'
import { useWindowStore } from '@/stores/windowStore'
import { useI18n } from 'vue-i18n'
import { useLayoutStore } from '@/stores/layoutStore'

const langStore = useLanguageStore()
const windowPresenter = usePresenter('windowPresenter')
const yoBrowserPresenter = usePresenter('yoBrowserPresenter')
const layoutStore = useLayoutStore()
const windowStore = useWindowStore()
const { isMacOS, isMaximized, isFullscreened } = storeToRefs(windowStore)

const { t } = useI18n()

const { ipcRenderer } = window.electron

type TooltipHoverTarget = { key: string; text: string; el: HTMLElement }

const hoveredTarget = ref<TooltipHoverTarget | null>(null)
const isTooltipOpen = ref(false)
let tooltipTimer: number | null = null

const sendTooltipShow = (el: HTMLElement, text: string) => {
  const rect = el.getBoundingClientRect()
  ipcRenderer.send('shell-tooltip:show', {
    x: rect.left + rect.width / 2,
    y: rect.bottom + 8,
    text
  })
}

const hideTooltip = () => {
  isTooltipOpen.value = false
  ipcRenderer.send('shell-tooltip:hide')
}

const updateTooltipPosition = () => {
  if (!isTooltipOpen.value) return
  const current = hoveredTarget.value
  if (!current) return
  sendTooltipShow(current.el, current.text)
}

const onOverlayMouseEnter = (key: string, text: string, event: MouseEvent) => {
  if (tooltipTimer != null) window.clearTimeout(tooltipTimer)

  const el = event.currentTarget as HTMLElement | null
  if (!el) return

  hoveredTarget.value = { key, el, text }

  tooltipTimer = window.setTimeout(() => {
    if (!hoveredTarget.value || hoveredTarget.value.key !== key) return
    isTooltipOpen.value = true
    updateTooltipPosition()
  }, 200)
}

const onOverlayMouseLeave = (key: string) => {
  if (tooltipTimer != null) {
    window.clearTimeout(tooltipTimer)
    tooltipTimer = null
  }

  if (hoveredTarget.value && hoveredTarget.value.key === key) {
    hoveredTarget.value = null
    hideTooltip()
  }
}

const onHistoryClick = () => {
  layoutStore.toggleThreadSidebar()
}

onMounted(() => {
  window.addEventListener('resize', updateTooltipPosition)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateTooltipPosition)
  hideTooltip()
  if (tooltipTimer != null) {
    window.clearTimeout(tooltipTimer)
    tooltipTimer = null
  }
})

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

const openSettings = () => {
  windowPresenter.openOrFocusSettingsWindow()
}

const onBrowserClick = async () => {
  try {
    await yoBrowserPresenter.show(true)
  } catch (error) {
    console.warn('Failed to open browser window.', error)
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

button {
  -webkit-app-region: no-drag;
}
</style>
