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
  livePaused: false,
  liveSyncing: false,
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
  applyServerFilters: vi.fn(async () => true),
  applyServerSort: vi.fn(async () => true),
  setLoadedSearch: vi.fn(),
  toggleCollapsed: vi.fn(),
  setPrependScrollAnchor: vi.fn(),
  selectRow: vi.fn(),
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
      '<div data-testid="recycle-scroller" :data-item-size="itemSize" :data-key-field="keyField"><slot v-for="item in items.slice(0, 16)" :item="item" /></div>',
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
    template: '<div data-testid="tape-inspector-row" />'
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
    inspectorStore.sessionId = null
    inspectorStore.tapeIncarnationId = 'incarnation-1'
    inspectorStore.records = []
    inspectorStore.evidence = []
    inspectorStore.rows = [{ key: 'fact:incarnation:entry:1', recordType: 'fact' }]
    inspectorStore.hasOlder = false
    inspectorStore.loadingOlder = false
    inspectorStore.liveSyncing = false
    inspectorStore.livePaused = false
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
    expect(sessionClient.stopHeadListener).toHaveBeenCalledOnce()
    expect(sessionClient.unsubscribeTapeInspectorHead).toHaveBeenCalledWith(expect.any(String))
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

  it('zooms, pans, brushes, and resets the waterfall viewport', async () => {
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    const viewport = wrapper.get('[data-testid="tape-inspector-waterfall-brush"]')
    vi.spyOn(viewport.element, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 16,
      width: 200,
      height: 16,
      toJSON: () => ({})
    })

    expect(viewport.attributes('aria-valuetext')).toBe('0%–100%')
    await viewport.trigger('keydown', { key: '+' })
    expect(viewport.attributes('aria-valuetext')).toBe('15%–85%')
    await viewport.trigger('keydown', { key: 'ArrowRight' })
    expect(viewport.attributes('aria-valuetext')).toBe('22%–92%')

    await viewport.trigger('pointerdown', { button: 0, pointerId: 11, clientX: 40 })
    await viewport.trigger('pointermove', { pointerId: 11, clientX: 120 })
    await viewport.trigger('pointerup', { pointerId: 11, clientX: 120 })
    expect(viewport.attributes('aria-valuetext')).toBe('20%–60%')

    viewport.element.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        deltaX: 20,
        deltaY: 0
      })
    )
    await flushPromises()
    expect(viewport.attributes('aria-valuetext')).toBe('24%–64%')

    await wrapper.get('button[title="common.reset"]').trigger('click')
    expect(viewport.attributes('aria-valuetext')).toBe('0%–100%')
  })

  it('keeps the selected waterfall time window when the loaded range changes', async () => {
    inspectorStore.records = [
      { entryId: 1, createdAt: 100 },
      { entryId: 2, createdAt: 200 }
    ]
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    const viewport = wrapper.get('[data-testid="tape-inspector-waterfall-brush"]')
    vi.spyOn(viewport.element, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 16,
      width: 200,
      height: 16,
      toJSON: () => ({})
    })
    await viewport.trigger('pointerdown', { button: 0, pointerId: 13, clientX: 40 })
    await viewport.trigger('pointermove', { pointerId: 13, clientX: 120 })
    await viewport.trigger('pointerup', { pointerId: 13, clientX: 120 })
    expect(viewport.attributes('aria-valuetext')).toBe('20%–60%')

    inspectorStore.records = [
      { entryId: 0, createdAt: 0 },
      { entryId: 1, createdAt: 100 },
      { entryId: 2, createdAt: 200 }
    ]
    await flushPromises()
    expect(viewport.attributes('aria-valuetext')).toBe('60%–80%')

    inspectorStore.records = [
      { entryId: 0, createdAt: 0 },
      { entryId: 1, createdAt: 100 },
      { entryId: 2, createdAt: 200 },
      { entryId: 3, createdAt: 400 }
    ]
    await flushPromises()
    expect(viewport.attributes('aria-valuetext')).toBe('30%–40%')
  })

  it('keeps a waterfall viewport anchored to the live time tail', async () => {
    inspectorStore.records = [
      { entryId: 1, createdAt: 100 },
      { entryId: 2, createdAt: 200 }
    ]
    const wrapper = mount(TapeInspectorPanel, {
      props: {
        sessionId: 'session-1',
        openRequest: null
      }
    })
    await flushPromises()
    const viewport = wrapper.get('[data-testid="tape-inspector-waterfall-brush"]')
    await viewport.trigger('keydown', { key: '+' })
    await viewport.trigger('keydown', { key: 'ArrowRight' })
    await viewport.trigger('keydown', { key: 'ArrowRight' })
    await viewport.trigger('keydown', { key: 'ArrowRight' })
    expect(viewport.attributes('aria-valuetext')).toBe('30%–100%')

    inspectorStore.records = [
      { entryId: 1, createdAt: 100 },
      { entryId: 2, createdAt: 200 },
      { entryId: 3, createdAt: 300 }
    ]
    await flushPromises()
    expect(viewport.attributes('aria-valuetext')).toBe('65%–100%')
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
    ;(scroller.element as HTMLElement).scrollTop = 48
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
    expect(scrollerMethods.scrollToPosition).toHaveBeenCalledWith(120)
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
