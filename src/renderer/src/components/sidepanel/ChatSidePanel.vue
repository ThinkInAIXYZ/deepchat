<template>
  <div
    data-testid="chat-side-panel-shell"
    class="chat-side-panel-shell h-full min-h-0 overflow-hidden"
    :class="[
      isWorkspaceFullscreenActive ? 'absolute inset-0 z-30 w-full' : 'relative shrink-0',
      { 'chat-side-panel-shell--resizing': isResizing }
    ]"
    :style="shellStyle"
    :data-workspace-fullscreen="String(isWorkspaceFullscreenActive)"
  >
    <aside
      v-if="props.sessionId"
      class="chat-side-panel-surface absolute inset-y-0 flex h-full min-h-0 w-full origin-right flex-col bg-background"
      :class="[
        isWorkspaceFullscreenActive ? 'inset-x-0 border shadow-xl' : 'right-0 border-l shadow-lg',
        panelVisible
          ? 'translate-x-0 opacity-100'
          : 'pointer-events-none translate-x-3 opacity-0 shadow-none',
        {
          'chat-side-panel-surface--fullscreen-enter': fullscreenMotionState === 'expanding',
          'chat-side-panel-surface--fullscreen-exit': fullscreenMotionState === 'collapsing'
        }
      ]"
    >
      <button
        v-if="panelVisible && !isWorkspaceFullscreenActive"
        data-testid="chat-side-panel-resize-handle"
        class="absolute inset-y-0 left-0 w-1 -translate-x-1/2 cursor-col-resize"
        type="button"
        @mousedown="startResize"
      ></button>

      <div class="flex h-11 items-center justify-between border-b px-3">
        <div class="flex items-center gap-1 rounded-lg bg-muted p-0.5">
          <button
            class="rounded-md px-2.5 py-1 text-xs transition-colors duration-200 ease-out"
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
            class="rounded-md px-2.5 py-1 text-xs transition-colors duration-200 ease-out"
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
        :is-fullscreen="isWorkspaceFullscreenActive"
        @toggle-fullscreen="toggleWorkspaceFullscreen"
        @insert-file-reference="handleWorkspaceInsertFileReference"
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
import { WORKSPACE_EVENTS } from '@/events'
import { useSidepanelStore } from '@/stores/ui/sidepanel'

const props = defineProps<{
  sessionId: string | null
  workspacePath: string | null
}>()

const { t } = useI18n()
const sidepanelStore = useSidepanelStore()
const browserClient = createBrowserClient()
const PANEL_MOTION_MS = 220
const FULLSCREEN_MOTION_MS = 180
let stopBrowserOpenRequestedListener: (() => void) | null = null
let resizeCleanup: (() => void) | null = null
let pendingResizeWidth: number | null = null
let resizeFrame: number | null = null
let panelMotionTimer: number | null = null
let panelMotionFrame: number | null = null
let fullscreenMotionTimer: number | null = null

const shouldShow = computed(() => sidepanelStore.open && Boolean(props.sessionId))
const layoutWidth = ref(shouldShow.value ? sidepanelStore.width : 0)
const panelVisible = ref(shouldShow.value)
const isResizing = ref(false)
const isWorkspaceFullscreen = ref(false)
const fullscreenMotionState = ref<'expanding' | 'collapsing' | null>(null)

const isWorkspaceFullscreenActive = computed(() => {
  return isWorkspaceFullscreen.value && shouldShow.value && sidepanelStore.activeTab === 'workspace'
})

const shellStyle = computed(() => {
  return {
    width: isWorkspaceFullscreenActive.value ? '100%' : `${layoutWidth.value}px`
  }
})

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

const clearFullscreenMotionHandle = () => {
  if (fullscreenMotionTimer !== null) {
    window.clearTimeout(fullscreenMotionTimer)
    fullscreenMotionTimer = null
  }

  fullscreenMotionState.value = null
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

const resetWorkspaceFullscreen = () => {
  isWorkspaceFullscreen.value = false
  clearFullscreenMotionHandle()
}

const toggleWorkspaceFullscreen = () => {
  if (!shouldShow.value || sidepanelStore.activeTab !== 'workspace') {
    return
  }

  clearFullscreenMotionHandle()
  fullscreenMotionState.value = isWorkspaceFullscreen.value ? 'collapsing' : 'expanding'
  fullscreenMotionTimer = window.setTimeout(() => {
    fullscreenMotionTimer = null
    fullscreenMotionState.value = null
  }, FULLSCREEN_MOTION_MS)
  isWorkspaceFullscreen.value = !isWorkspaceFullscreen.value
}

const handleWorkspaceInsertFileReference = (filePath: string) => {
  const sessionId = props.sessionId?.trim()
  const targetPath = filePath.trim()
  if (!sessionId || !targetPath) {
    return
  }

  window.dispatchEvent(
    new CustomEvent(WORKSPACE_EVENTS.INSERT_REFERENCE_REQUESTED, {
      detail: {
        sessionId,
        filePath: targetPath
      }
    })
  )
}

const startResize = (event: MouseEvent) => {
  event.preventDefault()

  if (isWorkspaceFullscreenActive.value) {
    return
  }

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

  if (!visible) {
    resetWorkspaceFullscreen()
  }

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
  () => sidepanelStore.activeTab,
  (activeTab) => {
    if (activeTab !== 'workspace') {
      resetWorkspaceFullscreen()
    }
  }
)

watch(
  () => props.sessionId,
  (sessionId, previousSessionId) => {
    if (!sessionId || sessionId !== previousSessionId) {
      resetWorkspaceFullscreen()
    }
  }
)

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
  clearFullscreenMotionHandle()
  stopResizeTracking()
  stopBrowserOpenRequestedListener?.()
  stopBrowserOpenRequestedListener = null
})
</script>

<style scoped>
.chat-side-panel-shell {
  contain: layout style paint;
  transition-duration: var(--dc-motion-default);
  transition-property: width;
  transition-timing-function: var(--dc-ease-out-express);
}

.chat-side-panel-surface {
  backface-visibility: hidden;
  transform: translateZ(0);
  transition-duration: var(--dc-motion-default);
  transition-property: transform, opacity, box-shadow, border-radius;
  transition-timing-function: var(--dc-ease-out-express);
  will-change: transform, opacity;
}

.chat-side-panel-surface--fullscreen-enter {
  animation: workspace-panel-fullscreen-enter 180ms var(--dc-ease-out-express);
}

.chat-side-panel-surface--fullscreen-exit {
  animation: workspace-panel-fullscreen-exit 180ms var(--dc-ease-out-express);
}

.chat-side-panel-shell--resizing .chat-side-panel-surface {
  transition: none;
}

.chat-side-panel-shell--resizing {
  transition: none;
}

@keyframes workspace-panel-fullscreen-enter {
  from {
    opacity: 0.94;
    transform: translateZ(0) scale(0.985);
  }

  to {
    opacity: 1;
    transform: translateZ(0) scale(1);
  }
}

@keyframes workspace-panel-fullscreen-exit {
  from {
    opacity: 0.96;
    transform: translateZ(0) scale(1.01);
  }

  to {
    opacity: 1;
    transform: translateZ(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-side-panel-shell {
    transition: none;
  }

  .chat-side-panel-surface {
    transition: none;
  }

  .chat-side-panel-surface--fullscreen-enter,
  .chat-side-panel-surface--fullscreen-exit {
    animation: none;
  }
}
</style>
