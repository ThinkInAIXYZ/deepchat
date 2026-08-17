<template>
  <section
    ref="rootRef"
    class="shrink-0 border-b bg-muted/10 px-2 py-2"
    data-testid="tape-inspector-timeline"
  >
    <div class="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
      <div class="mr-auto flex min-w-0 items-center gap-2">
        <span class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {{ t('tapeInspector.timeline.title') }}
        </span>
        <span v-if="hasUnloadedHistory" class="truncate text-[10px] text-muted-foreground">
          ↑ {{ t('tapeInspector.timeline.earlierNotLoaded') }}
        </span>
      </div>
      <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span class="inline-flex items-center gap-1">
          <span class="h-1.5 w-3 rounded-sm bg-muted-foreground/70" aria-hidden="true" />
          {{ t('tapeInspector.timeline.duration') }}
        </span>
        <span class="inline-flex items-center gap-1">
          <span
            class="size-1.5 rotate-45 rounded-[1px] bg-muted-foreground/70"
            aria-hidden="true"
          />
          {{ t('tapeInspector.timeline.point') }}
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="size-1.5 rounded-sm bg-destructive" aria-hidden="true" />
          {{ t('tapeInspector.timeline.error') }}
        </span>
      </div>
      <div class="flex rounded border border-border bg-background p-0.5">
        <button
          type="button"
          class="h-5 rounded px-1.5 text-[10px]"
          :class="props.mode === 'actual' ? 'bg-muted text-foreground' : 'text-muted-foreground'"
          :aria-pressed="props.mode === 'actual'"
          @click="setMode('actual')"
        >
          {{ t('tapeInspector.timeline.actual') }}
        </button>
        <button
          type="button"
          class="h-5 rounded px-1.5 text-[10px]"
          :class="props.mode === 'sequence' ? 'bg-muted text-foreground' : 'text-muted-foreground'"
          :aria-pressed="props.mode === 'sequence'"
          @click="setMode('sequence')"
        >
          {{ t('tapeInspector.timeline.sequence') }}
        </button>
      </div>
      <button
        type="button"
        class="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        :aria-label="t('common.zoomOut')"
        :title="t('common.zoomOut')"
        @click="zoom(1.4)"
      >
        <Icon icon="lucide:zoom-out" class="size-3" />
      </button>
      <button
        type="button"
        class="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        :aria-label="t('common.zoomIn')"
        :title="t('common.zoomIn')"
        @click="zoom(0.7)"
      >
        <Icon icon="lucide:zoom-in" class="size-3" />
      </button>
      <button
        type="button"
        class="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        :aria-label="t('common.reset')"
        :title="t('common.reset')"
        @click="resetViewport"
      >
        <Icon icon="lucide:rotate-ccw" class="size-3" />
      </button>
    </div>

    <div class="space-y-0.5">
      <div v-for="lane in lanes" :key="lane" class="grid grid-cols-[52px_minmax(0,1fr)] gap-2">
        <div class="flex h-6 items-center truncate text-[10px] text-muted-foreground">
          {{ laneLabel(lane) }}
        </div>
        <div
          :data-testid="`tape-inspector-timeline-lane-${lane}`"
          :data-lane="lane"
          class="relative h-6 touch-none overflow-hidden rounded-sm border border-border/60 bg-background outline-none focus-visible:ring-1 focus-visible:ring-ring"
          role="slider"
          :aria-label="`${laneLabel(lane)} · ${viewportLabel}`"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="viewportPercent"
          :aria-valuetext="viewportLabel"
          tabindex="0"
          @pointerdown="startBrush"
          @pointermove="continueBrush"
          @pointerup="finishBrush"
          @pointercancel="cancelBrush"
          @wheel.prevent="handleWheel"
          @keydown="handleKeydown"
        >
          <span class="pointer-events-none absolute inset-0 timeline-grid" aria-hidden="true" />
          <button
            v-for="item in itemsByLane[lane]"
            :key="item.key"
            type="button"
            class="absolute top-1/2 z-[1] -translate-y-1/2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="itemClass(item)"
            :style="itemStyle(item)"
            :data-row-key="item.row.key"
            :data-item-count="item.count"
            :title="itemTitle(item)"
            :aria-label="itemTitle(item)"
            @pointerdown.stop
            @click.stop="emit('select', item.row.key)"
          >
            <span v-if="item.count > 1" class="sr-only">
              {{ t('tapeInspector.fields.records') }}: {{ item.count }}
            </span>
          </button>
          <span
            v-if="brush && brush.lane === lane"
            class="pointer-events-none absolute inset-y-0 z-[2] rounded-sm bg-ring/25"
            :style="brushStyle"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue'
import { useElementSize } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import type { TapeInspectorDisplayRow } from './model'
import {
  buildTapeInspectorTimelineItems,
  type TapeInspectorTimelineItem,
  type TapeInspectorTimelineLane,
  type TapeInspectorTimelineMode
} from './timeline'

interface BrushState {
  current: number
  lane: TapeInspectorTimelineLane
  pointerId: number
  start: number
  target: HTMLElement
}

interface AbsoluteRange {
  min: number
  max: number
}

const props = withDefaults(
  defineProps<{
    rows: readonly TapeInspectorDisplayRow[]
    selectedKey: string | null
    hasUnloadedHistory: boolean
    mode?: TapeInspectorTimelineMode
  }>(),
  { mode: 'actual' }
)

const emit = defineEmits<{
  select: [key: string]
  'update:mode': [mode: TapeInspectorTimelineMode]
}>()

const { t, d } = useI18n()
const rootRef = ref<HTMLElement | null>(null)
const { width: rootWidth } = useElementSize(rootRef)
const lanes: TapeInspectorTimelineLane[] = ['session', 'model', 'tool']
const viewport = ref({ start: 0, end: 1 })
const brush = ref<BrushState | null>(null)

const MIN_VIEWPORT = 0.04
const MIN_BRUSH = 0.015
const EDGE_EPSILON = 1e-6

const items = computed(() =>
  buildTapeInspectorTimelineItems({
    rows: props.rows,
    mode: props.mode,
    viewportStart: viewport.value.start,
    viewportEnd: viewport.value.end,
    selectedKey: props.selectedKey,
    bucketsPerLane: Math.floor(Math.max(64, rootWidth.value - 72) / 8)
  })
)
const itemsByLane = computed<Record<TapeInspectorTimelineLane, TapeInspectorTimelineItem[]>>(
  () => ({
    session: items.value.filter((item) => item.lane === 'session'),
    model: items.value.filter((item) => item.lane === 'model'),
    tool: items.value.filter((item) => item.lane === 'tool')
  })
)
const absoluteRange = computed<AbsoluteRange | null>(() => {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const row of props.rows) {
    if (row.recordType === 'evidence' && row.association === 'diagnostic') continue
    if (props.mode === 'sequence') {
      if (row.sequenceEntryId === null) continue
      min = Math.min(min, row.sequenceEntryId)
      max = Math.max(max, row.sequenceEntryId)
      continue
    }
    if (row.actualStartAt === null || (row.timingState !== 'span' && row.timingState !== 'point')) {
      continue
    }
    min = Math.min(min, row.actualStartAt)
    max = Math.max(max, row.actualEndAt ?? row.actualStartAt)
  }
  return Number.isFinite(min) ? { min, max } : null
})
const viewportPercent = computed(() =>
  Math.round((viewport.value.end - viewport.value.start) * 100)
)
const viewportLabel = computed(
  () => `${Math.round(viewport.value.start * 100)}%–${Math.round(viewport.value.end * 100)}%`
)
const brushStyle = computed<CSSProperties>(() => {
  if (!brush.value) return {}
  const start = Math.min(brush.value.start, brush.value.current)
  const end = Math.max(brush.value.start, brush.value.current)
  return { left: `${start * 100}%`, width: `${(end - start) * 100}%` }
})

function laneLabel(lane: TapeInspectorTimelineLane): string {
  if (lane === 'session') return t('tapeInspector.timeline.session')
  if (lane === 'model') return t('tapeInspector.timeline.model')
  return t('tapeInspector.timeline.tools')
}

function rowLabel(row: TapeInspectorDisplayRow): string {
  if (row.recordType === 'fact') return row.record.name ?? row.record.kind
  if (row.recordType === 'evidence') {
    return `${t('tapeInspector.evidence.request')} · ${row.record.providerId}/${row.record.modelId}`
  }
  if (row.recordType === 'evidence_lane')
    return t(`tapeInspector.evidence.lanes.${row.laneKind}`, { count: row.count })
  if (row.group.kind === 'run') return t('tapeInspector.groups.run')
  if (row.group.kind === 'request')
    return `${t('tapeInspector.groups.request')} #${row.group.requestSeq}`
  if (row.group.kind === 'attempt') {
    return `${t('tapeInspector.groups.attempt')} #${row.group.physicalAttempt}`
  }
  return row.summary.toolName ?? t('tapeInspector.groups.tool')
}

function durationLabel(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(2)} s`
}

function itemTitle(item: TapeInspectorTimelineItem): string {
  const lines = [rowLabel(item.row)]
  if (item.count > 1) lines.push(`${t('tapeInspector.fields.records')}: ${item.count}`)
  if (item.row.actualStartAt !== null) {
    lines.push(d(new Date(item.row.actualStartAt), { dateStyle: 'medium', timeStyle: 'medium' }))
  }
  if (props.mode === 'sequence') {
    lines.push(t('tapeInspector.waterfall.sequence'))
  } else if (item.row.timingState === 'span' && item.row.durationMs !== null) {
    lines.push(`${t('tapeInspector.columns.duration')}: ${durationLabel(item.row.durationMs)}`)
  } else if (item.row.timingState === 'unresolved') {
    lines.push(t('tapeInspector.states.timingPending'))
  } else {
    lines.push(t('tapeInspector.waterfall.point'))
  }
  return lines.join('\n')
}

function isError(item: TapeInspectorTimelineItem): boolean {
  return (
    item.row.status === 'error' ||
    (item.row.recordType === 'fact' && item.row.record.facts?.isError === true)
  )
}

function itemClass(item: TapeInspectorTimelineItem): string[] {
  const selected = item.row.key === props.selectedKey
  const color = isError(item)
    ? 'bg-destructive'
    : item.lane === 'session'
      ? 'bg-emerald-500'
      : item.lane === 'model'
        ? 'bg-violet-500'
        : 'bg-amber-500'
  return [
    color,
    selected
      ? 'ring-2 ring-ring ring-offset-1 ring-offset-background'
      : 'opacity-80 hover:opacity-100',
    item.point ? 'size-2 rotate-45 rounded-[1px]' : 'h-2 rounded-sm'
  ]
}

function itemStyle(item: TapeInspectorTimelineItem): CSSProperties {
  return item.point
    ? { left: `clamp(0px, calc(${item.start * 100}% - 4px), calc(100% - 8px))` }
    : { left: `${item.start * 100}%`, width: `max(${item.width * 100}%, 4px)` }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function setViewport(start: number, end: number, minimumSpan = MIN_VIEWPORT): void {
  const span = clamp(end - start, minimumSpan, 1)
  const nextStart = clamp(start, 0, 1 - span)
  viewport.value = { start: nextStart, end: nextStart + span }
}

function resetViewport(): void {
  viewport.value = { start: 0, end: 1 }
}

function setMode(nextMode: TapeInspectorTimelineMode): void {
  if (props.mode === nextMode) return
  cancelBrush()
  emit('update:mode', nextMode)
  resetViewport()
}

function zoom(factor: number, anchor = 0.5): void {
  const current = viewport.value
  const currentSpan = current.end - current.start
  const nextSpan = clamp(currentSpan * factor, MIN_VIEWPORT, 1)
  const boundedAnchor = clamp(anchor, 0, 1)
  const anchorPosition = current.start + currentSpan * boundedAnchor
  setViewport(
    anchorPosition - nextSpan * boundedAnchor,
    anchorPosition + nextSpan * (1 - boundedAnchor)
  )
}

function pan(delta: number): void {
  const span = viewport.value.end - viewport.value.start
  setViewport(viewport.value.start + delta, viewport.value.start + delta + span)
}

function pointerPosition(target: HTMLElement, clientX: number): number | null {
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0) return null
  return clamp((clientX - rect.left) / rect.width, 0, 1)
}

function releasePointerCapture(target: HTMLElement, pointerId: number): void {
  try {
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId)
  } catch {
    // The browser can release capture before a cancelled gesture reaches Vue.
  }
}

function startBrush(event: PointerEvent): void {
  if (event.button !== 0) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const position = pointerPosition(target, event.clientX)
  const lane = target.dataset.lane
  if (position === null || (lane !== 'session' && lane !== 'model' && lane !== 'tool')) return
  event.preventDefault()
  cancelBrush()
  target.setPointerCapture?.(event.pointerId)
  brush.value = { current: position, lane, pointerId: event.pointerId, start: position, target }
}

function continueBrush(event: PointerEvent): void {
  const current = brush.value
  if (!current || current.pointerId !== event.pointerId) return
  const position = pointerPosition(current.target, event.clientX)
  if (position !== null) current.current = position
}

function cancelBrush(event?: PointerEvent): void {
  const current = brush.value
  if (!current || (event && current.pointerId !== event.pointerId)) return
  releasePointerCapture(current.target, current.pointerId)
  brush.value = null
}

function finishBrush(event: PointerEvent): void {
  const current = brush.value
  if (!current || current.pointerId !== event.pointerId) return
  continueBrush(event)
  const start = Math.min(current.start, current.current)
  const end = Math.max(current.start, current.current)
  cancelBrush(event)
  if (end - start < MIN_BRUSH) return
  const visible = viewport.value
  const span = visible.end - visible.start
  setViewport(visible.start + start * span, visible.start + end * span)
}

function handleWheel(event: WheelEvent): void {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const width = target.getBoundingClientRect().width
  if (width <= 0) return
  const span = viewport.value.end - viewport.value.start
  if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    const pixelDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    pan((pixelDelta / width) * span)
    return
  }
  const position = pointerPosition(target, event.clientX)
  zoom(Math.exp(event.deltaY * 0.002), position ?? 0.5)
}

function handleKeydown(event: KeyboardEvent): void {
  const span = viewport.value.end - viewport.value.start
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    pan(span * (event.key === 'ArrowLeft' ? -0.1 : 0.1))
  } else if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoom(0.7)
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault()
    zoom(1.4)
  } else if (event.key === 'Home' || event.key === 'Escape') {
    event.preventDefault()
    cancelBrush()
    resetViewport()
  }
}

function preserveAbsoluteWindow(
  previousRange: AbsoluteRange | null,
  nextRange: AbsoluteRange | null
): void {
  if (!previousRange || !nextRange) return
  const current = viewport.value
  const previousSpan = previousRange.max - previousRange.min
  const nextSpan = nextRange.max - nextRange.min
  const fullRange = current.start <= EDGE_EPSILON && current.end >= 1 - EDGE_EPSILON
  if (fullRange || previousSpan <= 0 || nextSpan <= 0) return

  const duration = previousSpan * (current.end - current.start)
  let startAt = previousRange.min + previousSpan * current.start
  let endAt = previousRange.min + previousSpan * current.end
  if (current.end >= 1 - EDGE_EPSILON && nextRange.max > previousRange.max) {
    endAt = nextRange.max
    startAt = endAt - duration
  }
  if (startAt < nextRange.min) {
    endAt += nextRange.min - startAt
    startAt = nextRange.min
  }
  if (endAt > nextRange.max) {
    startAt -= endAt - nextRange.max
    endAt = nextRange.max
  }
  startAt = Math.max(startAt, nextRange.min)
  setViewport((startAt - nextRange.min) / nextSpan, (endAt - nextRange.min) / nextSpan, 0)
}

watch(
  absoluteRange,
  (nextRange, previousRange) => preserveAbsoluteWindow(previousRange, nextRange),
  {
    flush: 'sync'
  }
)

onBeforeUnmount(cancelBrush)
</script>

<style scoped>
.timeline-grid {
  background-image: linear-gradient(
    to right,
    color-mix(in srgb, var(--border) 45%, transparent) 1px,
    transparent 1px
  );
  background-size: 12.5% 100%;
}
</style>
