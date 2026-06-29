import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { DeepChatAgentConfig } from '../../../src/shared/types/agent-interface'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const ButtonStub = defineComponent({
  name: 'Button',
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
})

const InputStub = defineComponent({
  name: 'Input',
  props: { modelValue: { type: [String, Number], default: '' } },
  emits: ['update:modelValue'],
  template:
    '<input v-bind="$attrs" :value="modelValue ?? \'\'" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const SwitchStub = defineComponent({
  name: 'Switch',
  props: { modelValue: { type: Boolean, default: false } },
  emits: ['update:modelValue'],
  template:
    '<button v-bind="$attrs" type="button" :data-model-value="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />'
})

const stubs = {
  Button: ButtonStub,
  Input: InputStub,
  Switch: SwitchStub,
  Popover: passthrough('Popover'),
  PopoverContent: passthrough('PopoverContent'),
  PopoverTrigger: passthrough('PopoverTrigger'),
  ModelSelect: passthrough('ModelSelect'),
  ModelIcon: passthrough('ModelIcon'),
  Icon: true
}

async function setup(
  config: DeepChatAgentConfig,
  resolved: DeepChatAgentConfig = { memoryEnabled: true }
) {
  vi.resetModules()
  const updateDeepChatAgent = vi.fn().mockResolvedValue({ id: 'a' })
  const configClient = {
    listAgents: vi.fn().mockResolvedValue([{ id: 'a', type: 'deepchat', name: 'A', config }]),
    resolveDeepChatAgentConfig: vi.fn().mockResolvedValue(resolved),
    updateDeepChatAgent
  }

  vi.doMock('@api/ConfigClient', () => ({ createConfigClient: () => configClient }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => ({ allProviderModels: [], findModelByIdOrName: () => null })
  }))
  vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
  vi.doMock('@iconify/vue', () => ({ Icon: { name: 'Icon', template: '<span />' } }))

  const MemoryConfigPanel = (
    await import('../../../src/renderer/settings/components/MemoryConfigPanel.vue')
  ).default
  const wrapper = mount(MemoryConfigPanel, {
    props: { agentId: 'a' },
    global: { stubs }
  })
  await flushPromises()
  return { wrapper, updateDeepChatAgent }
}

const clickByText = async (wrapper: Awaited<ReturnType<typeof setup>>['wrapper'], text: string) => {
  const button = wrapper.findAll('button').find((b) => b.text().includes(text))
  await button!.trigger('click')
}
const openAdvancedSettings = async (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) => {
  await clickByText(wrapper, 'settings.memory.config.advancedTitle')
  await flushPromises()
}
const save = (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) =>
  clickByText(wrapper, 'common.save')

const inputByPlaceholder = (
  wrapper: Awaited<ReturnType<typeof setup>>['wrapper'],
  placeholder: string
) => wrapper.findAll('input').find((i) => i.attributes('placeholder') === placeholder)

afterEach(() => vi.clearAllMocks())

describe('MemoryConfigPanel override semantics (AC-2.1~2.5)', () => {
  it('clears a previously-set override by writing null and omits untouched fields', async () => {
    const { wrapper, updateDeepChatAgent } = await setup(
      { memoryEnabled: true, memoryEmbedding: { providerId: 'p', modelId: 'm' } },
      { memoryEnabled: true }
    )

    // Clearing the embedding popover sets the model to null.
    await clickByText(wrapper, 'common.clear')
    await save(wrapper)
    await flushPromises()

    expect(updateDeepChatAgent).toHaveBeenCalledTimes(1)
    const [, payload] = updateDeepChatAgent.mock.calls[0]
    const config = payload.config as DeepChatAgentConfig
    // A previously-set override that is now empty must be sent as explicit null, not omitted.
    expect(config.memoryEmbedding).toBeNull()
    // Untouched fields (including the booleans) stay out of the patch so the shallow merge keeps
    // the inherited value rather than ossifying it.
    expect('memoryEnabled' in config).toBe(false)
    expect('personaEvolutionEnabled' in config).toBe(false)
    expect('memoryExtractionModel' in config).toBe(false)
    expect('memoryInjectionTokenBudget' in config).toBe(false)
    expect('memoryRetrieval' in config).toBe(false)
  })

  it('does not ossify inherited booleans: untouched save omits them and rich controls stay visible', async () => {
    const { wrapper, updateDeepChatAgent } = await setup(
      {},
      { memoryEnabled: true, personaEvolutionEnabled: true }
    )

    await openAdvancedSettings(wrapper)

    // memoryEnabled resolves to true via inheritance, so the rich controls must render.
    expect(wrapper.text()).toContain('settings.memory.config.extractionModel')

    await save(wrapper)
    await flushPromises()

    const [, payload] = updateDeepChatAgent.mock.calls[0]
    const config = payload.config as DeepChatAgentConfig
    expect('memoryEnabled' in config).toBe(false)
    expect('personaEvolutionEnabled' in config).toBe(false)
  })

  it('writes the boolean override only after the switch is toggled', async () => {
    const { wrapper, updateDeepChatAgent } = await setup({}, { memoryEnabled: true })

    const enableSwitch = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'settings.deepchatAgents.memoryEnabled')
    await enableSwitch!.trigger('click')
    await save(wrapper)
    await flushPromises()

    const [, payload] = updateDeepChatAgent.mock.calls[0]
    const config = payload.config as DeepChatAgentConfig
    expect(config.memoryEnabled).toBe(false)
  })

  it('clamps out-of-range retrieval and budget values to the kernel limits', async () => {
    const { wrapper, updateDeepChatAgent } = await setup({ memoryEnabled: true })

    await openAdvancedSettings(wrapper)
    await inputByPlaceholder(wrapper, '1200')!.setValue('99999')

    // Enable the retrieval override, then push topK past its ceiling.
    const overrideSwitch = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'settings.memory.config.retrievalOverride')
    await overrideSwitch!.trigger('click')
    await inputByPlaceholder(wrapper, '6')!.setValue('999')

    await save(wrapper)
    await flushPromises()

    const [, payload] = updateDeepChatAgent.mock.calls[0]
    const config = payload.config as DeepChatAgentConfig
    expect(config.memoryInjectionTokenBudget).toBe(8000)
    expect(config.memoryRetrieval?.topK).toBe(100)
    expect(config.memoryRetrieval?.rrfK).toBe(60)
    expect(config.memoryRetrieval?.similarityThreshold).toBe(0.2)
  })

  it('omits the retrieval override entirely when it was never set and stays off', async () => {
    const { wrapper, updateDeepChatAgent } = await setup({ memoryEnabled: true })

    await save(wrapper)
    await flushPromises()

    const [, payload] = updateDeepChatAgent.mock.calls[0]
    const config = payload.config as DeepChatAgentConfig
    expect('memoryRetrieval' in config).toBe(false)
  })
})
