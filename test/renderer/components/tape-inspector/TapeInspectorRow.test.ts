import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type {
  TapeInspectorEvidenceRow,
  TapeInspectorFactRow
} from '@/components/tape-inspector/model'

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
    statusState: 'not_applicable',
    durationMs: null,
    timingState: 'point',
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

function evidenceRow(overrides: Partial<TapeInspectorEvidenceRow> = {}): TapeInspectorEvidenceRow {
  return {
    key: 'trace:trace-1',
    depth: 1,
    status: null,
    statusState: 'not_applicable',
    durationMs: null,
    timingState: 'point',
    sequenceEntryId: null,
    sequenceStart: 1,
    actualStartAt: 1_100,
    actualEndAt: null,
    actualStart: 0.75,
    actualWidth: 0,
    recordType: 'evidence',
    record: {
      recordType: 'evidence',
      key: 'trace:trace-1',
      traceId: 'trace-1',
      messageId: 'message-1',
      requestSeq: 2,
      providerId: 'provider-1',
      modelId: 'model-1',
      createdAt: 1_100,
      truncated: false
    },
    parentGroupKey: null,
    association: 'request',
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
          statusState: 'explicit',
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

  it('names Memory and tool activity and shows their bounded summaries inline', () => {
    const memory = mount(TapeInspectorRow, {
      props: {
        row: factRow({
          record: {
            recordType: 'fact',
            key: 'entry:10',
            entryId: 10,
            family: 'anchor',
            kind: 'anchor',
            name: 'memory/view_assembled',
            createdAt: 1_000,
            facts: {
              selectedCount: 2,
              droppedCount: 1,
              estimatedTokens: 90,
              tokenBudget: 256
            }
          }
        }),
        selected: false
      }
    })
    expect(memory.text()).toContain('tapeInspector.activity.memoryView')
    expect(memory.text()).toContain('tapeInspector.activity.memorySelection')
    expect(memory.text()).toContain('tapeInspector.activity.tokenUse')

    const tool = mount(TapeInspectorRow, {
      props: {
        row: factRow({
          record: {
            recordType: 'fact',
            key: 'entry:11',
            entryId: 11,
            family: 'tool',
            kind: 'tool_result',
            name: 'read_file',
            createdAt: 1_100,
            facts: { toolName: 'read_file', contentPreview: 'final recorded output' }
          }
        }),
        selected: false
      }
    })
    expect(tool.text()).toContain('tapeInspector.activity.toolResult · read_file')
    expect(tool.text()).toContain('final recorded output')
  })

  it('shows bounded transcript context inline without changing the virtual row height', () => {
    const wrapper = mount(TapeInspectorRow, {
      props: {
        row: factRow({
          record: {
            recordType: 'fact',
            key: 'entry:10',
            entryId: 10,
            family: 'message',
            kind: 'message',
            name: 'message/user',
            messageId: 'message-1',
            createdAt: 1_000
          }
        }),
        selected: false,
        messagePreview: { role: 'user', text: 'How will next month compare?' }
      }
    })

    expect(wrapper.text()).toContain('tapeInspector.activity.userMessage')
    expect(wrapper.text()).toContain('tapeInspector.activity.user: How will next month compare?')
    expect(wrapper.classes()).toContain('h-12')
  })

  it('presents a request-scoped trace without repeating lane-level guidance', () => {
    const wrapper = mount(TapeInspectorRow, {
      props: {
        row: evidenceRow(),
        selected: false,
        requestActivity: {
          relation: 'output',
          activity: {
            key: 'tool-1',
            kind: 'tool',
            text: 'files / read_file',
            preview: 'files / read_file',
            timestamp: 1_050,
            blockIndex: 0,
            truncated: false
          }
        }
      }
    })

    expect(wrapper.text()).toContain('tapeInspector.evidence.request · provider-1/model-1')
    expect(wrapper.text()).toContain(
      'tapeInspector.activity.relations.output · tapeInspector.groups.tool: files / read_file'
    )
    expect(wrapper.text()).not.toContain('tapeInspector.evidence.standaloneSummary')
    expect(wrapper.text()).not.toContain('tapeInspector.evidence.standaloneHint')
    expect(wrapper.text()).not.toContain('unresolved')
    expect(wrapper.classes()).toContain('h-12')
  })

  it('keeps timeline glyphs out of the semantic ledger row', () => {
    const wrapper = mount(TapeInspectorRow, {
      props: {
        row: factRow({
          durationMs: 100,
          timingState: 'span',
          actualEndAt: 1_100,
          actualWidth: 0.5
        }),
        selected: false
      }
    })

    expect(wrapper.find('[data-testid="tape-inspector-sequence-marker"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tape-inspector-actual-span"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tape-inspector-actual-point"]').exists()).toBe(false)
  })

  it('collapses secondary columns into readable metadata at compact widths', () => {
    const row = factRow({
      status: 'completed',
      statusState: 'explicit',
      durationMs: 25,
      timingState: 'span',
      actualEndAt: 1_025
    })
    const compact = mount(TapeInspectorRow, {
      props: {
        row,
        selected: false,
        layout: 'compact',
        gridTemplateColumns: 'minmax(0, 1fr)',
        tableMinWidth: 0
      }
    })

    expect(compact.findAll('[role="gridcell"]')).toHaveLength(1)
    expect(compact.text()).toContain('event · 1970-01-01T00:00:01.000Z · 25 ms')
    expect(compact.text()).toContain('completed')
    expect(compact.attributes('style')).toContain('min-width: 0px')

    const medium = mount(TapeInspectorRow, {
      props: {
        row,
        selected: false,
        layout: 'medium',
        gridTemplateColumns: 'minmax(0, 1fr) 96px 96px',
        tableMinWidth: 0
      }
    })
    expect(medium.findAll('[role="gridcell"]')).toHaveLength(3)
    expect(medium.text()).toContain('event · 1970-01-01T00:00:01.000Z')
  })

  it('keeps inapplicable values quiet and distinguishes incomplete authoritative state', () => {
    const point = mount(TapeInspectorRow, {
      props: { row: factRow(), selected: false }
    })
    const pointStatus = point.get('[data-status-state="not_applicable"]')
    const pointTiming = point.get('[data-timing-state="point"]')

    expect(pointStatus.text()).toBe('—')
    expect(pointStatus.attributes('title')).toBe('tapeInspector.states.notApplicable')
    expect(pointTiming.text()).toBe('—')
    expect(pointTiming.attributes('title')).toBe('tapeInspector.waterfall.point')
    expect(point.text()).not.toContain('tapeInspector.states.unknown')

    const unresolved = mount(TapeInspectorRow, {
      props: {
        row: factRow({ statusState: 'unresolved', timingState: 'unresolved' }),
        selected: false
      }
    })

    expect(unresolved.get('[data-status-state="unresolved"]').text()).toBe(
      'tapeInspector.states.statusPending'
    )
    expect(unresolved.get('[data-timing-state="unresolved"]').text()).toBe(
      'tapeInspector.states.timingPending'
    )
  })
})
