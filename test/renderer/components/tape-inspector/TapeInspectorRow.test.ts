import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { TapeInspectorFactRow } from '@/components/tape-inspector/model'

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
  it('exposes a stable row identity and table position', () => {
    const wrapper = mount(TapeInspectorRow, {
      props: {
        row: factRow({ key: 'fact:incarnation-1:entry:10' }),
        selected: true,
        ariaRowIndex: 12
      }
    })

    expect(wrapper.attributes('id')).toBe('tape-inspector-row-fact%3Aincarnation-1%3Aentry%3A10')
    expect(wrapper.attributes('aria-selected')).toBe('true')
    expect(wrapper.attributes('aria-rowindex')).toBe('12')
    expect(wrapper.attributes('tabindex')).toBeUndefined()
  })

  it('surfaces bounded provider and outcome facts without opening detail', () => {
    const wrapper = mount(TapeInspectorRow, {
      props: {
        row: factRow({
          status: 'completed',
          record: {
            recordType: 'fact',
            key: 'entry:10',
            entryId: 10,
            family: 'attempt',
            kind: 'event',
            name: 'provider/attempt_completed',
            createdAt: 1_000,
            facts: {
              providerId: 'provider-1',
              modelId: 'model-1',
              outcome: 'completed'
            }
          }
        }),
        selected: false
      }
    })

    expect(wrapper.text()).toContain('provider/attempt_completed')
    expect(wrapper.text()).toContain('provider-1 / model-1 · completed')
    expect(wrapper.classes()).toContain('h-12')
  })

  it('keeps timeline glyphs out of the semantic ledger row', () => {
    const wrapper = mount(TapeInspectorRow, {
      props: {
        row: factRow({ durationMs: 100, actualEndAt: 1_100, actualWidth: 0.5 }),
        selected: false
      }
    })

    expect(wrapper.find('[data-testid="tape-inspector-sequence-marker"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tape-inspector-actual-span"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tape-inspector-actual-point"]').exists()).toBe(false)
  })
})
