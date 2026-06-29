import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const buttonStub = defineComponent({
  name: 'Button',
  props: {
    disabled: { type: Boolean, default: false }
  },
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
})

const translations: Record<string, string> = {
  'routes.plugins': 'Plugins',
  'settings.pluginsHub.add': 'Add',
  'settings.pluginsHub.available': 'Available plugins',
  'settings.pluginsHub.cuaDescription': 'CUA localized description',
  'settings.pluginsHub.manage': 'Manage',
  'settings.pluginsHub.subtitle': 'Manage DeepChat plugins.',
  'settings.plugins.status.disabled': 'Disabled',
  'settings.plugins.status.enabled': 'Enabled',
  'settings.remote.feishu.description': 'Feishu localized description',
  'settings.remote.feishu.title': 'Feishu localized title'
}

async function mountCatalog() {
  vi.resetModules()
  vi.clearAllMocks()

  const pluginClient = {
    listPlugins: vi.fn().mockResolvedValue([
      {
        id: 'com.deepchat.plugins.feishu',
        name: 'Feishu/Lark Integration',
        publisher: 'DeepChat',
        version: '1.0.4',
        enabled: false,
        capabilities: [],
        mcpServers: []
      },
      {
        id: 'com.deepchat.plugins.cua',
        name: 'CUA Computer Use Runtime',
        publisher: 'DeepChat',
        version: '1.0.4',
        enabled: true,
        capabilities: [],
        mcpServers: []
      }
    ]),
    enablePlugin: vi.fn().mockResolvedValue({ ok: true })
  }
  const remoteControlClient = {
    listRemoteChannels: vi.fn().mockResolvedValue([
      {
        id: 'feishu',
        type: 'builtin',
        implemented: true,
        titleKey: 'settings.remote.feishu.title',
        descriptionKey: 'settings.remote.feishu.description',
        supportsPairing: true,
        supportsNotifications: false
      }
    ]),
    getChannelStatus: vi.fn().mockResolvedValue({
      channel: 'feishu',
      enabled: false,
      state: 'disabled',
      bindingCount: 0,
      pairedUserCount: 0,
      lastError: null
    })
  }
  const router = {
    push: vi.fn()
  }

  vi.doMock('@api/PluginClient', () => ({
    createPluginClient: () => pluginClient
  }))
  vi.doMock('@api/RemoteControlClient', () => ({
    createRemoteControlClient: () => remoteControlClient
  }))
  vi.doMock('vue-router', () => ({
    useRouter: () => router
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key
    })
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({
      name: 'Icon',
      props: {
        icon: { type: String, required: true }
      },
      template: '<span :data-icon="icon" />'
    })
  }))

  const PluginsCatalogPage = (await import('@/pages/plugins/PluginsCatalogPage.vue')).default
  const wrapper = shallowMount(PluginsCatalogPage, {
    global: {
      stubs: {
        Button: buttonStub,
        ScrollArea: passthrough('ScrollArea')
      }
    }
  })
  await flushPromises()

  return { wrapper, pluginClient, remoteControlClient }
}

describe('PluginsCatalogPage', () => {
  it('keeps the Feishu official plugin title localized after catalog load', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.text()).toContain('Feishu localized title')
    expect(wrapper.text()).not.toContain('settings.remote.feishu.title')
    expect(wrapper.text()).not.toContain('Feishu/Lark Integration')
  })

  it('uses the localized Feishu description in catalog', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.text()).toContain('Feishu localized description')
    expect(wrapper.text()).not.toContain('DeepChat · com.deepchat.plugins.feishu')
  })

  it('uses the CUA laptop icon in the catalog', async () => {
    const { wrapper } = await mountCatalog()

    expect(
      wrapper.findAll(
        '[data-icon="lucide:laptop-minimal-check"], [icon="lucide:laptop-minimal-check"]'
      )
    ).toHaveLength(1)
  })

  it('uses the localized CUA description in catalog', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.text()).toContain('CUA localized description')
  })

  it('shows available plugins heading instead of unsupported category filters', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.text()).toContain('Available plugins')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.available')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.filters.official')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.filters.workspace')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.filters.personal')
  })

  it('removes search and standalone added section', async () => {
    const { wrapper } = await mountCatalog()

    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('settings.pluginsHub.searchPlaceholder')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.added')
    expect(wrapper.text()).not.toContain('settings.pluginsHub.noAdded')
  })

  it('sorts enabled plugins first and uses add/manage labels', async () => {
    const { wrapper } = await mountCatalog()
    const cards = wrapper.findAll('article')

    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('CUA Computer Use Runtime')
    expect(cards[0].text()).toContain('Manage')
    expect(cards[0].text()).toContain('Enabled')
    expect(cards[0].find('span.rounded-full').classes()).toContain('bg-emerald-500/10')
    expect(cards[1].text()).toContain('Feishu localized title')
    expect(cards[1].text()).toContain('Add')
    expect(cards[1].text()).toContain('Disabled')
  })
})
