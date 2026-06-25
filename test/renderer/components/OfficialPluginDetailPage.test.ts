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

const remoteSettingsStub = defineComponent({
  name: 'RemoteSettings',
  props: {
    channel: { type: String, default: '' },
    hideChannelToggle: { type: Boolean, default: false }
  },
  template:
    '<div data-testid="remote-settings" :data-channel="channel" :data-hide-toggle="String(hideChannelToggle)"></div>'
})

async function mountFeishuDetail(options: { enabled?: boolean; remoteEnabled?: boolean } = {}) {
  vi.resetModules()
  vi.clearAllMocks()

  const pluginClient = {
    getPlugin: vi.fn().mockResolvedValue({
      id: 'com.deepchat.plugins.feishu',
      name: 'Feishu/Lark Integration',
      publisher: 'DeepChat',
      version: '1.0.4',
      enabled: options.enabled ?? false,
      capabilities: [],
      mcpServers: []
    }),
    enablePlugin: vi.fn().mockResolvedValue({ ok: true }),
    disablePlugin: vi.fn().mockResolvedValue({ ok: true })
  }
  const remoteControlClient = {
    getChannelSettings: vi.fn().mockResolvedValue({
      brand: 'feishu',
      appId: 'cli_a',
      appSecret: 'secret',
      verificationToken: '',
      encryptKey: '',
      remoteEnabled: options.remoteEnabled ?? false,
      defaultAgentId: 'feishu-bot',
      defaultWorkdir: '',
      pairedUserOpenIds: []
    }),
    saveChannelSettings: vi.fn().mockResolvedValue({})
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
  vi.doMock('vue-router', async () => {
    const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
    return {
      ...actual,
      useRoute: () => ({
        params: { pluginId: 'com.deepchat.plugins.feishu' }
      }),
      useRouter: () => router
    }
  })
  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      t: (key: string) => key
    })
  }))
  vi.doMock('@iconify/vue', () => ({
    Icon: defineComponent({
      name: 'Icon',
      template: '<span />'
    })
  }))
  vi.doMock('../../../src/renderer/settings/components/RemoteSettings.vue', () => ({
    default: remoteSettingsStub
  }))
  vi.doMock('../../../settings/components/RemoteSettings.vue', () => ({
    default: remoteSettingsStub
  }))

  const OfficialPluginDetailPage = (await import('@/pages/plugins/OfficialPluginDetailPage.vue'))
    .default
  const wrapper = shallowMount(OfficialPluginDetailPage, {
    global: {
      stubs: {
        Button: buttonStub,
        ScrollArea: passthrough('ScrollArea'),
        RemoteSettings: remoteSettingsStub
      }
    }
  })
  await flushPromises()

  return { wrapper, pluginClient, remoteControlClient }
}

describe('OfficialPluginDetailPage', () => {
  it('uses the plugin enable button to start Feishu remote too', async () => {
    const { wrapper, pluginClient, remoteControlClient } = await mountFeishuDetail()

    expect(wrapper.find('[data-testid="remote-settings"]').attributes('data-hide-toggle')).toBe(
      'true'
    )

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.plugins.enable')!
      .trigger('click')
    await flushPromises()

    expect(pluginClient.enablePlugin).toHaveBeenCalledWith('com.deepchat.plugins.feishu')
    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'feishu',
      expect.objectContaining({ remoteEnabled: true })
    )
  })

  it('uses the plugin disable button to stop Feishu remote too', async () => {
    const { wrapper, pluginClient, remoteControlClient } = await mountFeishuDetail({
      enabled: true,
      remoteEnabled: true
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'settings.plugins.disable')!
      .trigger('click')
    await flushPromises()

    expect(pluginClient.disablePlugin).toHaveBeenCalledWith('com.deepchat.plugins.feishu')
    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'feishu',
      expect.objectContaining({ remoteEnabled: false })
    )
  })
})
