<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DcPopover } from '@dc-ui/components/popover'
import {
  findMinimapTickIndexAt,
  type MinimapTick,
  type MinimapViewportWindow
} from '@/features/chat-page/model/minimapTicks'

/**
 * Message map: one hairline mark per message down the right gutter, as wide as the message is long
 * relative to the longest one in the conversation. Hovering a mark highlights it and previews the
 * message; clicking a mark jumps there, and the arrow keys walk the marks one at a time.
 *
 * Marks are laid out on a constant pitch rather than by their position in the conversation, so the
 * spacing is the same everywhere: it never depends on how tall a single message is, and it does not
 * grow when the conversation is short. Once the marks no longer fit, the map scrolls.
 *
 * It never scrolls the conversation by itself — it emits the message to act on and lets ChatPage
 * route the request through the scroll controller, so every programmatic scroll still carries an
 * explicit reason.
 *
 * The rail lives in its own column beside the scroll container rather than floating over it: the
 * column reserves the space, so the marks are never clipped by the side panel and never squeezed
 * when the window is narrow, and the message list's scrollbar keeps its own gutter.
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
const contentRef = ref<HTMLElement | null>(null)
const hoveredIndex = ref<number | null>(null)

/** Vertical distance between two marks: constant, so the rail reads the same in every conversation. */
const MARK_PITCH = 16
/** Full mark width in px; the longest message fills it and every other mark scales against it. */
const MAX_MARK_WIDTH = 40

/** The message at the top of the viewport: what the rail reports as its current position. */
const activeIndex = computed(() => findMinimapTickIndexAt(props.ticks, props.viewport))
const hoveredTick = computed(() =>
  hoveredIndex.value === null ? null : (props.ticks[hoveredIndex.value] ?? null)
)
const marksHeight = computed(() => props.ticks.length * MARK_PITCH)

/**
 * The mark a pointer is on. Marks share a pitch, so a position resolves straight to a slot — and the
 * space between two marks belongs to one of them rather than being a dead zone. The content box is
 * measured rather than assumed, because a short conversation centres its marks in the rail.
 */
function indexAt(clientY: number): number | null {
  const rail = railRef.value
  if (!rail || props.ticks.length === 0) return null
  const bounds = rail.getBoundingClientRect()
  if (bounds.height <= 0) return null

  const contentOffset = contentRef.value?.offsetTop ?? 0
  const offset = clientY - bounds.top + rail.scrollTop - contentOffset
  return Math.min(Math.max(Math.floor(offset / MARK_PITCH), 0), props.ticks.length - 1)
}

function jumpToIndex(index: number): void {
  const tick = props.ticks[index]
  if (tick) emit('jump', tick.id)
}

function onRailClick(event: MouseEvent): void {
  const index = indexAt(event.clientY)
  if (index !== null) jumpToIndex(index)
}

function onRailPointerMove(event: PointerEvent): void {
  const index = indexAt(event.clientY)
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
const markTop = (index: number) => `${index * MARK_PITCH}px`
</script>

<template>
  <div
    v-if="props.visible"
    class="relative flex h-full w-16 shrink-0 flex-col py-2"
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
      class="dc-overscroll-contain flex h-full w-full flex-col overflow-y-auto pr-2 focus-visible:outline-none"
      data-testid="chat-minimap-rail"
      @click="onRailClick"
      @keydown="onRailKeydown"
      @pointermove="onRailPointerMove"
      @pointerleave="onRailPointerLeave"
    >
      <!-- Absolutely positioned marks give the scroll container no height of its own, so the content
           box carries the full stacked height. -->
      <!-- `my-auto` centres a short stack in the rail and collapses to 0 once the marks overflow. -->
      <div ref="contentRef" class="relative my-auto w-full" :style="{ height: `${marksHeight}px` }">
        <span
          v-for="(tick, index) in props.ticks"
          :key="tick.id"
          aria-hidden="true"
          class="pointer-events-none absolute right-0 h-0.5 rounded-full transition-colors"
          :class="index === hoveredIndex ? 'bg-foreground' : 'bg-muted-foreground/50'"
          :style="{ top: markTop(index), width: markWidth(tick) }"
          data-testid="chat-minimap-mark"
        />

        <DcPopover
          :open="hoveredTick !== null && Boolean(props.previewText)"
          side="left"
          align="center"
          :side-offset="12"
          width-class="w-[min(70vw,26rem)]"
        >
          <template #trigger>
            <!-- Invisible anchor that follows the hovered mark, so the card points at the message the
                 pointer is actually on rather than at the middle of the rail. -->
            <span
              aria-hidden="true"
              class="absolute right-0 h-0 w-0"
              :style="{ top: markTop(hoveredIndex ?? 0) }"
            />
          </template>
          <p
            class="line-clamp-4 px-3 py-2 text-xs whitespace-pre-wrap text-foreground/90"
            data-testid="chat-minimap-preview"
          >
            {{ props.previewText }}
          </p>
        </DcPopover>
      </div>
    </div>
  </div>
</template>
