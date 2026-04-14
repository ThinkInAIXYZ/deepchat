<template>
  <div>
    <div
      v-if="isOpen"
      ref="popupRef"
      class="translate-popup fixed left-0 top-0 z-50 w-[500px] rounded-lg border bg-background shadow-lg"
      :style="popupStyle"
      data-translate-popup="true"
    >
      <div
        class="translate-popup__header flex cursor-move items-center justify-between border-b p-4"
        data-translate-popup-header="true"
        @pointerdown="startDrag"
      >
        <h3 class="text-lg font-semibold">{{ t('contextMenu.translate.title') }}</h3>
        <Button variant="ghost" size="icon" @click="close">
          <Icon icon="lucide:x" class="h-4 w-4" />
        </Button>
      </div>
      <div class="p-4">
        <div class="mb-4">
          <div class="p-2 bg-muted text-muted-foreground">{{ text }}</div>
        </div>
        <div class="h-px bg-border my-2"></div>
        <div>
          <div
            v-if="isTranslating"
            class="flex items-center gap-2 p-2 bg-muted text-sm text-muted-foreground"
          >
            <Icon icon="lucide:loader-2" class="animate-spin w-4 h-4" />
            <span>{{ t('common.loading') }}</span>
          </div>
          <div v-else class="p-2 bg-muted text-sm">{{ translatedText }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePresenter } from '@/composables/usePresenter'
import { useAgentStore } from '@/stores/ui/agent'
import { Button } from '@shadcn/components/ui/button'
import { Icon } from '@iconify/vue'

const { t, locale } = useI18n()
const agentSessionPresenter = usePresenter('agentSessionPresenter')
const agentStore = useAgentStore()

const isOpen = ref(false)
const text = ref('')
const translatedText = ref('')
const isTranslating = ref(false)
const popupRef = ref<HTMLElement | null>(null)

const position = ref({ x: 100, y: 100 })

const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const dragBounds = {
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0
}
let dragFrameId: number | null = null
let pendingDragPosition: { x: number; y: number } | null = null

const POPUP_WIDTH = 500
const POPUP_HEIGHT = 220
const VISIBLE_EDGE = 40
const DRAG_EXCLUDED_SELECTOR = 'button, a, input, textarea, select, [role="button"]'

const popupStyle = computed(() => ({
  transform: `translate3d(${position.value.x}px, ${position.value.y}px, 0)`
}))

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const getPopupRect = () => popupRef.value?.getBoundingClientRect()

const getBounds = () => {
  const rect = getPopupRect()
  const width = rect?.width || POPUP_WIDTH
  const height = rect?.height || POPUP_HEIGHT

  return {
    minX: -(width - VISIBLE_EDGE),
    maxX: window.innerWidth - VISIBLE_EDGE,
    minY: -(height - VISIBLE_EDGE),
    maxY: window.innerHeight - VISIBLE_EDGE
  }
}

const applyPosition = (x: number, y: number, bounds = getBounds()) => {
  position.value = {
    x: clamp(x, bounds.minX, bounds.maxX),
    y: clamp(y, bounds.minY, bounds.maxY)
  }
}

const flushPendingDragPosition = () => {
  dragFrameId = null

  if (!pendingDragPosition) {
    return
  }

  const nextPosition = pendingDragPosition
  pendingDragPosition = null
  position.value = nextPosition
}

const scheduleDragPosition = (x: number, y: number) => {
  pendingDragPosition = { x, y }

  if (dragFrameId !== null) {
    return
  }

  dragFrameId = window.requestAnimationFrame(flushPendingDragPosition)
}

const removeDragListeners = () => {
  window.removeEventListener('pointermove', handleDrag)
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
}

const addDragListeners = () => {
  window.addEventListener('pointermove', handleDrag, { passive: true })
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}

const startDrag = (event: PointerEvent) => {
  if (event.button !== 0) {
    return
  }

  const target = event.target as HTMLElement | null
  if (target?.closest(DRAG_EXCLUDED_SELECTOR)) {
    return
  }

  event.preventDefault()
  const bounds = getBounds()

  dragBounds.minX = bounds.minX
  dragBounds.maxX = bounds.maxX
  dragBounds.minY = bounds.minY
  dragBounds.maxY = bounds.maxY

  isDragging.value = true
  dragStart.value = {
    x: event.clientX - position.value.x,
    y: event.clientY - position.value.y
  }
  addDragListeners()
}

const handleDrag = (event: MouseEvent) => {
  if (!isDragging.value) return

  const newX = clamp(event.clientX - dragStart.value.x, dragBounds.minX, dragBounds.maxX)
  const newY = clamp(event.clientY - dragStart.value.y, dragBounds.minY, dragBounds.maxY)
  scheduleDragPosition(newX, newY)
}

const stopDrag = () => {
  if (!isDragging.value && dragFrameId === null && !pendingDragPosition) {
    return
  }

  isDragging.value = false
  removeDragListeners()

  if (dragFrameId !== null) {
    window.cancelAnimationFrame(dragFrameId)
    dragFrameId = null
  }

  if (pendingDragPosition) {
    position.value = pendingDragPosition
    pendingDragPosition = null
  }
}

const close = () => {
  stopDrag()
  isOpen.value = false
  text.value = ''
  translatedText.value = ''
  isTranslating.value = false
}

const clampPopupToViewport = async (nextX = position.value.x, nextY = position.value.y) => {
  await nextTick()
  applyPosition(nextX, nextY)
}

const handleTranslateRequest = async (event: Event) => {
  const customEvent = event as CustomEvent<{ text: string; x?: number; y?: number }>
  const { text: newText, x, y } = customEvent.detail

  stopDrag()
  text.value = newText
  isOpen.value = true
  isTranslating.value = true
  translatedText.value = ''

  await clampPopupToViewport(
    typeof x === 'number' ? x : position.value.x,
    typeof y === 'number' ? y : position.value.y
  )

  try {
    const result = await agentSessionPresenter.translateText(
      newText,
      locale.value,
      agentStore.selectedAgentId ?? 'deepchat'
    )
    translatedText.value = result
  } catch (error) {
    translatedText.value = t('contextMenu.translate.error')
  } finally {
    isTranslating.value = false
    await clampPopupToViewport()
  }
}

onMounted(() => {
  window.addEventListener('context-menu-translate-text', handleTranslateRequest)
})

onUnmounted(() => {
  stopDrag()
  window.removeEventListener('context-menu-translate-text', handleTranslateRequest)
})
</script>

<style scoped>
.translate-popup {
  contain: layout paint;
  will-change: transform;
}

.translate-popup__header {
  touch-action: none;
}

.cursor-move,
.translate-popup__header {
  cursor: move;
}
</style>
