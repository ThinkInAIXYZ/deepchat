import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const inspectorStoreData = vi.hoisted(() => ({
  sessionId: null as string | null,
  tapeIncarnationId: 'incarnation-1' as string | null,
  loadedSearch: '',
  loadingSearchFill: false,
  serverFilters: {},
  serverSort: { column: 'entryId' as const, direction: 'asc' as const },
  canonicalSort: true,
  records: [] as Array<{ entryId: number; createdAt: number }>,
  evidence: [],
  rows: [{ key: 'fact:incarnation:entry:1', recordType: 'fact' }],
  overviewRows: [] as Array<{ key: string; recordType: string }>,
  selectedKey: null,
  selectedRow: null as {
    key: string
    recordType: 'fact' | 'group' | 'evidence' | 'evidence_lane'
  } | null,
  selectedDetail: null,
  selectedCapabilities: null,
  loadingInitial: false,
  loadingOlder: false,
  loadingNewer: false,
  loadingEvidence: false,
  loadingDetail: false,
  errorCode: null,
  livePaused: false,
  liveSyncing: false,
  liveEvidenceRevision: 0,
  canLoadNewer: true,
  hasOlder: false,
  hasMoreEvidence: false,
  initialize: vi.fn(async (sessionId: string) => {
    inspectorStore.sessionId = sessionId
    return true
  }),
  handleLiveHeadPulse: vi.fn(async () => true),
  setLivePaused: vi.fn(async (paused: boolean) => {
    inspectorStore.livePaused = paused
    return true
  }),
  loadOlderPage: vi.fn(async () => false),
  loadNewerPage: vi.fn(async () => true),
  loadMoreEvidence: vi.fn(async () => false),
  startEvidenceRefresh: vi.fn(),
  applyServerFilters: vi.fn(async () => true),
  applyServerSort: vi.fn(async () => true),
  setLoadedSearch: vi.fn(),
  toggleCollapsed: vi.fn(),
  setPrependScrollAnchor: vi.fn(),
  selectRow: vi.fn(),
  revealOverviewRow: vi.fn(() => true),
  moveSelection: vi.fn(() => null),
  loadSelectedDetail: vi.fn(async () => true),
  clear: vi.fn()
}))
const inspectorStore = reactive(inspectorStoreData)

const sessionClient = vi.hoisted(() => ({
  exportTapeInspectorSupportTrace: vi.fn(),
  subscribeTapeInspectorHead: vi.fn(async () => ({
    subscribed: true as const,
    tapeIncarnationId: 'incarnation-1',
    maxEntryId: 20
  })),
  unsubscribeTapeInspectorHead: vi.fn(async () => ({ unsubscribed: true as const })),
  onTapeInspectorHeadChanged: vi.fn((listener: (payload: unknown) => void) => {
    sessionClient.headListener = listener
    return sessionClient.stopHeadListener
  }),
  headListener: null as ((payload: unknown) => void) | null,
  stopHeadListener: vi.fn()
}))

const downloadBlob = vi.hoisted(() => vi.fn())
const scrollerMethods = vi.hoisted(() => ({
  scrollToItem: vi.fn(),
  scrollToPosition: vi.fn()
}))

vi.mock('@/components/tape-inspector/store', () => ({
  useTapeInspectorStore: () => inspectorStore
}))

vi.mock('../../../../src/renderer/api/SessionClient', () => ({
  createSessionClient: () => sessionClient
}))

vi.mock('@/lib/download', () => ({ downloadBlob }))

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
      '<div data-testid="recycle-scroller" :data-item-size="itemSize" :data-key-field="keyField"><slot v-for="(item, index) in items.slice(0, 16)" :item="item" :index="index" /></div>',
    methods: {
      scrollToItem(index: number) {
        scrollerMethods.scrollToItem(index)
      },
      scrollToPosition(position: number) {
        scrollerMethods.scrollToPosition(position)
      }
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
    props: ['row', 'selected', 'ariaRowIndex', 'layout'],
    emits: ['select'],
    computed: {
      rowDomId() {
        return `tape-inspector-row-${encodeURIComponent(this.row.key)}`
      }
    },
    template:
      '<div :id="rowDomId" data-testid="tape-inspector-row" :data-layout="layout" :aria-selected="selected" :aria-rowindex="ariaRowIndex" @click="$emit(\'select\', row.key)" />'
  })
}))

vi.mock('@/components/tape-inspector/TapeInspectorDetailPane.vue', () => ({
  default: defineComponent({
    name: 'TapeInspectorDetailPane',
    props: ['placement'],
    emits: ['close'],
    template:
      '<div data-testid="detail-pane" :data-placement="placement"><button data-testid="close-detail" @click="$emit(\'close\')" /></div>'
  })
}))

vi.mock('@/components/tape-inspector/TapeInspectorTimeline.vue', () => ({
  default: defineComponent({
    name: 'TapeInspectorTimeline',
    props: ['rows', 'selectedKey', 'hasUnloadedHistory'],
    emits: ['select'],
    template:
      '<button data-testid="timeline" @click="$emit(\'select\', rows[0]?.key)">timeline</button>'
  })
}))

import TapeInspectorPanel from '@/components/tape-inspector/TapeInspectorPanel.vue'

describe('TapeInspectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inspectorStore.sessionId = null
    inspectorStore.tapeIncarnationId = 'incarnation-1'
    inspectorStore.records = []
    inspectorStore.evidence = []
    inspectorStore.rows = [{ key: 'fact:incarnation:entry:1', recordType: 'fact' }]
    inspectorStore.overviewRows = []
    inspectorStore.selectedKey = null
    inspectorStore.selectedRow = null
    inspectorStore.selectedDetail = null
    inspectorStore.selectedCapabilities = null
    inspectorStore.hasOlder = false
    inspectorStore.loadingOlder = false
    inspectorStore.liveSyncing = false
    inspectorStore.livePaused = false
    inspectorStore.liveEvidenceRevision = 0
    inspectorStore.serverSort = { column: 'entryId', direction: 'asc' }
    inspectorStore.canonicalSort = true
    sessionClient.headListener = null
    sessionClient.subscribeTapeInspectorHead.mockResolvedValue({
      subscribed: true,
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 20
    })
    sessionClient.exportTapeInspectorSupportTrace.mockResolvedValue({
      status: 'ok',
      trace: {
        schemaVersion: 1,
        exportedAt: 1_700_000_000_000,
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-1',
        snapshotMaxEntryId: 20,
        facts: [],
        evidence: [],
        truncated: { facts: false, evidence: false, detailData: false }
      }
    })
    inspectorStore.loadOlderPage.mockResolvedValue(false)
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
    expect(sessionClient.subscribeTapeInspectorHead).toHaveBeenCalledWith(
      'session-1',
      expect.any(String)
    )
    expect(inspectorStore.handleLiveHeadPulse).toHaveBeenCalledWith({
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 20
    })
    expect(inspectorStore.startEvidenceRefresh).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="recycle-scroller"]').attributes('data-item-size')).toBe('48')
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
    expect(sessionClient.stopHeadListener).toHaveBeenCalledOnce()
    expect(sessionClient.unsubscribeTapeInspectorHead).toHaveBeenCalledWith(expect.any(String))
  })

  it('moves keyboard selection without reopening detail until Enter', async () => {
    inspectorStore.moveSelection.mockImplementationOnce(() => {
      inspectorStore.selectedKey = 'fact:incarnation:entry:1'
      inspectorStore.selectedRow = {
        key: 'fact:incarnation:entry:1',
        recordType: 'fact'
      }
      return inspectorStore.selectedKey
    })
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    await wrapper.get('[role="grid"]').trigger('keydown', {
      key: 'ArrowDown'
    })

    expect(inspectorStore.moveSelection).toHaveBeenCalledWith(1)
    expect(wrapper.find('[data-testid="detail-pane"]').exists()).toBe(false)
    expect(inspectorStore.loadSelectedDetail).not.toHaveBeenCalled()

    await wrapper.get('[role="grid"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(inspectorStore.loadSelectedDetail).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="detail-pane"]').exists()).toBe(true)
  })

  it('exposes virtual row selection through the focused grid', async () => {
    inspectorStore.rows = [
      { key: 'fact:incarnation:entry:1', recordType: 'fact' },
      { key: 'group:request:["message-1",2]', recordType: 'group' }
    ]
    inspectorStore.selectedKey = 'fact:incarnation:entry:1'
    inspectorStore.moveSelection.mockImplementationOnce(() => {
      inspectorStore.selectedKey = 'group:request:["message-1",2]'
      return inspectorStore.selectedKey
    })
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      },
      attachTo: document.body
    })
    await flushPromises()
    const grid = wrapper.get('[role="grid"]')

    expect(grid.attributes('aria-rowcount')).toBe('3')
    expect(grid.attributes('aria-activedescendant')).toBe(
      'tape-inspector-row-fact%3Aincarnation%3Aentry%3A1'
    )
    expect(
      wrapper.findAll('[data-testid="tape-inspector-row"]')[1].attributes('aria-rowindex')
    ).toBe('3')

    grid.element.focus()
    await grid.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()

    expect(grid.attributes('aria-activedescendant')).toBe(
      'tape-inspector-row-group%3Arequest%3A%5B%22message-1%22%2C2%5D'
    )
    expect(scrollerMethods.scrollToItem).toHaveBeenCalledWith(1)
    expect(document.activeElement).toBe(grid.element)

    inspectorStore.selectRow.mockImplementationOnce((key: string) => {
      inspectorStore.selectedKey = key
    })
    await wrapper.findAll('[data-testid="tape-inspector-row"]')[0].trigger('click')
    expect(document.activeElement).toBe(grid.element)
    expect(grid.attributes('aria-activedescendant')).toBe(
      'tape-inspector-row-fact%3Aincarnation%3Aentry%3A1'
    )
    wrapper.unmount()
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

  it('requests a global server sort from sortable column headers', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    await wrapper.findAll('[aria-sort="none"]')[0].trigger('click')

    expect(inspectorStore.applyServerSort).toHaveBeenCalledWith({
      column: 'name',
      direction: 'asc'
    })
  })

  it('resizes columns with pointer and keyboard input within bounded widths', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    const resize = wrapper.get('[data-testid="tape-inspector-resize-name"]')

    expect(resize.attributes('aria-valuenow')).toBe('280')
    await resize.trigger('keydown', { key: 'ArrowRight' })
    expect(resize.attributes('aria-valuenow')).toBe('296')

    await resize.trigger('pointerdown', { button: 0, pointerId: 7, clientX: 100 })
    await resize.trigger('pointermove', { pointerId: 7, clientX: 500 })
    expect(resize.attributes('aria-valuenow')).toBe('560')
    await resize.trigger('pointercancel', { pointerId: 7 })
    await resize.trigger('pointermove', { pointerId: 7, clientX: 0 })
    expect(resize.attributes('aria-valuenow')).toBe('560')
  })

  it('reveals and selects a record from the overview timeline', async () => {
    inspectorStore.overviewRows = [{ key: 'fact:incarnation:entry:1', recordType: 'fact' }]
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="timeline"]').trigger('click')
    await flushPromises()

    expect(inspectorStore.revealOverviewRow).toHaveBeenCalledWith('fact:incarnation:entry:1')
    expect(inspectorStore.loadSelectedDetail).toHaveBeenCalledOnce()
  })

  it('does not reserve detail space until a row is selected', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="detail-pane"]').exists()).toBe(false)
  })

  it('closes detail without clearing selection and restores ledger focus', async () => {
    inspectorStore.selectedKey = 'fact:incarnation:entry:1'
    inspectorStore.selectedRow = { key: 'fact:incarnation:entry:1', recordType: 'fact' }
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      },
      attachTo: document.body
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="detail-pane"]').attributes('data-placement')).toBe('side')
    await wrapper.get('[data-testid="close-detail"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="detail-pane"]').exists()).toBe(false)
    expect(inspectorStore.selectedKey).toBe('fact:incarnation:entry:1')
    expect(inspectorStore.selectRow).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(wrapper.get('[role="grid"]').element)
    wrapper.unmount()
  })

  it('emits the optional focused inspection action', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null,
        isFullscreen: false
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="tape-inspector-fullscreen-toggle"]').trigger('click')
    expect(wrapper.emitted('toggleFullscreen')).toHaveLength(1)
  })

  it('restores the same visible key and pixel offset after prepending older rows', async () => {
    inspectorStore.hasOlder = true
    inspectorStore.rows = [
      { key: 'fact:incarnation:entry:10', recordType: 'fact' },
      { key: 'fact:incarnation:entry:11', recordType: 'fact' },
      { key: 'fact:incarnation:entry:12', recordType: 'fact' }
    ]
    inspectorStore.loadOlderPage.mockImplementationOnce(async () => {
      inspectorStore.rows = [
        { key: 'fact:incarnation:entry:8', recordType: 'fact' },
        { key: 'fact:incarnation:entry:9', recordType: 'fact' },
        { key: 'fact:incarnation:entry:10', recordType: 'fact' },
        { key: 'fact:incarnation:entry:11', recordType: 'fact' },
        { key: 'fact:incarnation:entry:12', recordType: 'fact' }
      ]
      return true
    })
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    const scroller = wrapper.findComponent({ name: 'RecycleScroller' })
    ;(scroller.element as HTMLElement).scrollTop = 60
    const loadOlder = wrapper
      .findAll('button')
      .find((button) => button.text() === 'tapeInspector.actions.loadOlder')
    if (!loadOlder) throw new Error('Expected the load-older action')

    await loadOlder.trigger('click')
    await flushPromises()

    expect(inspectorStore.setPrependScrollAnchor).toHaveBeenNthCalledWith(1, {
      key: 'fact:incarnation:entry:11',
      offset: 12
    })
    expect(scrollerMethods.scrollToPosition).toHaveBeenCalledWith(156)
    expect(inspectorStore.setPrependScrollAnchor).toHaveBeenLastCalledWith(null)
  })

  it('keeps a high-entry fixture inside the virtualized render window', async () => {
    inspectorStore.rows = Array.from({ length: 10_000 }, (_, index) => ({
      key: `fact:incarnation:entry:${index + 1}`,
      recordType: 'fact'
    }))
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'RecycleScroller' }).props('items')).toHaveLength(10_000)
    expect(wrapper.findAll('[data-testid="tape-inspector-row"]')).toHaveLength(16)
  })

  it('forwards live pulses and pauses only automatic following', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    inspectorStore.handleLiveHeadPulse.mockClear()

    sessionClient.headListener?.({
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 21
    })
    await flushPromises()

    expect(inspectorStore.handleLiveHeadPulse).toHaveBeenCalledWith({
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 21
    })

    await wrapper.get('[data-testid="tape-inspector-live-toggle"]').trigger('click')
    expect(inspectorStore.setLivePaused).toHaveBeenCalledWith(true)
    expect(sessionClient.unsubscribeTapeInspectorHead).not.toHaveBeenCalled()
  })

  it('restores tail following when resume catches up paused rows', async () => {
    inspectorStore.livePaused = true
    inspectorStore.rows = Array.from({ length: 10 }, (_, index) => ({
      key: `fact:incarnation:entry:${index + 1}`,
      recordType: 'fact'
    }))
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    scrollerMethods.scrollToItem.mockClear()
    const scroller = wrapper.get('[data-testid="recycle-scroller"]').element as HTMLElement
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 72 },
      scrollHeight: { configurable: true, value: 360 }
    })
    scroller.scrollTop = 288
    await wrapper.get('[data-testid="recycle-scroller"]').trigger('scroll')
    inspectorStore.setLivePaused.mockImplementationOnce(async () => {
      inspectorStore.livePaused = false
      inspectorStore.rows = Array.from({ length: 15 }, (_, index) => ({
        key: `fact:incarnation:entry:${index + 1}`,
        recordType: 'fact'
      }))
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 540 })
      return true
    })

    await wrapper.get('[data-testid="tape-inspector-live-toggle"]').trigger('click')
    await flushPromises()

    expect(inspectorStore.setLivePaused).toHaveBeenCalledWith(false)
    expect(scrollerMethods.scrollToItem).toHaveBeenCalledWith(14)
  })

  it('follows evidence-only appends only while the viewport is at the tail', async () => {
    inspectorStore.rows = Array.from({ length: 10 }, (_, index) => ({
      key: `fact:incarnation:entry:${index + 1}`,
      recordType: 'fact'
    }))
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    scrollerMethods.scrollToItem.mockClear()
    const scrollerWrapper = wrapper.get('[data-testid="recycle-scroller"]')
    const scroller = scrollerWrapper.element as HTMLElement
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 72 },
      scrollHeight: { configurable: true, value: 360 }
    })
    scroller.scrollTop = 288
    await scrollerWrapper.trigger('scroll')

    inspectorStore.rows = Array.from({ length: 11 }, (_, index) => ({
      key: `fact:incarnation:entry:${index + 1}`,
      recordType: 'fact'
    }))
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 396 })
    inspectorStore.liveEvidenceRevision += 1
    await flushPromises()

    expect(scrollerMethods.scrollToItem).toHaveBeenLastCalledWith(10)

    scrollerMethods.scrollToItem.mockClear()
    scroller.scrollTop = 72
    await scrollerWrapper.trigger('scroll')
    inspectorStore.rows = Array.from({ length: 12 }, (_, index) => ({
      key: `fact:incarnation:entry:${index + 1}`,
      recordType: 'fact'
    }))
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 432 })
    inspectorStore.liveEvidenceRevision += 1
    await flushPromises()

    expect(scrollerMethods.scrollToItem).not.toHaveBeenCalled()
  })

  it('continues following after a live pulse appends multiple rows at the tail', async () => {
    inspectorStore.rows = Array.from({ length: 10 }, (_, index) => ({
      key: `fact:incarnation:entry:${index + 1}`,
      recordType: 'fact'
    }))
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    scrollerMethods.scrollToItem.mockClear()
    const scroller = wrapper.get('[data-testid="recycle-scroller"]').element as HTMLElement
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 72 },
      scrollHeight: { configurable: true, value: 360 }
    })
    scroller.scrollTop = 288
    inspectorStore.handleLiveHeadPulse.mockImplementationOnce(async () => {
      inspectorStore.rows = Array.from({ length: 15 }, (_, index) => ({
        key: `fact:incarnation:entry:${index + 1}`,
        recordType: 'fact'
      }))
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 540 })
      return true
    })

    sessionClient.headListener?.({
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 15
    })
    await flushPromises()

    expect(scrollerMethods.scrollToItem).toHaveBeenCalledWith(14)
  })

  it('does not force live rows into view after the user leaves the tail', async () => {
    inspectorStore.rows = Array.from({ length: 10 }, (_, index) => ({
      key: `fact:incarnation:entry:${index + 1}`,
      recordType: 'fact'
    }))
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    scrollerMethods.scrollToItem.mockClear()
    const scroller = wrapper.get('[data-testid="recycle-scroller"]').element as HTMLElement
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 72 },
      scrollHeight: { configurable: true, value: 360 }
    })
    scroller.scrollTop = 72
    inspectorStore.handleLiveHeadPulse.mockImplementationOnce(async () => {
      inspectorStore.rows = Array.from({ length: 15 }, (_, index) => ({
        key: `fact:incarnation:entry:${index + 1}`,
        recordType: 'fact'
      }))
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 540 })
      return true
    })

    sessionClient.headListener?.({
      sessionId: 'session-1',
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 15
    })
    await flushPromises()

    expect(scrollerMethods.scrollToItem).not.toHaveBeenCalled()
  })

  it('unsubscribes a late successful registration after unmount', async () => {
    let resolveSubscription!: (value: {
      subscribed: true
      tapeIncarnationId: string
      maxEntryId: number
    }) => void
    sessionClient.subscribeTapeInspectorHead.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubscription = resolve
      })
    )
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    wrapper.unmount()
    resolveSubscription({
      subscribed: true,
      tapeIncarnationId: 'incarnation-1',
      maxEntryId: 20
    })
    await flushPromises()

    expect(sessionClient.unsubscribeTapeInspectorHead).toHaveBeenCalledWith(expect.any(String))
    expect(inspectorStore.handleLiveHeadPulse).not.toHaveBeenCalled()
  })

  it('downloads a bounded support trace with a sanitized filename', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session/unsafe',
        openRequest: null
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="tape-inspector-export"]').trigger('click')
    await flushPromises()

    expect(sessionClient.exportTapeInspectorSupportTrace).toHaveBeenCalledWith({
      sessionId: 'session/unsafe',
      expectedTapeIncarnationId: 'incarnation-1'
    })
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'tape-inspector-session_unsafe-2023-11-14T22-13-20-000Z.json'
    )
  })

  it('reinitializes instead of downloading an export from a stale incarnation', async () => {
    sessionClient.exportTapeInspectorSupportTrace.mockResolvedValueOnce({
      status: 'reset',
      tapeIncarnationId: 'incarnation-2',
      snapshotMaxEntryId: 1
    })
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    inspectorStore.initialize.mockClear()

    await wrapper.get('[data-testid="tape-inspector-export"]').trigger('click')
    await flushPromises()

    expect(downloadBlob).not.toHaveBeenCalled()
    expect(inspectorStore.initialize).toHaveBeenCalledWith('session-1', { preselection: null })
  })

  it('drops a late export response after switching sessions', async () => {
    let resolveExport!: (value: {
      status: 'ok'
      trace: {
        schemaVersion: 1
        exportedAt: number
        sessionId: string
        tapeIncarnationId: string
        snapshotMaxEntryId: number
        facts: never[]
        evidence: never[]
        truncated: { facts: boolean; evidence: boolean; detailData: boolean }
      }
    }) => void
    sessionClient.exportTapeInspectorSupportTrace.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExport = resolve
      })
    )
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="tape-inspector-export"]').trigger('click')
    expect(sessionClient.exportTapeInspectorSupportTrace).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ sessionId: 'session-2' })
    await flushPromises()
    resolveExport({
      status: 'ok',
      trace: {
        schemaVersion: 1,
        exportedAt: 1_700_000_000_000,
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-1',
        snapshotMaxEntryId: 20,
        facts: [],
        evidence: [],
        truncated: { facts: false, evidence: false, detailData: false }
      }
    })
    await flushPromises()

    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('drops a late export response after the Tape incarnation changes', async () => {
    let resolveExport!: (value: {
      status: 'ok'
      trace: {
        schemaVersion: 1
        exportedAt: number
        sessionId: string
        tapeIncarnationId: string
        snapshotMaxEntryId: number
        facts: never[]
        evidence: never[]
        truncated: { facts: boolean; evidence: boolean; detailData: boolean }
      }
    }) => void
    sessionClient.exportTapeInspectorSupportTrace.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExport = resolve
      })
    )
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()

    await wrapper.get('[data-testid="tape-inspector-export"]').trigger('click')
    inspectorStore.tapeIncarnationId = 'incarnation-2'
    resolveExport({
      status: 'ok',
      trace: {
        schemaVersion: 1,
        exportedAt: 1_700_000_000_000,
        sessionId: 'session-1',
        tapeIncarnationId: 'incarnation-1',
        snapshotMaxEntryId: 20,
        facts: [],
        evidence: [],
        truncated: { facts: false, evidence: false, detailData: false }
      }
    })
    await flushPromises()

    expect(downloadBlob).not.toHaveBeenCalled()
  })
})
