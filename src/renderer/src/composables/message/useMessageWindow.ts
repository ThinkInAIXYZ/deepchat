import { computed, shallowRef, triggerRef } from 'vue'
import type { MessageListItem } from '@/components/chat/messageListItems'

export type MessageLayoutEntry = {
  id: string
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
const CHARS_PER_LINE = 72
const LINE_H = 22

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
        h += 150
        break
      case 'reasoning_content':
      case 'artifact-thinking':
        h += 96
        break
      case 'plan':
        h += 160
        break
      case 'image':
      case 'video':
        h += 260
        break
      case 'audio':
        h += 96
        break
      case 'action':
        h += 120
        break
      default:
        h += 88
        break
    }
  }
  return clamp(h)
}

export function useMessageWindow(options: UseMessageWindowOptions) {
  const measuredHeights = shallowRef<Record<string, number>>({})

  const entries = computed<MessageLayoutEntry[]>(() => {
    let offset = 0
    return options.messages.value.map((msg) => {
      const measured = measuredHeights.value[msg.id]
      const estimated = estimateHeight(msg)
      const height = measured ?? estimated
      const entry: MessageLayoutEntry = {
        id: msg.id,
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
    return entries.value.find((e) => e.id === messageId)
  }

  function setMeasuredHeight(messageId: string, height: number): number {
    if (!Number.isFinite(height) || height <= 0) return 0
    const rounded = Math.ceil(height)
    const map = measuredHeights.value
    const prev = map[messageId]
    if (prev === rounded) return 0
    map[messageId] = rounded
    triggerRef(measuredHeights)
    return rounded - (prev ?? getEntry(messageId)?.estimatedHeight ?? rounded)
  }

  function clearMeasurements() {
    measuredHeights.value = {}
  }

  return { entries, totalHeight, getEntry, setMeasuredHeight, clearMeasurements }
}
