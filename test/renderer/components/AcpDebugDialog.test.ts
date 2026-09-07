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
  requestId: string
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

async function setup(
  runAcpDebugAction?: ReturnType<typeof vi.fn>,
  createEditor: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
  selectDirectory: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({
    canceled: true,
    filePaths: []
  })
) {
  vi.resetModules()

  let debugEventListener: ((payload: DebugEventPayload) => void) | null = null
  const stopDebugEvents = vi.fn()
  const providerClient = {
    runAcpDebugAction:
      runAcpDebugAction ??
      vi.fn().mockResolvedValue({
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
    selectDirectory
  }
  const cleanupEditor = vi.fn()

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
      createEditor,
      updateCode: vi.fn(),
      getEditorView: vi.fn(() => ({
        onDidChangeModelContent: vi.fn(),
        getValue: vi.fn(() => '{}')
      })),
      cleanupEditor
    })
  }))
  vi.doMock('@/stores/uiSettingsStore', () => ({
    useUiSettingsStore: () => ({
      formattedCodeFontFamily: 'JetBrains Mono'
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
  vi.doMock('@dc-ui/components/button', () => ({
    DcButton: buttonStub
  }))
  vi.doMock('@shadcn/components/ui/dialog', () => ({
    Dialog: passthrough('Dialog'),
    DialogContent: passthrough('DialogContent'),
    DialogDescription: passthrough('DialogDescription'),
    DialogHeader: passthrough('DialogHeader'),
    DialogTitle: passthrough('DialogTitle')
  }))
  vi.doMock('@shadcn/components/ui/input', () => ({
    Input: passthrough('Input')
  }))
  vi.doMock('@shadcn/components/ui/badge', () => ({
    Badge: passthrough('Badge')
  }))
  vi.doMock('@shadcn/components/ui/empty', () => ({
    Empty: passthrough('Empty'),
    EmptyDescription: passthrough('EmptyDescription'),
    EmptyHeader: passthrough('EmptyHeader')
  }))
  vi.doMock('@shadcn/components/ui/spinner', () => ({
    Spinner: passthrough('Spinner')
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
    configClient,
    cleanupEditor,
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
      requestId: 'debug-run-abc123',
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

    emitDebugEvent({
      requestId: 'stale-debug-run',
      webContentsId: 88,
      agentId: 'codex-acp',
      event: {
        id: 'event-2',
        kind: 'response',
        action: 'initialize',
        agentId: 'codex-acp',
        timestamp: 124
      },
      version: 2
    })

    expect(vm.events).toHaveLength(1)

    vm.selectedMethod = 'initialize'
    vm.payloadText = '{}'
    await vm.handleSend()
    await flushPromises()

    expect(providerClient.runAcpDebugAction).toHaveBeenCalledWith({
      requestId: 'debug-run-abc123',
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

  it('runs health checks for manual ACP agents without registry installation', async () => {
    const { wrapper, providerClient, configClient } = await setup()
    await wrapper.setProps({ agentId: 'manual-acp', agentName: 'Manual ACP' })

    await (wrapper.vm as any).runHealthCheck()

    expect(configClient.ensureAcpAgentInstalled).not.toHaveBeenCalled()
    expect(providerClient.runAcpDebugAction).toHaveBeenCalledTimes(3)
    expect(providerClient.runAcpDebugAction).toHaveBeenNthCalledWith(1, {
      requestId: 'debug-run-abc123',
      agentId: 'manual-acp',
      action: 'initialize',
      payload: {},
      workdir: undefined
    })

    wrapper.unmount()
  })

  it('keeps payload validation failures inside the debug surface', async () => {
    const { wrapper, providerClient } = await setup()
    const vm = wrapper.vm as any

    vm.payloadText = '{'
    await vm.handleSend()

    expect(providerClient.runAcpDebugAction).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('settings.acp.debug.parseError')
    expect(wrapper.get('[role="alert"]').attributes('aria-live')).toBeUndefined()

    wrapper.unmount()
  })

  it('reports a failed health-check cancellation instead of presenting partial success', async () => {
    const runAcpDebugAction = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'ok',
        events: []
      })
      .mockResolvedValueOnce({
        status: 'ok',
        sessionId: 'health-session',
        events: []
      })
      .mockResolvedValueOnce({
        status: 'error',
        error: 'cancel failed',
        events: []
      })
    const { wrapper } = await setup(runAcpDebugAction)

    await (wrapper.vm as any).runHealthCheck()
    await flushPromises()

    expect(runAcpDebugAction).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('settings.acp.debug.healthCheckFailed')
    expect(wrapper.text()).toContain('cancel failed')
    expect((wrapper.vm as any).processReady).toBe(false)

    wrapper.unmount()
  })

  it('stops a health check when its dialog generation closes', async () => {
    let resolveInitialize: ((value: unknown) => void) | undefined
    const runAcpDebugAction = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveInitialize = resolve
        })
    )
    const { wrapper } = await setup(runAcpDebugAction)

    const healthCheck = (wrapper.vm as any).runHealthCheck()
    await wrapper.setProps({ open: false })
    resolveInitialize?.({
      status: 'ok',
      events: []
    })
    await healthCheck
    await flushPromises()

    expect(runAcpDebugAction).toHaveBeenCalledTimes(1)
    expect((wrapper.vm as any).events).toEqual([])
    expect((wrapper.vm as any).loading).toBe(false)

    wrapper.unmount()
  })

  it('disposes an editor that finishes initializing after the dialog closes', async () => {
    let resolveEditor: (() => void) | undefined
    const createEditor = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveEditor = resolve
        })
    )
    const { wrapper, cleanupEditor } = await setup(undefined, createEditor)

    expect(createEditor).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ open: false })
    resolveEditor?.()
    await flushPromises()

    expect(cleanupEditor).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('ignores a directory selection that resolves after the dialog closes', async () => {
    let resolveDirectory: ((value: { canceled: boolean; filePaths: string[] }) => void) | undefined
    const selectDirectory = vi.fn(
      () =>
        new Promise<{ canceled: boolean; filePaths: string[] }>((resolve) => {
          resolveDirectory = resolve
        })
    )
    const { wrapper } = await setup(undefined, undefined, selectDirectory)

    const selection = (wrapper.vm as any).handleSelectWorkdir()
    await wrapper.setProps({ open: false })
    resolveDirectory?.({ canceled: false, filePaths: ['/tmp/stale-workdir'] })
    await selection
    await flushPromises()

    expect((wrapper.vm as any).workdirPath).toBe('')

    wrapper.unmount()
  })
})
