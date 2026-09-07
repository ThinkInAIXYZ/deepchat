import { computed, shallowRef, triggerRef } from 'vue'
import type { MessageListItem } from '@/features/chat-page/model/displayMessage'

export type MessageLayoutEntry = {
  id: string
  measurementKey: string
  orderSeq: number
  estimatedHeight: number
  measuredHeight?: number
  top: number
  bottom: number
}

export type MessageMeasurementSnapshot = Readonly<Record<string, number>>

type ReadableRef<T> = { readonly value: T }

type UseMessageWindowOptions = {
  messages: ReadableRef<MessageListItem[]>
}

const MIN_HEIGHT = 96
const MAX_HEIGHT = 1200
const MESSAGE_ROW_SPACING = 4
const USER_BASE = 112
const ASSISTANT_BASE = 136
const PENDING_ASSISTANT_PLACEHOLDER_HEIGHT = 80
const PENDING_ASSISTANT_PLACEHOLDER_ID_PREFIX = '__pending_assistant_'
// Collapsed UI defaults (tool pill / think header / activity group). Expanded
// rows correct via ResizeObserver; over-estimating collapsed blocks causes
// spacer jump when windowing.
const TOOL_CALL_COLLAPSED_HEIGHT = 40
const THINKING_COLLAPSED_HEIGHT = 28
const PLAN_BLOCK_HEIGHT = 120
const MEDIA_BLOCK_HEIGHT = 200
const AUDIO_BLOCK_HEIGHT = 96
const ACTION_BLOCK_HEIGHT = 100
const DEFAULT_BLOCK_HEIGHT = 72
const CHARS_PER_LINE = 72
const LINE_H = 22
/** Ignore sub-pixel / sub-threshold measure noise so scroll doesn't re-anchor. */
const MEASURE_DELTA_EPSILON_PX = 4

function clamp(v: number) {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, v))
}

function withRowSpacing(height: number): number {
  return height + MESSAGE_ROW_SPACING
}

function estimateHeight(msg: MessageListItem): number {
  if (msg.messageType === 'compaction') return withRowSpacing(64)
  if (msg.role === 'user') {
    const textLen = msg.content.text?.length ?? 0
    const richLen = msg.content.content?.reduce((s, b) => s + b.content.length, 0) ?? 0
    const files = msg.content.files?.length ?? 0
    return withRowSpacing(
      clamp(
        USER_BASE + Math.ceil(Math.max(textLen, richLen) / CHARS_PER_LINE) * LINE_H + files * 34
      )
    )
  }
  if (
    msg.status === 'pending' &&
    msg.id.startsWith(PENDING_ASSISTANT_PLACEHOLDER_ID_PREFIX) &&
    msg.content.length === 0
  ) {
    return withRowSpacing(PENDING_ASSISTANT_PLACEHOLDER_HEIGHT)
  }

  let h = ASSISTANT_BASE
  for (const block of msg.content) {
    switch (block.type) {
      case 'content':
        h += Math.max(
          48,
          Math.ceil(
            (typeof block.content === 'string' ? block.content.length : 0) / CHARS_PER_LINE
          ) * LINE_H
        )
        break
      case 'tool_call':
        // Default UI is collapsed pill; expanded details measure later.
        h += TOOL_CALL_COLLAPSED_HEIGHT
        break
      case 'reasoning_content':
      case 'artifact-thinking':
        // Think header line when collapsed (common settled state).
        h += THINKING_COLLAPSED_HEIGHT
        break
      case 'plan':
        h += PLAN_BLOCK_HEIGHT
        break
      case 'image':
      case 'video':
        h += MEDIA_BLOCK_HEIGHT
        break
      case 'audio':
        h += AUDIO_BLOCK_HEIGHT
        break
      case 'action':
        h += ACTION_BLOCK_HEIGHT
        break
      default:
        h += DEFAULT_BLOCK_HEIGHT
        break
    }
  }
  return withRowSpacing(clamp(h))
}

type EstimatedHeightCacheEntry = {
  message: MessageListItem
  measurementKey: string
  updatedAt: number
  content: MessageListItem['content']
  estimatedHeight: number
}

function canReuseEstimatedHeight(
  cached: EstimatedHeightCacheEntry | undefined,
  message: MessageListItem,
  measurementKey: string
): cached is EstimatedHeightCacheEntry {
  return Boolean(
    cached &&
    cached.message === message &&
    cached.measurementKey === measurementKey &&
    cached.updatedAt === message.updatedAt &&
    cached.content === message.content
  )
}

export function useMessageWindow(options: UseMessageWindowOptions) {
  const measuredHeights = shallowRef<Record<string, number>>({})
  const estimatedHeightCache = new Map<string, EstimatedHeightCacheEntry>()
  const entryByMessageId = new Map<string, MessageLayoutEntry>()
  const entryByMeasurementKey = new Map<string, MessageLayoutEntry>()
  let measureFlushQueued = false

  const flushMeasuredHeights = () => {
    if (!measureFlushQueued) return
    measureFlushQueued = false
    triggerRef(measuredHeights)
  }

  const scheduleMeasuredHeightsFlush = () => {
    if (measureFlushQueued) return
    measureFlushQueued = true
    // Coalesce many ResizeObserver measures (common while windowing mounts rows
    // during scroll) into one layout recompute.
    queueMicrotask(flushMeasuredHeights)
  }

  const entries = computed<MessageLayoutEntry[]>(() => {
    const measurements = measuredHeights.value
    const messages = options.messages.value
    let offset = 0
    const activeEstimateKeys = new Set<string>()
    const nextEntryByMessageId = new Map<string, MessageLayoutEntry>()
    const nextEntryByMeasurementKey = new Map<string, MessageLayoutEntry>()
    const nextEntries = messages.map((msg) => {
      const measurementKey = msg.renderKey ?? msg.id
      activeEstimateKeys.add(measurementKey)
      const cachedEstimate = estimatedHeightCache.get(measurementKey)
      const estimated = canReuseEstimatedHeight(cachedEstimate, msg, measurementKey)
        ? cachedEstimate.estimatedHeight
        : estimateHeight(msg)
      if (!canReuseEstimatedHeight(cachedEstimate, msg, measurementKey)) {
        estimatedHeightCache.set(measurementKey, {
          message: msg,
          measurementKey,
          updatedAt: msg.updatedAt,
          content: msg.content,
          estimatedHeight: estimated
        })
      }

      const measured = measurements[measurementKey]
      const height = measured ?? estimated
      const entry: MessageLayoutEntry = {
        id: msg.id,
        measurementKey,
        orderSeq: msg.orderSeq,
        estimatedHeight: estimated,
        measuredHeight: measured,
        top: offset,
        bottom: offset + height
      }
      offset = entry.bottom
      nextEntryByMessageId.set(entry.id, entry)
      nextEntryByMeasurementKey.set(entry.measurementKey, entry)
      return entry
    })

    for (const key of estimatedHeightCache.keys()) {
      if (!activeEstimateKeys.has(key)) {
        estimatedHeightCache.delete(key)
      }
    }

    entryByMessageId.clear()
    entryByMeasurementKey.clear()
    nextEntryByMessageId.forEach((entry, id) => entryByMessageId.set(id, entry))
    nextEntryByMeasurementKey.forEach((entry, key) => entryByMeasurementKey.set(key, entry))
    return nextEntries
  })

  const totalHeight = computed(() => entries.value[entries.value.length - 1]?.bottom ?? 0)

  function getEntry(messageId: string): MessageLayoutEntry | undefined {
    // Ensure callers see the latest measurements even if a microtask flush is pending.
    flushMeasuredHeights()
    void entries.value
    return peekEntry(messageId)
  }

  function peekEntry(messageId: string): MessageLayoutEntry | undefined {
    return entryByMessageId.get(messageId) ?? entryByMeasurementKey.get(messageId)
  }

  function setMeasuredHeight(messageId: string, height: number): number {
    if (!Number.isFinite(height) || height <= 0) return 0
    const rounded = Math.ceil(height)
    // Read the last computed layout maps directly: flushing the pending measure
    // batch here would recompute the full layout once per row, defeating the
    // coalescing that scheduleMeasuredHeightsFlush provides. Rows only measure
    // after they rendered from a computed layout, so the maps cover them.
    const entry = peekEntry(messageId)
    const measurementKey = entry?.measurementKey ?? messageId
    const map = measuredHeights.value
    const prev = map[measurementKey]
    if (prev === rounded) return 0
    // Use map baseline when present; otherwise use the current layout entry. This
    // avoids a second linear message search and reuses the cached estimate.
    const baseline = prev ?? entry?.estimatedHeight ?? rounded
    const delta = rounded - baseline
    map[measurementKey] = rounded
    scheduleMeasuredHeightsFlush()
    // Keep the map accurate but suppress tiny deltas so ChatPage does not
    // re-run bottom-follow / anchor-restore for sub-threshold noise.
    if (Math.abs(delta) < MEASURE_DELTA_EPSILON_PX) return 0
    return delta
  }

  function clearMeasurements() {
    measureFlushQueued = false
    measuredHeights.value = {}
  }

  function captureMeasurements(): MessageMeasurementSnapshot {
    flushMeasuredHeights()
    return Object.freeze({ ...measuredHeights.value })
  }

  function restoreMeasurements(snapshot: MessageMeasurementSnapshot): void {
    measureFlushQueued = false
    const restored: Record<string, number> = {}
    for (const [messageId, height] of Object.entries(snapshot)) {
      if (Number.isFinite(height) && height > 0) {
        restored[messageId] = height
      }
    }
    measuredHeights.value = restored
  }

  return {
    entries,
    totalHeight,
    getEntry,
    setMeasuredHeight,
    flushMeasurements: flushMeasuredHeights,
    clearMeasurements,
    captureMeasurements,
    restoreMeasurements
  }
}
