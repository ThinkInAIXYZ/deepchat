import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, shallowMount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({ routeName: 'plugins' }))

vi.mock('pinia', async () => vi.importActual<typeof import('pinia')>('pinia'))

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: mocks.routeName }),
  RouterLink: {
    name: 'RouterLink',
    template: '<a><slot /></a>'
  },
  RouterView: {
    name: 'RouterView',
    template: '<div data-testid="plugins-child-route"></div>'
  }
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'routes.plugins': 'Plugins',
        'routes.plugins-skills': 'Skills',
        'routes.settings-mcp': 'MCP',
        'settings.pluginsHub.acpUnavailableTitle': 'Plugins are unavailable',
        'settings.pluginsHub.acpUnavailableDescription':
          'ACP agents manage extensions through their own runtime.'
      })[key] ?? key
  })
}))

vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    template: '<span />'
  }
}))

vi.mock('@api/ConfigClient', () => ({
  createConfigClient: () => ({
    onAgentsChanged: () => () => undefined
  })
}))

vi.mock('@api/SessionClient', () => ({
  createSessionClient: () => ({})
}))

describe('PluginsHubPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.routeName = 'plugins'
  })

  it('keeps global Plugin and Skills routes available for ACP selection', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useAgentStore } = await import('@/stores/ui/agent')
    const agentStore = useAgentStore()
    agentStore.applyBootstrapAgents([
      {
        id: 'deepchat',
        name: 'DeepChat',
        type: 'deepchat',
        enabled: true
      },
      {
        id: 'codex',
        name: 'Codex',
        type: 'acp',
        enabled: true
      }
    ])
    agentStore.setSelectedAgent('codex')

    const PluginsHubPage = (await import('@/pages/plugins/PluginsHubPage.vue')).default
    const wrapper = shallowMount(PluginsHubPage, {
      global: {
        plugins: [pinia]
      }
    })

    expect(wrapper.find('[data-testid="plugins-acp-unavailable"]').exists()).toBe(false)
    expect(wrapper.find('nav').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'RouterView' }).exists()).toBe(true)

    agentStore.setSelectedAgent('deepchat')
    await flushPromises()

    expect(wrapper.find('[data-testid="plugins-acp-unavailable"]').exists()).toBe(false)
    expect(wrapper.find('nav').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'RouterView' }).exists()).toBe(true)
  })

  it('keeps ACP unavailable only on the Agent-scoped MCP route', async () => {
    mocks.routeName = 'plugins-mcp'
    const pinia = createPinia()
    setActivePinia(pinia)
    const { useAgentStore } = await import('@/stores/ui/agent')
    const agentStore = useAgentStore()
    agentStore.applyBootstrapAgents([
      {
        id: 'codex',
        name: 'Codex',
        type: 'acp',
        enabled: true
      }
    ])
    agentStore.setSelectedAgent('codex')

    const PluginsHubPage = (await import('@/pages/plugins/PluginsHubPage.vue')).default
    const wrapper = shallowMount(PluginsHubPage, {
      global: {
        plugins: [pinia]
      }
    })

    expect(wrapper.find('[data-testid="plugins-acp-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Plugins are unavailable')
    expect(wrapper.find('nav').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'RouterView' }).exists()).toBe(false)
  })
})
