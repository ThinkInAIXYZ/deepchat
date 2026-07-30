import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, shallowRef } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { AcpManualAgent, AcpRegistryAgent } from '@shared/types/acp'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const ButtonStub = defineComponent({
  name: 'ButtonStub',
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const InputStub = defineComponent({
  name: 'InputStub',
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue'],
  template:
    '<input :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const TextareaStub = defineComponent({
  name: 'TextareaStub',
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue'],
  template:
    '<textarea :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const SwitchStub = defineComponent({
  name: 'SwitchStub',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue'],
  template:
    '<input type="checkbox" :disabled="disabled" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
})

const DialogStub = defineComponent({
  name: 'DialogStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  template: '<div v-if="open"><slot /></div>'
})

const AgentTransferDialogStub = defineComponent({
  name: 'AgentTransferDialogStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['confirm-delete'],
  template:
    '<div v-if="open"><button data-testid="confirm-delete-agent" @click="$emit(\'confirm-delete\')">Confirm delete</button></div>'
})

const installedAgent = (): AcpRegistryAgent => ({
  id: 'codex-acp',
  name: 'Codex ACP',
  version: '0.10.0',
  description: 'Registry agent',
  source: 'registry',
  enabled: true,
  distribution: {
    npx: {
      package: '@zed-industries/codex-acp'
    }
  },
  installState: {
    status: 'installed'
  }
})

type SetupOptions = {
  registryAgents?: AcpRegistryAgent[]
  manualAgents?: AcpManualAgent[]
  config?: Record<string, unknown>
}

async function setup(options: SetupOptions = {}) {
  vi.resetModules()

  const discardSharedMcpRetryIntent = vi.fn()
  const AgentMcpSelectorStub = defineComponent({
    name: 'AgentMcpSelector',
    emits: ['update:selections', 'persistence-state'],
    setup(_props, { expose }) {
      expose({ discardRetryIntent: discardSharedMcpRetryIntent })
      return {}
    },
    template: '<div />'
  })
  const feedbackSnapshot = shallowRef<any>({ status: 'idle', version: 0 })
  const feedbackController = {
    begin: vi.fn((operationId: string, label: string) => {
      feedbackSnapshot.value = {
        status: 'pending',
        operationId,
        label,
        version: feedbackSnapshot.value.version + 1
      }
    }),
    succeed: vi.fn((result: { code: string; title: string; description?: string }) => {
      feedbackSnapshot.value = {
        status: 'success',
        operationId: 'settings.acp.operation:test',
        ...result,
        version: feedbackSnapshot.value.version + 1
      }
    }),
    fail: vi.fn((result: { code: string; title: string; description?: string }) => {
      feedbackSnapshot.value = {
        status: 'error',
        operationId: 'settings.acp.operation:test',
        ...result,
        version: feedbackSnapshot.value.version + 1
      }
    }),
    clearSettled: vi.fn(() => {
      feedbackSnapshot.value = {
        status: 'idle',
        version: feedbackSnapshot.value.version + 1
      }
    })
  }

  const configService = {
    getAcpEnabled: vi.fn().mockResolvedValue(true),
    listAcpRegistryAgents: vi.fn().mockResolvedValue(options.registryAgents ?? []),
    listManualAcpAgents: vi.fn().mockResolvedValue(options.manualAgents ?? []),
    getAcpSharedMcpSelections: vi.fn().mockResolvedValue([]),
    setAcpEnabled: vi.fn().mockResolvedValue(true),
    refreshAcpRegistry: vi.fn().mockResolvedValue(options.registryAgents ?? []),
    setAcpAgentEnabled: vi.fn().mockResolvedValue({ ok: true }),
    setAcpAgentEnvOverride: vi.fn().mockResolvedValue({ ok: true }),
    ensureAcpAgentInstalled: vi.fn().mockResolvedValue({ status: 'installed' }),
    repairAcpAgent: vi.fn().mockResolvedValue({ status: 'installed' }),
    uninstallAcpRegistryAgent: vi.fn().mockResolvedValue(undefined),
    addManualAcpAgent: vi.fn().mockResolvedValue(null),
    updateManualAcpAgent: vi.fn().mockResolvedValue(null),
    removeManualAcpAgent: vi.fn().mockResolvedValue(true),
    listAgents: vi.fn().mockResolvedValue([
      {
        id: 'deepchat',
        name: 'DeepChat',
        type: 'deepchat',
        enabled: true
      }
    ]),
    onAgentsChanged: vi.fn(() => vi.fn()),
    ...options.config
  }
  const sessionClient = {
    getAgentTransferImpact: vi.fn().mockResolvedValue({
      totalSessions: 0,
      movableSessions: 0,
      emptyDrafts: 0,
      blockedSessions: 0
    }),
    deleteAgentSessions: vi.fn().mockResolvedValue(undefined),
    moveAgentSessions: vi.fn().mockResolvedValue(undefined)
  }

  vi.doMock('@api/ConfigClient', () => ({
    createConfigClient: () => configService
  }))
  vi.doMock('@api/SessionClient', () => ({
    createSessionClient: () => sessionClient
  }))
  vi.doMock('@renderer-notifications/rendererNotificationRuntime', () => ({
    createRendererSurfaceFeedbackController: () => feedbackController
  }))
  vi.doMock('@renderer-notifications/useSurfaceFeedback', () => ({
    useSurfaceFeedback: () => ({
      snapshot: feedbackSnapshot,
      setActive: vi.fn()
    })
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('../../../src/renderer/settings/components/AcpDebugDialog.vue', () => ({
    default: passthrough('AcpDebugDialog')
  }))
  vi.doMock('@/components/mcp-config/AgentMcpSelector.vue', () => ({
    default: AgentMcpSelectorStub
  }))
  vi.doMock('@/components/agent/AgentTransferDialog.vue', () => ({
    default: AgentTransferDialogStub
  }))
  vi.doMock('@/components/icons/AcpAgentIcon.vue', () => ({
    default: passthrough('AcpAgentIcon')
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: passthrough('Icon')
  }))

  const AcpSettings = (await import('../../../src/renderer/settings/components/AcpSettings.vue'))
    .default
  const { settingsLeaveGuard } =
    await import('../../../src/renderer/settings/services/settingsLeaveGuard')
  const wrapper = mount(AcpSettings, {
    global: {
      stubs: {
        Card: passthrough('Card'),
        CardContent: passthrough('CardContent'),
        CardDescription: passthrough('CardDescription'),
        CardHeader: passthrough('CardHeader'),
        CardTitle: passthrough('CardTitle'),
        Badge: passthrough('Badge'),
        Button: ButtonStub,
        Switch: SwitchStub,
        Separator: passthrough('Separator'),
        Input: InputStub,
        Textarea: TextareaStub,
        Label: passthrough('Label'),
        Collapsible: passthrough('Collapsible'),
        CollapsibleContent: passthrough('CollapsibleContent'),
        Dialog: DialogStub,
        DialogContent: passthrough('DialogContent'),
        DialogDescription: passthrough('DialogDescription'),
        DialogFooter: passthrough('DialogFooter'),
        DialogHeader: passthrough('DialogHeader'),
        DialogTitle: passthrough('DialogTitle'),
        AgentTransferDialog: AgentTransferDialogStub,
        AcpDebugDialog: passthrough('AcpDebugDialog'),
        AgentMcpSelector: AgentMcpSelectorStub,
        AcpAgentIcon: passthrough('AcpAgentIcon'),
        Icon: true
      }
    }
  })
  await flushPromises()

  return {
    wrapper,
    configService,
    sessionClient,
    feedbackController,
    feedbackSnapshot,
    discardSharedMcpRetryIntent,
    settingsLeaveGuard
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('AcpSettings', () => {
  it('removes an uninstalled registry agent locally without a redundant success toast', async () => {
    const { wrapper, configService, sessionClient, feedbackController } = await setup({
      registryAgents: [installedAgent()]
    })

    const uninstallButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('settings.acp.registryUninstallAction'))
    expect(uninstallButton).toBeDefined()

    await uninstallButton!.trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="confirm-delete-agent"]').trigger('click')
    await flushPromises()

    expect(sessionClient.deleteAgentSessions).toHaveBeenCalledWith('codex-acp')
    expect(configService.uninstallAcpRegistryAgent).toHaveBeenCalledWith('codex-acp')
    expect(configService.listAcpRegistryAgents).toHaveBeenCalledTimes(1)
    expect(feedbackController.succeed).toHaveBeenCalledWith({
      code: 'settings.acp.agentDeleted',
      title: 'common.saved'
    })
    expect(wrapper.text()).not.toContain('Codex ACP')
  })

  it('keeps environment save feedback inline and does not turn cache refresh into save failure', async () => {
    const { wrapper, configService, feedbackController } = await setup({
      registryAgents: [installedAgent()]
    })

    await wrapper.get('textarea').setValue('TOKEN=secret')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(configService.setAcpAgentEnvOverride).toHaveBeenCalledWith('codex-acp', {
      TOKEN: 'secret'
    })
    expect(configService.listAcpRegistryAgents).toHaveBeenCalledTimes(1)
    expect(feedbackController.succeed).toHaveBeenCalledWith({
      code: 'settings.acp.envOverrideSaved',
      title: 'common.saved'
    })
    expect(wrapper.text()).toContain('common.saved')
  })

  it('retains a failed environment save with a retry that reuses the submitted value', async () => {
    const setAcpAgentEnvOverride = vi
      .fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce({ ok: true })
    const { wrapper, feedbackController } = await setup({
      registryAgents: [installedAgent()],
      config: { setAcpAgentEnvOverride }
    })

    await wrapper.get('textarea').setValue('TOKEN=secret')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(feedbackController.fail).toHaveBeenCalledWith({
      code: 'settings.acp.envOverrideSaveFailed',
      title: 'settings.acp.saveFailed'
    })

    const retryButton = wrapper.findAll('button').find((button) => button.text() === 'common.retry')
    await retryButton!.trigger('click')
    await flushPromises()

    expect(setAcpAgentEnvOverride).toHaveBeenCalledTimes(2)
    expect(setAcpAgentEnvOverride).toHaveBeenLastCalledWith('codex-acp', {
      TOKEN: 'secret'
    })
  })

  it('guards dirty and in-flight environment drafts until persistence completes', async () => {
    let resolveSave: (() => void) | undefined
    const setAcpAgentEnvOverride = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )
    const { wrapper, settingsLeaveGuard } = await setup({
      registryAgents: [installedAgent()],
      config: { setAcpAgentEnvOverride }
    })

    await wrapper.get('textarea').setValue('TOKEN=secret')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('dirty')

    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
    await saveButton!.trigger('click')
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('busy')

    resolveSave?.()
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
    wrapper.unmount()
  })

  it('guards shared MCP selection persistence and retained retry intent', async () => {
    const { wrapper, discardSharedMcpRetryIntent, settingsLeaveGuard } = await setup({
      registryAgents: [installedAgent()]
    })
    const selector = wrapper.findComponent({ name: 'AgentMcpSelector' })
    const collapseButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'common.expand')

    selector.vm.$emit('persistence-state', 'saving')
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().risk).toBe('busy')
    expect(collapseButton?.attributes('disabled')).toBeDefined()

    selector.vm.$emit('persistence-state', 'retryable')
    await flushPromises()

    expect(settingsLeaveGuard.getSnapshot().risk).toBe('dirty')
    const leave = settingsLeaveGuard.requestLeave()
    expect(settingsLeaveGuard.discardAndLeave()).toBe(true)
    await expect(leave).resolves.toBe(true)
    expect(discardSharedMcpRetryIntent).toHaveBeenCalledOnce()
    expect(settingsLeaveGuard.getSnapshot().risk).toBe('clean')
    wrapper.unmount()
  })

  it('keeps a failed manual agent save open with contextual feedback', async () => {
    const addManualAcpAgent = vi.fn().mockRejectedValue(new Error('write failed'))
    const { wrapper, feedbackController } = await setup({
      config: { addManualAcpAgent }
    })

    const addButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.acp.addCustomAgent')
    await addButton!.trigger('click')
    await wrapper.findAll('input')[1].setValue('Local Agent')
    await wrapper.findAll('input')[2].setValue('local-agent')

    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(addManualAcpAgent).toHaveBeenCalledTimes(1)
    expect(feedbackController.fail).toHaveBeenCalledWith({
      code: 'settings.acp.manualAgentSaveFailed',
      title: 'settings.acp.saveFailed'
    })
    expect(wrapper.text()).toContain('settings.acp.saveFailed')
    expect(wrapper.text()).toContain('settings.acp.profileDialog.addCustomTitle')
  })

  it('keeps registry refresh failures in the dialog lifecycle for retry and handoff', async () => {
    const refreshAcpRegistry = vi.fn().mockRejectedValue(new Error('registry unavailable'))
    const { wrapper, feedbackController } = await setup({
      config: { refreshAcpRegistry }
    })

    const openButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.acp.registryInstallEntry')
    await openButton!.trigger('click')

    const refreshButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.acp.registryRefresh')
    await refreshButton!.trigger('click')
    await flushPromises()

    expect(feedbackController.fail).toHaveBeenCalledWith({
      code: 'settings.acp.registryRefreshFailed',
      title: 'common.error.requestFailed'
    })
    expect(wrapper.text()).toContain('common.error.requestFailed')
    expect(wrapper.text()).toContain('common.retry')
  })

  it('reveals the saved manual agent instead of replacing visible state with a success toast', async () => {
    const addManualAcpAgent = vi.fn().mockResolvedValue({
      id: 'manual-local',
      name: 'Local Agent',
      command: 'local-agent',
      enabled: true,
      source: 'manual'
    })
    const { wrapper, configService } = await setup({
      config: { addManualAcpAgent }
    })

    const addButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.acp.addCustomAgent')
    await addButton!.trigger('click')
    await wrapper.findAll('input')[1].setValue('Local Agent')
    await wrapper.findAll('input')[2].setValue('local-agent')

    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'common.save')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(addManualAcpAgent).toHaveBeenCalledTimes(1)
    expect(configService.listManualAcpAgents).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Local Agent')
    expect(wrapper.text()).not.toContain('settings.acp.profileDialog.addCustomTitle')
  })

  it('keeps controls disabled until an initial load retry succeeds', async () => {
    const getAcpEnabled = vi
      .fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(false)
    const { wrapper } = await setup({
      config: { getAcpEnabled }
    })

    expect(wrapper.text()).toContain('common.error.requestFailed')
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()

    const retryButton = wrapper.findAll('button').find((button) => button.text() === 'common.retry')
    await retryButton!.trigger('click')
    await flushPromises()

    expect(getAcpEnabled).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('common.error.requestFailed')
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeUndefined()
  })

  it('does not expose empty enabled controls when post-toggle loading fails', async () => {
    const getAcpEnabled = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const listAcpRegistryAgents = vi.fn().mockRejectedValue(new Error('read failed'))
    const { wrapper, configService } = await setup({
      config: { getAcpEnabled, listAcpRegistryAgents }
    })

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(configService.setAcpEnabled).toHaveBeenCalledWith(true)
    expect(wrapper.text()).toContain('common.error.requestFailed')
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('settings.acp.installedEmptyTitle')
    expect(wrapper.text()).not.toContain('settings.acp.addCustomAgent')
  })
})
