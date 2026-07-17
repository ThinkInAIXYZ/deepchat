<template>
  <div ref="hostRef" class="pointer-events-none absolute inset-0 z-30">
    <div
      v-if="eligible"
      class="pointer-events-auto absolute overflow-hidden border bg-background shadow-2xl"
      :class="compact ? 'h-10 rounded-full' : 'rounded-xl'"
      :style="placementStyle"
      data-testid="agent-browser-pip"
    >
      <div
        class="flex h-10 select-none items-center gap-2 border-b bg-muted/80 px-2 backdrop-blur"
        :class="compact ? 'border-b-0' : 'cursor-move'"
        @pointerdown="startDrag"
      >
        <Icon icon="lucide:bot" class="size-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-xs font-medium">
          {{ compact ? t('common.browser.name') : title }}
        </span>
        <Button
          variant="ghost"
          size="icon"
          class="size-7 shrink-0"
          :aria-label="t('common.open')"
          @pointerdown.stop
          @click="openInPanel"
        >
          <Icon icon="lucide:panel-right-open" class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="size-7 shrink-0"
          :aria-label="t('common.close')"
          @pointerdown.stop
          @click="dismiss"
        >
          <Icon icon="lucide:x" class="size-4" />
        </Button>
      </div>
      <div v-if="!compact" ref="contentRef" class="h-[280px] w-[480px] bg-background" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { createBrowserClient } from '@api/BrowserClient'
import type { YoBrowserStatus } from '@shared/types/browser'
import { useSidepanelStore } from '@/stores/ui/sidepanel'
import { useSessionStore } from '@/stores/ui/session'

const props = defineProps<{ sessionId: string | null }>()
const { t } = useI18n()
const browserClient = createBrowserClient()
const sidepanelStore = useSidepanelStore()
const sessionStore = useSessionStore()
const contentRef = ref<HTMLElement | null>(null)
const hostRef = ref<HTMLElement | null>(null)
const status = ref<YoBrowserStatus | null>(null)
const windowFocused = ref(typeof document === 'undefined' ? true : document.hasFocus())
const dismissedRunId = ref('')
const hostWidth = ref(0)
const hostHeight = ref(0)
const position = ref({ x: 16, y: 16 })
const hasPosition = ref(false)
let boundsFrame: number | null = null
let dragCleanup: (() => void) | null = null
let stopOpenRequested: (() => void) | null = null
let stopStatusChanged: (() => void) | null = null

const currentSessionId = computed(() => props.sessionId?.trim() ?? '')
const currentRunId = computed(() => status.value?.agentRunId ?? '')
const sessionWorking = computed(
  () =>
    sessionStore.sessions.find((session) => session.id === currentSessionId.value)?.status ===
    'working'
)
const compact = computed(() => hostWidth.value < 560 || hostHeight.value < 390)
const eligible = computed(
  () =>
    Boolean(currentSessionId.value) &&
    sessionWorking.value &&
    windowFocused.value &&
    !sidepanelStore.open &&
    status.value?.initialized === true &&
    status.value.owner === 'agent' &&
    Boolean(status.value.page) &&
    Boolean(currentRunId.value) &&
    dismissedRunId.value !== currentRunId.value
)
const title = computed(
  () => status.value?.page?.title || status.value?.page?.url || t('common.browser.name')
)
const placementStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  width: compact.value ? 'min(320px, calc(100% - 32px))' : '480px',
  height: compact.value ? '40px' : '320px'
}))

const updateHostSize = () => {
  const rect = hostRef.value?.getBoundingClientRect()
  if (!rect) return
  hostWidth.value = rect.width
  hostHeight.value = rect.height
}

const clampPosition = (x: number, y: number) => {
  const width = compact.value ? Math.min(320, Math.max(0, hostWidth.value - 32)) : 480
  const height = compact.value ? 40 : 320
  return {
    x: Math.max(8, Math.min(x, Math.max(8, hostWidth.value - width - 8))),
    y: Math.max(8, Math.min(y, Math.max(8, hostHeight.value - height - 8)))
  }
}

const placeAtDefault = () => {
  position.value = clampPosition(hostWidth.value - 496, hostHeight.value - 336)
  hasPosition.value = true
}

const hideNativeView = async () => {
  const sessionId = currentSessionId.value
  if (!sessionId) return
  await browserClient.updateCurrentWindowBounds(
    sessionId,
    { x: 0, y: 0, width: 0, height: 0 },
    false
  )
}

const syncNativeView = async () => {
  if (!eligible.value || compact.value || !contentRef.value) {
    await hideNativeView()
    return
  }

  const sessionId = currentSessionId.value
  const attached = await browserClient.attachCurrentWindow(sessionId)
  if (!attached || !eligible.value || compact.value || sessionId !== currentSessionId.value) return
  const rect = contentRef.value.getBoundingClientRect()
  await browserClient.updateCurrentWindowBounds(
    sessionId,
    { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    true
  )
}

const scheduleBoundsSync = () => {
  if (boundsFrame !== null) return
  boundsFrame = window.requestAnimationFrame(() => {
    boundsFrame = null
    void syncNativeView()
  })
}

const loadStatus = async () => {
  const sessionId = currentSessionId.value
  if (!sessionId) {
    status.value = null
    return
  }
  const nextStatus = await browserClient.getStatus(sessionId)
  if (sessionId === currentSessionId.value) status.value = nextStatus
}

const dismiss = () => {
  dismissedRunId.value = currentRunId.value
  void hideNativeView()
}

const openInPanel = async () => {
  await hideNativeView()
  sidepanelStore.openBrowser()
}

const startDrag = (event: PointerEvent) => {
  if (compact.value || event.button !== 0) return
  event.preventDefault()
  const pointerStart = { x: event.clientX, y: event.clientY }
  const positionStart = { ...position.value }

  const onMove = (moveEvent: PointerEvent) => {
    position.value = clampPosition(
      positionStart.x + moveEvent.clientX - pointerStart.x,
      positionStart.y + moveEvent.clientY - pointerStart.y
    )
    scheduleBoundsSync()
  }
  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', stop)
    dragCleanup = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', stop, { once: true })
  dragCleanup = stop
}

useEventListener(window, 'focus', () => {
  windowFocused.value = true
})
useEventListener(window, 'blur', () => {
  windowFocused.value = false
})
useResizeObserver(hostRef, () => {
  updateHostSize()
  position.value = clampPosition(position.value.x, position.value.y)
  scheduleBoundsSync()
})
useResizeObserver(contentRef, scheduleBoundsSync)

watch(eligible, async (visible) => {
  if (!visible) {
    await hideNativeView()
    return
  }
  await nextTick()
  updateHostSize()
  if (!hasPosition.value) placeAtDefault()
  await nextTick()
  await syncNativeView()
})

watch(compact, async () => {
  position.value = clampPosition(position.value.x, position.value.y)
  await nextTick()
  await syncNativeView()
})

watch(currentSessionId, () => {
  hasPosition.value = false
  dismissedRunId.value = ''
  void loadStatus()
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
  })
  void loadStatus()
})

onBeforeUnmount(() => {
  if (boundsFrame !== null) window.cancelAnimationFrame(boundsFrame)
  dragCleanup?.()
  stopOpenRequested?.()
  stopStatusChanged?.()
  void hideNativeView()
})
</script>
