<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  findMinimapTickIndexAt,
  resolveMinimapTickIndex,
  type MinimapTick,
  type MinimapViewportWindow
} from '@/features/chat-page/model/minimapTicks'

/**
 * Position rail for the conversation: one mark per message, plus a window showing the slice that is
 * on screen. Clicking a spot on the rail jumps to the message there, and the arrow keys walk the
 * marks one by one, which is the fast way to browse a long history.
 *
 * It never scrolls by itself — it emits the message to jump to and lets ChatPage route the request
 * through the scroll controller, so every programmatic scroll still carries an explicit reason.
 */
const props = defineProps<{
  visible: boolean
  ticks: MinimapTick[]
  viewport: MinimapViewportWindow | null
}>()

const emit = defineEmits<{
  (event: 'jump', messageId: string): void
}>()

const { t } = useI18n()
const railRef = ref<HTMLElement | null>(null)

/** The message at the top of the viewport: what the rail reports as its current position. */
const activeIndex = computed(() => findMinimapTickIndexAt(props.ticks, props.viewport))

function jumpToIndex(index: number): void {
  const tick = props.ticks[index]
  if (tick) emit('jump', tick.id)
}

function onRailClick(event: MouseEvent): void {
  const rail = railRef.value
  if (!rail) return
  const bounds = rail.getBoundingClientRect()
  if (bounds.height <= 0) return

  const index = resolveMinimapTickIndex(props.ticks, (event.clientY - bounds.top) / bounds.height)
  if (index !== null) jumpToIndex(index)
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
</script>

<template>
  <div
    v-if="props.visible"
    class="pointer-events-none absolute right-3 top-2 bottom-2 flex w-5 justify-center"
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
      class="pointer-events-auto relative h-full w-2.5 cursor-pointer rounded-full bg-muted/50 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="chat-minimap-rail"
      @click="onRailClick"
      @keydown="onRailKeydown"
    >
      <span
        v-for="tick in props.ticks"
        :key="tick.id"
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0.5 rounded-full"
        :class="tick.role === 'user' ? 'bg-primary/60' : 'bg-muted-foreground/40'"
        :style="{ top: `${tick.top * 100}%`, height: `${tick.height * 100}%`, minHeight: '2px' }"
      />

      <span
        v-if="props.viewport"
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 rounded-full border border-foreground/25 bg-foreground/10"
        :style="{
          top: `${props.viewport.top * 100}%`,
          height: `${props.viewport.height * 100}%`,
          minHeight: '8px'
        }"
        data-testid="chat-minimap-window"
      />
    </div>
  </div>
</template>
