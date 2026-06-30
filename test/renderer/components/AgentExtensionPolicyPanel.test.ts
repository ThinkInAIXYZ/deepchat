import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const ButtonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template:
    '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>'
})

const mocks = vi.hoisted(() => ({
  configClient: {
    listAgents: vi.fn(),
    updateDeepChatAgent: vi.fn(),
    onAgentsChanged: vi.fn(),
    getSetting: vi.fn()
  },
  pluginClient: {
    listPlugins: vi.fn()
  },
  skillClient: {
    getMetadataList: vi.fn()
  },
  mcpClient: {
    getMcpServers: vi.fn()
  }
}))

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => mocks.configClient
}))
vi.mock('@api/PluginClient', () => ({
  createPluginClient: () => mocks.pluginClient
}))
vi.mock('@api/SkillClient', () => ({
  createSkillClient: () => mocks.skillClient
}))
vi.mock('@api/McpClient', () => ({
  createMcpClient: () => mocks.mcpClient
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.count === undefined ? key : `${key}:${String(params.count)}`
  })
}))
vi.mock('@iconify/vue', () => ({
  Icon: defineComponent({
    name: 'Icon',
    template: '<span />'
  })
}))

describe('AgentExtensionPolicyPanel', () => {
  async function mountPanel(options: { kinds?: string[]; standalone?: boolean } = {}) {
    vi.resetModules()
    vi.clearAllMocks()
    setActivePinia(createPinia())

    const agent = {
      id: 'deepchat',
      type: 'deepchat',
      name: 'DeepChat',
      enabled: true,
      protected: true,
      config: {}
    }

    mocks.configClient.listAgents.mockResolvedValue([agent])
    mocks.configClient.updateDeepChatAgent.mockResolvedValue(agent)
    mocks.configClient.onAgentsChanged.mockReturnValue(() => undefined)
    mocks.configClient.getSetting.mockResolvedValue(null)
    mocks.pluginClient.listPlugins.mockResolvedValue([
      {
        id: 'plugin-alpha',
        name: 'Plugin Alpha',
        version: '1.0.0',
        publisher: 'DeepChat',
        installed: true,
        enabled: true,
        trusted: true,
        trustState: 'trusted',
        official: true,
        capabilities: []
      }
    ])
    mocks.skillClient.getMetadataList.mockResolvedValue([
      { name: 'skill-alpha', description: 'Skill Alpha', path: '', skillRoot: '' }
    ])
    mocks.mcpClient.getMcpServers.mockResolvedValue({
      'server-alpha': {
        command: '',
        args: [],
        env: {},
        descriptions: 'Server Alpha',
        icons: '',
        autoApprove: [],
        enabled: true,
        type: 'stdio'
      },
      'plugin-owned': {
        command: '',
        args: [],
        env: {},
        descriptions: 'Plugin Owned',
        icons: '',
        autoApprove: [],
        enabled: true,
        type: 'stdio',
        ownerPluginId: 'plugin-alpha'
      },
      'plugin-source-owned': {
        command: '',
        args: [],
        env: {},
        descriptions: 'Plugin Source Owned',
        icons: '',
        autoApprove: [],
        enabled: true,
        type: 'stdio',
        source: 'plugin',
        sourceId: 'plugin-alpha'
      }
    })

    const { useAgentStore } = await import('@/stores/ui/agent')
    const { useSessionStore } = await import('@/stores/ui/session')
    useAgentStore().setSelectedAgent('deepchat')
    useSessionStore().activeSessionId = null

    const AgentExtensionPolicyPanel = (
      await import('@/pages/plugins/AgentExtensionPolicyPanel.vue')
    ).default
    const wrapper = shallowMount(AgentExtensionPolicyPanel, {
      props: options,
      global: {
        stubs: {
          Button: ButtonStub,
          Icon: true
        }
      }
    })
    await flushPromises()

    return { wrapper }
  }

  it('renders a skills-only agent policy view without global skill toggles', async () => {
    const { wrapper } = await mountPanel({ kinds: ['skills'], standalone: true })

    expect(wrapper.find('[data-testid="agent-extension-plugins-mode"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-extension-mcp-mode"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-extension-skills-mode"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('settings.skills.title')

    await wrapper.find('[data-testid="agent-extension-skills-mode"]').trigger('click')
    expect(wrapper.text()).toContain('skill-alpha')

    await wrapper.find('[data-testid="agent-extension-policy-save"]').trigger('click')
    await flushPromises()

    expect(mocks.configClient.updateDeepChatAgent).toHaveBeenCalledWith('deepchat', {
      config: {
        enabledSkillNames: ['skill-alpha']
      }
    })
  })

  it('saves plugin skill and global MCP policy for the current agent', async () => {
    const { wrapper } = await mountPanel()

    expect(wrapper.text()).not.toContain('Plugin Owned')
    expect(wrapper.text()).not.toContain('Plugin Source Owned')

    for (const selector of [
      '[data-testid="agent-extension-plugins-mode"]',
      '[data-testid="agent-extension-skills-mode"]',
      '[data-testid="agent-extension-mcp-mode"]'
    ]) {
      await wrapper.find(selector).trigger('click')
    }

    expect(wrapper.text()).toContain('Plugin Alpha')
    expect(wrapper.text()).toContain('skill-alpha')
    expect(wrapper.text()).toContain('Server Alpha')
    expect(wrapper.text()).not.toContain('Plugin Owned')
    expect(wrapper.text()).not.toContain('Plugin Source Owned')

    await wrapper.find('[data-testid="agent-extension-policy-save"]').trigger('click')
    await flushPromises()

    expect(mocks.configClient.updateDeepChatAgent).toHaveBeenCalledWith('deepchat', {
      config: {
        enabledPluginIds: ['plugin-alpha'],
        enabledSkillNames: ['skill-alpha'],
        enabledMcpServerIds: ['server-alpha']
      }
    })
  })
})
