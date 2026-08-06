<template>
  <div ref="hostRef" class="pointer-events-none absolute inset-0 z-30">
    <div
      v-if="rendererSurfaceMounted"
      v-show="showRendererPip"
      ref="pipRef"
      class="pointer-events-auto absolute touch-none select-none overflow-hidden rounded-xl border bg-background shadow-2xl"
      :style="placementStyle"
      data-testid="agent-computer-use-pip"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="cancelDrag"
    >
      <canvas
        ref="canvasRef"
        class="pointer-events-none absolute inset-0 size-full"
        aria-hidden="true"
      />
      <DcButton
        data-pip-control
        variant="ghost"
        size="icon"
        class="absolute right-2 top-2 size-7 bg-black/60 text-white hover:bg-black/75 hover:text-white"
        :aria-label="t('common.close')"
        @pointerdown.stop
        @click="dismiss"
        :tooltip="t('common.close')"
      >
        <Icon icon="lucide:x" class="size-4" />
      </DcButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { DcButton } from '@dc-ui/components/button'
import { createComputerUseClient } from '@api/ComputerUseClient'
import { createWindowClient } from '@api/WindowClient'
import type { DeepchatEventPayload } from '@shared/contracts/events'
import { computerUsePreviewFrameEvent } from '@shared/contracts/events'
import type { ComputerUsePreviewMode, ComputerUsePreviewSurface } from '@shared/types/computerUse'
import { useSessionStore } from '@/stores/ui/session'

const props = defineProps<{ sessionId: string | null }>()
const PIP_MAX_WIDTH = 360
const PIP_DEFAULT_RATIO = 480 / 300
const { t } = useI18n()
const computerUseClient = createComputerUseClient()
const windowClient = createWindowClient()
const sessionStore = useSessionStore()
const hostRef = ref<HTMLElement | null>(null)
const pipRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const currentWindowId = ref<number | null>(null)
const windowFocused = ref(false)
const previewSurface = ref<ComputerUsePreviewSurface>('none')
const currentRunId = ref('')
const currentEpoch = ref(-1)
const dismissedRunId = ref('')
const hasFrame = ref(false)
const frameWidth = ref(480)
const frameHeight = ref(300)
const hostWidth = ref(0)
const hostHeight = ref(0)
const position = ref({ x: 16, y: 16 })
const hasPosition = ref(false)
let latestFrameSequence = -1
let frameDecodeVersion = 0
let windowStateVersion = 0
let previewSyncActive = false
let pendingPreviewRequest:
  | {
      sessionId: string
      mode: ComputerUsePreviewMode
    }
  | undefined
let stopPreviewFrame: (() => void) | null = null
let stopPreviewSurfaceChanged: (() => void) | null = null
let stopWindowStateChanged: (() => void) | null = null
let dragState:
  | {
      pointerId: number
      pointerStart: { x: number; y: number }
      positionStart: { x: number; y: number }
    }
  | undefined

const currentSessionId = computed(() => props.sessionId?.trim() ?? '')
const sessionWorking = computed(
  () =>
    sessionStore.sessions.find((session) => session.id === currentSessionId.value)?.status ===
    'working'
)
const previewMode = computed<ComputerUsePreviewMode>(() => {
  if (!currentSessionId.value || !sessionWorking.value) return 'stopped'
  return windowFocused.value ? 'eligible' : 'suspended'
})
const pipSize = computed(() => {
  const maxWidth = Math.max(1, hostWidth.value - 16)
  const width = Math.min(PIP_MAX_WIDTH, maxWidth)
  const ratio =
    frameWidth.value > 0 && frameHeight.value > 0
      ? frameWidth.value / frameHeight.value
      : PIP_DEFAULT_RATIO
  return {
    width,
    height: Math.min(Math.max(1, width / ratio), Math.max(1, hostHeight.value - 16))
  }
})
const showRendererPip = computed(
  () =>
    previewMode.value === 'eligible' &&
    previewSurface.value === 'renderer-canvas' &&
    hasFrame.value &&
    Boolean(currentRunId.value) &&
    dismissedRunId.value !== currentRunId.value
)
const rendererSurfaceMounted = computed(
  () => previewMode.value === 'eligible' && previewSurface.value === 'renderer-canvas'
)
const placementStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  width: `${pipSize.value.width}px`,
  height: `${pipSize.value.height}px`
}))

const updateHostSize = () => {
  const rect = hostRef.value?.getBoundingClientRect()
  if (!rect) return
  hostWidth.value = rect.width
  hostHeight.value = rect.height
}

const clampPosition = (x: number, y: number) => ({
  x: Math.max(8, Math.min(x, Math.max(8, hostWidth.value - pipSize.value.width - 8))),
  y: Math.max(8, Math.min(y, Math.max(8, hostHeight.value - pipSize.value.height - 8)))
})

const placeAtDefault = () => {
  position.value = clampPosition(
    hostWidth.value - pipSize.value.width - 16,
    hostHeight.value - pipSize.value.height - 16
  )
  hasPosition.value = true
}

const resetFrame = (runId = '', epoch = -1) => {
  const previousRunId = currentRunId.value
  frameDecodeVersion += 1
  latestFrameSequence = -1
  currentRunId.value = runId
  currentEpoch.value = epoch
  if (!runId || previousRunId !== runId) {
    dismissedRunId.value = ''
  }
  hasFrame.value = false
  frameWidth.value = 480
  frameHeight.value = 300
  hasPosition.value = false
  const canvas = canvasRef.value
  if (canvas) {
    canvas.width = 1
    canvas.height = 1
  }
}

const dismiss = () => {
  const sessionId = currentSessionId.value
  const runId = currentRunId.value
  if (!sessionId || !runId) return
  dismissedRunId.value = runId
  void computerUseClient.dismissPreview(sessionId, runId).catch(() => undefined)
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
    positionStart: { ...position.value }
  }
}

const onPointerMove = (event: PointerEvent) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return
  position.value = clampPosition(
    dragState.positionStart.x + event.clientX - dragState.pointerStart.x,
    dragState.positionStart.y + event.clientY - dragState.pointerStart.y
  )
}

const onPointerUp = (event: PointerEvent) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return
  pipRef.value?.releasePointerCapture?.(event.pointerId)
  dragState = undefined
}

const cancelDrag = (event?: PointerEvent) => {
  if (event && dragState?.pointerId === event.pointerId) {
    pipRef.value?.releasePointerCapture?.(event.pointerId)
  }
  dragState = undefined
}

const drawPreviewFrame = async (
  payload: DeepchatEventPayload<typeof computerUsePreviewFrameEvent.name>
) => {
  if (
    payload.sessionId !== currentSessionId.value ||
    payload.sequence <= latestFrameSequence ||
    dismissedRunId.value === payload.runId ||
    payload.runId !== currentRunId.value ||
    payload.epoch !== currentEpoch.value ||
    previewMode.value !== 'eligible' ||
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
    payload.runId !== currentRunId.value ||
    payload.epoch !== currentEpoch.value ||
    previewMode.value !== 'eligible' ||
    previewSurface.value !== 'renderer-canvas'
  ) {
    bitmap.close()
    return
  }

  await nextTick()
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
  frameWidth.value = payload.width
  frameHeight.value = payload.height
  hasFrame.value = true
  await nextTick()
  updateHostSize()
  if (!hasPosition.value) placeAtDefault()
}

const syncPreviewFrameSubscription = () => {
  const shouldSubscribe =
    previewMode.value === 'eligible' && previewSurface.value === 'renderer-canvas'
  if (shouldSubscribe && !stopPreviewFrame) {
    stopPreviewFrame =
      computerUseClient.onPreviewFrame((payload) => {
        void drawPreviewFrame(payload)
      }) ?? null
  } else if (!shouldSubscribe && stopPreviewFrame) {
    stopPreviewFrame()
    stopPreviewFrame = null
  }
}

const drainPreviewRequests = () => {
  if (previewSyncActive) return
  previewSyncActive = true
  void (async () => {
    try {
      while (pendingPreviewRequest) {
        const request = pendingPreviewRequest
        pendingPreviewRequest = undefined
        const result = await computerUseClient.setPreviewMode(request.sessionId, request.mode)
        if (request.sessionId === currentSessionId.value && request.mode === previewMode.value) {
          previewSurface.value = result?.surface ?? 'none'
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
    mode: previewMode.value
  }
  drainPreviewRequests()
}

useResizeObserver(hostRef, () => {
  updateHostSize()
  position.value = clampPosition(position.value.x, position.value.y)
})

watch(
  [previewMode, currentSessionId],
  (current, previous) => {
    const [, sessionId] = current
    const [, previousSessionId] = previous
    if (previousSessionId && previousSessionId !== sessionId) {
      void computerUseClient.setPreviewMode(previousSessionId, 'stopped')
    }
    syncPreviewMode()
  },
  { immediate: true }
)

watch(currentSessionId, () => {
  previewSurface.value = 'none'
  resetFrame()
})

watch(
  [previewMode, previewSurface],
  ([mode, surface], [previousMode, previousSurface]) => {
    syncPreviewFrameSubscription()
    if (
      previousMode === 'eligible' &&
      previousSurface === 'renderer-canvas' &&
      (mode !== 'eligible' || surface !== 'renderer-canvas')
    ) {
      resetFrame(currentRunId.value, currentEpoch.value)
    }
  },
  { flush: 'sync' }
)

watch(showRendererPip, async (visible) => {
  if (!visible) return
  await nextTick()
  updateHostSize()
  if (!hasPosition.value) placeAtDefault()
})

onMounted(() => {
  updateHostSize()
  stopPreviewSurfaceChanged = computerUseClient.onPreviewSurfaceChanged((payload) => {
    if (
      payload.windowId !== currentWindowId.value ||
      payload.sessionId !== currentSessionId.value
    ) {
      return
    }
    if (
      payload.surface !== 'none' &&
      (payload.runId !== currentRunId.value || payload.epoch !== currentEpoch.value)
    ) {
      resetFrame(payload.runId, payload.epoch)
    }
    previewSurface.value = payload.surface
    syncPreviewFrameSubscription()
  })
  stopWindowStateChanged = windowClient.onCurrentStateChanged((payload) => {
    windowStateVersion += 1
    currentWindowId.value = payload.windowId
    windowFocused.value = payload.exists && payload.isFocused
  })
  const initialWindowStateVersion = windowStateVersion
  void windowClient
    .getCurrentState()
    .then((state) => {
      if (!state || initialWindowStateVersion !== windowStateVersion) return
      currentWindowId.value = state.windowId
      windowFocused.value = state.exists && state.isFocused
    })
    .catch(() => undefined)
})

onBeforeUnmount(() => {
  frameDecodeVersion += 1
  cancelDrag()
  stopPreviewFrame?.()
  stopPreviewSurfaceChanged?.()
  stopWindowStateChanged?.()
  if (currentSessionId.value) {
    pendingPreviewRequest = {
      sessionId: currentSessionId.value,
      mode: 'stopped'
    }
    drainPreviewRequests()
  }
})
</script>
