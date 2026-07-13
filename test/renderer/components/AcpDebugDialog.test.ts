import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
})

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

type DebugEventPayload = {
  webContentsId?: number
  agentId: string
  event: {
    id: string
    kind: 'response'
    action: string
    agentId: string
    timestamp: number
  }
  version: number
}

async function setup() {
  vi.resetModules()

  let debugEventListener: ((payload: DebugEventPayload) => void) | null = null
  const stopDebugEvents = vi.fn()
  const providerClient = {
    runAcpDebugAction: vi.fn().mockResolvedValue({
      status: 'ok',
      sessionId: 'debug-session',
      events: []
    }),
    onAcpDebugEvent: vi.fn((listener: (payload: DebugEventPayload) => void) => {
      debugEventListener = listener
      return stopDebugEvents
    })
  }
  const configClient = {
    ensureAcpAgentInstalled: vi.fn().mockResolvedValue({
      status: 'installed'
    })
  }
  const deviceClient = {
    selectDirectory: vi.fn().mockResolvedValue({
      canceled: true,
      filePaths: []
    })
  }

  vi.doMock('@api/ProviderClient', () => ({
    createProviderClient: () => providerClient
  }))
  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@api/DeviceClient', () => ({
    createDeviceClient: () => deviceClient
  }))
  vi.doMock('@api/runtime', () => ({
    getRuntimeWebContentsId: () => Promise.resolve(88)
  }))
  vi.doMock('stream-monaco', () => ({
    useMonaco: () => ({
      createEditor: vi.fn().mockResolvedValue(undefined),
      updateCode: vi.fn(),
      getEditorView: vi.fn(() => ({
        onDidChangeModelContent: vi.fn(),
        getValue: vi.fn(() => '{}')
      })),
      cleanupEditor: vi.fn()
    })
  }))
  vi.doMock('@/stores/uiSettingsStore', () => ({
    useUiSettingsStore: () => ({
      formattedCodeFontFamily: 'JetBrains Mono'
    })
  }))
  vi.doMock('@/components/use-toast', () => ({
    useToast: () => ({
      toast: vi.fn()
    })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: passthrough('Icon')
  }))
  vi.doMock('@shadcn/components/ui/button', () => ({
    Button: buttonStub
  }))
  vi.doMock('@shadcn/components/ui/input', () => ({
    Input: passthrough('Input')
  }))
  vi.doMock('@shadcn/components/ui/badge', () => ({
    Badge: passthrough('Badge')
  }))
  vi.doMock('nanoid', () => ({
    nanoid: () => 'abc123'
  }))

  const AcpDebugDialog = (
    await import('../../../src/renderer/settings/components/AcpDebugDialog.vue')
  ).default

  const wrapper = mount(AcpDebugDialog, {
    props: {
      open: true,
      agentId: 'codex-acp',
      agentName: 'Codex ACP'
    },
    global: {
      stubs: {
        Teleport: true
      }
    }
  })
  await flushPromises()

  return {
    wrapper,
    providerClient,
    stopDebugEvents,
    emitDebugEvent: (payload: DebugEventPayload) => debugEventListener?.(payload)
  }
}

describe('AcpDebugDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses ProviderClient for debug actions and typed debug events', async () => {
    const { wrapper, providerClient, stopDebugEvents, emitDebugEvent } = await setup()
    const vm = wrapper.vm as any

    emitDebugEvent({
      webContentsId: 88,
      agentId: 'codex-acp',
      event: {
        id: 'event-1',
        kind: 'response',
        action: 'initialize',
        agentId: 'codex-acp',
        timestamp: 123
      },
      version: 1
    })

    expect(vm.events).toHaveLength(1)

    vm.selectedMethod = 'initialize'
    vm.payloadText = '{}'
    await vm.handleSend()
    await flushPromises()

    expect(providerClient.runAcpDebugAction).toHaveBeenCalledWith({
      agentId: 'codex-acp',
      action: 'initialize',
      payload: {},
      sessionId: undefined,
      workdir: undefined,
      methodName: undefined
    })

    wrapper.unmount()
    expect(stopDebugEvents).toHaveBeenCalledTimes(1)
  })
})
