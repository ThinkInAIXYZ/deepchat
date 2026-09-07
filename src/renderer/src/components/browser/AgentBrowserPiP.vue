<template>
  <div ref="hostRef" class="pointer-events-none absolute inset-0 z-30">
    <div
      v-if="showRendererPip"
      ref="pipRef"
      class="group pointer-events-auto absolute touch-none select-none overflow-hidden border bg-background shadow-2xl"
      :class="[
        compact
          ? 'h-10 rounded-full'
          : 'aspect-[16/10] cursor-grab rounded-xl active:cursor-grabbing',
        activityCount > 0 ? 'agent-browser-pip-active' : ''
      ]"
      :style="placementStyle"
      data-testid="agent-browser-pip"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="cancelDrag"
    >
      <template v-if="compact">
        <div class="flex h-10 items-center gap-2 px-2">
          <Icon icon="lucide:bot" class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate text-xs font-medium">
            {{ t('common.browser.name') }}
          </span>
          <DcButton
            data-pip-control
            variant="ghost"
            size="icon"
            class="size-7 shrink-0"
            :aria-label="t('common.open')"
            @pointerdown.stop
            @click="openInPanel"
            :tooltip="t('common.open')"
          >
            <Icon icon="lucide:panel-right-open" class="size-4" />
          </DcButton>
          <DcButton
            data-pip-control
            variant="ghost"
            size="icon"
            class="size-7 shrink-0"
            :aria-label="t('common.close')"
            @pointerdown.stop
            @click="dismiss"
            :tooltip="t('common.close')"
          >
            <Icon icon="lucide:x" class="size-4" />
          </DcButton>
        </div>
      </template>

      <template v-else>
        <canvas
          ref="canvasRef"
          class="pointer-events-none absolute inset-0 size-full bg-muted"
          :aria-label="title"
          role="img"
        />
        <div
          v-if="!hasFrame"
          class="pointer-events-none absolute inset-0 grid place-items-center bg-muted"
          data-testid="agent-browser-pip-placeholder"
        >
          <Icon icon="lucide:bot" class="size-7 text-muted-foreground" />
        </div>
        <div
          class="absolute inset-x-0 top-0 flex h-11 items-center gap-2 bg-gradient-to-b from-black/75 to-black/20 px-2 text-white transition-opacity motion-reduce:transition-none"
          :class="
            toolbarVisible
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
          "
          data-testid="agent-browser-pip-toolbar"
        >
          <Icon icon="lucide:bot" class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ title }}</span>
          <DcButton
            data-pip-control
            variant="ghost"
            size="icon"
            class="size-7 shrink-0 text-white hover:bg-white/20 hover:text-white"
            :aria-label="t('common.open')"
            @pointerdown.stop
            @click="openInPanel"
            :tooltip="t('common.open')"
          >
            <Icon icon="lucide:panel-right-open" class="size-4" />
          </DcButton>
          <DcButton
            data-pip-control
            variant="ghost"
            size="icon"
            class="size-7 shrink-0 text-white hover:bg-white/20 hover:text-white"
            :aria-label="t('common.close')"
            @pointerdown.stop
            @click="dismiss"
            :tooltip="t('common.close')"
          >
            <Icon icon="lucide:x" class="size-4" />
          </DcButton>
        </div>
        <div
          class="pointer-events-none absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 p-2.5 text-white shadow-lg backdrop-blur-sm transition-opacity motion-reduce:transition-none"
          :class="
            toolbarVisible
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          "
          data-testid="agent-browser-pip-drag-hint"
          aria-hidden="true"
        >
          <Icon icon="lucide:move" class="size-5" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { createBrowserClient } from '@api/BrowserClient'
import { createWindowClient } from '@api/WindowClient'
import { browserPreviewFrameEvent, type DeepchatEventPayload } from '@shared/contracts/events'
import type {
  BrowserPreviewSurface,
  YoBrowserActivityPayload,
  YoBrowserStatus
} from '@shared/types/browser'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useSessionStore } from '@/stores/ui/session'

const props = defineProps<{ sessionId: string | null }>()
const PIP_WIDTH = 400
const PIP_HEIGHT = 250
const { t } = useI18n()
const browserClient = createBrowserClient()
const windowClient = createWindowClient()
const sidepanelStore = useSidepanelStore()
const sessionStore = useSessionStore()
const hostRef = ref<HTMLElement | null>(null)
const pipRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const status = ref<YoBrowserStatus | null>(null)
const statusSessionId = ref('')
const currentWindowId = ref<number | null>(null)
const windowFocused = ref(false)
const dismissedRunId = ref('')
const previewSurface = ref<BrowserPreviewSurface>('none')
const toolbarVisible = ref(false)
const hasFrame = ref(false)
const hostWidth = ref(0)
const hostHeight = ref(0)
const position = ref({ x: 16, y: 16 })
const hasPosition = ref(false)
const activityIds = ref(new Set<string>())
let latestFrameSequence = -1
let frameDecodeVersion = 0
let windowStateVersion = 0
let previewSyncActive = false
let pendingPreviewRequest:
  | {
      sessionId: string
      mode: 'capturing' | 'rendering' | 'stopped'
      runId?: string
    }
  | undefined
let stopOpenRequested: (() => void) | null = null
let stopStatusChanged: (() => void) | null = null
let stopActivityChanged: (() => void) | null = null
let stopPreviewFrame: (() => void) | null = null
let stopPreviewAction: (() => void) | null = null
let stopPreviewSurfaceChanged: (() => void) | null = null
let stopWindowStateChanged: (() => void) | null = null
let dragState:
  | {
      pointerId: number
      pointerStart: { x: number; y: number }
      positionStart: { x: number; y: number }
      moved: boolean
    }
  | undefined

const currentSessionId = computed(() => props.sessionId?.trim() ?? '')
const currentRunId = computed(() =>
  statusSessionId.value === currentSessionId.value ? (status.value?.agentRunId ?? '') : ''
)
const currentPageId = computed(() =>
  statusSessionId.value === currentSessionId.value ? (status.value?.page?.id ?? '') : ''
)
const sessionWorking = computed(
  () =>
    sessionStore.sessions.find((session) => session.id === currentSessionId.value)?.status ===
    'working'
)
const compact = computed(
  () => hostWidth.value < PIP_WIDTH + 80 || hostHeight.value < PIP_HEIGHT + 80
)
const requiresRendering = computed(
  () =>
    Boolean(currentSessionId.value) &&
    sessionWorking.value &&
    statusSessionId.value === currentSessionId.value &&
    status.value?.initialized === true &&
    status.value.owner === 'agent' &&
    Boolean(status.value.page) &&
    Boolean(currentRunId.value)
)
const eligible = computed(
  () =>
    requiresRendering.value &&
    windowFocused.value &&
    !sidepanelStore.open &&
    dismissedRunId.value !== currentRunId.value
)
const showRendererPip = computed(() => eligible.value && previewSurface.value === 'renderer-canvas')
const previewMode = computed<'capturing' | 'rendering' | 'stopped'>(() => {
  if (!requiresRendering.value) {
    return 'stopped'
  }
  if (sidepanelStore.open || status.value?.visible || !eligible.value) {
    return 'rendering'
  }
  if (!compact.value || previewSurface.value !== 'renderer-canvas') {
    return 'capturing'
  }
  return 'rendering'
})
const activityCount = computed(() => activityIds.value.size)
const title = computed(
  () => status.value?.page?.title || status.value?.page?.url || t('common.browser.name')
)
const placementStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  width: compact.value ? 'min(320px, calc(100% - 32px))' : `${PIP_WIDTH}px`,
  height: compact.value ? '40px' : `${PIP_HEIGHT}px`
}))

const updateHostSize = () => {
  const rect = hostRef.value?.getBoundingClientRect()
  if (!rect) return
  hostWidth.value = rect.width
  hostHeight.value = rect.height
}

const clampPosition = (x: number, y: number) => {
  const width = compact.value ? Math.min(320, Math.max(0, hostWidth.value - 32)) : PIP_WIDTH
  const height = compact.value ? 40 : PIP_HEIGHT
  return {
    x: Math.max(8, Math.min(x, Math.max(8, hostWidth.value - width - 8))),
    y: Math.max(8, Math.min(y, Math.max(8, hostHeight.value - height - 8)))
  }
}

const placeAtDefault = () => {
  position.value = clampPosition(
    hostWidth.value - PIP_WIDTH - 16,
    hostHeight.value - PIP_HEIGHT - 16
  )
  hasPosition.value = true
}

const loadStatus = async () => {
  const sessionId = currentSessionId.value
  if (!sessionId) {
    status.value = null
    statusSessionId.value = ''
    return
  }
  const nextStatus = await browserClient.getStatus(sessionId)
  if (sessionId === currentSessionId.value) {
    status.value = nextStatus
    statusSessionId.value = sessionId
  }
}

const dismiss = () => {
  const sessionId = currentSessionId.value
  const runId = currentRunId.value
  if (!sessionId || !runId) return
  dismissedRunId.value = runId
  toolbarVisible.value = false
  void browserClient.dismissPreview(sessionId, runId).catch(() => undefined)
}

const openInPanel = async () => {
  const sessionId = currentSessionId.value
  if (sessionId) {
    await browserClient.setPreviewMode(sessionId, 'rendering', currentRunId.value || undefined)
  }
  sidepanelStore.openBrowser()
}

const isControl = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest('[data-pip-control]'))

const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 0 || isControl(event.target)) return
  event.preventDefault()
  pipRef.value?.setPointerCapture?.(event.pointerId)
  dragState = {
    pointerId: event.pointerId,
    pointerStart: { x: event.clientX, y: event.clientY },
    positionStart: { ...position.value },
    moved: false
  }
}

const onPointerMove = (event: PointerEvent) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return
  const deltaX = event.clientX - dragState.pointerStart.x
  const deltaY = event.clientY - dragState.pointerStart.y
  if (!dragState.moved && Math.hypot(deltaX, deltaY) < 4) return
  dragState.moved = true
  position.value = clampPosition(
    dragState.positionStart.x + deltaX,
    dragState.positionStart.y + deltaY
  )
}

const onPointerUp = (event: PointerEvent) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return
  const moved = dragState.moved
  pipRef.value?.releasePointerCapture?.(event.pointerId)
  dragState = undefined
  if (!moved && !compact.value) {
    toolbarVisible.value = !toolbarVisible.value
  }
}

const cancelDrag = (event?: PointerEvent) => {
  if (event && dragState?.pointerId === event.pointerId) {
    pipRef.value?.releasePointerCapture?.(event.pointerId)
  }
  dragState = undefined
}

const drawPreviewFrame = async (
  payload: DeepchatEventPayload<typeof browserPreviewFrameEvent.name>
) => {
  if (
    payload.sessionId !== currentSessionId.value ||
    payload.runId !== currentRunId.value ||
    payload.sequence <= latestFrameSequence ||
    !eligible.value ||
    compact.value ||
    previewSurface.value !== 'renderer-canvas'
  ) {
    return
  }

  const decodeVersion = ++frameDecodeVersion
  let bitmap: ImageBitmap
  try {
    const bytes = Uint8Array.from(payload.data)
    bitmap = await createImageBitmap(new Blob([bytes.buffer], { type: payload.mimeType }))
  } catch {
    return
  }
  if (
    decodeVersion !== frameDecodeVersion ||
    payload.sessionId !== currentSessionId.value ||
    payload.runId !== currentRunId.value
  ) {
    bitmap.close()
    return
  }

  const canvas = canvasRef.value
  const context = canvas?.getContext('2d')
  if (!canvas || !context) {
    bitmap.close()
    return
  }
  canvas.width = payload.width
  canvas.height = payload.height
  context.drawImage(bitmap, 0, 0, payload.width, payload.height)
  bitmap.close()
  latestFrameSequence = payload.sequence
  hasFrame.value = true
}

const updateActivity = (payload: YoBrowserActivityPayload) => {
  if (payload.sessionId !== currentSessionId.value) return
  const next = new Set(activityIds.value)
  if (payload.phase === 'started') next.add(payload.id)
  else next.delete(payload.id)
  activityIds.value = next
}

const drainPreviewRequests = () => {
  if (previewSyncActive) return

  previewSyncActive = true
  void (async () => {
    try {
      while (pendingPreviewRequest) {
        const request = pendingPreviewRequest
        pendingPreviewRequest = undefined
        const result = await browserClient.setPreviewMode(
          request.sessionId,
          request.mode,
          request.runId
        )
        if (
          request.sessionId === currentSessionId.value &&
          (request.runId ?? '') === currentRunId.value
        ) {
          previewSurface.value = result.surface
        }
      }
    } finally {
      previewSyncActive = false
      if (pendingPreviewRequest) drainPreviewRequests()
    }
  })()
}

const syncPreviewMode = () => {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  pendingPreviewRequest = {
    sessionId,
    mode: previewMode.value,
    runId: currentRunId.value || undefined
  }
  drainPreviewRequests()
}

useResizeObserver(hostRef, () => {
  updateHostSize()
  position.value = clampPosition(position.value.x, position.value.y)
})

watch(showRendererPip, async (visible) => {
  if (!visible) {
    toolbarVisible.value = false
    return
  }
  await nextTick()
  updateHostSize()
  if (!hasPosition.value) placeAtDefault()
})

watch(compact, () => {
  position.value = clampPosition(position.value.x, position.value.y)
})

watch(
  [previewMode, currentSessionId, currentRunId],
  (_current, previous) => {
    const [, sessionId] = _current
    const [, previousSessionId, previousRunId] = previous
    if (previousSessionId && previousSessionId !== sessionId) {
      void browserClient.setPreviewMode(previousSessionId, 'stopped', previousRunId || undefined)
    }
    syncPreviewMode()
  },
  { immediate: true }
)

watch(currentSessionId, () => {
  previewSurface.value = 'none'
  hasPosition.value = false
  hasFrame.value = false
  frameDecodeVersion += 1
  latestFrameSequence = -1
  dismissedRunId.value = ''
  activityIds.value = new Set()
  void loadStatus()
})

watch([currentRunId, currentPageId], async ([runId], [previousRunId]) => {
  hasPosition.value = false
  hasFrame.value = false
  frameDecodeVersion += 1
  latestFrameSequence = -1
  toolbarVisible.value = false
  activityIds.value = new Set()
  if (runId !== previousRunId) dismissedRunId.value = ''
  await nextTick()
  if (runId === currentRunId.value && eligible.value && !hasPosition.value) {
    updateHostSize()
    placeAtDefault()
  }
})

onMounted(() => {
  updateHostSize()
  stopOpenRequested = browserClient.onOpenRequestedForCurrentWindow((payload) => {
    if (payload.sessionId !== currentSessionId.value || payload.source !== 'agent') return
    if (payload.runId && payload.runId !== currentRunId.value) dismissedRunId.value = ''
    void loadStatus()
  })
  stopStatusChanged = browserClient.onStatusChanged((payload) => {
    if (payload.sessionId !== currentSessionId.value) return
    status.value = payload.status
    statusSessionId.value = payload.sessionId
  })
  stopActivityChanged = browserClient.onActivityChanged(updateActivity)
  stopPreviewFrame = browserClient.onPreviewFrame((payload) => {
    void drawPreviewFrame(payload)
  })
  stopPreviewAction = browserClient.onPreviewAction((payload) => {
    if (
      payload.windowId !== currentWindowId.value ||
      payload.sessionId !== currentSessionId.value ||
      payload.runId !== currentRunId.value
    ) {
      return
    }
    if (payload.action === 'dismiss') {
      void dismiss()
      return
    }
    void openInPanel()
  })
  stopPreviewSurfaceChanged = browserClient.onPreviewSurfaceChanged((payload) => {
    if (
      payload.windowId !== currentWindowId.value ||
      payload.sessionId !== currentSessionId.value ||
      payload.runId !== currentRunId.value
    ) {
      return
    }
    if (payload.surface === 'none') {
      frameDecodeVersion += 1
      latestFrameSequence = -1
      hasFrame.value = false
    }
    previewSurface.value = payload.surface
  })
  stopWindowStateChanged = windowClient.onCurrentStateChanged((payload) => {
    windowStateVersion += 1
    currentWindowId.value = payload.windowId
    windowFocused.value = payload.exists && payload.isFocused
  })
  const initialWindowStateVersion = windowStateVersion
  void windowClient.getCurrentState().then((state) => {
    if (initialWindowStateVersion !== windowStateVersion) return
    currentWindowId.value = state.windowId
    windowFocused.value = state.exists && state.isFocused
  })
  void loadStatus()
})

onBeforeUnmount(() => {
  frameDecodeVersion += 1
  cancelDrag()
  stopOpenRequested?.()
  stopStatusChanged?.()
  stopActivityChanged?.()
  stopPreviewFrame?.()
  stopPreviewAction?.()
  stopPreviewSurfaceChanged?.()
  stopWindowStateChanged?.()
  if (currentSessionId.value) {
    pendingPreviewRequest = {
      sessionId: currentSessionId.value,
      mode: 'stopped',
      runId: currentRunId.value || undefined
    }
    drainPreviewRequests()
  }
})
</script>

<style scoped>
.agent-browser-pip-active {
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--primary) 55%, transparent),
    0 18px 48px rgb(0 0 0 / 0.28);
}
</style>
