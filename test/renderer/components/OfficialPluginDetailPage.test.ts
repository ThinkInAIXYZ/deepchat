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
    hideChannelToggle: { type: Boolean, default: false },
    hideHeader: { type: Boolean, default: false }
  },
  template:
    '<div data-testid="remote-settings" :data-channel="channel" :data-hide-toggle="String(hideChannelToggle)" :data-hide-header="String(hideHeader)"></div>'
})

const translations: Record<string, string> = {
  'chat.sidebar.remoteControlStatus.disabled': 'Remote disabled',
  'chat.sidebar.remoteControlStatus.running': 'Remote running',
  'common.back': 'Back',
  'settings.plugins.disable': 'Disable',
  'settings.plugins.enable': 'Enable',
  'settings.plugins.status.disabled': 'Disabled',
  'settings.plugins.status.enabled': 'Enabled',
  'settings.pluginsHub.actionResult': 'Action result',
  'settings.pluginsHub.capabilities': 'Capabilities',
  'settings.pluginsHub.cuaDescription': 'CUA localized description',
  'settings.plugins.runtime': 'Runtime',
  'settings.plugins.version': 'Version',
  'settings.remote.feishu.description': 'Feishu localized description',
  'settings.remote.feishu.title': 'Feishu localized title',
  'settings.remote.telegram.description': 'Telegram localized description',
  'settings.remote.telegram.title': 'Telegram localized title'
}

const defaultFeishuSettings = (remoteEnabled: boolean) => ({
  brand: 'feishu',
  appId: 'cli_a',
  appSecret: 'secret',
  verificationToken: '',
  encryptKey: '',
  remoteEnabled,
  defaultAgentId: 'feishu-bot',
  defaultWorkdir: '',
  pairedUserOpenIds: []
})

const defaultTelegramSettings = (remoteEnabled: boolean) => ({
  botToken: 'token',
  remoteEnabled,
  defaultAgentId: 'telegram-bot',
  defaultWorkdir: '',
  allowedUserIds: []
})

const findIcon = (wrapper: ReturnType<typeof shallowMount>, icon: string) =>
  wrapper.find(`[data-icon="${icon}"], [icon="${icon}"]`)

const findRemoteSettingsKey = (wrapper: ReturnType<typeof shallowMount>) =>
  wrapper.findComponent(remoteSettingsStub).vm.$.vnode.key

async function mountDetail(
  options: { enabled?: boolean; pluginId?: string; remoteEnabled?: boolean } = {}
) {
  vi.resetModules()
  vi.clearAllMocks()

  const pluginId = options.pluginId ?? 'com.deepchat.plugins.feishu'
  const remoteChannel = pluginId.startsWith('remote:') ? pluginId.slice('remote:'.length) : 'feishu'
  const remoteEnabled = options.remoteEnabled ?? false
  const pluginName =
    pluginId === 'com.deepchat.plugins.cua' ? 'CUA Computer Use Runtime' : 'Feishu/Lark Integration'
  const pluginClient = {
    getPlugin: vi.fn().mockResolvedValue({
      id: pluginId,
      name: pluginName,
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
    getChannelSettings: vi
      .fn()
      .mockResolvedValue(
        remoteChannel === 'telegram'
          ? defaultTelegramSettings(remoteEnabled)
          : defaultFeishuSettings(remoteEnabled)
      ),
    getChannelStatus: vi.fn().mockResolvedValue({
      channel: remoteChannel,
      enabled: remoteEnabled,
      state: remoteEnabled ? 'running' : 'disabled',
      bindingCount: 1,
      allowedUserCount: 1,
      lastError: null
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
        params: { pluginId }
      }),
      useRouter: () => router
    }
  })
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
  it('uses the Feishu remote icon on the official plugin detail header', async () => {
    const { wrapper } = await mountDetail()

    const icon = findIcon(wrapper, 'lucide:message-circle')

    expect(icon.exists()).toBe(true)
    expect(icon.classes()).toContain('text-blue-500')
    expect(findIcon(wrapper, 'lucide:puzzle').exists()).toBe(false)
    expect(wrapper.text()).toContain('Feishu localized title')
    expect(wrapper.text()).not.toContain('settings.remote.feishu.title')
    expect(wrapper.text()).not.toContain('Feishu/Lark Integration')
  })

  it('uses the localized Feishu description on the official plugin detail header', async () => {
    const { wrapper } = await mountDetail()

    expect(wrapper.text()).toContain('Feishu localized description')
    expect(wrapper.text()).not.toContain('DeepChat · com.deepchat.plugins.feishu')
  })

  it('uses the remote channel icon color on remote virtual plugin details', async () => {
    const { wrapper } = await mountDetail({ pluginId: 'remote:telegram' })

    const icon = findIcon(wrapper, 'lucide:send')

    expect(icon.exists()).toBe(true)
    expect(icon.classes()).toContain('text-sky-500')
  })

  it('uses the CUA laptop icon on the official plugin detail header', async () => {
    const { wrapper } = await mountDetail({ pluginId: 'com.deepchat.plugins.cua' })

    expect(findIcon(wrapper, 'lucide:laptop-minimal-check').exists()).toBe(true)
    expect(findIcon(wrapper, 'lucide:puzzle').exists()).toBe(false)
  })

  it('uses the localized CUA description on the official plugin detail header', async () => {
    const { wrapper } = await mountDetail({ pluginId: 'com.deepchat.plugins.cua' })

    expect(wrapper.text()).toContain('CUA localized description')
    expect(wrapper.text()).not.toContain('DeepChat · com.deepchat.plugins.cua')
  })

  it('uses the plugin enable button to start Feishu remote too', async () => {
    const { wrapper, pluginClient, remoteControlClient } = await mountDetail()

    expect(wrapper.find('[data-testid="remote-settings"]').attributes('data-hide-toggle')).toBe(
      'true'
    )
    expect(findRemoteSettingsKey(wrapper)).toBe('feishu:0')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Enable')!
      .trigger('click')
    await flushPromises()

    expect(pluginClient.enablePlugin).toHaveBeenCalledWith('com.deepchat.plugins.feishu')
    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'feishu',
      expect.objectContaining({ remoteEnabled: true })
    )
    expect(findRemoteSettingsKey(wrapper)).toBe('feishu:1')
  })

  it('uses the plugin disable button to stop Feishu remote too', async () => {
    const { wrapper, pluginClient, remoteControlClient } = await mountDetail({
      enabled: true,
      remoteEnabled: true
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Disable')!
      .trigger('click')
    await flushPromises()

    expect(pluginClient.disablePlugin).toHaveBeenCalledWith('com.deepchat.plugins.feishu')
    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'feishu',
      expect.objectContaining({ remoteEnabled: false })
    )
  })

  it('uses the top detail button to start remote virtual plugins', async () => {
    const { wrapper, pluginClient, remoteControlClient } = await mountDetail({
      pluginId: 'remote:telegram'
    })

    expect(pluginClient.getPlugin).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="remote-settings"]').attributes()).toMatchObject({
      'data-channel': 'telegram',
      'data-hide-toggle': 'true',
      'data-hide-header': 'true'
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Enable')!
      .trigger('click')
    await flushPromises()

    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({ remoteEnabled: true })
    )
  })

  it('uses the top detail button to stop remote virtual plugins', async () => {
    const { wrapper, remoteControlClient } = await mountDetail({
      pluginId: 'remote:telegram',
      remoteEnabled: true
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Disable')!
      .trigger('click')
    await flushPromises()

    expect(remoteControlClient.saveChannelSettings).toHaveBeenCalledWith(
      'telegram',
      expect.objectContaining({ remoteEnabled: false })
    )
  })
})
