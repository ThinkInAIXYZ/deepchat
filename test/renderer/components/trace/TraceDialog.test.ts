import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { listMessageTraceDiagnosticsMock, listMessageTracesMock, listMessageViewManifestsMock } =
  vi.hoisted(() => ({
    listMessageTraceDiagnosticsMock: vi.fn(),
    listMessageTracesMock: vi.fn(),
    listMessageViewManifestsMock: vi.fn()
  }))

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

vi.mock('stream-monaco', () => ({
  useMonaco: () => ({
    createEditor: vi.fn(),
    updateCode: vi.fn(),
    cleanupEditor: vi.fn(),
    getEditorView: vi.fn().mockReturnValue({
      updateOptions: vi.fn()
    })
  })
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
    Tabs: { name: 'Tabs', template: '<div><slot /></div>' },
    TabsContent: { name: 'TabsContent', template: '<div><slot /></div>' },
    TabsList: { name: 'TabsList', template: '<div><slot /></div>' },
    TabsTrigger: {
      name: 'TabsTrigger',
      props: ['value'],
      template: '<button @click="$emit(\'click\')"><slot /></button>'
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
    listMessageTraceDiagnosticsMock.mockResolvedValue({ traces: [], manifests: [] })
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
      manifests: [
        {
          sessionId: 's1',
          messageId: 'm1',
          requestSeq: 1,
          entryId: 9,
          createdAt: 2000,
          manifest: {
            schemaVersion: 1,
            viewId: 'view_abc',
            sessionId: 's1',
            messageId: 'm1',
            requestSeq: 1,
            taskType: 'chat',
            policy: 'legacy_context_v1',
            policyVersion: 1,
            contextBuilderVersion: 'legacy-v1',
            latestEntryId: 8,
            anchorEntryIds: [1],
            included: [
              {
                entryId: 2,
                messageId: 'u1',
                orderSeq: 1,
                role: 'user',
                source: 'tape',
                reason: 'selected_history'
              }
            ],
            excluded: [],
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
        }
      ]
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
})
