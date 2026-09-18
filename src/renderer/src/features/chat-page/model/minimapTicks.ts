import type { MessageLayoutEntry } from '@/composables/message/useMessageWindow'
import { extractDisplayContentText } from '@/lib/chatSearch'
import type { DisplayMessage } from './displayMessage'

/** One message drawn as a mark on the message map, in 0..1 fractions of the scrolled content. */
export type MinimapTick = {
  id: string
  /** Fraction of the scrolled content above this message: where the mark sits. */
  top: number
  /** Fraction of the scrolled content this message spans, used to resolve positions. */
  height: number
  /**
   * How wide the mark is drawn, relative to the longest message in the conversation (0..1). The
   * longest message fills the rail's full width and everything else is proportional to it.
   */
  width: number
}

/** The visible slice of the conversation, in the same 0..1 fractions as the ticks. */
export type MinimapViewportWindow = {
  top: number
  height: number
}

/**
 * Message length per content object.
 *
 * The projection allocates a string, so its result is cached against the content object. A streaming
 * reply replaces its content object as it grows, which is exactly when the length must be recomputed;
 * every settled message is measured once and then costs nothing on later passes.
 */
const contentLengthCache = new WeakMap<object, number>()

function measureContentLength(content: unknown): number {
  if (!content || typeof content !== 'object') return 0

  const cached = contentLengthCache.get(content)
  if (cached !== undefined) return cached

  const length = extractDisplayContentText(content).length
  contentLengthCache.set(content, length)
  return length
}

/**
 * Marks for every loaded message, oldest first.
 *
 * The map is derived from the same logical layout table the windowing and the below-viewport count
 * use, so the marks, the viewport window and the count can never describe different geometries.
 * Positions are fractions of the total scrolled height, which makes the map independent of the
 * viewport size and of the zoom level; widths are fractions of the longest message, so the widest
 * mark is the longest message in the conversation and the rest scale against it.
 *
 * Without usable geometry there is nothing to draw, so an empty list is returned rather than marks
 * invented from estimates that do not match the layout yet.
 */
export function buildMinimapTicks(input: {
  entries: readonly MessageLayoutEntry[]
  messages: readonly DisplayMessage[]
  totalHeight: number
}): MinimapTick[] {
  const total = input.totalHeight
  if (!(total > 0) || input.entries.length === 0) return []

  const messageById = new Map(input.messages.map((message) => [message.id, message]))
  const lengths = input.entries.map((entry) => {
    const message = messageById.get(entry.id)
    return message ? measureContentLength(message.content) : 0
  })
  const longest = Math.max(...lengths, 0)

  return input.entries.map((entry, index) => ({
    id: entry.id,
    top: clampFraction(entry.top / total),
    height: clampFraction((entry.bottom - entry.top) / total),
    // Every message is a hairline when nothing in the conversation has any text.
    width: longest > 0 ? clampFraction(lengths[index] / longest) : 1
  }))
}

/**
 * The visible slice of the conversation. `viewportTop` is in message-window coordinates, i.e. the
 * caller has already subtracted the window origin, the same space the entries live in.
 */
export function buildMinimapViewportWindow(input: {
  viewportTop: number
  viewportHeight: number
  totalHeight: number
}): MinimapViewportWindow | null {
  const total = input.totalHeight
  if (!(total > 0) || !(input.viewportHeight > 0)) return null

  const top = clampFraction(input.viewportTop / total)
  return {
    top,
    height: clampFraction(Math.min(input.viewportHeight / total, 1 - top))
  }
}

/**
 * The message a pointer at `fraction` down the rail refers to: the mark containing that position, or
 * the nearest mark when the pointer is in a gap. Hover and click share this so the preview a pointer
 * shows always belongs to the message a click would jump to.
 */
export function resolveMinimapTickIndex(
  ticks: readonly MinimapTick[],
  fraction: number
): number | null {
  if (ticks.length === 0) return null

  const target = clampFraction(fraction)
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < ticks.length; index += 1) {
    const tick = ticks[index]
    if (target >= tick.top && target <= tick.top + tick.height) return index

    const distance = Math.abs(tick.top + tick.height / 2 - target)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }

  return nearestIndex
}

/**
 * Index of the message shown at the top of the viewport, which is what the rail reports as its
 * current position. Falls back to the last mark when the viewport sits past every loaded message,
 * e.g. while the after-spacer is being scrolled.
 */
export function findMinimapTickIndexAt(
  ticks: readonly MinimapTick[],
  window: MinimapViewportWindow | null
): number | null {
  if (!window || ticks.length === 0) return null

  let low = 0
  let high = ticks.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (ticks[middle].top + ticks[middle].height > window.top) {
      high = middle
    } else {
      low = middle + 1
    }
  }

  return low >= ticks.length ? ticks.length - 1 : low
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0
  // Rounded so a value like `1 - 0.9` reaches the DOM as 0.1 instead of 0.09999999999999998.
  return Number(Math.min(Math.max(value, 0), 1).toFixed(6))
}
