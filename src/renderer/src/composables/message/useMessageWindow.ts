import { computed, shallowRef, triggerRef } from 'vue'
import type { MessageListItem } from '@/components/chat/messageListItems'

export type MessageLayoutEntry = {
  id: string
  measurementKey: string
  orderSeq: number
  estimatedHeight: number
  measuredHeight?: number
  top: number
  bottom: number
}

type ReadableRef<T> = { readonly value: T }

type UseMessageWindowOptions = {
  messages: ReadableRef<MessageListItem[]>
}

const MIN_HEIGHT = 96
const MAX_HEIGHT = 1200
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

function estimateHeight(msg: MessageListItem): number {
  if (msg.messageType === 'compaction') return 64
  if (msg.role === 'user') {
    const textLen = msg.content.text?.length ?? 0
    const richLen = msg.content.content?.reduce((s, b) => s + b.content.length, 0) ?? 0
    const files = msg.content.files?.length ?? 0
    return clamp(
      USER_BASE + Math.ceil(Math.max(textLen, richLen) / CHARS_PER_LINE) * LINE_H + files * 34
    )
  }
  if (
    msg.status === 'pending' &&
    msg.id.startsWith(PENDING_ASSISTANT_PLACEHOLDER_ID_PREFIX) &&
    msg.content.length === 0
  ) {
    return PENDING_ASSISTANT_PLACEHOLDER_HEIGHT
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
  return clamp(h)
}

export function useMessageWindow(options: UseMessageWindowOptions) {
  const measuredHeights = shallowRef<Record<string, number>>({})
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
    let offset = 0
    return options.messages.value.map((msg) => {
      const measurementKey = msg.renderKey ?? msg.id
      const measured = measuredHeights.value[measurementKey]
      const estimated = estimateHeight(msg)
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
      return entry
    })
  })

  const totalHeight = computed(() => entries.value[entries.value.length - 1]?.bottom ?? 0)

  function getEntry(messageId: string): MessageLayoutEntry | undefined {
    // Ensure callers see the latest measurements even if a microtask flush is pending.
    flushMeasuredHeights()
    return entries.value.find((e) => e.id === messageId || e.measurementKey === messageId)
  }

  function setMeasuredHeight(messageId: string, height: number): number {
    if (!Number.isFinite(height) || height <= 0) return 0
    const rounded = Math.ceil(height)
    const map = measuredHeights.value
    const prev = map[messageId]
    if (prev === rounded) return 0
    // Use map baseline when present; otherwise estimate from current messages list
    // without forcing a full entries recompute mid-batch.
    let baseline = prev
    if (baseline === undefined) {
      const msg = options.messages.value.find(
        (item) => item.id === messageId || item.renderKey === messageId
      )
      baseline = msg ? estimateHeight(msg) : rounded
    }
    const delta = rounded - baseline
    map[messageId] = rounded
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

  return { entries, totalHeight, getEntry, setMeasuredHeight, clearMeasurements }
}
