import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { DeepChatAgentConfig } from '../../../src/shared/types/agent-interface'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const ButtonStub = defineComponent({
  name: 'Button',
  props: { disabled: { type: Boolean, default: false } },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const SwitchStub = defineComponent({
  name: 'Switch',
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  template:
    '<button v-bind="$attrs" type="button" :data-model-value="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />'
})

const ModelSelectStub = defineComponent({
  name: 'ModelSelect',
  emits: ['update:model'],
  template:
    '<button type="button" data-testid="model-select" @click="$emit(\'update:model\', { id: \'embedding-model\' }, \'provider-a\')" />'
})

const stubs = {
  Collapsible: passthrough('Collapsible'),
  CollapsibleContent: passthrough('CollapsibleContent'),
  CollapsibleTrigger: passthrough('CollapsibleTrigger'),
  Popover: passthrough('Popover'),
  PopoverContent: passthrough('PopoverContent'),
  PopoverTrigger: passthrough('PopoverTrigger'),
  Button: ButtonStub,
  Input: passthrough('Input'),
  Switch: SwitchStub,
  ModelIcon: passthrough('ModelIcon'),
  ModelSelect: ModelSelectStub,
  Icon: passthrough('Icon')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

async function setup(config: DeepChatAgentConfig = {}, resolved: DeepChatAgentConfig = {}) {
  vi.resetModules()
  const updateDeepChatAgent = vi.fn().mockResolvedValue({ id: 'deepchat' })
  const configClient = {
    listAgents: vi.fn().mockResolvedValue([
      {
        id: 'deepchat',
        type: 'deepchat',
        name: 'DeepChat',
        config
      }
    ]),
    resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
      memoryEnabled: true,
      ...resolved
    }),
    updateDeepChatAgent
  }
  const toast = vi.fn()

  vi.doMock('@api/ConfigClient', () => ({ createConfigClient: () => configClient }))
  vi.doMock('@/components/use-toast', () => ({ useToast: () => ({ toast }) }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => ({
      allProviderModels: [],
      findModelByIdOrName: () => null
    })
  }))
  vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
  vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

  const MemoryConfigInlinePanel = (
    await import('../../../src/renderer/settings/components/MemoryConfigInlinePanel.vue')
  ).default
  const wrapper = mount(MemoryConfigInlinePanel, {
    props: { open: true, agentId: 'deepchat' },
    global: { stubs }
  })
  await flushPromises()
  return { wrapper, updateDeepChatAgent, configClient, toast }
}

describe('MemoryConfigInlinePanel', () => {
  it('does not render the inline panel while closed', async () => {
    const { wrapper } = await setup()

    await wrapper.setProps({ open: false })
    await flushPromises()

    expect(wrapper.find('[data-testid="settings-memory-config-panel"]').exists()).toBe(false)
  })

  it('emits close without changing already-saved field behavior', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('[data-testid="settings-memory-config-panel"]').exists()).toBe(true)
    await wrapper.find('[data-testid="settings-memory-config-close"]').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('keeps the original override snapshot current while the panel stays open', async () => {
    const { wrapper, updateDeepChatAgent } = await setup()

    await wrapper.find('[data-testid="model-select"]').trigger('click')
    await flushPromises()

    expect(updateDeepChatAgent).toHaveBeenCalledTimes(1)
    expect(updateDeepChatAgent.mock.calls[0][1].config).toEqual({
      memoryEmbedding: { providerId: 'provider-a', modelId: 'embedding-model' }
    })

    const clearButton = wrapper.findAll('button').find((button) => button.text() === 'common.clear')
    expect(clearButton).toBeTruthy()
    await clearButton!.trigger('click')
    await flushPromises()

    expect(updateDeepChatAgent).toHaveBeenCalledTimes(2)
    expect(updateDeepChatAgent.mock.calls[1][1].config).toEqual({ memoryEmbedding: null })
  })

  it('discards a stale load response after the agent changes while the sheet stays open', async () => {
    vi.resetModules()
    const listAgents = vi.fn().mockResolvedValue([
      { id: 'agent-a', type: 'deepchat', name: 'A', config: {} },
      { id: 'agent-b', type: 'deepchat', name: 'B', config: {} }
    ])
    const pendingA = deferred<DeepChatAgentConfig>()
    const resolveDeepChatAgentConfig = vi.fn().mockImplementation((agentId: string) => {
      if (agentId === 'agent-a') return pendingA.promise
      return Promise.resolve({ memoryEnabled: false })
    })
    const updateDeepChatAgent = vi.fn().mockResolvedValue({ id: 'agent-b' })
    const configClient = { listAgents, resolveDeepChatAgentConfig, updateDeepChatAgent }
    const toast = vi.fn()

    vi.doMock('@api/ConfigClient', () => ({ createConfigClient: () => configClient }))
    vi.doMock('@/components/use-toast', () => ({ useToast: () => ({ toast }) }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => ({
        allProviderModels: [],
        findModelByIdOrName: () => null
      })
    }))
    vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
    vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

    const MemoryConfigInlinePanel = (
      await import('../../../src/renderer/settings/components/MemoryConfigInlinePanel.vue')
    ).default
    const wrapper = mount(MemoryConfigInlinePanel, {
      props: { open: true, agentId: 'agent-a' },
      global: { stubs }
    })
    await flushPromises()

    // Switch agents before agent A's resolveDeepChatAgentConfig call settles.
    await wrapper.setProps({ agentId: 'agent-b' })
    await flushPromises()

    const memorySwitch = wrapper.findAll('button[data-model-value]')[0]
    expect(memorySwitch.attributes('data-model-value')).toBe('false')

    // Agent A's stale response arrives after the switch; it must not overwrite agent B's form.
    pendingA.resolve({ memoryEnabled: true })
    await flushPromises()

    expect(memorySwitch.attributes('data-model-value')).toBe('false')
    wrapper.unmount()
  })

  it('serializes a clear against an in-flight set for the same key and still sends explicit null', async () => {
    const callLog: string[] = []
    const setDeferred = deferred<{ id: string }>()
    const updateDeepChatAgent = vi
      .fn()
      .mockImplementation((_agentId: string, payload: { config: DeepChatAgentConfig }) => {
        if (payload.config.memoryEmbedding) {
          callLog.push('set-start')
          return setDeferred.promise.then((result) => {
            callLog.push('set-resolved')
            return result
          })
        }
        callLog.push('clear-called')
        return Promise.resolve({ id: 'deepchat' })
      })
    const configClient = {
      listAgents: vi
        .fn()
        .mockResolvedValue([{ id: 'deepchat', type: 'deepchat', name: 'DeepChat', config: {} }]),
      resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({ memoryEnabled: true }),
      updateDeepChatAgent
    }
    const toast = vi.fn()

    vi.resetModules()
    vi.doMock('@api/ConfigClient', () => ({ createConfigClient: () => configClient }))
    vi.doMock('@/components/use-toast', () => ({ useToast: () => ({ toast }) }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => ({
        allProviderModels: [],
        findModelByIdOrName: () => null
      })
    }))
    vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
    vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

    const MemoryConfigInlinePanel = (
      await import('../../../src/renderer/settings/components/MemoryConfigInlinePanel.vue')
    ).default
    const wrapper = mount(MemoryConfigInlinePanel, {
      props: { open: true, agentId: 'deepchat' },
      global: { stubs }
    })
    await flushPromises()

    await wrapper.find('[data-testid="model-select"]').trigger('click')
    await flushPromises()
    expect(callLog).toEqual(['set-start'])

    const clearButton = wrapper.findAll('button').find((button) => button.text() === 'common.clear')
    await clearButton!.trigger('click')
    await flushPromises()

    // The clear must not reach the wire while the preceding set is still in flight.
    expect(callLog).toEqual(['set-start'])
    expect(updateDeepChatAgent).toHaveBeenCalledTimes(1)

    setDeferred.resolve({ id: 'deepchat' })
    await flushPromises()

    expect(callLog).toEqual(['set-start', 'set-resolved', 'clear-called'])
    expect(updateDeepChatAgent).toHaveBeenCalledTimes(2)
    expect(updateDeepChatAgent.mock.calls[1][1].config).toEqual({ memoryEmbedding: null })
    wrapper.unmount()
  })

  it('keeps queued same-key writes scoped to the original agent after an agent switch', async () => {
    const callLog: string[] = []
    const setDeferred = deferred<{ id: string }>()
    const updateDeepChatAgent = vi
      .fn()
      .mockImplementation((agentId: string, payload: { config: DeepChatAgentConfig }) => {
        if (payload.config.memoryEmbedding) {
          callLog.push(`${agentId}:set-start`)
          return setDeferred.promise.then((result) => {
            callLog.push(`${agentId}:set-resolved`)
            return result
          })
        }
        callLog.push(`${agentId}:clear-called`)
        return Promise.resolve({ id: agentId })
      })
    const configClient = {
      listAgents: vi.fn().mockResolvedValue([
        { id: 'agent-a', type: 'deepchat', name: 'A', config: {} },
        { id: 'agent-b', type: 'deepchat', name: 'B', config: {} }
      ]),
      resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({ memoryEnabled: true }),
      updateDeepChatAgent
    }
    const toast = vi.fn()

    vi.resetModules()
    vi.doMock('@api/ConfigClient', () => ({ createConfigClient: () => configClient }))
    vi.doMock('@/components/use-toast', () => ({ useToast: () => ({ toast }) }))
    vi.doMock('@/stores/modelStore', () => ({
      useModelStore: () => ({
        allProviderModels: [],
        findModelByIdOrName: () => null
      })
    }))
    vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
    vi.doMock('@iconify/vue', () => ({ Icon: passthrough('Icon') }))

    const MemoryConfigInlinePanel = (
      await import('../../../src/renderer/settings/components/MemoryConfigInlinePanel.vue')
    ).default
    const wrapper = mount(MemoryConfigInlinePanel, {
      props: { open: true, agentId: 'agent-a' },
      global: { stubs }
    })
    await flushPromises()

    await wrapper.find('[data-testid="model-select"]').trigger('click')
    await flushPromises()
    expect(callLog).toEqual(['agent-a:set-start'])

    const clearButton = wrapper.findAll('button').find((button) => button.text() === 'common.clear')
    await clearButton!.trigger('click')
    await flushPromises()
    expect(updateDeepChatAgent).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ agentId: 'agent-b' })
    await flushPromises()

    setDeferred.resolve({ id: 'agent-a' })
    await flushPromises()
    await flushPromises()

    expect(callLog).toEqual(['agent-a:set-start', 'agent-a:set-resolved', 'agent-a:clear-called'])
    expect(updateDeepChatAgent).toHaveBeenCalledTimes(2)
    expect(updateDeepChatAgent.mock.calls[0][0]).toBe('agent-a')
    expect(updateDeepChatAgent.mock.calls[1][0]).toBe('agent-a')
    expect(updateDeepChatAgent.mock.calls[1][1].config).toEqual({ memoryEmbedding: null })
    expect(wrapper.emitted('saved')).toBeUndefined()
    wrapper.unmount()
  })
})
