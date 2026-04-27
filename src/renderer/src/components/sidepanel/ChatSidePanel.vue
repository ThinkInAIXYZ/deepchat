<template>
  <div
    class="chat-side-panel-shell relative h-full min-h-0 shrink-0 overflow-hidden"
    :class="{ 'chat-side-panel-shell--resizing': isResizing }"
    :style="{ width: `${layoutWidth}px` }"
  >
    <aside
      v-if="props.sessionId"
      class="chat-side-panel-surface absolute inset-y-0 right-0 flex h-full min-h-0 w-full flex-col border-l bg-background shadow-lg transition-[transform,opacity,box-shadow] duration-[var(--dc-motion-default)] ease-[var(--dc-ease-out-express)]"
      :class="
        panelVisible
          ? 'translate-x-0 opacity-100'
          : 'pointer-events-none translate-x-3 opacity-0 shadow-none'
      "
    >
      <button
        v-if="panelVisible"
        class="absolute inset-y-0 left-0 w-1 -translate-x-1/2 cursor-col-resize"
        type="button"
        @mousedown="startResize"
      ></button>

      <div class="flex h-11 items-center justify-between border-b px-3">
        <div class="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          <button
            class="rounded-md px-2.5 py-1 text-xs transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
            :class="
              sidepanelStore.activeTab === 'workspace'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground'
            "
            type="button"
            @click="sidepanelStore.openWorkspace(props.sessionId)"
          >
            {{ t('chat.workspace.title') }}
          </button>
          <button
            class="rounded-md px-2.5 py-1 text-xs transition-colors duration-[var(--dc-motion-fast)] ease-[var(--dc-ease-out-soft)]"
            :class="
              sidepanelStore.activeTab === 'browser'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground'
            "
            type="button"
            @click="sidepanelStore.openBrowser()"
          >
            {{ t('common.browser.name') }}
          </button>
        </div>

        <Button variant="ghost" size="icon" class="h-7 w-7" @click="sidepanelStore.closePanel()">
          <Icon icon="lucide:x" class="h-4 w-4" />
        </Button>
      </div>

      <WorkspacePanel
        v-if="sidepanelStore.activeTab === 'workspace'"
        :session-id="props.sessionId"
        :workspace-path="props.workspacePath"
      />
      <BrowserPanel v-else :session-id="props.sessionId" />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { createBrowserClient } from '@api/BrowserClient'
import BrowserPanel from './BrowserPanel.vue'
import WorkspacePanel from './WorkspacePanel.vue'
import { useSidepanelStore } from '@/stores/ui/sidepanel'

const props = defineProps<{
  sessionId: string | null
  workspacePath: string | null
}>()

const { t } = useI18n()
const sidepanelStore = useSidepanelStore()
const browserClient = createBrowserClient()
const PANEL_MOTION_MS = 220
let stopBrowserOpenRequestedListener: (() => void) | null = null
let resizeCleanup: (() => void) | null = null
let pendingResizeWidth: number | null = null
let resizeFrame: number | null = null
let panelMotionTimer: number | null = null
let panelMotionFrame: number | null = null

const shouldShow = computed(() => sidepanelStore.open && Boolean(props.sessionId))
const layoutWidth = ref(shouldShow.value ? sidepanelStore.width : 0)
const panelVisible = ref(shouldShow.value)
const isResizing = ref(false)

const handleBrowserOpenRequested = (payload: {
  sessionId: string
  windowId: number
  url: string
  version: number
}) => {
  if (!props.sessionId || payload.sessionId !== props.sessionId) {
    return
  }

  sidepanelStore.openBrowser()
}

const clearPanelMotionHandles = () => {
  if (panelMotionTimer !== null) {
    window.clearTimeout(panelMotionTimer)
    panelMotionTimer = null
  }

  if (panelMotionFrame !== null) {
    window.cancelAnimationFrame(panelMotionFrame)
    panelMotionFrame = null
  }
}

const applyPendingResize = () => {
  resizeFrame = null
  if (pendingResizeWidth === null) {
    return
  }

  sidepanelStore.setWidth(pendingResizeWidth)
  pendingResizeWidth = null
}

const stopResizeTracking = () => {
  resizeCleanup?.()
  resizeCleanup = null

  if (resizeFrame !== null) {
    window.cancelAnimationFrame(resizeFrame)
    resizeFrame = null
  }

  if (pendingResizeWidth !== null) {
    sidepanelStore.setWidth(pendingResizeWidth)
    pendingResizeWidth = null
  }
}

const startResize = (event: MouseEvent) => {
  event.preventDefault()
  stopResizeTracking()
  isResizing.value = true

  const startX = event.clientX
  const startWidth = sidepanelStore.width

  const onMouseMove = (moveEvent: MouseEvent) => {
    pendingResizeWidth = startWidth - (moveEvent.clientX - startX)

    if (resizeFrame === null) {
      resizeFrame = window.requestAnimationFrame(applyPendingResize)
    }
  }

  const onMouseUp = () => {
    isResizing.value = false
    stopResizeTracking()
  }

  window.addEventListener('mousemove', onMouseMove, { passive: true })
  window.addEventListener('mouseup', onMouseUp, { once: true })
  resizeCleanup = () => {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    isResizing.value = false
  }
}

watch(shouldShow, (visible) => {
  clearPanelMotionHandles()
  stopResizeTracking()

  if (visible) {
    layoutWidth.value = sidepanelStore.width
    panelMotionFrame = window.requestAnimationFrame(() => {
      panelMotionFrame = null
      panelVisible.value = true
    })
    return
  }

  panelVisible.value = false
  panelMotionTimer = window.setTimeout(() => {
    panelMotionTimer = null
    if (!shouldShow.value) {
      layoutWidth.value = 0
    }
  }, PANEL_MOTION_MS)
})

watch(
  () => sidepanelStore.width,
  (width) => {
    if (shouldShow.value || layoutWidth.value > 0) {
      layoutWidth.value = width
    }
  }
)

onMounted(() => {
  stopBrowserOpenRequestedListener = browserClient.onOpenRequestedForCurrentWindow(
    handleBrowserOpenRequested
  )
})

onBeforeUnmount(() => {
  clearPanelMotionHandles()
  stopResizeTracking()
  stopBrowserOpenRequestedListener?.()
  stopBrowserOpenRequestedListener = null
})
</script>

<style scoped>
.chat-side-panel-shell {
  contain: layout style paint;
}

.chat-side-panel-surface {
  backface-visibility: hidden;
  transform: translateZ(0);
  will-change: transform, opacity;
}

.chat-side-panel-shell--resizing .chat-side-panel-surface {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .chat-side-panel-surface {
    transition: none;
  }
}
</style>
