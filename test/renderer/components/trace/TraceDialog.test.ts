import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { listMessageTracesMock } = vi.hoisted(() => ({
  listMessageTracesMock: vi.fn()
}))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    listMessageTraces: listMessageTracesMock
  })
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
  it('shows latest trace by default and supports switching trace history', async () => {
    listMessageTracesMock.mockResolvedValue([
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
    ])

    const wrapper = mountDialog()

    await wrapper.setProps({ messageId: 'm1' })
    await flushPromises()

    expect(listMessageTracesMock).toHaveBeenCalledWith('m1')
    expect(wrapper.text()).toContain('https://api.example.com/second')

    const historyButton = wrapper.findAll('button').find((btn) => btn.text().trim() === '#1')
    expect(historyButton).toBeDefined()

    await historyButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('https://api.example.com/first')
  })
})
