<template>
  <div
    data-testid="chat-side-panel-shell"
    class="chat-side-panel-shell h-full min-h-0 overflow-hidden"
    :class="[
      isSidepanelFullscreenActive ? 'absolute inset-0 w-full' : 'relative shrink-0',
      { 'chat-side-panel-shell--resizing': isResizing }
    ]"
    :style="shellStyle"
    :data-workspace-fullscreen="String(isWorkspaceFullscreenActive)"
    :data-browser-fullscreen="String(isBrowserFullscreenActive)"
  >
    <aside
      v-if="props.sessionId"
      class="chat-side-panel-surface absolute inset-y-0 flex h-full min-h-0 w-full origin-right flex-col bg-background"
      :class="[
        isSidepanelFullscreenActive ? 'inset-x-0 border shadow-xl' : 'right-0 border-l shadow-lg',
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
        v-if="panelVisible && !isSidepanelFullscreenActive"
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
          <button
            v-if="sidepanelStore.mcpAppPreviewOwnerId"
            data-testid="mcp-app-sidepanel-tab"
            class="rounded-md px-2.5 py-1 text-xs transition-colors duration-200 ease-out"
            :class="
              sidepanelStore.activeTab === 'mcp-app'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground'
            "
            type="button"
            @click="sidepanelStore.openMcpAppPreview(sidepanelStore.mcpAppPreviewOwnerId)"
          >
            {{ t('mcp.apps.title') }}
          </button>
        </div>

        <DcButton
          variant="ghost"
          size="icon"
          icon="lucide:x"
          :label="t('common.close')"
          :tooltip="t('common.close')"
          class="h-7 w-7"
          @click="sidepanelStore.closePanel()"
        />
      </div>

      <Transition
        name="panel-content"
        mode="out-in"
        @before-leave="panelContentLeaving = true"
        @after-leave="panelContentLeaving = false"
        @leave-cancelled="panelContentLeaving = false"
      >
        <WorkspacePanel
          v-if="sidepanelStore.activeTab === 'workspace'"
          :session-id="props.sessionId"
          :workspace-path="props.workspacePath"
          :is-fullscreen="isWorkspaceFullscreenActive"
          @toggle-fullscreen="toggleWorkspaceFullscreen"
          @insert-file-reference="handleWorkspaceInsertFileReference"
        />
        <BrowserPanel
          v-else-if="sidepanelStore.activeTab === 'browser'"
          :session-id="props.sessionId"
          :is-fullscreen="isBrowserFullscreenActive"
          @toggle-fullscreen="toggleBrowserFullscreen"
        />
      </Transition>
      <div
        v-show="sidepanelStore.activeTab === 'mcp-app' && !panelContentLeaving"
        id="mcp-app-sidepanel-outlet"
        data-testid="mcp-app-sidepanel-outlet"
        class="min-h-0 flex-1"
      />
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
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
const panelContentLeaving = ref(false)
const isWorkspaceFullscreen = ref(false)
const isBrowserFullscreen = ref(false)
const fullscreenMotionState = ref<'expanding' | 'collapsing' | null>(null)

const isWorkspaceFullscreenActive = computed(() => {
  return isWorkspaceFullscreen.value && shouldShow.value && sidepanelStore.activeTab === 'workspace'
})
const isBrowserFullscreenActive = computed(() => {
  return isBrowserFullscreen.value && shouldShow.value && sidepanelStore.activeTab === 'browser'
})
const isSidepanelFullscreenActive = computed(
  () => isWorkspaceFullscreenActive.value || isBrowserFullscreenActive.value
)

const shellStyle = computed(() => {
  return {
    width: isSidepanelFullscreenActive.value ? '100%' : `${layoutWidth.value}px`,
    ...(isSidepanelFullscreenActive.value ? { zIndex: 'var(--dc-z-sidepanel)' } : {})
  }
})

const handleBrowserOpenRequested = (payload: {
  sessionId: string
  windowId: number
  url: string
  source: 'agent' | 'user'
  runId?: string
  version: number
}) => {
  if (!props.sessionId || payload.sessionId !== props.sessionId) {
    return
  }

  if (payload.source !== 'agent' || sidepanelStore.open) {
    sidepanelStore.openBrowser()
  }
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

const resetBrowserFullscreen = () => {
  isBrowserFullscreen.value = false
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

const toggleBrowserFullscreen = () => {
  if (!shouldShow.value || sidepanelStore.activeTab !== 'browser') {
    return
  }

  clearFullscreenMotionHandle()
  fullscreenMotionState.value = isBrowserFullscreen.value ? 'collapsing' : 'expanding'
  fullscreenMotionTimer = window.setTimeout(() => {
    fullscreenMotionTimer = null
    fullscreenMotionState.value = null
  }, FULLSCREEN_MOTION_MS)
  isBrowserFullscreen.value = !isBrowserFullscreen.value
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

  if (isSidepanelFullscreenActive.value) {
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
    resetBrowserFullscreen()
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
    if (activeTab !== 'browser') {
      resetBrowserFullscreen()
    }
  }
)

watch(
  () => props.sessionId,
  (sessionId, previousSessionId) => {
    if (!sessionId || sessionId !== previousSessionId) {
      resetWorkspaceFullscreen()
      resetBrowserFullscreen()
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
}

.chat-side-panel-surface {
  backface-visibility: hidden;
  transform: translateZ(0);
  transition-duration: var(--dc-motion-default);
  transition-property: transform, opacity;
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

.panel-content-enter-active,
.panel-content-leave-active {
  transition: opacity var(--dc-motion-fast) var(--dc-ease-out-soft);
}

.panel-content-enter-from,
.panel-content-leave-to {
  opacity: 0;
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
    opacity: 1;
    transform: translateZ(0) scale(1);
  }

  to {
    opacity: 0.94;
    transform: translateZ(0) scale(0.985);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-side-panel-surface {
    transition: none;
  }

  .panel-content-enter-active,
  .panel-content-leave-active {
    transition: none;
  }

  .chat-side-panel-surface--fullscreen-enter,
  .chat-side-panel-surface--fullscreen-exit {
    animation: none;
  }
}
</style>
