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

const message = (id: string, role: 'user' | 'assistant'): DisplayMessage =>
  ({ id, role }) as DisplayMessage

const tick = (id: string, top: number, height: number): MinimapTick => ({
  id,
  top,
  height,
  role: 'assistant'
})

describe('buildMinimapTicks', () => {
  it('maps every loaded message onto fractions of the scrolled height', () => {
    const ticks = buildMinimapTicks({
      entries: [entry('m1', 0, 200), entry('m2', 200, 300), entry('m3', 300, 1000)],
      messages: [message('m1', 'user'), message('m2', 'assistant'), message('m3', 'assistant')],
      totalHeight: 1000
    })

    expect(ticks).toEqual([
      { id: 'm1', top: 0, height: 0.2, role: 'user' },
      { id: 'm2', top: 0.2, height: 0.1, role: 'assistant' },
      { id: 'm3', top: 0.3, height: 0.7, role: 'assistant' }
    ])
  })

  it('claims nothing without usable geometry', () => {
    expect(
      buildMinimapTicks({
        entries: [entry('m1', 0, 200)],
        messages: [message('m1', 'user')],
        totalHeight: 0
      })
    ).toEqual([])
    expect(buildMinimapTicks({ entries: [], messages: [], totalHeight: 500 })).toEqual([])
  })

  it('falls back to the assistant role for an entry with no loaded message', () => {
    const ticks = buildMinimapTicks({
      entries: [entry('gone', 0, 500)],
      messages: [],
      totalHeight: 500
    })

    expect(ticks).toEqual([{ id: 'gone', top: 0, height: 1, role: 'assistant' }])
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
