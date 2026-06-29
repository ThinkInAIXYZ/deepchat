import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const {
  listMessageTraceDiagnosticsMock,
  listMessageTracesMock,
  listMessageViewManifestsMock,
  createEditorMock,
  updateCodeMock,
  cleanupEditorMock,
  updateOptionsMock,
  layoutMock,
  setThemeMock,
  getEditorViewMock,
  getEditorMock,
  useMonacoMock,
  themeStoreMock
} = vi.hoisted(() => {
  const createEditorMock = vi.fn()
  const updateCodeMock = vi.fn()
  const cleanupEditorMock = vi.fn()
  const updateOptionsMock = vi.fn()
  const layoutMock = vi.fn()
  const setThemeMock = vi.fn()
  const getEditorViewMock = vi.fn().mockReturnValue({
    updateOptions: updateOptionsMock,
    layout: layoutMock
  })
  const getEditorMock = vi.fn().mockReturnValue({
    setTheme: setThemeMock
  })
  const useMonacoMock = vi.fn(() => ({
    createEditor: createEditorMock,
    updateCode: updateCodeMock,
    cleanupEditor: cleanupEditorMock,
    getEditorView: getEditorViewMock,
    getEditor: getEditorMock
  }))

  return {
    listMessageTraceDiagnosticsMock: vi.fn(),
    listMessageTracesMock: vi.fn(),
    listMessageViewManifestsMock: vi.fn(),
    createEditorMock,
    updateCodeMock,
    cleanupEditorMock,
    updateOptionsMock,
    layoutMock,
    setThemeMock,
    getEditorViewMock,
    getEditorMock,
    useMonacoMock,
    themeStoreMock: {
      isDark: false
    }
  }
})

vi.mock('@api/SessionClient', () => ({
  createSessionClient: vi.fn(() => ({
    listMessageTraceDiagnostics: listMessageTraceDiagnosticsMock,
    listMessageTraces: listMessageTracesMock,
    listMessageViewManifests: listMessageViewManifestsMock
  }))
}))

vi.mock('@api/DeviceClient', () => ({
  createDeviceClient: vi.fn(() => ({
    copyText: vi.fn()
  }))
}))

vi.mock('@/stores/uiSettingsStore', () => ({
  useUiSettingsStore: () => ({
    formattedCodeFontFamily: 'monospace'
  })
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => themeStoreMock
}))

vi.mock('stream-monaco', () => ({
  useMonaco: useMonacoMock
}))

vi.mock(
  '@shadcn/components/ui/dialog',
  () => ({
    Dialog: { name: 'Dialog', template: '<div><slot /></div>' },
    DialogContent: { name: 'DialogContent', template: '<div><slot /></div>' },
    DialogHeader: { name: 'DialogHeader', template: '<div><slot /></div>' },
    DialogTitle: { name: 'DialogTitle', template: '<div><slot /></div>' },
    DialogFooter: { name: 'DialogFooter', template: '<div><slot /></div>' }
  }),
  { virtual: true }
)

vi.mock(
  '@shadcn/components/ui/button',
  () => ({
    Button: {
      name: 'Button',
      template: '<button @click="$emit(\'click\')"><slot /></button>'
    }
  }),
  { virtual: true }
)

vi.mock(
  '@shadcn/components/ui/tabs',
  () => ({
    Tabs: {
      name: 'Tabs',
      props: ['modelValue', 'defaultValue'],
      emits: ['update:modelValue'],
      data() {
        return { active: this.modelValue ?? this.defaultValue ?? null }
      },
      watch: {
        modelValue(value) {
          this.active = value
        }
      },
      provide() {
        return {
          getActiveTab: () => this.active,
          setActiveTab: (value: string) => {
            this.active = value
            this.$emit('update:modelValue', value)
          }
        }
      },
      template: '<div><slot /></div>'
    },
    TabsContent: {
      name: 'TabsContent',
      inject: ['getActiveTab'],
      props: ['value'],
      template: '<div v-if="!value || getActiveTab() === value"><slot /></div>'
    },
    TabsList: { name: 'TabsList', template: '<div><slot /></div>' },
    TabsTrigger: {
      name: 'TabsTrigger',
      inject: ['setActiveTab'],
      props: ['value'],
      template: '<button @click="setActiveTab(value)"><slot /></button>'
    }
  }),
  { virtual: true }
)

vi.mock(
  '@shadcn/components/ui/spinner',
  () => ({
    Spinner: { name: 'Spinner', template: '<div class="spinner" />' }
  }),
  { virtual: true }
)

vi.mock(
  '@shadcn/components/ui/badge',
  () => ({
    Badge: {
      name: 'Badge',
      props: ['variant'],
      template: '<span class="badge" :data-variant="variant"><slot /></span>'
    }
  }),
  { virtual: true }
)

vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    props: ['icon'],
    template: '<span :data-icon="icon"></span>'
  }
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

import TraceDialog from '@/components/trace/TraceDialog.vue'

const makeManifestRecord = (
  requestSeq: number,
  viewId: string,
  overrides: {
    integrity?: 'valid' | 'invalid' | 'unverified'
    reconstructionAnchorEntryId?: number | null
    anchorEntryIds?: number[]
    excludedRanges?: Array<{
      fromOrderSeq: number
      toOrderSeq: number
      count: number
      reason: string
    }>
  } = {}
) => ({
  sessionId: 's1',
  messageId: 'm1',
  requestSeq,
  entryId: requestSeq,
  createdAt: 2000,
  ...(overrides.integrity ? { integrity: overrides.integrity } : {}),
  manifest: {
    schemaVersion: 2,
    hashVersion: 2,
    viewId,
    sessionId: 's1',
    messageId: 'm1',
    requestSeq,
    taskType: 'chat',
    policy: 'legacy_context_v1',
    policyVersion: 1,
    contextBuilderVersion: 'legacy-v1',
    latestEntryId: 8,
    anchorEntryIds: overrides.anchorEntryIds ?? [1],
    ...(overrides.reconstructionAnchorEntryId !== undefined
      ? { reconstructionAnchorEntryId: overrides.reconstructionAnchorEntryId }
      : {}),
    included: [],
    excluded: [],
    ...(overrides.excludedRanges ? { excludedRanges: overrides.excludedRanges } : {}),
    tokenBudget: {
      contextLength: 1000,
      requestedMaxTokens: 100,
      effectiveMaxTokens: 100,
      reserveTokens: 100,
      toolReserveTokens: 0,
      estimatedPromptTokens: 12
    },
    hashes: {
      promptHash: 'prompt_hash',
      toolDefinitionsHash: 'tool_hash',
      manifestHash: 'manifest_hash'
    },
    meta: {
      providerId: 'openai',
      modelId: 'gpt-4o',
      summaryCursorOrderSeq: 1,
      supportsVision: true,
      supportsAudioInput: false,
      traceDebugEnabled: false
    },
    assembledAt: 2000
  }
})

const mountDialog = () =>
  mount(TraceDialog, {
    props: {
      messageId: null,
      agentId: null
    }
  })

describe('TraceDialog', () => {
  beforeEach(() => {
    listMessageTraceDiagnosticsMock.mockReset()
    listMessageTracesMock.mockReset()
    listMessageViewManifestsMock.mockReset()
    createEditorMock.mockReset()
    updateCodeMock.mockReset()
    cleanupEditorMock.mockReset()
    updateOptionsMock.mockReset()
    layoutMock.mockReset()
    setThemeMock.mockReset()
    getEditorViewMock.mockReset()
    getEditorViewMock.mockReturnValue({
      updateOptions: updateOptionsMock,
      layout: layoutMock
    })
    getEditorMock.mockReset()
    getEditorMock.mockReturnValue({
      setTheme: setThemeMock
    })
    useMonacoMock.mockReset()
    useMonacoMock.mockImplementation(() => ({
      createEditor: createEditorMock,
      updateCode: updateCodeMock,
      cleanupEditor: cleanupEditorMock,
      getEditorView: getEditorViewMock,
      getEditor: getEditorMock
    }))
    themeStoreMock.isDark = false
    listMessageTraceDiagnosticsMock.mockResolvedValue({ traces: [], manifests: [] })
  })

  it('keeps the request preview constrained inside the dialog layout', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [
        {
          id: 't1',
          messageId: 'm1',
          sessionId: 's1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          requestSeq: 1,
          endpoint: 'https://api.example.com/first',
          headersJson: '{"x":"1"}',
          bodyJson: '{"b":1}',
          truncated: false,
          createdAt: 2000
        }
      ],
      manifests: []
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    const dialogContent = wrapper.getComponent({ name: 'DialogContent' })
    expect(dialogContent.classes()).toEqual(
      expect.arrayContaining(['h-[80vh]', 'max-h-[80vh]', 'flex', 'flex-col', 'overflow-hidden'])
    )

    const tabs = wrapper.getComponent({ name: 'Tabs' })
    expect(tabs.classes()).toEqual(
      expect.arrayContaining(['h-0', 'flex-1', 'min-h-0', 'flex', 'flex-col', 'overflow-hidden'])
    )

    const requestContent = wrapper.getComponent({ name: 'TabsContent' })
    expect(requestContent.classes()).toEqual(
      expect.arrayContaining(['h-0', 'flex-1', 'min-h-0', 'overflow-hidden'])
    )
    expect(requestContent.classes()).not.toContain('min-h-[300px]')
  })

  it('initializes Monaco with the resolved light theme', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [
        {
          id: 't1',
          messageId: 'm1',
          sessionId: 's1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          requestSeq: 1,
          endpoint: 'https://api.example.com/first',
          headersJson: '{"x":"1"}',
          bodyJson: '{"b":1}',
          truncated: false,
          createdAt: 2000
        }
      ],
      manifests: []
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(useMonacoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        themes: ['vitesse-dark', 'vitesse-light'],
        theme: 'vitesse-light'
      })
    )
    expect(createEditorMock).toHaveBeenCalled()
    expect(setThemeMock).toHaveBeenCalledWith('vitesse-light')
  })

  it('shows latest trace by default and supports switching trace history', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [
        {
          id: 't2',
          messageId: 'm1',
          sessionId: 's1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          requestSeq: 2,
          endpoint: 'https://api.example.com/second',
          headersJson: '{"x":"2"}',
          bodyJson: '{"b":2}',
          truncated: false,
          createdAt: 2000
        },
        {
          id: 't1',
          messageId: 'm1',
          sessionId: 's1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          requestSeq: 1,
          endpoint: 'https://api.example.com/first',
          headersJson: '{"x":"1"}',
          bodyJson: '{"b":1}',
          truncated: false,
          createdAt: 1000
        }
      ],
      manifests: []
    })

    const wrapper = mountDialog()

    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(listMessageTraceDiagnosticsMock).toHaveBeenCalledWith('m1')
    expect(wrapper.text()).toContain('https://api.example.com/second')

    const historyButton = wrapper.findAll('button').find((btn) => btn.text().trim() === '#1')
    expect(historyButton).toBeDefined()

    await historyButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('https://api.example.com/first')
  })

  it('shows view manifest diagnostics when request traces are empty', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [],
      manifests: [makeManifestRecord(1, 'view_abc')]
    })

    const wrapper = mountDialog()

    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(listMessageTraceDiagnosticsMock).toHaveBeenCalledWith('m1')
    expect(wrapper.text()).toContain('view_abc')
    expect(wrapper.text()).toContain('legacy_context_v1')
    expect(wrapper.text()).toContain('traceDialog.policyVersion')
    expect(wrapper.text()).toContain('1')
  })

  it('does not fall back to a different request when selected manifest has no trace', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [
        {
          id: 't2',
          messageId: 'm1',
          sessionId: 's1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          requestSeq: 2,
          endpoint: 'https://api.example.com/second',
          headersJson: '{"x":"2"}',
          bodyJson: '{"b":2}',
          truncated: false,
          createdAt: 2000
        }
      ],
      manifests: [makeManifestRecord(1, 'view_only_manifest')]
    })

    const wrapper = mountDialog()

    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(wrapper.text()).toContain('https://api.example.com/second')

    const manifestOnlyButton = wrapper.findAll('button').find((btn) => btn.text().trim() === '#1')
    expect(manifestOnlyButton).toBeDefined()

    await manifestOnlyButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('traceDialog.requestUnavailable')
    expect(wrapper.text()).not.toContain('https://api.example.com/second')

    const viewTab = wrapper
      .findAll('button')
      .find((btn) => btn.text().trim() === 'traceDialog.tabs.view')
    expect(viewTab).toBeDefined()

    await viewTab!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('view_only_manifest')
  })

  it('surfaces an invalid integrity badge with a warning', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [],
      manifests: [makeManifestRecord(1, 'view_invalid', { integrity: 'invalid' })]
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(wrapper.text()).toContain('traceDialog.integrity.label')
    expect(wrapper.text()).toContain('traceDialog.integrity.invalid')
    expect(wrapper.text()).toContain('traceDialog.integrity.invalidWarning')
    expect(wrapper.find('[data-variant="destructive"]').exists()).toBe(true)
  })

  it('explains an unverified manifest without alarming', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [],
      manifests: [makeManifestRecord(1, 'view_unverified', { integrity: 'unverified' })]
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(wrapper.text()).toContain('traceDialog.integrity.unverified')
    expect(wrapper.text()).toContain('traceDialog.integrity.unverifiedNote')
    expect(wrapper.text()).not.toContain('traceDialog.integrity.invalidWarning')
    expect(wrapper.find('[data-variant="outline"]').exists()).toBe(true)
  })

  it('shows a non-alarming badge for a valid manifest', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [],
      manifests: [makeManifestRecord(1, 'view_valid', { integrity: 'valid' })]
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(wrapper.text()).toContain('traceDialog.integrity.label')
    expect(wrapper.text()).toContain('traceDialog.integrity.valid')
    expect(wrapper.find('[data-variant="secondary"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('traceDialog.integrity.invalidWarning')
    expect(wrapper.text()).not.toContain('traceDialog.integrity.unverifiedNote')
  })

  it('omits the integrity badge when integrity is absent', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [],
      manifests: [makeManifestRecord(1, 'view_plain')]
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(wrapper.text()).not.toContain('traceDialog.integrity.label')
    expect(wrapper.find('.badge').exists()).toBe(false)
  })

  it('keeps the invalid warning visible when a trace defaults to the request tab', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [
        {
          id: 't1',
          messageId: 'm1',
          sessionId: 's1',
          providerId: 'openai',
          modelId: 'gpt-4o',
          requestSeq: 1,
          endpoint: 'https://api.example.com/first',
          headersJson: '{"x":"1"}',
          bodyJson: '{"b":1}',
          truncated: false,
          createdAt: 2000
        }
      ],
      manifests: [makeManifestRecord(1, 'view_invalid_with_trace', { integrity: 'invalid' })]
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    // A trace is present, so the dialog defaults to the request tab, not view.
    expect(wrapper.text()).not.toContain('view_invalid_with_trace')
    // The invalid warning is still visible from the always-on summary header.
    expect(wrapper.text()).toContain('traceDialog.integrity.invalidWarning')
    expect(wrapper.find('[data-variant="destructive"]').exists()).toBe(true)
  })

  it('shows reconstruction lineage in the view overview', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [],
      manifests: [
        makeManifestRecord(1, 'view_lineage', {
          reconstructionAnchorEntryId: 5,
          anchorEntryIds: [5]
        })
      ]
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(wrapper.text()).toContain('traceDialog.reconstructionAnchor')
    expect(wrapper.text()).toContain('traceDialog.anchorEntryIds')
    expect(wrapper.text()).toContain('traceDialog.schemaVersion')
    expect(wrapper.text()).toContain('traceDialog.hashVersion')
    expect(wrapper.text()).toContain('5')
  })

  it('renders the compacted region from excludedRanges in the entries tab', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [],
      manifests: [
        makeManifestRecord(1, 'view_ranges', {
          excludedRanges: [
            { fromOrderSeq: 1, toOrderSeq: 9, count: 9, reason: 'before_summary_cursor' }
          ]
        })
      ]
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    const entriesTab = wrapper
      .findAll('button')
      .find((btn) => btn.text().trim() === 'traceDialog.tabs.entries')
    expect(entriesTab).toBeDefined()
    await entriesTab!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('traceDialog.compactedRanges')
    expect(wrapper.text()).toContain('before_summary_cursor')
    expect(wrapper.text()).toContain('9')
  })

  it('omits the compacted region when there are no excludedRanges', async () => {
    listMessageTraceDiagnosticsMock.mockResolvedValue({
      traces: [],
      manifests: [makeManifestRecord(1, 'view_no_ranges')]
    })

    const wrapper = mountDialog()
    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    const entriesTab = wrapper
      .findAll('button')
      .find((btn) => btn.text().trim() === 'traceDialog.tabs.entries')
    expect(entriesTab).toBeDefined()
    await entriesTab!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('traceDialog.compactedRanges')
  })
})
