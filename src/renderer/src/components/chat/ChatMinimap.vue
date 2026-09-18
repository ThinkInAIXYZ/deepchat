<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcPopover } from '@dc-ui/components/popover'
import {
  findMinimapTickIndexAt,
  resolveMinimapTickIndex,
  type MinimapTick,
  type MinimapViewportWindow
} from '@/features/chat-page/model/minimapTicks'

/**
 * Message map: one hairline mark per message along the left gutter, as wide as the message is long
 * relative to the longest one in the conversation. Hovering a mark highlights it and previews the
 * message; clicking it jumps there, and the arrow keys walk the marks one at a time.
 *
 * It never scrolls by itself — it emits the message to act on and lets ChatPage route the request
 * through the scroll controller, so every programmatic scroll still carries an explicit reason.
 */
const props = defineProps<{
  visible: boolean
  ticks: MinimapTick[]
  viewport: MinimapViewportWindow | null
  /** Text of the hovered message, or null while nothing is hovered. */
  previewText?: string | null
}>()

const emit = defineEmits<{
  (event: 'jump', messageId: string): void
  (event: 'hover', messageId: string | null): void
}>()

const { t } = useI18n()
const railRef = ref<HTMLElement | null>(null)
const hoveredIndex = ref<number | null>(null)

/** Full rail width in px; the longest message fills it and every other mark scales against it. */
const MAX_MARK_WIDTH = 40

/** The message at the top of the viewport: what the rail reports as its current position. */
const activeIndex = computed(() => findMinimapTickIndexAt(props.ticks, props.viewport))
const hoveredTick = computed(() =>
  hoveredIndex.value === null ? null : (props.ticks[hoveredIndex.value] ?? null)
)

function tickFractionAt(clientY: number): number | null {
  const rail = railRef.value
  if (!rail) return null
  const bounds = rail.getBoundingClientRect()
  if (bounds.height <= 0) return null
  return (clientY - bounds.top) / bounds.height
}

function jumpToIndex(index: number): void {
  const tick = props.ticks[index]
  if (tick) emit('jump', tick.id)
}

function onRailClick(event: MouseEvent): void {
  const fraction = tickFractionAt(event.clientY)
  if (fraction === null) return

  const index = resolveMinimapTickIndex(props.ticks, fraction)
  if (index !== null) jumpToIndex(index)
}

function onRailPointerMove(event: PointerEvent): void {
  const fraction = tickFractionAt(event.clientY)
  if (fraction === null) return

  const index = resolveMinimapTickIndex(props.ticks, fraction)
  if (index === hoveredIndex.value) return

  hoveredIndex.value = index
  emit('hover', index === null ? null : (props.ticks[index]?.id ?? null))
}

function onRailPointerLeave(): void {
  if (hoveredIndex.value === null) return
  hoveredIndex.value = null
  emit('hover', null)
}

function onRailKeydown(event: KeyboardEvent): void {
  const current = activeIndex.value ?? 0
  const last = props.ticks.length - 1
  let target: number | null = null

  switch (event.key) {
    case 'ArrowUp':
    case 'ArrowLeft':
      target = Math.max(current - 1, 0)
      break
    case 'ArrowDown':
    case 'ArrowRight':
      target = Math.min(current + 1, last)
      break
    case 'Home':
      target = 0
      break
    case 'End':
      target = last
      break
    default:
      return
  }

  // The rail owns these keys while it has focus; they must not also scroll the message list.
  event.preventDefault()
  jumpToIndex(target)
}

const label = computed(() => t('chat.messages.minimap'))
const markWidth = (tick: MinimapTick) => `${Math.max(tick.width * MAX_MARK_WIDTH, 2)}px`
const markTop = (tick: MinimapTick) => `${tick.top * 100}%`
</script>

<template>
  <div
    v-if="props.visible"
    class="pointer-events-none absolute left-3 top-2 bottom-2 w-10"
    style="z-index: var(--dc-z-sticky)"
    data-testid="chat-minimap"
  >
    <div
      ref="railRef"
      role="slider"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="label"
      :aria-valuemin="1"
      :aria-valuemax="Math.max(props.ticks.length, 1)"
      :aria-valuenow="(activeIndex ?? 0) + 1"
      class="pointer-events-auto relative h-full w-10 cursor-pointer focus-visible:outline-none"
      data-testid="chat-minimap-rail"
      @click="onRailClick"
      @keydown="onRailKeydown"
      @pointermove="onRailPointerMove"
      @pointerleave="onRailPointerLeave"
    >
      <span
        v-for="(tick, index) in props.ticks"
        :key="tick.id"
        aria-hidden="true"
        class="pointer-events-none absolute left-0 h-0.5 rounded-full transition-colors"
        :class="index === hoveredIndex ? 'bg-foreground' : 'bg-muted-foreground/40'"
        :style="{ top: markTop(tick), width: markWidth(tick) }"
        data-testid="chat-minimap-mark"
      />

      <DcPopover
        :open="hoveredTick !== null && Boolean(props.previewText)"
        side="right"
        align="center"
        :side-offset="12"
        width-class="w-[min(70vw,26rem)]"
      >
        <template #trigger>
          <!-- Invisible anchor that follows the hovered mark, so the card points at the message the
               pointer is actually on rather than at the middle of the rail. -->
          <span
            aria-hidden="true"
            class="absolute left-0 h-0 w-0"
            :style="{ top: hoveredTick ? markTop(hoveredTick) : '0%' }"
          />
        </template>
        <p
          class="dc-overscroll-contain line-clamp-6 max-h-48 overflow-hidden px-3 py-2 text-xs whitespace-pre-wrap text-foreground/90"
          data-testid="chat-minimap-preview"
        >
          {{ props.previewText }}
        </p>
      </DcPopover>
    </div>
  </div>
</template>
