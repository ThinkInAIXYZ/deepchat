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

const inputStub = defineComponent({
  name: 'Input',
  props: {
    modelValue: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', \'\')" />'
})

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
    RouterLink: passthrough('RouterLink'),
    useRouter: () => router
  }))
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
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
        Input: inputStub,
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

    expect(wrapper.text()).toContain('settings.remote.feishu.title')
    expect(wrapper.text()).not.toContain('Feishu/Lark Integration')
  })
})
