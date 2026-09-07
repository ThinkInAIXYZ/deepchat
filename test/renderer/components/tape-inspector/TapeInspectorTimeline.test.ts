import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type {
  TapeInspectorDisplayRow,
  TapeInspectorEvidenceRow,
  TapeInspectorFactRow
} from '@/components/tape-inspector/model'
import { buildTapeInspectorTimelineItems } from '@/components/tape-inspector/timeline'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
    d: (value: Date) => value.toISOString()
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<span />'
  })
}))

import TapeInspectorTimeline from '@/components/tape-inspector/TapeInspectorTimeline.vue'

function factRow(
  entryId: number,
  overrides: Partial<TapeInspectorFactRow> = {}
): TapeInspectorFactRow {
  return {
    key: `fact:incarnation-1:entry:${entryId}`,
    depth: 0,
    status: null,
    statusState: 'not_applicable',
    durationMs: null,
    timingState: 'point',
    sequenceEntryId: entryId,
    sequenceStart: entryId / 100,
    actualStartAt: entryId * 10,
    actualEndAt: null,
    actualStart: entryId / 100,
    actualWidth: 0,
    recordType: 'fact',
    record: {
      recordType: 'fact',
      key: `entry:${entryId}`,
      entryId,
      family: 'other',
      kind: 'event',
      name: `event/${entryId}`,
      createdAt: entryId * 10
    },
    ...overrides
  }
}

function evidenceRow(): TapeInspectorEvidenceRow {
  return {
    key: 'trace:trace-1',
    depth: 1,
    status: null,
    statusState: 'not_applicable',
    durationMs: null,
    timingState: 'point',
    sequenceEntryId: null,
    sequenceStart: 0.5,
    actualStartAt: 500,
    actualEndAt: null,
    actualStart: 0.5,
    actualWidth: 0,
    recordType: 'evidence',
    record: {
      recordType: 'evidence',
      key: 'trace:trace-1',
      traceId: 'trace-1',
      messageId: 'message-1',
      requestSeq: 1,
      providerId: 'provider-1',
      modelId: 'model-1',
      createdAt: 500,
      truncated: false
    },
    parentGroupKey: null,
    association: 'request'
  }
}

describe('TapeInspectorTimeline', () => {
  it('bounds dense projections by semantic lane and preserves selected bucket priority', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) =>
      factRow(index + 1, {
        sequenceStart: (index % 100) / 99,
        actualStart: (index % 100) / 99
      })
    )
    const selected = rows.at(-1)!
    const items = buildTapeInspectorTimelineItems({
      rows,
      mode: 'actual',
      viewportStart: 0,
      viewportEnd: 1,
      selectedKey: selected.key,
      bucketsPerLane: 8
    })

    expect(items).toHaveLength(8)
    expect(items.some((item) => item.row.key === selected.key)).toBe(true)
    expect(Math.max(...items.map((item) => item.count))).toBeGreaterThan(1_000)
  })

  it('keeps request evidence out of the canonical Tape sequence', () => {
    const evidence = evidenceRow()

    expect(
      buildTapeInspectorTimelineItems({
        rows: [evidence],
        mode: 'actual',
        viewportStart: 0,
        viewportEnd: 1,
        selectedKey: null
      })
    ).toHaveLength(1)
    expect(
      buildTapeInspectorTimelineItems({
        rows: [evidence],
        mode: 'sequence',
        viewportStart: 0,
        viewportEnd: 1,
        selectedKey: null
      })
    ).toHaveLength(0)
  })

  it('keeps internal diagnostics out of the overview lanes', () => {
    const diagnostic = { ...evidenceRow(), association: 'diagnostic' as const }

    expect(
      buildTapeInspectorTimelineItems({
        rows: [diagnostic],
        mode: 'actual',
        viewportStart: 0,
        viewportEnd: 1,
        selectedKey: null
      })
    ).toHaveLength(0)
  })

  it('does not turn an incomplete authoritative span into an actual-time point', () => {
    const unresolved = factRow(10, { timingState: 'unresolved' })

    expect(
      buildTapeInspectorTimelineItems({
        rows: [unresolved],
        mode: 'actual',
        viewportStart: 0,
        viewportEnd: 1,
        selectedKey: null
      })
    ).toHaveLength(0)
    expect(
      buildTapeInspectorTimelineItems({
        rows: [unresolved],
        mode: 'sequence',
        viewportStart: 0,
        viewportEnd: 1,
        selectedKey: null
      })
    ).toHaveLength(1)
  })

  it('renders three lanes and links a timeline item back to its ledger key', async () => {
    const rows: TapeInspectorDisplayRow[] = [
      factRow(10, { actualStart: 0 }),
      factRow(20, {
        actualStart: 1,
        record: {
          ...factRow(20).record,
          family: 'attempt',
          facts: { providerId: 'provider-1', modelId: 'model-1' }
        }
      })
    ]
    const wrapper = mount(TapeInspectorTimeline, {
      props: { rows, selectedKey: null, hasUnloadedHistory: true }
    })

    expect(wrapper.findAll('[role="slider"]')).toHaveLength(3)
    expect(wrapper.text()).toContain('tapeInspector.timeline.earlierNotLoaded')
    const item = wrapper.get(`[data-row-key="${rows[0].key}"]`)
    await item.trigger('click')

    expect(wrapper.emitted('select')).toEqual([[rows[0].key]])
    expect(item.attributes('title')).toContain('event/10')
    expect(item.attributes('title')).toContain('tapeInspector.waterfall.point')
  })

  it('zooms, pans, brushes, and preserves an absolute window when history prepends', async () => {
    const wrapper = mount(TapeInspectorTimeline, {
      props: {
        rows: [
          factRow(10, { actualStartAt: 100, actualStart: 0 }),
          factRow(20, { actualStartAt: 200, actualStart: 1 })
        ],
        selectedKey: null,
        hasUnloadedHistory: true
      }
    })
    const lane = wrapper.get('[data-testid="tape-inspector-timeline-lane-session"]')
    vi.spyOn(lane.element, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 24,
      width: 200,
      height: 24,
      toJSON: () => ({})
    })

    expect(lane.attributes('aria-valuetext')).toBe('0%–100%')
    await lane.trigger('keydown', { key: '+' })
    expect(lane.attributes('aria-valuetext')).toBe('15%–85%')
    await lane.trigger('pointerdown', { button: 0, pointerId: 10, clientX: 40 })
    await lane.trigger('pointermove', { pointerId: 10, clientX: 120 })
    await lane.trigger('pointerup', { pointerId: 10, clientX: 120 })
    expect(lane.attributes('aria-valuetext')).toBe('29%–57%')

    await wrapper.get('button[title="common.reset"]').trigger('click')
    await lane.trigger('keydown', { key: 'ArrowRight' })
    expect(lane.attributes('aria-valuetext')).toBe('0%–100%')
    await lane.trigger('keydown', { key: '+' })
    await lane.trigger('keydown', { key: 'ArrowRight' })
    expect(lane.attributes('aria-valuetext')).toBe('22%–92%')
    await lane.trigger('pointerdown', { button: 0, pointerId: 11, clientX: 40 })
    await lane.trigger('pointermove', { pointerId: 11, clientX: 120 })
    await lane.trigger('pointerup', { pointerId: 11, clientX: 120 })
    expect(lane.attributes('aria-valuetext')).toBe('36%–64%')

    await wrapper.setProps({
      rows: [
        factRow(0, { actualStartAt: 0, actualStart: 0 }),
        factRow(10, { actualStartAt: 100, actualStart: 0.5 }),
        factRow(20, { actualStartAt: 200, actualStart: 1 })
      ]
    })
    expect(lane.attributes('aria-valuetext')).toBe('68%–82%')

    const reset = wrapper.get('button[title="common.reset"]')
    await reset.trigger('click')
    expect(lane.attributes('aria-valuetext')).toBe('0%–100%')
  })

  it('keeps a zoomed viewport anchored to the live time tail', async () => {
    const wrapper = mount(TapeInspectorTimeline, {
      props: {
        rows: [
          factRow(10, { actualStartAt: 100, actualStart: 0 }),
          factRow(20, { actualStartAt: 200, actualStart: 1 })
        ],
        selectedKey: null,
        hasUnloadedHistory: false
      }
    })
    const lane = wrapper.get('[data-testid="tape-inspector-timeline-lane-session"]')
    await lane.trigger('keydown', { key: '+' })
    await lane.trigger('keydown', { key: 'ArrowRight' })
    await lane.trigger('keydown', { key: 'ArrowRight' })
    await lane.trigger('keydown', { key: 'ArrowRight' })
    expect(lane.attributes('aria-valuetext')).toBe('30%–100%')

    await wrapper.setProps({
      rows: [
        factRow(10, { actualStartAt: 100, actualStart: 0 }),
        factRow(20, { actualStartAt: 200, actualStart: 0.5 }),
        factRow(30, { actualStartAt: 300, actualStart: 1 })
      ]
    })

    expect(lane.attributes('aria-valuetext')).toBe('65%–100%')
  })
})
