import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const inspectorStore = vi.hoisted(() => ({
  loadedSearch: '',
  serverFilters: {},
  records: [],
  evidence: [],
  rows: [{ key: 'fact:incarnation:entry:1', recordType: 'fact' }],
  selectedKey: null,
  selectedRow: null,
  selectedDetail: null,
  selectedCapabilities: null,
  loadingInitial: false,
  loadingOlder: false,
  loadingNewer: false,
  loadingEvidence: false,
  loadingDetail: false,
  errorCode: null,
  canLoadNewer: true,
  hasOlder: false,
  hasMoreEvidence: false,
  initialize: vi.fn(async () => true),
  loadOlderPage: vi.fn(async () => false),
  loadNewerPage: vi.fn(async () => true),
  loadMoreEvidence: vi.fn(async () => false),
  applyServerFilters: vi.fn(async () => true),
  setLoadedSearch: vi.fn(),
  toggleCollapsed: vi.fn(),
  setPrependScrollAnchor: vi.fn(),
  selectRow: vi.fn(),
  moveSelection: vi.fn(() => null),
  loadSelectedDetail: vi.fn(async () => true),
  clear: vi.fn()
}))

vi.mock('@/components/tape-inspector/store', () => ({
  useTapeInspectorStore: () => inspectorStore
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<span />'
  })
}))

vi.mock('vue-virtual-scroller', () => ({
  RecycleScroller: defineComponent({
    name: 'RecycleScroller',
    props: ['items', 'itemSize', 'keyField'],
    template:
      '<div data-testid="recycle-scroller" :data-item-size="itemSize" :data-key-field="keyField"><slot v-for="item in items" :item="item" /></div>',
    methods: {
      scrollToItem: vi.fn(),
      scrollToPosition: vi.fn()
    }
  })
}))

vi.mock('@shadcn/components/ui/input', () => ({
  Input: defineComponent({
    name: 'Input',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  })
}))

vi.mock('@shadcn/components/ui/checkbox', () => ({
  Checkbox: defineComponent({
    name: 'Checkbox',
    props: ['checked'],
    emits: ['update:checked'],
    template: '<input type="checkbox" :checked="checked" />'
  })
}))

vi.mock('@dc-ui/components/button', () => ({
  DcButton: defineComponent({
    name: 'DcButton',
    props: ['disabled'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  })
}))

vi.mock('@dc-ui/components/popover', () => ({
  DcPopover: defineComponent({
    name: 'DcPopover',
    template: '<div><slot name="trigger" /><slot /></div>'
  })
}))

vi.mock('@/components/tape-inspector/TapeInspectorRow.vue', () => ({
  default: defineComponent({
    name: 'TapeInspectorRow',
    template: '<div />'
  })
}))

vi.mock('@/components/tape-inspector/TapeInspectorDetailPane.vue', () => ({
  default: defineComponent({
    name: 'TapeInspectorDetailPane',
    template: '<div data-testid="detail-pane" />'
  })
}))

import TapeInspectorPanel from '@/components/tape-inspector/TapeInspectorPanel.vue'

describe('TapeInspectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes a matching message request without inventing a request sequence', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: {
          sessionId: 'session-1',
          messageId: 'message-1',
          token: 1
        }
      }
    })
    await flushPromises()

    expect(inspectorStore.initialize).toHaveBeenCalledWith('session-1', {
      preselection: {
        messageId: 'message-1'
      }
    })
    expect(wrapper.get('[data-testid="recycle-scroller"]').attributes('data-item-size')).toBe('36')
  })

  it('does not apply a stale request from another session', async () => {
    mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-2',
        openRequest: {
          sessionId: 'session-1',
          messageId: 'message-1',
          requestSeq: 4,
          token: 2
        }
      }
    })
    await flushPromises()

    expect(inspectorStore.initialize).toHaveBeenCalledWith('session-2', {
      preselection: null
    })
  })

  it('cancels pending Inspector reads when the panel unmounts', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    wrapper.unmount()
    expect(inspectorStore.clear).toHaveBeenCalledTimes(1)
  })

  it('moves selection and loads details with keyboard navigation', async () => {
    inspectorStore.moveSelection.mockReturnValueOnce('fact:incarnation:entry:1')
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="tape-inspector-panel"]').trigger('keydown', {
      key: 'ArrowDown'
    })

    expect(inspectorStore.moveSelection).toHaveBeenCalledWith(1)
    expect(inspectorStore.loadSelectedDetail).toHaveBeenCalledTimes(1)
  })

  it('does not hijack arrow keys from interactive controls', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    await wrapper.get('input').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.get('button').trigger('keydown', { key: 'ArrowDown' })

    expect(inspectorStore.moveSelection).not.toHaveBeenCalled()
  })
})
