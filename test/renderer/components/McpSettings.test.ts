import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button @click="$emit(\'click\')"><slot /></button>'
})

const setup = async (
  props: Record<string, unknown> = {},
  options: { mcpEnabled?: boolean } = {}
) => {
  vi.resetModules()

  const notifyRenderer = vi.fn()
  const configClient = {
    listAgents: vi.fn().mockResolvedValue([
      {
        id: 'deepchat',
        type: 'deepchat',
        name: 'DeepChat',
        enabled: true,
        config: {
          enabledMcpServerIds: ['Artifacts']
        }
      }
    ]),
    resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
      enabledMcpServerIds: ['Artifacts']
    }),
    updateDeepChatAgent: vi.fn().mockResolvedValue({
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      config: {
        enabledMcpServerIds: ['Artifacts', 'Custom']
      }
    })
  }
  const mcpStore = reactive({
    mcpEnabled: options.mcpEnabled ?? true,
    configLoading: false,
    serverList: [
      {
        name: 'Artifacts',
        enabled: true,
        isRunning: true
      },
      {
        name: 'Custom',
        enabled: false,
        isRunning: false
      }
    ],
    config: {
      ready: true,
      mcpServers: {
        Artifacts: {
          type: 'inmemory',
          source: 'deepchat'
        },
        Custom: {
          type: 'stdio'
        }
      }
    },
    setMcpEnabled: vi.fn().mockResolvedValue(true),
    getNpmRegistryStatus: vi.fn().mockResolvedValue({
      currentRegistry: null,
      isFromCache: false,
      autoDetectEnabled: true,
      customRegistry: undefined
    }),
    refreshNpmRegistry: vi.fn().mockResolvedValue('https://registry.npmjs.org/'),
    setAutoDetectNpmRegistry: vi.fn().mockResolvedValue(undefined),
    setCustomNpmRegistry: vi.fn().mockResolvedValue(undefined),
    clearNpmRegistryCache: vi.fn().mockResolvedValue(undefined)
  })

  vi.doMock('@/stores/mcp', () => ({
    useMcpStore: () => mcpStore
  }))
  vi.doMock('@/stores/language', () => ({
    useLanguageStore: () => ({
      dir: 'ltr'
    })
  }))
  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configClient
  }))
  vi.doMock('@/composables/useGuidedOnboardingStep', () => ({
    useGuidedOnboardingStep: () => ({
      showGuide: ref(false),
      stepIndex: ref(1),
      totalSteps: ref(6),
      dismissGuide: vi.fn(),
      completeStep: vi.fn().mockResolvedValue(null),
      skipStep: vi.fn().mockResolvedValue(null)
    })
  }))
  vi.doMock('@renderer-notifications/rendererNotificationPort', () => ({
    notifyRenderer
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))

  const McpSettings = (await import('../../../src/renderer/src/features/mcp/McpSettingsView.vue'))
    .default

  const wrapper = mount(McpSettings, {
    props,
    global: {
      stubs: {
        Switch: true,
        DcButton: buttonStub,
        Input: true,
        Icon: true,
        Separator: true,
        Card: passthrough('Card'),
        CardContent: passthrough('CardContent'),
        CardDescription: passthrough('CardDescription'),
        CardHeader: passthrough('CardHeader'),
        CardTitle: passthrough('CardTitle'),
        Collapsible: passthrough('Collapsible'),
        CollapsibleContent: passthrough('CollapsibleContent'),
        CollapsibleTrigger: passthrough('CollapsibleTrigger'),
        Dialog: passthrough('Dialog'),
        DialogTrigger: passthrough('DialogTrigger'),
        DialogContent: defineComponent({ name: 'DialogContent', template: '<div />' }),
        DialogHeader: defineComponent({ name: 'DialogHeader', template: '<div />' }),
        DialogTitle: defineComponent({ name: 'DialogTitle', template: '<div />' }),
        DialogDescription: defineComponent({ name: 'DialogDescription', template: '<div />' }),
        GuidedOnboardingOverlay: true,
        McpServers: defineComponent({
          name: 'McpServers',
          props: {
            serverEnabledOverrides: { type: Object, default: () => ({}) },
            serverLoadingOverrides: { type: Object, default: () => ({}) },
            agentScopedToggle: { type: Boolean, default: false },
            agentScopedBusy: { type: Boolean, default: false }
          },
          emits: ['toggle-agent-server'],
          template:
            '<button data-testid="servers-view" :disabled="agentScopedBusy" @click="$emit(\'toggle-agent-server\', \'Custom\', true)">{{ agentScopedToggle }}:{{ serverEnabledOverrides.Custom }}:{{ serverLoadingOverrides.Custom }}</button>'
        })
      }
    }
  })

  await flushPromises()

  return {
    wrapper,
    configClient,
    mcpStore,
    notifyRenderer
  }
}

describe('McpSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('respects the global MCP master switch in agent scope', async () => {
    const { wrapper } = await setup({ scope: 'agent', agentId: 'deepchat' }, { mcpEnabled: false })

    expect(wrapper.find('[data-testid="servers-view"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('settings.mcp.enableToAccess')
  })

  it('saves MCP server toggles to the current agent in agent scope', async () => {
    const { wrapper, configClient, mcpStore, notifyRenderer } = await setup({
      scope: 'agent',
      agentId: 'deepchat'
    })

    expect(wrapper.find('[data-testid="servers-view"]').text()).toContain('true:false:')

    await wrapper.find('[data-testid="servers-view"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('agent-policy-saved')).toEqual([['deepchat']])
    expect(mcpStore.setMcpEnabled).not.toHaveBeenCalled()
    expect(configClient.updateDeepChatAgent).toHaveBeenCalledWith('deepchat', {
      config: {
        enabledMcpServerIds: ['Artifacts', 'Custom']
      }
    })
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        code: 'settings.agentMcpPolicy.saved',
        title: 'settings.mcp.saveSuccess'
      })
    )
  })

  it('optimistically reflects one agent policy write and blocks overlapping toggles', async () => {
    const { wrapper, configClient } = await setup({ scope: 'agent', agentId: 'deepchat' })
    let resolveUpdate: (agent: Record<string, unknown>) => void = () => undefined
    configClient.updateDeepChatAgent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        })
    )
    const serverView = wrapper.get('[data-testid="servers-view"]')

    await serverView.trigger('click')
    await wrapper.vm.$nextTick()

    expect(serverView.text()).toContain('true:true:true')
    expect(serverView.attributes('disabled')).toBeDefined()
    await serverView.trigger('click')
    expect(configClient.updateDeepChatAgent).toHaveBeenCalledTimes(1)

    resolveUpdate({
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      config: {
        enabledMcpServerIds: ['Artifacts', 'Custom']
      }
    })
    await flushPromises()

    expect(serverView.attributes('disabled')).toBeUndefined()
  })

  it('rolls back failed agent-scoped toggles and reports the failure toast', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, configClient, notifyRenderer } = await setup({
      scope: 'agent',
      agentId: 'deepchat'
    })
    configClient.updateDeepChatAgent.mockRejectedValueOnce(new Error('write failed'))

    await wrapper.find('[data-testid="servers-view"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="servers-view"]').text()).toContain('true:false:')
    expect(notifyRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        code: 'settings.agentMcpPolicy.saveFailed',
        title: 'settings.mcp.saveFailed',
        description: 'common.error.requestFailed'
      })
    )
    consoleError.mockRestore()
  })

  it('requires an explicit target for agent scope', async () => {
    const { wrapper, configClient } = await setup({ scope: 'agent' })
    expect(configClient.listAgents).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('agentScopeUnsupported')
  })

  it('ignores a policy load that returns after switching targets', async () => {
    const { wrapper, configClient } = await setup({ scope: 'agent', agentId: 'deepchat' })
    let resolveA!: (config: { enabledMcpServerIds: string[] }) => void
    configClient.listAgents.mockImplementation(async ({ ids }) => [
      { id: ids[0], type: 'deepchat' }
    ])
    configClient.resolveDeepChatAgentConfig.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve
        })
    )
    await wrapper.setProps({ agentId: 'agent-a' })
    await flushPromises()
    await wrapper.setProps({ agentId: 'agent-b' })
    await flushPromises()
    expect(wrapper.get('[data-testid="servers-view"]').text()).toContain('true:false:')
    resolveA({ enabledMcpServerIds: ['Custom'] })
    await flushPromises()
    expect(wrapper.get('[data-testid="servers-view"]').text()).toContain('true:false:')
    await wrapper.get('[data-testid="servers-view"]').trigger('click')
    await flushPromises()
    expect(configClient.updateDeepChatAgent).toHaveBeenCalledWith('agent-b', {
      config: { enabledMcpServerIds: ['Artifacts', 'Custom'] }
    })
  })

  it('keeps a delayed save bound to its original target and notifies the caller', async () => {
    const saved = vi.fn()
    const { wrapper, configClient } = await setup({
      scope: 'agent',
      agentId: 'deepchat',
      onAgentPolicySaved: saved
    })
    let resolveSave!: (agent: Record<string, unknown>) => void
    configClient.updateDeepChatAgent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        })
    )
    await wrapper.get('[data-testid="servers-view"]').trigger('click')
    configClient.listAgents.mockResolvedValueOnce([{ id: 'agent-b', type: 'deepchat' }])
    await wrapper.setProps({ agentId: 'agent-b' })
    await flushPromises()
    resolveSave({ id: 'deepchat', type: 'deepchat', config: { enabledMcpServerIds: ['Custom'] } })
    await flushPromises()
    expect(configClient.updateDeepChatAgent).toHaveBeenCalledWith('deepchat', {
      config: { enabledMcpServerIds: ['Artifacts', 'Custom'] }
    })
    expect(wrapper.get('[data-testid="servers-view"]').text()).toContain('true:false:')
    expect(saved).toHaveBeenCalledExactlyOnceWith('deepchat')
  })

  it('reports a failed global master toggle through the semantic port', async () => {
    const { wrapper, mcpStore, notifyRenderer } = await setup()
    mcpStore.setMcpEnabled.mockResolvedValueOnce(false)
    const viewModel = wrapper.vm as unknown as {
      handleMcpEnabledChange(enabled: boolean): Promise<void>
    }

    await viewModel.handleMcpEnabledChange(false)

    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'error',
      code: 'settings.mcp.masterToggleFailed',
      title: 'common.error.operationFailed',
      description: 'common.error.requestFailed'
    })
  })

  it('keeps npm registry refresh failures inside the advanced settings surface', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { wrapper, mcpStore, notifyRenderer } = await setup()
    mcpStore.refreshNpmRegistry.mockRejectedValueOnce(new Error('offline'))
    const viewModel = wrapper.vm as unknown as {
      npmRegistryFeedback: { kind: string; message: string } | null
      refreshNpmRegistry(): Promise<void>
    }

    await viewModel.refreshNpmRegistry()

    expect(viewModel.npmRegistryFeedback).toEqual({
      kind: 'error',
      message: 'settings.mcp.npmRegistry.refreshFailed'
    })
    expect(notifyRenderer).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('keeps a successful registry write authoritative when status refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true
    } as Response)
    const { wrapper, mcpStore, notifyRenderer } = await setup()
    mcpStore.getNpmRegistryStatus.mockRejectedValueOnce(new Error('status unavailable'))
    const viewModel = wrapper.vm as unknown as {
      customRegistryInput: string
      npmRegistryStatus: {
        currentRegistry: string | null
        customRegistry?: string
      }
      npmRegistryFeedback: { kind: string; message: string } | null
      saveCustomNpmRegistry(): Promise<void>
    }
    viewModel.customRegistryInput = 'https://registry.example.test'

    await viewModel.saveCustomNpmRegistry()

    expect(mcpStore.setCustomNpmRegistry).toHaveBeenCalledWith('https://registry.example.test')
    expect(viewModel.npmRegistryStatus.currentRegistry).toBe('https://registry.example.test/')
    expect(viewModel.npmRegistryStatus.customRegistry).toBe('https://registry.example.test/')
    expect(viewModel.npmRegistryFeedback).toBeNull()
    expect(notifyRenderer).not.toHaveBeenCalled()
    fetchMock.mockRestore()
    consoleError.mockRestore()
  })
})
