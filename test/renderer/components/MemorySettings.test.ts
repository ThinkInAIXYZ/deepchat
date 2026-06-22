import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { Agent } from '../../../src/shared/types/agent-interface'

const passthrough = (name: string) => defineComponent({ name, template: '<div><slot /></div>' })

const PanelStub = (name: string) =>
  defineComponent({ name, props: ['agentId'], template: '<div :data-agent-id="agentId" />' })

const ManagerStub = defineComponent({
  name: 'MemoryManagerPanel',
  props: ['agentId', 'memoryEnabled'],
  template: '<div :data-agent-id="agentId" :data-memory-enabled="memoryEnabled" />'
})

const stubs = {
  SettingsPageShell: passthrough('SettingsPageShell'),
  Tabs: passthrough('Tabs'),
  TabsList: passthrough('TabsList'),
  TabsTrigger: passthrough('TabsTrigger'),
  TabsContent: passthrough('TabsContent'),
  Select: passthrough('Select'),
  SelectContent: passthrough('SelectContent'),
  SelectItem: passthrough('SelectItem'),
  SelectTrigger: passthrough('SelectTrigger'),
  SelectValue: passthrough('SelectValue'),
  MemoryConfigPanel: PanelStub('MemoryConfigPanel'),
  MemoryManagerPanel: ManagerStub
}

const deepchat: Agent = { id: 'deepchat', name: 'DeepChat', type: 'deepchat', enabled: true }
const other: Agent = { id: 'other', name: 'Other', type: 'deepchat', enabled: true }

async function setup(
  agents: Agent[],
  query: Record<string, string> = {},
  resolveImpl?: (agentId: string) => Promise<unknown>
) {
  vi.resetModules()
  const configClient = {
    listAgents: vi.fn().mockResolvedValue(agents),
    resolveDeepChatAgentConfig: resolveImpl ? vi.fn(resolveImpl) : vi.fn().mockResolvedValue({})
  }
  vi.doMock('@api/ConfigClient', () => ({ createConfigClient: () => configClient }))
  vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
  vi.doMock('vue-router', () => ({
    useRoute: () => ({ query }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
  }))

  const MemorySettings = (
    await import('../../../src/renderer/settings/components/MemorySettings.vue')
  ).default
  const wrapper = mount(MemorySettings, { global: { stubs } })
  await flushPromises()
  return { wrapper, configClient }
}

const configAgentId = (wrapper: Awaited<ReturnType<typeof setup>>['wrapper']) =>
  wrapper.findComponent({ name: 'MemoryConfigPanel' }).props('agentId')

describe('MemorySettings agent picker (AC-1.2 / AC-1.3)', () => {
  it('defaults to the built-in deepchat agent', async () => {
    const { wrapper } = await setup([other, deepchat])
    expect(configAgentId(wrapper)).toBe('deepchat')
  })

  it('preselects the agent passed via the route query', async () => {
    const { wrapper } = await setup([deepchat, other], { agentId: 'other' })
    expect(configAgentId(wrapper)).toBe('other')
  })

  it('shows an empty state instead of erroring when no agents exist', async () => {
    const { wrapper } = await setup([])
    expect(wrapper.text()).toContain('settings.memory.empty')
    expect(wrapper.findComponent({ name: 'MemoryConfigPanel' }).exists()).toBe(false)
  })

  it('does not inherit the previous agent memoryEnabled while the next resolve is pending', async () => {
    let resolveOther!: (value: unknown) => void
    const otherPending = new Promise<unknown>((res) => {
      resolveOther = res
    })
    const { wrapper } = await setup([deepchat, other], {}, (id) =>
      id === 'deepchat' ? Promise.resolve({ memoryEnabled: true }) : otherPending
    )
    const manager = () => wrapper.findComponent({ name: 'MemoryManagerPanel' })

    // Agent A (deepchat) resolved as memory-enabled.
    expect(manager().props('memoryEnabled')).toBe(true)

    // Switch to agent B, whose resolve is still pending.
    wrapper.findComponent({ name: 'Select' }).vm.$emit('update:model-value', 'other')
    await flushPromises()
    expect(manager().props('agentId')).toBe('other')
    // B's flags have not landed, so the panel must gate to false — never inherit A's true.
    expect(manager().props('memoryEnabled')).toBe(false)

    // When B finally resolves disabled, it stays gated.
    resolveOther({ memoryEnabled: false })
    await flushPromises()
    expect(manager().props('memoryEnabled')).toBe(false)
  })
})
