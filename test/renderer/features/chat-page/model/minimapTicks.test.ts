import { describe, expect, it } from 'vitest'
import {
  buildMinimapTicks,
  buildMinimapViewportWindow,
  findMinimapTickIndexAt,
  resolveMinimapTickIndex,
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

    // The longest message fills the rail; the others are proportional to it.
    expect(ticks.map((tick) => tick.width)).toEqual([0.25, 0.5, 1])
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

describe('resolveMinimapTickIndex', () => {
  const ticks = [tick('m1', 0, 0.2), tick('m2', 0.2, 0.2), tick('m3', 0.4, 0.6)]

  it('resolves a click inside a mark to that message', () => {
    expect(resolveMinimapTickIndex(ticks, 0.1)).toBe(0)
    expect(resolveMinimapTickIndex(ticks, 0.3)).toBe(1)
    expect(resolveMinimapTickIndex(ticks, 0.9)).toBe(2)
  })

  it('resolves a click in a gap to the nearest mark instead of doing nothing', () => {
    // Between m2 (ends 0.4) and m3 (starts 0.4) there is no gap here, so use a sparse layout.
    const sparse = [tick('m1', 0, 0.1), tick('m2', 0.5, 0.1)]
    expect(resolveMinimapTickIndex(sparse, 0.2)).toBe(0)
    expect(resolveMinimapTickIndex(sparse, 0.6)).toBe(1)
  })

  it('clamps positions outside the rail and ignores an empty map', () => {
    expect(resolveMinimapTickIndex(ticks, -1)).toBe(0)
    expect(resolveMinimapTickIndex(ticks, 2)).toBe(2)
    expect(resolveMinimapTickIndex([], 0.5)).toBeNull()
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
