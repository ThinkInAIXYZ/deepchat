import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { TapeInspectorFactRow, TapeInspectorGroupRow } from '@/components/tape-inspector/model'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    d: (value: Date) => value.toISOString()
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<span />'
  })
}))

import TapeInspectorRow from '@/components/tape-inspector/TapeInspectorRow.vue'

function factRow(overrides: Partial<TapeInspectorFactRow> = {}): TapeInspectorFactRow {
  return {
    key: 'fact:incarnation-1:entry:10',
    depth: 0,
    status: null,
    durationMs: null,
    sequenceEntryId: 10,
    sequenceStart: 0.5,
    actualStartAt: 1_000,
    actualEndAt: null,
    actualStart: 0.5,
    actualWidth: 0,
    recordType: 'fact',
    record: {
      recordType: 'fact',
      key: 'entry:10',
      entryId: 10,
      family: 'other',
      kind: 'event',
      name: null,
      createdAt: 1_000
    },
    ...overrides
  }
}

describe('TapeInspectorRow', () => {
  it('clips canonical and actual timing markers to the selected viewport', () => {
    const wrapper = mount(TapeInspectorRow, {
      props: {
        row: factRow({
          durationMs: 400,
          sequenceEntryId: 10,
          sequenceStart: 0.5,
          actualStartAt: 1_000,
          actualEndAt: 1_400,
          actualStart: 0.1,
          actualWidth: 0.4
        }),
        selected: false,
        gridTemplateColumns: '200px 80px 80px 100px 100px 300px',
        tableMinWidth: 860,
        waterfallStart: 0.25,
        waterfallEnd: 0.75
      }
    })

    expect(wrapper.attributes('style')).toContain(
      'grid-template-columns: 200px 80px 80px 100px 100px 300px'
    )
    expect(wrapper.attributes('style')).toContain('min-width: 860px')
    expect(wrapper.get('[data-testid="tape-inspector-sequence-marker"]').attributes('style')).toBe(
      'left: 50%;'
    )
    expect(wrapper.get('[data-testid="tape-inspector-actual-span"]').attributes('style')).toBe(
      'left: 0%; width: max(50%, 3px);'
    )
    expect(wrapper.get('[data-testid="tape-inspector-sequence-marker"]').attributes('title')).toBe(
      'tapeInspector.waterfall.sequence · #10'
    )
    expect(wrapper.get('[data-testid="tape-inspector-actual-span"]').attributes('title')).toContain(
      '1970-01-01T00:00:01.000Z → 1970-01-01T00:00:01.400Z'
    )
  })

  it('shows a point only when the row has an authoritative start time', async () => {
    const wrapper = mount(TapeInspectorRow, {
      props: {
        row: factRow(),
        selected: false
      }
    })

    expect(wrapper.find('[data-testid="tape-inspector-actual-point"]').exists()).toBe(true)
    expect(
      wrapper.get('[data-testid="tape-inspector-actual-point"]').attributes('title')
    ).toContain('tapeInspector.waterfall.point')

    const unknownGroup: TapeInspectorGroupRow = {
      key: 'group:request:1',
      depth: 0,
      status: null,
      durationMs: null,
      sequenceEntryId: null,
      sequenceStart: 0.5,
      actualStartAt: null,
      actualEndAt: null,
      actualStart: 0.5,
      actualWidth: 0,
      recordType: 'group',
      group: {
        key: 'group:request:1',
        kind: 'request',
        messageId: 'message-1',
        requestSeq: 1
      },
      collapsed: false
    }
    await wrapper.setProps({ row: unknownGroup })

    expect(wrapper.find('[data-testid="tape-inspector-actual-point"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tape-inspector-sequence-marker"]').exists()).toBe(false)
  })

  it('hides markers that fall entirely outside the viewport', () => {
    const wrapper = mount(TapeInspectorRow, {
      props: {
        row: factRow({
          durationMs: 100,
          sequenceStart: 0.1,
          actualStartAt: 1_000,
          actualEndAt: 1_100,
          actualStart: 0.1,
          actualWidth: 0.05
        }),
        selected: false,
        waterfallStart: 0.5,
        waterfallEnd: 1
      }
    })

    expect(wrapper.find('[data-testid="tape-inspector-sequence-marker"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tape-inspector-actual-span"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tape-inspector-actual-point"]').exists()).toBe(false)
  })
})
