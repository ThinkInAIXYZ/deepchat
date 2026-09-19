import { describe, expect, it } from 'vitest'
import {
  buildMinimapTicks,
  buildMinimapViewportWindow,
  findMinimapTickIndexAt,
  resolveRailScrollTop,
  type MinimapTick
} from '@/features/chat-page/model/minimapTicks'
import type { MessageLayoutEntry } from '@/composables/message/useMessageWindow'
import type { DisplayMessage } from '@/features/chat-page/model/displayMessage'

const entry = (id: string, top: number, bottom: number): MessageLayoutEntry => ({
  id,
  measurementKey: id,
  orderSeq: 0,
  estimatedHeight: bottom - top,
  top,
  bottom
})

const message = (
  id: string,
  text: string,
  role: 'user' | 'assistant' = 'assistant'
): DisplayMessage =>
  ({
    id,
    role,
    content: { files: [], links: [], think: false, search: false, text }
  }) as DisplayMessage

const tick = (id: string, top: number, height: number): MinimapTick => ({
  id,
  top,
  height,
  width: 1
})

describe('buildMinimapTicks', () => {
  it('maps every loaded message onto fractions of the scrolled height', () => {
    const ticks = buildMinimapTicks({
      entries: [entry('m1', 0, 200), entry('m2', 200, 300), entry('m3', 300, 1000)],
      messages: [
        message('m1', 'first message'),
        message('m2', 'second'),
        message('m3', 'third message, the longest of the three')
      ],
      totalHeight: 1000
    })

    expect(ticks.map(({ id, top, height }) => ({ id, top, height }))).toEqual([
      { id: 'm1', top: 0, height: 0.2 },
      { id: 'm2', top: 0.2, height: 0.1 },
      { id: 'm3', top: 0.3, height: 0.7 }
    ])
  })

  it('sizes every mark against the longest message in the conversation', () => {
    const ticks = buildMinimapTicks({
      entries: [entry('short', 0, 100), entry('half', 100, 200), entry('long', 200, 300)],
      messages: [
        message('short', 'abcd'),
        message('half', 'abcdefgh'),
        message('long', 'abcdefghijklmnop')
      ],
      totalHeight: 300
    })

    // The longest message fills the rail and the others scale against it, on a square-root curve so
    // that a conversation with one very long answer does not reduce every question to a hairline.
    expect(ticks[2].width).toBe(1)
    expect(ticks[0].width).toBeCloseTo(Math.sqrt(0.25), 5)
    expect(ticks[1].width).toBeCloseTo(Math.sqrt(0.5), 5)
  })

  it('keeps a short question visible next to a very long answer', () => {
    // Measured on a real session: 55 characters against 7837 is a 140:1 ratio. Raw proportions put
    // the question on the 2 px floor; the compressed scale keeps it on the rail.
    const ticks = buildMinimapTicks({
      entries: [entry('question', 0, 100), entry('answer', 100, 200)],
      messages: [message('question', 'x'.repeat(55)), message('answer', 'y'.repeat(7837))],
      totalHeight: 200
    })

    expect(Math.max(ticks[0].width * 40, 2)).toBeGreaterThanOrEqual(3)
  })

  it('keeps the marks hairline-wide when no message has any text', () => {
    const ticks = buildMinimapTicks({
      entries: [entry('m1', 0, 100), entry('m2', 100, 200)],
      messages: [message('m1', ''), message('m2', '')],
      totalHeight: 200
    })

    expect(ticks.map((tick) => tick.width)).toEqual([1, 1])
  })

  it('claims nothing without usable geometry', () => {
    expect(
      buildMinimapTicks({
        entries: [entry('m1', 0, 200)],
        messages: [message('m1', 'text')],
        totalHeight: 0
      })
    ).toEqual([])
    expect(buildMinimapTicks({ entries: [], messages: [], totalHeight: 500 })).toEqual([])
  })

  it('measures a message whose content is not loaded as empty', () => {
    const ticks = buildMinimapTicks({
      entries: [entry('gone', 0, 500), entry('here', 500, 1000)],
      messages: [message('here', 'twelve chars')],
      totalHeight: 1000
    })

    expect(ticks[0].width).toBe(0)
    expect(ticks[1].width).toBe(1)
  })
})

describe('buildMinimapViewportWindow', () => {
  it('places the visible slice in the same fractions as the ticks', () => {
    expect(
      buildMinimapViewportWindow({ viewportTop: 250, viewportHeight: 250, totalHeight: 1000 })
    ).toEqual({ top: 0.25, height: 0.25 })
  })

  it('clips the window at the end of the content', () => {
    expect(
      buildMinimapViewportWindow({ viewportTop: 900, viewportHeight: 400, totalHeight: 1000 })
    ).toEqual({ top: 0.9, height: 0.1 })
  })

  it('reports nothing before the geometry is known', () => {
    expect(
      buildMinimapViewportWindow({ viewportTop: 0, viewportHeight: 0, totalHeight: 1000 })
    ).toBeNull()
    expect(
      buildMinimapViewportWindow({ viewportTop: 0, viewportHeight: 500, totalHeight: 0 })
    ).toBeNull()
  })
})

describe('findMinimapTickIndexAt', () => {
  const ticks = [tick('m1', 0, 0.2), tick('m2', 0.2, 0.2), tick('m3', 0.4, 0.6)]

  it('reports the message shown at the top of the viewport', () => {
    expect(findMinimapTickIndexAt(ticks, { top: 0, height: 0.1 })).toBe(0)
    expect(findMinimapTickIndexAt(ticks, { top: 0.25, height: 0.1 })).toBe(1)
    expect(findMinimapTickIndexAt(ticks, { top: 0.5, height: 0.1 })).toBe(2)
  })

  it('keeps the last mark while the viewport sits past every loaded message', () => {
    expect(findMinimapTickIndexAt(ticks, { top: 0.99, height: 0.01 })).toBe(2)
  })

  it('reports nothing without a window or marks', () => {
    expect(findMinimapTickIndexAt(ticks, null)).toBeNull()
    expect(findMinimapTickIndexAt([], { top: 0, height: 0.1 })).toBeNull()
  })
})

describe('resolveRailScrollTop', () => {
  const rail = { pitch: 16, railHeight: 160 }

  it('leaves a visible mark alone, so browsing the rail is not undone', () => {
    expect(resolveRailScrollTop({ ...rail, index: 5, scrollTop: 0 })).toBeNull()
    expect(resolveRailScrollTop({ ...rail, index: 0, scrollTop: 0 })).toBeNull()
  })

  it('scrolls back to a mark above the visible slice', () => {
    expect(resolveRailScrollTop({ ...rail, index: 2, scrollTop: 160 })).toBe(32)
  })

  it('scrolls down just far enough for a mark below the visible slice', () => {
    // Mark 20 spans 320-336; with a 160 px rail the smallest offset that shows it is 176.
    expect(resolveRailScrollTop({ ...rail, index: 20, scrollTop: 0 })).toBe(176)
  })

  it('does nothing before the rail has been measured', () => {
    expect(resolveRailScrollTop({ pitch: 16, railHeight: 0, index: 20, scrollTop: 0 })).toBeNull()
  })
})
